/** How long the form takes to fill. P9B pane 1 footer. Pure. */

import type { ResponseType } from "@/lib/forms/types";

/**
 * Seconds per question, by how it is answered.
 *
 * The numbers are P9B's, and they are estimates rather than measurements — the
 * point is not accuracy to the second, it is that HR watches a number move as
 * they add questions and feels the cost of the twelfth rating question.
 *
 * A rating is quick because the answer is already formed; a long text is slow
 * because it has to be composed. That ordering is what makes the total useful.
 */
export const SECONDS_PER_TYPE: Record<ResponseType, number> = {
  SCALE_0_5: 12,
  TICK_3: 12,
  NUMBER: 10,
  BOOLEAN: 10,
  SINGLE_SELECT: 15,
  MULTI_SELECT: 15,
  TEXT_SHORT: 40,
  TEXT_LONG: 75,
  DATE: 10,
};

/** Past this, the form is long enough that people start rushing it. */
export const LONG_FORM_MINUTES = 20;

export type FillEstimate = {
  employeeQuestions: number;
  leadQuestions: number;
  /** Minutes for the EMPLOYEE, rounded. The lead's form is a different length. */
  employeeMinutes: number;
  leadMinutes: number;
  tooLong: boolean;
};

type Countable = {
  responseType: ResponseType;
  answeredBy: string;
  /** Set when the question only appears after a parent answer (§6). */
  dependsOn?: string | null;
};

/**
 * Counts each side separately, because they answer different forms.
 *
 * An employee never sees Manager Review; a lead never answers Your Voice. One
 * combined total would describe a form nobody fills in.
 *
 * CONDITIONAL QUESTIONS ARE NOT COUNTED.
 *
 * "If yes, what happened and why?" is only asked of somebody who answered Yes,
 * and most people answer No — so counting it charges every reader for a question
 * they will never see. Including the three conditional KPI questions puts the
 * real form at 17 minutes; excluding them gives 13, which is what
 * FORM_BLUEPRINT.md states and what the typical person actually experiences.
 *
 * The estimate is deliberately the TYPICAL case, not the worst one: it exists to
 * make HR feel the cost of adding a question, and a number inflated by branches
 * nobody takes would make every form look too long and the warning meaningless.
 */
export function estimateFill(questions: readonly Countable[]): FillEstimate {
  const asked = questions.filter((q) => !q.dependsOn);

  const employee = asked.filter(
    (q) => q.answeredBy === "EMPLOYEE_AND_LEAD" || q.answeredBy === "EMPLOYEE_ONLY",
  );
  const lead = asked.filter(
    (q) => q.answeredBy === "EMPLOYEE_AND_LEAD" || q.answeredBy === "LEAD_ONLY",
  );

  const seconds = (list: readonly Countable[]) =>
    list.reduce((total, q) => total + (SECONDS_PER_TYPE[q.responseType] ?? 15), 0);

  const employeeMinutes = Math.round(seconds(employee) / 60);
  const leadMinutes = Math.round(seconds(lead) / 60);

  return {
    employeeQuestions: employee.length,
    leadQuestions: lead.length,
    employeeMinutes,
    leadMinutes,
    // The employee's form is the one that has to stay short: they fill it once,
    // under time pressure, often on a phone. A lead filling forty of them is a
    // different problem and a different conversation.
    tooLong: employeeMinutes > LONG_FORM_MINUTES,
  };
}
