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

  // /admin/people is a redirect now (Team review moved into Settings); the
  // data it used to serve is read on /admin/settings, so that is what has to
  // be revalidated for the tab to show the change without a manual refresh.
  revalidatePath("/admin/settings");
  revalidatePath("/admin/people");
  revalidatePath("/admin/increments");
  return { ok: true, data: { profileId: v.profileId } };
}

/* -- THE OLD SALARY-CHANGE SCHEMA IS GONE WITH ITS FUNCTION (0109).
      It described a NEW SALARY and derived the rise from it. A salary is now
      joining plus every rise, so the figure that travels is the increment —
      see `incrementSchema` further down. -- */

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

  /* -- THROUGH A FUNCTION, NOT A BARE UPDATE. (0069 first, 0075 now — see the
        note on the call itself for why it moved.)

        `employment: hr updates` (0023) is `using (public.is_hr())`, and the
        guard above admits the MD. So the MD passed the guard, the UPDATE matched
        ZERO ROWS, and PostgREST reports zero rows as SUCCESS — the dialog closed
        and nothing was written. That is what "joining salary not getting saved"
        was, and it is the fourth appearance of this class after FIX-14, the
        worker sheet and 0066.

        Note the asymmetry that makes it so hard to spot: an INSERT refused by
        RLS raises 42501 and the caller reports it. An UPDATE that matches
        nothing cannot fail. Only the second kind is silent.

        The "does a revision exist" count and the `current_ctc` decision both
        live INSIDE the function — it is granted to `authenticated`, so either
        left out here would be a rule the caller could choose to skip (P9D-3).
        The immutability check was the third, and 0075 is what removed it. -- */
  /* -- 0075's FUNCTION, NOT 0069's, AND THAT IS THE WHOLE FIX.

        0069's `record_joining_salary` refuses a SECOND baseline in capitals —
        "once recorded, joining_salary remains static". 0075 reversed that at
        the owner's explicit instruction (F59-8) and shipped
        `set_joining_salary`, which corrects one. The roster's inline editing
        was moved onto it; THIS path was not, so the Employment tab went on
        refusing what the table beside it allowed — two answers to one
        question, and the one that refused is the screen built for the job.

        Reported as "joining salary should be editable": a second attempt here
        was refused, and the only control that then accepted a figure was Add a
        salary change — which records a RISE. That is what "it's taking it as a
        new salary" was. -- */
  const { error } = await supabase.rpc("set_joining_salary", {
    p_profile_id: v.profileId,
    p_amount: v.amount,
  });

  if (error) {
    // The function raises a sentence somebody can act on for each refusal —
    // no employment record, already recorded, not entitled — so it is passed
    // through rather than replaced with a generic failure (§0.7).
    return cycleError("SAVE_FAILED", error.message);
  }

  /* -- NO AUDIT CALL HERE ANY MORE. 0075 writes its own row inside the same
        statement, distinguishing `joining_salary.recorded` from
        `joining_salary.corrected`, and carrying no amount (§5, P19-10) — a lead
        can read `audit_log` for their own reports (0013), so a figure there
        would walk straight past salary confinement. Logging again would put two
        rows on the trail for one act, and the extra one would say less. -- */
  revalidatePath(`/admin/people/${v.profileId}/employment`);
  revalidatePath("/admin/increments");
  return { ok: true, data: { ok: true } };
}

/* -- `addSalaryChange` IS GONE (0109), and that is deliberate rather than
      tidying. It took a NEW SALARY and derived the rise between it and
      whatever preceded the date. A salary is now joining plus every rise, so
      that direction is the wrong way round — and an action of that shape left
      where the next person reaches for it is the landmine this log keeps
      having to remove (P22 had to delete a template for the same reason).
      `recordIncrement` below takes the figure HR states. -- */

/* ---------- Correcting a ledger row in place (0093) ---------- */

const correctionSchema = z.object({
  id: z.string().uuid(),
  // Not sent to the RPC — the function finds the row's own profile itself.
  // Carried only so this action knows which employment page to revalidate,
  // since `id` here is the salary_history row, not the person.
  profileId: z.string().uuid(),
  effectiveFrom: z.string().min(1, "An effective-from date is required"),
  newCtc: z.coerce.number().positive("The salary must be greater than zero"),
  reason: z.enum([
    "ANNUAL_INCREMENT",
    "PROMOTION",
    "CORRECTION",
    "MARKET_ADJUSTMENT",
    "THREE_MONTH_INCREMENT",
  ]),
  note: z
    .string()
    .trim()
    .max(500, "Keep the note under 500 characters")
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null)),
});

/**
 * Corrects an EXISTING `salary_history` row in place — the figure, the date,
 * the reason and the note, on the same row. No row is appended.
 *
 * AT THE OWNER'S EXPLICIT INSTRUCTION (0093). §5's own comment on that
 * migration is the thing to remember here: `salary_history` refuses a raw
 * update or delete for EVERY other caller, including HR through the ordinary
 * table policies. This function is the one door, and it exists because the
 * owner was shown the alternative — append a CORRECTION row and leave the
 * wrong one visible underneath — and asked for the row itself to change
 * instead: "no new row will add, that same row will get corrected."
 *
 * `previous_ctc`/`hike_amount`/`hike_pct` are not fields here, same as every
 * other write in this file (P19-7) — the function recomputes them for the
 * whole chain, not just this row, because correcting one entry can change
 * what every later one should have found as its own predecessor.
 */
export async function correctSalaryHistoryEntry(
  input: Omit<z.input<typeof correctionSchema>, "newCtc"> & { newCtc: string | number },
): Promise<CycleResult<{ figureMoved: boolean; clockMoved: boolean }>> {
  const auth = await requireHrOrMd();
  if (!auth.ok) return auth;

  const parsed = correctionSchema.safeParse(input);
  if (!parsed.success) {
    return cycleError("INVALID", parsed.error.issues[0]?.message ?? "Check the highlighted fields.");
  }
  const v = parsed.data;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("correct_salary_history_entry", {
    p_id: v.id,
    p_new_ctc: v.newCtc,
    p_effective_from: v.effectiveFrom,
    p_reason: v.reason,
    p_note: v.note,
  });

  if (error) {
    // The function raises a sentence somebody can act on for each refusal —
    // not entitled, no such row, the joining row, a bad figure — so it is
    // passed through rather than replaced with a generic failure (§0.7).
    return cycleError("SAVE_FAILED", error.message);
  }

  const result = (data ?? {}) as { figure_moved?: boolean; clock_moved?: boolean };

  // No audit call here — the function writes its own row inside the same
  // statement (`salary.corrected`), carrying no figure (§5, P19-10), the same
  // device 0075's `set_joining_salary` uses for the identical reason.
  revalidatePath("/admin/settings");
  revalidatePath("/admin/people");
  revalidatePath("/admin/increments");
  revalidatePath(`/admin/people/${v.profileId}/employment`);
  return {
    ok: true,
    data: { figureMoved: Boolean(result.figure_moved), clockMoved: Boolean(result.clock_moved) },
  };
}

/* ---------- Recording a rise by its amount (0109) ---------- */

const incrementSchema = z.object({
  profileId: z.string().uuid(),
  effectiveFrom: z.string().min(1, "An effective-from date is required."),
  amount: z.coerce.number().positive("An increment has to be more than zero."),
  reason: z
    .enum(["ANNUAL_INCREMENT", "PROMOTION", "CORRECTION", "MARKET_ADJUSTMENT", "THREE_MONTH_INCREMENT"])
    .default("ANNUAL_INCREMENT"),
  note: z.string().trim().max(500).optional(),
});

/**
 * A rise, stated the way HR states it.
 *
 * `addSalaryChange` above takes a NEW SALARY and derives the rise from what
 * preceded it. This takes the rise and derives the salary. They describe the
 * same event and both end in `rebuild_salary_chain`, so they cannot disagree
 * about what the ledger becomes — but only one of them asks for the figure that
 * is actually written on an increment letter, and this is it (0109).
 *
 * Nothing is computed here. The function is the one implementation of
 * "joining + every rise", and a percentage worked out on this side would be a
 * second answer to the number a pay decision is signed against (P21-2).
 */
export async function recordIncrement(
  input: Omit<z.input<typeof incrementSchema>, "amount"> & { amount: string | number },
): Promise<CycleResult<{ id: string }>> {
  const auth = await requireHrOrMd();
  if (!auth.ok) return auth;

  const parsed = incrementSchema.safeParse(input);
  if (!parsed.success) {
    return cycleError("INVALID", parsed.error.issues[0]?.message ?? "Check the highlighted fields.");
  }
  const v = parsed.data;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("record_increment", {
    p_profile_id: v.profileId,
    p_effective_from: v.effectiveFrom,
    p_amount: v.amount,
    p_reason: v.reason,
    p_note: v.note ?? null,
  });

  if (error) {
    // The function raises a sentence somebody can act on for each refusal —
    // not entitled, no employment record, a rise of nothing — so it is passed
    // through rather than replaced with a generic failure (§0.7).
    return cycleError("SAVE_FAILED", error.message);
  }

  revalidatePath("/admin/settings");
  revalidatePath("/admin/people");
  revalidatePath("/admin/increments");
  revalidatePath(`/admin/people/${v.profileId}/employment`);
  return { ok: true, data: { id: data as string } };
}

/**
 * Correcting a rise that was typed wrong.
 *
 * 0093's `correctSalaryHistoryEntry` corrects a row by the NEW SALARY it
 * produced, and stays — it is a legitimate way to say the same thing and is
 * still what the report's own correction path uses. This one takes the figure
 * the sheet shows. Both end in `rebuild_salary_chain`, so they cannot disagree
 * about what the rest of the ledger becomes.
 *
 * The row's reason and note are deliberately untouched: correcting a mistyped
 * amount is not a reason to rewrite why the rise was given.
 */
export async function correctIncrement(input: {
  id: string;
  profileId: string;
  effectiveFrom: string;
  amount: string | number;
}): Promise<CycleResult<null>> {
  const auth = await requireHrOrMd();
  if (!auth.ok) return auth;

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return cycleError("INVALID", "An increment has to be more than zero.");
  }
  if (!input.effectiveFrom) {
    return cycleError("INVALID", "An effective-from date is required.");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("correct_increment", {
    p_id: input.id,
    p_effective_from: input.effectiveFrom,
    p_amount: amount,
  });
  if (error) return cycleError("SAVE_FAILED", error.message);

  revalidatePath("/admin/settings");
  revalidatePath("/admin/people");
  revalidatePath("/admin/increments");
  revalidatePath(`/admin/people/${input.profileId}/employment`);
  return { ok: true, data: null };
}

/**
 * Removing a rise that describes nothing — a row entered against the wrong
 * person, or an import that filed a salary as an increment.
 *
 * Not a convenience: with no way to remove one, a mis-keyed pay line stays on
 * somebody's record for ever and every later figure is computed against it.
 * §17's "never delete a submitted layer" is about evaluation layers; this is a
 * line that never described anything that happened. The function audits the row
 * before it goes, because afterwards that audit row is the only evidence it
 * existed (F5-3), and refuses one that came from a closed increment cycle.
 */
export async function removeIncrement(input: {
  id: string;
  profileId: string;
}): Promise<CycleResult<null>> {
  const auth = await requireHrOrMd();
  if (!auth.ok) return auth;

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_increment", { p_id: input.id });
  if (error) return cycleError("SAVE_FAILED", error.message);

  revalidatePath("/admin/settings");
  revalidatePath("/admin/people");
  revalidatePath("/admin/increments");
  revalidatePath(`/admin/people/${input.profileId}/employment`);
  return { ok: true, data: null };
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
  revalidatePath("/admin/settings");
  revalidatePath("/admin/people");

  return { ok: true, data: { rows: result.rows ?? 0, salaryRows: result.salary_rows ?? 0 } };
}
