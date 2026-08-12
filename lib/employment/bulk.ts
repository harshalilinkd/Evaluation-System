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
    } = {};
    if (patch.employee_code !== undefined) profilePatch.employee_code = patch.employee_code;
    if (patch.designation !== undefined) profilePatch.designation = patch.designation;
    if (patch.department_id !== undefined) profilePatch.department_id = patch.department_id;
    if (patch.reports_to !== undefined) profilePatch.reports_to = patch.reports_to;

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

    /* ---------- Employment type ---------- */
    if (employment_type !== undefined) {
      const { error } = await supabase
        .from("employment_records")
        .update({ employment_type })
        .eq("profile_id", profileId);
      if (error) {
        rows.push({ profileId, ok: false, error: `Employment could not be updated: ${error.message}` });
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
