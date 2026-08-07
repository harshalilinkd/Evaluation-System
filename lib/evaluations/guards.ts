/** Transition guards — the "Guard" column of CLAUDE.md §8. */

import "server-only";

import { getEvaluationForm } from "@/lib/forms/get-form";
import { describeMissing, findMissingRequired } from "@/lib/evaluations/completeness";
import type { RatingLayer } from "@/lib/forms/types";
import { MIN_REASON_LENGTH } from "@/lib/evaluations/transitions";
import type { GuardName, TransitionDefinition } from "@/lib/evaluations/transitions";
import type { Tables } from "@/types/database";

// Moved to the pure module in P13 so a client dialog can disable its button on
// the same threshold this guard rejects on. Re-exported so existing importers
// are untouched, and so there is still exactly one definition.
export { MIN_REASON_LENGTH };

export type GuardResult = { ok: true } | { ok: false; code: string; message: string };

export type GuardContext = {
  evaluation: Tables<"evaluations">;
  cycle: Pick<Tables<"evaluation_cycles">, "id" | "status" | "disclosure" | "variance_threshold">;
  transition: TransitionDefinition;
  options: { reason?: string };
};

function deny(code: string, message: string): GuardResult {
  return { ok: false, code, message };
}

/* ---------- Which layer is this transition about? ---------- */

/**
 * The layer whose answers a guard should inspect: the one being locked, or —
 * for a return — the one being unlocked.
 */
function subjectLayer(transition: TransitionDefinition): RatingLayer | null {
  return transition.locks ?? transition.unlocks ?? null;
}

/* ---------- Guards ---------- */

/**
 * §8, DRAFT → CYCLE_ACTIVE: "cycle launched, evaluatee + lead assigned,
 * questions snapshotted".
 *
 * All three are checked rather than assumed. An evaluation launched without a
 * lead can never leave SELF_SUBMITTED — nobody would be permitted to review it —
 * and one launched without a snapshot renders as an empty form.
 */
async function requireLaunchReady(ctx: GuardContext): Promise<GuardResult> {
  if (ctx.cycle.status !== "ACTIVE") {
    return deny(
      "CYCLE_NOT_ACTIVE",
      "The cycle has not been launched yet. Launch the cycle before activating its evaluations.",
    );
  }

  if (!ctx.evaluation.lead_id) {
    return deny(
      "NO_LEAD",
      "No reporting lead is assigned. Assign one before launching, or nobody will be able to review this evaluation.",
    );
  }

  // The snapshot is what makes the form real (§5). getEvaluationForm fails with
  // SNAPSHOT_EMPTY when it is missing, which is exactly the check we want.
  const form = await getEvaluationForm(ctx.evaluation.id, "SELF");
  if (!form.ok && form.error.code === "SNAPSHOT_EMPTY") {
    return deny(
      "NOT_SNAPSHOTTED",
      "The question list has not been frozen for this evaluation. Snapshot it before launching.",
    );
  }
  if (!form.ok) {
    return deny(form.error.code, form.error.message);
  }

  return { ok: true };
}

/**
 * Every required, **visible** question for this layer has a non-empty answer.
 *
 * Visibility matters as much as requiredness: §6 says a hidden question is
 * neither validated nor stored, so "If yes, please specify" must not block a
 * submit when the parent was answered No. getEvaluationForm has already applied
 * both filters, so this only has to walk what it returns.
 */
async function requireAllRequiredAnswered(ctx: GuardContext): Promise<GuardResult> {
  const layer = subjectLayer(ctx.transition);
  if (!layer) return { ok: true };

  const form = await getEvaluationForm(ctx.evaluation.id, layer);
  if (!form.ok) return deny(form.error.code, form.error.message);

  const missing = findMissingRequired(form.data.questions, form.data.answers);

  if (missing.length > 0) {
    return deny("REQUIRED_ANSWERS_MISSING", describeMissing(missing));
  }

  return { ok: true };
}

/**
 * §8: returns carry a reason. It is stored on the audit row and shown to the
 * person receiving the returned form, so a bare "no" or an empty string is not
 * enough to be useful to them.
 */
async function requireReason(ctx: GuardContext): Promise<GuardResult> {
  const reason = ctx.options.reason?.trim() ?? "";

  if (reason.length < MIN_REASON_LENGTH) {
    return deny(
      "REASON_REQUIRED",
      `Explain why you are returning this, in at least ${MIN_REASON_LENGTH} characters. The person receiving it will see exactly what you write.`,
    );
  }

  return { ok: true };
}

/**
 * §8, LEAD_REVIEWED → MD_FINALIZED: "decisions recorded". At minimum a
 * promotion recommendation and the MD's remarks, per the brief — the salary
 * fields are optional because not every appraisal carries an increment.
 */
async function requireDecisions(ctx: GuardContext): Promise<GuardResult> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("evaluation_decisions")
    .select("promotion_recommendation, md_remarks")
    .eq("evaluation_id", ctx.evaluation.id)
    .maybeSingle();

  if (error) {
    return deny("QUERY_FAILED", `Could not read the decision record: ${error.message}`);
  }
  if (!data) {
    return deny(
      "DECISIONS_MISSING",
      "Record the promotion recommendation and your remarks before finalising.",
    );
  }

  const missing: string[] = [];
  if (!data.promotion_recommendation?.trim()) missing.push("promotion recommendation");
  if (!data.md_remarks?.trim()) missing.push("remarks");

  if (missing.length > 0) {
    return deny("DECISIONS_INCOMPLETE", `Still to record: ${missing.join(" and ")}.`);
  }

  return { ok: true };
}

/**
 * §8, MD_FINALIZED → CLOSED: "disclosure applied".
 *
 * Closing is what releases the result to the employee under the cycle's
 * disclosure policy, so there has to be something to release. A final score of
 * null would disclose nothing while telling the employee their appraisal is
 * complete.
 */
async function requireDisclosureReady(ctx: GuardContext): Promise<GuardResult> {
  if (!ctx.cycle.disclosure) {
    return deny(
      "NO_DISCLOSURE_POLICY",
      "This cycle has no disclosure policy set. Choose one before closing.",
    );
  }

  if (ctx.cycle.disclosure !== "NONE" && ctx.evaluation.final_overall === null) {
    return deny(
      "NO_FINAL_SCORE",
      "There is no final score to disclose. Finalise the MD layer before closing.",
    );
  }

  return { ok: true };
}

/* ---------- Registry ---------- */


/* ---------- AMEND-3 guards ---------- */

/**
 * §8: the system raises OPEN → PENDING_HR_REVIEW only when BOTH timestamps are
 * set. Checked here rather than trusted from the caller, because the caller is
 * whichever of the two people submitted second and must not be able to advance
 * the record by claiming the other side is in.
 */
async function requireBothLayersIn(ctx: GuardContext): Promise<GuardResult> {
  const { self_submitted_at, lead_submitted_at } = ctx.evaluation;
  if (self_submitted_at && lead_submitted_at) return { ok: true };

  // The message deliberately does NOT say which side is missing: this guard can
  // be reached by the employee or the lead, and naming the other one leaks the
  // very progress signal §5's blindness invariant exists to withhold.
  return deny(
    "LAYERS_INCOMPLETE",
    "Both sides have not been submitted yet. HR will review this once they are.",
  );
}

/**
 * §8: "on an INCREMENT cycle the salary block must be complete".
 *
 * ⚠ PARTIALLY ENFORCED. `evaluation_cycles` has no `cycle_type` column — AMEND-2
 * introduced the idea and no migration has added it, and §0.4 forbids inventing
 * one. So this cannot yet tell an increment cycle from an evaluation cycle, and
 * it therefore does NOT require salary on either. What it does enforce is the
 * half that is unambiguous: if a salary block has been started, it must be
 * coherent before the record leaves HR.
 */
async function requireSalaryComplete(ctx: GuardContext): Promise<GuardResult> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const { data } = await supabase
    .from("evaluation_decisions")
    .select("old_salary, increment_pct, new_salary")
    .eq("evaluation_id", ctx.evaluation.id)
    .maybeSingle();

  if (!data) return { ok: true };

  const started = data.old_salary !== null || data.increment_pct !== null || data.new_salary !== null;
  if (!started) return { ok: true };

  if (data.old_salary === null || data.new_salary === null) {
    return deny(
      "SALARY_INCOMPLETE",
      "The salary block has been started but is not complete. Fill in the current and new salary before sending this to the MD.",
    );
  }
  if (Number(data.new_salary) <= Number(data.old_salary)) {
    return deny(
      "SALARY_NOT_AN_INCREMENT",
      "The new salary is not higher than the current one. Correct it before sending this to the MD.",
    );
  }
  return { ok: true };
}

/** §8: "MD has read the report; remarks recorded". */
async function requireMdRemarks(ctx: GuardContext): Promise<GuardResult> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const { data } = await supabase
    .from("evaluation_decisions")
    .select("md_remarks")
    .eq("evaluation_id", ctx.evaluation.id)
    .maybeSingle();

  if (data?.md_remarks && data.md_remarks.trim().length > 0) return { ok: true };
  return deny(
    "REMARKS_REQUIRED",
    "Record a line of remarks before marking this reviewed. It is the only part of the MD's reading that survives.",
  );
}

/**
 * §8: "interview date and final approved amount recorded".
 *
 * ⚠ NOT ENFORCED. There is no interview record in the schema — no date column,
 * no final-approved-amount column, no table. AMEND-2 describes the step and no
 * migration has built it. Guarding on a column that does not exist would be a
 * runtime error, and inventing one breaches §0.4, so this passes and says so.
 * The transition is still audited, so the act is on the record even though its
 * detail is not.
 */
async function requireInterviewRecord(_ctx: GuardContext): Promise<GuardResult> {
  return { ok: true };
}

export const GUARDS: Record<GuardName, (ctx: GuardContext) => Promise<GuardResult>> = {
  requireLaunchReady,
  requireAllRequiredAnswered,
  requireReason,
  requireDecisions,
  requireDisclosureReady,
  requireBothLayersIn,
  requireSalaryComplete,
  requireMdRemarks,
  requireInterviewRecord,
};
