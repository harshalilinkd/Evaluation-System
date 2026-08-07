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
  /** Counts for the segmented progress bar, in tier order. */
  progress: { self: number; lead: number; final: number };
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
    supabase.from("evaluations").select("cycle_id").in("cycle_id", ids).is("excluded_at", null),
    supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", cycles.map((c) => c.deleted_by).filter((id): id is string => Boolean(id))),
  ]);

  const counts = new Map<string, number>();
  for (const row of evaluations ?? []) {
    counts.set(row.cycle_id, (counts.get(row.cycle_id) ?? 0) + 1);
  }

  const names = new Map((actors ?? []).map((a) => [a.id, a.full_name] as const));

  return {
    ok: true,
    data: cycles.map((c) => ({
      id: c.id,
      name: c.name,
      periodLabel: c.period_label,
      status: c.status,
      participants: counts.get(c.id) ?? 0,
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
    .select("cycle_id, status, self_submitted_at, lead_submitted_at")
    .is("excluded_at", null);

  if (evaluationError) {
    return cycleError("QUERY_FAILED", `Could not read evaluations: ${evaluationError.message}`);
  }

  const tally = new Map<string, { participants: number; self: number; lead: number; final: number }>();
  for (const row of evaluations ?? []) {
    const entry = tally.get(row.cycle_id) ?? { participants: 0, self: 0, lead: 0, final: 0 };
    entry.participants += 1;
    if (reachedSelf(row)) entry.self += 1;
    if (reachedLead(row)) entry.lead += 1;
    if (reachedFinal(row)) entry.final += 1;
    tally.set(row.cycle_id, entry);
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
        progress: { self: counts.self, lead: counts.lead, final: counts.final },
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
};

const PAST_OPEN: ReadonlyArray<Enums<"evaluation_status">> = [
  "PENDING_HR_REVIEW", "HR_APPROVED", "MD_REVIEWED", "INTERVIEW_DONE", "CLOSED",
];

function reachedSelf(row: ProgressRow) {
  return row.self_submitted_at !== null || PAST_OPEN.includes(row.status);
}
function reachedLead(row: ProgressRow) {
  return row.lead_submitted_at !== null || PAST_OPEN.includes(row.status);
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
    .select("id, full_name, employee_code, designation, department_id, reports_to, email, phone_e164")
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
        Two queries for everybody rather than three per row: forty people would
        otherwise be a hundred and twenty round trips to render one list. */
  const [{ data: employment }, { data: pastEvaluations }] = await Promise.all([
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
  ]);

  const employmentBy = new Map((employment ?? []).map((row) => [row.profile_id, row] as const));

  // First wins: the select above is newest-first, so the first row seen for a
  // person is their most recent evaluation.
  const lastEvaluationBy = new Map<string, string>();
  for (const row of pastEvaluations ?? []) {
    if (!lastEvaluationBy.has(row.evaluatee_id)) {
      lastEvaluationBy.set(row.evaluatee_id, row.created_at);
    }
  }

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

export async function getCycleBoard(cycleId: string): Promise<CycleResult<CycleBoard>> {
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
    .select("id, evaluatee_id, lead_id, department_id, status, updated_at, self_submitted_at, lead_submitted_at, md_finalized_at, excluded_at, excluded_reason, self_skipped, lead_skipped, due_self_on, due_lead_on")
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
