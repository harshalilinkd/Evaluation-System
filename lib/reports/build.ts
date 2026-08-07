/** The combined report (P20). Both sides of a blind evaluation, computed server-side. */

import "server-only";

import { cycleError, type CycleResult } from "@/lib/cycles/schema";
import { computeScores, computeVariance, DEFAULT_VARIANCE_THRESHOLD } from "@/lib/evaluations/scoring";
import { getEvaluationForm } from "@/lib/forms/get-form";
import { SECTION_LABELS, SECTION_ORDER } from "@/lib/forms/labels";
import { isNarrative, readableAnswer } from "@/lib/reports/answer";
import { NARRATIVE_TOPICS, PAIRED_QUESTION_IDS } from "@/lib/reports/topics";
import type {
  EvaluationReport,
  NarrativeBlock,
  NarrativePair,
  ReportAudience,
  ReportRow,
  ReportSection,
  SectionAverages,
} from "@/lib/reports/types";
import { createClient } from "@/lib/supabase/server";
import type { FormQuestion } from "@/lib/forms/types";

/**
 * Build one evaluation's combined report.
 *
 * **The audience is a parameter, not a lookup.** P15-7 made the same call for
 * the print pack and the reason is the same one, sharpened: the salary block is
 * omitted for anybody who is not HR or the MD, and "omitted" has to mean the key
 * is absent from the returned object — not present and blank. A blanked key
 * survives serialisation and arrives in the browser as evidence that a salary
 * block exists, which is exactly what §5 forbids.
 *
 * Everything is read through the AUTHENTICATED client, so RLS is the real
 * protection. A caller who may not read the SELF layer gets no self answers
 * whatever they pass as `audience` — the parameter decides the salary block's
 * existence, never whether the blind layers are visible.
 */
export async function buildEvaluationReport(
  evaluationId: string,
  audience: ReportAudience | "OTHER",
): Promise<CycleResult<EvaluationReport>> {
  const supabase = await createClient();

  const { data: evaluation, error } = await supabase
    .from("evaluations")
    .select(
      // P3-11: written out in full, never concatenated — supabase-js infers the
      // row type from this string and degrades everything to GenericStringError
      // on anything it cannot statically parse.
      "id, cycle_id, evaluatee_id, lead_id, department_id, status, self_submitted_at, lead_submitted_at, self_skipped, lead_skipped, final_overall",
    )
    .eq("id", evaluationId)
    .maybeSingle();

  if (error) return cycleError("QUERY_FAILED", `Could not read the evaluation: ${error.message}`);
  // RLS makes a row they may not see indistinguishable from one that does not
  // exist. Distinguishing them would make this an oracle for who is being
  // evaluated (P6-11).
  if (!evaluation) return cycleError("NOT_FOUND", "That report is not available.");

  const { data: cycle } = await supabase
    .from("evaluation_cycles")
    .select("id, name, period_label, cycle_type, variance_threshold")
    .eq("id", evaluation.cycle_id)
    .maybeSingle();

  if (!cycle) return cycleError("NOT_FOUND", "That evaluation's cycle is missing.");

  const isIncrement = cycle.cycle_type === "INCREMENT";
  const threshold = cycle.variance_threshold ?? DEFAULT_VARIANCE_THRESHOLD;

  /* -- Both layers' forms. Each is the FROZEN snapshot (§5), so the report
        shows the questions as they were asked, not as they read today. -- */
  const [selfForm, leadForm] = await Promise.all([
    getEvaluationForm(evaluationId, "SELF"),
    getEvaluationForm(evaluationId, "LEAD"),
  ]);

  if (!selfForm.ok) return cycleError("FORM_FAILED", "Could not assemble the self layer.");
  if (!leadForm.ok) return cycleError("FORM_FAILED", "Could not assemble the lead layer.");

  const selfAnswers = selfForm.data.answers;
  const leadAnswers = leadForm.data.answers;

  const { data: responses } = await supabase
    .from("evaluation_responses")
    .select("layer, comments")
    .eq("evaluation_id", evaluationId);

  const leadRow = responses?.find((r) => r.layer === "LEAD");
  const leadComments = (leadRow?.comments ?? {}) as Record<string, string>;

  /* -- People and the department. -- */
  const ids = [evaluation.evaluatee_id, evaluation.lead_id].filter((v): v is string => Boolean(v));
  const [{ data: people }, { data: department }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, employee_code, designation, date_of_joining")
      .in("id", ids),
    evaluation.department_id
      ? supabase.from("departments").select("name").eq("id", evaluation.department_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const evaluatee = people?.find((p) => p.id === evaluation.evaluatee_id);
  const lead = people?.find((p) => p.id === evaluation.lead_id);

  /* ---------- Summary ---------- */
  //
  // Recomputed rather than read from the stored overall on purpose: the stored
  // figure is the layer's own average at ITS submission (§11), and the report
  // needs the two side by side under one definition. They agree — the same
  // function produced both — but computing here means the report cannot show a
  // gap between two numbers derived by different code.
  const selfScores = computeScores(selfForm.data, selfAnswers);
  const leadScores = computeScores(leadForm.data, leadAnswers);

  const variance = computeVariance(selfAnswers, leadAnswers, leadForm.data, threshold);
  const varianceByQuestion = new Map(variance.map((v) => [v.questionId, v]));
  const flaggedCount = variance.filter((v) => v.flag !== "none").length;

  const sectionAverages: SectionAverages[] = SECTION_ORDER.map((section) => {
    const self = selfScores.sectionScores[section] ?? null;
    const leadValue = leadScores.sectionScores[section] ?? null;
    return {
      section,
      label: SECTION_LABELS[section],
      self,
      lead: leadValue,
      gap: self === null || leadValue === null ? null : round2(leadValue - self),
    };
  }).filter((s) => s.self !== null || s.lead !== null);

  /* ---------- Sections and rows ---------- */
  //
  // The lead's snapshot is the superset: it carries EMPLOYEE_AND_LEAD and
  // LEAD_ONLY. The employee's carries EMPLOYEE_AND_LEAD and EMPLOYEE_ONLY. The
  // union, in form order, is every question that was asked of anybody.
  const byId = new Map<string, FormQuestion>();
  for (const q of [...leadForm.data.questions, ...selfForm.data.questions]) {
    if (!byId.has(q.questionId)) byId.set(q.questionId, q);
  }
  const allQuestions = [...byId.values()].sort(
    (a, b) => rank(a.section) - rank(b.section) || a.sortOrder - b.sortOrder,
  );

  // §6: a question hidden by an unmet condition was never asked, so it is not
  // part of the record. Showing it with two blanks would read as unanswered.
  const hidden = new Set([...selfForm.data.hiddenQuestionIds, ...leadForm.data.hiddenQuestionIds]);
  const answeredHidden = (id: string) =>
    selfAnswers[id] !== undefined || leadAnswers[id] !== undefined;

  const sections: ReportSection[] = [];
  for (const section of SECTION_ORDER) {
    // METADATA is drawn from the profile and the evaluation record, and is
    // already the header card. Repeating it as question rows would show the
    // same facts twice (P12-14).
    if (section === "METADATA") continue;

    const rows: ReportRow[] = allQuestions
      .filter((q) => q.section === section)
      .filter((q) => !hidden.has(q.questionId) || answeredHidden(q.questionId))
      // The narrative bands own the free text; the ratings band is ratings.
      .filter((q) => !isNarrative(q))
      .map((question): ReportRow => {
        const v = varianceByQuestion.get(question.questionId);
        return {
          questionId: question.questionId,
          text: question.text,
          section: question.section,
          sectionLabel: SECTION_LABELS[question.section],
          responseType: question.responseType,
          selfAnswer:
            question.answeredBy === "LEAD_ONLY"
              ? null
              : readableAnswer(question, selfAnswers[question.questionId]),
          leadAnswer:
            question.answeredBy === "EMPLOYEE_ONLY"
              ? null
              : readableAnswer(question, leadAnswers[question.questionId]),
          gap: v?.delta ?? null,
          flag: v?.flag ?? "none",
          leadComment: leadComments[question.questionId]?.trim() || null,
        };
      });

    if (rows.length > 0) {
      sections.push({ section, label: SECTION_LABELS[section], rows });
    }
  }

  /* ---------- Narratives ---------- */

  const paired: NarrativePair[] = [];
  for (const topic of NARRATIVE_TOPICS) {
    const selfQ = topic.selfQuestionId ? byId.get(topic.selfQuestionId) : undefined;
    const leadQ = topic.leadQuestionId ? byId.get(topic.leadQuestionId) : undefined;
    // Neither side is in this snapshot — an older bank, or a form HR authored.
    // Dropping the row is right: an empty topic is noise.
    if (!selfQ && !leadQ) continue;

    paired.push({
      topic: topic.topic,
      selfQuestion: selfQ?.text ?? null,
      selfAnswer: selfQ ? readableAnswer(selfQ, selfAnswers[selfQ.questionId]) : null,
      leadQuestion: leadQ?.text ?? null,
      leadAnswer: leadQ ? readableAnswer(leadQ, leadAnswers[leadQ.questionId]) : null,
    });
  }

  // Bands 4 and 5 take every narrative answer the topics did not claim, so
  // nothing anybody wrote can fall out of the report.
  const employeeVoice: NarrativeBlock[] = allQuestions
    .filter((q) => isNarrative(q) && q.answeredBy !== "LEAD_ONLY")
    .filter((q) => !PAIRED_QUESTION_IDS.has(q.questionId))
    .filter((q) => !hidden.has(q.questionId) || answeredHidden(q.questionId))
    .map((q) => ({ question: q.text, answer: readableAnswer(q, selfAnswers[q.questionId]) }));

  const leadAssessment: NarrativeBlock[] = allQuestions
    .filter((q) => q.answeredBy !== "EMPLOYEE_ONLY")
    .filter((q) => q.section === "MANAGER_REVIEW")
    .filter((q) => !PAIRED_QUESTION_IDS.has(q.questionId))
    .filter((q) => !hidden.has(q.questionId) || answeredHidden(q.questionId))
    // The lead's assessment is prose AND the two selects and the concern flag —
    // "can they handle more responsibility" belongs with the written verdict,
    // not among the ratings.
    .filter((q) => isNarrative(q) || q.responseType === "SINGLE_SELECT" || q.responseType === "BOOLEAN")
    .map((q) => ({ question: q.text, answer: readableAnswer(q, leadAnswers[q.questionId]) }));

  /* ---------- Meta: §12's record of what actually happened ---------- */

  const { data: returnRows } = await supabase
    .from("audit_log")
    .select("created_at, action, diff, actor_id, reason")
    .eq("entity", "evaluation")
    .eq("entity_id", evaluationId)
    .in("action", ["evaluation.hr_return", "evaluation.md_return", "evaluation.md_send_back"])
    .order("created_at", { ascending: false });

  /* -- The reason is a COLUMN on audit_log, not a key in the diff. Reading it
        from the diff returns undefined and silently renders a return with no
        explanation — which is the one thing §8 requires a return to carry. The
        layer, by contrast, IS in the diff: `returnPatch` puts `returned_to` on
        the evaluation patch, and the patch is what `diff.after` records. -- */
  const returns = (returnRows ?? []).map((row) => {
    const diff = (row.diff ?? {}) as { after?: { returned_to?: string } };
    return {
      at: row.created_at,
      returnedTo: diff.after?.returned_to ?? null,
      reason: row.reason ?? null,
      by: people?.find((p) => p.id === row.actor_id)?.full_name ?? null,
    };
  });

  /* ---------- HR's and the MD's layer ---------- */

  const { data: review } = await supabase
    .from("evaluation_reviews")
    .select("*")
    .eq("evaluation_id", evaluationId)
    .maybeSingle();

  const reviewerIds = [review?.hr_reviewed_by, review?.md_reviewed_by].filter(
    (v): v is string => Boolean(v),
  );
  const { data: reviewers } = reviewerIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", reviewerIds)
    : { data: [] };
  const reviewerName = (id: string | null | undefined) =>
    id ? ((reviewers ?? []).find((p) => p.id === id)?.full_name ?? null) : null;

  const report: EvaluationReport = {
    evaluationId,
    cycleId: cycle.id,
    isIncrement,
    header: {
      employeeName: evaluatee?.full_name ?? "Unknown",
      employeeCode: evaluatee?.employee_code ?? null,
      department: department?.name ?? null,
      designation: evaluatee?.designation ?? null,
      dateOfJoining: evaluatee?.date_of_joining ?? null,
      leadName: lead?.full_name ?? null,
      cycleName: cycle.name,
      cycleType: isIncrement ? "Increment" : "Evaluation",
      period: cycle.period_label,
      status: evaluation.status,
    },
    summary: {
      selfOverall: selfScores.overallScore,
      leadOverall: leadScores.overallScore,
      // Read from the row, never recomputed: §5 says a stored score is never
      // recalculated on read, and this one was agreed between two people
      // rather than derived from anything.
      finalOverall: evaluation.final_overall === null ? null : Number(evaluation.final_overall),
      overallGap:
        selfScores.overallScore === null || leadScores.overallScore === null
          ? null
          : round2(leadScores.overallScore - selfScores.overallScore),
      flaggedCount,
      sections: sectionAverages,
      flagThreshold: threshold,
    },
    sections,
    narratives: { paired, employeeVoice, leadAssessment },
    meta: {
      selfSubmittedAt: evaluation.self_submitted_at,
      leadSubmittedAt: evaluation.lead_submitted_at,
      selfSkipped: evaluation.self_skipped ?? false,
      leadSkipped: evaluation.lead_skipped ?? false,
      returns,
    },
    review: {
      hrSummary: review?.hr_summary ?? null,
      hrRecommendation: review?.hr_recommendation ?? null,
      hrReviewedAt: review?.hr_reviewed_at ?? null,
      hrReviewedByName: reviewerName(review?.hr_reviewed_by),
      mdRemarks: review?.md_remarks ?? null,
      mdOutcome: review?.md_outcome ?? null,
      mdReviewedAt: review?.md_reviewed_at ?? null,
      mdReviewedByName: reviewerName(review?.md_reviewed_by),
    },
  };

  /* -- The salary block, and the reason it is attached LAST.
        The key is added only when both conditions hold. Building the object
        without it and assigning conditionally is what makes "omitted" literal:
        there is no code path that puts a `salary` key on this object with empty
        values, so a serialised response cannot carry one. -- */
  if (isIncrement && (audience === "HR_ADMIN" || audience === "MD")) {
    const { data: decision } = await supabase
      .from("evaluation_decisions")
      .select("old_salary, increment_pct, new_salary, increment_type")
      .eq("evaluation_id", evaluationId)
      .maybeSingle();

    report.salary = {
      oldSalary: decision?.old_salary ?? null,
      incrementPct: decision?.increment_pct ?? null,
      newSalary: decision?.new_salary ?? null,
      incrementType: decision?.increment_type ?? null,
      complete:
        decision?.old_salary !== null &&
        decision?.old_salary !== undefined &&
        decision?.new_salary !== null &&
        decision?.new_salary !== undefined,
    };
  }

  return { ok: true, data: report };
}

function rank(section: string): number {
  const index = SECTION_ORDER.indexOf(section as (typeof SECTION_ORDER)[number]);
  return index === -1 ? SECTION_ORDER.length : index;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
