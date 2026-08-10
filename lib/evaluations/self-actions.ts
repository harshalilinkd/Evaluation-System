"use server";

/** Self-evaluation autosave and submit. CLAUDE.md §6, §8, §9, §11. */

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/roles";
import { transition } from "@/lib/evaluations/state-machine";
import { getEvaluationForm } from "@/lib/forms/get-form";
import { resolveVisibility } from "@/lib/forms/conditions";
import { validateAnswers } from "@/lib/forms/zod-generator";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

export type SelfResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

function fail<T>(code: string, message: string): SelfResult<T> {
  return { ok: false, error: { code, message } };
}

/* ---------- Autosave ---------- */

export type SaveOutcome = {
  savedAt: string;
  /** The merged server state, so the client can reconcile a raced save. */
  answers: Record<string, unknown>;
};

/**
 * Save a PATCH of changed answers.
 *
 * Only changed keys travel, and the database merges them (0011). Sending the
 * whole answers object would mean two in-flight saves racing, the older one
 * landing last, and an answer silently disappearing — which on a form somebody
 * has spent twenty minutes on is unforgivable.
 *
 * Hidden questions are removed in the same statement (§6: "not validated and
 * not stored"), so flipping "Any missed deadlines?" back to No clears the
 * details it revealed rather than leaving an orphan attached to a question
 * nobody was asked.
 */
export async function saveSelfDraft(
  evaluationId: string,
  patch: Record<string, unknown>,
): Promise<SelfResult<SaveOutcome>> {
  const profile = await getCurrentProfile();
  if (!profile) return fail("NOT_AUTHENTICATED", "Please sign in again.");

  const form = await getEvaluationForm(evaluationId, "SELF");
  if (!form.ok) return fail(form.error.code, form.error.message);

  // §8's locking rule, checked before the round trip so a submitted form gives
  // a sentence rather than a database error. The function re-checks it anyway.
  if (form.data.isSubmitted) {
    return fail("LAYER_LOCKED", "You have already submitted this evaluation.");
  }

  // Which questions are hidden once this patch is applied. Computed against the
  // merged view, not the patch alone: a parent flipping to No hides a child
  // whose key may not be in this patch at all.
  const merged = { ...form.data.answers, ...patch };
  const visibility = resolveVisibility(
    form.data.questions.map((q) => ({
      question_id: q.questionId,
      depends_on: q.dependsOn,
      depends_value: q.dependsValue,
    })),
    merged,
  );

  const removeKeys = form.data.questions
    .filter((q) => visibility.get(q.questionId) === false)
    .map((q) => q.questionId)
    .filter((id) => id in merged);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("merge_evaluation_answers", {
    p_evaluation_id: evaluationId,
    p_layer: "SELF",
    p_answers_patch: patch as Json,
    p_comments_patch: {} as Json,
    p_remove_keys: removeKeys,
  });

  if (error) return fail("SAVE_FAILED", error.message);

  const result = (data ?? {}) as { answers?: Record<string, unknown> };

  return {
    ok: true,
    data: { savedAt: new Date().toISOString(), answers: result.answers ?? merged },
  };
}

/* ---------- Submit ---------- */

export type SubmitOutcome = {
  evaluationId: string;
  overallScore: number | null;
  leadName: string | null;
};

/**
 * Submit the self layer.
 *
 * THE CLIENT'S VALIDITY IS NOT TRUSTED, AND ITS QUESTION LIST IS NOT EITHER.
 *
 * The snapshot is re-read from the database, the schema is rebuilt against it
 * with the SAME builder the client used, and the stored answers are re-validated.
 * A client that skipped a required question, or that sent answers for questions
 * outside its own snapshot, is rejected here. §9: "Client code must never be the
 * only guard."
 *
 * Scores and the transition are then handled by P4's `transition()`, which
 * computes §11's means, writes them onto the response row with submitted_at and
 * submitted_by, and moves the status — all in one database transaction. This
 * action deliberately does none of that itself: a second scoring path would
 * eventually disagree with the first.
 */
export async function submitSelfEvaluation(
  evaluationId: string,
): Promise<SelfResult<SubmitOutcome>> {
  const profile = await getCurrentProfile();
  if (!profile) return fail("NOT_AUTHENTICATED", "Please sign in again.");

  /* -- Re-read the snapshot and the stored answers -- */
  const form = await getEvaluationForm(evaluationId, "SELF");
  if (!form.ok) return fail(form.error.code, form.error.message);

  if (form.data.isSubmitted) {
    return fail("ALREADY_SUBMITTED", "You have already submitted this evaluation.");
  }

  /* -- Re-validate server-side, against the stored answers -- */
  const validation = validateAnswers(form.data, "SELF", form.data.answers);
  if (!validation.ok) {
    const count = validation.missingIds.length;
    return fail(
      "INCOMPLETE",
      `${count} ${count === 1 ? "question still needs" : "questions still need"} an answer.`,
    );
  }

  /* -- Transition. Scores, the lock and the audit row all happen inside. -- */
  // AMEND-3: OPEN → OPEN. Submitting locks the SELF layer and leaves the record
  // where it is; the system raises PENDING_HR_REVIEW once both sides are in.
  const moved = await transition(evaluationId, "OPEN", {
    profileId: profile.id,
    // The actor is the signed-in person, never an argument. `transition()`
    // re-checks against evaluatee_id, and so does the database function.
    roles: [],
  });

  if (!moved.ok) return fail(moved.error.code, moved.error.message);

  const supabase = await createClient();

  /* -- P21: lift the salary expectation out of the answers blob.
        Only an increment cycle asks those questions (cycle_scope), so on a
        plain evaluation the function finds nothing and returns false. It is
        deliberately not awaited for its result: a figure that failed to copy
        must not turn a submitted evaluation into a reported failure, and HR's
        first proposal calls it again. -- */
  /* -- ITS OUTCOME IS NO LONGER DISCARDED.
        The result was thrown away entirely, so the two ways this can fail were
        both silent: the RPC erroring, and the RPC returning `false` because it
        found nothing to copy. Either way the employee saw a clean submit and
        HR later read "Not stated" against a figure the employee had plainly
        typed, with nothing anywhere to say why.

        Still not fatal, and that part was right: a figure that failed to copy
        must not turn a submitted evaluation into a reported failure, and HR's
        first proposal calls it again (P21-8). But §0.7 says fail loudly, and a
        server log is the least this can do — it is the difference between a
        bug somebody can find and one they can only guess at. -- */
  const { data: copied, error: copyError } = await supabase.rpc("record_salary_expectation", {
    p_evaluation_id: evaluationId,
  });

  if (copyError) {
    console.error(
      `[salary expectation] evaluation ${evaluationId}: ${copyError.message}. ` +
        "The answer is safe in the SELF layer; HR's first proposal will copy it again.",
    );
  } else if (copied === false) {
    // Expected on a plain evaluation cycle, which never asks the question.
    // Worth a line on an increment, where it means the figure did not land.
    console.info(
      `[salary expectation] evaluation ${evaluationId}: nothing copied — ` +
        "no answer given, or no current salary on record to anchor a review row to.",
    );
  }

  /* -- Who reviews it next, for the confirmation card -- */
  const { data: evaluation } = await supabase
    .from("evaluations")
    .select("lead_id")
    .eq("id", evaluationId)
    .maybeSingle();

  let leadName: string | null = null;
  if (evaluation?.lead_id) {
    const { data: lead } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", evaluation.lead_id)
      .maybeSingle();
    leadName = lead?.full_name ?? null;
  }

  revalidatePath("/my-evaluation");
  revalidatePath(`/my-evaluation/${evaluationId}`);

  return {
    ok: true,
    data: { evaluationId, overallScore: moved.data.overallScore, leadName },
  };
}
