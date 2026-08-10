"use server";

/** One worker appraisal sheet: reading it, saving it, submitting it. §7-isolated. */

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

/*
 * §7: nothing here calls a staff function. `getEvaluationForm`, `buildZodSchema`
 * and `computeScores` are all for the 0-5 form and none of them is reachable
 * from this file — a tick sheet has no sections, no department merge and no
 * mean.
 */

export type WorkerTick = "EXCELLENT" | "SATISFACTORY" | "NEEDS_IMPROVEMENT";

export type WorkerSheetQuestion = {
  questionId: string;
  text: string;
  helpText: string | null;
  isRequired: boolean;
  isOverall: boolean;
};

export type WorkerSheet = {
  evaluationId: string;
  /** Which side the VIEWER is on. Decided here, never sent by the browser. */
  layer: "SELF" | "SUPERVISOR";
  workerName: string;
  cycleName: string;
  periodLabel: string;
  dueOn: string | null;
  questions: WorkerSheetQuestion[];
  answers: Record<string, WorkerTick>;
  isSubmitted: boolean;
  /** Open for writing: the record is OPEN and this layer is neither in nor skipped. */
  isOpen: boolean;
};

type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

function fail(code: string, message: string): Result<never> {
  return { ok: false, error: { code, message } };
}

/**
 * The sheet for whoever is asking.
 *
 * THE LAYER IS DERIVED FROM WHO THEY ARE, never passed in. A parameter would be
 * a request to read the other side, and RLS would refuse it — but the refusal
 * would arrive as an empty form rather than as a clear "not yours", and the
 * parameter would sit there inviting somebody to try (P6-11's reasoning).
 */
export async function getWorkerSheet(evaluationId: string): Promise<Result<WorkerSheet>> {
  const profile = await getCurrentProfile();
  if (!profile) return fail("NOT_AUTHENTICATED", "Please sign in again.");

  const supabase = await createClient();

  const { data: evaluation } = await supabase
    .from("worker_evaluations")
    .select(
      "id, cycle_id, worker_id, supervisor_id, status, self_submitted_at, supervisor_submitted_at, self_skipped, supervisor_skipped",
    )
    .eq("id", evaluationId)
    .maybeSingle();

  // RLS already hides an appraisal this person has nothing to do with, so a
  // missing row and a forbidden one are indistinguishable — deliberately.
  if (!evaluation) return fail("NOT_FOUND", "That appraisal is not available to you.");

  const layer: "SELF" | "SUPERVISOR" =
    evaluation.worker_id === profile.id
      ? "SELF"
      : evaluation.supervisor_id === profile.id
        ? "SUPERVISOR"
        : "SELF";

  /* -- HR and the MD can open the row but fill neither side. Rather than
        showing them a form they must not write, this refuses and points them at
        the report. -- */
  if (evaluation.worker_id !== profile.id && evaluation.supervisor_id !== profile.id) {
    return fail("NOT_A_RATER", "This sheet belongs to the worker and their supervisor.");
  }

  const [{ data: cycle }, { data: worker }, { data: snapshot }, { data: response }] =
    await Promise.all([
      supabase
        .from("worker_cycles")
        .select("name, period_label, self_due_on, supervisor_due_on")
        .eq("id", evaluation.cycle_id)
        .maybeSingle(),
      supabase.from("profiles").select("full_name").eq("id", evaluation.worker_id).maybeSingle(),
      supabase
        .from("worker_evaluation_questions")
        .select("question_id, text, help_text, is_required, is_overall, sort_order")
        .eq("evaluation_id", evaluationId)
        .order("sort_order"),
      supabase
        .from("worker_evaluation_responses")
        .select("answers, submitted_at")
        .eq("evaluation_id", evaluationId)
        .eq("layer", layer)
        .maybeSingle(),
    ]);

  /* -- The OVERALL question is the supervisor's alone (§11): the worker's
        overall is the supervisor's tick, and a worker rating their own would
        produce a second figure with no defined meaning. Filtered out here so it
        is never rendered rather than rendered and ignored. -- */
  const rows = (snapshot ?? []).filter((q) => layer === "SUPERVISOR" || !q.is_overall);

  const submittedAt = response?.submitted_at ?? null;
  const skipped = layer === "SELF" ? evaluation.self_skipped : evaluation.supervisor_skipped;

  return {
    ok: true,
    data: {
      evaluationId,
      layer,
      workerName: worker?.full_name ?? "This worker",
      cycleName: cycle?.name ?? "",
      periodLabel: cycle?.period_label ?? "",
      dueOn: layer === "SELF" ? (cycle?.self_due_on ?? null) : (cycle?.supervisor_due_on ?? null),
      questions: rows.map((q) => ({
        questionId: q.question_id,
        text: q.text,
        helpText: q.help_text,
        isRequired: q.is_required,
        isOverall: q.is_overall,
      })),
      answers: (response?.answers ?? {}) as Record<string, WorkerTick>,
      isSubmitted: submittedAt !== null,
      isOpen: evaluation.status === "OPEN" && submittedAt === null && !skipped,
    },
  };
}

/**
 * Save a draft.
 *
 * A whole-object write rather than P12-4's patch merge, and the difference is
 * the form: eight ticks fit in one payload, and a tick is a single click that
 * cannot be half-typed. The ordering hazard a patch protects against — two
 * saves in flight, the older landing last and losing a keystroke — needs a
 * form somebody types into for twenty minutes.
 */
export async function saveWorkerSheet(
  evaluationId: string,
  answers: Record<string, WorkerTick>,
): Promise<Result<{ savedAt: string }>> {
  const profile = await getCurrentProfile();
  if (!profile) return fail("NOT_AUTHENTICATED", "Please sign in again.");

  const sheet = await getWorkerSheet(evaluationId);
  if (!sheet.ok) return sheet;
  if (!sheet.data.isOpen) {
    return fail("LOCKED", "This sheet is no longer open for changes.");
  }

  const supabase = await createClient();

  /* -- RLS is the real gate. `worker_responses_write` admits this row only if
        the caller owns this layer and the record is OPEN, so a forged
        `evaluationId` writes nothing rather than being caught here. -- */
  const { error } = await supabase
    .from("worker_evaluation_responses")
    .update({ answers: answers as Json })
    .eq("evaluation_id", evaluationId)
    .eq("layer", sheet.data.layer);

  if (error) return fail("SAVE_FAILED", error.message);

  return { ok: true, data: { savedAt: new Date().toISOString() } };
}

/**
 * Submit, and lock this side.
 *
 * The other side is not consulted and not reported on. Blind parallel rating
 * means a supervisor submitting learns nothing about whether the worker has,
 * and the reverse (§5).
 */
export async function submitWorkerSheet(
  evaluationId: string,
  answers: Record<string, WorkerTick>,
): Promise<Result<{ ok: true }>> {
  const profile = await getCurrentProfile();
  if (!profile) return fail("NOT_AUTHENTICATED", "Please sign in again.");

  const sheet = await getWorkerSheet(evaluationId);
  if (!sheet.ok) return sheet;
  if (!sheet.data.isOpen) return fail("LOCKED", "This sheet has already been submitted.");

  /* -- Validated server-side against the FROZEN sheet, never against what the
        browser sent. Same rule as P12-7: the client's question list is not
        trusted any more than its answers. -- */
  const missing = sheet.data.questions.filter(
    (q) => q.isRequired && !answers[q.questionId],
  );
  if (missing.length > 0) {
    return fail(
      "INCOMPLETE",
      `${missing.length} ${missing.length === 1 ? "quality still needs" : "qualities still need"} a tick.`,
    );
  }

  const supabase = await createClient();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("worker_evaluation_responses")
    .update({ answers: answers as Json, submitted_at: now, submitted_by: profile.id })
    .eq("evaluation_id", evaluationId)
    .eq("layer", sheet.data.layer);

  if (error) return fail("SAVE_FAILED", error.message);

  /* -- The record's own timestamp, and §11's overall where this is the
        supervisor. The overall is the supervisor's tick, stored at submission
        and never recomputed on read (§5's "scores are never recomputed from
        mutable config"). -- */
  const overallQuestion = sheet.data.questions.find((q) => q.isOverall);
  const patch =
    sheet.data.layer === "SELF"
      ? { self_submitted_at: now }
      : {
          supervisor_submitted_at: now,
          overall_tick: overallQuestion ? (answers[overallQuestion.questionId] ?? null) : null,
        };

  await supabase.from("worker_evaluations").update(patch).eq("id", evaluationId);

  /* -- Both sides in? Then it goes to review. Read back rather than inferred
        from what this call just wrote, because the other side may have landed
        in between. A skipped layer counts as in — HR advanced past it
        deliberately (F11-3). -- */
  const { data: after } = await supabase
    .from("worker_evaluations")
    .select("self_submitted_at, supervisor_submitted_at, self_skipped, supervisor_skipped")
    .eq("id", evaluationId)
    .maybeSingle();

  const selfIn = Boolean(after?.self_submitted_at) || Boolean(after?.self_skipped);
  const supervisorIn = Boolean(after?.supervisor_submitted_at) || Boolean(after?.supervisor_skipped);

  if (selfIn && supervisorIn) {
    await supabase
      .from("worker_evaluations")
      .update({ status: "PENDING_REVIEW" })
      .eq("id", evaluationId);
  }

  await supabase.rpc("log_admin_action", {
    p_entity: "worker_evaluation",
    p_entity_id: evaluationId,
    p_action: sheet.data.layer === "SELF" ? "worker.self_submit" : "worker.supervisor_submit",
    p_diff: {} as Json,
  });

  revalidatePath("/worker-appraisal");
  revalidatePath(`/worker-appraisal/${evaluationId}`);
  return { ok: true, data: { ok: true } };
}
