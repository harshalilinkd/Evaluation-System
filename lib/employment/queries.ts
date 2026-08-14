/** Employment and compensation reads. HR_ADMIN and MD only (§5, §9). */

import "server-only";

import { cycleError, type CycleResult } from "@/lib/cycles/schema";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";

export type EmploymentRecord = Tables<"employment_records">;
export type SalaryRow = Tables<"salary_history">;

export type EmploymentDetail = {
  record: EmploymentRecord | null;
  /** From `profiles` — the ONE joining date (0024). */
  dateOfJoining: string | null;
  history: Array<SalaryRow & { recordedByName: string | null }>;
  /** Who recorded the joining salary (0044). Null where it predates the column. */
  joiningRecordedByName: string | null;
  /** Plain-words reminder line: "HR will be reminded on 14-07-2026." */
  remindOn: string | null;
};

/**
 * One person's employment record and pay history.
 *
 * There is no role check here, and that is deliberate rather than an oversight:
 * every read goes through the authenticated client, and 0023's policies admit
 * only HR and the MD. A HOD calling this gets an empty result rather than an
 * error — which is the right failure, because an error would confirm the row
 * exists. The route adds a guard on top for a clean redirect (P16-9).
 */
export async function getEmployment(profileId: string): Promise<CycleResult<EmploymentDetail>> {
  const supabase = await createClient();

  const [{ data: record }, { data: profile }, { data: history }, { data: reminder }] = await Promise.all([
    supabase.from("employment_records").select("*").eq("profile_id", profileId).maybeSingle(),
    supabase.from("profiles").select("date_of_joining").eq("id", profileId).maybeSingle(),
    supabase
      .from("salary_history")
      .select("*")
      .eq("profile_id", profileId)
      /* -- OLDEST FIRST, because the table it feeds begins with the JOINING
            SALARY and that is the oldest row of all.
            Newest-first was defensible on its own — the current figure is what
            somebody opens this to see — and stopped being so once the baseline
            was rendered above it (0043). The table then read 2023, 2026, 2025:
            a first row older than everything and the rest descending, which is
            not an order at all.
            FIX-31 made exactly this change to the salary band on the report and
            left this query, its sibling, behind. -- */
      .order("effective_from", { ascending: true })
      .order("recorded_at", { ascending: true }),
    supabase
      .from("increment_reminders")
      .select("remind_on")
      .eq("profile_id", profileId)
      .eq("status", "PENDING")
      .order("remind_on")
      .limit(1)
      .maybeSingle(),
  ]);

  const rows = history ?? [];
  /* -- The joining recorder rides the SAME lookup.
        It is one more id against the same table; a second query for one name
        would be a round trip bought for nothing. -- */
  const recorderIds = [
    ...new Set(
      [...rows.map((r) => r.recorded_by), record?.joining_ctc_recorded_by].filter(
        (v): v is string => Boolean(v),
      ),
    ),
  ];

  const { data: recorders } = recorderIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", recorderIds)
    : { data: [] };
  const nameOf = new Map((recorders ?? []).map((p) => [p.id, p.full_name]));

  /* -- SINCE WHEN THEY HAVE BEEN ON TODAY'S FIGURE.
        `employment_records.salary_effective_from` is the stored answer and is
        maintained by every write path — 0066 backfilled it, 0068 keeps it in
        step with the ledger, and `apply_salary_to_record` sets it whenever a
        change is recorded.

        It can still be NULL: a record imported before those landed, or one
        whose pay history was written by a path that predates them. And a null
        there renders an em dash directly above a table that plainly shows the
        date — a screen contradicting itself.

        So it falls back to the ledger, which is the authoritative record and is
        already loaded here. Same rows, so the readout and the table below it
        cannot disagree. JOINING is excluded because it is the baseline rather
        than a change (P19E-1), and the newest by DATE wins, so a backdated
        correction does not claim to be today's figure (P19-9). -- */
  const newestRise = [...rows]
    .filter((r) => r.reason !== "JOINING")
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];

  return {
    ok: true,
    data: {
      record: record
        ? {
            ...record,
            salary_effective_from:
              record.salary_effective_from ?? newestRise?.effective_from ?? null,
          }
        : null,
      dateOfJoining: profile?.date_of_joining ?? null,
      joiningRecordedByName: record?.joining_ctc_recorded_by
        ? (nameOf.get(record.joining_ctc_recorded_by) ?? null)
        : null,
      history: rows.map((r) => ({
        ...r,
        recordedByName: r.recorded_by ? (nameOf.get(r.recorded_by) ?? null) : null,
      })),
      remindOn: reminder?.remind_on ?? null,
    },
  };
}

export type IncrementDue = {
  profileId: string;
  name: string;
  employeeCode: string | null;
  departmentName: string | null;
  dateOfJoining: string;
  lastIncrementDate: string | null;
  nextIncrementDate: string;
  daysRemaining: number;
  /* -- §7's module. A staff increment CYCLE can only include Backend Team —
        production workers are appraised on their own rounds — so a screen
        offering to start one has to know which of these people it could
        actually put in it. Without this the calendar counted 8 and the wizard
        could select 3, and the button over-promised by five. -- */
  track: string;
  currentCtc: number | null;
  monthsSinceLast: number | null;
};

export type IncrementCalendar = {
  rows: IncrementDue[];
  dueThisMonth: number;
  dueNextMonth: number;
  overdue: number;
  /* -- The two month keys the counts above were computed FROM.
        Returned rather than recomputed on the screen: the tiles filter by
        exactly the string their own number came from, so a count and the list
        behind it cannot disagree — which they could across midnight, or with a
        browser in a different zone from the server (§0.10 pins Asia/Kolkata for
        the app; a client `new Date()` obeys the laptop). -- */
  thisMonth: string;
  nextMonth: string;
  next90: number;
};

/** Whole days from today to `date`, negative once it has passed. */
function daysUntil(date: string): number {
  const then = new Date(`${date}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((then.getTime() - today.getTime()) / 86_400_000);
}

function monthsBetween(from: string | null): number | null {
  if (!from) return null;
  const a = new Date(`${from}T00:00:00`);
  const b = new Date();
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

/**
 * The increment calendar. HR's planning screen.
 *
 * Everything overdue is included as well as everything ahead: an increment that
 * slipped last month is the most urgent thing on this screen, and a window that
 * only looks forward would hide it.
 */
export async function getIncrementCalendar(): Promise<CycleResult<IncrementCalendar>> {
  const supabase = await createClient();

  const { data: records, error } = await supabase
    .from("employment_records")
    .select("profile_id, last_increment_date, next_increment_date, current_ctc")
    .not("next_increment_date", "is", null)
    .order("next_increment_date");

  if (error) return cycleError("QUERY_FAILED", `Could not read employment records: ${error.message}`);

  /* -- Hoisted, because the empty-calendar return needs these as well.
        They are the two month keys the counts are computed from and the tiles
        filter by, so both paths must carry them. -- */
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonth = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}`;

  const ids = (records ?? []).map((r) => r.profile_id);
  if (ids.length === 0) {
    return {
      ok: true,
      data: { rows: [], dueThisMonth: 0, dueNextMonth: 0, overdue: 0, next90: 0, thisMonth, nextMonth },
    };
  }

  const [{ data: people }, { data: departments }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, employee_code, department_id, is_active, date_of_joining, track")
      .in("id", ids),
    supabase.from("departments").select("id, name"),
  ]);

  const person = new Map((people ?? []).map((p) => [p.id, p]));
  const deptName = new Map((departments ?? []).map((d) => [d.id, d.name]));

  const rows: IncrementDue[] = [];
  for (const r of records ?? []) {
    const p = person.get(r.profile_id);
    // Somebody who has left keeps their record and their history, but they are
    // not due an increment (P4-5).
    if (!p || !p.is_active || !r.next_increment_date) continue;

    rows.push({
      profileId: r.profile_id,
      name: p.full_name,
      employeeCode: p.employee_code,
      departmentName: p.department_id ? (deptName.get(p.department_id) ?? null) : null,
      dateOfJoining: p.date_of_joining ?? "",
      lastIncrementDate: r.last_increment_date,
      nextIncrementDate: r.next_increment_date,
      track: p.track ?? "STAFF",
      daysRemaining: daysUntil(r.next_increment_date),
      currentCtc: r.current_ctc,
      monthsSinceLast: monthsBetween(r.last_increment_date ?? p.date_of_joining),
    });
  }

  rows.sort((a, b) => a.nextIncrementDate.localeCompare(b.nextIncrementDate));

  return {
    ok: true,
    data: {
      rows,
      dueThisMonth: rows.filter((r) => r.nextIncrementDate.startsWith(thisMonth) && r.daysRemaining >= 0).length,
      dueNextMonth: rows.filter((r) => r.nextIncrementDate.startsWith(nextMonth)).length,
      overdue: rows.filter((r) => r.daysRemaining < 0).length,
      next90: rows.filter((r) => r.daysRemaining >= 0 && r.daysRemaining <= 90).length,
      thisMonth,
      nextMonth,
    },
  };
}

/**
 * How many people whose increment is due are on the PRODUCTION team.
 *
 * A staff increment cycle cannot include them — §7 gives the worker module its
 * own rounds, its own tick sheet and its own salary block — so the wizard shows
 * fewer people than the button that opened it promised. This is what lets it
 * SAY so, with a number, instead of leaving HR to work out where five people
 * went.
 *
 * Counted from the same calendar and the same predicate the button uses, so the
 * two cannot drift apart into a sentence that does not add up.
 */
export async function workersDueForIncrement(): Promise<number> {
  const calendar = await getIncrementCalendar();
  if (!calendar.ok) return 0;
  const { rows, thisMonth, nextMonth } = calendar.data;
  return rows.filter(
    (r) =>
      r.track === "WORKER" &&
      (r.daysRemaining < 0 ||
        r.nextIncrementDate.startsWith(thisMonth) ||
        r.nextIncrementDate.startsWith(nextMonth)),
  ).length;
}
