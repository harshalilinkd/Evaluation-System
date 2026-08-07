/** Score, variance and final-value computation. CLAUDE.md §11. Pure — no database. */

import type { FormDefinition, FormQuestion, QuestionSection } from "@/lib/forms/types";

/* ---------- Constants ---------- */

/**
 * §6: the three-point tick maps to 5 / 3 / 1 **for analytics only**. Never
 * render the number on a worker form — the worker form stays a tick sheet.
 */
export const TICK_3_VALUES = {
  EXCELLENT: 5,
  SATISFACTORY: 3,
  NEEDS_IMPROVEMENT: 1,
} as const;

/**
 * §11: the worker overall is the supervisor's "Overall Performance" tick, not a
 * mean. Matched on the frozen snapshot text, which is safe because §0.2 fixes
 * question wording once created and §5 freezes it per evaluation anyway.
 */
export const WORKER_OVERALL_QUESTION_TEXT = "Overall Performance";

/** DESIGN.md §6.4. Critical sits one point above the cycle's warning threshold. */
export const DEFAULT_VARIANCE_THRESHOLD = 2;

/* ---------- Types ---------- */

export type SectionScores = Partial<Record<QuestionSection, number>>;

export type ComputedScores = {
  sectionScores: SectionScores;
  overallScore: number | null;
  /** How many questions actually contributed. Zero means overallScore is null. */
  scoredCount: number;
};

export type FlagLevel = "none" | "warning" | "critical";

export type QuestionVariance = {
  questionId: string;
  text: string;
  section: QuestionSection;
  self: number | null;
  lead: number | null;
  /** Lead − Self (§11). Null when either side is unanswered. */
  delta: number | null;
  flag: FlagLevel;
};

/* ---------- Helpers ---------- */

/** Two decimals (§11), without the floating-point tail that `toFixed` leaves. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * The numeric value of an answer, or null if it does not count toward a score.
 *
 * §11: "NUMBER, BOOLEAN, TEXT and MULTI_SELECT answers never enter a score."
 * Only SCALE_0_5 contributes. TICK_3 is converted here for variance and for the
 * worker overall, but it is never averaged into a section score — see
 * computeScores.
 */
export function scoreValue(question: FormQuestion, answer: unknown): number | null {
  if (answer === null || answer === undefined || answer === "") return null;

  if (question.responseType === "SCALE_0_5") {
    const n = typeof answer === "number" ? answer : Number(answer);
    if (!Number.isFinite(n)) return null;
    // A value outside the declared scale is corrupt data, not a 0.
    if (n < 0 || n > 5) return null;
    return n;
  }

  if (question.responseType === "TICK_3") {
    const key = String(answer).trim().toUpperCase() as keyof typeof TICK_3_VALUES;
    return TICK_3_VALUES[key] ?? null;
  }

  return null;
}

/* ---------- computeScores ---------- */

/**
 * Section and overall scores for one layer's answers (§11).
 *
 * STAFF: section score is the mean of answered SCALE_0_5 questions in that
 * section; overall is the unweighted mean of every answered SCALE_0_5 question.
 * Both to two decimals.
 *
 * WORKER: overall is the "Overall Performance" tick mapped through 5/3/1, not a
 * mean. Section scores come out empty, because a worker form contains no
 * SCALE_0_5 question and §11 defines a section score in terms of that type
 * alone. Per-section TICK_3 analytics can be added later without changing any
 * stored score.
 *
 * Only questions present in `formDefinition.questions` are considered — that
 * list is already filtered to the layer and to what is currently visible, so a
 * hidden question can never contribute (§6).
 */
export function computeScores(
  formDefinition: Pick<FormDefinition, "questions" | "track">,
  answers: Readonly<Record<string, unknown>>,
): ComputedScores {
  if (formDefinition.track === "WORKER") {
    const overallQuestion = formDefinition.questions.find(
      (q) => q.text === WORKER_OVERALL_QUESTION_TEXT && q.responseType === "TICK_3",
    );

    const value = overallQuestion
      ? scoreValue(overallQuestion, answers[overallQuestion.questionId])
      : null;

    return {
      sectionScores: {},
      overallScore: value,
      scoredCount: value === null ? 0 : 1,
    };
  }

  const bySection = new Map<QuestionSection, number[]>();
  const all: number[] = [];

  for (const question of formDefinition.questions) {
    // Explicitly SCALE_0_5 only. Routing through scoreValue would also admit
    // TICK_3, which §11 excludes from means.
    if (question.responseType !== "SCALE_0_5") continue;

    const value = scoreValue(question, answers[question.questionId]);
    if (value === null) continue;

    const list = bySection.get(question.section) ?? [];
    list.push(value);
    bySection.set(question.section, list);
    all.push(value);
  }

  const sectionScores: SectionScores = {};
  for (const [section, values] of bySection) {
    sectionScores[section] = round2(values.reduce((a, b) => a + b, 0) / values.length);
  }

  return {
    sectionScores,
    overallScore: all.length === 0 ? null : round2(all.reduce((a, b) => a + b, 0) / all.length),
    scoredCount: all.length,
  };
}

/* ---------- computeVariance ---------- */

/**
 * Per-question self-vs-lead comparison (§11): delta is **Lead − Self**, so a
 * positive number means the lead rated higher than the employee did.
 *
 * `threshold` is the cycle's variance_threshold. Critical is one point above it,
 * matching DESIGN.md §6.4's |Δ| ≥ 2 warning / |Δ| ≥ 3 critical.
 *
 * Only questions both layers actually answer can vary, so this walks the
 * EMPLOYEE_AND_LEAD questions. A question answered by only one side yields a
 * null delta and no flag rather than being treated as a disagreement.
 */
export function computeVariance(
  selfAnswers: Readonly<Record<string, unknown>>,
  leadAnswers: Readonly<Record<string, unknown>>,
  formDefinition: Pick<FormDefinition, "questions">,
  threshold: number = DEFAULT_VARIANCE_THRESHOLD,
): QuestionVariance[] {
  const warningAt = Math.max(0, threshold);
  const criticalAt = warningAt + 1;

  const result: QuestionVariance[] = [];

  for (const question of formDefinition.questions) {
    if (question.answeredBy !== "EMPLOYEE_AND_LEAD") continue;
    if (question.responseType !== "SCALE_0_5") continue;

    const self = scoreValue(question, selfAnswers[question.questionId]);
    const lead = scoreValue(question, leadAnswers[question.questionId]);
    const delta = self === null || lead === null ? null : round2(lead - self);

    let flag: FlagLevel = "none";
    if (delta !== null) {
      const magnitude = Math.abs(delta);
      if (magnitude >= criticalAt) flag = "critical";
      else if (magnitude >= warningAt) flag = "warning";
    }

    result.push({
      questionId: question.questionId,
      text: question.text,
      section: question.section,
      self,
      lead,
      delta,
      flag,
    });
  }

  return result;
}

/* ---------- finalScore ---------- */

/**
 * §11: "MD override: blank override falls back to the Lead score. The stored
 * final score is always explicit — never null with an implied fallback."
 *
 * The fallback is resolved *here*, at submit time, and the result is written
 * into the MD layer. Nothing downstream should ever re-derive it — a reader that
 * computes `override ?? lead` is reintroducing exactly the implicit fallback
 * §11 forbids, and will disagree with the stored value the moment the lead layer
 * is returned and re-submitted.
 *
 * Returns null only when there is genuinely nothing to record: no lead value and
 * no override. Callers must treat that as "unscored", not as zero.
 */
export function finalScore(
  leadValue: number | null | undefined,
  mdOverride: number | null | undefined,
): number | null {
  if (mdOverride !== null && mdOverride !== undefined && Number.isFinite(mdOverride)) {
    return mdOverride;
  }
  if (leadValue !== null && leadValue !== undefined && Number.isFinite(leadValue)) {
    return leadValue;
  }
  return null;
}

/**
 * Resolve every question's final value, then score the result.
 *
 * Returns the explicit answer map to persist on the MD layer alongside the
 * scores, so the stored MD answers are the final record — not a sparse set of
 * overrides that only makes sense next to the lead's row.
 */
export function computeFinalScores(
  formDefinition: Pick<FormDefinition, "questions" | "track">,
  leadAnswers: Readonly<Record<string, unknown>>,
  mdAnswers: Readonly<Record<string, unknown>>,
): ComputedScores & { resolvedAnswers: Record<string, unknown> } {
  const resolvedAnswers: Record<string, unknown> = { ...mdAnswers };

  for (const question of formDefinition.questions) {
    if (question.responseType !== "SCALE_0_5" && question.responseType !== "TICK_3") {
      // Non-scored questions carry the MD's own text through unchanged; there is
      // no lead value to fall back to that would mean anything.
      continue;
    }

    if (question.responseType === "SCALE_0_5") {
      const resolved = finalScore(
        scoreValue(question, leadAnswers[question.questionId]),
        scoreValue(question, mdAnswers[question.questionId]),
      );
      if (resolved !== null) resolvedAnswers[question.questionId] = resolved;
      continue;
    }

    // TICK_3 has no numeric override; the MD's tick wins, else the lead's.
    const mdTick = mdAnswers[question.questionId];
    const leadTick = leadAnswers[question.questionId];
    const resolvedTick = mdTick ?? leadTick;
    if (resolvedTick !== undefined && resolvedTick !== null) {
      resolvedAnswers[question.questionId] = resolvedTick;
    }
  }

  return { ...computeScores(formDefinition, resolvedAnswers), resolvedAnswers };
}
