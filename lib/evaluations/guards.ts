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
  /* The caller's whole options object. `finalScore` is here because
     `requireDisclosureReady` has to see a figure that is arriving in the same
     call as the transition it gates — see the note there. */
  options: { reason?: string; finalScore?: number | null };
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

  /* -- THIS GUARD USED TO DEMAND `final_overall`, AND NOTHING WRITES IT.
        It read "there is no final score to disclose — finalise the MD layer
        before closing", and that sentence describes a product that no longer
        exists. `final_overall` is only ever set when an MD LAYER is locked, and
        AMEND-3 left no transition that locks one: grep `locks:` in
        transitions.ts and there are exactly two, SELF and LEAD. AMEND-2 said as
        much outright — §11: "There is no final score column and no override."

        So this refused every close on any cycle whose disclosure was not NONE,
        which is both endings: HR completing it (0039) and the older
        MD_REVIEWED -> CLOSED. The feature could not have worked even with the
        migration applied, and neither could the path that shipped before it.

        §11 names the replacement in the same breath: "If a single headline
        figure is needed, use the Lead average and label it as such." So that is
        what has to exist before a score can be disclosed. -- */
  if (ctx.cycle.disclosure === "NONE") return { ok: true };

  /* -- What counts as "there is something to disclose", widest first.

        `options.finalScore` is checked because HR types the agreed figure and
        presses Complete in ONE call: the guard runs against the row as it was
        read, before the patch is applied, so a guard that only looked at stored
        columns would refuse the very score being supplied. That is a real trap
        — the field would appear to do nothing. -- */
  const suppliedNow = ctx.options.finalScore != null;
  const alreadyStored = ctx.evaluation.final_overall !== null;
  const hasLeadAverage = ctx.evaluation.lead_overall !== null;

  /* A skipped lead layer is not a missing score, it is an evaluation nobody
     rated — HR advanced past it deliberately (§8) and there is genuinely
     nothing to show. Refusing would strand exactly the records HR had already
     made a decision about, so it closes and the disclosure carries no figure. */
  if (suppliedNow || alreadyStored || hasLeadAverage || ctx.evaluation.lead_skipped) {
    return { ok: true };
  }

  return deny(
    "NO_RATING_TO_DISCLOSE",
    "There is no rating to disclose — the lead's review has not been submitted. Return it to them, or advance past it with a reason.",
  );
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
  const { self_submitted_at, lead_submitted_at, co_lead_id, co_lead_submitted_at, co_lead_skipped } =
    ctx.evaluation;

  /* -- ALL of them, not both. A person with a second reviewer (0083) has three
        layers, and two of three is not complete — advancing on two would send
        HR a report missing a manager who was asked for one, and would lock the
        third out on the way past: their layer gates on status OPEN, so their
        form would close before they had opened it.

        Written as "no outstanding layer" so somebody with one manager is
        unaffected: the third clause is vacuously true when `co_lead_id` is
        null, exactly as 0083's own completion trigger is. The two must agree —
        the trigger is what actually raises the status, and a guard that
        permitted what the trigger will not would be a button that does
        nothing. -- */
  const coLeadIn = !co_lead_id || Boolean(co_lead_submitted_at) || co_lead_skipped;
  if (self_submitted_at && lead_submitted_at && coLeadIn) return { ok: true };

  // The message deliberately does NOT say which side is missing: this guard can
  // be reached by the employee or by either manager, and naming the outstanding
  // one leaks the very progress signal §5's blindness invariant exists to
  // withhold. "Everyone" rather than "both", because there may be three.
  return deny(
    "LAYERS_INCOMPLETE",
    "Not everyone has submitted yet. HR will review this once they have.",
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

/**
 * The cycle is an EVALUATION, not an INCREMENT.
 *
 * The gate on HR closing without the MD (0039). It reads the cycle rather than
 * taking anybody's word for it, and it FAILS CLOSED: a cycle row that cannot be
 * read, or a `cycle_type` that is neither value, is refused. The alternative —
 * defaulting to "probably an evaluation" — would let an unreadable row become a
 * way to close a pay decision one-handed, which is exactly what AMEND-2's split
 * of HR and MD exists to prevent.
 */
async function requireEvaluationCycle(ctx: GuardContext): Promise<GuardResult> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  const { data } = await supabase
    .from("evaluation_cycles")
    .select("cycle_type")
    .eq("id", ctx.evaluation.cycle_id)
    .maybeSingle();

  if (data?.cycle_type === "EVALUATION") return { ok: true };

  return deny(
    "NOT_AN_EVALUATION_CYCLE",
    data?.cycle_type === "INCREMENT"
      ? "This is an increment cycle. The MD approves the salary before it can be completed — send it to them."
      : "Could not confirm this is an evaluation cycle, so it cannot be completed here. Send it to the MD.",
  );
}

/* `requireMdRemarks` stood here and enforced §8's "remarks recorded" on
   HR_APPROVED → MD_REVIEWED. Removed at the owner's explicit instruction — the
   MD may approve without writing anything. The reasoning and how to restore it
   are recorded on the transition row itself, in transitions.ts, which is where
   somebody looking for the rule would go.

   It also read the WRONG TABLE. The MD's remark is written to
   `evaluation_reviews.md_remarks` by `mdApprove` (0029), and this selected
   `evaluation_decisions` — 0003's table, which nothing on the current path
   writes. So it could only ever have found null, and the transition would have
   been refused for every MD however much they typed. Nobody hit it because the
   Zod schema in `lib/reports/actions.ts` rejected the empty case first. Worth
   knowing: removing this took out a guard that was already broken. */

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
  requireEvaluationCycle,
  requireInterviewRecord,
};
