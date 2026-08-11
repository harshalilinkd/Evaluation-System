"use server";

/** Lead review autosave, submit and return. CLAUDE.md §8, §9, §11. Phase P13. */

import { revalidatePath } from "next/cache";

import { getCurrentProfile, getRoles } from "@/lib/auth/roles";
import { transition } from "@/lib/evaluations/state-machine";
import { resolveVisibility } from "@/lib/forms/conditions";
import { getEvaluationForm } from "@/lib/forms/get-form";
import { validateAnswers } from "@/lib/forms/zod-generator";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";
import { notifyIfNowWithHr } from "@/lib/notify/events";

export type LeadResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

function fail<T>(code: string, message: string): LeadResult<T> {
  return { ok: false, error: { code, message } };
}

// A "use server" module may export only async functions (P8-8), so the minimum
// reason length is not re-exported from here — both this file and the dialog
// import it from lib/evaluations/transitions.

/* ---------- Autosave ---------- */

export type LeadSaveOutcome = {
  savedAt: string;
  answers: Record<string, unknown>;
  comments: Record<string, string>;
};

/**
 * Save a PATCH of the lead's changed answers and comments.
 *
 * Identical mechanics to P12's `saveSelfDraft`, on the LEAD layer. The reasoning
 * is the same and worth restating rather than cross-referencing: only changed
 * keys travel and the database merges them (0011), because two in-flight saves
 * carrying the whole object can land out of order and the older one wins — an
 * answer silently disappearing from a review somebody has spent half an hour on.
 *
 * Comments ride the same call. A comment is written in the same breath as the
 * score it explains, and splitting them across two requests would let one land
 * and the other not.
 */
export async function saveLeadDraft(
  evaluationId: string,
  answersPatch: Record<string, unknown>,
  commentsPatch: Record<string, string> = {},
): Promise<LeadResult<LeadSaveOutcome>> {
  const profile = await getCurrentProfile();
  if (!profile) return fail("NOT_AUTHENTICATED", "Please sign in again.");

  const form = await getEvaluationForm(evaluationId, "LEAD");
  if (!form.ok) return fail(form.error.code, form.error.message);

  // §8's locking rule, checked before the round trip so a submitted review gives
  // a sentence rather than a database error. merge_evaluation_answers re-checks
  // it, and so does RLS — this is the friendly copy of the same rule.
  if (form.data.isSubmitted) {
    return fail("LAYER_LOCKED", "You have already submitted this review.");
  }

  // Visibility against the MERGED view, not the patch: a parent flipping to No
  // hides a child whose key may not be in this patch at all. On the lead's form
  // the live case is "Any concerns / risks identified?" → "Please specify".
  const merged = { ...form.data.answers, ...answersPatch };
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
    .filter((id) => id in merged || id in form.data.comments);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("merge_evaluation_answers", {
    p_evaluation_id: evaluationId,
    p_layer: "LEAD",
    p_answers_patch: answersPatch as Json,
    p_comments_patch: commentsPatch as Json,
    p_remove_keys: removeKeys,
  });

  if (error) return fail("SAVE_FAILED", error.message);

  const result = (data ?? {}) as {
    answers?: Record<string, unknown>;
    comments?: Record<string, string>;
  };

  return {
    ok: true,
    data: {
      savedAt: new Date().toISOString(),
      answers: result.answers ?? merged,
      comments: result.comments ?? form.data.comments,
    },
  };
}

/* ---------- Submit ---------- */

export type LeadSubmitOutcome = {
  evaluationId: string;
  overallScore: number | null;
  employeeName: string | null;
};

/**
 * Submit the lead review.
 *
 * THE CLIENT'S VALIDITY IS NOT TRUSTED, AND ITS QUESTION LIST IS NOT EITHER.
 *
 * The snapshot is re-read, the schema rebuilt with the SAME builder the client
 * used, and the STORED answers re-validated — not the ones the browser posted.
 * §9: "Client code must never be the only guard."
 *
 * Note it validates the LEAD form, never the merged review form the screen
 * renders: the narrative section is EMPLOYEE_ONLY context, and requiring the
 * lead to fill it in would block a complete review on questions they are not
 * asked. `mergeReviewForm` exists for display and is deliberately absent here.
 *
 * Scoring, the layer lock, the audit row and the MD's notification all happen
 * inside P4's `transition()`. This action computes nothing itself — a second
 * scoring path would eventually disagree with the first.
 */
export async function submitLeadReview(
  evaluationId: string,
): Promise<LeadResult<LeadSubmitOutcome>> {
  const profile = await getCurrentProfile();
  if (!profile) return fail("NOT_AUTHENTICATED", "Please sign in again.");

  const form = await getEvaluationForm(evaluationId, "LEAD");
  if (!form.ok) return fail(form.error.code, form.error.message);

  if (form.data.isSubmitted) {
    return fail("ALREADY_SUBMITTED", "You have already submitted this review.");
  }

  const validation = validateAnswers(form.data, "LEAD", form.data.answers);
  if (!validation.ok) {
    const count = validation.missingIds.length;
    return fail(
      "INCOMPLETE",
      `${count} ${count === 1 ? "question still needs" : "questions still need"} an answer.`,
    );
  }

  // AMEND-3: OPEN → OPEN. Submitting a layer locks THAT layer and leaves the
  // record where it is; the system raises PENDING_HR_REVIEW once both sides are
  // in. `locks` is what tells this move from the employee's.
  const moved = await transition(
    evaluationId,
    "OPEN",
    {
      profileId: profile.id,
    // The actor is the signed-in person, never an argument. `transition()`
    // matches it against evaluation.lead_id, and apply_evaluation_transition
    // re-checks the same thing in SQL.
      roles: await getRoles(),
    },
    { locks: "LEAD" },
  );

  if (!moved.ok) return fail(moved.error.code, moved.error.message);

  /* -- ASK THE DATABASE WHAT IT DECIDED.
        0038's trigger moves the record to PENDING_HR_REVIEW when both sides are
        in, inside this same transaction — and a Postgres trigger cannot call
        the notification code. So `transition()` above only ever reports
        OPEN->OPEN, and the message telling HR a report is ready was never
        raised by anything. Looking afterwards is the only way to know, because
        this side does not know whether it was the one that completed the pair.

        Not awaited for its result and unable to throw: the submission is
        committed by now, and a provider outage must not turn it into a reported
        failure (PW-2). -- */
  await notifyIfNowWithHr(evaluationId);

  const supabase = await createClient();
  const { data: evaluation } = await supabase
    .from("evaluations")
    .select("evaluatee_id")
    .eq("id", evaluationId)
    .maybeSingle();

  let employeeName: string | null = null;
  if (evaluation?.evaluatee_id) {
    const { data: person } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", evaluation.evaluatee_id)
      .maybeSingle();
    employeeName = person?.full_name ?? null;
  }

  revalidatePath("/team");
  revalidatePath(`/team/${evaluationId}`);

  return {
    ok: true,
    data: { evaluationId, overallScore: moved.data.overallScore, employeeName },
  };
}

/* ---------- Return to employee ---------- */

export type LeadReturnOutcome = {
  evaluationId: string;
  /** Advisory (§10) — a failed send never fails the return. */
  notifyProblems: string[];
};

/*
 * `returnToEmployee` WAS HERE, and is deleted.
 *
 * AMEND-3: a lead cannot return a form they cannot see. The action moved
 * SELF_SUBMITTED → CYCLE_ACTIVE and unlocked the employee's layer, both of
 * which presumed the lead had read it. §8 gives returns to HR, from the review
 * screen — and HR is the only role that can see both sides to judge whether one
 * needs sending back.
 */
