/** The HR report queue (P20). Reads through the authenticated client — RLS decides. */

import "server-only";

import { cycleError, type CycleResult } from "@/lib/cycles/schema";
import { DEFAULT_VARIANCE_THRESHOLD } from "@/lib/evaluations/scoring";
import { createClient } from "@/lib/supabase/server";
import type { Enums } from "@/types/database";

export type QueueRow = {
  evaluationId: string;
  cycleId: string;
  cycleName: string;
  cycleType: string;
  period: string;
  employeeName: string;
  employeeCode: string | null;
  department: string | null;
  status: Enums<"evaluation_status">;
  selfAverage: number | null;
  leadAverage: number | null;
  /** The agreed figure recorded at completion. Null until a cycle is closed. */
  finalAverage: number | null;
  /** Lead − Self. §11: HR and the MD only. */
  gap: number | null;
  flaggedCount: number;
  /** Whole days since the record reached HR. */
  daysWaiting: number | null;
  selfSkipped: boolean;
  leadSkipped: boolean;
  skipReason: string | null;
};

export type ReportQueue = {
  rows: QueueRow[];
  /**
   * One side in, the other not — readable, not yet reviewable.
   *
   * HR could not see these at all before: the queue started at
   * PENDING_HR_REVIEW, so an employee's answers sat unread until their HOD
   * caught up. §9 gives HR both layers at every status; the waiting was the
   * screen's, not the policy's.
   */
  partlyIn: number;
  pendingHr: number;
  withMd: number;
  /** Reviewed by the MD, still to be closed. INTERVIEW_DONE counts too. */
  readyToClose: number;
  closedThisCycle: number;
  /** The longest anything has been waiting, in days. */
  oldestWaiting: number | null;
  cycles: Array<{ id: string; name: string }>;
  departments: string[];
};

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso);
  const now = new Date();
  return Math.max(0, Math.floor((now.getTime() - then.getTime()) / 86_400_000));
}

/**
 * Everything HR has to look at.
 *
 * The gap is computed here rather than read from a view because it is the sort
 * key: §11 defines it as Lead − Self, and the default ordering is by its
 * ABSOLUTE value, largest first — that is where HR's attention is worth most,
 * and a lead who rated two points *below* the employee matters exactly as much
 * as one who rated two points above.
 */
export async function getReportQueue(): Promise<CycleResult<ReportQueue>> {
  const supabase = await createClient();

  const { data: evaluations, error } = await supabase
    .from("evaluations")
    .select(
      // `final_overall` is the score HR agreed with the MD at completion. It
      // was never selected, so nothing downstream could show it.
      "id, cycle_id, evaluatee_id, co_lead_id, department_id, status, self_submitted_at, lead_submitted_at, co_lead_submitted_at, self_skipped, lead_skipped, co_lead_skipped, final_overall, updated_at, evaluation_cycles!inner(deleted_at)",
    )
    /* -- OPEN IS IN THE LIST NOW, at the owner's instruction.
          A record appeared here only once BOTH sides had submitted, so an
          employee could have filled their form days ago and HR had no way to
          read it — the answers existed and no screen showed them. HR is one of
          only two roles §9 permits to read either layer, and nothing about
          waiting for the second side makes the first unreadable.

          The rows are filtered below to those where at least ONE side is
          actually in: an OPEN evaluation nobody has touched has nothing to
          show, and listing it would bury the ones that do among the whole
          roster.

          §5 IS UNTOUCHED. This widens what HR sees, and HR already reads both
          layers — it grants nothing to a lead or an employee, and every read
          still goes through the authenticated client so RLS decides. What
          changes is the WAITING, not the permission. -- */
    .in("status", ["OPEN", "PENDING_HR_REVIEW", "HR_APPROVED", "MD_REVIEWED", "INTERVIEW_DONE", "CLOSED"])
    .is("excluded_at", null)
    // A binned cycle's records leave the queue with it. Without this, binning a
    // cycle cleared it from every list except the one HR works from.
    .is("evaluation_cycles.deleted_at", null)
    .eq("track", "STAFF");

  if (error) return cycleError("QUERY_FAILED", `Could not read the queue: ${error.message}`);

  /* -- An OPEN record earns its place by having something in it.
        Nobody has touched it → nothing to read, and listing it would bury the
        records that DO have answers among the entire roster. A skipped layer
        counts as in: HR advanced past it deliberately (§8), so the other side
        is all there is going to be. -- */
  const list = (evaluations ?? []).filter(
    (e) =>
      e.status !== "OPEN" ||
      Boolean(e.self_submitted_at) ||
      Boolean(e.lead_submitted_at) ||
      e.self_skipped ||
      e.lead_skipped,
  );
  if (list.length === 0) {
    return {
      ok: true,
      data: { rows: [], partlyIn: 0, pendingHr: 0, withMd: 0, readyToClose: 0, closedThisCycle: 0, oldestWaiting: null, cycles: [], departments: [] },
    };
  }

  const evaluationIds = list.map((e) => e.id);
  const cycleIds = [...new Set(list.map((e) => e.cycle_id))];
  const personIds = [...new Set(list.map((e) => e.evaluatee_id))];
  const departmentIds = [...new Set(list.map((e) => e.department_id).filter((v): v is string => Boolean(v)))];

  const [{ data: cycles }, { data: people }, { data: departments }, { data: responses }] =
    await Promise.all([
      supabase
        .from("evaluation_cycles")
        .select("id, name, period_label, cycle_type, variance_threshold")
        .in("id", cycleIds),
      supabase.from("profiles").select("id, full_name, employee_code").in("id", personIds),
      departmentIds.length
        ? supabase.from("departments").select("id, name").in("id", departmentIds)
        : Promise.resolve({ data: [] }),
      // Both layers, which only HR and the MD can read — the queue is behind the
      // same guard, and RLS refuses anybody else regardless.
      supabase
        .from("evaluation_responses")
        .select("evaluation_id, layer, overall_score")
        .in("evaluation_id", evaluationIds),
    ]);

  const cycleById = new Map((cycles ?? []).map((c) => [c.id, c]));
  const personById = new Map((people ?? []).map((p) => [p.id, p]));
  const departmentById = new Map((departments ?? []).map((d) => [d.id, d.name]));

  const scoreOf = new Map<string, { self: number | null; lead: number | null }>();
  for (const row of responses ?? []) {
    const entry = scoreOf.get(row.evaluation_id) ?? { self: null, lead: null };
    if (row.layer === "SELF") entry.self = row.overall_score;
    if (row.layer === "LEAD") entry.lead = row.overall_score;
    scoreOf.set(row.evaluation_id, entry);
  }

  // Flagged counts come from the stored per-question figures rather than a
  // re-assembly of every form: the queue may carry hundreds of rows, and
  // building two snapshots each would make the screen unusable. The report
  // itself recomputes from the snapshot, which is the authoritative number.
  const { data: flags } = await supabase
    .from("evaluation_responses")
    .select("evaluation_id, layer, answers")
    .in("evaluation_id", evaluationIds);

  const answersOf = new Map<string, { self: Record<string, unknown>; lead: Record<string, unknown> }>();
  for (const row of flags ?? []) {
    const entry = answersOf.get(row.evaluation_id) ?? { self: {}, lead: {} };
    if (row.layer === "SELF") entry.self = (row.answers ?? {}) as Record<string, unknown>;
    if (row.layer === "LEAD") entry.lead = (row.answers ?? {}) as Record<string, unknown>;
    answersOf.set(row.evaluation_id, entry);
  }

  const { data: skipAudit } = await supabase
    .from("audit_log")
    .select("entity_id, diff")
    .eq("entity", "evaluation")
    .eq("action", "evaluation.hr_advance")
    .in("entity_id", evaluationIds);

  const skipReasonOf = new Map<string, string>();
  for (const row of skipAudit ?? []) {
    const diff = (row.diff ?? {}) as { reason?: string };
    if (diff.reason) skipReasonOf.set(row.entity_id, diff.reason);
  }

  const rows: QueueRow[] = list.map((e) => {
    const cycle = cycleById.get(e.cycle_id);
    const person = personById.get(e.evaluatee_id);
    const scores = scoreOf.get(e.id) ?? { self: null, lead: null };
    const threshold = cycle?.variance_threshold ?? DEFAULT_VARIANCE_THRESHOLD;

    /* -- SAME RULE AS THE REPORT: a draft is not a rating.
          `answers` is autosaved from the first keystroke (0011), so counting a
          flag against a half-filled lead layer reports a disagreement with
          somebody who has not finished forming one. The stored `overall_score`
          columns above are already correct — they are written at submission —
          and this loop was the one place in the queue reading the raw blob.
          A skipped layer counts as in (§8: HR advanced past it deliberately). -- */
    /* -- ALL of them, not both. A designer has three layers (0083), and
          counting flags on two of three would compare the employee against
          half the managers who were asked — a disagreement measured against an
          incomplete review, which is the same fault this block was written to
          fix one layer down.

          Written as "no outstanding layer" so a person with one manager is
          unaffected: the third clause is vacuously true when `co_lead_id` is
          null, exactly as 0083's completion rule is. -- */
    const bothIn =
      (Boolean(e.self_submitted_at) || e.self_skipped) &&
      (Boolean(e.lead_submitted_at) || e.lead_skipped) &&
      (!e.co_lead_id || Boolean(e.co_lead_submitted_at) || e.co_lead_skipped);
    const answers = bothIn ? (answersOf.get(e.id) ?? { self: {}, lead: {} }) : { self: {}, lead: {} };
    let flagged = 0;
    for (const [questionId, selfValue] of Object.entries(answers.self)) {
      const leadValue = answers.lead[questionId];
      if (typeof selfValue !== "number" || typeof leadValue !== "number") continue;
      if (Math.abs(leadValue - selfValue) >= threshold) flagged += 1;
    }

    return {
      evaluationId: e.id,
      cycleId: e.cycle_id,
      cycleName: cycle?.name ?? "—",
      cycleType: cycle?.cycle_type === "INCREMENT" ? "Increment" : "Evaluation",
      period: cycle?.period_label ?? "",
      employeeName: person?.full_name ?? "Unknown",
      employeeCode: person?.employee_code ?? null,
      department: e.department_id ? (departmentById.get(e.department_id) ?? null) : null,
      status: e.status,
      selfAverage: scores.self,
      leadAverage: scores.lead,
      finalAverage: e.final_overall === null ? null : Number(e.final_overall),
      gap: scores.self === null || scores.lead === null ? null : Math.round((scores.lead - scores.self) * 100) / 100,
      flaggedCount: flagged,
      // Waiting is measured from the later of the two submissions — the moment
      // the record actually became HR's to look at.
      daysWaiting: daysSince(
        [e.self_submitted_at, e.lead_submitted_at].filter(Boolean).sort().at(-1) ?? e.updated_at,
      ),
      selfSkipped: e.self_skipped ?? false,
      leadSkipped: e.lead_skipped ?? false,
      skipReason: skipReasonOf.get(e.id) ?? null,
    };
  });

  // Largest absolute gap first. A null gap sorts last: it means one side never
  // came in, which the skipped marker already surfaces.
  rows.sort((a, b) => {
    const ga = a.gap === null ? -1 : Math.abs(a.gap);
    const gb = b.gap === null ? -1 : Math.abs(b.gap);
    return gb - ga || (b.daysWaiting ?? 0) - (a.daysWaiting ?? 0);
  });

  /* -- The fifth tile, and the comment below is why it exists at the same time
        as the widened filter: a status the query admits and no tile counts is
        one that vanishes from the row above while sitting plainly in the table.
        OPEN records are the ones where one side is in and the other is not. -- */
  const partlyIn = rows.filter((r) => r.status === "OPEN");

  const pending = rows.filter((r) => r.status === "PENDING_HR_REVIEW");

  /* -- THE TILES HAD A HOLE IN THE MIDDLE OF §8.
        The query fetches five statuses and the three counters covered three of
        them: PENDING_HR_REVIEW, HR_APPROVED and CLOSED. A record the MD had
        reviewed — MD_REVIEWED, or INTERVIEW_DONE on an increment — was counted
        by NONE of them, so the moment the MD did their job the record vanished
        from every tile and the row above read 0 · 0 · 0 with a report plainly
        sitting in the table.

        A counter that silently drops a state is worse than no counter: it does
        not look broken, it looks like there is no work. Both remaining statuses
        now have a home, and the four together cover every status the query
        admits — so this cannot happen again without somebody widening the `in`
        filter and not the tiles. -- */
  const readyToClose = rows.filter(
    (r) => r.status === "MD_REVIEWED" || r.status === "INTERVIEW_DONE",
  ).length;

  return {
    ok: true,
    data: {
      rows,
      partlyIn: partlyIn.length,
      pendingHr: pending.length,
      withMd: rows.filter((r) => r.status === "HR_APPROVED").length,
      readyToClose,
      closedThisCycle: rows.filter((r) => r.status === "CLOSED").length,
      oldestWaiting: pending.reduce<number | null>(
        (max, r) => (r.daysWaiting !== null && (max === null || r.daysWaiting > max) ? r.daysWaiting : max),
        null,
      ),
      cycles: [...cycleById.values()].map((c) => ({ id: c.id, name: c.name })),
      departments: [...new Set(rows.map((r) => r.department).filter((v): v is string => Boolean(v)))].sort(),
    },
  };
}
