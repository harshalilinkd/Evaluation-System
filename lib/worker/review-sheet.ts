"use server";

/**
 * The supervisor's review of a production appraisal (0100).
 *
 * The step between the team leader and HR: the ticks arrive read-only, and the
 * supervisor records the comment, the training tick and the recommended
 * percentage before sending it on.
 *
 * §7: nothing here calls a staff function. §5: no rupee amount is fetched,
 * returned or accepted anywhere in this file — the supervisor recommends a
 * percentage and HR prices it (0064, confirmed again at 0100).
 */

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

import type { WorkerTick } from "./form";

export type WorkerReviewRow = {
  questionId: string;
  text: string;
  helpText: string | null;
  isOverall: boolean;
  /** The team leader's tick. Read-only here — the supervisor does not re-rate. */
  tick: WorkerTick | null;
};

export type WorkerReviewSheet = {
  evaluationId: string;
  workerName: string;
  employeeCode: string | null;
  designation: string | null;
  department: string | null;
  /** How long they have been doing the job — the context a rating is read against. */
  joinedOn: string | null;
  /** Who ticked it. `supervisor_id` on the row; "team leader" on every screen. */
  ratedBy: string | null;
  /* -- TRUE where the same person rated and is now reviewing. On a small floor
        the team leader IS the only supervisor, so they do both steps — at the
        owner's instruction. The screen says "you" rather than naming them back
        to themselves, which reads as the page not knowing who is looking. -- */
  ratedByYou: boolean;
  ratedAt: string | null;
  /* -- What the TEAM LEADER wrote beside their ticks. Read-only here, and a
        different field from the supervisor's own comment below — the two are
        written by two people about the same person, and merging them would
        lose which of them said it. -- */
  raterComment: string;
  /* -- What the team leader RECOMMENDED for training. Context, and the
        starting value for the supervisor's own answer below — theirs is the one
        HR reads, so it has to be settable, and starting it blank would make
        them re-answer a question already answered. -- */
  raterTraining: boolean | null;
  cycleName: string;
  periodLabel: string;
  rows: WorkerReviewRow[];
  /** §11: the worker's score IS this tick, never a mean. */
  overallTick: WorkerTick | null;
  salaryChanged: boolean | null;
  incrementPct: number | null;
  comment: string;
  trainingRequired: boolean | null;
  /** Still with this supervisor, and theirs to write. */
  isOpen: boolean;
  /** They have sent it on; it is with HR. */
  isSent: boolean;
};

type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

function fail(code: string, message: string): Result<never> {
  return { ok: false, error: { code, message } };
}

/* -- A Postgres error arrives with its context prefixed. The sentence the
      function raised is the actionable half and is what reaches the screen
      (§0.7); the rest names a function nobody reading it can act on. -- */
function readable(message: string): string {
  return message.replace(/^.*?:\s*/, "").trim() || message;
}

/* ---------- Reading ---------- */

export async function getWorkerReviewSheet(
  evaluationId: string,
): Promise<Result<WorkerReviewSheet>> {
  const profile = await getCurrentProfile();
  if (!profile) return fail("NOT_AUTHENTICATED", "Please sign in again.");

  const supabase = await createClient();

  const { data: evaluation } = await supabase
    .from("worker_evaluations")
    .select(
      "id, cycle_id, worker_id, supervisor_id, reviewer_id, status, supervisor_submitted_at, reviewer_submitted_at, reviewer_skipped, overall_tick, excluded_at",
    )
    .eq("id", evaluationId)
    .maybeSingle();

  // RLS already hides an appraisal this person has nothing to do with, so a
  // missing row and a forbidden one are indistinguishable — deliberately.
  if (!evaluation) return fail("NOT_FOUND", "That appraisal is not available to you.");

  if (evaluation.reviewer_id !== profile.id) {
    return fail("NOT_THE_REVIEWER", "This appraisal is not yours to review.");
  }

  if (evaluation.excluded_at) {
    return fail("WITHDRAWN", "This appraisal has been withdrawn — there is nothing to review.");
  }

  const [{ data: cycle }, { data: worker }, { data: snapshot }, { data: response }] =
    await Promise.all([
      supabase
        .from("worker_cycles")
        .select("name, period_label")
        .eq("id", evaluation.cycle_id)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("full_name, employee_code, designation, date_of_joining, departments(name)")
        .eq("id", evaluation.worker_id)
        .maybeSingle(),
      supabase
        .from("worker_evaluation_questions")
        .select("question_id, text, help_text, is_overall, sort_order")
        .eq("evaluation_id", evaluationId)
        .order("sort_order"),
      /* -- The TEAM LEADER's layer. 0100's policy admits exactly this one to a
            reviewer, and the SELF layer to nobody new — reviewing the ticks is
            the whole of the step, and the worker's own answers are no more
            theirs to read than they were before (§5). -- */
      supabase
        .from("worker_evaluation_responses")
        .select("answers, submitted_at, overall_comment, training_required")
        .eq("evaluation_id", evaluationId)
        .eq("layer", "SUPERVISOR")
        .maybeSingle(),
    ]);

  const { data: rater } = evaluation.supervisor_id
    ? await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", evaluation.supervisor_id)
        .maybeSingle()
    : { data: null };

  /* -- Through the function, never the table. `worker_evaluation_decisions`
        holds `old_ctc` and `new_ctc`, and RLS is row-level — any policy that
        let a supervisor read their own recommendation would hand them the
        amounts with it. The function names four columns and cannot return a
        fifth (0100 §6). -- */
  const { data: decisionRows } = await supabase.rpc("worker_review_decision", {
    p_evaluation_id: evaluationId,
  });
  const decision = decisionRows?.[0] ?? null;

  const answers = (response?.answers ?? {}) as Record<string, WorkerTick>;

  return {
    ok: true,
    data: {
      evaluationId,
      workerName: worker?.full_name ?? "This worker",
      employeeCode: worker?.employee_code ?? null,
      designation: worker?.designation ?? null,
      department: worker?.departments?.name ?? null,
      joinedOn: worker?.date_of_joining ?? null,
      ratedBy: rater?.full_name ?? null,
      ratedByYou: evaluation.supervisor_id === profile.id,
      ratedAt: response?.submitted_at ?? evaluation.supervisor_submitted_at,
      raterComment: response?.overall_comment ?? "",
      raterTraining: response?.training_required ?? null,
      cycleName: cycle?.name ?? "",
      periodLabel: cycle?.period_label ?? "",
      rows: (snapshot ?? []).map((q) => ({
        questionId: q.question_id,
        text: q.text,
        helpText: q.help_text,
        isOverall: q.is_overall,
        tick: answers[q.question_id] ?? null,
      })),
      overallTick: (evaluation.overall_tick as WorkerTick | null) ?? null,
      salaryChanged: decision?.salary_changed ?? null,
      incrementPct: decision?.increment_pct ?? null,
      comment: decision?.supervisor_comment ?? "",
      /* -- The supervisor's own answer, falling back to the team leader's
            recommendation until they set one. So an untouched review still
            sends a real answer on rather than a blank the guard would refuse
            for a question somebody already answered. -- */
      trainingRequired: decision?.training_required ?? response?.training_required ?? null,
      isOpen: evaluation.status === "PENDING_SUPERVISOR" && !evaluation.reviewer_skipped,
      isSent: evaluation.reviewer_submitted_at !== null,
    },
  };
}

/* ---------- Writing ---------- */

export type WorkerReviewInput = {
  salaryChanged: boolean | null;
  incrementPct: number | null;
  comment: string;
  trainingRequired: boolean | null;
};

/**
 * Save what the supervisor has recorded so far.
 *
 * Straight to the function: it re-checks that the caller is the assigned
 * reviewer and that the appraisal is still with them, so nothing here is the
 * only guard (§9 — client code never is).
 */
export async function saveWorkerReview(
  evaluationId: string,
  input: WorkerReviewInput,
): Promise<Result<{ savedAt: string }>> {
  const profile = await getCurrentProfile();
  if (!profile) return fail("NOT_AUTHENTICATED", "Please sign in again.");

  const supabase = await createClient();

  const { error } = await supabase.rpc("save_worker_review", {
    p_evaluation_id: evaluationId,
    p_salary_changed: input.salaryChanged,
    p_increment_pct: input.salaryChanged === true ? input.incrementPct : null,
    p_comment: input.comment,
    p_training: input.trainingRequired,
  });

  if (error) return fail("SAVE_FAILED", readable(error.message));

  return { ok: true, data: { savedAt: new Date().toISOString() } };
}

/** Send it to HR. The completeness guard lives in the function (0100 §8). */
export async function submitWorkerReview(
  evaluationId: string,
  input: WorkerReviewInput,
): Promise<Result<{ ok: true }>> {
  const saved = await saveWorkerReview(evaluationId, input);
  if (!saved.ok) return saved;

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_worker_review", {
    p_evaluation_id: evaluationId,
  });

  if (error) return fail("SUBMIT_FAILED", readable(error.message));

  revalidatePath("/worker-team");
  revalidatePath(`/worker-review/${evaluationId}`);
  return { ok: true, data: { ok: true } };
}
