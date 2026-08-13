"use server";

/** Edit many people at once, from the roster grid. HR and the MD. */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { checkRole } from "@/lib/auth/guards";
import { cycleError, type CycleResult } from "@/lib/cycles/schema";
import { addSalaryChange } from "@/lib/employment/actions";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

/**
 * WHY A SALARY CELL IS NOT JUST ANOTHER CELL
 *
 * Everything else on this grid is a fact about a person: their designation, who
 * they report to, when they joined. Editing one is a correction and writing it
 * straight to the column is right.
 *
 * A salary is not a fact, it is an EVENT. `salary_history` is append-only for
 * every caller including a migration (P19-3), `previous_ctc` and the percentage
 * are derived rather than accepted (P19-7), and 0068 moves the increment clock
 * from the ledger's latest entry. Writing `current_ctc` from a cell would put a
 * figure on the record that the ledger cannot account for — and every stored
 * percentage was computed against that ledger.
 *
 * So a changed salary cell does NOT become an update. It becomes a call to
 * `addSalaryChange`, which is the one implementation of what a pay change is,
 * and the reason and effective date it requires are collected once for the whole
 * batch rather than once per person. That is the only concession to speed here,
 * and it is a real one: twelve rises on the same date for the same reason is
 * exactly the case this screen exists for.
 */
const cellPatchSchema = z.object({
  profileId: z.string().uuid(),
  /* -- Every field OPTIONAL, and absent means "not edited". Never null-as-blank:
        a grid sends back only the cells somebody touched, and treating an absent
        key as an instruction to clear would empty a column the moment anybody
        edited a different one (P19D-4's rule, on a different surface). -- */
  employee_code: z.string().trim().max(40).optional(),
  designation: z.string().trim().max(120).optional(),
  department_id: z.string().uuid().nullable().optional(),
  reports_to: z.string().uuid().nullable().optional(),
  employment_type: z.enum(["PERMANENT", "CONTRACT", "PROBATION", "INTERN"]).optional(),
  /* -- The rest of what the import writes, so a mistake made in a spreadsheet
        can be corrected on the screen that shows it rather than only by
        re-uploading the file (F25-1 built the grid; these are the columns it
        was missing).

        `track` is §7's module, so changing it moves somebody between the staff
        0-5 form and the shop-floor tick sheet. Editable because getting it
        wrong on import is exactly the thing HR needs to fix, and history is
        safe either way: a launched evaluation holds its own frozen questions.

        `joining_ctc` is the BASELINE every stored percentage was computed
        against (P19E-1), so it is written through 0069's function, which
        refuses to overwrite one that already exists. The cell is read-only
        where a baseline is already on record.

        `last_increment_date` is NOT here. 0068 made the pay ledger
        authoritative for it — "once there is a recorded rise, that is when they
        were last given one" — so a hand-typed date would be silently overruled
        by the next pay change. A cell that does not hold its value is worse
        than no cell. -- */
  track: z.enum(["STAFF", "WORKER"]).optional(),
  date_of_joining: z.string().optional(),
  increment_frequency_months: z.coerce.number().int().min(1).max(60).optional(),
  joining_ctc: z.number().positive().max(100_000_000).optional(),
  /** Annual, as stored. The grid types monthly and converts before sending. */
  current_ctc: z.number().positive().max(100_000_000).optional(),
});

const bulkSchema = z.object({
  patches: z.array(cellPatchSchema).min(1, "Nothing was changed.").max(200),
  /* -- Required ONLY when a salary actually moved. Validated below rather than
        in the schema, so a batch of designation fixes is never asked for a pay
        reason it does not need. -- */
  salaryReason: z
    .enum(["ANNUAL_INCREMENT", "PROMOTION", "CORRECTION", "MARKET_ADJUSTMENT"])
    .optional(),
  salaryEffectiveFrom: z.string().optional(),
  salaryNote: z.string().trim().max(500).optional(),
});

export type BulkRowOutcome = { profileId: string; ok: boolean; error?: string };

export type BulkEditResult = {
  updated: number;
  salaryChanges: number;
  rows: BulkRowOutcome[];
};

export async function bulkUpdatePeople(
  input: z.input<typeof bulkSchema>,
): Promise<CycleResult<BulkEditResult>> {
  // §9: the pay decision belongs to HR and the MD, and a salary cell is on this
  // grid. Re-checked here because a screen is never the only guard.
  const auth = await checkRole(["HR_ADMIN", "MD"]);
  if (!auth.ok) return auth;

  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) {
    return cycleError("INVALID", parsed.error.issues[0]?.message ?? "Check the changes.");
  }
  const { patches, salaryReason, salaryEffectiveFrom, salaryNote } = parsed.data;

  const withSalary = patches.filter((p) => p.current_ctc !== undefined);
  if (withSalary.length > 0 && (!salaryReason || !salaryEffectiveFrom)) {
    return cycleError(
      "SALARY_NEEDS_REASON",
      "A pay change has to say why and from when. Choose a reason and an effective date, then save again.",
    );
  }

  const supabase = await createClient();
  const rows: BulkRowOutcome[] = [];
  let updated = 0;
  let salaryChanges = 0;

  for (const patch of patches) {
    const { profileId, current_ctc, employment_type } = patch;

    /* ---------- The person's own details ----------
          Built key by key rather than through `Object.fromEntries`, which
          produces a loose index signature that PostgREST's generated types
          reject outright. Naming the four columns also means a fifth cannot be
          smuggled in by a caller shaping its own payload. */
    const profilePatch: {
      employee_code?: string;
      designation?: string;
      department_id?: string | null;
      reports_to?: string | null;
      track?: "STAFF" | "WORKER";
      date_of_joining?: string;
    } = {};
    if (patch.employee_code !== undefined) profilePatch.employee_code = patch.employee_code;
    if (patch.designation !== undefined) profilePatch.designation = patch.designation;
    if (patch.department_id !== undefined) profilePatch.department_id = patch.department_id;
    if (patch.reports_to !== undefined) profilePatch.reports_to = patch.reports_to;
    if (patch.track !== undefined) profilePatch.track = patch.track;
    /* 0024: the ONE joining date, and it lives on `profiles`. Moving it fires
       the trigger that recomputes the whole increment schedule (P19B-2), which
       is why it is not also written to `employment_records` here. */
    if (patch.date_of_joining !== undefined) profilePatch.date_of_joining = patch.date_of_joining;

    if (Object.keys(profilePatch).length > 0) {
      const { data, error } = await supabase
        .from("profiles")
        .update(profilePatch)
        .eq("id", profileId)
        // The zero-rows class, seventh appearance: an update matching nothing
        // succeeds, and this loop would then count the row as saved.
        .select("id");

      if (error) {
        rows.push({
          profileId,
          ok: false,
          error: /duplicate|unique/i.test(error.message)
            ? "That employee code is already used by somebody else."
            : error.message,
        });
        continue;
      }
      if (!data || data.length === 0) {
        rows.push({ profileId, ok: false, error: "Their record could not be updated." });
        continue;
      }
    }

    /* ---------- The employment record ---------- */
    const employmentPatch: {
      employment_type?: "PERMANENT" | "CONTRACT" | "PROBATION" | "INTERN";
      increment_frequency_months?: number;
    } = {};
    if (employment_type !== undefined) employmentPatch.employment_type = employment_type;
    if (patch.increment_frequency_months !== undefined) {
      employmentPatch.increment_frequency_months = patch.increment_frequency_months;
    }

    if (Object.keys(employmentPatch).length > 0) {
      const { data, error } = await supabase
        .from("employment_records")
        .update(employmentPatch)
        .eq("profile_id", profileId)
        // The zero-rows class again: somebody with no employment record yet
        // matches nothing, and without this the row would report as saved.
        .select("profile_id");
      if (error) {
        rows.push({ profileId, ok: false, error: `Employment could not be updated: ${error.message}` });
        continue;
      }
      if (!data || data.length === 0) {
        rows.push({
          profileId,
          ok: false,
          error: "They have no employment record yet. Open their Employment tab and add their joining details first.",
        });
        continue;
      }
    }

    /* ---------- The joining salary, through 0069's function ----------
          NOT an update. It is the baseline every stored percentage was computed
          against (P19E-1), so the function refuses to overwrite one that
          already exists, seeds `current_ctc` only where there is no revision,
          and records who entered it. All of that would have to be restated here
          to write the column directly, and the copy that is never exercised is
          the one that drifts. */
    if (patch.joining_ctc !== undefined) {
      const { error } = await supabase.rpc("set_joining_salary", {
        p_profile_id: profileId,
        p_amount: patch.joining_ctc,
      });
      if (error) {
        rows.push({ profileId, ok: false, error: error.message });
        continue;
      }
    }

    /* ---------- The pay change, through the one path that may make one ---------- */
    if (current_ctc !== undefined) {
      const result = await addSalaryChange({
        profileId,
        newCtc: current_ctc,
        effectiveFrom: salaryEffectiveFrom as string,
        reason: salaryReason as "ANNUAL_INCREMENT" | "PROMOTION" | "CORRECTION" | "MARKET_ADJUSTMENT",
        note: salaryNote,
      });
      if (!result.ok) {
        rows.push({ profileId, ok: false, error: result.error.message });
        continue;
      }
      salaryChanges += 1;
    }

    updated += 1;
    rows.push({ profileId, ok: true });
  }

  /* -- §12, and NO FIGURE in the diff (§5, P19-10). A lead can read `audit_log`
        for their own reports (0013), so a CTC there would walk straight past the
        salary-confinement invariant. The row records WHICH fields moved and how
        many pay changes were filed — never an amount. -- */
  await supabase.rpc("log_admin_action", {
    p_entity: "profile",
    p_entity_id: auth.session.profile.id,
    p_action: "people.bulk_edited",
    p_diff: {
      people: patches.length,
      succeeded: updated,
      salary_changes: salaryChanges,
      fields: Array.from(
        new Set(patches.flatMap((p) => Object.keys(p).filter((k) => k !== "profileId"))),
      ),
    } as Json,
  });

  revalidatePath("/admin/settings");
  revalidatePath("/admin/people");
  revalidatePath("/admin/increments");

  return { ok: true, data: { updated, salaryChanges, rows } };
}
