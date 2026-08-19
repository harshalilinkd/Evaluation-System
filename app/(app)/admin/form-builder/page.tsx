/** /admin/form-builder — structure, editor and live preview on one screen. P9B. */

import type { Metadata } from "next";

import { BuilderClient } from "@/app/(app)/admin/form-builder/builder-client";
import { ErrorState } from "@/components/appraise/states";
import { requireRole } from "@/lib/auth/guards";
import { ADMIN_ROLES } from "@/lib/auth/roles";
import { getSectionConfig } from "@/lib/forms/section-config";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Form builder" };

export default async function Page() {
  // §9: the guard is the first statement.
  await requireRole(ADMIN_ROLES);

  const supabase = await createClient();

  const [{ data: questions, error }, { data: departments }, { data: mappings }, { data: options }] =
    await Promise.all([
      supabase
        .from("questions")
        .select("id, text, help_text, section, response_type, category, answered_by, cycle_scope, is_required, depends_on, depends_value, sort_order, is_active")
        .eq("is_active", true)
        .order("sort_order"),
      supabase.from("departments").select("id, name, code").eq("is_active", true).order("name"),
      supabase.from("department_questions").select("department_id, question_id, sort_order"),
      supabase.from("question_options").select("question_id, label, value, sort_order").order("sort_order"),
    ]);

  if (error) return <ErrorState title="Could not load the question bank" body={error.message} />;

  // Headcount per department, for the editor's context card: "Only the Design
  // team will see this. 6 people are in that team right now."
  const { data: people } = await supabase
    .from("profiles")
    .select("department_id")
    .eq("is_active", true)
    .eq("track", "STAFF");

  const headcount: Record<string, number> = {};
  for (const p of people ?? []) {
    if (p.department_id) headcount[p.department_id] = (headcount[p.department_id] ?? 0) + 1;
  }

  /* -- HR'S OWN SECTION NAMES AND ORDER, WHICH THIS SCREEN NEVER FETCHED.
        `StructurePane` has taken an optional `sections` prop since P25 and
        nothing ever passed it, so it fell back to the shipped names and the
        shipped order — on the very screen that carries the Edit sections
        button. Rename a section and every form changed while the list you
        renamed it in went on calling it the old thing.

        Order and active-state come with it: a section HR has parked no longer
        appears here, and one they moved appears where they put it. -- */
  const sectionConfig = await getSectionConfig();
  const sections = sectionConfig.order.map((section) => ({
    section,
    label: sectionConfig.labels[section],
    isActive: true,
    // Counted from the live bank rather than from `form_sections`, which does
    // not carry a count — and the pane recomputes it per department anyway.
    questionCount: (questions ?? []).filter((q) => q.section === section).length,
  }));

  return (
    <BuilderClient
      sections={sections}
      questions={(questions ?? []).map((q) => ({
        id: q.id,
        text: q.text,
        helpText: q.help_text,
        section: q.section,
        responseType: q.response_type,
        category: q.category,
        answeredBy: q.answered_by,
        cycleScope: q.cycle_scope ?? "BOTH",
        isRequired: q.is_required,
        dependsOn: q.depends_on,
        dependsValue: q.depends_value,
        sortOrder: q.sort_order,
      }))}
      departments={departments ?? []}
      mappings={(mappings ?? []).map((m) => ({
        departmentId: m.department_id,
        questionId: m.question_id,
        sortOrder: m.sort_order,
      }))}
      options={(options ?? []).map((o) => ({
        questionId: o.question_id,
        label: o.label,
        value: o.value,
        sortOrder: o.sort_order,
      }))}
      headcount={headcount}
    />
  );
}
