/** The §8 transition table and the static half of its checks. Pure — no database. */

import type { Enums } from "@/types/database";

export type EvaluationStatus = Enums<"evaluation_status">;
export type RatingLayer = Enums<"rating_layer">;
export type AppRole = Enums<"app_role">;

/* ---------- Actor ---------- */

/**
 * §8's "Who" column names two different kinds of thing: roles (HR_ADMIN, MD) and
 * relationships (the evaluatee, the lead). Both are represented, because a
 * role check alone would let any HOD in the company return any employee's form.
 */
export type ActorRule = AppRole | "EVALUATEE" | "LEAD" | "SYSTEM";

export type TransitionActor = {
  profileId: string;
  roles: readonly AppRole[];
  /** Set only by cron / server jobs — §8's "HR_ADMIN or system" on the close step. */
  isSystem?: boolean;
};

/**
 * §8: returns and re-opens must explain themselves.
 *
 * It lives HERE, in the pure module, rather than beside the guard that enforces
 * it — `guards.ts` reaches into `getEvaluationForm` and is therefore
 * `server-only`, so a dialog that wants to disable its button below the minimum
 * could not import the number and would hardcode a second copy of it. Two copies
 * of a threshold is how a form starts accepting what the server then rejects.
 */
export const MIN_REASON_LENGTH = 10;

export type GuardName =
  | "requireLaunchReady"
  | "requireAllRequiredAnswered"
  | "requireReason"
  | "requireDecisions"
  | "requireDisclosureReady"
  | "requireBothLayersIn"
  | "requireSalaryComplete"
  | "requireEvaluationCycle"
  | "requireInterviewRecord";

export type TransitionDefinition = {
  from: EvaluationStatus;
  to: EvaluationStatus;
  /** The actor needs to satisfy ONE of these. */
  actors: readonly ActorRule[];
  guards: readonly GuardName[];
  /** Layer submitted and locked by this move (§8 locking rule). */
  locks?: RatingLayer;
  /** Layer unlocked and cleared of submitted_at by this move. */
  unlocks?: RatingLayer;
  /** Returns carry a reason and are shown differently to the recipient. */
  isReturn: boolean;
  /** Written to audit_log.action. */
  action: string;
  /** Human-readable, for error messages and buttons. */
  label: string;
};

/* ---------- The table ---------- */

/**
 * CLAUDE.md §8, transcribed row for row. **This table is exhaustive**: a
 * transition not listed here is rejected server-side, which is why there is no
 * "else" branch anywhere in the state machine.
 *
 * Note there is no MD_FINALIZED → LEAD_REVIEWED and no CLOSED → anything. Once
 * the MD has finalised, the only way onward is CLOSED; §17 forbids deleting a
 * submitted layer, so correcting a finalised evaluation is a business decision
 * that would need its own row here and its own audit action.
 */
export const TRANSITIONS: readonly TransitionDefinition[] = [
  {
    from: "DRAFT",
    to: "OPEN",
    // AMEND-2 reversed the HR/MD merge: config and launch are HR's, and the MD
    // reads them. The SQL half of this table says the same thing.
    actors: ["HR_ADMIN"],
    guards: ["requireLaunchReady"],
    isReturn: false,
    action: "evaluation.launch",
    label: "Launch",
  },

  /* -- The two layer submissions. Both are OPEN → OPEN: submitting a layer
        locks THAT layer and does not move the record, which is what makes the
        two sides independent. They are told apart by `locks`. -- */
  {
    from: "OPEN",
    to: "OPEN",
    actors: ["EVALUATEE"],
    guards: ["requireAllRequiredAnswered"],
    locks: "SELF",
    isReturn: false,
    action: "evaluation.self_submit",
    label: "Submit self-evaluation",
  },
  {
    from: "OPEN",
    to: "OPEN",
    actors: ["LEAD"],
    guards: ["requireAllRequiredAnswered"],
    locks: "LEAD",
    isReturn: false,
    action: "evaluation.lead_submit",
    label: "Submit review",
  },

  {
    from: "OPEN",
    to: "PENDING_HR_REVIEW",
    // Raised by the system the moment both timestamps are set. Nobody presses
    // a button for this: the second submitter would otherwise be doing an
    // administrative act they cannot see the reason for.
    actors: ["SYSTEM"],
    guards: ["requireBothLayersIn"],
    isReturn: false,
    action: "evaluation.both_layers_in",
    label: "Send to HR review",
  },
  {
    from: "OPEN",
    to: "PENDING_HR_REVIEW",
    // HR advancing past a side that never came in. §8 requires the reason AND
    // that the missing layer be MARKED skipped, so it is never mistaken later
    // for one that was filled in.
    actors: ["HR_ADMIN"],
    guards: ["requireReason"],
    isReturn: false,
    action: "evaluation.advance_with_skip",
    label: "Advance without a submission",
  },

  {
    from: "PENDING_HR_REVIEW",
    to: "OPEN",
    actors: ["HR_ADMIN"],
    guards: ["requireReason"],
    // WHICH layers unlock is `returned_to`, not this field: §8 lets HR return
    // SELF, LEAD or BOTH, and a single `unlocks` cannot say "both". The state
    // machine reads the option and passes the layers to the RPC.
    isReturn: true,
    action: "evaluation.hr_return",
    label: "Return for changes",
  },
  {
    from: "PENDING_HR_REVIEW",
    to: "HR_APPROVED",
    actors: ["HR_ADMIN"],
    guards: ["requireSalaryComplete"],
    isReturn: false,
    action: "evaluation.hr_approve",
    label: "Send to the MD",
  },
  {
    /* ⚠ DIVERGES FROM §8, AT THE OWNER'S EXPLICIT INSTRUCTION (0039).
       §8 has one path to CLOSED and it runs through MD_REVIEWED. HR may now
       finish an EVALUATION outright, having discussed it with the MD in person
       rather than in the product. Sending to the MD remains available and
       unchanged; it is now a choice rather than a step.

       `requireEvaluationCycle` is not a formality. AMEND-2 un-merged HR and MD
       so that a PAY decision has a second pair of eyes, and AMEND-1 recorded
       what merging them cost. HR proposing and HR approving the same increment
       is the thing that separation exists to prevent — so this row refuses an
       INCREMENT, and 0039 refuses it again in SQL, because a guard that lives
       only in TypeScript is not a guard (P5-1).

       To restore §8: delete this row, and revert 0039. */
    from: "PENDING_HR_REVIEW",
    to: "CLOSED",
    actors: ["HR_ADMIN"],
    guards: ["requireEvaluationCycle", "requireDisclosureReady"],
    isReturn: false,
    action: "evaluation.hr_close",
    label: "Approve and complete",
  },

  /* -- The MD's rows. HR cannot stand in for the MD on any of them: that
        separation IS the second pair of eyes AMEND-2 restored. -- */
  {
    from: "HR_APPROVED",
    to: "PENDING_HR_REVIEW",
    actors: ["MD"],
    guards: ["requireReason"],
    isReturn: true,
    action: "evaluation.md_return_to_hr",
    label: "Send back to HR",
  },
  {
    /* ⚠ DIVERGES FROM §8, AT THE OWNER'S EXPLICIT INSTRUCTION.
       The constitution's guard on this row reads "MD has read the report;
       remarks recorded", and this row carried `requireMdRemarks` to enforce it.
       The MD may now approve without writing anything.

       The cost, stated once so it is on the record: the remark was the only
       part of the MD's reading that survived the click. Approving in silence
       leaves `md_reviewed_by` and `md_reviewed_at` as the whole trace — who and
       when, never why. §12's audit row still records the transition, so nothing
       becomes unaccountable; it becomes unexplained.

       To restore: put "requireMdRemarks" back here, and back in guards.ts. */
    from: "HR_APPROVED",
    to: "MD_REVIEWED",
    /* -- HR added (0056), at the owner's instruction. HR may record the MD's
          review so they can carry an increment through to close on their own.
          This is the second pair of eyes on a pay decision being removed —
          AMEND-2 restored it deliberately after AMEND-1 took it away, and it is
          going again knowingly. The SQL half moves in the same change (P5-1),
          and `audit_log` still records who actually pressed it. -- */
    actors: ["HR_ADMIN", "MD"],
    guards: [],
    isReturn: false,
    action: "evaluation.md_review",
    label: "Record review",
  },
  {
    from: "MD_REVIEWED",
    to: "HR_APPROVED",
    actors: ["MD"],
    guards: ["requireReason"],
    isReturn: true,
    action: "evaluation.md_correct",
    label: "Correct before the interview",
  },

  {
    from: "MD_REVIEWED",
    to: "CLOSED",
    // §8: EVALUATION cycles only. NOT ENFORCED — `evaluation_cycles` has no
    // `cycle_type` column yet (AMEND-2 introduced the idea, no migration has
    // added it, and §0.4 forbids inventing one). Both endings are reachable
    // until it exists.
    actors: ["HR_ADMIN", "SYSTEM"],
    guards: ["requireDisclosureReady"],
    isReturn: false,
    action: "evaluation.close",
    label: "Close",
  },
  {
    from: "MD_REVIEWED",
    to: "INTERVIEW_DONE",
    // §8: INCREMENT cycles only. Same caveat as above.
    actors: ["HR_ADMIN", "MD"],
    guards: ["requireInterviewRecord"],
    isReturn: false,
    action: "evaluation.interview_done",
    label: "Record the interview",
  },
  {
    from: "INTERVIEW_DONE",
    to: "CLOSED",
    /* -- MD added (0045). `confirm_increment` is granted to HR or the MD and
          runs MD_REVIEWED -> INTERVIEW_DONE -> CLOSED atomically, so the MD was
          admitted to the first half and refused the second — the call could
          never complete for them. A role allowed to begin an indivisible
          operation has to be allowed to finish it. The SQL half moves in the
          same change (P5-1). -- */
    actors: ["HR_ADMIN", "MD", "SYSTEM"],
    guards: ["requireDisclosureReady"],
    isReturn: false,
    action: "evaluation.close_after_interview",
    label: "Close",
  },
] as const;

/**
 * `from` and `to` alone no longer identify a row: the two layer submissions are
 * both OPEN → OPEN, and so are the two ways into PENDING_HR_REVIEW. The
 * discriminator is the layer being locked, or the actor kind where there is no
 * layer. Callers that omit it get the first match, which is only safe where the
 * pair is unique.
 */
export function findTransition(
  from: EvaluationStatus,
  to: EvaluationStatus,
  discriminator?: { locks?: RatingLayer; bySystem?: boolean },
): TransitionDefinition | undefined {
  const candidates = TRANSITIONS.filter((t) => t.from === from && t.to === to);
  if (candidates.length <= 1) return candidates[0];

  if (discriminator?.locks) {
    return candidates.find((t) => t.locks === discriminator.locks);
  }
  if (discriminator?.bySystem !== undefined) {
    return candidates.find((t) =>
      discriminator.bySystem ? t.actors.includes("SYSTEM") : !t.actors.includes("SYSTEM"),
    );
  }
  return candidates[0];
}

/** Every move legal from this status, whoever the actor is. */
export function transitionsFrom(from: EvaluationStatus): readonly TransitionDefinition[] {
  return TRANSITIONS.filter((t) => t.from === from);
}

/* ---------- canTransition ---------- */

export type TransitionDenialCode =
  | "UNKNOWN_TRANSITION"
  | "WRONG_STATUS"
  | "ACTOR_NOT_PERMITTED";

export type CanTransitionResult =
  | { allowed: true; transition: TransitionDefinition }
  | { allowed: false; code: TransitionDenialCode; reason: string };

/** The subset of an evaluation the static checks need. */
export type TransitionSubject = {
  id: string;
  status: EvaluationStatus;
  evaluatee_id: string;
  lead_id: string | null;
};

function actorSatisfies(rule: ActorRule, evaluation: TransitionSubject, actor: TransitionActor) {
  switch (rule) {
    case "EVALUATEE":
      return actor.profileId === evaluation.evaluatee_id;
    case "LEAD":
      // The assigned lead for THIS evaluation, copied at launch — not whoever
      // currently happens to hold the HOD role.
      return evaluation.lead_id !== null && actor.profileId === evaluation.lead_id;
    case "SYSTEM":
      return actor.isSystem === true;
    default:
      return actor.roles.includes(rule);
  }
}

function describeActors(rules: readonly ActorRule[]): string {
  const words = rules.map((rule) => {
    switch (rule) {
      case "EVALUATEE":
        return "the employee being evaluated";
      case "LEAD":
        return "their reporting lead";
      case "SYSTEM":
        return "the system";
      case "HR_ADMIN":
        return "HR";
      case "MD":
        return "the MD";
      default:
        return rule;
    }
  });

  if (words.length === 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} or ${words.at(-1)}`;
}

/**
 * The **static** half of the check: is this move in the table, is the evaluation
 * actually in the from-status, and is this actor one of the permitted ones.
 *
 * Synchronous and side-effect free, so the UI can call it to decide whether to
 * render a button. It deliberately does NOT run the guards — those need the
 * assembled form and the answers. `transition()` runs both halves; never treat
 * an `allowed: true` from here as authorisation to write.
 */
export function canTransition(
  evaluation: TransitionSubject,
  to: EvaluationStatus,
  actor: TransitionActor,
  /** Picks the row where `from` and `to` do not — see `findTransition`. */
  discriminator?: { locks?: RatingLayer; bySystem?: boolean },
): CanTransitionResult {
  const transition = findTransition(evaluation.status, to, discriminator);

  if (!transition) {
    // Distinguish "never legal" from "not legal yet", because they need
    // different messages: one is a bug, the other is a workflow state.
    const everLegal = TRANSITIONS.some((t) => t.to === to);
    return everLegal
      ? {
          allowed: false,
          code: "WRONG_STATUS",
          reason: `This evaluation is at ${evaluation.status}, and cannot move to ${to} from there.`,
        }
      : {
          allowed: false,
          code: "UNKNOWN_TRANSITION",
          reason: `${evaluation.status} → ${to} is not a transition this system allows.`,
        };
  }

  const permitted = transition.actors.some((rule) => actorSatisfies(rule, evaluation, actor));
  if (!permitted) {
    return {
      allowed: false,
      code: "ACTOR_NOT_PERMITTED",
      reason: `Only ${describeActors(transition.actors)} can ${transition.label.toLowerCase()}.`,
    };
  }

  return { allowed: true, transition };
}
