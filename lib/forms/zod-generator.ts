/** buildZodSchema — a runtime schema from the frozen snapshot. CLAUDE.md §6, §14. */

import { z } from "zod";

import { resolveVisibility } from "@/lib/forms/conditions";
import { LAYER_ANSWERED_BY, type FormDefinition, type FormQuestion, type RatingLayer } from "@/lib/forms/types";

/**
 * The form's shape is data, not code: the question list is frozen per
 * evaluation (§5) and differs by department and by layer, so the validator has
 * to be built at runtime from the same snapshot the renderer draws.
 *
 * THE RULE THAT IS EASIEST TO GET WRONG
 *
 * A question is required only when it is **required AND visible**. A hidden
 * conditional — "If yes, please specify" while the parent is No — must never
 * block submission. §6 is explicit: "Hidden questions are not validated and not
 * stored." Getting this backwards produces a form that cannot be submitted and
 * gives no indication why, because the offending field is not on screen.
 *
 * Visibility depends on the current answers, so the schema is a function of
 * them. The caller memoises on the parent values; this function stays pure.
 *
 * THE SAME BUILDER RUNS ON THE SERVER. The submit action re-reads the snapshot
 * from the database and rebuilds the schema against it, so a client that lies
 * about its question list validates against the real one. §9: "Client code must
 * never be the only guard."
 */

export const TICK_VALUES = ["EXCELLENT", "SATISFACTORY", "NEEDS_IMPROVEMENT"] as const;

/** Text caps, from the brief. TEXT_LONG matches §13's 1000-char counter. */
export const TEXT_SHORT_MAX = 200;
export const TEXT_LONG_MAX = 1000;

export type BuiltSchema = {
  schema: z.ZodType<Record<string, unknown>>;
  /** Questions this layer is asked, minus the hidden ones. */
  activeQuestions: FormQuestion[];
  /** Ids hidden by an unmet condition — neither validated nor stored (§6). */
  hiddenQuestionIds: string[];
};

/**
 * Which questions this layer is asked at all.
 *
 * Rule 3: `answered_by` decides. An employee never validates a MANAGER_REVIEW
 * question, and the LEAD layer never validates an EMPLOYEE_ONLY one — putting
 * either in the schema would block a submission on a field the person cannot
 * even see.
 */
export function questionsForLayer(form: FormDefinition, layer: RatingLayer): FormQuestion[] {
  const allowed = LAYER_ANSWERED_BY[layer];
  return form.questions.filter((question) => allowed.includes(question.answeredBy));
}

/**
 * conditions.ts speaks the snapshot's snake_case, because it is also used
 * against raw rows. One adapter here rather than two shapes of the same idea.
 */
function toConditionRows(questions: readonly FormQuestion[]) {
  return questions.map((question) => ({
    question_id: question.questionId,
    depends_on: question.dependsOn,
    depends_value: question.dependsValue,
  }));
}

/** One question's validator, before required/optional is applied. */
function baseSchema(question: FormQuestion): z.ZodTypeAny {
  switch (question.responseType) {
    case "SCALE_0_5":
      // §6 fixes the range at 0–5. Not read from min_value/max_value: those are
      // null for scale questions precisely so the range cannot drift in data
      // (P2-4), and a scale is not a NUMBER with bounds.
      return z.coerce
        .number({ message: "Choose a rating." })
        .int("Choose a rating.")
        .min(0, "Choose a rating.")
        .max(5, "Choose a rating.");

    case "TICK_3":
      return z.enum(TICK_VALUES, { message: "Choose one." });

    case "NUMBER": {
      let schema = z.coerce.number({ message: "Enter a number." });
      // Non-negative by default, per the brief. An explicit min of 0 in the
      // snapshot says the same thing; a negative min overrides it deliberately.
      const min = question.minValue ?? 0;
      schema = schema.min(min, `Must be ${min} or more.`);
      if (question.maxValue !== null) {
        schema = schema.max(question.maxValue, `Must be ${question.maxValue} or less.`);
      }
      return schema;
    }

    case "BOOLEAN":
      return z.boolean({ message: "Choose Yes or No." });

    case "TEXT_SHORT":
      return z
        .string()
        .trim()
        .max(TEXT_SHORT_MAX, `Keep this under ${TEXT_SHORT_MAX} characters.`);

    case "TEXT_LONG":
      return z
        .string()
        .trim()
        .max(TEXT_LONG_MAX, `Keep this under ${TEXT_LONG_MAX} characters.`);

    case "SINGLE_SELECT": {
      const values = (question.options ?? []).map((option) => option.value);
      // A select with no frozen options cannot be answered correctly by anyone,
      // so nothing is accepted rather than everything.
      if (values.length === 0) return z.never({ message: "This question has no options." });
      return z.enum(values as [string, ...string[]], { message: "Choose one." });
    }

    case "MULTI_SELECT": {
      const values = (question.options ?? []).map((option) => option.value);
      if (values.length === 0) return z.array(z.string()).max(0);
      return z.array(z.enum(values as [string, ...string[]]), { message: "Choose at least one." });
    }

    case "DATE":
      return z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.");

    default:
      // Unreachable while response_type is the 0002 enum, and left as a value
      // rather than a throw: a future type should degrade to "accepted" on one
      // question, not take the whole form down.
      return z.unknown();
  }
}

/** A blank answer, for every shape a blank can take. */
export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  // §6 / P4-9: 0 and false are REAL answers. A required scale question answered
  // 0 is "Very dissatisfied (Not implemented)" and false is a real answer to
  // "Any missed deadlines?". Treating either as missing blocks a fully answered
  // form, which is the kind of bug people work around by inventing an answer.
  return false;
}

/**
 * Build the validator for one layer of one form, given the answers as they
 * currently stand.
 *
 * `values` matters: visibility is computed from it, and visibility decides
 * which questions are required. Pass the live answers on the client and the
 * stored answers on the server.
 */
export function buildZodSchema(
  form: FormDefinition,
  layer: RatingLayer,
  values: Record<string, unknown>,
): BuiltSchema {
  const layerQuestions = questionsForLayer(form, layer);

  // Visibility is resolved against the WHOLE question list, not just this
  // layer's: a question the employee answers can gate one the lead answers, and
  // resolving against a filtered list would lose that parent.
  const visibility = resolveVisibility(toConditionRows(form.questions), values);
  const hiddenQuestionIds = form.questions
    .filter((question) => visibility.get(question.questionId) === false)
    .map((question) => question.questionId);

  const hidden = new Set(hiddenQuestionIds);
  const activeQuestions = layerQuestions.filter((question) => !hidden.has(question.questionId));

  const shape: Record<string, z.ZodTypeAny> = {};

  for (const question of activeQuestions) {
    const base = baseSchema(question);

    if (question.isRequired) {
      // Required AND visible. The blank check runs first so an unanswered field
      // reports "this needs an answer" rather than a type error about undefined.
      shape[question.questionId] = z
        .unknown()
        .superRefine((value, ctx) => {
          if (isBlank(value)) {
            ctx.addIssue({ code: "custom", message: requiredMessage(question) });
            return;
          }
          const result = base.safeParse(value);
          if (!result.success) {
            ctx.addIssue({
              code: "custom",
              message: result.error.issues[0]?.message ?? "Check this answer.",
            });
          }
        })
        .transform((value) => value);
    } else {
      // Optional: blank is fine, but a value that IS given must still be valid.
      shape[question.questionId] = z
        .unknown()
        .superRefine((value, ctx) => {
          if (isBlank(value)) return;
          const result = base.safeParse(value);
          if (!result.success) {
            ctx.addIssue({
              code: "custom",
              message: result.error.issues[0]?.message ?? "Check this answer.",
            });
          }
        })
        .transform((value) => value);
    }
  }

  // Unknown keys are stripped rather than rejected. A hidden question's stale
  // value, or a question retired from a later cycle, must not fail a submission
  // — §5 keeps the snapshot authoritative and anything outside it is noise.
  const schema = z.object(shape).strip() as unknown as z.ZodType<Record<string, unknown>>;

  return { schema, activeQuestions, hiddenQuestionIds };
}

/** Wording per response type, so "Choose a rating" never appears above a textarea. */
function requiredMessage(question: FormQuestion): string {
  switch (question.responseType) {
    case "SCALE_0_5":
      return "Choose a rating.";
    case "TICK_3":
    case "SINGLE_SELECT":
      return "Choose one.";
    case "MULTI_SELECT":
      return "Choose at least one.";
    case "BOOLEAN":
      return "Choose Yes or No.";
    case "DATE":
      return "Pick a date.";
    case "NUMBER":
      return "Enter a number.";
    default:
      return "This needs an answer.";
  }
}

/* ---------- Validation result ---------- */

export type ValidationResult = {
  ok: boolean;
  /** question_id -> message, for the renderer. */
  errors: Record<string, string>;
  /** Ordered as the form is, so "scroll to the first error" is unambiguous. */
  missingIds: string[];
};

/**
 * Validate and return errors keyed by question id, in form order.
 *
 * Returns rather than throws: a half-filled form is the normal state of this
 * screen, not an exception.
 */
export function validateAnswers(
  form: FormDefinition,
  layer: RatingLayer,
  values: Record<string, unknown>,
): ValidationResult {
  const { schema, activeQuestions } = buildZodSchema(form, layer, values);
  const parsed = schema.safeParse(values);

  if (parsed.success) return { ok: true, errors: {}, missingIds: [] };

  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !errors[key]) errors[key] = issue.message;
  }

  // Form order, not Zod's: the screen scrolls to "the first error", and the
  // first error has to be the topmost one on the page.
  const missingIds = activeQuestions
    .map((question) => question.questionId)
    .filter((id) => id in errors);

  return { ok: false, errors, missingIds };
}

/**
 * Strip hidden questions' answers before storing.
 *
 * §6: "Hidden questions are not validated and not stored." Without this, a
 * "Yes → details" answered and then flipped back to No would keep the orphaned
 * detail text, and it would resurface — on the print pack, in the lead's view —
 * attached to a question nobody was asked.
 */
export function stripHidden(
  form: FormDefinition,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const visibility = resolveVisibility(toConditionRows(form.questions), values);
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(values)) {
    if (visibility.get(key) === false) continue;
    out[key] = value;
  }
  return out;
}
