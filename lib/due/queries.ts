/** What is due (P22). HR's action list. HR and the MD only (§5). */

import "server-only";

import { cycleError, type CycleResult } from "@/lib/cycles/schema";
import { createClient } from "@/lib/supabase/server";

export type DueRow = {
  /**
   * The row's key, not the due item's id.
   *
   * The list covers the WHOLE Backend Team now, and most of them have nothing
   * due — so there is no `due_items` row to borrow an id from. Somebody with
   * nothing due gets `person:<profileId>`, which is stable across renders and,
   * being obviously not a uuid, cannot be mistaken for one and handed to an
   * action that expects one.
   */
  id: string;
  /**
   * The `due_items` row, where there is one — and NULL is what says there is
   * nothing to create for this person.
   *
   * Separate from `id` deliberately: every action on this screen operates on a
   * due item, so making them one field is what would let a "nothing due" row be
   * passed to `createAndSend` and open an evaluation nobody asked for.
   */
  dueItemId: string | null;
  profileId: string;
  name: string;
  employeeCode: string | null;
  department: string | null;
  departmentId: string | null;
  /** Null where nothing is due for this person. */
  milestoneType: string | null;
  /** Plain language — no enum reaches a screen (§13.5). Null where nothing is due. */
  what: string | null;
  dueOn: string | null;
  daysRemaining: number | null;
  designation: string | null;
  leadId: string | null;
  leadName: string | null;
  /**
   * When their last evaluation was CLOSED — §8's terminal state.
   *
   * Deliberately not the cycle roster's "last evaluated", which is the most
   * recent evaluation's `created_at`: that answers "when were they last asked",
   * and this answers "when were they last reviewed". Both are useful and they
   * are not the same date, so they carry different labels rather than one name
   * meaning two things on two screens.
   *
   * Null for everybody today, and honestly so — nothing has been closed yet.
   */
  lastCompletedOn: string | null;
  /** Why "Create and send" cannot run yet, if it cannot. */
  blockedBecause: string | null;
  /**
   * Where to go and fix it.
   *
   * Each of the four causes has a DIFFERENT fix and a different screen, so the
   * sentence alone left HR to work out which — "Nobody is set to rate them" in
   * a dialog with no way out is the dead end §13.4 forbids, and it was reported
   * as one.
   *
   * The Users link carries `?find=` so the roster opens on that person rather
   * than on fifty-five of them.
   */
  blockedFix: { href: string; label: string } | null;
};

export type DueList = {
  rows: DueRow[];
  /**
   * EVERYBODY on the Backend Team, at the owner's instruction — not the number
   * of milestones outstanding.
   *
   * It counted `rows.length` when a row only existed for somebody with
   * something due, so the two happened to be the same number and the card was
   * named after the milestones. The screen now lists the whole team, and the
   * card is the roster: "who is on this team", against which the other two
   * cards are the subset that needs attention.
   */
  teamTotal: number;
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

  /* -- THE ROSTER IS THE STARTING POINT, not the due items.
        At the owner's instruction: the first card is "All Backend team" and
        pressing it shows everybody on it. Built from `profiles` and then
        joined to whatever is due, rather than the other way round — starting
        from `due_items` can only ever produce rows for people who have
        something outstanding, which is the list this replaces.

        STAFF only, and active only. `track` is what separates the two modules
        (§7): the Production team is appraised on its own rounds and its own
        tick sheet, and has no milestone schedule at all, so listing them here
        would offer an action that cannot run. Somebody who has left is not due
        an appraisal either (P4-5). -- */
  const { data: people } = await supabase
    .from("profiles")
    .select("id, full_name, employee_code, designation, department_id, reports_to, is_active")
    .eq("track", "STAFF")
    .eq("is_active", true)
    .order("full_name");

  if (!people || people.length === 0) {
    return { ok: true, data: { rows: [], teamTotal: 0, dueSoon: 0, overdue: 0, thisMonth: 0 } };
  }

  const ids = people.map((p) => p.id);

  /* The soonest pending milestone per person. `due_items` is already ordered by
     `due_on`, so the first one seen is the one that matters — and 0096 keeps at
     most one pending milestone per person anyway, so this is a backstop rather
     than a choice. */
  const dueFor = new Map<string, (typeof list)[number]>();
  for (const item of list) {
    if (!dueFor.has(item.profile_id)) dueFor.set(item.profile_id, item);
  }

  const leadIds = [...new Set((people ?? []).map((p) => p.reports_to).filter(Boolean))] as string[];
  const deptIds = [...new Set((people ?? []).map((p) => p.department_id).filter(Boolean))] as string[];

  const [{ data: leads }, { data: departments }, { data: mapped }, { data: closed }] = await Promise.all([
    leadIds.length
      ? supabase.from("profiles").select("id, full_name").in("id", leadIds)
      : Promise.resolve({ data: [] }),
    deptIds.length
      ? supabase.from("departments").select("id, name").in("id", deptIds)
      : Promise.resolve({ data: [] }),
    deptIds.length
      ? supabase.from("department_questions").select("department_id").in("department_id", deptIds)
      : Promise.resolve({ data: [] }),
    /* -- When each of these people was last REVIEWED, not last asked.
          `closed_at` is §8's terminal state, so a cycle somebody was added to
          and never finished does not count as a review. Newest first, so the
          first row seen for a person is the one that matters. -- */
    supabase
      .from("evaluations")
      .select("evaluatee_id, closed_at")
      .in("evaluatee_id", ids)
      .not("closed_at", "is", null)
      .is("excluded_at", null)
      .order("closed_at", { ascending: false }),
  ]);

  // `byId` is gone with the loop that needed it: the rows are built by walking
  // the roster itself now, so each person is already in hand.
  const lastClosed = new Map<string, string>();
  for (const row of closed ?? []) {
    if (row.closed_at && !lastClosed.has(row.evaluatee_id)) {
      lastClosed.set(row.evaluatee_id, row.closed_at);
    }
  }
  const leadName = new Map((leads ?? []).map((p) => [p.id, p.full_name]));
  const deptName = new Map((departments ?? []).map((d) => [d.id, d.name]));
  // P9-7: a department with no Job Specific Skills questions cannot be launched
  // — every employee in it would get an empty section.
  const deptHasQuestions = new Set((mapped ?? []).map((m) => m.department_id));

  const rows: DueRow[] = [];
  for (const person of people) {
    const item = dueFor.get(person.id) ?? null;

    /* -- Why the primary action would fail, said BEFORE it is pressed.
          §13.4: a disabled control with no explanation is a dead end, and each
          of these has a different fix. -- */
    let blocked: string | null = null;
    let fix: DueRow["blockedFix"] = null;
    /* The person's own record is what the Users roster is searched by. Their
       code is the precise handle; the name is the fallback for somebody who has
       not been given one yet. */
    const findMe = encodeURIComponent(person.employee_code || person.full_name);
    const onUsers = { href: `/admin/settings?tab=users&find=${findMe}`, label: "Open their record" };

    if (!person.department_id) {
      blocked = "No department, so there is no form to give them.";
      fix = { ...onUsers, label: "Set their department" };
    } else if (!deptHasQuestions.has(person.department_id)) {
      blocked = "Their department has no Job Specific Skills questions yet.";
      // Not the Users roster: this one is fixed on the department, and it is
      // fixed once for everybody in it rather than per person.
      fix = {
        href: `/admin/departments/${person.department_id}`,
        label: `Map questions for ${deptName.get(person.department_id) ?? "their department"}`,
      };
    } else if (!person.reports_to) {
      blocked = "Nobody is set to rate them.";
      fix = { ...onUsers, label: "Set who they report to" };
    } else if (person.reports_to === person.id) {
      blocked = "They are set to rate themselves, which blind rating does not allow.";
      fix = { ...onUsers, label: "Change who they report to" };
    }

    rows.push({
      id: item ? item.id : `person:${person.id}`,
      dueItemId: item?.id ?? null,
      profileId: person.id,
      name: person.full_name,
      employeeCode: person.employee_code,
      department: person.department_id ? (deptName.get(person.department_id) ?? null) : null,
      departmentId: person.department_id,
      milestoneType: item?.milestone_type ?? null,
      what: item ? milestoneLabel(item.milestone_type) : null,
      dueOn: item?.due_on ?? null,
      daysRemaining: item ? daysUntil(item.due_on) : null,
      designation: person.designation,
      lastCompletedOn: lastClosed.get(person.id) ?? null,
      leadId: person.reports_to,
      leadName: person.reports_to ? (leadName.get(person.reports_to) ?? null) : null,
      /* -- Only meaningful where there is something to create.
            A person with nothing due has no blocked action, so reporting "no
            department" against them would be flagging a problem the screen is
            not offering to solve — noise on every row of a roster. -- */
      blockedBecause: item ? blocked : null,
      blockedFix: item ? fix : null,
    });
  }

  const month = new Date().toISOString().slice(0, 7);

  return {
    ok: true,
    data: {
      rows,
      // Everybody on the team — the roster the first card now counts.
      teamTotal: rows.length,
      /* -- The two attention counts stay counts of MILESTONES, which is why
            they read `daysRemaining !== null`: a row with nothing due is on the
            team but is not waiting on anybody, and folding it into either of
            these would make the cards describe the roster twice. -- */
      dueSoon: rows.filter((r) => r.daysRemaining !== null && r.daysRemaining >= 0 && r.daysRemaining <= 30).length,
      overdue: rows.filter((r) => r.daysRemaining !== null && r.daysRemaining < 0).length,
      thisMonth: rows.filter((r) => r.dueOn !== null && r.dueOn.startsWith(month)).length,
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
  /* -- `!== null` IS LOAD-BEARING, not a type nicety.
        The list now carries the whole Backend Team, and a row with nothing due
        has `daysRemaining === null`. In JavaScript `null <= 30` is TRUE — so
        without this the wizard would arrive with every employee ticked rather
        than the ones actually due, which is the exact preselection bug this
        function exists to keep honest. -- */
  return [
    ...new Set(
      list.data.rows
        .filter((r) => r.daysRemaining !== null && r.daysRemaining <= 30)
        .map((r) => r.profileId),
    ),
  ];
}
