/** snapshotEvaluation — freezes one evaluation's question list. CLAUDE.md §5. */

import "server-only";

import { assembleQuestions } from "@/lib/forms/assemble";
import { createClient } from "@/lib/supabase/server";
import { formsError, type FormsResult } from "@/lib/forms/types";
import type { TablesInsert } from "@/types/database";

export type SnapshotOutcome = {
  evaluationId: string;
  questionCount: number;
  /** False when a snapshot already existed and was left untouched. */
  created: boolean;
};

/**
 * Freeze the question list for one evaluation into evaluation_questions.
 *
 * IDEMPOTENCY IS NOT AN UPSERT HERE, AND THAT IS THE WHOLE POINT.
 *
 * The obvious implementation — insert ... on conflict do update — would satisfy
 * "running it twice must not duplicate rows" while quietly violating §5: a
 * second run after HR edited the bank would rewrite the frozen text of a
 * launched evaluation, which is exactly what the snapshot rule forbids. An
 * `on conflict do nothing` is no better, because a re-run would then *append*
 * newly added questions to an evaluation someone has already answered.
 *
 * So: if any snapshot row exists for this evaluation, this function does
 * nothing and reports created: false. Re-freezing is not an operation the
 * system offers. Reopening a layer (§8) unlocks answers, never the question set.
 *
 * The unique constraint on (evaluation_id, question_id) backs this up against
 * two launches racing.
 */
export async function snapshotEvaluation(
  evaluationId: string,
): Promise<FormsResult<SnapshotOutcome>> {
  const supabase = await createClient();

  const { data: evaluation, error: evaluationError } = await supabase
    .from("evaluations")
    .select("id, cycle_id, evaluatee_id")
    .eq("id", evaluationId)
    .maybeSingle();

  if (evaluationError) {
    return formsError("QUERY_FAILED", `Could not read evaluation: ${evaluationError.message}`);
  }
  if (!evaluation) {
    return formsError("EVALUATION_NOT_FOUND", `No evaluation with id ${evaluationId}.`);
  }

  /* -- Already frozen? Leave it alone. -- */
  const { count: existingCount, error: countError } = await supabase
    .from("evaluation_questions")
    .select("id", { count: "exact", head: true })
    .eq("evaluation_id", evaluationId);

  if (countError) {
    return formsError("QUERY_FAILED", `Could not check existing snapshot: ${countError.message}`);
  }

  if ((existingCount ?? 0) > 0) {
    return {
      ok: true,
      data: { evaluationId, questionCount: existingCount ?? 0, created: false },
    };
  }

  /* -- Assemble from the live bank -- */
  const assembled = await assembleQuestions(evaluation.evaluatee_id, evaluation.cycle_id);
  if (!assembled.ok) return assembled;

  if (assembled.data.length === 0) {
    // Freezing an empty form would produce an evaluation nobody can fill in and
    // that looks, on every screen, like a bug in the renderer.
    return formsError(
      "SNAPSHOT_EMPTY",
      "Assembly produced no questions for this person. Check the question bank, their track and their department before launching.",
    );
  }

  /* -- Freeze -- */
  const rows: TablesInsert<"evaluation_questions">[] = assembled.data.map((question, index) => ({
    evaluation_id: evaluationId,
    question_id: question.questionId,
    text: question.text,
    help_text: question.helpText,
    section: question.section,
    response_type: question.responseType,
    answered_by: question.answeredBy,
    is_required: question.isRequired,
    min_value: question.minValue,
    max_value: question.maxValue,
    depends_on: question.dependsOn,
    depends_value: question.dependsValue,
    // Only the select types carry choices; storing [] for a textarea would
    // suggest to a future reader that options were expected and are missing.
    options: question.options ? JSON.parse(JSON.stringify(question.options)) : null,
    // Sequential across the whole merged form, in steps of 10 so a later
    // migration can splice a row in without renumbering. Reading the snapshot
    // back by sort_order alone now reproduces the exact order shown.
    sort_order: (index + 1) * 10,
  }));

  const { error: insertError } = await supabase.from("evaluation_questions").insert(rows);

  if (insertError) {
    return formsError("QUERY_FAILED", `Could not write snapshot: ${insertError.message}`);
  }

  return {
    ok: true,
    data: { evaluationId, questionCount: rows.length, created: true },
  };
}
