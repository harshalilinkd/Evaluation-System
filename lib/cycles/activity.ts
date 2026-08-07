/** The activity log for one cycle. Reads audit_log; writes nothing, ever. */

import "server-only";

import { cycleError, type CycleResult } from "@/lib/cycles/schema";
import { createClient } from "@/lib/supabase/server";

export type ActivityEntry = {
  id: string;
  /** ISO. §0.10 formatting happens on the screen, not here. */
  at: string;
  /** The raw `audit_log.action`, kept so a screen can group or test on it. */
  action: string;
  /**
   * ONE PLAIN SENTENCE, naming who did what to whom.
   *
   * This replaced a label, a subject, an actor and a raw status pair rendered
   * as four separate fragments — "Employee submitted their self-evaluation ·
   * Test Employee / Test Employee · OPEN → OPEN". Every piece was accurate and
   * the line was not readable: the name appeared twice, and the two statuses
   * were enum values, which §13.5 keeps off every user-facing surface.
   *
   * A person should understand the whole history by reading down this column,
   * so each row is a sentence rather than a record laid out flat.
   */
  sentence: string;
  /** §8 requires a reason on every return, and it is shown verbatim. */
  reason: string | null;
};

/**
 * WHAT THIS IS FOR.
 *
 * §12 has required an audit row for every status change, every decision, every
 * token issue and every role change since P4 — and until now nothing in the
 * product displayed a single one of them. The trail existed and was unreadable
 * without a SQL console, which for the person accountable for a cycle is the
 * same as it not existing.
 *
 * READ-ONLY BY CONSTRUCTION. `audit_log` has no UPDATE or DELETE policy for
 * anyone (P5-9) and an append-only trigger on top (P4-4), so there is nothing
 * this module could offer even if it tried. It selects and formats.
 *
 * WHO CAN SEE IT: 0005 gives audit SELECT to HR and the MD; 0013 adds a lead
 * for their own reports. This runs through the authenticated client, so RLS
 * decides — a caller who may not read a row simply does not get it, and the
 * screen is guarded to administrators on top as the clean exit (P16-9).
 */

/* -- One sentence per action. --

      The keys are the literals `apply_evaluation_transition`, `log_admin_action`
      and 0038's trigger actually write; grep those three for the full set. Note
      the bare `both_layers_in` — 0038 writes it WITHOUT the `evaluation.`
      prefix every other row uses, which is why it was showing on screen as the
      raw slug "both layers in". Both spellings are mapped rather than the
      migration being edited: §0.8 says an applied migration is never touched,
      and a display map is the right place to absorb an inconsistency in stored
      data.

      Pronouns are they/them throughout. Nobody's are recorded, and a name does
      not tell you them.

      An unmapped action falls back to a readable slug rather than rendering
      blank, so an action added later shows up as SOMETHING — a gap in a history
      is worse than an ugly line in one. */
type Names = { actor: string; subject: string; theirSubject: string };

const SENTENCES: Record<string, (n: Names) => string> = {
  /* -- The cycle itself -- */
  "cycle.created": (n) => `${n.actor} created this cycle.`,
  "cycle.launched": (n) => `${n.actor} launched the cycle. Everyone's questions are now frozen.`,
  "cycle.updated": (n) => `${n.actor} changed the cycle setup.`,
  "cycle.binned": (n) => `${n.actor} moved the cycle to the recycle bin.`,
  "cycle.archived": (n) => `${n.actor} moved the cycle to the recycle bin.`,
  "cycle.restored": (n) => `${n.actor} restored the cycle from the recycle bin.`,
  "cycle.dates_extended": (n) => `${n.actor} extended a deadline on the cycle.`,
  "cycle.deleted_forever": (n) => `${n.actor} deleted the cycle permanently.`,

  /* -- Opening -- */
  "evaluation.launch": (n) => `${n.subject}'s evaluation opened. Both forms went live at once.`,
  "evaluation.launched": (n) => `${n.subject}'s evaluation opened. Both forms went live at once.`,
  "evaluation.milestone_opened": (n) => `${n.subject}'s milestone evaluation was opened.`,

  /* -- The two sides rating, blind to each other -- */
  "evaluation.self_submit": (n) => `${n.subject} submitted their own self-evaluation.`,
  "evaluation.lead_submit": (n) => `${n.actor} submitted their review of ${n.subject}.`,
  both_layers_in: (n) =>
    `Both sides were in, so ${n.theirSubject} report went to HR for review automatically.`,
  "evaluation.both_layers_in": (n) =>
    `Both sides were in, so ${n.theirSubject} report went to HR for review automatically.`,
  "evaluation.advance_with_skip": (n) =>
    `${n.actor} sent ${n.theirSubject} report to HR without one of the two submissions.`,

  /* -- HR -- */
  "evaluation.hr_return": (n) => `${n.actor} returned ${n.theirSubject} form for changes.`,
  "evaluation.hr_approve": (n) => `${n.actor} sent ${n.theirSubject} report to the MD.`,
  "evaluation.hr_close": (n) =>
    `${n.actor} approved ${n.theirSubject} evaluation and completed it, without sending it to the MD.`,

  /* -- The MD -- */
  "evaluation.md_review": (n) => `${n.actor} read ${n.theirSubject} report and approved it.`,
  "evaluation.md_return_to_hr": (n) => `${n.actor} sent ${n.theirSubject} report back to HR.`,
  "evaluation.md_correct": (n) => `${n.actor} reopened ${n.theirSubject} report for a correction.`,
  "evaluation.md_finalize": (n) => `${n.actor} finalised ${n.theirSubject} report.`,
  "evaluation.md_override": (n) => `${n.actor} changed a score on ${n.theirSubject} report.`,

  /* -- Endings -- */
  "evaluation.close": (n) => `${n.subject}'s evaluation was closed.`,
  "evaluation.interview_done": (n) => `${n.actor} recorded the interview with ${n.subject}.`,
  "evaluation.close_after_interview": (n) =>
    `${n.subject}'s increment was confirmed and the evaluation closed.`,
  "evaluation.closed_after_interview": (n) =>
    `${n.subject}'s increment was confirmed and the evaluation closed.`,

  /* -- Housekeeping -- */
  "evaluation.lead_reassigned": (n) => `${n.actor} changed who reviews ${n.subject}.`,
  "evaluation.excluded": (n) => `${n.actor} withdrew ${n.subject} from the cycle.`,
  "salary.recorded": (n) => `${n.actor} recorded a pay change for ${n.subject}.`,

  /* -- Invite links (§10) -- */
  "invite.issued": (n) => `An invite link was sent to ${n.subject}.`,
  "invite.used": (n) => `${n.subject} opened their invite link and signed in.`,
  "invite.consumed": (n) => `${n.subject} opened their invite link and signed in.`,
  "invite.attempt": (n) => `${n.theirSubject} invite link was opened.`,
  "invite.wrong_recipient": (n) => `Somebody else tried to open ${n.theirSubject} invite link.`,
  "invite.rate_limited": (n) =>
    `${n.theirSubject} invite link was locked after too many attempts.`,
};

/** "Priya" -> "Priya's". Handles a name already ending in s. */
function possessive(name: string): string {
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}

function sentenceFor(action: string, names: Names): string {
  const build = SENTENCES[action];
  if (build) return build(names);

  /* Unmapped: say who did what in the plainest way the slug allows, rather
     than rendering nothing. "evaluation.some_new_thing" -> "Harshali: some new
     thing (Test Employee)." */
  const readable = action.replace(/^[a-z]+\./, "").replace(/_/g, " ");
  return `${names.actor}: ${readable} · ${names.subject}`;
}

/**
 * Everything that has happened in this cycle, newest first.
 *
 * Two entity kinds are gathered: rows about the CYCLE itself, and rows about
 * each EVALUATION in it. They are one history to the person reading — "the
 * cycle launched, then Priya submitted, then HR returned it" — even though
 * §12 files them against different entities.
 */
export async function getCycleActivity(
  cycleId: string,
  limit = 300,
): Promise<CycleResult<ActivityEntry[]>> {
  const supabase = await createClient();

  const { data: evaluations, error: evaluationError } = await supabase
    .from("evaluations")
    .select("id, evaluatee_id")
    .eq("cycle_id", cycleId);

  if (evaluationError) {
    return cycleError("QUERY_FAILED", `Could not read this cycle: ${evaluationError.message}`);
  }

  const evaluationIds = (evaluations ?? []).map((e) => e.id);
  const entityIds = [cycleId, ...evaluationIds];

  const { data: rows, error } = await supabase
    .from("audit_log")
    .select("id, actor_id, entity, entity_id, action, from_status, to_status, reason, created_at")
    .in("entity_id", entityIds)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return cycleError("QUERY_FAILED", `Could not read the activity log: ${error.message}`);
  if (!rows || rows.length === 0) return { ok: true, data: [] };

  /* -- Names for the two id columns. Two lookups for the whole page rather than
        one per row: three hundred entries would otherwise be six hundred round
        trips to render one list. -- */
  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter((v): v is string => Boolean(v)))];
  const subjectIds = [
    ...new Set((evaluations ?? []).map((e) => e.evaluatee_id).filter(Boolean)),
  ];

  const { data: people } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", [...new Set([...actorIds, ...subjectIds])].length > 0
      ? [...new Set([...actorIds, ...subjectIds])]
      : ["00000000-0000-0000-0000-000000000000"]);

  const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name] as const));
  const evaluateeOf = new Map((evaluations ?? []).map((e) => [e.id, e.evaluatee_id] as const));

  const { data: cycle } = await supabase
    .from("evaluation_cycles")
    .select("name")
    .eq("id", cycleId)
    .maybeSingle();

  return {
    ok: true,
    data: rows.map((row) => {
      /* -- A null actor is the SYSTEM, not a gap.
            §8 raises OPEN → PENDING_HR_REVIEW with no actor on purpose (F11-4):
            naming the employee who happened to submit second would attribute a
            system move to somebody who did not make it. "The system" is the
            honest rendering; a blank reads as data loss. -- */
      const actor = row.actor_id
        ? (nameOf.get(row.actor_id) ?? "Somebody since removed")
        : "The system";

      const subject =
        row.entity === "evaluation"
          ? (nameOf.get(evaluateeOf.get(row.entity_id) ?? "") ?? "this employee")
          : (cycle?.name ?? "this cycle");

      return {
        id: row.id,
        at: row.created_at,
        action: row.action,
        sentence: sentenceFor(row.action, {
          actor,
          subject,
          theirSubject: possessive(subject),
        }),
        reason: row.reason,
      };
    }),
  };
}
