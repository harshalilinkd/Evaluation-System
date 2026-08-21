/** Reads for the three cycle screens. No writes here. */

import "server-only";

import { cycleError, type CycleResult } from "@/lib/cycles/schema";
import { jobSkillCountsByDepartment } from "@/lib/cycles/validate";
import { createClient } from "@/lib/supabase/server";
import type { Enums } from "@/types/database";

/* ---------- Screen 1: the list ---------- */

export type CycleListRow = {
  id: string;
  name: string;
  periodLabel: string;
  status: Enums<"cycle_status">;
  startsOn: string | null;
  selfDueOn: string | null;
  leadDueOn: string | null;
  mdDueOn: string | null;
  launchedAt: string | null;
  /**
   * EVALUATION or INCREMENT. §1: the two share the same form and the same blind
   * parallel flow, and differ only in how they END — an increment cycle carries
   * on into salary. Nothing on screen said which was which, so HR could not
   * tell two live cycles apart.
   */
  cycleType: "EVALUATION" | "INCREMENT";
  participants: number;
  /**
   * How many DISTINCT managers are rating in this cycle.
   *
   * "3 people" answered half the question. A cycle is two populations of work,
   * not one: three employees filling their own form, and however many managers
   * are rating them — which is rarely three, because one HOD usually rates
   * several. Somebody deciding whether to launch, or working out who to chase,
   * needs both numbers.
   *
   * DISTINCT, and counted from `lead_id` on the evaluations themselves rather
   * than from `profiles.reports_to`. The evaluation carries the manager it was
   * launched with (P3-6) precisely so a reorganisation mid-cycle does not
   * silently reassign an in-flight review — so this counts who is actually
   * rating, not who would be if the cycle launched today.
   *
   * A participant with no manager contributes nothing to it. That is the state
   * a launch refuses, and counting a null as a manager would report a cycle as
   * having more raters than it has.
   */
  managers: number;
  /**
   * WHO is in it, and who has and has not submitted.
   *
   * A count says how much work there is; a name says who to talk to. The
   * detail dialog is where somebody goes to answer "is this the cycle I meant,
   * and who is holding it up" — and neither question is answerable from "3".
   *
   * HR AND THE MD ONLY, which is what makes it safe to carry both sides.
   * `/admin/cycles` is guarded to those two roles, and §9 gives them both
   * layers. This list must never reach a lead-facing screen: whether the
   * employee has submitted is precisely what blind rating withholds from them
   * (§5), so a component reusing this row on `/team` would be a leak.
   *
   * PENDING FIRST in both lists. They are read as a chase list, so they are
   * ordered the way somebody would work them (N1-7's reasoning).
   */
  employees: Array<{ name: string; submitted: boolean }>;
  /**
   * Each manager once, with how far through their own reports they are.
   *
   * Not a boolean: a HOD rating six people can be finished for four of them,
   * and "pending" would be as true of somebody who has done five as of
   * somebody who has done none. The fraction is what says who to chase.
   */
  managerRows: Array<{ name: string; done: number; total: number }>;
  /** Counts for the segmented progress bar, in tier order. */
  progress: { self: number; lead: number; final: number };
  /**
   * How many participants have had an invite link sent to them.
   *
   * The row menu offered "Send links" with nothing beside it to say whether
   * they had already gone out, so the only way to find out was to open the
   * distribution screen — or to send them a second time and see. On a screen
   * whose action messages the whole company, "have I already done this?" has to
   * be answerable from the list.
   *
   * Counted from `notifications_log`, which is the record that a send was
   * ATTEMPTED (P11-6 writes the row before calling the provider). A person is
   * counted once however many channels or retries they took.
   */
  linksSent: number;
};

/**
 * Every cycle, newest first, with the counts the table needs.
 *
 * Progress is cumulative by design: somebody at MD_FINALIZED has also submitted
 * their self layer and had it reviewed. A segmented bar built from exclusive
 * counts would shrink as work advanced, which is the opposite of what a
 * progress bar is for.
 */
/* ---------- The recycle bin ---------- */

export type BinnedCycleRow = {
  id: string;
  name: string;
  periodLabel: string;
  status: Enums<"cycle_status">;
  participants: number;
  /**
   * Who is in it, by name, sorted.
   *
   * A count alone does not say whether a binned cycle is the one HR meant —
   * nine rows reading "Increment round · August 2026 · 3 people" are
   * indistinguishable from each other, and restoring the wrong one puts three
   * real appraisals back in front of three real people.
   */
  participantNames: string[];
  deletedAt: string;
  deletedByName: string | null;
  reason: string | null;
};

/**
 * What is in the bin.
 *
 * The participant count travels with each row because it is the one fact that
 * decides whether restoring matters: an empty draft is a click, a cycle holding
 * forty frozen snapshots is a decision. Nothing here was destroyed — 0032 only
 * marks the row — so the count is real, not remembered.
 */
export async function listBinnedCycles(): Promise<CycleResult<BinnedCycleRow[]>> {
  const supabase = await createClient();

  const { data: cycles, error } = await supabase
    .from("evaluation_cycles")
    .select("id, name, period_label, status, deleted_at, deleted_by, delete_reason")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });

  if (error) return cycleError("QUERY_FAILED", `Could not read the recycle bin: ${error.message}`);
  if (!cycles || cycles.length === 0) return { ok: true, data: [] };

  const ids = cycles.map((c) => c.id);

  const [{ data: evaluations }, { data: actors }] = await Promise.all([
    /* -- WHO, not just how many.
          The evaluatee was already being read and thrown away: this selected
          `cycle_id` alone and counted the rows. "3 people" tells HR nothing
          about whether a binned cycle is the one they meant — and restoring the
          wrong one puts three real appraisals back in front of three real
          people. -- */
    supabase
      .from("evaluations")
      .select("cycle_id, evaluatee_id")
      .in("cycle_id", ids)
      .is("excluded_at", null),
    supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", cycles.map((c) => c.deleted_by).filter((id): id is string => Boolean(id))),
  ]);

  /* One more round trip, for the participants' own names. Not folded into the
     query above: `evaluations` has two foreign keys into `profiles`, and a
     select string that has to disambiguate them is one typo away from silently
     resolving the wrong one (the same reason `loadCycleParticipants` reads them
     separately). */
  const participantIds = [...new Set((evaluations ?? []).map((e) => e.evaluatee_id))];
  const { data: participants } = participantIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", participantIds)
    : { data: [] };
  const participantName = new Map((participants ?? []).map((p) => [p.id, p.full_name] as const));

  const counts = new Map<string, number>();
  const people = new Map<string, string[]>();
  for (const row of evaluations ?? []) {
    counts.set(row.cycle_id, (counts.get(row.cycle_id) ?? 0) + 1);
    const list = people.get(row.cycle_id) ?? [];
    list.push(participantName.get(row.evaluatee_id) ?? "Unknown");
    people.set(row.cycle_id, list);
  }
  for (const list of people.values()) list.sort((a, b) => a.localeCompare(b));

  const names = new Map((actors ?? []).map((a) => [a.id, a.full_name] as const));

  return {
    ok: true,
    data: cycles.map((c) => ({
      id: c.id,
      name: c.name,
      periodLabel: c.period_label,
      status: c.status,
      participants: counts.get(c.id) ?? 0,
      participantNames: people.get(c.id) ?? [],
      deletedAt: c.deleted_at as string,
      deletedByName: c.deleted_by ? (names.get(c.deleted_by) ?? null) : null,
      reason: c.delete_reason,
    })),
  };
}

export async function listCycles(): Promise<CycleResult<CycleListRow[]>> {
  const supabase = await createClient();

  const { data: cycles, error } = await supabase
    .from("evaluation_cycles")
    .select(
      "id, name, period_label, status, starts_on, self_due_on, lead_due_on, md_due_on, launched_at, created_at, cycle_type",
    )
    // 0032: binned cycles are hidden here and listed only in the recycle bin.
    // Filtered in the query rather than after it, so a screen cannot forget.
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) return cycleError("QUERY_FAILED", `Could not read cycles: ${error.message}`);
  if (!cycles || cycles.length === 0) return { ok: true, data: [] };

  const { data: evaluations, error: evaluationError } = await supabase
    .from("evaluations")
    // `lead_id` for the distinct-manager count. Written out in full rather than
    // concatenated: supabase-js infers the row type from this string at compile
    // time and degrades everything it cannot statically parse (P3-11).
    .select(
      "id, cycle_id, evaluatee_id, lead_id, co_lead_id, status, self_submitted_at, lead_submitted_at, co_lead_submitted_at, co_lead_skipped",
    )
    .is("excluded_at", null);

  if (evaluationError) {
    return cycleError("QUERY_FAILED", `Could not read evaluations: ${evaluationError.message}`);
  }

  const tally = new Map<string, { participants: number; self: number; lead: number; final: number }>();
  const cycleOfEvaluation = new Map<string, string>();
  /* A Set per cycle, so one HOD rating six people is counted once. */
  const managers = new Map<string, Set<string>>();
  for (const row of evaluations ?? []) {
    const entry = tally.get(row.cycle_id) ?? { participants: 0, self: 0, lead: 0, final: 0 };
    entry.participants += 1;
    if (reachedSelf(row)) entry.self += 1;
    if (reachedLead(row)) entry.lead += 1;
    if (reachedFinal(row)) entry.final += 1;
    tally.set(row.cycle_id, entry);
    cycleOfEvaluation.set(row.id, row.cycle_id);

    // A participant with no manager adds nobody. That state blocks a launch,
    // and counting the null would report more raters than the cycle has.
    if (row.lead_id) {
      const set = managers.get(row.cycle_id) ?? new Set<string>();
      set.add(row.lead_id);
      managers.set(row.cycle_id, set);
    }
  }

  /* -- WHO, by name.
        One round trip for every person named in any cycle — employees and
        managers together, since both are rows in `profiles` and asking twice
        would be two queries for one answer.

        NOT an embedded join. `evaluations` has two foreign keys into
        `profiles`, and a select string that has to disambiguate them is one
        typo away from silently resolving the wrong one — the same reason
        `listBinnedCycles` and `loadCycleParticipants` both read them
        separately (P3-7). -- */
  const namedIds = [
    ...new Set(
      (evaluations ?? [])
        .flatMap((r) => [r.evaluatee_id, r.lead_id])
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const { data: named } = namedIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", namedIds)
    : { data: [] };
  const nameOf = new Map((named ?? []).map((p) => [p.id, p.full_name] as const));

  const employeesIn = new Map<string, Array<{ name: string; submitted: boolean }>>();
  /* Keyed by manager id so one HOD is one row however many people they rate. */
  const managerTally = new Map<string, Map<string, { done: number; total: number }>>();

  for (const row of evaluations ?? []) {
    const list = employeesIn.get(row.cycle_id) ?? [];
    list.push({
      name: nameOf.get(row.evaluatee_id) ?? "Unknown",
      submitted: Boolean(row.self_submitted_at),
    });
    employeesIn.set(row.cycle_id, list);

    /* -- Both managers, each against their OWN form. A Design Coordinator
          carrying twelve designers is a real chase list and appeared on none
          of them: this tally was keyed on `lead_id` alone, so their twelve
          outstanding reviews were invisible to HR. -- */
    const perCycle = managerTally.get(row.cycle_id) ?? new Map();
    const count = (managerId: string | null, submittedAt: string | null) => {
      if (!managerId) return;
      const entry = perCycle.get(managerId) ?? { done: 0, total: 0 };
      entry.total += 1;
      if (submittedAt) entry.done += 1;
      perCycle.set(managerId, entry);
    };
    count(row.lead_id, row.lead_submitted_at);
    count(row.co_lead_id, row.co_lead_submitted_at);
    if (!row.lead_id && !row.co_lead_id) continue;
    managerTally.set(row.cycle_id, perCycle);
  }

  /* -- PENDING FIRST, then alphabetical. Both lists are read as a chase list,
        so they are ordered the way somebody would work them rather than the
        order the database happened to return. -- */
  for (const list of employeesIn.values()) {
    list.sort(
      (a, b) => Number(a.submitted) - Number(b.submitted) || a.name.localeCompare(b.name),
    );
  }

  /* -- Who has been sent a link.
        `notifications_log` is the record that a send was ATTEMPTED — P11-6
        writes the row BEFORE calling the provider, so a process that died
        mid-send still leaves the evidence. That is the right thing to count
        here: the question this answers is "have I already done this?", not
        "did every message arrive", which is the distribution screen's job.

        Counted per EVALUATION and then rolled up, so somebody sent both a
        WhatsApp and an email, or retried twice, is one person. -- */
  const evaluationIds = [...cycleOfEvaluation.keys()];
  const sentPerCycle = new Map<string, Set<string>>();

  if (evaluationIds.length > 0) {
    const { data: sends } = await supabase
      .from("notifications_log")
      .select("evaluation_id")
      .in("evaluation_id", evaluationIds)
      .not("evaluation_id", "is", null);

    for (const row of sends ?? []) {
      const cycleId = row.evaluation_id ? cycleOfEvaluation.get(row.evaluation_id) : undefined;
      if (!cycleId || !row.evaluation_id) continue;
      const set = sentPerCycle.get(cycleId) ?? new Set<string>();
      set.add(row.evaluation_id);
      sentPerCycle.set(cycleId, set);
    }
  }

  return {
    ok: true,
    data: cycles.map((c) => {
      const counts = tally.get(c.id) ?? { participants: 0, self: 0, lead: 0, final: 0 };
      return {
        id: c.id,
        name: c.name,
        periodLabel: c.period_label,
        status: c.status,
        startsOn: c.starts_on,
        selfDueOn: c.self_due_on,
        leadDueOn: c.lead_due_on,
        mdDueOn: c.md_due_on,
        launchedAt: c.launched_at,
        // Narrowed rather than cast: the column is text with a CHECK (PR-1),
        // so anything unexpected reads as an ordinary evaluation rather than
        // silently claiming to be an increment cycle.
        cycleType: c.cycle_type === "INCREMENT" ? "INCREMENT" : "EVALUATION",
        participants: counts.participants,
        managers: managers.get(c.id)?.size ?? 0,
        employees: employeesIn.get(c.id) ?? [],
        managerRows: [...(managerTally.get(c.id)?.entries() ?? [])]
          .map(([id, t]) => ({ name: nameOf.get(id) ?? "Unknown", done: t.done, total: t.total }))
          // Furthest behind first, then alphabetical — the chase order.
          .sort(
            (a, b) => a.done / a.total - b.done / b.total || a.name.localeCompare(b.name),
          ),
        progress: { self: counts.self, lead: counts.lead, final: counts.final },
        linksSent: sentPerCycle.get(c.id)?.size ?? 0,
      };
    }),
  };
}


/**
 * Has each side come in yet?
 *
 * AMEND-3 made this a TIMESTAMP question, not a status one. Both layers are
 * filled during OPEN, so no single status can say "the self layer is in and the
 * lead layer is not" — and the ordering above mapped OPEN to the same rank as
 * the retired SELF_SUBMITTED, which made `reachedSelf` true for every open
 * evaluation. The cycle list reported everybody as having submitted from the
 * moment the cycle launched.
 *
 * The status is still consulted, because it is the only thing that says a
 * SKIPPED layer is done: `self_skipped` advances the record deliberately without
 * ever setting a timestamp (the same pair of conditions 0027 uses for the view).
 */
type ProgressRow = {
  status: Enums<"evaluation_status">;
  self_submitted_at: string | null;
  lead_submitted_at: string | null;
  /** 0083. Null on the ordinary two-form flow, which is almost everybody. */
  co_lead_id?: string | null;
  co_lead_submitted_at?: string | null;
  co_lead_skipped?: boolean | null;
};

const PAST_OPEN: ReadonlyArray<Enums<"evaluation_status">> = [
  "PENDING_HR_REVIEW", "HR_APPROVED", "MD_REVIEWED", "INTERVIEW_DONE", "CLOSED",
];

function reachedSelf(row: ProgressRow) {
  return row.self_submitted_at !== null || PAST_OPEN.includes(row.status);
}
/**
 * The MANAGER side of one person's appraisal, complete.
 *
 * Complete means every manager who was asked, which for somebody with a second
 * reviewer (0083) is two. Counting the reporting lead alone would report a
 * designer as fully rated while one of their two managers had not started —
 * and the bar on HR's board is the one number that says whether a cycle can be
 * closed.
 *
 * The columns are per-PERSON out of the participant total, so this stays a
 * yes/no about that person rather than becoming a count of forms. A skipped
 * second opinion is done, exactly as a skipped first one is (§8).
 */
function reachedLead(row: ProgressRow) {
  if (PAST_OPEN.includes(row.status)) return true;
  if (row.lead_submitted_at === null) return false;
  if (!row.co_lead_id) return true;
  return row.co_lead_submitted_at !== null || Boolean(row.co_lead_skipped);
}
function reachedFinal(row: ProgressRow) {
  return ["MD_REVIEWED", "INTERVIEW_DONE", "CLOSED"].includes(row.status);
}

/* ---------- Wizard step 3: who can be added ---------- */

export type SelectablePerson = {
  id: string;
  name: string;
  employeeCode: string | null;
  designation: string | null;
  departmentId: string | null;
  departmentName: string | null;
  reportsTo: string | null;
  hasEmail: boolean;
  hasPhone: boolean;
  /** Offered first in the HOD picker as the alternative for a department head. */
  isMd: boolean;

  /* -- What HR needs to decide who belongs in this cycle. --
        A name and a department do not answer "should this person be in it".
        These three do: when they were last appraised, when they were last paid
        more, and when the next rise is contractually due. §5 keeps the AMOUNTS
        to HR and the MD; these are dates, not figures, and no rupee value is
        carried here. */
  lastEvaluationOn: string | null;
  lastIncrementOn: string | null;
  nextIncrementOn: string | null;

  /* -- A SECOND manager, where this person has one (0083).
        Carried into the wizard because HR is deciding who to launch and who
        gets messaged, and a designer rated by two people is a materially
        different launch: three forms open, and the record does not reach HR
        until all three are in. Setting it in Settings and seeing no trace of
        it here reads as the setting not having taken. -- */
  coReviewerId: string | null;
  coReviewerName: string | null;

  /* -- ALREADY IN A LIVE INCREMENT CYCLE.
        "Increment due" is a DATE check alone — it says nothing about whether a
        round for that date has already been started. Without this, somebody
        HR launched a round for last week is still offered again under "due",
        and starting a second one for the same rise is not a correction, it is
        two pay decisions open on one person at once. Scoped to INCREMENT
        cycles only: an ordinary evaluation running at the same time is a
        different exercise and does not make this person any less due a rise. */
  hasOpenIncrementCycle: boolean;
};

/**
 * Every active STAFF profile.
 *
 * The track filter is the acceptance criterion "no worker appears anywhere in
 * this screen", enforced at the query rather than in the table component — a
 * filter in the UI is one refactor away from being dropped, and §5's module
 * boundary is not a presentation concern.
 */
export async function listStaffProfiles(): Promise<CycleResult<SelectablePerson[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, full_name, employee_code, designation, department_id, reports_to, co_reviewer_id, email, phone_e164",
    )
    .eq("is_active", true)
    .eq("track", "STAFF")
    .order("full_name");

  if (error) return cycleError("QUERY_FAILED", `Could not read people: ${error.message}`);

  const { data: departments } = await supabase.from("departments").select("id, name");
  const byDepartment = new Map((departments ?? []).map((d) => [d.id, d.name]));

  // Who holds MD. Item 10 offers them first as the rater for somebody with
  // nobody above them, because "themselves" is no longer an option.
  const { data: mdRoles } = await supabase
    .from("user_roles")
    .select("profile_id")
    .eq("role", "MD");
  const mdIds = new Set((mdRoles ?? []).map((r) => r.profile_id));

  /* -- The three dates HR decides on. --
        Three queries for everybody rather than one-plus per row: forty people
        would otherwise be well over a hundred round trips to render one list. */
  const [{ data: employment }, { data: pastEvaluations }, { data: openIncrementRows }] =
    await Promise.all([
      // Dates only. §5 confines the FIGURES to HR and the MD, and this list has
      // no business carrying a CTC even though the screen is admin-guarded —
      // a column that is never selected cannot leak.
      supabase
        .from("employment_records")
        .select("profile_id, last_increment_date, next_increment_date"),
      // When each person was last part of a cycle. `created_at` is when their
      // evaluation was raised, which is the honest "last appraised" date whether
      // or not it finished — a cycle somebody was in but never completed still
      // means they were asked.
      supabase
        .from("evaluations")
        .select("evaluatee_id, created_at")
        .is("excluded_at", null)
        .order("created_at", { ascending: false }),
      /* -- WHO IS ALREADY MID-INCREMENT.
            `evaluations.status` and `evaluation_cycles.cycle_type` are on
            different tables; the embedded filter (`evaluation_cycles!inner`)
            is what lets one request ask "is the CYCLE this evaluation belongs
            to an increment, and is it still open" without a second round trip
            per person. Excluded participants do not count — P10-6 makes
            exclusion mean the organisation is no longer asking for it, which
            is exactly the case where a fresh round should be offered again. -- */
      supabase
        .from("evaluations")
        .select("evaluatee_id, evaluation_cycles!inner(cycle_type)")
        .eq("evaluation_cycles.cycle_type", "INCREMENT")
        .neq("status", "CLOSED")
        .is("excluded_at", null),
    ]);

  const employmentBy = new Map((employment ?? []).map((row) => [row.profile_id, row] as const));
  const openIncrementIds = new Set((openIncrementRows ?? []).map((row) => row.evaluatee_id));

  // First wins: the select above is newest-first, so the first row seen for a
  // person is their most recent evaluation.
  const lastEvaluationBy = new Map<string, string>();
  for (const row of pastEvaluations ?? []) {
    if (!lastEvaluationBy.has(row.evaluatee_id)) {
      lastEvaluationBy.set(row.evaluatee_id, row.created_at);
    }
  }

  // Names for the second-reviewer lookup below. Built once rather than per row.
  const nameById = new Map((data ?? []).map((p) => [p.id, p.full_name] as const));

  return {
    ok: true,
    data: (data ?? []).map((p) => {
      const job = employmentBy.get(p.id);
      return {
        id: p.id,
        name: p.full_name,
        employeeCode: p.employee_code,
        designation: p.designation,
        departmentId: p.department_id,
        departmentName: p.department_id ? (byDepartment.get(p.department_id) ?? null) : null,
        reportsTo: p.reports_to,
        hasEmail: Boolean(p.email),
        hasPhone: Boolean(p.phone_e164),
        isMd: mdIds.has(p.id),
        lastEvaluationOn: lastEvaluationBy.get(p.id) ?? null,
        lastIncrementOn: job?.last_increment_date ?? null,
        nextIncrementOn: job?.next_increment_date ?? null,
        coReviewerId: p.co_reviewer_id,
        /* Resolved from this same list, which is every active STAFF profile —
           so a second reviewer who is themselves inactive shows as unset rather
           than as a name nobody can be sent a form. */
        coReviewerName: p.co_reviewer_id ? (nameById.get(p.co_reviewer_id) ?? null) : null,
        hasOpenIncrementCycle: openIncrementIds.has(p.id),
      };
    }),
  };
}

/* ---------- Screen 3: the status board ---------- */

/**
 * Item 17. The v3 statuses. The old five described the sequential flow — self
 * submitted, then lead reviewed — and under blind rating those two happen at
 * the same time and are not a sequence at all.
 */
export type BoardColumnKey = "open" | "hr_review" | "with_md" | "interview" | "closed";

export type BoardCard = {
  evaluationId: string;
  name: string;
  initials: string;
  departmentName: string | null;
  leadName: string | null;
  leadId: string | null;
  departmentId: string | null;
  status: Enums<"evaluation_status">;
  column: BoardColumnKey;
  /* -- Item 18: the two sides, independently. HR is allowed to see both (§9),
        and this is the screen where HR chases people — so it is the one place
        the pair is shown side by side. -- */
  selfSubmitted: boolean;
  leadSubmitted: boolean;
  selfSkipped: boolean;
  leadSkipped: boolean;
  /** Days since the evaluation last moved. */
  daysInState: number;
  /** Days past the deadline that applies to this stage; 0 when on time. */
  daysLate: number;
  frozenQuestions: number;
};

export type CycleBoard = {
  cycle: {
    id: string;
    name: string;
    periodLabel: string;
    status: Enums<"cycle_status">;
    startsOn: string | null;
    selfDueOn: string | null;
    leadDueOn: string | null;
    mdDueOn: string | null;
    launchedAt: string | null;
    disclosure: Enums<"disclosure_policy">;
    varianceThreshold: number;
    cycleType: "EVALUATION" | "INCREMENT";
    cycleKind: "BATCH" | "ROLLING";
  };
  cards: BoardCard[];
  /** Distinct leads and departments present, for the filter controls. */
  leads: Array<{ id: string; name: string }>;
  departments: Array<{ id: string; name: string }>;
  /** How many Job Specific Skills questions were frozen into each cohort. */
  cohorts: Array<{ departmentId: string; departmentName: string; people: number; jobSkillQuestions: number }>;
  excluded: Array<{ evaluationId: string; name: string; reason: string | null }>;
  totals: { participants: number; self: number; lead: number; final: number };
};

/**
 * A uuid, or it never reaches Postgres.
 *
 * A malformed id is not a database problem and must not be reported as one:
 * PostgREST answers `invalid input syntax for type uuid: "null"`, which reached
 * a screen verbatim when the launch wizard built `/admin/cycles/null` from a
 * state variable that had not updated yet. The wizard is fixed; this is so the
 * NEXT badly-built link — a typo, a stale bookmark, a URL somebody edited —
 * reads as "no such cycle" rather than as the product leaking its own plumbing
 * (§0.7 says fail loudly, and a Postgres type error is not loudly, it is
 * incomprehensibly).
 *
 * Checked shape-only. Whether the row exists is still the database's answer.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getCycleBoard(cycleId: string): Promise<CycleResult<CycleBoard>> {
  if (!UUID.test(cycleId)) return cycleError("CYCLE_NOT_FOUND", "That cycle no longer exists.");

  const supabase = await createClient();

  const { data: cycle, error: cycleReadError } = await supabase
    .from("evaluation_cycles")
    .select("id, name, period_label, status, starts_on, self_due_on, lead_due_on, md_due_on, launched_at, disclosure, variance_threshold, cycle_type, cycle_kind")
    .eq("id", cycleId)
    .maybeSingle();

  if (cycleReadError) return cycleError("QUERY_FAILED", `Could not read cycle: ${cycleReadError.message}`);
  if (!cycle) return cycleError("CYCLE_NOT_FOUND", "That cycle no longer exists.");

  const { data: evaluations, error: evaluationError } = await supabase
    .from("evaluations")
    .select("id, evaluatee_id, lead_id, co_lead_id, department_id, status, updated_at, self_submitted_at, lead_submitted_at, co_lead_submitted_at, md_finalized_at, excluded_at, excluded_reason, self_skipped, lead_skipped, co_lead_skipped, due_self_on, due_lead_on")
    .eq("cycle_id", cycleId);

  if (evaluationError) {
    return cycleError("QUERY_FAILED", `Could not read evaluations: ${evaluationError.message}`);
  }

  const rows = evaluations ?? [];
  const live = rows.filter((r) => !r.excluded_at);

  const profileIds = new Set<string>();
  for (const row of rows) {
    profileIds.add(row.evaluatee_id);
    if (row.lead_id) profileIds.add(row.lead_id);
  }

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", profileIds.size > 0 ? [...profileIds] : ["00000000-0000-0000-0000-000000000000"]);

  const { data: departments } = await supabase.from("departments").select("id, name");

  const nameOf = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const departmentName = new Map((departments ?? []).map((d) => [d.id, d.name]));

  /* -- How many questions actually froze into each evaluation. -- */
  //
  // Read from evaluation_questions, not from the live bank. The whole point of
  // the "did this department launch thin?" card is to show what was frozen —
  // reading the bank would show what is mapped TODAY, which is exactly the
  // number that cannot be trusted after an edit (§5).
  const { data: frozen } = await supabase
    .from("evaluation_questions")
    .select("evaluation_id, section")
    .in("evaluation_id", live.length > 0 ? live.map((r) => r.id) : ["00000000-0000-0000-0000-000000000000"])
    .eq("section", "DEPARTMENT_SPECIFIC");

  const frozenPer = new Map<string, number>();
  for (const row of frozen ?? []) {
    frozenPer.set(row.evaluation_id, (frozenPer.get(row.evaluation_id) ?? 0) + 1);
  }

  /* -- Which evaluations were sent back. -- */
  //
  // §8 has exactly two return transitions. An evaluation counts as returned
  // when its current status matches the destination of one — i.e. it went
  // backwards and has not yet climbed out again. Derived from the audit log
  // because that is the only place a backwards move is recorded: the status
  // column afterwards is indistinguishable from never having submitted.
  const returned = new Set<string>();
  if (live.length > 0) {
    const { data: returns } = await supabase
      .from("audit_log")
      .select("entity_id, from_status, to_status, created_at")
      .eq("entity", "evaluation")
      .in("entity_id", live.map((r) => r.id))
      // AMEND-3 gave both returns to HR and renamed both ends: a return is now
      // PENDING_HR_REVIEW -> OPEN. The old pair matched nothing, so the board
      // never showed that a record had been sent back.
      .eq("from_status", "PENDING_HR_REVIEW")
      .eq("to_status", "OPEN")
      .order("created_at", { ascending: false });

    const statusNow = new Map(live.map((r) => [r.id, r.status]));
    const seen = new Set<string>();
    for (const row of returns ?? []) {
      if (!row.entity_id || seen.has(row.entity_id)) continue;
      seen.add(row.entity_id); // most recent return only
      if (statusNow.get(row.entity_id) === row.to_status) returned.add(row.entity_id);
    }
  }

  const now = new Date().toISOString().slice(0, 10);

  const cards: BoardCard[] = live.map((row) => {
    const column: BoardColumnKey =
      row.status === "CLOSED"
        ? "closed"
        : row.status === "INTERVIEW_DONE"
          ? "interview"
          : row.status === "HR_APPROVED" || row.status === "MD_REVIEWED"
            ? "with_md"
            : row.status === "PENDING_HR_REVIEW"
              ? "hr_review"
              : "open";

    // The deadline that applies depends on whose turn it is, so "overdue" means
    // the person currently holding the evaluation is late — not that the cycle
    // as a whole has passed some date.
    /* -- Whose deadline applies. While OPEN both sides are running, so the
          later of the two is what "overdue" means for the record as a whole —
          the per-side chips below say which of them is actually late.

          Read from the EVALUATION, not the cycle: a rolling cycle gives each
          person their own dates (item 3). -- */
    const deadline =
      column === "open"
        ? (row.due_lead_on ?? row.due_self_on ?? cycle.lead_due_on ?? cycle.self_due_on)
        : column === "hr_review"
          ? cycle.md_due_on
          : null;

    return {
      evaluationId: row.id,
      name: nameOf.get(row.evaluatee_id) ?? "Unknown",
      initials: initialsOf(nameOf.get(row.evaluatee_id) ?? "?"),
      departmentId: row.department_id,
      departmentName: row.department_id ? (departmentName.get(row.department_id) ?? null) : null,
      leadId: row.lead_id,
      leadName: row.lead_id ? (nameOf.get(row.lead_id) ?? null) : null,
      selfSubmitted: Boolean(row.self_submitted_at),
      leadSubmitted: Boolean(row.lead_submitted_at),
      selfSkipped: Boolean(row.self_skipped),
      leadSkipped: Boolean(row.lead_skipped),
      status: row.status,
      column,
      daysInState: daysSince(row.updated_at),
      daysLate: deadline && deadline < now ? daysBetweenIso(deadline, now) : 0,
      frozenQuestions: frozenPer.get(row.id) ?? 0,
    };
  });

  /* -- Per-department cohorts. -- */
  const cohortMap = new Map<string, { name: string; people: number; questions: number }>();
  for (const card of cards) {
    if (!card.departmentId) continue;
    const entry = cohortMap.get(card.departmentId) ?? {
      name: card.departmentName ?? "Unnamed",
      people: 0,
      questions: card.frozenQuestions,
    };
    entry.people += 1;
    // Everyone in a department freezes the same set, so the first is the cohort's.
    entry.questions = card.frozenQuestions;
    cohortMap.set(card.departmentId, entry);
  }

  // A draft cycle has frozen nothing yet, so the cohort card falls back to what
  // is mapped today — clearly the right number to show before launch.
  if (cycle.status === "DRAFT") {
    const mapped = await jobSkillCountsByDepartment();
    if (mapped.ok) {
      for (const [departmentId, entry] of cohortMap) {
        entry.questions = mapped.data.get(departmentId) ?? 0;
      }
    }
  }

  const leadMap = new Map<string, string>();
  for (const card of cards) if (card.leadId) leadMap.set(card.leadId, card.leadName ?? "Unknown");

  const departmentSet = new Map<string, string>();
  for (const card of cards) if (card.departmentId) departmentSet.set(card.departmentId, card.departmentName ?? "Unnamed");

  return {
    ok: true,
    data: {
      cycle: {
        id: cycle.id,
        name: cycle.name,
        periodLabel: cycle.period_label,
        status: cycle.status,
        startsOn: cycle.starts_on,
        selfDueOn: cycle.self_due_on,
        leadDueOn: cycle.lead_due_on,
        mdDueOn: cycle.md_due_on,
        launchedAt: cycle.launched_at,
        disclosure: cycle.disclosure,
        varianceThreshold: cycle.variance_threshold,
      cycleType: cycle.cycle_type === "INCREMENT" ? "INCREMENT" : "EVALUATION",
      cycleKind: cycle.cycle_kind === "ROLLING" ? "ROLLING" : "BATCH",
      },
      cards,
      leads: [...leadMap.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      departments: [...departmentSet.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      cohorts: [...cohortMap.entries()]
        .map(([departmentId, entry]) => ({
          departmentId,
          departmentName: entry.name,
          people: entry.people,
          jobSkillQuestions: entry.questions,
        }))
        .sort((a, b) => a.departmentName.localeCompare(b.departmentName)),
      excluded: rows
        .filter((r) => r.excluded_at)
        .map((r) => ({
          evaluationId: r.id,
          name: nameOf.get(r.evaluatee_id) ?? "Unknown",
          reason: r.excluded_reason,
        })),
      totals: {
        participants: live.length,
        self: live.filter(reachedSelf).length,
        lead: live.filter(reachedLead).length,
        final: live.filter(reachedFinal).length,
      },
    },
  };
}

/* ---------- small helpers ---------- */

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

function daysSince(iso: string): number {
  const ms = Date.now() - Date.parse(iso);
  return Math.max(0, Math.floor(ms / 86_400_000));
}

function daysBetweenIso(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
