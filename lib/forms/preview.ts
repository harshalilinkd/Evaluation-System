/** Builds a FormDefinition from the LIVE bank, for previewing a department's form. */

import "server-only";

import { assembleForDepartment } from "@/lib/forms/assemble";
import { getSectionConfig, labelIn } from "@/lib/forms/section-config";
import { LAYER_ANSWERED_BY, formsError } from "@/lib/forms/types";
import type { FormDefinition, FormQuestion, FormSection, FormsResult, RatingLayer } from "@/lib/forms/types";
import type { Enums } from "@/types/database";

/**
 * The form a department's employees would see if a cycle launched right now.
 *
 * Deliberately produces the **same** `FormDefinition` shape that
 * `getEvaluationForm` returns from the frozen snapshot, so one renderer draws
 * both. The two differ only in where the questions come from:
 *
 *   getEvaluationForm  → evaluation_questions (frozen at launch, §5)
 *   previewForDepartment → questions + department_questions (live, editable)
 *
 * That is the whole point. A preview built by a second renderer drifts from the
 * real thing silently, and HR only finds out once a cycle is live and an
 * employee is looking at something else.
 */
export async function previewFormForDepartment(
  departmentId: string,
  options: { track?: Enums<"track_type">; layer?: RatingLayer } = {},
): Promise<FormsResult<FormDefinition>> {
  const track = options.track ?? "STAFF";
  const layer = options.layer ?? "SELF";

  const assembled = await assembleForDepartment(departmentId, track);
  if (!assembled.ok) return assembled;

  if (assembled.data.length === 0) {
    return formsError(
      "SNAPSHOT_EMPTY",
      "There are no active questions for this track yet, so there is nothing to preview.",
    );
  }

  // Same filter the real form applies, so the preview shows what the employee
  // is asked and not what the lead or the MD sees.
  const allowed = LAYER_ANSWERED_BY[layer];

  const questions: FormQuestion[] = assembled.data
    .filter((q) => allowed.includes(q.answeredBy))
    // Sequential in steps of 10, exactly as snapshotEvaluation numbers a real
    // form, so the preview's order is the order that would be frozen.
    .map((q, index) => ({
      questionId: q.questionId,
      text: q.text,
      helpText: q.helpText,
      section: q.section,
      responseType: q.responseType,
      answeredBy: q.answeredBy,
      isRequired: q.isRequired,
      minValue: q.minValue,
      maxValue: q.maxValue,
      dependsOn: q.dependsOn,
      dependsValue: q.dependsValue,
      options: q.options,
      sortOrder: (index + 1) * 10,
    }));

  const sections: FormSection[] = [];
  for (const question of questions) {
    const current = sections.at(-1);
    if (current && current.section === question.section) current.questions.push(question);
    else sections.push({ section: question.section, questions: [question] });
  }

  // HR's names. A preview that showed the shipped labels while the real form
  // showed the edited ones would be a preview that lies (P9-3).
  const sectionConfig = await getSectionConfig();
  for (const section of sections) {
    section.label = labelIn(sectionConfig, section.section);
  }

  return {
    ok: true,
    data: {
      // No evaluation exists — this is a hypothetical form. The renderer never
      // uses the id except as a key, and the preview is read-only.
      evaluationId: `preview:${departmentId}`,
      layer,
      // A preview is never a real record; OPEN is simply the live equivalent.
      evaluationStatus: "OPEN",
      track,
      sections,
      questions,
      answers: {},
      comments: {},
      isSubmitted: false,
      submittedAt: null,
      // Conditional children are shown in a preview rather than hidden: HR is
      // reviewing the question set, and a question that never appears because
      // nobody has answered its parent is exactly the one they need to check.
      hiddenQuestionIds: [],
    },
  };
}
