/** The batch pack's data. P15 route 2 — 47 people without freezing a browser. */

import "server-only";

import { cycleError, type CycleResult } from "@/lib/cycles/schema";
import { buildPrintDocument, type PrintDocument } from "@/lib/print/document";
import { createClient } from "@/lib/supabase/server";
import { managerFigure, managerOverallByEvaluation } from "@/lib/evaluations/manager-overall";

export type SummaryRow = {
  evaluationId: string;
  name: string;
  employeeCode: string | null;
  department: string;
  self: number | null;
  lead: number | null;
  final: number | null;
  promotion: string | null;
  incrementPct: number | null;
};

export type BatchPack = {
  cycle: { id: string; name: string; periodLabel: string };
  generatedOn: string;
  total: number;
  byDepartment: Array<{ name: string; count: number }>;
  decisionSummary: { promoted: number; considered: number; notPromoted: number; withIncrement: number };
  summary: SummaryRow[];
  /** Absent when only the summary was asked for. */
  documents: PrintDocument[];
};

export type BatchFilter = {
  departmentId?: string | null;
  /** Only finalised, or everything the cycle contains. */
  finalisedOnly?: boolean;
  /** Redacted copies, for handing to employees. */
  employeeCopies?: boolean;
  /** Skip the full documents entirely — route 3 wants the summary alone. */
  summaryOnly?: boolean;
};

/**
 * PRINT PERFORMANCE.
 *
 * P15: "47 evaluations must render without freezing the browser. Paginate
 * server-side and stream."
 *
 * Two things make that true, and neither is a trick:
 *
 *   1. Every document is assembled HERE, on the server, and every component
 *      that renders one is a server component. The browser receives finished
 *      HTML — there is nothing to hydrate, so there is no main-thread work
 *      proportional to the number of people in the pack.
 *
 *   2. The documents are built with a bounded concurrency rather than 47
 *      Promise.all at once. Each one issues five queries; 47 in parallel is 235
 *      simultaneous connections, which does not fail cleanly — it queues inside
 *      the pooler and the whole page hangs on the slowest.
 *
 * The route itself streams because it is an async server component: Next flushes
 * the cover sheet and the summary while the documents are still being built.
 */
const CONCURRENCY = 6;

export async function buildBatchPack(
  cycleId: string,
  filter: BatchFilter = {},
): Promise<CycleResult<BatchPack>> {
  const supabase = await createClient();

  const { data: cycle } = await supabase
    .from("evaluation_cycles")
    .select("id, name, period_label")
    .eq("id", cycleId)
    .maybeSingle();

  if (!cycle) return cycleError("NOT_FOUND", "That cycle no longer exists.");

  let query = supabase
    .from("evaluations")
    .select("id, evaluatee_id, department_id, status, self_overall, lead_overall, final_overall")
    .eq("cycle_id", cycleId)
    .is("excluded_at", null);

  if (filter.departmentId) query = query.eq("department_id", filter.departmentId);
  /* -- AMEND-3 renamed MD_FINALIZED to MD_REVIEWED and added INTERVIEW_DONE on
        the increment path. "Print all finalised" matched nothing, so the batch
        pack came back empty on every cycle. -- */
  if (filter.finalisedOnly !== false) {
    query = query.in("status", ["MD_REVIEWED", "INTERVIEW_DONE", "CLOSED"]);
  }

  const { data: evaluations, error } = await query;
  if (error) return cycleError("QUERY_FAILED", error.message);

  const rows = evaluations ?? [];

  const { data: people } = await supabase
    .from("profiles")
    .select("id, full_name, employee_code")
    .in("id", rows.length > 0 ? rows.map((r) => r.evaluatee_id) : ["00000000-0000-0000-0000-000000000000"]);

  const { data: departments } = await supabase.from("departments").select("id, name");

  const { data: decisions } = await supabase
    .from("evaluation_decisions")
    .select("evaluation_id, promotion_recommendation, increment_type, increment_pct")
    .in("evaluation_id", rows.length > 0 ? rows.map((r) => r.id) : ["00000000-0000-0000-0000-000000000000"]);

  // One read for the whole pack, beside the other three. Forty-seven RPC calls
  // is what P15-5 capped concurrency to avoid.
  const managerOveralls = await managerOverallByEvaluation(supabase, rows.map((r) => r.id));

  const nameOf = new Map((people ?? []).map((p) => [p.id, p]));
  const deptName = new Map((departments ?? []).map((d) => [d.id, d.name]));
  const decisionOf = new Map((decisions ?? []).map((d) => [d.evaluation_id, d]));

  const summary: SummaryRow[] = rows
    .map((row) => {
      const person = nameOf.get(row.evaluatee_id);
      const decision = decisionOf.get(row.id);
      return {
        evaluationId: row.id,
        name: person?.full_name ?? "Unknown",
        employeeCode: person?.employee_code ?? null,
        department: row.department_id ? (deptName.get(row.department_id) ?? "—") : "—",
        self: row.self_overall,
        // The MANAGER figure (0087): for a designer, both of their managers.
        // A summary sheet showing half a review is worse than one showing none,
        // because nothing about it says a figure is missing.
        lead: managerFigure(row.id, row.lead_overall, managerOveralls),
        final: row.final_overall,
        promotion: decision?.promotion_recommendation ?? null,
        incrementPct: decision?.increment_pct ?? null,
      };
    })
    // Grouped by department then by name, so a printed sheet can be handed to
    // one head of department without them reading past everyone else.
    .sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name));

  const byDepartment = new Map<string, number>();
  for (const row of summary) byDepartment.set(row.department, (byDepartment.get(row.department) ?? 0) + 1);

  const decisionSummary = {
    promoted: summary.filter((s) => s.promotion === "Yes").length,
    considered: summary.filter((s) => s.promotion === "Can be considered").length,
    notPromoted: summary.filter((s) => s.promotion === "No").length,
    withIncrement: (decisions ?? []).filter((d) => d.increment_type === "New").length,
  };

  /* -- The documents, in bounded batches -- */
  const documents: PrintDocument[] = [];
  if (!filter.summaryOnly) {
    const audience = filter.employeeCopies ? "employee" : "internal";
    for (let i = 0; i < summary.length; i += CONCURRENCY) {
      const slice = summary.slice(i, i + CONCURRENCY);
      const built = await Promise.all(
        slice.map((s) => buildPrintDocument(s.evaluationId, audience)),
      );
      for (const one of built) {
        // One unreadable evaluation must not take the whole pack down — the
        // summary still lists them, and the person printing can chase it.
        if (one.ok) documents.push(one.data);
      }
    }
  }

  return {
    ok: true,
    data: {
      cycle: { id: cycle.id, name: cycle.name, periodLabel: cycle.period_label },
      generatedOn: new Date().toISOString(),
      total: summary.length,
      byDepartment: [...byDepartment.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      decisionSummary,
      summary,
      documents,
    },
  };
}
