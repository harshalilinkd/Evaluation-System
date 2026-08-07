/** Shared types for runtime form assembly and the frozen snapshot. */

import { sectionRank } from "@/lib/forms/labels";
import type { Enums } from "@/types/database";

export type QuestionSection = Enums<"question_section">;
export type ResponseType = Enums<"response_type">;
export type AnsweredBy = Enums<"answered_by">;
export type RatingLayer = Enums<"rating_layer">;
export type TrackType = Enums<"track_type">;
export type EvaluationStatus = Enums<"evaluation_status">;

/* ---------- Result ---------- */

// CLAUDE.md §0.7 fail loudly / §14 typed results. These functions are called
// from Server Actions, so they return a result rather than throwing — the action
// can pass it straight through to the client without a try/catch at every site.
export type FormsErrorCode =
  | "PROFILE_NOT_FOUND"
  | "CYCLE_NOT_FOUND"
  | "EVALUATION_NOT_FOUND"
  | "TRACK_OUT_OF_SCOPE"
  | "SNAPSHOT_EMPTY"
  | "QUERY_FAILED";

export type FormsResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: FormsErrorCode; message: string } };

export function formsError<T>(code: FormsErrorCode, message: string): FormsResult<T> {
  return { ok: false, error: { code, message } };
}

/* ---------- Ordering ---------- */

// Section order and display names live in ./labels, which is the single source
// for both. Re-exported so existing imports keep working and there is still
// exactly one definition.
export {
  SECTION_LABELS,
  SECTION_ORDER,
  SECTION_OPTIONS,
  DEPARTMENT_SECTION,
  sectionLabel,
  sectionRank,
} from "@/lib/forms/labels";

/**
 * Total ordering for an assembled question list: section, then sort_order, then
 * created_at, then id.
 *
 * The last two keys are not padding. Two questions added to the same section
 * with the same sort_order must still come out in one reproducible order, or the
 * same person could see their form in a different sequence on two page loads —
 * and two people on identical question sets could see different sequences.
 */
export function compareAssembledQuestions(
  a: Pick<AssembledQuestion, "section" | "sortOrder" | "createdAt" | "questionId">,
  b: Pick<AssembledQuestion, "section" | "sortOrder" | "createdAt" | "questionId">,
): number {
  return (
    sectionRank(a.section) - sectionRank(b.section) ||
    a.sortOrder - b.sortOrder ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.questionId.localeCompare(b.questionId)
  );
}

/* ---------- Options ---------- */

/** A select choice, as frozen into evaluation_questions.options. */
export type SnapshotOption = {
  label: string;
  value: string;
  sort_order: number;
};

/* ---------- Assembly ---------- */

/** One question as assembled from the live bank, before it is frozen. */
export type AssembledQuestion = {
  questionId: string;
  text: string;
  helpText: string | null;
  section: QuestionSection;
  responseType: ResponseType;
  answeredBy: AnsweredBy;
  isRequired: boolean;
  minValue: number | null;
  maxValue: number | null;
  dependsOn: string | null;
  dependsValue: string | null;
  options: SnapshotOption[] | null;
  /** Position within the section, from the bank. Not the snapshot's sort_order. */
  sortOrder: number;
  createdAt: string;
};

/* ---------- Rendered form ---------- */

/** One question as handed to the renderer. */
export type FormQuestion = {
  questionId: string;
  text: string;
  helpText: string | null;
  section: QuestionSection;
  responseType: ResponseType;
  answeredBy: AnsweredBy;
  isRequired: boolean;
  minValue: number | null;
  maxValue: number | null;
  dependsOn: string | null;
  dependsValue: string | null;
  options: SnapshotOption[] | null;
  sortOrder: number;
};

export type FormSection = {
  section: QuestionSection;
  questions: FormQuestion[];
  /**
   * What this section is called, as HR has it now (0036).
   *
   * Optional, and absent means "use the shipped default". That is what keeps
   * every existing caller correct without being edited, and what keeps a form
   * rendering if `form_sections` cannot be read — a section with no name is a
   * blank heading on somebody's appraisal, which is worse than an old one.
   */
  label?: string;
};

/**
 * Everything a form needs to render one layer of one evaluation.
 *
 * §5's JSONB shape is preserved exactly: `answers` and `comments` are flat maps
 * keyed by question id, never nested deeper.
 */
export type FormDefinition = {
  evaluationId: string;
  layer: RatingLayer;
  evaluationStatus: EvaluationStatus;
  track: TrackType;
  sections: FormSection[];
  /** Flat, in snapshot order — convenient for validation and scoring. */
  questions: FormQuestion[];
  answers: Record<string, unknown>;
  comments: Record<string, string>;
  /**
   * §8 locking rule: this layer has been submitted and is read-only until an
   * explicit return transition clears it. Transitions themselves are P4.
   */
  isSubmitted: boolean;
  submittedAt: string | null;
  /**
   * Questions hidden by an unmet condition. §6: hidden questions are neither
   * validated nor stored, so validation and scoring must skip these.
   */
  hiddenQuestionIds: string[];
};

/* ---------- answered_by -> layer ---------- */

/**
 * Which questions each layer is asked to fill in.
 *
 * SELF sees what the employee answers. LEAD sees the collision questions plus
 * its own. MD sees everything the lead recorded, because §11's override is
 * defined as replacing a lead score, plus any MD-only question.
 *
 * Note the MD row is a judgement call: there are currently no MD_ONLY questions
 * seeded, so restricting MD to MD_ONLY would yield an empty form. Revisit when
 * the collision screen is built (P6).
 */
export const LAYER_ANSWERED_BY: Record<RatingLayer, readonly AnsweredBy[]> = {
  SELF: ["EMPLOYEE_AND_LEAD", "EMPLOYEE_ONLY"],
  LEAD: ["EMPLOYEE_AND_LEAD", "LEAD_ONLY"],
  MD: ["EMPLOYEE_AND_LEAD", "LEAD_ONLY", "MD_ONLY"],
} as const;
