/** The combined report (P20). Both sides of a blind evaluation, computed server-side. */

import "server-only";

import { cycleError, type CycleResult } from "@/lib/cycles/schema";
import { computeScores, computeVariance, DEFAULT_VARIANCE_THRESHOLD } from "@/lib/evaluations/scoring";
import { getEvaluationForm } from "@/lib/forms/get-form";
import { SECTION_LABELS, SECTION_ORDER } from "@/lib/forms/labels";
import { isNarrative, readableAnswer } from "@/lib/reports/answer";
import { NARRATIVE_TOPICS } from "@/lib/reports/topics";
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
      "id, cycle_id, evaluatee_id, lead_id, co_lead_id, department_id, status, self_submitted_at, lead_submitted_at, co_lead_submitted_at, self_skipped, lead_skipped, co_lead_skipped, final_overall",
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
  const hasCoLead = Boolean(evaluation.co_lead_id);

  const [selfForm, leadForm, coLeadForm] = await Promise.all([
    getEvaluationForm(evaluationId, "SELF"),
    getEvaluationForm(evaluationId, "LEAD"),
    /* -- The SECOND manager's layer, only where there is one. Asking for it
          otherwise would be asking a question whose answer is guaranteed to be
          nothing, and every field below is null in that case — so a person with
          one manager gets exactly the report they got before. -- */
    hasCoLead ? getEvaluationForm(evaluationId, "LEAD_2") : Promise.resolve(null),
  ]);

  if (!selfForm.ok) return cycleError("FORM_FAILED", "Could not assemble the self layer.");
  if (!leadForm.ok) return cycleError("FORM_FAILED", "Could not assemble the lead layer.");
  if (coLeadForm !== null && !coLeadForm.ok) {
    return cycleError("FORM_FAILED", "Could not assemble the second reviewer's layer.");
  }
  const coLeadData = coLeadForm !== null && coLeadForm.ok ? coLeadForm.data : null;

  /* -- A LAYER THAT HAS NOT BEEN SUBMITTED CARRIES NO SCORE. Reported, and it
        was wrong in the way that matters most on this screen.

        `evaluation_responses.answers` is written by AUTOSAVE (0011), every
        twenty seconds, from the moment somebody opens their form. So a manager
        six questions into a twenty-eight-question form has six answers on the
        row — and this file averaged them and printed "MANAGER 4.00" beside the
        employee's finished 3.52, with a +0.48 gap computed against a draft.

        Three separate untruths from one omission: a rating nobody has stood
        behind, a gap measured against it, and section rows reading 4.00 for the
        one section they happen to have reached and an em dash for the rest.

        §8 is unambiguous — a layer is a draft until it is submitted, and its
        scores are stored AT submission. §11 stores them for that reason. The
        report was the one reader deriving its own from whatever happened to be
        in the blob.

        A SKIPPED layer counts as in: HR advanced past it deliberately, so what
        is there is all there is going to be. -- */
  const selfIn = Boolean(evaluation.self_submitted_at) || Boolean(evaluation.self_skipped);
  const leadIn = Boolean(evaluation.lead_submitted_at) || Boolean(evaluation.lead_skipped);
  // The identical rule for the third layer — a draft is not a rating, and the
  // second manager's autosaved half-form must not become a number either.
  const coLeadIn =
    Boolean(evaluation.co_lead_submitted_at) || Boolean(evaluation.co_lead_skipped);

  const selfAnswers = selfForm.data.answers;
  const leadAnswers = leadForm.data.answers;

  /* Scored on what is SUBMITTED. The raw answers above still feed the narrative
     bands and the per-question table, because a half-filled draft is exactly
     what HR opened the report early to read (FIX-50) — what it must not do is
     become a number. */
  const scoredSelfAnswers = selfIn ? selfAnswers : {};
  const scoredLeadAnswers = leadIn ? leadAnswers : {};
  const coLeadAnswers = coLeadData?.answers ?? {};
  const scoredCoLeadAnswers = coLeadIn ? coLeadAnswers : {};

  const { data: responses } = await supabase
    .from("evaluation_responses")
    .select("layer, comments")
    .eq("evaluation_id", evaluationId);

  const leadRow = responses?.find((r) => r.layer === "LEAD");
  const leadComments = (leadRow?.comments ?? {}) as Record<string, string>;
  const coLeadRow = responses?.find((r) => r.layer === "LEAD_2");
  const coLeadComments = (coLeadRow?.comments ?? {}) as Record<string, string>;

  /* -- People and the department. -- */
  const ids = [evaluation.evaluatee_id, evaluation.lead_id, evaluation.co_lead_id].filter(
    (v): v is string => Boolean(v),
  );
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
  const coLead = people?.find((p) => p.id === evaluation.co_lead_id);

  /* ---------- Summary ---------- */
  //
  // Recomputed rather than read from the stored overall on purpose: the stored
  // figure is the layer's own average at ITS submission (§11), and the report
  // needs the two side by side under one definition. They agree — the same
  // function produced both — but computing here means the report cannot show a
  // gap between two numbers derived by different code.
  const selfScores = computeScores(selfForm.data, scoredSelfAnswers);
  const leadScores = computeScores(leadForm.data, scoredLeadAnswers);
  const coLeadScores = coLeadData
    ? computeScores(coLeadData, scoredCoLeadAnswers)
    : null;

  /* The gap needs BOTH sides in. Measured against a draft it is not a
     disagreement, it is a reading of how far somebody has got — and §11 makes
     the gap the figure the whole product exists to surface. */
  const variance = computeVariance(scoredSelfAnswers, scoredLeadAnswers, leadForm.data, threshold);
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
      coLead: coLeadScores?.sectionScores[section] ?? null,
      gap: self === null || leadValue === null ? null : round2(leadValue - self),
    };
  }).filter((s) => s.self !== null || s.lead !== null || s.coLead !== null);

  /* ---------- Sections and rows ---------- */
  //
  // The lead's snapshot is the superset: it carries EMPLOYEE_AND_LEAD and
  // LEAD_ONLY. The employee's carries EMPLOYEE_AND_LEAD and EMPLOYEE_ONLY. The
  // union, in form order, is every question that was asked of anybody.
  const byId = new Map<string, FormQuestion>();
  for (const q of [
    ...leadForm.data.questions,
    ...(coLeadData?.questions ?? []),
    ...selfForm.data.questions,
  ]) {
    if (!byId.has(q.questionId)) byId.set(q.questionId, q);
  }
  const allQuestions = [...byId.values()].sort(
    (a, b) => rank(a.section) - rank(b.section) || a.sortOrder - b.sortOrder,
  );

  // §6: a question hidden by an unmet condition was never asked, so it is not
  // part of the record. Showing it with two blanks would read as unanswered.
  /* -- Hidden for EVERY layer that was asked. A question the second manager's
        promotion answer revealed was genuinely asked of them, so it belongs in
        the record even where the other two never saw it. -- */
  const hidden = new Set(
    [
      ...selfForm.data.hiddenQuestionIds,
      ...leadForm.data.hiddenQuestionIds,
      ...(coLeadData?.hiddenQuestionIds ?? []),
    ].filter(
      (id) =>
        !(coLeadData && !coLeadData.hiddenQuestionIds.includes(id) &&
          leadForm.data.hiddenQuestionIds.includes(id)),
    ),
  );
  const answeredHidden = (id: string) =>
    selfAnswers[id] !== undefined ||
    leadAnswers[id] !== undefined ||
    coLeadAnswers[id] !== undefined;

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
          selfScale:
            question.answeredBy === "LEAD_ONLY"
              ? null
              : scaleValueOf(question, selfAnswers[question.questionId]),
          leadScale:
            question.answeredBy === "EMPLOYEE_ONLY"
              ? null
              : scaleValueOf(question, leadAnswers[question.questionId]),
          coLeadScale:
            !coLeadData || question.answeredBy === "EMPLOYEE_ONLY"
              ? null
              : scaleValueOf(question, coLeadAnswers[question.questionId]),
          coLeadAnswer:
            !coLeadData || question.answeredBy === "EMPLOYEE_ONLY"
              ? null
              : readableAnswer(question, coLeadAnswers[question.questionId]),
          gap: v?.delta ?? null,
          flag: v?.flag ?? "none",
          leadComment:
            [leadComments[question.questionId]?.trim(), coLeadComments[question.questionId]?.trim()]
              .filter(Boolean)
              .join(" · ") || null,
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
      // The same question, answered by the second manager. Null where there is
      // no second manager, which is what the screen branches on.
      coLeadAnswer:
        leadQ && coLeadData ? readableAnswer(leadQ, coLeadAnswers[leadQ.questionId]) : null,
    });
  }

  /* -- EACH SIDE'S BAND IS A COMPLETE RECORD OF WHAT THAT SIDE WAS ASKED.
        No question is withheld from it because another band also shows it.

        It used to skip anything the curated topic pairing claimed, on the
        reasoning that showing it twice was redundant. That was wrong, and the
        owner found it: a HOD answered nine questions and the lead's assessment
        listed four. Three of them — strengths, areas for improvement, training
        — had been claimed by the comparison band, so the section that reads as
        "everything the manager said" was silently missing most of it.

        The comparison band is a VIEW: two sides of one topic, for reading
        together. These two are the RECORD, in the order the questions were
        asked. A record with holes in it is not a record, and this document is
        signed and filed (§12). The repetition is the cheaper of the two costs.

        The one deliberate omission is a rating: `SCALE_0_5` answers live in the
        Ratings band with their scores and their gap, which is where a number
        belongs. Nothing is lost — every question appears somewhere. -- */
  const employeeVoice: NarrativeBlock[] = allQuestions
    .filter((q) => isNarrative(q) && q.answeredBy !== "LEAD_ONLY")
    .filter((q) => !hidden.has(q.questionId) || answeredHidden(q.questionId))
    .map((q) => ({ question: q.text, answer: readableAnswer(q, selfAnswers[q.questionId]) }));

  const leadAssessment: NarrativeBlock[] = allQuestions
    .filter((q) => q.answeredBy !== "EMPLOYEE_ONLY")
    .filter((q) => q.section === "MANAGER_REVIEW")
    .filter((q) => !hidden.has(q.questionId) || answeredHidden(q.questionId))
    /* -- The lead's assessment is prose AND the two selects and the concern flag
          — "can they handle more responsibility" belongs with the written
          verdict, not among the ratings.

          NUMBER ADDED, because the manager's recommended increment percentage
          (0062) was falling between two filters and reaching the report nowhere
          at all: §11 keeps NUMBER out of the ratings band because it never
          enters a score, and this band excluded it as not-prose. So a figure the
          manager was REQUIRED to give (0067) was invisible on the document the
          pay decision is signed from.

          A percentage is not a salary figure, so §5's confinement is untouched —
          the same distinction 0064 draws when it leaves the supervisor a percent
          and takes the amounts away. -- */
    .filter(
      (q) =>
        isNarrative(q) ||
        q.responseType === "SINGLE_SELECT" ||
        q.responseType === "BOOLEAN" ||
        q.responseType === "NUMBER",
    )
    .map((q) => ({ question: q.text, answer: readableAnswer(q, leadAnswers[q.questionId]) }));

  /* -- THE SECOND MANAGER'S OWN WRITTEN VERDICT.
        Built from the same filter as the band above — the same questions, on
        the same form — so the two are directly comparable, which is the whole
        reason both were asked. Read from their own answers, and empty when
        there is no second manager. -- */
  const coLeadAssessment: NarrativeBlock[] = !coLeadData
    ? []
    : allQuestions
        .filter((q) => q.answeredBy !== "EMPLOYEE_ONLY")
        .filter((q) => q.section === "MANAGER_REVIEW")
        .filter((q) => !hidden.has(q.questionId) || answeredHidden(q.questionId))
        .filter(
          (q) =>
            isNarrative(q) ||
            q.responseType === "SINGLE_SELECT" ||
            q.responseType === "BOOLEAN" ||
            q.responseType === "NUMBER",
        )
        .map((q) => ({
          question: q.text,
          answer: readableAnswer(q, coLeadAnswers[q.questionId]),
        }));

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
    // The signature rides along with the name, in the query already fetching
    // it (0065). One read, not two.
    ? await supabase.from("profiles").select("id, full_name, signature_image").in("id", reviewerIds)
    : { data: [] };
  const reviewerName = (id: string | null | undefined) =>
    id ? ((reviewers ?? []).find((p) => p.id === id)?.full_name ?? null) : null;

  /** Their signature image, or null where they have not uploaded one. */
  const reviewerSignature = (id: string | null | undefined) =>
    id ? ((reviewers ?? []).find((p) => p.id === id)?.signature_image ?? null) : null;

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
      leadDesignation: lead?.designation ?? null,
      coLeadName: coLead?.full_name ?? null,
      coLeadDesignation: coLead?.designation ?? null,
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
      coLeadOverall: coLeadScores?.overallScore ?? null,
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
    narratives: { paired, employeeVoice, leadAssessment, coLeadAssessment },
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
      hrSignature: reviewerSignature(review?.hr_reviewed_by),
      mdRemarks: review?.md_remarks ?? null,
      mdOutcome: review?.md_outcome ?? null,
      mdReviewedAt: review?.md_reviewed_at ?? null,
      mdReviewedByName: reviewerName(review?.md_reviewed_by),
      mdSignature: reviewerSignature(review?.md_reviewed_by),
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

/**
 * The 0-5 integer behind a scale answer, for the report's strength bar.
 *
 * Deliberately NOT `scoreValue` from scoring.ts: that one also maps a TICK_3
 * answer onto 5/3/1 for analytics, and a worker-style tick drawn as four
 * segments out of five would state a precision the tick sheet does not have
 * (§6.2 keeps that number off any worker-facing surface).
 *
 * An out-of-range value returns null rather than being clamped, matching P4-10:
 * a 9 on a 0-5 question is corrupt data, and clamping it to 5 would launder it
 * into a full bar.
 */
function scaleValueOf(question: FormQuestion, answer: unknown): number | null {
  if (question.responseType !== "SCALE_0_5") return null;
  if (answer === null || answer === undefined || answer === "") return null;
  const value = Number(answer);
  return Number.isInteger(value) && value >= 0 && value <= 5 ? value : null;
}

function rank(section: string): number {
  const index = SECTION_ORDER.indexOf(section as (typeof SECTION_ORDER)[number]);
  return index === -1 ? SECTION_ORDER.length : index;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
