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
  pendingHr: number;
  withMd: number;
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
      "id, cycle_id, evaluatee_id, department_id, status, self_submitted_at, lead_submitted_at, self_skipped, lead_skipped, final_overall, updated_at",
    )
    .in("status", ["PENDING_HR_REVIEW", "HR_APPROVED", "MD_REVIEWED", "INTERVIEW_DONE", "CLOSED"])
    .is("excluded_at", null)
    .eq("track", "STAFF");

  if (error) return cycleError("QUERY_FAILED", `Could not read the queue: ${error.message}`);

  const list = evaluations ?? [];
  if (list.length === 0) {
    return {
      ok: true,
      data: { rows: [], pendingHr: 0, withMd: 0, closedThisCycle: 0, oldestWaiting: null, cycles: [], departments: [] },
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

    const answers = answersOf.get(e.id) ?? { self: {}, lead: {} };
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

  const pending = rows.filter((r) => r.status === "PENDING_HR_REVIEW");

  return {
    ok: true,
    data: {
      rows,
      pendingHr: pending.length,
      withMd: rows.filter((r) => r.status === "HR_APPROVED").length,
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
