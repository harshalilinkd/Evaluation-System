/** Assembling one evaluation into a printable document. CLAUDE.md §6, §9, §11. */

import "server-only";

import { cycleError, type CycleResult } from "@/lib/cycles/schema";
import { SCALE_0_5_LABELS } from "@/components/appraise/tier";
import { getEvaluationForm } from "@/lib/forms/get-form";
import { DEPARTMENT_SECTION, SECTION_LABELS, sectionRank } from "@/lib/forms/labels";
import { createClient } from "@/lib/supabase/server";
import type { Enums } from "@/types/database";

/**
 * WHO IS THIS COPY FOR?
 *
 * The same evaluation prints two ways. The internal copy carries everything;
 * the employee's copy is filtered by §9's disclosure policy — "sees final score
 * + decision, **never** raw lead comments" — and is labelled so nobody has to
 * guess which one they are holding.
 *
 * The audience is a parameter rather than something inferred from who is signed
 * in, because HR legitimately prints an employee copy to hand over. Inferring it
 * from the session would make that impossible and would make the filtering
 * invisible.
 */
export type PrintAudience = "internal" | "employee";

export type PrintRatingRow = {
  index: number;
  questionId: string;
  text: string;
  helpText: string | null;
  section: Enums<"question_section">;
  sectionLabel: string;
  self: number | null;
  lead: number | null;
  final: number | null;
  /** The lead's per-question comment. Absent on an employee copy below FULL. */
  remark: string | null;
};

export type PrintNarrative = { heading: string; body: string };

export type PrintDocument = {
  audience: PrintAudience;
  /** True when the lead's comments and internal remarks have been withheld. */
  redacted: boolean;
  disclosure: Enums<"disclosure_policy">;
  status: Enums<"evaluation_status">;

  meta: {
    employeeName: string;
    employeeCode: string | null;
    department: string | null;
    designation: string | null;
    dateOfJoining: string | null;
    period: string;
    leadName: string | null;
    evaluationDate: string | null;
  };

  /** §6's fixed wording, printed on the document itself. */
  scaleLegend: Array<{ value: number; label: string }>;

  kpi: Array<{ question: string; self: string; lead: string }>;
  ratings: PrintRatingRow[];
  sections: Array<{ section: Enums<"question_section">; label: string; rows: PrintRatingRow[] }>;
  finalAverage: number | null;
  selfAverage: number | null;
  leadAverage: number | null;

  employeeNarrative: PrintNarrative[];
  leadNarrative: PrintNarrative[];

  decision: {
    promotion: string | null;
    incrementType: string | null;
    oldSalary: number | null;
    incrementPct: number | null;
    newSalary: number | null;
    trainingRequired: boolean | null;
    concerns: string | null;
    remarks: string | null;
  } | null;
};

/** Every value that is not a number, rendered for a ruled cell. */
function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.join(", ");
  return String(value);
}

function toScore(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function buildPrintDocument(
  evaluationId: string,
  audience: PrintAudience,
): Promise<CycleResult<PrintDocument>> {
  const supabase = await createClient();

  const { data: evaluation } = await supabase
    .from("evaluations")
    .select("id, status, evaluatee_id, lead_id, department_id, cycle_id, self_overall, lead_overall, final_overall, md_finalized_at")
    .eq("id", evaluationId)
    .maybeSingle();

  if (!evaluation) return cycleError("NOT_FOUND", "That evaluation no longer exists.");

  const [selfForm, leadForm, mdForm] = await Promise.all([
    getEvaluationForm(evaluationId, "SELF"),
    getEvaluationForm(evaluationId, "LEAD"),
    getEvaluationForm(evaluationId, "MD"),
  ]);

  if (!selfForm.ok) return cycleError(selfForm.error.code, selfForm.error.message);
  if (!leadForm.ok) return cycleError(leadForm.error.code, leadForm.error.message);

  const { data: cycle } = await supabase
    .from("evaluation_cycles")
    .select("period_label, disclosure")
    .eq("id", evaluation.cycle_id)
    .maybeSingle();

  const { data: people } = await supabase
    .from("profiles")
    .select("id, full_name, employee_code, designation, date_of_joining")
    .in("id", [evaluation.evaluatee_id, evaluation.lead_id].filter((v): v is string => Boolean(v)));

  const { data: department } = evaluation.department_id
    ? await supabase.from("departments").select("name").eq("id", evaluation.department_id).maybeSingle()
    : { data: null };

  const { data: decision } = await supabase
    .from("evaluation_decisions")
    .select("*")
    .eq("evaluation_id", evaluationId)
    .maybeSingle();

  const employee = (people ?? []).find((p) => p.id === evaluation.evaluatee_id);
  const lead = (people ?? []).find((p) => p.id === evaluation.lead_id);
  const disclosure = cycle?.disclosure ?? "SCORE_AND_DECISION";

  /* -- §9: what an employee copy may carry -- */
  //
  // Only FULL admits raw lead comments. Anything below it and the per-question
  // remarks, the lead's written blocks and the MD's internal remarks come out.
  // The scores and the decision stay: those are what §9 says the employee sees.
  const redacted = audience === "employee" && disclosure !== "FULL";

  /* -- The ratings table -- */
  const scored = leadForm.data.questions
    .filter((q) => q.responseType === "SCALE_0_5")
    .sort((a, b) => sectionRank(a.section) - sectionRank(b.section) || a.sortOrder - b.sortOrder);

  const ratings: PrintRatingRow[] = scored.map((q, i) => ({
    index: i + 1,
    questionId: q.questionId,
    text: q.text,
    helpText: q.helpText,
    section: q.section,
    // Sourced from SECTION_LABELS, never retyped (§0.2). The department is
    // appended so a printed page explains why this person was asked it.
    sectionLabel:
      q.section === DEPARTMENT_SECTION && department?.name
        ? `${SECTION_LABELS[q.section]} — ${department.name}`
        : SECTION_LABELS[q.section],
    self: toScore(selfForm.data.answers[q.questionId]),
    lead: toScore(leadForm.data.answers[q.questionId]),
    // The MD layer holds an explicit value for every scored question once
    // finalised (§11, P14-2), so this is a read, not a fallback chain.
    final: mdForm.ok ? toScore(mdForm.data.answers[q.questionId]) : null,
    remark: redacted ? null : (leadForm.data.comments[q.questionId] ?? null),
  }));

  /* -- Grouped, in SECTION_ORDER -- */
  const grouped = new Map<Enums<"question_section">, PrintRatingRow[]>();
  for (const row of ratings) {
    const list = grouped.get(row.section) ?? [];
    list.push(row);
    grouped.set(row.section, list);
  }

  const sections = [...grouped.entries()]
    .sort((a, b) => sectionRank(a[0]) - sectionRank(b[0]))
    .map(([section, rows]) => ({
      section,
      label: rows[0]?.sectionLabel ?? SECTION_LABELS[section],
      rows,
    }));

  /* -- KPI, self against lead -- */
  const kpi = leadForm.data.questions
    .filter((q) => q.section === "KPI")
    .map((q) => ({
      question: q.text,
      self: display(selfForm.data.answers[q.questionId]),
      lead: display(leadForm.data.answers[q.questionId]),
    }));

  /* -- Narrative blocks, printed in full -- */
  const narrativeOf = (
    form: typeof selfForm.data,
    predicate: (section: Enums<"question_section">, answeredBy: string) => boolean,
  ): PrintNarrative[] =>
    form.questions
      .filter(
        (q) =>
          (q.responseType === "TEXT_LONG" || q.responseType === "TEXT_SHORT") &&
          predicate(q.section, q.answeredBy),
      )
      .map((q) => ({ heading: q.text, body: display(form.answers[q.questionId]) }))
      .filter((n) => n.body !== "—");

  const employeeNarrative = narrativeOf(
    selfForm.data,
    (section) => section === "NARRATIVE" || section === "LEARNING",
  );

  const leadNarrative = redacted
    ? []
    : narrativeOf(leadForm.data, (section) => section === "MANAGER_REVIEW");

  const finals = ratings.map((r) => r.final).filter((v): v is number => v !== null);

  return {
    ok: true,
    data: {
      audience,
      redacted,
      disclosure,
      status: evaluation.status,
      meta: {
        employeeName: employee?.full_name ?? "Unknown",
        employeeCode: employee?.employee_code ?? null,
        department: department?.name ?? null,
        designation: employee?.designation ?? null,
        dateOfJoining: employee?.date_of_joining ?? null,
        period: cycle?.period_label ?? "",
        leadName: lead?.full_name ?? null,
        evaluationDate: evaluation.md_finalized_at,
      },
      // §6's wording, printed on the sheet so the document stands alone for
      // somebody who has never opened the app.
      scaleLegend: SCALE_0_5_LABELS.map((l) => ({ value: l.value, label: l.full })),
      kpi,
      ratings,
      sections,
      finalAverage:
        evaluation.final_overall ??
        (finals.length === 0 ? null : Math.round((finals.reduce((a, b) => a + b, 0) / finals.length) * 100) / 100),
      selfAverage: evaluation.self_overall,
      leadAverage: evaluation.lead_overall,
      employeeNarrative,
      leadNarrative,
      decision: decision
        ? {
            promotion: decision.promotion_recommendation,
            incrementType: decision.increment_type,
            oldSalary: decision.old_salary,
            incrementPct: decision.increment_pct,
            newSalary: decision.new_salary,
            trainingRequired: decision.training_required,
            concerns: decision.concerns,
            // The MD's internal remarks are not an employee-facing field below
            // FULL, for the same reason the lead's comments are not.
            remarks: redacted ? null : decision.md_remarks,
          }
        : null,
    },
  };
}
