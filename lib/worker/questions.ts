/** The Worker Performance Appraisal form: its questions, and the shape to draw them in. */

import "server-only";

import type { FormDefinition, FormQuestion } from "@/lib/forms/types";
import { createClient } from "@/lib/supabase/server";
import type { Enums } from "@/types/database";

/*
 * §7's isolation rule: "never refactor a staff-module function to accommodate
 * the worker module or the reverse." So nothing here calls `assembleQuestions`,
 * `getEvaluationForm`, `computeScores` or any of the staff assembly — those read
 * `questions`, `department_questions` and the frozen snapshot, none of which a
 * worker has. This module reads `worker_questions` and nothing else.
 *
 * What it DOES share is the renderer. `FormRenderer` is UI infrastructure, not a
 * staff-module function — the same distinction P9-3 drew when the department
 * preview was made to return the identical `FormDefinition` shape as a real
 * evaluation, so that one component could draw both. Building a second renderer
 * for a tick sheet is the thing P9-1 forbids and a test greps for.
 */

export type WorkerQuestion = {
  id: string;
  text: string;
  helpText: string | null;
  responseType: Enums<"response_type">;
  answeredBy: Enums<"answered_by">;
  isRequired: boolean;
  sortOrder: number;
  isActive: boolean;
  /** §11: this row IS the worker's score for the period. Never a mean. */
  isOverall: boolean;
};

/** The whole form, in order. Retired rows come back too so the builder can show them. */
export async function listWorkerQuestions(): Promise<WorkerQuestion[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("worker_questions")
    .select("id, text, help_text, response_type, answered_by, is_required, sort_order, is_active, is_overall")
    .order("sort_order");

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    text: row.text,
    helpText: row.help_text,
    responseType: row.response_type,
    answeredBy: row.answered_by,
    isRequired: row.is_required,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    isOverall: row.is_overall,
  }));
}

/*
 * The section a worker question renders under.
 *
 * `FormQuestion.section` is not optional, and the enum it draws from is the
 * staff form's. CORE_PERFORMANCE is used because it is the truthful answer —
 * every quality on the sheet is core performance — and because the alternative
 * is adding a WORKER value to `question_section`, which would put a worker
 * concept inside the enum every staff form sorts by. §7 keeps the modules
 * apart; this keeps the shared TYPE shared and the data separate, which is the
 * distinction that matters.
 */
const WORKER_SECTION = "CORE_PERFORMANCE" as const;

/**
 * The form as `FormRenderer` expects it.
 *
 * A preview, so it is not an evaluation and says so: no id, nothing submitted,
 * and no answers. When the worker APPRAISAL is built it will produce this same
 * shape from a frozen worker snapshot — which is what will let the supervisor's
 * screen and this preview stay identical without either knowing about the other.
 */
export function toWorkerFormDefinition(
  questions: WorkerQuestion[],
  layer: "SELF" | "LEAD" = "LEAD",
): FormDefinition {
  const active = questions
    .filter((q) => q.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.text.localeCompare(b.text));

  const formQuestions: FormQuestion[] = active.map((q) => ({
    questionId: q.id,
    text: q.text,
    helpText: q.helpText,
    section: WORKER_SECTION,
    responseType: q.responseType,
    answeredBy: q.answeredBy,
    isRequired: q.isRequired,
    minValue: null,
    maxValue: null,
    // §6's conditional questions exist on the staff form. The worker sheet has
    // none, and adding the machinery before there is a question that needs it
    // would be schema nobody asked for (§0.4).
    dependsOn: null,
    dependsValue: null,
    options: null,
    sortOrder: q.sortOrder,
  }));

  return {
    evaluationId: "",
    layer,
    // A preview is not a record. CYCLE_ACTIVE is §8's worker-track open state,
    // which is the honest description of a form nobody has filled in.
    evaluationStatus: "DRAFT",
    track: "WORKER",
    sections: formQuestions.length > 0 ? [{ section: WORKER_SECTION, questions: formQuestions }] : [],
    questions: formQuestions,
    answers: {},
    comments: {},
    isSubmitted: false,
    submittedAt: null,
    hiddenQuestionIds: [],
  };
}

/**
 * What the form asks that is NOT a question.
 *
 * The source sheet carries a supervisor comment, a salary block and a training
 * tick beneath the table. P2-10 settled where those live: Old Salary, Increment
 * % and New Salary are `evaluation_decisions` columns, not questions, and
 * putting them in a question bank would let somebody edit a pay field as though
 * it were a rating. They are listed here so the builder can SHOW them as part
 * of the form without pretending they are editable question rows.
 */
export const WORKER_FIXED_BLOCKS = [
  {
    title: "Supervisor comment",
    body: "A free-text note from the supervisor. Part of the appraisal record, not a question in the bank.",
  },
  {
    title: "Training required",
    body: "Yes or No, ticked by the supervisor.",
  },
  {
    title: "Salary",
    body: "Same or New, with old salary, increment % and new salary. §5 confines these figures to HR and the MD — they never appear on a supervisor's copy.",
  },
  {
    title: "Signatures",
    body: "Supervisor, HR and MD, with the company stamp. These belong to the printed pack.",
  },
] as const;
