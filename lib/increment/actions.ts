"use server";

/** The salary review's writes (P21). Every figure is computed by calc.ts and stored. */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { checkRole } from "@/lib/auth/guards";
import { cycleError, type CycleResult } from "@/lib/cycles/schema";
import { hikePct, monthsSince } from "@/lib/increment/calc";
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

const proposalSchema = z.object({
  evaluationId: z.string().uuid(),
  proposedCtc: z.number().positive("A proposed salary must be more than zero."),
  justification: z.string().trim().min(1, "Say why this figure is right before sending it on."),
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
  justification: string;
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
      hr_justification: parsed.data.justification,
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
  remarks: z.string().trim().min(1, "Record your remarks before approving."),
});

/** Set the approved figure. The percent is derived, never accepted. */
export async function saveApproval(input: {
  evaluationId: string;
  approvedCtc: number;
  remarks: string;
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
      md_remarks: parsed.data.remarks,
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
