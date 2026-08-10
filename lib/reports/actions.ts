"use server";

/** HR's and the MD's actions on a report (P20). Every status move goes through §8. */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { checkRole } from "@/lib/auth/guards";
import { cycleError, type CycleResult } from "@/lib/cycles/schema";
import { MIN_REASON_LENGTH } from "@/lib/evaluations/transitions";
import { transition } from "@/lib/evaluations/state-machine";
import { createClient } from "@/lib/supabase/server";

/* ---------- Guards ---------- */
//
// AMEND-2 un-merged the roles, and this screen is where that matters most: HR
// prepares and reviews, the MD approves. `ADMIN_ROLES` is deliberately NOT used
// on any action here — a single predicate would let one person do both halves,
// which is the second pair of eyes removed.

async function requireHr() {
  const auth = await checkRole(["HR_ADMIN"]);
  if (!auth.ok) return cycleError("FORBIDDEN", auth.error.message);
  return { ok: true as const, session: auth.session };
}

async function requireMd() {
  const auth = await checkRole(["MD"]);
  if (!auth.ok) return cycleError("FORBIDDEN", auth.error.message);
  return { ok: true as const, session: auth.session };
}

/* -- HR or the MD. 0056 gave HR the increment close, so the two acts that used
      to be the MD's alone — recording the review and approving the figure —
      now admit either. `audit_log` takes its actor from the session, so the
      record still says which of them it was. -- */
async function requireHrOrMd() {
  const auth = await checkRole(["HR_ADMIN", "MD"]);
  if (!auth.ok) return cycleError("FORBIDDEN", auth.error.message);
  return { ok: true as const, session: auth.session };
}

/** The actor shape §8's state machine expects. */
function actorOf(session: { profile: { id: string }; roles: readonly string[] }) {
  return { profileId: session.profile.id, roles: [...session.roles] as never };
}

/* ---------- HR's review ---------- */

const hrReviewSchema = z.object({
  evaluationId: z.string().uuid(),
  summary: z.string().trim().min(1, "Write a short summary before sending this on."),
  recommendation: z.enum(["PROCEED", "HOLD", "NEEDS_DISCUSSION"]),
});

/** Save HR's summary and recommendation without moving the record. */
export async function saveHrReview(input: {
  evaluationId: string;
  summary: string;
  recommendation: string;
}): Promise<CycleResult<{ saved: true }>> {
  const auth = await requireHr();
  if (!auth.ok) return auth;

  const parsed = hrReviewSchema.safeParse(input);
  if (!parsed.success) {
    return cycleError("INVALID", parsed.error.issues[0]?.message ?? "Check the form.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("evaluation_reviews").upsert(
    {
      evaluation_id: parsed.data.evaluationId,
      hr_summary: parsed.data.summary,
      hr_recommendation: parsed.data.recommendation,
      hr_reviewed_by: auth.session.profile.id,
      hr_reviewed_at: new Date().toISOString(),
    },
    { onConflict: "evaluation_id" },
  );

  if (error) return cycleError("SAVE_FAILED", `Could not save your review: ${error.message}`);

  revalidatePath(`/reports/${parsed.data.evaluationId}`);
  return { ok: true, data: { saved: true } };
}

/**
 * Send to the MD. PENDING_HR_REVIEW → HR_APPROVED.
 *
 * The summary is saved FIRST and the transition second. If the order were
 * reversed, a failure to save would leave the record with the MD carrying no
 * review — which is precisely the thing the MD is meant to be reading.
 */
export async function sendToMd(input: {
  evaluationId: string;
  summary: string;
  recommendation: string;
}): Promise<CycleResult<{ status: string; notified: unknown }>> {
  const auth = await requireHr();
  if (!auth.ok) return auth;

  const parsed = hrReviewSchema.safeParse(input);
  if (!parsed.success) {
    return cycleError("NO_SUMMARY", parsed.error.issues[0]?.message ?? "Write a summary first.");
  }

  const saved = await saveHrReview(input);
  if (!saved.ok) return saved;

  // The salary guard is §8's `requireSalaryComplete`, enforced inside
  // `transition()` — not re-implemented here. A second copy would be a second
  // definition of "complete", and they would disagree the first time P21
  // changes what the block contains.
  const moved = await transition(parsed.data.evaluationId, "HR_APPROVED", actorOf(auth.session));
  if (!moved.ok) return cycleError(moved.error.code, moved.error.message);

  revalidatePath("/reports");
  revalidatePath(`/reports/${parsed.data.evaluationId}`);
  return { ok: true, data: { status: "HR_APPROVED", notified: moved.data.notified ?? null } };
}

/**
 * The agreed final score. §6's scale, to two decimals.
 *
 * `coerce` because the field hands back a string. The range is the rating
 * scale's, not an arbitrary bound: a final score has to be readable against the
 * same 0-5 anchors every question uses, or the number on the record means
 * nothing next to the two averages beside it.
 */
const finalScoreSchema = z.coerce
  .number({ invalid_type_error: "Enter a score between 0 and 5." })
  .min(0, "The lowest score is 0.")
  .max(5, "The highest score is 5.")
  // Two decimals, matching every other stored average (§11).
  .transform((value) => Math.round(value * 100) / 100);

/**
 * Approve and complete, without the MD. PENDING_HR_REVIEW → CLOSED.
 *
 * EVALUATION cycles only — `requireEvaluationCycle` runs inside `transition()`
 * and 0039 re-checks it in SQL. Not re-implemented here: a third copy of "is
 * this an increment" is a third thing to keep in step, and the one that would
 * drift is whichever is checked least (P20-11's call, and PC-1's).
 *
 * The summary is saved FIRST and the transition second, for `sendToMd`'s
 * reason: a failure to save must not leave a CLOSED record carrying no review.
 * Closing is the more final of the two, so the ordering matters more here — §8
 * has no path out of CLOSED at all.
 */
export async function hrCompleteEvaluation(input: {
  evaluationId: string;
  summary: string;
  recommendation: string;
  /** The agreed figure, typed by HR after speaking to the MD. Optional. */
  finalScore?: string | number | null;
}): Promise<CycleResult<{ status: string; notified: unknown }>> {
  const auth = await requireHr();
  if (!auth.ok) return auth;

  const parsed = hrReviewSchema.safeParse(input);
  if (!parsed.success) {
    return cycleError("NO_SUMMARY", parsed.error.issues[0]?.message ?? "Write a summary first.");
  }

  /* -- The agreed final score.
        Validated HERE and not merely on the field, because the field is a
        courtesy and this action is callable directly. The range is §6's rating
        scale — a "final score" of 9 on a form that runs 0 to 5 is corrupt data,
        and P4-10 already established that out-of-range input is refused rather
        than clamped: clamping launders a mistake into a real-looking number. -- */
  let finalScore: number | null = null;
  if (input.finalScore !== undefined && input.finalScore !== null && input.finalScore !== "") {
    const parsedScore = finalScoreSchema.safeParse(input.finalScore);
    if (!parsedScore.success) {
      return cycleError("INVALID_SCORE", parsedScore.error.issues[0]?.message ?? "Check the score.");
    }
    finalScore = parsedScore.data;
  }

  const saved = await saveHrReview(input);
  if (!saved.ok) return saved;

  const moved = await transition(parsed.data.evaluationId, "CLOSED", actorOf(auth.session), {
    finalScore,
  });
  if (!moved.ok) return cycleError(moved.error.code, moved.error.message);

  revalidatePath("/reports");
  revalidatePath(`/reports/${parsed.data.evaluationId}`);
  return { ok: true, data: { status: "CLOSED", notified: moved.data.notified ?? null } };
}

const returnSchema = z.object({
  evaluationId: z.string().uuid(),
  returnedTo: z.enum(["SELF", "LEAD", "BOTH"]),
  reason: z
    .string()
    .trim()
    .min(MIN_REASON_LENGTH, `Give a reason of at least ${MIN_REASON_LENGTH} characters.`),
});

/**
 * Return for changes. PENDING_HR_REVIEW → OPEN, unlocking only the named layers.
 *
 * §8: HR owns both returns now. The lead's was deleted in AMEND-3 — a lead
 * cannot return a form they are not allowed to read.
 */
export async function returnForChanges(input: {
  evaluationId: string;
  returnedTo: string;
  reason: string;
}): Promise<CycleResult<{ status: string }>> {
  const auth = await requireHr();
  if (!auth.ok) return auth;

  const parsed = returnSchema.safeParse(input);
  if (!parsed.success) {
    return cycleError("INVALID", parsed.error.issues[0]?.message ?? "Check the form.");
  }

  const moved = await transition(parsed.data.evaluationId, "OPEN", actorOf(auth.session), {
    reason: parsed.data.reason,
    returnedTo: parsed.data.returnedTo,
  });
  if (!moved.ok) return cycleError(moved.error.code, moved.error.message);

  revalidatePath("/reports");
  revalidatePath(`/reports/${parsed.data.evaluationId}`);
  return { ok: true, data: { status: "OPEN" } };
}

/* ---------- The MD's review ---------- */

/* -- The MD's remark is OPTIONAL, at the owner's explicit instruction.
      This schema's `.min(1)` was the check that actually fired — §8's
      `requireMdRemarks` guard read the wrong table and could never pass, so
      this was the whole enforcement. Both are gone.

      A cap is kept: unbounded free text into a column nothing truncates is a
      different problem from a missing one. -- */
const mdReviewSchema = z.object({
  evaluationId: z.string().uuid(),
  remarks: z.string().trim().max(4000, "Keep your remarks under 4000 characters."),
});

/**
 * Approve. HR_APPROVED → MD_REVIEWED.
 *
 * The MD cannot reach this before HR has reviewed, and that is enforced twice —
 * §8's table has no path from PENDING_HR_REVIEW to MD_REVIEWED, and
 * `apply_evaluation_transition` re-checks the same table in SQL (P5-1).
 */
export async function mdApprove(input: {
  evaluationId: string;
  remarks: string;
}): Promise<CycleResult<{ status: string }>> {
  /* -- HR OR THE MD (0056), at the owner's instruction, so HR can carry an
        increment through to close on their own. §8's row and its SQL twin move
        with it (P5-1).

        `mdSendBack` below is deliberately NOT widened. Returning a record to HR
        is the MD's judgement that it is not ready, and HR returning it to
        themselves is not a review — it is a round trip with nobody else in it. -- */
  const auth = await requireHrOrMd();
  if (!auth.ok) return auth;

  const parsed = mdReviewSchema.safeParse(input);
  if (!parsed.success) {
    return cycleError("INVALID", parsed.error.issues[0]?.message ?? "Check your remarks.");
  }

  const supabase = await createClient();
  // The MD's columns only — 0029's trigger refuses anything else, so a bug that
  // widened this object would fail loudly rather than overwrite HR's summary.
  const { error } = await supabase
    .from("evaluation_reviews")
    .update({
      // NULL, not "". An empty string reads as "they wrote something and it was
      // blank"; null is the truthful "they did not write anything", and it is
      // what every reader of this column already tests for.
      md_remarks: parsed.data.remarks || null,
      md_outcome: "APPROVED",
      md_reviewed_by: auth.session.profile.id,
      md_reviewed_at: new Date().toISOString(),
    })
    .eq("evaluation_id", parsed.data.evaluationId);

  if (error) return cycleError("SAVE_FAILED", `Could not save your remarks: ${error.message}`);

  const moved = await transition(parsed.data.evaluationId, "MD_REVIEWED", actorOf(auth.session));
  if (!moved.ok) return cycleError(moved.error.code, moved.error.message);

  revalidatePath("/reports");
  revalidatePath(`/reports/${parsed.data.evaluationId}`);
  return { ok: true, data: { status: "MD_REVIEWED" } };
}

/** Send back to HR. HR_APPROVED → PENDING_HR_REVIEW, reason required (§8). */
export async function mdSendBack(input: {
  evaluationId: string;
  reason: string;
}): Promise<CycleResult<{ status: string }>> {
  const auth = await requireMd();
  if (!auth.ok) return auth;

  const parsed = z
    .object({
      evaluationId: z.string().uuid(),
      reason: z.string().trim().min(MIN_REASON_LENGTH, `Give a reason of at least ${MIN_REASON_LENGTH} characters.`),
    })
    .safeParse(input);
  if (!parsed.success) {
    return cycleError("INVALID", parsed.error.issues[0]?.message ?? "Give a reason.");
  }

  const supabase = await createClient();
  await supabase
    .from("evaluation_reviews")
    .update({
      md_outcome: "RETURNED",
      md_reviewed_by: auth.session.profile.id,
      md_reviewed_at: new Date().toISOString(),
    })
    .eq("evaluation_id", parsed.data.evaluationId);

  const moved = await transition(parsed.data.evaluationId, "PENDING_HR_REVIEW", actorOf(auth.session), {
    reason: parsed.data.reason,
  });
  if (!moved.ok) return cycleError(moved.error.code, moved.error.message);

  revalidatePath("/reports");
  revalidatePath(`/reports/${parsed.data.evaluationId}`);
  return { ok: true, data: { status: "PENDING_HR_REVIEW" } };
}

/** Close. MD_REVIEWED → CLOSED. EVALUATION cycles only (§8). */
export async function closeEvaluation(input: {
  evaluationId: string;
}): Promise<CycleResult<{ status: string }>> {
  const auth = await requireHr();
  if (!auth.ok) return auth;

  const moved = await transition(input.evaluationId, "CLOSED", actorOf(auth.session));
  if (!moved.ok) return cycleError(moved.error.code, moved.error.message);

  revalidatePath("/reports");
  revalidatePath(`/reports/${input.evaluationId}`);
  return { ok: true, data: { status: "CLOSED" } };
}
