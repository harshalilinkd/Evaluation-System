/** The lead's queue at /team. Reads only — every write goes through the state machine. */

import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { ChipStatus } from "@/components/appraise/status-chip";
import type { EvaluationStatus } from "@/lib/evaluations/transitions";

export type TeamRow = {
  evaluationId: string;
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
};

export type TeamQueue = {
  cycleId: string | null;
  cycleName: string | null;
  periodLabel: string | null;
  leadDueOn: string | null;
  rows: TeamRow[];
  /** Counted over the LEAD side only, for the same reason as `leadState`. */
  counts: { notStarted: number; inProgress: number; submitted: number };
  /** The lead's OWN evaluation, for the reminder banner. Never openable from here. */
  ownEvaluation: {
    id: string;
    status: EvaluationStatus;
    selfDueOn: string | null;
  } | null;
};

const EMPTY: TeamQueue = {
  cycleId: null,
  cycleName: null,
  periodLabel: null,
  leadDueOn: null,
  rows: [],
  counts: { notStarted: 0, inProgress: 0, submitted: 0 },
  ownEvaluation: null,
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

  /* -- Which cycle -- */
  //
  // The most recent ACTIVE cycle. A lead reviews one cycle at a time, and
  // showing two at once would put the same person on screen twice with
  // different deadlines.
  const { data: cycle } = await supabase
    .from("evaluation_cycles")
    .select("id, name, period_label, self_due_on, lead_due_on")
    .eq("status", "ACTIVE")
    .order("starts_on", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!cycle) return EMPTY;

  /* -- The lead's own evaluation, for the banner -- */
  //
  // Read here rather than linked from the table: §9 scopes it by the evaluatee
  // policy, not the lead policy, and P6-8 already established that a lead's own
  // appraisal lives at /my-evaluation. The banner links there; nothing on this
  // screen ever opens it as a review.
  const { data: own } = await supabase
    .from("evaluations")
    .select("id, status")
    .eq("cycle_id", cycle.id)
    .eq("evaluatee_id", profileId)
    .is("excluded_at", null)
    .maybeSingle();

  /* -- The reports -- */
  const { data: evaluations } = await supabase
    .from("evaluations")
    // `self_submitted_at` is NOT selected. Fetching it and then not rendering
    // it would leave the leak one careless line away; not fetching it means the
    // signal is not in the process at all.
    .select("id, evaluatee_id, status, lead_submitted_at, department_id")
    .eq("cycle_id", cycle.id)
    .eq("lead_id", profileId)
    // §P10-6: a withdrawal is not a status. An excluded row is not work the
    // organisation is still asking for, so it leaves the queue entirely.
    .is("excluded_at", null);

  const rowsRaw = evaluations ?? [];
  if (rowsRaw.length === 0) {
    return {
      ...EMPTY,
      cycleId: cycle.id,
      cycleName: cycle.name,
      periodLabel: cycle.period_label,
      leadDueOn: cycle.lead_due_on,
      ownEvaluation: own
        ? { id: own.id, status: own.status, selfDueOn: cycle.self_due_on }
        : null,
    };
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
  const { data: drafts } = await supabase
    .from("evaluation_responses")
    .select("evaluation_id")
    .eq("layer", "LEAD")
    .in("evaluation_id", rowsRaw.map((r) => r.id));
  const draftedIds = new Set((drafts ?? []).map((d) => d.evaluation_id));

  const byPerson = new Map((people ?? []).map((p) => [p.id, p]));
  const byDepartment = new Map((departments ?? []).map((d) => [d.id, d.name]));

  const daysToLeadDue = daysUntil(cycle.lead_due_on);

  const rows: TeamRow[] = rowsRaw.map((row) => {
    const person = byPerson.get(row.evaluatee_id);

    /* -- The lead's own three states, derived from their own timestamp and
          their own draft. Nothing here consults the record's status beyond
          whether the cycle is still open to them. -- */
    const leadState: TeamRow["leadState"] = row.lead_submitted_at
      ? "submitted"
      : draftedIds.has(row.id)
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
      employeeId: row.evaluatee_id,
      name: person?.full_name ?? "Unknown",
      employeeCode: person?.employee_code ?? null,
      designation: person?.designation ?? null,
      departmentName: row.department_id ? (byDepartment.get(row.department_id) ?? null) : null,
      status: row.status,
      chipStatus,
      leadState,
      leadSubmittedAt: row.lead_submitted_at,
      daysToLeadDue,
      isOverdue,
      isSelfLed: row.evaluatee_id === profileId,
    };
  });

  // AMEND-3: sort by DUE DATE. Every row in a cycle shares one lead due date,
  // so this settles to name order within it — which is the point. The old sort
  // ranked by how long each report had been waiting since THEY submitted, and
  // that ordering was itself a readout of the other side.
  rows.sort((a, b) => {
    const aDue = a.daysToLeadDue ?? Number.MAX_SAFE_INTEGER;
    const bDue = b.daysToLeadDue ?? Number.MAX_SAFE_INTEGER;
    return aDue - bDue || a.name.localeCompare(b.name);
  });

  return {
    cycleId: cycle.id,
    cycleName: cycle.name,
    periodLabel: cycle.period_label,
    leadDueOn: cycle.lead_due_on,
    rows,
    counts: {
      notStarted: rows.filter((r) => r.leadState === "not_started").length,
      inProgress: rows.filter((r) => r.leadState === "in_progress").length,
      submitted: rows.filter((r) => r.leadState === "submitted").length,
    },
    ownEvaluation: own ? { id: own.id, status: own.status, selfDueOn: cycle.self_due_on } : null,
  };
}
