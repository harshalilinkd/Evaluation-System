/** The lead's queue at /team. Reads only — every write goes through the state machine. */

import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { ChipStatus } from "@/components/appraise/status-chip";
import type { EvaluationStatus } from "@/lib/evaluations/transitions";

/**
 * Which manager the signed-in person is ON A GIVEN EVALUATION.
 *
 * Not a property of the person: the same HOD can be the reporting lead of one
 * report and the SECOND reviewer of another, in the same cycle. So it is
 * decided per row, and every read and write for that row follows it.
 */
export type ReviewerLayer = "LEAD" | "LEAD_2";

export type TeamRow = {
  evaluationId: string;
  /** Which of the two manager forms this row opens for this viewer. */
  layer: ReviewerLayer;
  employeeId: string;
  name: string;
  employeeCode: string | null;
  designation: string | null;
  departmentName: string | null;
  status: EvaluationStatus;
  /**
   * ONLY the lead's own side. AMEND-3: this list must not report whether the
   * employee has submitted — that is a signal about the other side, and a lead
   * who can see "Sana submitted three weeks ago, Rohit has not" is being handed
   * exactly the anchoring §1 removed the self column to prevent.
   *
   * `selfSubmittedAt` is deliberately absent from this type. It is not hidden
   * in the client; it is never fetched.
   */
  leadState: "not_started" | "in_progress" | "submitted";
  /** What the chip shows. Derived from `leadState` and the due date, nothing else. */
  chipStatus: ChipStatus;
  leadSubmittedAt: string | null;
  /** Negative once the lead due date has passed. Null when the cycle has no date. */
  daysToLeadDue: number | null;
  isOverdue: boolean;
  /** P13 edge case: a department head with nobody above them. */
  isSelfLed: boolean;
  /** Which cycle this rating belongs to. Named on the row once there are two. */
  cycleId: string;
  cycleName: string;
  periodLabel: string | null;
};

export type TeamCycle = {
  id: string;
  name: string;
  periodLabel: string | null;
  leadDueOn: string | null;
};

export type TeamQueue = {
  /**
   * EVERY active cycle, not one.
   *
   * This used to be four singular fields fed by a `.limit(1)` on the cycle
   * query, with a comment reasoning that "a lead reviews one cycle at a time,
   * and showing two at once would put the same person on screen twice with
   * different deadlines". That was true when it was written and stopped being
   * true at AMEND-2, which gave a cycle a TYPE — EVALUATION and INCREMENT run
   * concurrently and differ only in how they end. The same person appearing
   * twice with two deadlines is not a display fault; it is two ratings that are
   * genuinely both owed.
   *
   * Reported from a real device: an Evaluation cycle and an Increment cycle
   * were both launched and the HOD could only see one of them.
   */
  cycles: TeamCycle[];
  rows: TeamRow[];
  /** Counted over the LEAD side only, for the same reason as `leadState`. */
  counts: { notStarted: number; inProgress: number; submitted: number };
  /**
   * The lead's OWN evaluations, for the reminder banner. Never openable from
   * here (P6-8 / P13-12) — the banner links to /my-evaluation.
   *
   * Plural for the same reason as `cycles`: a HOD with two cycles open owes two
   * self-evaluations, and a banner naming one of them leaves the other with no
   * prompt anywhere.
   */
  ownEvaluations: Array<{
    id: string;
    status: EvaluationStatus;
    selfDueOn: string | null;
    cycleName: string;
  }>;
};

const EMPTY: TeamQueue = {
  cycles: [],
  rows: [],
  counts: { notStarted: 0, inProgress: 0, submitted: 0 },
  ownEvaluations: [],
};

/** Whole days from now until `date`, Asia/Kolkata-agnostic — dates are date-only. */
function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const due = new Date(`${date}T00:00:00`);
  if (Number.isNaN(due.getTime())) return null;
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((due.getTime() - startOfToday.getTime()) / 86_400_000);
}

/**
 * Everything /team needs, for the signed-in lead.
 *
 * Read through the authenticated client throughout, so RLS decides what is
 * listed rather than this function. A lead who edits nothing still cannot see a
 * report who is not theirs — `is_lead_of_evaluation` is what enforces that, and
 * this query would return an empty list rather than somebody else's team even if
 * the filter below were wrong.
 */
export async function getTeamQueue(profileId: string): Promise<TeamQueue> {
  const supabase = await createClient();

  /* -- Which cycles -- */
  //
  // ALL of them. The `.limit(1).maybeSingle()` that used to be here is the bug
  // described on `TeamQueue.cycles`: it made every rating in every cycle but
  // the newest unreachable for the lead who owed it.
  const { data: cycleRows } = await supabase
    .from("evaluation_cycles")
    .select("id, name, period_label, self_due_on, lead_due_on")
    .eq("status", "ACTIVE")
    // A binned cycle is still ACTIVE — 0032's recycle bin is a `deleted_at`,
    // not a status. Without this the queue could open on a cycle HR had
    // already thrown away, and every count on the screen would describe it.
    .is("deleted_at", null)
    .order("starts_on", { ascending: false });

  const activeCycles = cycleRows ?? [];
  if (activeCycles.length === 0) return EMPTY;

  const cycleIds = activeCycles.map((c) => c.id);
  const byCycleId = new Map(activeCycles.map((c) => [c.id, c]));

  const cycles: TeamCycle[] = activeCycles.map((c) => ({
    id: c.id,
    name: c.name,
    periodLabel: c.period_label,
    leadDueOn: c.lead_due_on,
  }));

  /* -- The lead's own evaluations, for the banner -- */
  //
  // Read here rather than linked from the table: §9 scopes them by the
  // evaluatee policy, not the lead policy, and P6-8 already established that a
  // lead's own appraisal lives at /my-evaluation. The banner links there;
  // nothing on this screen ever opens one as a review.
  //
  // `.in(...)` rather than `.maybeSingle()`: with two cycles open that call
  // does not merely return the wrong one, it ERRORS — PostgREST refuses a
  // single-row request that matches more than one row — so the banner would
  // have vanished entirely the moment a second cycle launched.
  const { data: ownRows } = await supabase
    .from("evaluations")
    .select("id, status, cycle_id")
    .in("cycle_id", cycleIds)
    .eq("evaluatee_id", profileId)
    .is("excluded_at", null);

  /* -- The reports, across every active cycle -- */
  const { data: evaluations } = await supabase
    .from("evaluations")
    // `self_submitted_at` is NOT selected. Fetching it and then not rendering
    // it would leave the leak one careless line away; not fetching it means the
    // signal is not in the process at all.
    .select(
      "id, evaluatee_id, status, lead_submitted_at, co_lead_submitted_at, department_id, cycle_id, lead_id, co_lead_id",
    )
    .in("cycle_id", cycleIds)
    /* -- BOTH relationships. A Design Coordinator is nobody's `lead_id`, so
          filtering on that alone showed them an empty queue while three forms
          waited for them. `.or` rather than two queries: one round trip, and
          one place the two conditions can be seen together. -- */
    .or(`lead_id.eq.${profileId},co_lead_id.eq.${profileId}`)
    // §P10-6: a withdrawal is not a status. An excluded row is not work the
    // organisation is still asking for, so it leaves the queue entirely.
    .is("excluded_at", null);

  /* -- Built once, used by both the empty return and the full one. A HOD with
        no reports still needs their own banner. -- */
  const ownEvaluations = (ownRows ?? []).flatMap((row) => {
    const c = byCycleId.get(row.cycle_id);
    return c
      ? [{ id: row.id, status: row.status, selfDueOn: c.self_due_on, cycleName: c.name }]
      : [];
  });

  const rowsRaw = evaluations ?? [];
  if (rowsRaw.length === 0) {
    return { ...EMPTY, cycles, ownEvaluations };
  }

  const employeeIds = rowsRaw.map((r) => r.evaluatee_id);

  const [{ data: people }, { data: departments }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, employee_code, designation, department_id")
      .in("id", employeeIds),
    supabase.from("departments").select("id, name"),
    // The audit read that used to sit here is gone. It looked for
    // SELF_SUBMITTED → CYCLE_ACTIVE so the queue could say "returned" — which
    // is a fact about the EMPLOYEE'S side. Returns are HR's now (§8), and a
    // lead has no business knowing one happened.
  ]);

  /* -- "In progress" needs to know a LEAD draft exists. Read from the LEAD
        layer only, which is the sole layer 0021 leaves the lead able to see —
        so this query cannot become a leak even by accident. -- */
  /* -- `answers`, not just the row's existence.
        `launch_cycle` creates BOTH response rows at launch (PR-7) so each side
        has something to write into — which meant this Set contained every
        evaluation in the cycle from the moment it opened, and every row
        reported "You have started this" to a HOD who had not opened anything.
        A queue that says you have started all of it is a queue nobody can
        work, and it made the counts above it wrong in the same stroke.

        A draft is answers somebody actually gave. -- */
  const { data: drafts } = await supabase
    .from("evaluation_responses")
    .select("evaluation_id, answers, layer")
    /* -- Both manager layers, matched per row below. Reading only LEAD would
          report every coordinator's started review as untouched; reading them
          together and NOT matching would report a team leader's draft as the
          coordinator's, which is worse — it is one manager's progress shown to
          the other (§5). -- */
    .in("layer", ["LEAD", "LEAD_2"])
    .in("evaluation_id", rowsRaw.map((r) => r.id));

  const draftedIds = new Set(
    (drafts ?? [])
      .filter((d) => Object.keys((d.answers ?? {}) as Record<string, unknown>).length > 0)
      // Keyed by BOTH, so a team leader's draft can never report as the
      // coordinator's — that would be one manager's progress read off the
      // other's screen (§5).
      .map((d) => `${d.evaluation_id}:${d.layer}`),
  );

  const byPerson = new Map((people ?? []).map((p) => [p.id, p]));
  const byDepartment = new Map((departments ?? []).map((d) => [d.id, d.name]));

  const rows: TeamRow[] = rowsRaw.map((row) => {
    const person = byPerson.get(row.evaluatee_id);

    /* -- Per ROW, not per queue. This was hoisted out of the loop when there
          could only be one cycle; with two, a single shared deadline would mark
          rows overdue against the wrong cycle's date — and 0022 gave each
          evaluation its own due dates precisely because a rolling cycle gives
          two people in one cycle different deadlines. -- */
    const rowCycle = byCycleId.get(row.cycle_id);
    const daysToLeadDue = daysUntil(rowCycle?.lead_due_on ?? null);

    /* -- Which manager the viewer is HERE. The same person can be the reporting
          lead of one report and the second reviewer of another, so this is a
          property of the row and everything below follows it. `lead_id` wins
          when somebody is somehow both: it is the relationship the rest of the
          system is built around, and 0084 refuses that combination at launch in
          any case. -- */
    const layer: ReviewerLayer = row.lead_id === profileId ? "LEAD" : "LEAD_2";
    const mySubmittedAt = layer === "LEAD" ? row.lead_submitted_at : row.co_lead_submitted_at;

    /* -- The lead's own three states, derived from their own timestamp and
          their own draft. Nothing here consults the record's status beyond
          whether the cycle is still open to them. -- */
    const leadState: TeamRow["leadState"] = mySubmittedAt
      ? "submitted"
      : draftedIds.has(`${row.id}:${layer}`)
        ? "in_progress"
        : "not_started";

    // Only work still on the lead's desk can be late. Once they have submitted,
    // the deadline has been met whatever the calendar says.
    const isOverdue = daysToLeadDue !== null && daysToLeadDue < 0 && leadState !== "submitted";

    const chipStatus: ChipStatus = isOverdue
      ? "OVERDUE"
      : leadState === "submitted"
        // The chip means "this lead has submitted THEIR review" — it is the
        // lead's own queue, and under §5 it says nothing about the employee.
        // SELF_SUBMITTED was the retired enum value that happened to render
        // "Submitted"; PENDING_HR_REVIEW is the live status that means the same
        // thing on this screen and does not read as somebody else's progress.
        ? "PENDING_HR_REVIEW"
        : "OPEN";

    return {
      evaluationId: row.id,
      layer,
      employeeId: row.evaluatee_id,
      name: person?.full_name ?? "Unknown",
      employeeCode: person?.employee_code ?? null,
      designation: person?.designation ?? null,
      departmentName: row.department_id ? (byDepartment.get(row.department_id) ?? null) : null,
      status: row.status,
      chipStatus,
      leadState,
      leadSubmittedAt: mySubmittedAt,
      daysToLeadDue,
      isOverdue,
      isSelfLed: row.evaluatee_id === profileId,
      cycleId: row.cycle_id,
      cycleName: rowCycle?.name ?? "Cycle",
      periodLabel: rowCycle?.period_label ?? null,
    };
  });

  // AMEND-3: sort by DUE DATE. Rows within one cycle share a lead due date, so
  // this settles to name order within it — which is the point. The old sort
  // ranked by how long each report had been waiting since THEY submitted, and
  // that ordering was itself a readout of the other side.
  //
  // Across cycles the due date still leads, so the most urgent work is at the
  // top whichever cycle it belongs to. Name breaks the tie before the cycle
  // does: somebody scanning for a person should find both of their rows
  // together rather than at opposite ends of the list.
  rows.sort((a, b) => {
    const aDue = a.daysToLeadDue ?? Number.MAX_SAFE_INTEGER;
    const bDue = b.daysToLeadDue ?? Number.MAX_SAFE_INTEGER;
    return aDue - bDue || a.name.localeCompare(b.name) || a.cycleName.localeCompare(b.cycleName);
  });

  return {
    cycles,
    rows,
    counts: {
      notStarted: rows.filter((r) => r.leadState === "not_started").length,
      inProgress: rows.filter((r) => r.leadState === "in_progress").length,
      submitted: rows.filter((r) => r.leadState === "submitted").length,
    },
    ownEvaluations,
  };
}

/**
 * Whether this person is the manager on ANY evaluation, live or past.
 *
 * BEING SOMEBODY'S MANAGER IS A RELATIONSHIP, NOT A ROLE, and conflating the
 * two is what hid My Team from a manager who had people to rate.
 *
 * `evaluations.lead_id` is what decides who rates whom: it is copied at launch
 * (P3-6) so a reorganisation cannot reassign an in-flight review, it is what
 * this queue filters on, and it is what `is_lead_of_evaluation` enforces in
 * RLS. The `HOD` role is a separate thing — a configuration tick HR sets on the
 * Users screen — and nothing makes assigning somebody as a manager grant it.
 *
 * So a person could be named as the manager on three launched evaluations,
 * receive all three invite links, and have no My Team in their sidebar and no
 * route to it: the queue would have found their work, and nothing let them
 * reach the queue. P4-7 settled the same point for transitions — "actors are
 * roles AND relationships" — and the navigation never learned it.
 *
 * RLS answers this, not a role check: `evaluations` admits a row to the person
 * named on it as lead, so an empty result means they genuinely lead nobody.
 */
export async function leadsAnyEvaluation(profileId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("evaluations")
    .select("id")
    /* -- Both relationships, or a Design Coordinator gets no My Team link at
          all: the queue would find their work and nothing would let them
          reach it — the exact failure this function was written to fix, one
          relationship later. -- */
    .or(`lead_id.eq.${profileId},co_lead_id.eq.${profileId}`)
    .is("excluded_at", null)
    .limit(1);
  return (data ?? []).length > 0;
}
