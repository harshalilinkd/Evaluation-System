"use server";

/** Edit many people at once, from the roster grid. HR and the MD. */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { checkRole } from "@/lib/auth/guards";
import { cycleError, type CycleResult } from "@/lib/cycles/schema";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

// One alias, used everywhere a reason is cast below — the schema's own enum
// and this type must list the same five values, and a third repetition is
// the one that drifts.

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
  /* -- THE NAME AND THE CONTACT PAIRS, so every profile column the grid SHOWS
        is a column the grid can FIX. They were read-only for no reason beyond
        not having been added — F25-1 built the grid around employment fields
        and the personal ones were never brought across.

        THE LOGIN EMAIL IS DELIBERATELY NOT HERE, and that is the one absence
        worth stating. `profiles.email` mirrors the auth account; changing it
        means changing how somebody signs in, which is an Admin API call, not a
        column write — `updatePerson` does not write it either. A cell that
        looked editable and silently wrote nothing is the failure class this
        log has recorded nine times, so it stays read-only until the auth half
        is built with it. -- */
  full_name: z.string().trim().min(2, "Enter their full name").max(120).optional(),
  /* -- Normalised to E.164 server-side, below — `normaliseToE164` is
        `server-only` and returns a structured reason, so a refusal can say WHAT
        is wrong rather than just "invalid" (P11-12). Empty is allowed here and
        checked against CONTACT-1 afterwards, because whether a blank is legal
        depends on which team they are on. -- */
  phone: z.string().trim().max(20).optional(),
  work_email: z.string().trim().max(160).optional(),
  work_phone: z.string().trim().max(20).optional(),
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
  /* -- When probation ends (0023's `confirmation_date`).
        NULLABLE where the others are not: it is optional, so clearing the cell
        has to mean "there is no such date" rather than being ignored. An empty
        string is what an emptied date input sends, and it is normalised to null
        below. Nothing is derived from it, so moving or clearing it changes no
        schedule and no figure. -- */
  confirmation_date: z.string().nullable().optional(),
  increment_frequency_months: z.coerce.number().int().min(1).max(60).optional(),
  joining_ctc: z.number().positive().max(100_000_000).optional(),
  /* -- NO SALARY KEY (0109). A salary is joining + every rise to date, so
        there is nothing here to set: a caller shaping its own payload cannot
        reach past the ledger and write the sum directly. Rises are recorded
        through `record_increment`, which is the one implementation. -- */
});

const bulkSchema = z.object({
  patches: z.array(cellPatchSchema).min(1, "Nothing was changed.").max(200),
  /* -- NO SALARY MODE, REASON, DATE OR NOTE. They existed because a cell
        here could move somebody pay; none of them has anything left to
        describe now that a rise is recorded where the ledger is (0109). -- */
});

export type BulkRowOutcome = { profileId: string; ok: boolean; error?: string };

export type BulkEditResult = {
  updated: number;
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
  const { patches } = parsed.data;

  const supabase = await createClient();
  const rows: BulkRowOutcome[] = [];
  let updated = 0;

  for (const patch of patches) {
    const { profileId, employment_type } = patch;

    /* ---------- The person's own details ----------
          Built key by key rather than through `Object.fromEntries`, which
          produces a loose index signature that PostgREST's generated types
          reject outright. Naming the four columns also means a fifth cannot be
          smuggled in by a caller shaping its own payload. */
    const profilePatch: {
      employee_code?: string;
      full_name?: string;
      phone_e164?: string | null;
      work_email?: string | null;
      // The COLUMN is `work_phone_e164` (0081). The patch key stays `work_phone`
      // because that is what the grid's header calls it; only one of the two is
      // free to differ, and it is not the column (P8P-1).
      work_phone_e164?: string | null;
      designation?: string;
      department_id?: string | null;
      reports_to?: string | null;
      track?: "STAFF" | "WORKER";
      date_of_joining?: string;
    } = {};
    if (patch.employee_code !== undefined) profilePatch.employee_code = patch.employee_code;
    if (patch.full_name !== undefined) profilePatch.full_name = patch.full_name;

    /* -- BOTH NUMBERS GO THROUGH THE ONE NORMALISER, and a bad one stops that
          person's row rather than storing something §10 cannot send to.
          Blank clears the column — on a grid an emptied cell can only mean
          "there is no such number", which is the opposite of the absent-key
          rule above (an untouched cell sends no key at all). -- */
    const { normaliseToE164 } = await import("@/lib/notify/phone");
    let badNumber = false;
    for (const [key, column] of [
      ["phone", "phone_e164"],
      ["work_phone", "work_phone_e164"],
    ] as const) {
      const typed = patch[key];
      if (typed === undefined) continue;
      if (typed === "") {
        profilePatch[column] = null;
        continue;
      }
      const result = normaliseToE164(typed);
      if (!result.ok) {
        rows.push({
          profileId,
          ok: false,
          error: `That mobile number is not usable: ${result.reason}`,
        });
        badNumber = true;
        break;
      }
      profilePatch[column] = result.e164;
    }
    if (badNumber) continue;

    if (patch.work_email !== undefined) {
      profilePatch.work_email = patch.work_email === "" ? null : patch.work_email;
    }

    if (patch.designation !== undefined) profilePatch.designation = patch.designation;
    if (patch.department_id !== undefined) profilePatch.department_id = patch.department_id;
    if (patch.reports_to !== undefined) profilePatch.reports_to = patch.reports_to;
    if (patch.track !== undefined) profilePatch.track = patch.track;
    /* 0024: the ONE joining date, and it lives on `profiles`. Moving it fires
       the trigger that recomputes the whole increment schedule (P19B-2), which
       is why it is not also written to `employment_records` here. */
    if (patch.date_of_joining !== undefined) profilePatch.date_of_joining = patch.date_of_joining;

    /* -- CONTACT-1, ON THE THIRD SURFACE. A Backend Team person must keep a
          mobile — §10 sends every invite over WhatsApp and/or email, and P28
          records that WhatsApp is the channel that works without SMTP
          configured. The create form refuses a blank and so does the edit
          dialog; a grid cell that let the same number be emptied would be the
          way round both.

          The track is read from the PATCH where it was changed and from the
          record otherwise — clearing the number and moving somebody to
          Production Team in one edit is legal, and judging it on the stored
          track alone would refuse it. Production Team are exempt for the reason
          the schema gives: nothing in the system ever writes to them. -- */
    if (profilePatch.phone_e164 === null) {
      const { data: current } = await supabase
        .from("profiles")
        .select("track")
        .eq("id", profileId)
        .maybeSingle();
      const track = patch.track ?? current?.track ?? "STAFF";
      if (track === "STAFF") {
        rows.push({
          profileId,
          ok: false,
          error: "Enter a mobile number — this is where their form link is sent",
        });
        continue;
      }
    }

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
      confirmation_date?: string | null;
    } = {};
    if (employment_type !== undefined) employmentPatch.employment_type = employment_type;
    if (patch.increment_frequency_months !== undefined) {
      employmentPatch.increment_frequency_months = patch.increment_frequency_months;
    }
    if (patch.confirmation_date !== undefined) {
      /* An emptied date input sends "", and Postgres will not take that for a
         `date`. Empty means "no such date", which is null. */
      employmentPatch.confirmation_date = patch.confirmation_date || null;
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

    /* -- THE PAY CHANGE IS NO LONGER MADE FROM HERE (0109).
          A salary is joining + every rise to date, so this sheet has nothing
          to set: it used to take a typed figure and append a rise of the
          difference, which worked and meant the same number could be stated in
          two places. Rises are recorded on Settings > Salary history or a
          persons own Employment page, both through record_increment. -- */

    updated += 1;
    rows.push({ profileId, ok: true });
  }

  /* -- §12, and NO FIGURE in the diff (§5, P19-10). A lead can read `audit_log`
        for their own reports (0013), so a CTC there would walk straight past the
        salary-confinement invariant. The row records WHICH fields moved and how
        moved — and there is no amount anywhere in it to leak. -- */
  await supabase.rpc("log_admin_action", {
    p_entity: "profile",
    p_entity_id: auth.session.profile.id,
    p_action: "people.bulk_edited",
    p_diff: {
      people: patches.length,
      succeeded: updated,
      fields: Array.from(
        new Set(patches.flatMap((p) => Object.keys(p).filter((k) => k !== "profileId"))),
      ),
    } as Json,
  });

  revalidatePath("/admin/settings");
  revalidatePath("/admin/people");
  revalidatePath("/admin/increments");

  return { ok: true, data: { updated, rows } };
}
