"use server";

/**
 * Exporting a whole form's questions as a CSV HR can read, edit in a
 * spreadsheet, or hand to somebody who needs to see the form without opening
 * the builder — section, department (where one applies), the question, its
 * help text, how it is answered, who answers it, whether it is required, and
 * its choices if it has any.
 *
 * THIS IS A READ-ONLY MIRROR, not the Job Specific Skills import/export pair
 * in `lib/questions/import.ts` and `lib/questions/import-actions.ts`. That
 * pair is scoped to one section and round-trips (export it, edit it, import
 * it back, and nothing duplicates). This one covers a WHOLE FORM — every
 * section a cycle type asks, or the worker sheet — and nothing here can be
 * re-imported: it exists so the form can be looked at, not edited by file.
 * Building a second importer for it would be a second answer to "what does
 * this file mean", and the two would eventually disagree.
 */

import { checkRole } from "@/lib/auth/guards";
import { ADMIN_ROLES } from "@/lib/auth/roles";
import { getSectionConfig } from "@/lib/forms/section-config";
import { toCsv } from "@/lib/questions/import";
import { answeredByLabel, responseTypeLabel } from "@/lib/questions/labels";
import { createClient } from "@/lib/supabase/server";
import { listWorkerQuestions } from "@/lib/worker/questions";
import type { Enums } from "@/types/database";

export type ExportResult = { ok: true; csv: string; filename: string } | { ok: false; error: string };

const FORM_HEADERS = [
  "section",
  "department",
  "question_text",
  "help_text",
  "response_type",
  "answered_by",
  "required",
  "options",
] as const;

const WORKER_HEADERS = [
  "section",
  "question_text",
  "help_text",
  "response_type",
  "answered_by",
  "required",
  "options",
] as const;

/**
 * The Evaluation and Increment forms share this reader — the same two-value
 * `cycle_scope` filter `assembleForDepartment` and the builder already use
 * (BuilderScreen's own comment: "the builder shows exactly the set the cycle
 * will send"), so the export can never list a question that cycle does not
 * actually ask.
 */
async function exportStaffForm(
  cycleType: "EVALUATION" | "INCREMENT",
  filename: string,
): Promise<ExportResult> {
  // §9: HR writes configuration, the MD reads it. A download is a read.
  const auth = await checkRole(ADMIN_ROLES);
  if (!auth.ok) return { ok: false, error: auth.error.message };

  const supabase = await createClient();

  const [{ data: questions, error }, { data: departments }, { data: mappings }, { data: options }] =
    await Promise.all([
      supabase
        .from("questions")
        .select("id, text, help_text, section, response_type, answered_by, is_required, sort_order")
        .eq("is_active", true)
        .in("cycle_scope", cycleType === "INCREMENT" ? ["BOTH", "INCREMENT_ONLY"] : ["BOTH", "EVALUATION_ONLY"])
        .order("sort_order"),
      supabase.from("departments").select("id, name").eq("is_active", true),
      supabase.from("department_questions").select("department_id, question_id, sort_order"),
      supabase.from("question_options").select("question_id, label, sort_order").order("sort_order"),
    ]);

  if (error || !questions) return { ok: false, error: "Could not read the question bank." };

  // HR's own section order (P25) — the raw value still travels in the file
  // (it is what makes the row machine-readable, and a label HR can rename at
  // any time is not), but the ROWS are grouped in the order the form actually
  // renders in.
  const sectionConfig = await getSectionConfig();
  const rank = (section: Enums<"question_section">) => {
    const at = sectionConfig.order.indexOf(section);
    return at === -1 ? sectionConfig.order.length : at;
  };

  const departmentsById = new Map((departments ?? []).map((d) => [d.id, d.name]));
  const optionsByQuestion = new Map<string, string[]>();
  for (const o of options ?? []) {
    const list = optionsByQuestion.get(o.question_id) ?? [];
    list.push(o.label);
    optionsByQuestion.set(o.question_id, list);
  }
  const mappingsByQuestion = new Map<string, Array<{ departmentId: string; sortOrder: number }>>();
  for (const m of mappings ?? []) {
    const list = mappingsByQuestion.get(m.question_id) ?? [];
    list.push({ departmentId: m.department_id, sortOrder: m.sort_order });
    mappingsByQuestion.set(m.question_id, list);
  }

  const rows: string[][] = [];
  const sorted = [...questions].sort(
    (a, b) => rank(a.section) - rank(b.section) || a.sort_order - b.sort_order,
  );

  for (const q of sorted) {
    const optionLabels = optionsByQuestion.get(q.id) ?? [];
    const base = [
      q.section,
      "", // filled in below for Job Specific Skills rows
      q.text,
      q.help_text ?? "",
      responseTypeLabel(q.response_type),
      answeredByLabel(q.answered_by),
      q.is_required ? "Yes" : "No",
      optionLabels.join("; "),
    ];

    const myMappings = (mappingsByQuestion.get(q.id) ?? [])
      .map((m) => ({ ...m, name: departmentsById.get(m.departmentId) }))
      .filter((m): m is { departmentId: string; sortOrder: number; name: string } => Boolean(m.name))
      .sort((a, b) => a.name.localeCompare(b.name) || a.sortOrder - b.sortOrder);

    if (myMappings.length === 0) {
      // A Job Specific Skills question mapped to nobody is still a question in
      // the bank — one row, department blank, rather than vanishing from a
      // file whose whole point is showing what exists.
      rows.push(base);
    } else {
      // One row per department: the same question can read differently on two
      // teams' lists only in which departments it belongs to, never in its
      // own text, so repeating the row is what shows that plainly.
      for (const m of myMappings) {
        rows.push([...base.slice(0, 1), m.name, ...base.slice(2)]);
      }
    }
  }

  return { ok: true, csv: toCsv([[...FORM_HEADERS], ...rows]), filename };
}

export async function exportEvaluationFormQuestions(): Promise<ExportResult> {
  return exportStaffForm("EVALUATION", "evaluation-form-questions.csv");
}

export async function exportIncrementFormQuestions(): Promise<ExportResult> {
  return exportStaffForm("INCREMENT", "increment-form-questions.csv");
}

/**
 * The worker sheet. No department column: every active worker question is on
 * every worker's sheet, there is no per-team mapping to show (§7 — the worker
 * module shares no department concept with the staff form).
 *
 * `answered_by` is written as "Team leader" rather than read off the stored
 * `answered_by` column. That column still carries EMPLOYEE_AND_LEAD on most
 * rows from 0047, when a worker briefly rated themselves too — WORKER-2
 * reversed that at the owner's instruction ("only the supervisor will fill
 * the form"), and nothing ever rewrote the column once the self layer was
 * retired. Reading it here would print a fact about the form that stopped
 * being true, on the one export meant to say what the form actually does.
 */
export async function exportWorkerFormQuestions(): Promise<ExportResult> {
  const auth = await checkRole(ADMIN_ROLES);
  if (!auth.ok) return { ok: false, error: auth.error.message };

  const questions = await listWorkerQuestions();
  const active = questions.filter((q) => q.isActive).sort((a, b) => a.sortOrder - b.sortOrder);

  const rows = active.map((q) => [
    "QUALITIES",
    q.text,
    q.helpText ?? "",
    responseTypeLabel(q.responseType),
    "Team leader",
    q.isRequired ? "Yes" : "No",
    // Tick 3 never carries options (P2-5) — the three ticks are fixed, not a
    // choice list HR writes — so this column is always empty on this export.
    "",
  ]);

  return {
    ok: true,
    csv: toCsv([[...WORKER_HEADERS], ...rows]),
    filename: "worker-form-questions.csv",
  };
}
