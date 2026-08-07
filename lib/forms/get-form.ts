/** getEvaluationForm — the single source of truth for rendering any evaluation form. */

import "server-only";

import { createClient } from "@/lib/supabase/server";
import { resolveVisibility } from "@/lib/forms/conditions";
import { getSectionConfig, labelIn } from "@/lib/forms/section-config";
import {
  LAYER_ANSWERED_BY,
  formsError,
  type FormDefinition,
  type FormQuestion,
  type FormSection,
  type FormsResult,
  type QuestionSection,
  type RatingLayer,
  type SnapshotOption,
} from "@/lib/forms/types";

/* ---------- Snapshot row ---------- */

type SnapshotRow = {
  question_id: string;
  text: string;
  help_text: string | null;
  section: QuestionSection;
  response_type: FormQuestion["responseType"];
  answered_by: FormQuestion["answeredBy"];
  is_required: boolean;
  min_value: number | null;
  max_value: number | null;
  depends_on: string | null;
  depends_value: string | null;
  options: unknown;
  sort_order: number;
};

function toFormQuestion(row: SnapshotRow): FormQuestion {
  return {
    questionId: row.question_id,
    text: row.text,
    helpText: row.help_text,
    section: row.section,
    responseType: row.response_type,
    answeredBy: row.answered_by,
    isRequired: row.is_required,
    minValue: row.min_value === null ? null : Number(row.min_value),
    maxValue: row.max_value === null ? null : Number(row.max_value),
    dependsOn: row.depends_on,
    dependsValue: row.depends_value,
    options: Array.isArray(row.options) ? (row.options as SnapshotOption[]) : null,
    sortOrder: row.sort_order,
  };
}

/**
 * Build the form definition for one layer of one evaluation.
 *
 * **Every screen in the app renders from this function and nothing else.** That
 * is not a style preference: it is what keeps the employee's view, the lead's
 * view, the MD's collision view and the print route showing the same questions
 * in the same order. Any component that reaches for `questions` directly is
 * reading the live bank and will disagree with history the moment HR edits it.
 *
 * Reads only the snapshot (§5) — it never joins back to public.questions.
 */
export async function getEvaluationForm(
  evaluationId: string,
  layer: RatingLayer,
): Promise<FormsResult<FormDefinition>> {
  const supabase = await createClient();

  /* -- Four reads, ISSUED TOGETHER.
        They used to run one after another, and every one of them paid a full
        round trip to the database before the next was sent. On this page that
        was the difference between a form appearing and a form arriving: the
        snapshot, the answers and the section names are all keyed by
        `evaluationId` alone and none of them needs anything the others return.
        RLS still decides each one independently — an evaluation the caller may
        not read comes back empty and is refused below, exactly as before.
        Only the WAITING is shared. -- */
  const [
    { data: evaluation, error: evaluationError },
    { data: snapshotRows, error: snapshotError },
    { data: response, error: responseError },
    sectionConfig,
  ] = await Promise.all([
    supabase.from("evaluations").select("id, status, track").eq("id", evaluationId).maybeSingle(),
    supabase
      .from("evaluation_questions")
      // One literal string, not a concatenation: supabase-js infers the row type
      // from the select at compile time and gives up on anything it cannot parse.
      .select(
        "question_id, text, help_text, section, response_type, answered_by, is_required, min_value, max_value, depends_on, depends_value, options, sort_order",
      )
      .eq("evaluation_id", evaluationId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("evaluation_responses")
      .select("answers, comments, submitted_at")
      .eq("evaluation_id", evaluationId)
      .eq("layer", layer)
      .maybeSingle(),
    getSectionConfig(),
  ]);

  if (evaluationError) {
    return formsError("QUERY_FAILED", `Could not read evaluation: ${evaluationError.message}`);
  }
  if (!evaluation) {
    return formsError("EVALUATION_NOT_FOUND", `No evaluation with id ${evaluationId}.`);
  }

  if (snapshotError) {
    return formsError("QUERY_FAILED", `Could not read snapshot: ${snapshotError.message}`);
  }
  if (!snapshotRows || snapshotRows.length === 0) {
    return formsError(
      "SNAPSHOT_EMPTY",
      "This evaluation has no frozen question list. It has not been launched yet.",
    );
  }

  if (responseError) {
    return formsError("QUERY_FAILED", `Could not read responses: ${responseError.message}`);
  }

  const answers = (response?.answers ?? {}) as Record<string, unknown>;
  const comments = (response?.comments ?? {}) as Record<string, string>;

  /* -- Conditional visibility -- */
  // Resolved across ALL snapshot rows, not just this layer's, so a chain whose
  // parent belongs to another layer still resolves rather than silently
  // defaulting to visible.
  const rows = snapshotRows as SnapshotRow[];
  const visibility = resolveVisibility(rows, answers);

  /* -- Filter to this layer, then to what is currently visible -- */
  const allowed = LAYER_ANSWERED_BY[layer];
  const layerRows = rows.filter((row) => allowed.includes(row.answered_by));

  const visibleQuestions: FormQuestion[] = [];
  const hiddenQuestionIds: string[] = [];

  for (const row of layerRows) {
    if (visibility.get(row.question_id) === true) {
      visibleQuestions.push(toFormQuestion(row));
    } else {
      hiddenQuestionIds.push(row.question_id);
    }
  }

  /* -- Group into sections, preserving snapshot order -- */
  const sections: FormSection[] = [];
  for (const question of visibleQuestions) {
    const current = sections.at(-1);
    if (current && current.section === question.section) {
      current.questions.push(question);
    } else {
      sections.push({ section: question.section, questions: [question] });
    }
  }

  /* -- The section NAMES, as HR has them now (0036).
        Deliberately applied to the SNAPSHOT's sections rather than used to
        re-select them: §5 freezes which questions were asked and in what order,
        and a rename must not disturb either. Only the heading changes, which is
        the same half of the idea P8P-1 kept safe. -- */
  for (const section of sections) {
    section.label = labelIn(sectionConfig, section.section);
  }

  return {
    ok: true,
    data: {
      evaluationId,
      layer,
      evaluationStatus: evaluation.status,
      track: evaluation.track,
      sections,
      questions: visibleQuestions,
      answers,
      comments,
      isSubmitted: response?.submitted_at != null,
      submittedAt: response?.submitted_at ?? null,
      hiddenQuestionIds,
    },
  };
}
