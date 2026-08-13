/** What is due (P22). HR's action list. HR and the MD only (§5). */

import "server-only";

import { cycleError, type CycleResult } from "@/lib/cycles/schema";
import { createClient } from "@/lib/supabase/server";

export type DueRow = {
  id: string;
  profileId: string;
  name: string;
  employeeCode: string | null;
  department: string | null;
  departmentId: string | null;
  milestoneType: string;
  /** Plain language — no enum reaches a screen (§13.5). */
  what: string;
  dueOn: string;
  daysRemaining: number;
  leadId: string | null;
  leadName: string | null;
  /** Why "Create and send" cannot run yet, if it cannot. */
  blockedBecause: string | null;
};

export type DueList = {
  rows: DueRow[];
  milestonesDue: number;
  dueSoon: number;
  overdue: number;
  thisMonth: number;
};

export const MILESTONE_LABELS: Record<string, string> = {
  MONTH_1: "One-month review",
  MONTH_6: "Six-month review",
  ANNUAL: "Annual evaluation",
  INCREMENT: "Increment due",
  /* -- Named for WHAT IT IS FOR, not for when it falls.
        "Six months before increment" describes the date; "Pre-increment
        review" describes the conversation, which is what HR is deciding
        whether to start. The two are the same appraisal form — only the
        reason for running it differs. -- */
  PRE_INCREMENT: "Pre-increment review",
};

/**
 * What to call a milestone, for any interval HR has configured.
 *
 * THE VOCABULARY IS OPEN NOW (0076). The intervals are a setting, so the
 * milestone is `MONTH_3`, `MONTH_9`, `MONTH_18` — whatever the schedule says —
 * and a fixed map would show a stored enum value the moment HR changed one.
 * §8's rule is that a person never reads a stored value, and it applies to a
 * name the system generated just as much as to one it shipped with.
 *
 * The named kinds keep their own wording, because "One-month review" reads
 * better than the sentence below and is what HR is used to.
 */
export function milestoneLabel(type: string): string {
  const known = MILESTONE_LABELS[type];
  if (known) return known;

  const months = /^MONTH_(\d+)$/.exec(type);
  if (!months) return type;

  const n = Number(months[1]);
  return n === 12 ? "One-year review" : `${n}-month review`;
};

function daysUntil(iso: string): number {
  const then = new Date(`${iso}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((then.getTime() - today.getTime()) / 86_400_000);
}

/**
 * Everything still waiting for HR to act on.
 *
 * Only PENDING items: one that has been created or skipped is history, and a
 * list that keeps showing dealt-with work is a list people stop reading.
 */
export async function getDueList(): Promise<CycleResult<DueList>> {
  const supabase = await createClient();

  const { data: items, error } = await supabase
    .from("due_items")
    .select("id, profile_id, milestone_type, due_on")
    .eq("status", "PENDING")
    /* -- EVALUATIONS ONLY, at the owner's instruction: "This page is now
          dedicated specifically to employee evaluation dues (increments live in
          their own menu section)."

          Filtered at SOURCE rather than in the render, so the counts above the
          table and the rows inside it cannot describe different sets — which is
          how a KPI card ends up disagreeing with the list it filters. -- */
    .neq("milestone_type", "INCREMENT")
    .order("due_on");

  if (error) return cycleError("QUERY_FAILED", `Could not read the list: ${error.message}`);

  const list = items ?? [];
  if (list.length === 0) {
    return { ok: true, data: { rows: [], milestonesDue: 0, dueSoon: 0, overdue: 0, thisMonth: 0 } };
  }

  const ids = [...new Set(list.map((i) => i.profile_id))];
  const { data: people } = await supabase
    .from("profiles")
    .select("id, full_name, employee_code, department_id, reports_to, is_active")
    .in("id", ids);

  const leadIds = [...new Set((people ?? []).map((p) => p.reports_to).filter(Boolean))] as string[];
  const deptIds = [...new Set((people ?? []).map((p) => p.department_id).filter(Boolean))] as string[];

  const [{ data: leads }, { data: departments }, { data: mapped }] = await Promise.all([
    leadIds.length
      ? supabase.from("profiles").select("id, full_name").in("id", leadIds)
      : Promise.resolve({ data: [] }),
    deptIds.length
      ? supabase.from("departments").select("id, name").in("id", deptIds)
      : Promise.resolve({ data: [] }),
    deptIds.length
      ? supabase.from("department_questions").select("department_id").in("department_id", deptIds)
      : Promise.resolve({ data: [] }),
  ]);

  const byId = new Map((people ?? []).map((p) => [p.id, p]));
  const leadName = new Map((leads ?? []).map((p) => [p.id, p.full_name]));
  const deptName = new Map((departments ?? []).map((d) => [d.id, d.name]));
  // P9-7: a department with no Job Specific Skills questions cannot be launched
  // — every employee in it would get an empty section.
  const deptHasQuestions = new Set((mapped ?? []).map((m) => m.department_id));

  const rows: DueRow[] = [];
  for (const item of list) {
    const person = byId.get(item.profile_id);
    // Somebody who has left is not due an appraisal (P4-5).
    if (!person || !person.is_active) continue;

    /* -- Why the primary action would fail, said BEFORE it is pressed.
          §13.4: a disabled control with no explanation is a dead end, and each
          of these has a different fix. -- */
    let blocked: string | null = null;
    if (!person.department_id) {
      blocked = "No department, so there is no form to give them.";
    } else if (!deptHasQuestions.has(person.department_id)) {
      blocked = "Their department has no Job Specific Skills questions yet.";
    } else if (!person.reports_to) {
      blocked = "Nobody is set to rate them.";
    } else if (person.reports_to === person.id) {
      blocked = "They are set to rate themselves, which blind rating does not allow.";
    }

    rows.push({
      id: item.id,
      profileId: item.profile_id,
      name: person.full_name,
      employeeCode: person.employee_code,
      department: person.department_id ? (deptName.get(person.department_id) ?? null) : null,
      departmentId: person.department_id,
      milestoneType: item.milestone_type,
      what: milestoneLabel(item.milestone_type),
      dueOn: item.due_on,
      daysRemaining: daysUntil(item.due_on),
      leadId: person.reports_to,
      leadName: person.reports_to ? (leadName.get(person.reports_to) ?? null) : null,
      blockedBecause: blocked,
    });
  }

  const month = new Date().toISOString().slice(0, 7);

  return {
    ok: true,
    data: {
      rows,
      milestonesDue: rows.length,
      /* -- "Due soon" replaced "Increments due", which now belongs to the
            increment calendar. Thirty days is the notice period the schedule
            itself carries (0076), so the card and the message HR receives are
            counting the same thing. -- */
      dueSoon: rows.filter((r) => r.daysRemaining >= 0 && r.daysRemaining <= 30).length,
      overdue: rows.filter((r) => r.daysRemaining < 0).length,
      thisMonth: rows.filter((r) => r.dueOn.startsWith(month)).length,
    },
  };
}

/**
 * Everybody whose evaluation is due or already late, by profile id.
 *
 * READ FROM THE SAME PENDING ITEMS the Evaluation Due screen lists, so the
 * button's count and the roster the wizard ticks cannot describe different
 * sets — which is how a screen ends up saying "9 people" and preselecting
 * eleven.
 *
 * DISTINCT people, not items. Somebody whose three-month and nine-month reviews
 * fall in the same window is one person in one cycle, not two.
 *
 * Thirty days, matching the schedule's own notice period (0076) and the "due
 * soon" tile. Anything further out is not something HR is being asked to start
 * today.
 */
export async function dueProfileIds(): Promise<string[]> {
  const list = await getDueList();
  if (!list.ok) return [];
  return [...new Set(list.data.rows.filter((r) => r.daysRemaining <= 30).map((r) => r.profileId))];
}
