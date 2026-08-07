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
      // Newest first: the current figure is what somebody opens this to see.
      .order("effective_from", { ascending: false })
      .order("recorded_at", { ascending: false }),
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
  const recorderIds = [...new Set(rows.map((r) => r.recorded_by).filter((v): v is string => Boolean(v)))];

  const { data: recorders } = recorderIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", recorderIds)
    : { data: [] };
  const nameOf = new Map((recorders ?? []).map((p) => [p.id, p.full_name]));

  return {
    ok: true,
    data: {
      record: record ?? null,
      dateOfJoining: profile?.date_of_joining ?? null,
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
  currentCtc: number | null;
  monthsSinceLast: number | null;
};

export type IncrementCalendar = {
  rows: IncrementDue[];
  dueThisMonth: number;
  dueNextMonth: number;
  overdue: number;
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

  const ids = (records ?? []).map((r) => r.profile_id);
  if (ids.length === 0) {
    return { ok: true, data: { rows: [], dueThisMonth: 0, dueNextMonth: 0, overdue: 0, next90: 0 } };
  }

  const [{ data: people }, { data: departments }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, employee_code, department_id, is_active, date_of_joining")
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
      daysRemaining: daysUntil(r.next_increment_date),
      currentCtc: r.current_ctc,
      monthsSinceLast: monthsBetween(r.last_increment_date ?? p.date_of_joining),
    });
  }

  rows.sort((a, b) => a.nextIncrementDate.localeCompare(b.nextIncrementDate));

  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonth = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}`;

  return {
    ok: true,
    data: {
      rows,
      dueThisMonth: rows.filter((r) => r.nextIncrementDate.startsWith(thisMonth) && r.daysRemaining >= 0).length,
      dueNextMonth: rows.filter((r) => r.nextIncrementDate.startsWith(nextMonth)).length,
      overdue: rows.filter((r) => r.daysRemaining < 0).length,
      next90: rows.filter((r) => r.daysRemaining >= 0 && r.daysRemaining <= 90).length,
    },
  };
}
