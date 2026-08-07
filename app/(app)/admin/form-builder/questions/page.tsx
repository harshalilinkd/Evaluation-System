/** /admin/form-builder/questions — the question bank, as a Form Builder tab. */

import type { Metadata } from "next";

import { BuilderTabs } from "@/app/(app)/admin/form-builder/builder-tabs";
import { QuestionsClient } from "@/app/(app)/admin/questions/questions-client";
import type { QuestionRecord } from "@/app/(app)/admin/questions/question-drawer";
import { requireRole } from "@/lib/auth/guards";
import { ADMIN_ROLES } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Question Bank" };

export default async function QuestionsPage() {
  // §9: the guard is the first statement. A non-HR user is redirected before
  // any markup exists to be hidden.
  await requireRole(ADMIN_ROLES);

  const supabase = await createClient();

  const [{ data: questions }, { data: options }, { data: mappings }, { data: departments }] =
    await Promise.all([
    supabase
      .from("questions")
      .select(
        "id, text, help_text, section, response_type, answered_by, track, category, is_required, is_active, sort_order, depends_on, depends_value",
      )
      .order("section")
      .order("sort_order"),
    supabase
      .from("question_options")
      .select("question_id, label, value, sort_order")
      .order("sort_order"),
      supabase.from("department_questions").select("question_id, department_id, departments(name)"),
      supabase.from("departments").select("id, name").eq("is_active", true).order("name"),
    ]);

  const optionsByQuestion = new Map<string, { label: string; value: string }[]>();
  for (const option of options ?? []) {
    optionsByQuestion.set(option.question_id, [
      ...(optionsByQuestion.get(option.question_id) ?? []),
      { label: option.label, value: option.value },
    ]);
  }

  // Department names per question, for the "Used in" count and the retire
  // warning — HR should see who is affected, not a number to interpret.
  const departmentsByQuestion: Record<string, string[]> = {};
  // Ids as well as names: the drawer's inline picker needs to know which boxes
  // to tick, and the retire dialog needs the names.
  const departmentIdsByQuestion: Record<string, string[]> = {};

  for (const mapping of mappings ?? []) {
    departmentIdsByQuestion[mapping.question_id] = [
      ...(departmentIdsByQuestion[mapping.question_id] ?? []),
      mapping.department_id,
    ];

    const dept = mapping.departments as unknown;
    const name = Array.isArray(dept)
      ? ((dept[0] as { name?: string } | undefined)?.name ?? null)
      : ((dept as { name?: string } | null)?.name ?? null);
    if (!name) continue;
    departmentsByQuestion[mapping.question_id] = [
      ...(departmentsByQuestion[mapping.question_id] ?? []),
      name,
    ];
  }

  const records: QuestionRecord[] = (questions ?? []).map((q) => ({
    id: q.id,
    text: q.text,
    help_text: q.help_text,
    section: q.section,
    response_type: q.response_type,
    answered_by: q.answered_by,
    track: q.track,
    category: q.category,
    is_required: q.is_required,
    is_active: q.is_active,
    sort_order: q.sort_order,
    depends_on: q.depends_on,
    depends_value: q.depends_value,
    options: optionsByQuestion.get(q.id) ?? [],
    departmentIds: departmentIdsByQuestion[q.id] ?? [],
    departmentCount: (departmentsByQuestion[q.id] ?? []).length,
  }));

  return (

    <div className="space-y-5">

      <BuilderTabs />
    <QuestionsClient
      questions={records}
      departmentsByQuestion={departmentsByQuestion}
      departments={(departments ?? []).map((d) => ({ id: d.id, name: d.name }))}
    />
    </div>
  );
}
