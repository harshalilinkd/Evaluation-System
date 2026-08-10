"use server";

/** The salary review's writes (P21). Every figure is computed by calc.ts and stored. */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { checkRole } from "@/lib/auth/guards";
import { cycleError, type CycleResult } from "@/lib/cycles/schema";
import { hikePct, monthsSince } from "@/lib/increment/calc";
import { mdApprove } from "@/lib/reports/actions";
import { createClient } from "@/lib/supabase/server";

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

async function requireHrOrMd() {
  const auth = await checkRole(["HR_ADMIN", "MD"]);
  if (!auth.ok) return cycleError("FORBIDDEN", auth.error.message);
  return { ok: true as const, session: auth.session };
}

/* ---------- HR's proposal ---------- */

/**
 * OPTIONAL AT THE OWNER'S EXPLICIT INSTRUCTION.
 *
 * P19-8 made it mandatory, on the reasoning that "optional would mean usually
 * blank" and that a pay change with no explanation is the thing somebody has to
 * reconstruct from memory two years later. That reasoning still holds and the
 * decision has been overruled deliberately — recorded here rather than quietly
 * relaxed. The field is still offered first and still travels with the figure;
 * it simply no longer blocks.
 *
 * Everything else about the record is unchanged: the figure, its percent, the
 * actor and the timestamp are all still written, so the WHO and the WHAT remain
 * answerable even when the WHY is left blank.
 */
const proposalSchema = z.object({
  evaluationId: z.string().uuid(),
  proposedCtc: z.number().positive("A proposed salary must be more than zero."),
  justification: z.string().trim().default(""),
  /* -- WHEN THE CONVERSATION IS BOOKED, at the owner's instruction: an optional
        date HR sets while sending to the MD.

        `interview_date` already exists on `increment_reviews` (0030) and was
        only ever written at the close, recording when the interview HAPPENED.
        Writing it earlier is the same fact learned sooner — and the column
        guard lets HR write it, because the trigger's HR branch refuses only the
        MD's three columns. -- */
  interviewDate: z.string().trim().optional(),
});

/**
 * Save HR's proposal, creating the review row on first save.
 *
 * **The percent is recomputed here from the two salaries.** The client sends the
 * new CTC and nothing else about the arithmetic: a percent that arrived from the
 * browser is a percent nobody can reproduce, and the brief forbids computing one
 * in a component. `hikePct` is the single implementation, and the result is
 * STORED so the figure a decision was made against survives any later change to
 * the current salary.
 */
export async function saveProposal(input: {
  evaluationId: string;
  proposedCtc: number;
  justification?: string;
  interviewDate?: string;
}): Promise<CycleResult<{ hikePct: number | null }>> {
  const auth = await requireHr();
  if (!auth.ok) return auth;

  const parsed = proposalSchema.safeParse(input);
  if (!parsed.success) {
    return cycleError("INVALID", parsed.error.issues[0]?.message ?? "Check the figures.");
  }

  const supabase = await createClient();

  const { data: evaluation } = await supabase
    .from("evaluations")
    .select("id, evaluatee_id")
    .eq("id", parsed.data.evaluationId)
    .maybeSingle();
  if (!evaluation) return cycleError("NOT_FOUND", "That evaluation is not available.");

  const { data: employment } = await supabase
    .from("employment_records")
    .select("current_ctc, joining_ctc, last_increment_date")
    .eq("profile_id", evaluation.evaluatee_id)
    .maybeSingle();

  const currentCtc = employment?.current_ctc ?? null;
  // The one thing that must never become a division by zero. Refused with a
  // sentence naming the fix rather than an arithmetic error.
  if (currentCtc === null || currentCtc <= 0) {
    return cycleError(
      "NO_CURRENT_SALARY",
      "There is no current salary on record for this person. Add it on their Employment tab before proposing an increment.",
    );
  }

  const pct = hikePct(currentCtc, parsed.data.proposedCtc);

  const { error } = await supabase.from("increment_reviews").upsert(
    {
      evaluation_id: parsed.data.evaluationId,
      current_ctc: currentCtc,
      joining_ctc: employment?.joining_ctc ?? null,
      months_since_last_increment: monthsSince(employment?.last_increment_date ?? null, new Date()),
      hr_proposed_ctc: parsed.data.proposedCtc,
      hr_proposed_hike_pct: pct,
      hr_justification: parsed.data.justification || null,
      // Only when given: an absent date must not blank one already set.
      ...(parsed.data.interviewDate ? { interview_date: parsed.data.interviewDate } : {}),
      status: "HR_PROPOSED",
    },
    { onConflict: "evaluation_id" },
  );

  if (error) return cycleError("SAVE_FAILED", `Could not save the proposal: ${error.message}`);

  /* -- The expectation may not have landed at submission: the review row cannot
        exist before there is a current salary, and there may not have been one
        then. Now there is, so pick it up. Idempotent — it coalesces rather than
        overwriting, so a second call cannot blank a figure. -- */
  await supabase.rpc("record_salary_expectation", { p_evaluation_id: parsed.data.evaluationId });

  revalidatePath(`/reports/${parsed.data.evaluationId}`);
  return { ok: true, data: { hikePct: pct } };
}

/* ---------- The MD's approval ---------- */

const approvalSchema = z.object({
  evaluationId: z.string().uuid(),
  approvedCtc: z.number().positive("An approved salary must be more than zero."),
  // Optional, for the same instruction and the same reason as the
  // justification above. The approval is still dated and attributed.
  remarks: z.string().trim().default(""),
});

/** Set the approved figure. The percent is derived, never accepted. */
export async function saveApproval(input: {
  evaluationId: string;
  approvedCtc: number;
  remarks?: string;
}): Promise<CycleResult<{ hikePct: number | null }>> {
  const auth = await requireMd();
  if (!auth.ok) return auth;

  const parsed = approvalSchema.safeParse(input);
  if (!parsed.success) {
    return cycleError("INVALID", parsed.error.issues[0]?.message ?? "Check the figures.");
  }

  const supabase = await createClient();
  const { data: review } = await supabase
    .from("increment_reviews")
    .select("current_ctc")
    .eq("evaluation_id", parsed.data.evaluationId)
    .maybeSingle();

  if (!review) {
    return cycleError("NO_PROPOSAL", "HR has not proposed a figure on this evaluation yet.");
  }

  const pct = hikePct(review.current_ctc, parsed.data.approvedCtc);

  const { error } = await supabase
    .from("increment_reviews")
    .update({
      md_approved_ctc: parsed.data.approvedCtc,
      md_approved_hike_pct: pct,
      md_remarks: parsed.data.remarks || null,
      status: "MD_APPROVED",
    })
    .eq("evaluation_id", parsed.data.evaluationId);

  if (error) return cycleError("SAVE_FAILED", `Could not save the approval: ${error.message}`);

  revalidatePath(`/reports/${parsed.data.evaluationId}`);
  return { ok: true, data: { hikePct: pct } };
}

/* ---------- The interview, and the increment itself ---------- */

const confirmSchema = z.object({
  evaluationId: z.string().uuid(),
  finalCtc: z.number().positive("A final salary is required."),
  effectiveFrom: z.string().min(1, "An effective-from date is required."),
  interviewDate: z.string().optional(),
  attendees: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

/**
 * Confirm the increment.
 *
 * Six writes, one transaction — see 0030. This function's whole job is to
 * compute the final percent with `hikePct` and hand the figures over; the
 * database does the rest atomically, because a partially applied increment is a
 * payroll incident rather than something to retry.
 */
export async function confirmIncrement(input: {
  evaluationId: string;
  finalCtc: number;
  effectiveFrom: string;
  interviewDate?: string;
  attendees?: string;
  notes?: string;
}): Promise<CycleResult<{ salaryHistoryId: string; effectiveFrom: string }>> {
  const auth = await requireHrOrMd();
  if (!auth.ok) return auth;

  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) {
    return cycleError("INVALID", parsed.error.issues[0]?.message ?? "Check the figures.");
  }

  const supabase = await createClient();
  const { data: review } = await supabase
    .from("increment_reviews")
    .select("current_ctc, md_approved_ctc")
    .eq("evaluation_id", parsed.data.evaluationId)
    .maybeSingle();

  if (!review) return cycleError("NO_REVIEW", "There is no salary review on this evaluation.");
  // Re-checked in SQL as well. Two guards, because the brief forbids confirming
  // without an MD approval and this is the last point either can catch it.
  if (review.md_approved_ctc === null) {
    return cycleError("NOT_APPROVED", "The MD has not approved this increment yet.");
  }

  const finalPct = hikePct(review.current_ctc, parsed.data.finalCtc);

  const { data, error } = await supabase.rpc("confirm_increment", {
    p_evaluation_id: parsed.data.evaluationId,
    p_final_ctc: parsed.data.finalCtc,
    p_final_hike_pct: finalPct,
    p_effective_from: parsed.data.effectiveFrom,
    p_interview_date: parsed.data.interviewDate ?? null,
    p_interview_attendees: parsed.data.attendees ?? null,
    p_interview_notes: parsed.data.notes ?? null,
  });

  if (error) {
    // Nothing was applied — the function is one transaction.
    return cycleError("CONFIRM_FAILED", `Nothing was changed: ${error.message}`);
  }

  const result = (data ?? {}) as { salary_history_id?: string; effective_from?: string };

  revalidatePath("/reports");
  revalidatePath(`/reports/${parsed.data.evaluationId}`);
  revalidatePath("/admin/increments");

  return {
    ok: true,
    data: {
      salaryHistoryId: result.salary_history_id ?? "",
      effectiveFrom: result.effective_from ?? parsed.data.effectiveFrom,
    },
  };
}

/* ---------- Settings ---------- */

/** The quick-set bands. Configurable, per the brief, rather than hardcoded. */
export async function saveHikeBands(bands: number[]): Promise<CycleResult<{ saved: true }>> {
  const auth = await requireHr();
  if (!auth.ok) return auth;

  const parsed = z
    .array(z.number().min(0).max(200))
    .min(1)
    .max(6)
    .safeParse(bands);
  if (!parsed.success) {
    return cycleError("INVALID", "Give between one and six percentages, each between 0 and 200.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("increment_settings")
    .update({
      hike_bands: parsed.data,
      updated_by: auth.session.profile.id,
    })
    .eq("id", true);

  if (error) return cycleError("SAVE_FAILED", `Could not save: ${error.message}`);

  revalidatePath("/admin/settings");
  return { ok: true, data: { saved: true } };
}

/* ---------- One press: approve and close ---------- */

/**
 * The MD approves the figure AND finishes the increment.
 *
 * AT THE OWNER'S INSTRUCTION the two acts are joined: "after MD approved figure
 * it considered as reviewed so after this it should get closed."
 *
 * Three §8 steps were three separate presses on two different parts of the
 * page — approve the figure in the Salary band, approve the report on the rail,
 * then Confirm and close back in the Salary band. Nothing in that sequence
 * needed a human decision between the steps, and it was reported twice as "the
 * cycle did not close". A sequence with no decision points in it is one action
 * wearing three buttons.
 *
 * ORDER IS NOT ARBITRARY. The figure must be stored before the record moves,
 * because `confirm_increment` refuses without an approved amount; the record
 * must reach MD_REVIEWED before it can be closed, because §8 has no other route
 * in. Each step is the existing, guarded one — nothing here reimplements a
 * transition or a salary write.
 *
 * IT IS NOT ATOMIC ACROSS ALL THREE, and that is stated rather than hidden.
 * The close itself is one transaction (0030), so the money and the status can
 * never disagree. What can happen is that the approval lands and the close does
 * not — a failure between steps leaves the figure approved and the record at
 * MD_REVIEWED, which is a real, valid, recoverable state with a Confirm and
 * close button already pointing at it. The message says so.
 */
export async function approveAndClose(input: {
  evaluationId: string;
  approvedCtc: number;
  remarks?: string;
  effectiveFrom: string;
}): Promise<CycleResult<{ closed: true; effectiveFrom: string }>> {
  const auth = await requireMd();
  if (!auth.ok) return auth;

  const approval = await saveApproval({
    evaluationId: input.evaluationId,
    approvedCtc: input.approvedCtc,
    remarks: input.remarks ?? "",
  });
  if (!approval.ok) return approval;

  /* -- The MD's review of the REPORT, which is what moves HR_APPROVED ->
        MD_REVIEWED. Skipped when the record has already been moved, so pressing
        this on a record the MD reviewed earlier does not fail on a transition
        that has nothing left to do. -- */
  const supabase = await createClient();
  const { data: evaluation } = await supabase
    .from("evaluations")
    .select("status")
    .eq("id", input.evaluationId)
    .maybeSingle();

  if (evaluation?.status === "HR_APPROVED") {
    const reviewed = await mdApprove({
      evaluationId: input.evaluationId,
      remarks: input.remarks ?? "",
    });
    if (!reviewed.ok) {
      return cycleError(
        "REVIEW_FAILED",
        `The figure is approved and saved, but the record could not be moved to review: ${reviewed.error.message}`,
      );
    }
  }

  const closed = await confirmIncrement({
    evaluationId: input.evaluationId,
    finalCtc: input.approvedCtc,
    effectiveFrom: input.effectiveFrom,
  });

  if (!closed.ok) {
    return cycleError(
      closed.error.code,
      `${closed.error.message} The figure is approved and the record is with you — use Confirm and close below to finish.`,
    );
  }

  return { ok: true, data: { closed: true, effectiveFrom: closed.data.effectiveFrom } };
}
