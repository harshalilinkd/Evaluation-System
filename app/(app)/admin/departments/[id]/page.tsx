/** /admin/departments/[id] — Job Specific Skills mapping for one department. */

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  MappingClient,
  type MappableQuestion,
  type MappedQuestion,
} from "@/app/(app)/admin/departments/[id]/mapping-client";
import { requireRole } from "@/lib/auth/guards";
import { ADMIN_ROLES } from "@/lib/auth/roles";
import { DEPARTMENT_SECTION, SECTION_LABELS } from "@/lib/forms/labels";
import { createClient } from "@/lib/supabase/server";

// Even the browser tab title comes from the shared map — "every screen, preview,
// export and print route" includes this one.
export const metadata: Metadata = { title: SECTION_LABELS[DEPARTMENT_SECTION] };

export default async function DepartmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(ADMIN_ROLES);
  const { id } = await params;

  const supabase = await createClient();

  const { data: department } = await supabase
    .from("departments")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();

  if (!department) notFound();

  const [{ data: bank }, { data: mappings }, { data: departments }] = await Promise.all([
    // The Job Specific Skills bank. Only this section is per-department (§1) —
    // nothing here can reach any other part of the form.
    supabase
      .from("questions")
      .select("id, text, help_text")
      .eq("section", DEPARTMENT_SECTION)
      .eq("category", "DEPARTMENT")
      .eq("is_active", true)
      .order("sort_order"),
    supabase.from("department_questions").select("department_id, question_id, sort_order"),
    supabase.from("departments").select("id, name").eq("is_active", true).order("name"),
  ]);

  const departmentName = new Map((departments ?? []).map((d) => [d.id, d.name]));

  // Which other teams already ask each question — reuse is normal, and seeing
  // that three departments already trust a question is the best argument for
  // reusing it rather than writing a fourth variation.
  const usedBy = new Map<string, string[]>();
  const mineOrder = new Map<string, number>();
  const countByDepartment = new Map<string, number>();

  for (const m of mappings ?? []) {
    countByDepartment.set(m.department_id, (countByDepartment.get(m.department_id) ?? 0) + 1);

    if (m.department_id === id) {
      mineOrder.set(m.question_id, m.sort_order);
      continue;
    }
    const name = departmentName.get(m.department_id);
    if (!name) continue;
    usedBy.set(m.question_id, [...(usedBy.get(m.question_id) ?? []), name]);
  }

  const toQuestion = (q: { id: string; text: string; help_text: string | null }): MappableQuestion => ({
    id: q.id,
    text: q.text,
    helpText: q.help_text,
    usedBy: usedBy.get(q.id) ?? [],
  });

  const mapped: MappedQuestion[] = (bank ?? [])
    .filter((q) => mineOrder.has(q.id))
    .map((q) => ({ ...toQuestion(q), sortOrder: mineOrder.get(q.id) ?? 0 }))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const available: MappableQuestion[] = (bank ?? [])
    .filter((q) => !mineOrder.has(q.id))
    .map(toQuestion);

  const otherDepartments = (departments ?? [])
    .filter((d) => d.id !== id)
    .map((d) => ({ id: d.id, name: d.name, count: countByDepartment.get(d.id) ?? 0 }))
    .filter((d) => d.count > 0);

  return (
    <MappingClient
      department={{ id: department.id, name: department.name }}
      mapped={mapped}
      available={available}
      otherDepartments={otherDepartments}
    />
  );
}
