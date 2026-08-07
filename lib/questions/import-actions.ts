"use server";

/** Bulk Job Specific Skills import: preview, commit and the export mirror. */

import { revalidatePath } from "next/cache";

import { checkRole } from "@/lib/auth/guards";
import { ADMIN_ROLES } from "@/lib/auth/roles";
import {
  buildImportPreview,
  IMPORT_HEADERS,
  toCsv,
  type ImportPreview,
} from "@/lib/questions/import";
import { responseTypeLabel, answeredByLabel } from "@/lib/questions/labels";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

export type PreviewResult =
  | { ok: true; preview: ImportPreview }
  | { ok: false; error: string };

export type CommitResult =
  | { ok: true; created: number; mapped: number; departmentsCreated: number; message: string }
  | { ok: false; error: string };

/**
 * Everything the decision needs, read once.
 *
 * The bank is read WITHOUT a status filter and the active flag travels with each
 * row: `buildImportPreview` is the one place that decides a retired question
 * does not count as "already exists", and filtering here would put that rule in
 * two places.
 */
async function readContext() {
  const supabase = await createClient();

  const [{ data: questions, error: qError }, { data: departments, error: dError }] =
    await Promise.all([
      supabase.from("questions").select("id, text, is_active"),
      supabase.from("departments").select("id, name, is_active").order("name"),
    ]);

  if (qError || dError || !questions || !departments) return null;

  return {
    supabase,
    existing: questions.map((q) => ({ id: q.id, text: q.text, isActive: q.is_active })),
    // Only ACTIVE departments count as known. A retired one (0018, 0019) cannot
    // be launched, so mapping questions into it would quietly produce a set
    // nobody will ever answer.
    departmentNames: departments.filter((d) => d.is_active).map((d) => d.name),
  };
}

export async function previewQuestionImport(csvText: string): Promise<PreviewResult> {
  const auth = await checkRole(["HR_ADMIN"]);
  if (!auth.ok) return { ok: false, error: auth.error.message };

  const context = await readContext();
  if (!context) return { ok: false, error: "Could not read the question bank." };

  return { ok: true, preview: buildImportPreview(csvText, context.existing, context.departmentNames) };
}

/**
 * Commit.
 *
 * The preview is rebuilt HERE, from the same builder, rather than trusting what
 * the screen sends. P19D-3: without the re-run the browser could talk the server
 * into accepting a row it had just been shown as broken.
 */
export async function commitQuestionImport(
  csvText: string,
  fileName: string,
  createDepartments: boolean,
): Promise<CommitResult> {
  // §9 as amended: HR writes configuration, the MD reads it. `ADMIN_ROLES`
  // would hand the MD a write, which AMEND-2 deliberately took back.
  const auth = await checkRole(["HR_ADMIN"]);
  if (!auth.ok) return { ok: false, error: auth.error.message };

  const context = await readContext();
  if (!context) return { ok: false, error: "Could not read the question bank." };

  const preview = buildImportPreview(csvText, context.existing, context.departmentNames);

  if (preview.fatal) return { ok: false, error: preview.fatal };
  if (preview.rows.length === 0) return { ok: false, error: "There are no questions in that file." };

  /* -- One bad row imports nothing (P19C-8). A file that is half wrong should be
        corrected and re-uploaded: importing the good half leaves HR working out
        by hand which rows landed, and the second attempt then reports those as
        already existing. -- */
  if (preview.counts.errors > 0) {
    const first = preview.rows.find((r) => r.status === "ERROR");
    return {
      ok: false,
      error: `Nothing was imported. Row ${first?.line}: ${first?.note ?? "could not be read."}${
        preview.counts.errors > 1 ? ` And ${preview.counts.errors - 1} more.` : ""
      }`,
    };
  }

  if (preview.unknownDepartments.length > 0 && !createDepartments) {
    return {
      ok: false,
      error: `Nothing was imported. ${preview.unknownDepartments.join(", ")} ${
        preview.unknownDepartments.length === 1 ? "does" : "do"
      } not exist yet — tick the box to create ${
        preview.unknownDepartments.length === 1 ? "it" : "them"
      }, or correct the file.`,
    };
  }

  /* -- Position within its own department, so the order in the file is the
        order on the form. `department_questions.sort_order` is the one that
        wins for a mapped question (P3-9). -- */
  const positionByDepartment = new Map<string, number>();
  const payload = preview.rows.map((row) => {
    const key = row.department.toLowerCase();
    const next = (positionByDepartment.get(key) ?? 0) + 10;
    positionByDepartment.set(key, next);
    return {
      department: row.department,
      text: row.text,
      help_text: row.helpText,
      response_type: row.responseType,
      answered_by: row.answeredBy,
      is_required: row.isRequired,
      existing_id: row.existingId ?? null,
      sort_order: next,
    };
  });

  const { data, error } = await context.supabase.rpc("import_questions", {
    p_rows: payload as unknown as Json,
    p_file: fileName,
    p_create_departments: createDepartments,
  });

  if (error) {
    return { ok: false, error: error.message || "The import could not be completed." };
  }

  const result = (data ?? {}) as {
    questions_created?: number;
    mappings_added?: number;
    departments_created?: number;
  };
  const created = result.questions_created ?? 0;
  const mapped = result.mappings_added ?? 0;
  const departmentsCreated = result.departments_created ?? 0;

  revalidatePath("/admin/questions");
  revalidatePath("/admin/form-builder");
  revalidatePath("/admin/form-builder/questions");
  revalidatePath("/admin/departments");

  const parts = [`${created} ${created === 1 ? "question" : "questions"} created`];
  parts.push(`${mapped} ${mapped === 1 ? "mapping" : "mappings"} added`);
  if (departmentsCreated > 0) {
    parts.push(
      `${departmentsCreated} ${departmentsCreated === 1 ? "department" : "departments"} created`,
    );
  }

  return {
    ok: true,
    created,
    mapped,
    departmentsCreated,
    message: parts.join(", ") + ".",
  };
}

/**
 * The mirror.
 *
 * Produces exactly the shape the importer reads, so HR can export, edit in
 * Sheets and re-import — and a round trip is a no-op, because every exported
 * question matches an existing one by text and is mapped, never duplicated.
 */
export async function exportQuestions(departmentId?: string): Promise<
  { ok: true; csv: string; filename: string } | { ok: false; error: string }
> {
  const auth = await checkRole(ADMIN_ROLES);
  if (!auth.ok) return { ok: false, error: auth.error.message };

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("department_questions")
    .select(
      "sort_order, departments!inner(id, name), questions!inner(text, help_text, response_type, answered_by, is_required, is_active)",
    )
    .order("sort_order");

  if (error || !data) return { ok: false, error: "Could not read the questions." };

  const rows = data
    .filter((r) => r.questions.is_active)
    .filter((r) => !departmentId || r.departments.id === departmentId)
    .sort(
      (a, b) =>
        a.departments.name.localeCompare(b.departments.name) || a.sort_order - b.sort_order,
    )
    .map((r) => [
      r.departments.name,
      r.questions.text,
      r.questions.help_text ?? "",
      responseTypeLabel(r.questions.response_type),
      answeredByLabel(r.questions.answered_by),
      r.questions.is_required ? "Yes" : "No",
    ]);

  const name = departmentId
    ? data.find((r) => r.departments.id === departmentId)?.departments.name
    : null;

  return {
    ok: true,
    csv: toCsv([[...IMPORT_HEADERS], ...rows]),
    filename: `job-specific-questions${name ? `-${name.toLowerCase().replace(/\s+/g, "-")}` : ""}.csv`,
  };
}
