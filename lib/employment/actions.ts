"use server";

/** Employment and compensation writes. Every one is role-gated and audited. */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { checkRole } from "@/lib/auth/guards";
import { parseCsv, toIsoDate } from "@/lib/auth/csv";
import { cycleError, type CycleResult } from "@/lib/cycles/schema";
import { employmentRowSchema, type EmploymentPreviewRow } from "@/lib/employment/import";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

/* ---------- Guards ---------- */
//
// AMEND-2 un-merged the roles and retired `is_admin()` for every salary gate.
// These name the specific role §9 gives each power: HR edits the record, HR and
// the MD may both append pay history.

async function requireHr() {
  const auth = await checkRole(["HR_ADMIN"]);
  if (!auth.ok) return cycleError("FORBIDDEN", auth.error.message);
  return { ok: true as const, session: auth.session };
}

async function requireHrOrMd() {
  const auth = await checkRole(["HR_ADMIN", "MD"]);
  if (!auth.ok) return cycleError("FORBIDDEN", auth.error.message);
  return { ok: true as const, session: auth.session };
}

/* ---------- Employment record ---------- */

const employmentSchema = z.object({
  profileId: z.string().uuid(),
  dateOfJoining: z.string().min(1, "A joining date is required"),
  confirmationDate: z.string().nullable().optional(),
  lastIncrementDate: z.string().nullable().optional(),
  incrementFrequencyMonths: z.coerce.number().int().min(1).max(60).default(12),
  // Coerced, so a form may send the string an <input type="number"> produces.
  employmentType: z.enum(["PERMANENT", "PROBATION", "CONTRACT", "TRAINEE"]),
  // `next_increment_date` is absent on purpose: it is derived by trigger, and a
  // field here would be a second implementation of the rule.
});

export async function saveEmployment(
  input: Omit<z.input<typeof employmentSchema>, "incrementFrequencyMonths"> & {
    incrementFrequencyMonths: string | number;
  },
): Promise<CycleResult<{ profileId: string }>> {
  const auth = await requireHr();
  if (!auth.ok) return auth;

  const parsed = employmentSchema.safeParse(input);
  if (!parsed.success) {
    return cycleError("INVALID", parsed.error.issues[0]?.message ?? "Check the highlighted fields.");
  }
  const v = parsed.data;
  const supabase = await createClient();

  const { data: before } = await supabase
    .from("employment_records")
    .select("*")
    .eq("profile_id", v.profileId)
    .maybeSingle();

  /* -- 0024: the joining date belongs to `profiles`, and only there. Written
        first, because the increment trigger on `employment_records` reads it. -- */
  const { error: joiningError } = await supabase
    .from("profiles")
    .update({ date_of_joining: v.dateOfJoining })
    .eq("id", v.profileId);

  if (joiningError) {
    return cycleError("SAVE_FAILED", `Could not save the joining date: ${joiningError.message}`);
  }

  const row = {
    profile_id: v.profileId,
    confirmation_date: v.confirmationDate || null,
    last_increment_date: v.lastIncrementDate || null,
    increment_frequency_months: v.incrementFrequencyMonths,
    employment_type: v.employmentType,
  };

  // `profile_id` is the primary key and is not in the Update type — it is what
  // identifies the row, not something an update may move.
  const { profile_id: _pk, ...updatable } = row;

  const { error } = before
    ? await supabase.from("employment_records").update(updatable).eq("profile_id", v.profileId)
    : await supabase.from("employment_records").insert(row);

  if (error) return cycleError("SAVE_FAILED", `Could not save the employment record: ${error.message}`);

  // §12. The diff carries dates and the employment type — never a salary figure,
  // because audit_log is readable by the lead for their own reports (0013).
  await supabase.rpc("log_admin_action", {
    p_entity: "employment_record",
    p_entity_id: v.profileId,
    p_action: before ? "employment.updated" : "employment.created",
    p_diff: {
      before: before
        ? {
            confirmation_date: before.confirmation_date,
            last_increment_date: before.last_increment_date,
            increment_frequency_months: before.increment_frequency_months,
            employment_type: before.employment_type,
          }
        : null,
      after: row,
    } as Json,
  });

  revalidatePath("/admin/people");
  revalidatePath("/admin/increments");
  return { ok: true, data: { profileId: v.profileId } };
}

/* ---------- Salary change ---------- */

const salarySchema = z.object({
  profileId: z.string().uuid(),
  effectiveFrom: z.string().min(1, "An effective-from date is required"),
  newCtc: z.coerce.number().positive("The new CTC must be greater than zero"),
  /* -- JOINING IS NOT A REVISION, so it is not on this list.
        A joining salary is the baseline of the ledger, not a change to it, and
        it lives in `employment_records.joining_ctc` where it cannot be
        duplicated and cannot be compared against anything. Leaving it here let
        somebody file "the first salary this person was ever paid" as a rise
        over the salary they are on today — which is how a 620% hike got
        written. `setJoiningSalary` below is its own path. -- */
  reason: z.enum(["ANNUAL_INCREMENT", "PROMOTION", "CORRECTION", "MARKET_ADJUSTMENT"]),
  /* -- OPTIONAL, at the owner's explicit instruction. This reverses P19-8,
        which made it required on the reasoning that "optional would mean
        usually blank, and a pay change with no explanation is the thing
        somebody has to reconstruct from memory two years later."

        That reasoning has not stopped being true, so the trade is recorded
        rather than absorbed: the `reason` is still required and still carries
        most of the meaning (a promotion explains itself), and `recorded_by` and
        `effective_from` still say who and when. What is lost is the sentence
        that distinguishes two promotions on the same day.

        An empty string is stored as NULL rather than "": the history renders an
        em dash for a missing note, and a blank string would render as nothing
        at all and read as a rendering fault. -- */
  note: z
    .string()
    .trim()
    .max(500, "Keep the note under 500 characters")
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null)),
  evaluationId: z.string().uuid().nullable().optional(),
});

/**
 * Appends to salary_history and moves current_ctc.
 *
 * The previous figure, the hike and the percentage are all COMPUTED here from
 * the record, never accepted from the caller: a client that could send its own
 * `previous_ctc` could write a history that disagrees with the record it came
 * from, and the whole point of this table is that it is evidence.
 */
/* ---------- The joining salary ---------- */

const joiningSalarySchema = z.object({
  profileId: z.string().uuid(),
  /* -- The amount, and nothing else.
        No effective date: 0024 made `profiles.date_of_joining` the ONE joining
        date, and a salary form that could move it would silently reschedule
        somebody's increments (P19B-2's trigger fires on that column). The form
        shows the date; it does not own it.

        No reason: there is only one reason a joining salary exists. A dropdown
        with one option is a control that cannot be got wrong and still asks to
        be read.

        No hike: this is the baseline everything else is measured FROM. -- */
  amount: z.coerce
    .number()
    .positive("A joining salary has to be more than zero.")
    .max(100_000_000, "That looks too large — check the figure."),
});

/**
 * Record what somebody was paid when they joined.
 *
 * SEPARATE FROM `addSalaryChange`, AND THAT IS THE POINT. A joining salary is
 * not a revision: it is the line every revision is measured against. Routing it
 * through the revision path is what produced a 620% rise on the first salary a
 * person was ever paid — the figure was compared against the salary they are on
 * TODAY, because that is the only thing a revision knows how to do.
 *
 * WRITES ONE COLUMN, and appends NOTHING to `salary_history`. So filling this
 * in months later, after several revisions are already recorded, cannot alter a
 * single stored row or percentage. That is the whole reason the baseline is a
 * column rather than a row.
 *
 * `current_ctc` is initialised only when there is no revision history AND no
 * figure already there. Somebody who joined on ₹1,80,000 and has had no rise
 * IS on ₹1,80,000, so leaving their current salary blank would be false — but
 * where a revision exists, `current_ctc` is that revision and this must not
 * touch it.
 */
export async function addJoiningSalary(input: {
  profileId: string;
  amount: number | string;
}): Promise<CycleResult<{ ok: true }>> {
  const auth = await checkRole(["HR_ADMIN", "MD"]);
  if (!auth.ok) return auth;

  const parsed = joiningSalarySchema.safeParse(input);
  if (!parsed.success) {
    return cycleError("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Check the amount.");
  }
  const v = parsed.data;
  const supabase = await createClient();

  /* -- THROUGH `record_joining_salary` (0069), NOT A BARE UPDATE.

        `employment: hr updates` (0023) is `using (public.is_hr())`, and the
        guard above admits the MD. So the MD passed the guard, the UPDATE matched
        ZERO ROWS, and PostgREST reports zero rows as SUCCESS — the dialog closed
        and nothing was written. That is what "joining salary not getting saved"
        was, and it is the fourth appearance of this class after FIX-14, the
        worker sheet and 0066.

        Note the asymmetry that makes it so hard to spot: an INSERT refused by
        RLS raises 42501 and the caller reports it. An UPDATE that matches
        nothing cannot fail. Only the second kind is silent.

        The immutability check, the "does a revision exist" count and the
        `current_ctc` decision all moved INTO the function — it is granted to
        `authenticated`, so any of them left out here would be a rule the caller
        could choose to skip (P9D-3). -- */
  const { data: outcome, error } = await supabase.rpc("record_joining_salary", {
    p_profile_id: v.profileId,
    p_amount: v.amount,
  });

  if (error) {
    // The function raises a sentence somebody can act on for each refusal —
    // no employment record, already recorded, not entitled — so it is passed
    // through rather than replaced with a generic failure (§0.7).
    return cycleError("SAVE_FAILED", error.message);
  }

  const seeded = (outcome as { seeded_current?: boolean } | null)?.seeded_current === true;

  // §12, and NO FIGURE in the diff (P19-10). A lead can read audit_log for
  // their own reports (0013), so a salary there would walk past §5.
  await supabase.rpc("log_admin_action", {
    p_entity: "employment",
    p_entity_id: v.profileId,
    p_action: "salary.joining_recorded",
    p_diff: { seeded_current: seeded } as Json,
  });

  revalidatePath(`/admin/people/${v.profileId}/employment`);
  revalidatePath("/admin/increments");
  return { ok: true, data: { ok: true } };
}

export async function addSalaryChange(
  input: Omit<z.input<typeof salarySchema>, "newCtc"> & { newCtc: string | number },
): Promise<CycleResult<{ id: string }>> {
  const auth = await requireHrOrMd();
  if (!auth.ok) return auth;

  const parsed = salarySchema.safeParse(input);
  if (!parsed.success) {
    return cycleError("INVALID", parsed.error.issues[0]?.message ?? "Check the highlighted fields.");
  }
  const v = parsed.data;
  const supabase = await createClient();

  const { data: record } = await supabase
    .from("employment_records")
    .select("current_ctc, joining_ctc")
    .eq("profile_id", v.profileId)
    .maybeSingle();

  if (!record) {
    return cycleError(
      "NO_RECORD",
      "This person has no employment record yet. Add their joining details first.",
    );
  }

  /* -- WHAT CAME BEFORE THIS DATE — not what is being paid today.
        This read `record.current_ctc`, which is the CURRENT figure whatever
        date the new row carries. So recording a joining salary AFTER a later
        raise had already been entered produced: previous = the later raise,
        and a hike computed backwards. A ₹25,000 raise recorded first, then a
        ₹1,80,000 joining salary dated nine months earlier, came out as a 620%
        increase — a number that is not wrong by a rounding error, it is
        describing an event that never happened, in the one table whose whole
        job is to be evidence (P19-7).

        The code twenty lines below already got this right for the OTHER half
        of the same question: `supersedes` refuses to move today's figure when
        the row is backdated. The two now reason the same way.

        Strictly EARLIER, not on-or-before: a row effective the same day is not
        what came before this one, and treating it as such would let two entries
        made on one date each claim the other as their predecessor. -- */
  const { data: preceding } = await supabase
    .from("salary_history")
    .select("new_ctc")
    .eq("profile_id", v.profileId)
    // Legacy JOINING rows are excluded: the baseline is the column now, and
    // counting an old row as well would measure a revision against the same
    // figure twice depending on which was written first.
    .neq("reason", "JOINING")
    .lt("effective_from", v.effectiveFrom)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  /* -- A joining salary has nothing before it, by definition.
        Belt and braces over the date lookup, for the case that produced this
        report: HR entering history out of order. If somebody mis-dates a
        joining salary after an existing row, the lookup would find a
        predecessor and compute a hike for the first salary somebody was ever
        paid, which is nonsense whatever the dates say. -- */
  /* -- THE BASELINE IS THE FALLBACK.
        First revision after joining → measured against `joining_ctc`, which is
        what somebody actually started on. Every later one → against the
        revision immediately before it. That is the spec and it is also just
        how a pay ledger reads: each line explains itself against the line
        above, and the top line is what they joined on.

        Null only when there is neither — a person with no baseline recorded and
        no history. The row still stands as "this is the salary from this date",
        with the hike left null rather than invented (P19D-6). -- */
  const previous =
    preceding?.new_ctc !== null && preceding?.new_ctc !== undefined
      ? Number(preceding.new_ctc)
      : record.joining_ctc !== null && record.joining_ctc !== undefined
        ? Number(record.joining_ctc)
        : null;
  const hikeAmount = previous === null ? null : Math.round((v.newCtc - previous) * 100) / 100;
  const hikePct =
    previous === null || previous === 0
      ? null
      : Math.round(((v.newCtc - previous) / previous) * 10000) / 100;

  const { data: inserted, error } = await supabase
    .from("salary_history")
    .insert({
      profile_id: v.profileId,
      effective_from: v.effectiveFrom,
      previous_ctc: previous,
      new_ctc: v.newCtc,
      hike_amount: hikeAmount,
      hike_pct: hikePct,
      reason: v.reason,
      evaluation_id: v.evaluationId ?? null,
      recorded_by: auth.session.profile.id,
      note: v.note,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    return cycleError("SAVE_FAILED", `Could not record the salary change: ${error?.message ?? ""}`);
  }

  /* -- The record follows the history, through 0066's function.

        THIS USED TO BE A BARE `.update()` HERE, and it had two faults.

        It never touched `last_increment_date`, so recording an annual
        increment moved the pay and left the increment cycle where it was —
        and `next_increment_date` is derived from that column, so the calendar
        and the nightly sweep went on chasing the old date. That is the bug
        this was reported as.

        And `employment: hr updates` (0023) is `using (is_hr())`, so for the MD
        the update matched ZERO ROWS — which PostgREST reports as success. The
        ledger gained a row, the record kept a null figure, and the screen said
        it had worked. Third appearance of that class (FIX-14, the worker
        sheet); a write that cannot fail is not a write.

        One function now moves both, or neither. The result is READ, so a
        refusal is a refusal rather than a silence. -- */
  const { error: applyError } = await supabase.rpc("apply_salary_to_record", {
    p_profile_id: v.profileId,
    p_new_ctc: v.newCtc,
    p_effective_from: v.effectiveFrom,
    p_reason: v.reason,
  });

  if (applyError) {
    /* -- The ledger row is already in and cannot be taken out — salary_history
          is append-only by trigger for every caller (P19-3). So this reports
          precisely what happened rather than pretending nothing did: the entry
          stands, the record did not follow it. -- */
    return cycleError(
      "RECORD_NOT_UPDATED",
      `The pay entry was recorded, but their employment record could not be updated: ${applyError.message}`,
    );
  }

  // §12, and NO FIGURES in the diff. audit_log is readable by a lead for their
  // own reports (0013), so a salary in a diff would walk straight past §5's
  // confinement invariant. The row id is enough to find the record.
  await supabase.rpc("log_admin_action", {
    p_entity: "salary_history",
    p_entity_id: inserted.id,
    p_action: "salary.recorded",
    p_diff: {
      after: { profile_id: v.profileId, reason: v.reason, effective_from: v.effectiveFrom },
    } as Json,
  });

  revalidatePath("/admin/people");
  revalidatePath("/admin/increments");
  return { ok: true, data: { id: inserted.id } };
}

/* ---------- Bulk import (P19) ---------- */

/**
 * Validate a CSV without writing anything.
 *
 * The brief asks for a preview table with per-row errors, and the preview has to
 * be produced by the same code that will do the writing — a preview built by a
 * second, more forgiving parser is a preview that lies. `commitEmploymentImport`
 * re-runs this and refuses if anything is wrong, so the screen cannot talk the
 * server into accepting a row it just showed as broken.
 */
export async function previewEmploymentImport(
  csvText: string,
  fileName: string,
): Promise<CycleResult<{ rows: EmploymentPreviewRow[]; valid: number; fileName: string }>> {
  const auth = await requireHr();
  if (!auth.ok) return auth;
  return buildEmploymentPreview(csvText, fileName);
}

async function buildEmploymentPreview(
  csvText: string,
  fileName: string,
): Promise<CycleResult<{ rows: EmploymentPreviewRow[]; valid: number; fileName: string }>> {
  const table = parseCsv(csvText);
  const [headerRow, ...body] = table;

  if (!headerRow) return cycleError("EMPTY_FILE", "That file is empty.");

  const headers = headerRow.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  if (!headers.includes("employee_code")) {
    return cycleError(
      "NO_KEY_COLUMN",
      "The file has no employee_code column. Download the template and use its header row.",
    );
  }

  const records = body
    // A row of nothing but commas is what a spreadsheet leaves below the data.
    .filter((cells) => cells.some((cell) => cell.trim() !== ""))
    .map((cells) => {
      const record: Record<string, string> = {};
      headers.forEach((header, index) => {
        record[header] = (cells[index] ?? "").trim();
      });
      return record;
    });

  if (records.length === 0) return cycleError("EMPTY_FILE", "That file has a header row but no people in it.");
  if (records.length > 1000) {
    return cycleError("TOO_MANY", `That file has ${records.length} rows. Import 1000 at a time.`);
  }

  const supabase = await createClient();
  const { data: people } = await supabase
    .from("profiles")
    .select("id, full_name, employee_code")
    .not("employee_code", "is", null);

  const byCode = new Map<string, { id: string; name: string }>();
  for (const p of people ?? []) {
    if (p.employee_code) {
      byCode.set(p.employee_code.trim().toLowerCase(), { id: p.id, name: p.full_name });
    }
  }

  const rows: EmploymentPreviewRow[] = [];
  const seen = new Set<string>();

  records.forEach((record, index) => {
    const line = index + 2; // +1 for the header, +1 because people count from 1
    const employeeCode = record.employee_code ?? "";

    const parsed = employmentRowSchema.safeParse(record);
    if (!parsed.success) {
      rows.push({ line, employeeCode, error: parsed.error.issues[0]?.message ?? "Invalid row." });
      return;
    }

    const person = byCode.get(employeeCode.trim().toLowerCase());
    if (!person) {
      // This import fills in people who already exist. Creating them from here
      // would mean inventing an email and a password, which is Settings › Users.
      rows.push({
        line,
        employeeCode,
        error: `No employee has the code ${employeeCode}. Add them in Settings › Users first.`,
      });
      return;
    }

    if (seen.has(person.id)) {
      rows.push({ line, employeeCode, name: person.name, error: "This person appears more than once in the file." });
      return;
    }
    seen.add(person.id);

    const joining = toIsoDate(parsed.data.date_of_joining ?? "");
    const lastIncrement = toIsoDate(parsed.data.last_increment_date ?? "");
    if (joining === null || lastIncrement === null) {
      rows.push({ line, employeeCode, name: person.name, error: "A date is not DD-MM-YYYY." });
      return;
    }
    // An increment cannot precede the joining date; a file that says so is a
    // file with two columns swapped, and importing it would set the whole
    // increment schedule wrong.
    if (joining && lastIncrement && lastIncrement < joining) {
      rows.push({
        line,
        employeeCode,
        name: person.name,
        error: "The last increment is before the joining date — check whether two columns are swapped.",
      });
      return;
    }

    rows.push({
      line,
      employeeCode,
      name: person.name,
      value: {
        profile_id: person.id,
        ...(joining ? { date_of_joining: joining } : {}),
        ...(lastIncrement ? { last_increment_date: lastIncrement } : {}),
        ...(parsed.data.current_ctc !== undefined ? { current_ctc: parsed.data.current_ctc } : {}),
        ...(parsed.data.employment_type ? { employment_type: parsed.data.employment_type } : {}),
        ...(parsed.data.increment_frequency_months !== undefined
          ? { increment_frequency_months: parsed.data.increment_frequency_months }
          : {}),
      },
    });
  });

  return { ok: true, data: { rows, valid: rows.filter((r) => r.value).length, fileName } };
}

/**
 * Write the whole file, or none of it.
 *
 * Unlike the user import (P19C-9), all-or-nothing is genuinely achievable here:
 * every write is a database write, so one transaction covers the run. That
 * transaction is `import_employment` — see 0028 for why it is SQL rather than a
 * loop of PostgREST calls.
 */
export async function commitEmploymentImport(
  csvText: string,
  fileName: string,
): Promise<CycleResult<{ rows: number; salaryRows: number }>> {
  const auth = await requireHr();
  if (!auth.ok) return auth;

  // Re-validated server-side rather than trusting a payload the client built
  // from a preview it may have edited. Same file, same rules, same answer.
  const preview = await buildEmploymentPreview(csvText, fileName);
  if (!preview.ok) return preview;

  const bad = preview.data.rows.filter((r) => !r.value);
  if (bad.length > 0) {
    return cycleError(
      "INVALID_ROWS",
      `Nothing was imported. ${bad.length} ${bad.length === 1 ? "row needs" : "rows need"} fixing first.`,
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_employment", {
    p_rows: preview.data.rows.map((r) => r.value) as unknown as Json,
    p_file: fileName,
  });

  if (error) return cycleError("IMPORT_FAILED", `Nothing was imported: ${error.message}`);

  const result = (data ?? {}) as { rows?: number; salary_rows?: number };

  revalidatePath("/admin/increments");
  revalidatePath("/admin/people");

  return { ok: true, data: { rows: result.rows ?? 0, salaryRows: result.salary_rows ?? 0 } };
}
