"use server";

/** The completed worker appraisal, both sides together. HR and the MD only. */

import { revalidatePath } from "next/cache";

import { checkRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";
import type { WorkerTick } from "@/lib/worker/form";

export type WorkerReviewRow = {
  questionId: string;
  text: string;
  isOverall: boolean;
  /* -- ONE tick per quality. The supervisor fills the sheet and the worker does
        not, so there is no second column and nothing to compare — the
        difference-flagging this had was answering a question nobody asks of a
        one-sided form. -- */
  supervisor: WorkerTick | null;
};

export type WorkerReview = {
  evaluationId: string;
  workerName: string;
  department: string | null;
  designation: string | null;
  supervisorName: string | null;
  cycleName: string;
  periodLabel: string;
  status: string;
  rows: WorkerReviewRow[];
  supervisorComment: string;
  trainingRequired: boolean | null;
  overallTick: string | null;
  salary: {
    salaryChanged: boolean;
    oldCtc: number | null;
    incrementPct: number | null;
    newCtc: number | null;
  } | null;
};

type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

/**
 * One completed worker appraisal.
 *
 * Guarded to HR and the MD, and read through the authenticated client so RLS
 * decides underneath the guard. The salary block is on this page and §5 confines
 * it to exactly these two roles — the page guard is the clean exit, the policy
 * is the protection (P16-9).
 */
export async function getWorkerReview(evaluationId: string): Promise<Result<WorkerReview>> {
  const auth = await checkRole(["HR_ADMIN", "MD"]);
  if (!auth.ok) return { ok: false, error: auth.error };

  const supabase = await createClient();

  const { data: evaluation } = await supabase
    .from("worker_evaluations")
    .select(
      "id, cycle_id, worker_id, supervisor_id, status, overall_tick, supervisor_submitted_at",
    )
    .eq("id", evaluationId)
    .maybeSingle();

  if (!evaluation) return { ok: false, error: { code: "NOT_FOUND", message: "That appraisal no longer exists." } };

  const [{ data: cycle }, { data: people }, { data: snapshot }, { data: responses }, { data: decisions }] =
    await Promise.all([
      supabase
        .from("worker_cycles")
        .select("name, period_label")
        .eq("id", evaluation.cycle_id)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("id, full_name, designation, departments(name)")
        .in("id", [evaluation.worker_id, evaluation.supervisor_id].filter((v): v is string => Boolean(v))),
      supabase
        .from("worker_evaluation_questions")
        .select("question_id, text, is_overall, sort_order")
        .eq("evaluation_id", evaluationId)
        .order("sort_order"),
      supabase
        .from("worker_evaluation_responses")
        .select("layer, answers, overall_comment, training_required")
        .eq("evaluation_id", evaluationId),
      supabase
        .from("worker_evaluation_decisions")
        .select("salary_changed, old_ctc, increment_pct, new_ctc")
        .eq("evaluation_id", evaluationId)
        .maybeSingle(),
    ]);

  const byId = new Map((people ?? []).map((p) => [p.id, p]));
  const worker = byId.get(evaluation.worker_id);

  const supervisorRow = (responses ?? []).find((r) => r.layer === "SUPERVISOR");
  const supervisorAnswers = (supervisorRow?.answers ?? {}) as Record<string, WorkerTick>;

  return {
    ok: true,
    data: {
      evaluationId,
      workerName: worker?.full_name ?? "This worker",
      department: worker?.departments?.name ?? null,
      designation: worker?.designation ?? null,
      supervisorName: evaluation.supervisor_id
        ? (byId.get(evaluation.supervisor_id)?.full_name ?? null)
        : null,
      cycleName: cycle?.name ?? "",
      periodLabel: cycle?.period_label ?? "",
      status: evaluation.status,
      rows: (snapshot ?? []).map((q) => ({
        questionId: q.question_id,
        text: q.text,
        isOverall: q.is_overall,
        supervisor: supervisorAnswers[q.question_id] ?? null,
      })),
      supervisorComment: supervisorRow?.overall_comment ?? "",
      trainingRequired: supervisorRow?.training_required ?? null,
      overallTick: evaluation.overall_tick,
      salary: decisions
        ? {
            salaryChanged: decisions.salary_changed,
            oldCtc: decisions.old_ctc,
            incrementPct: decisions.increment_pct,
            newCtc: decisions.new_ctc,
          }
        : null,
    },
  };
}

/**
 * Record that it has been reviewed, and close it.
 *
 * ONE STEP, not two. §8's staff machine separates HR's review from the MD's
 * because a pay decision needs a second pair of eyes (AMEND-2) — and the worker
 * sheet has no pay decision on it unless the supervisor filled one, which HR
 * and the MD can both see here. Splitting it would add a queue and a handover
 * to a form that is eight ticks long.
 *
 * The status move is the record. There is no separate "approved" flag to
 * disagree with it later.
 */
export async function reviewWorkerAppraisal(
  evaluationId: string,
  remarks: string,
): Promise<Result<{ ok: true }>> {
  const auth = await checkRole(["HR_ADMIN", "MD"]);
  if (!auth.ok) return { ok: false, error: auth.error };

  const supabase = await createClient();

  const { data: evaluation } = await supabase
    .from("worker_evaluations")
    .select("id, status")
    .eq("id", evaluationId)
    .maybeSingle();

  if (!evaluation) return { ok: false, error: { code: "NOT_FOUND", message: "That appraisal no longer exists." } };

  /* -- Both sides have to be in. The board only offers this on a row that is
        ready, but a screen is not a guard (§9) and this action is reachable
        from any signed-in administrator's session. -- */
  if (evaluation.status !== "PENDING_REVIEW") {
    return {
      ok: false,
      error: {
        code: "WRONG_STATUS",
        message:
          evaluation.status === "OPEN"
            ? "The supervisor has not submitted it yet."
            : "This appraisal has already been reviewed.",
      },
    };
  }

  /* -- The remarks land on the DECISIONS row, not the evaluation.
        `worker_evaluations` is readable by the worker and their supervisor;
        management's remarks are neither's to read, and RLS cannot withhold a
        column (0050's reasoning, applied to the last field that needed it). -- */
  if (remarks.trim() !== "") {
    const { error: remarkError } = await supabase.from("worker_evaluation_decisions").upsert(
      {
        evaluation_id: evaluationId,
        md_remarks: remarks.trim(),
        decided_by: auth.session.profile.id,
        decided_at: new Date().toISOString(),
      },
      { onConflict: "evaluation_id" },
    );
    if (remarkError) {
      return { ok: false, error: { code: "SAVE_FAILED", message: remarkError.message } };
    }
  }

  const { error } = await supabase
    .from("worker_evaluations")
    .update({ status: "REVIEWED", md_reviewed_at: new Date().toISOString() })
    .eq("id", evaluationId)
    .eq("status", "PENDING_REVIEW");

  if (error) return { ok: false, error: { code: "SAVE_FAILED", message: error.message } };

  await supabase.rpc("log_admin_action", {
    p_entity: "worker_evaluation",
    p_entity_id: evaluationId,
    p_action: "worker.reviewed",
    // §5: no figure in the diff. audit_log is readable by a lead for their own
    // reports (0013), so a salary there would walk past the confinement rule.
    p_diff: { remarks_recorded: remarks.trim() !== "" } as Json,
  });

  revalidatePath("/admin/worker-appraisals");
  return { ok: true, data: { ok: true } };
}
