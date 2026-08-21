/** The manager figure for evaluations read directly, not through a view (0087). */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

/**
 * What the managers TOGETHER said, per evaluation.
 *
 * `evaluations.lead_overall` is the REPORTING LEAD's average and nothing else,
 * which was the whole of the manager side until 0083. Screens reading it
 * directly — the printed pack, the batch cover, the Team review roster — would
 * show a designer half their review.
 *
 * 0087 solves this for everything that reads `v_employee_history` or
 * `v_department_scores`, by calling `public.manager_overall(id)` inside the
 * view. These three do not go through a view: they select from `evaluations`
 * itself, for their own good reasons. So the same rule is applied here, from
 * the same source — `evaluation_responses.overall_score`, which SR-12
 * established is the authoritative per-layer figure.
 *
 * ONE BATCHED QUERY, not one call per row. The alternative is `.rpc()` per
 * evaluation, and the batch pack builds forty-seven of them at once (P15-5
 * capped concurrency for exactly this reason). Merged in TypeScript rather than
 * joined, because `types/database.ts` is hand-authored and declares no
 * relationship for supabase-js to embed through (P3-7).
 *
 * SUBMITTED ONLY. A response row exists from launch and autosaves from the
 * moment a form is opened; `overall_score` is written at submission. Counting a
 * draft would put a rating nobody stood behind onto a signed document.
 *
 * Read through the CALLER'S client, so RLS decides what comes back — a reader
 * who may not see an evaluation gets no row for it and falls back, rather than
 * this becoming a way to read scores sideways.
 */
export async function managerOverallByEvaluation(
  supabase: SupabaseClient<Database>,
  evaluationIds: readonly string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (evaluationIds.length === 0) return out;

  const { data } = await supabase
    .from("evaluation_responses")
    .select("evaluation_id, layer, overall_score, submitted_at")
    .in("evaluation_id", [...evaluationIds])
    .in("layer", ["LEAD", "LEAD_2"]);

  const perEvaluation = new Map<string, number[]>();
  for (const row of data ?? []) {
    if (row.submitted_at === null || row.overall_score === null) continue;
    const list = perEvaluation.get(row.evaluation_id) ?? [];
    list.push(Number(row.overall_score));
    perEvaluation.set(row.evaluation_id, list);
  }

  for (const [id, scores] of perEvaluation) {
    if (scores.length === 0) continue;
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    // Two decimals, like every other stored and displayed score (§11), so the
    // printed sheet and the view cannot differ in the last digit.
    out.set(id, Math.round(mean * 100) / 100);
  }

  return out;
}

/**
 * The SECOND REVIEWER's own figure, per evaluation — not blended with the
 * reporting lead's the way `managerOverallByEvaluation` deliberately is.
 *
 * Team review shows the reporting manager's score and the mean of both
 * together (HOD, Average) but had nowhere to show the second reviewer's OWN
 * number on its own — the person asking "what did the coordinator actually
 * give them" could not tell that apart from "what did the two average to".
 * Genuinely absent — not just null — for anybody with no second reviewer,
 * which the caller renders as an em dash exactly like an unset HOD figure.
 *
 * A second query rather than deriving this from `managerOverallByEvaluation`'s
 * own fetch: that function's whole job is to throw the per-layer breakdown
 * away, and reaching into it to get it back would make its own "blended,
 * never per-layer" contract a lie the moment somebody needed both.
 */
export async function coReviewerScoreByEvaluation(
  supabase: SupabaseClient<Database>,
  evaluationIds: readonly string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (evaluationIds.length === 0) return out;

  const { data } = await supabase
    .from("evaluation_responses")
    .select("evaluation_id, overall_score, submitted_at")
    .in("evaluation_id", [...evaluationIds])
    .eq("layer", "LEAD_2");

  for (const row of data ?? []) {
    if (row.submitted_at === null || row.overall_score === null) continue;
    out.set(row.evaluation_id, Number(row.overall_score));
  }

  return out;
}

/**
 * The figure to show, with the stored column as the fallback.
 *
 * The two agree by construction where there is one manager — the transition
 * writes both at submission — so this only ever differs for somebody with a
 * second reviewer, which is what makes it safe to drop in behind an existing
 * `lead_overall` read.
 */
export function managerFigure(
  evaluationId: string,
  leadOverall: number | null,
  byEvaluation: Map<string, number>,
): number | null {
  return byEvaluation.get(evaluationId) ?? leadOverall;
}
