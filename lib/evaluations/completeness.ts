/** Which required questions are still blank. Pure — no database. */

import type { FormQuestion } from "@/lib/forms/types";

/**
 * Is this answer effectively unanswered?
 *
 * The three cases that matter, and why each is a blank rather than a value:
 *   • `""` — a text box the person tabbed through without typing.
 *   • `[]` — an empty multi-select is unanswered, not a deliberate "none of
 *     these". If "none" is a real option it belongs in question_options.
 *   • `null` / `undefined` — never touched.
 *
 * Deliberately NOT blank: the number `0` and the boolean `false`. A 0 on the
 * 0-5 scale is "Very dissatisfied (Not implemented)" — a real, meaningful rating
 * (§6) — and `false` is a real answer to "Any missed deadlines?". Treating
 * either as blank would block a submit on a fully answered form, which is the
 * kind of bug people work around by inventing a fake answer.
 */
export function isAnswerBlank(answer: unknown): boolean {
  if (answer === null || answer === undefined) return true;
  if (typeof answer === "string") return answer.trim() === "";
  if (Array.isArray(answer)) return answer.length === 0;
  return false;
}

/**
 * The required questions still lacking an answer.
 *
 * `questions` must already be filtered to one layer and to what is currently
 * visible — that is what getEvaluationForm returns. §6: a hidden question is
 * neither validated nor stored, so "If yes, please specify" must never block a
 * submit when the parent was answered No.
 */
export function findMissingRequired(
  questions: readonly FormQuestion[],
  answers: Readonly<Record<string, unknown>>,
): FormQuestion[] {
  return questions.filter(
    (question) => question.isRequired && isAnswerBlank(answers[question.questionId]),
  );
}

/** "…is still blank" / "…are still blank", naming the first few. */
export function describeMissing(missing: readonly FormQuestion[]): string {
  const names = missing.slice(0, 3).map((q) => `"${q.text}"`).join(", ");
  const rest = missing.length > 3 ? ` and ${missing.length - 3} more` : "";
  return `${missing.length} required ${missing.length === 1 ? "question is" : "questions are"} still blank: ${names}${rest}.`;
}
