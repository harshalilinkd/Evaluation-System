/** Question form validation. Messages are what HR reads, so they say what to do. */

import { z } from "zod";

export const questionOptionSchema = z.object({
  label: z.string().trim().min(1, "Give the choice a name"),
  value: z.string().trim().min(1),
});

export const questionFormSchema = z
  .object({
    id: z.string().uuid().optional(),
    text: z.string().trim().min(5, "Write the question as the person will read it").max(500),
    help_text: z.string().trim().max(500).optional().or(z.literal("")),
    section: z.string().min(1, "Choose a section"),
    response_type: z.string().min(1, "Choose how it should be answered"),
    answered_by: z.string().min(1, "Choose who answers it"),
    track: z.string().min(1, "Choose who it applies to"),
    category: z.string().min(1),
    /* -- WHICH CYCLE TYPES ASK IT (§6, column added by 0022).
          The column and the filter have existed since 0022 — `assembleForDepartment`
          already sends BOTH + EVALUATION_ONLY to an evaluation cycle and BOTH +
          INCREMENT_ONLY to an increment one — but nothing in the Form Builder ever
          showed or set it, so the only way to scope a question was a migration
          (0022 for the salary expectation, 0072 for the promotion pair).
          That is the gap FIX-54 recorded as "a real improvement and a separate
          piece of work". This is that work. -- */
    cycle_scope: z.enum(["BOTH", "EVALUATION_ONLY", "INCREMENT_ONLY"]),
    is_required: z.boolean(),
    options: z.array(questionOptionSchema),
    depends_on: z.string().uuid().nullable(),
    depends_value: z.string().nullable(),
    department_ids: z.array(z.string().uuid()),
  })
  // §1: Job Specific Skills is the one section that varies by department, so a
  // question filed there with no department is asked of nobody — a silent
  // disappearance HR would have no way to notice.
  .refine((q) => q.category !== "DEPARTMENT" || q.department_ids.length > 0, {
    message: "Choose at least one department for a Job Specific Skills question",
    path: ["department_ids"],
  })
  .refine((q) => q.category !== "CORE" || q.department_ids.length === 0, {
    message: "A question everyone answers is not mapped to departments",
    path: ["department_ids"],
  })
  // Mirrors the CHECK constraint in 0002 so HR sees a sentence rather than a
  // database error.
  .refine(
    (q) => !["SINGLE_SELECT", "MULTI_SELECT"].includes(q.response_type) || q.options.length > 0,
    { message: "Add at least one choice", path: ["options"] },
  )
  .refine((q) => (q.depends_on === null) === (q.depends_value === null), {
    message: "Choose the answer that should reveal this question",
    path: ["depends_value"],
  })
  // A question that reveals itself would never resolve and would hang the form.
  .refine((q) => !q.depends_on || q.depends_on !== q.id, {
    message: "A question cannot depend on itself",
    path: ["depends_on"],
  });

export type QuestionFormInput = z.infer<typeof questionFormSchema>;

export const reorderSchema = z.object({
  section: z.string().min(1),
  track: z.string().min(1),
  ids: z.array(z.string().uuid()).min(1),
});
