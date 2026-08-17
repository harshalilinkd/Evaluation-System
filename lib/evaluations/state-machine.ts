/** transition() — the ONLY place an evaluation's status ever changes. CLAUDE.md §8. */

import "server-only";

import type { RatingLayer } from "@/lib/evaluations/transitions";

import { getEvaluationForm } from "@/lib/forms/get-form";
import { after } from "next/server";

import { notifyTransition, type TransitionNotice } from "@/lib/notify/events";
import { createClient } from "@/lib/supabase/server";
import { GUARDS, type GuardResult } from "@/lib/evaluations/guards";
import { computeFinalScores, computeScores } from "@/lib/evaluations/scoring";
import {
  canTransition,
  type EvaluationStatus,
  type TransitionActor,
  type TransitionDefinition,
} from "@/lib/evaluations/transitions";
import type { Json } from "@/types/database";

// Re-exported so §8's table and its static check are reachable from the module
// the brief names, without duplicating either.
export {
  TRANSITIONS,
  canTransition,
  findTransition,
  transitionsFrom,
  type ActorRule,
  type CanTransitionResult,
  type EvaluationStatus,
  type GuardName,
  type TransitionActor,
  type TransitionDefinition,
  type TransitionSubject,
} from "@/lib/evaluations/transitions";

export type TransitionOptions = {
  /** Required on returns (§8). Stored on the audit row, shown to the recipient. */
  reason?: string;
  /**
   * Which row of §8 this is, where `from` and `to` do not identify one.
   *
   * AMEND-3 made the two layer submissions both OPEN → OPEN, and there are two
   * ways into PENDING_HR_REVIEW. `locks` picks the first pair; `bySystem` the
   * second. The SQL half uses the same discriminator, so the two cannot drift.
   */
  locks?: RatingLayer;
  bySystem?: boolean;
  /** Which layers an HR return unlocks. §8: SELF, LEAD or BOTH. */
  returnedTo?: "SELF" | "LEAD" | "BOTH";
  /** HR advancing past a layer that never came in. Marks it skipped, not done. */
  skip?: { self?: boolean; lead?: boolean };
  /**
   * Wait for the outbound messages before answering. Defaults to NO.
   *
   * THIS IS WHY A BUTTON SAT ON "Approving and closing…" FOR SECONDS.
   * `notifyTransition` opens an SMTP connection to Gmail and posts to Maytapi —
   * a TLS handshake, an AUTH, a send and a quit, per recipient, per channel,
   * with §10's timeout-and-one-retry behind it. All of that ran inside the
   * request, so the person who pressed the button was made to wait for
   * somebody ELSE's WhatsApp to be accepted before their own screen moved. On
   * `approveAndClose`, which chains three transitions, they waited for it more
   * than once.
   *
   * The work is unchanged and still happens — `after()` runs it once the
   * response has been sent, and the platform keeps the function alive for it.
   * That is safe precisely because of PW-2: the hook already runs AFTER the
   * commit, already swallows its own errors, and already cannot turn a
   * successful transition into a reported failure. Nothing about the status
   * change, the audit row or the scores depends on it.
   *
   * What IS lost when deferred is `notified` — the advisory that lets a caller
   * say "submitted, but we could not reach your lead". Two callers surface
   * that (`sendToMd`, `closeEvaluation`) and both pass `true`. Everything else
   * discarded it, so everything else simply gets its answer sooner.
   *
   * The default is the fast path on purpose: forgetting this flag costs a
   * caller an advisory it was not going to read, whereas defaulting the other
   * way would leave every new button slow and nobody would know why.
   */
  awaitNotifications?: boolean;
  /**
   * The agreed final score, recorded by HR on the MD's behalf.
   *
   * ⚠ DIVERGES FROM §11 AS AMENDED, AT THE OWNER'S EXPLICIT INSTRUCTION.
   * AMEND-2 rewrote §11 to say "There is no final score column and no
   * override... If a single headline figure is needed, use the Lead average and
   * label it as such." This puts a deliberate figure back.
   *
   * What it is NOT: an override of anybody's question score. §17's prohibition
   * stands untouched — no answer is rewritten, both layers stay exactly as they
   * were submitted, and the report still carries both numbers and the gap. This
   * is one overall figure for the record, agreed between HR and the MD out of
   * band and typed in by HR.
   *
   * Written through `p_evaluation_patch`, which is the only route: P5-2 makes
   * `evaluations` UPDATE-able solely inside the window this RPC opens, so there
   * is no direct write to reach for.
   */
  finalScore?: number | null;
};

export type TransitionResult =
  | {
      ok: true;
      data: {
        evaluationId: string;
        from: EvaluationStatus;
        to: EvaluationStatus;
        auditId: string;
        overallScore: number | null;
        /**
         * Advisory. A send that failed never fails the transition (§10).
         *
         * NULL when the messages were deferred, which is the default — see
         * `awaitNotifications`. Null means "not waited for", never "nothing
         * was sent"; the two readers that need the distinction ask to wait.
         */
        notified: TransitionNotice | null;
      };
    }
  | { ok: false; error: { code: string; message: string } };

function fail(code: string, message: string): TransitionResult {
  return { ok: false, error: { code, message } };
}

/* ---------- Side effects per transition ---------- */

/** Which evaluation columns each move stamps or clears. */
function timestampPatch(
  transition: TransitionDefinition,
  now: string,
): Record<string, string | null> {
  /* -- AMEND-3: a layer submission is OPEN → OPEN, so the pair of statuses no
        longer identifies the move. The LOCKED LAYER does, which is the same
        discriminator the SQL half uses. -- */
  if (transition.from === "OPEN" && transition.to === "OPEN") {
    if (transition.locks === "SELF") return { self_submitted_at: now };
    if (transition.locks === "LEAD") return { lead_submitted_at: now };
    return {};
  }

  switch (`${transition.from}->${transition.to}`) {
    // A return clears the timestamp AND the overall computed at submit time.
    // Leaving a score on an unsubmitted layer would show a number on the
    // dashboard for a form somebody is still editing.
    //
    // WHICH layers clear is decided by the caller and passed through
    // `returned_to`: §8 lets HR return SELF, LEAD or BOTH, and one static patch
    // cannot express three outcomes. `transition()` merges the layer clears in.
    case "PENDING_HR_REVIEW->OPEN":
      return {};
    case "HR_APPROVED->MD_REVIEWED":
      return { md_finalized_at: now };
    case "MD_REVIEWED->CLOSED":
    case "INTERVIEW_DONE->CLOSED":
      return { closed_at: now };
    default:
      return {};
  }
}

/** The columns an HR return clears, for the layers it names. */
export function returnPatch(returnedTo: "SELF" | "LEAD" | "BOTH"): Record<string, string | null> {
  const patch: Record<string, string | null> = { returned_to: returnedTo };
  if (returnedTo === "SELF" || returnedTo === "BOTH") {
    patch.self_submitted_at = null;
    patch.self_overall = null;
  }
  if (returnedTo === "LEAD" || returnedTo === "BOTH") {
    patch.lead_submitted_at = null;
    patch.lead_overall = null;
  }
  return patch;
}

/** Which evaluation column receives the overall score for the layer being locked. */
const OVERALL_COLUMN = {
  SELF: "self_overall",
  LEAD: "lead_overall",
  MD: "final_overall",
} as const;

/**
 * Move an evaluation to a new status.
 *
 * **This is the only way status changes anywhere in this codebase.** Nothing
 * else may write `evaluations.status` — not a Server Action, not a script, not a
 * "quick fix". Every path through here validates against §8's table, runs the
 * guards, applies the layer lock, computes and persists the scores, and writes
 * the audit row, and it does all of that in one database transaction. A direct
 * UPDATE bypasses every one of those things at once, and the failure is silent:
 * an evaluation in a state nobody can explain, with no record of how it got there.
 *
 * Scores are computed here, at submit time, and stored (§5, §11). They are never
 * recalculated on read.
 */
export async function transition(
  evaluationId: string,
  to: EvaluationStatus,
  actor: TransitionActor,
  options: TransitionOptions = {},
): Promise<TransitionResult> {
  const supabase = await createClient();

  /* -- Load -- */
  const { data: evaluation, error: evaluationError } = await supabase
    .from("evaluations")
    .select("*")
    .eq("id", evaluationId)
    .maybeSingle();

  if (evaluationError) {
    return fail("QUERY_FAILED", `Could not read the evaluation: ${evaluationError.message}`);
  }
  if (!evaluation) {
    return fail("EVALUATION_NOT_FOUND", `No evaluation with id ${evaluationId}.`);
  }

  const { data: cycle, error: cycleError } = await supabase
    .from("evaluation_cycles")
    .select("id, status, disclosure, variance_threshold")
    .eq("id", evaluation.cycle_id)
    .maybeSingle();

  if (cycleError) {
    return fail("QUERY_FAILED", `Could not read the cycle: ${cycleError.message}`);
  }
  if (!cycle) {
    return fail("CYCLE_NOT_FOUND", `No cycle with id ${evaluation.cycle_id}.`);
  }

  /* -- Static check: is this move in §8's table, and may this actor make it? -- */
  const permitted = canTransition(evaluation, to, actor, {
    locks: options.locks,
    bySystem: options.bySystem,
  });
  if (!permitted.allowed) {
    return fail(permitted.code, permitted.reason);
  }
  const definition = permitted.transition;

  /* -- Guards, in the order the table declares them -- */
  const guardContext = { evaluation, cycle, transition: definition, options };
  for (const guardName of definition.guards) {
    const guard = GUARDS[guardName];
    const result: GuardResult = await guard(guardContext);
    if (!result.ok) return fail(result.code, result.message);
  }

  /* -- Scores, computed now and stored (§11) -- */
  const now = new Date().toISOString();
  const patch: Record<string, string | number | boolean | null> = timestampPatch(definition, now);

  /* -- AMEND-3's three columns, from the caller's options.
        `returnPatch` decides which layers an HR return clears; `skip` records
        that HR advanced past a side that never came in. §8 requires the missing
        layer be MARKED, not left looking unanswered. -- */
  if (options.returnedTo) Object.assign(patch, returnPatch(options.returnedTo));
  if (options.skip?.self) patch.self_skipped = true;
  if (options.skip?.lead) patch.lead_skipped = true;

  /* -- The agreed final score, when HR supplies one.
        `!= null` rather than a truthiness test: 0 is a real score on a 0-5
        scale — §6 calls it "Very dissatisfied (Not implemented)" — and dropping
        it would silently turn the lowest possible rating into "not recorded"
        (P4-9, P12-3, the same trap twice already in this codebase). -- */
  if (options.finalScore != null) patch.final_overall = options.finalScore;

  let sectionScores: Json | null = null;
  let overallScore: number | null = null;
  let resolvedAnswers: Json | null = null;

  if (definition.locks) {
    const form = await getEvaluationForm(evaluationId, definition.locks);
    if (!form.ok) return fail(form.error.code, form.error.message);

    if (definition.locks === "MD") {
      // §11: the final score is resolved here — override, else lead — and the
      // resolved values are written into the MD layer explicitly, so nothing
      // downstream has to re-derive the fallback.
      const leadForm = await getEvaluationForm(evaluationId, "LEAD");
      const leadAnswers = leadForm.ok ? leadForm.data.answers : {};

      const computed = computeFinalScores(form.data, leadAnswers, form.data.answers);
      sectionScores = computed.sectionScores as Json;
      overallScore = computed.overallScore;
      resolvedAnswers = computed.resolvedAnswers as Json;
    } else {
      const computed = computeScores(form.data, form.data.answers);
      sectionScores = computed.sectionScores as Json;
      overallScore = computed.overallScore;
    }

    patch[OVERALL_COLUMN[definition.locks]] = overallScore;
  }

  /* -- Commit: status, layer lock, scores and audit, atomically -- */
  const diff = {
    before: {
      status: evaluation.status,
      self_overall: evaluation.self_overall,
      lead_overall: evaluation.lead_overall,
      final_overall: evaluation.final_overall,
    },
    after: { status: to, ...patch },
  };

  const { data: auditId, error: rpcError } = await supabase.rpc("apply_evaluation_transition", {
    p_evaluation_id: evaluationId,
    p_from_status: evaluation.status,
    p_to_status: to,
    p_actor_id: actor.profileId,
    p_action: definition.action,
    p_reason: options.reason?.trim() ?? null,
    p_diff: diff as Json,
    p_evaluation_patch: patch as Json,
    p_lock_layer: definition.locks ?? null,
    p_unlock_layer: definition.unlocks ?? null,
    p_answers: resolvedAnswers,
    p_section_scores: sectionScores,
    p_overall_score: overallScore,
  });

  if (rpcError) {
    // 40001 is the serialization_failure the function raises when the
    // from-status no longer matches — somebody moved it while we were checking.
    const code = rpcError.code === "40001" ? "CONCURRENT_MODIFICATION" : "TRANSITION_FAILED";
    return fail(code, rpcError.message);
  }

  /* -- Notify (§10) -- */
  //
  // AFTER the commit, deliberately. The status change is already durable and
  // audited by this point, so nothing here can turn a successful transition
  // into a reported failure — a provider outage, a missing API key or an
  // employee with no contact details must not roll back a submitted form.
  //
  // notifyTransition swallows its own errors and returns a summary. It is
  // reported alongside the result rather than merged into it: the caller needs
  // to be able to say "submitted, but we could not reach your lead", which is
  // a different sentence from either success or failure.
  const notice = {
    evaluationId,
    from: evaluation.status,
    to,
    reason: options.reason ?? null,
  };

  /* -- Deferred unless the caller asked to wait. See `awaitNotifications`.
        `after` is Next's own primitive for exactly this: the response goes out,
        the platform keeps the function alive, the send completes. Reading
        cookies inside it is supported, which is what `createClient()` needs.

        Errors are swallowed here as well as inside `notifyTransition`, because
        an `after` callback that throws is an unhandled rejection rather than
        anything a person could act on — and by this point the transition is
        durable and audited, so there is nothing left to report to. -- */
  let notified: TransitionNotice | null = null;

  if (options.awaitNotifications) {
    notified = await notifyTransition(notice);
  } else {
    after(async () => {
      try {
        await notifyTransition(notice);
      } catch {
        // Nothing to surface: the response has already been sent.
      }
    });
  }

  return {
    ok: true,
    data: {
      evaluationId,
      from: evaluation.status,
      to,
      auditId: auditId as unknown as string,
      overallScore,
      notified,
    },
  };
}
