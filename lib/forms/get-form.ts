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
    // Everything `merge_evaluation_answers` consults, so the render can agree
    // with the save. One literal string, never a concatenation (P3-11).
    supabase
      .from("evaluations")
      .select(
        "id, status, track, excluded_at, self_submitted_at, lead_submitted_at, co_lead_submitted_at, self_skipped, lead_skipped, co_lead_skipped",
      )
      .eq("id", evaluationId)
      .maybeSingle(),
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

  /* -- Filter to this LAYER. Not to what is currently visible.

        THIS USED TO DROP HIDDEN QUESTIONS FROM THE PAYLOAD ENTIRELY, and that
        is why a conditional needed a page reload to appear. The browser was
        never sent the question, so recomputing visibility on the client could
        only ever hide MORE — it could not reveal something that had not
        arrived. Answering "Yes" to Promotion recommendation therefore did
        nothing until a refresh, at which point the server recomputed against
        the saved answer and included it.

        Every question for this layer is now sent, and `hiddenQuestionIds` is
        the authority on what shows. `FormRenderer` has always filtered on it,
        `buildZodSchema` recomputes it from the current answers, and both were
        already correct — they were being handed an incomplete list.

        WHAT THIS DOES NOT CHANGE. §6's rule is that a hidden question is
        neither validated nor stored, and both of those are decided server-side
        at submit from the frozen snapshot — untouched. And nothing crosses a
        layer: `allowed` is still this layer's own questions, so no blindness
        boundary moves. What is sent is the TEXT of a question this person will
        see the moment they answer its parent. -- */
  const allowed = LAYER_ANSWERED_BY[layer];
  const layerRows = rows.filter((row) => allowed.includes(row.answered_by));

  const layerQuestions: FormQuestion[] = [];
  const hiddenQuestionIds: string[] = [];

  for (const row of layerRows) {
    layerQuestions.push(toFormQuestion(row));
    if (visibility.get(row.question_id) !== true) hiddenQuestionIds.push(row.question_id);
  }

  /* -- Group into sections, preserving snapshot order -- */
  const sections: FormSection[] = [];
  for (const question of layerQuestions) {
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

  /* -- WHY THE FORM IS LOCKED, mirroring the SAVE gate rather than guessing at
        it.

        `isSubmitted` alone decided whether the form rendered editable, while
        `merge_evaluation_answers` (0033) also requires `status = 'OPEN'` and the
        layer not skipped. So there were states — a withdrawn participant who
        still had their WhatsApp link, or a layer HR advanced past — where the
        form rendered fully editable and every keystroke was refused. Since
        FIX-3 that refusal is at least honest, but the person has answered
        thirty-one questions by the time they read it.

        A REASON rather than a boolean, because §13.4 forbids a dead end: a form
        that will not save has to say what happened. Ordered so the most
        specific cause wins — "withdrawn" explains more than "closed".

        This does NOT replace the server's check. It is the render agreeing with
        a gate the database still enforces (§9). -- */
  const lockedReason =
    evaluation.excluded_at != null
      ? "This appraisal was withdrawn, so it is no longer open for answers. Ask HR if you think that is wrong."
      : layer === "SELF" && evaluation.self_skipped
        ? "HR marked this side of the appraisal as not required, so it can no longer be edited."
        : layer === "LEAD" && evaluation.lead_skipped
          ? "HR marked this side of the appraisal as not required, so it can no longer be edited."
          : layer === "LEAD_2" && evaluation.co_lead_skipped
          ? "HR marked this side of the appraisal as not required, so it can no longer be edited."
          : response?.submitted_at != null
            ? null // Submitted is its own state, already handled by `isSubmitted`.
            : evaluation.status !== "OPEN"
              ? "This appraisal has moved on to review, so it is no longer open for answers."
              : null;

  return {
    ok: true,
    data: {
      evaluationId,
      layer,
      evaluationStatus: evaluation.status,
      track: evaluation.track,
      sections,
      questions: layerQuestions,
      answers,
      comments,
      isSubmitted: response?.submitted_at != null,
      submittedAt: response?.submitted_at ?? null,
      lockedReason,
      hiddenQuestionIds,
    },
  };
}
