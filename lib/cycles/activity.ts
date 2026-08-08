/** The activity log for one cycle. Reads audit_log; writes nothing, ever. */

import "server-only";

import { cycleError, type CycleResult } from "@/lib/cycles/schema";
import { createClient } from "@/lib/supabase/server";

export type ActivityEntry = {
  id: string;
  /**
   * How many consecutive identical events this row stands for. 1 normally.
   *
   * A cycle is autosaved while it is being set up, and each save that genuinely
   * changed something is a real audit row (§12) that can never be deleted —
   * `audit_log` has no DELETE policy for anyone, deliberately. So the repetition
   * is collapsed HERE, where it is a display concern, rather than by not
   * recording history.
   */
  repeated: number;
  /** When the run of identical events STARTED. Equal to `at` when repeated is 1. */
  firstAt: string;
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
type Names = {
  actor: string;
  subject: string;
  theirSubject: string;
  /** How many evaluations the launch opened. 0 outside the launch sentence. */
  opened: number;
};

/* -- NOT SHOWN, though every one is still in `audit_log`. --

      `cycle.updated` is the wizard autosaving. `updateCycle` picks its action
      by status — `cycle.status === "ACTIVE" ? "cycle.dates_extended" :
      "cycle.updated"` — so this literal is written ONLY while the cycle is a
      DRAFT nobody can see. It is setup churn: the record of somebody typing a
      period label before the cycle existed for anybody. Six of those lines
      between "created" and "launched" bury the two events the panel is opened
      to find, and "changed 4 settings on the cycle" does not even say which.

      The meaningful edit — a deadline moved AFTER launch, when people are
      already working to it — is `cycle.dates_extended`, a different action that
      is untouched by this and now names the field it moved.

      §12 is not weakened. `audit_log` has no DELETE policy for anyone and an
      append-only trigger over that; every row is still there for anybody with a
      SQL console and the standing to read it. This is a display filter, the
      same call `collapseRuns` makes below. */
const HIDDEN_ACTIONS = new Set(["cycle.updated"]);

/* -- Folded INTO the launch line rather than listed beside it. --

      A launch writes one `cycle.launched` and one `evaluation.launch` per
      participant. Two rows saying the same thing is noise at one participant;
      at forty-seven it is forty-eight rows, and `collapseRuns` cannot help
      because each names a different person and so renders a different sentence.

      The count is the only thing those rows carry that the launch line does
      not, so the count moves up and the rows come out. A milestone evaluation
      opened later is `evaluation.milestone_opened` — a separate action, still
      shown individually, because that genuinely is its own event. */
const LAUNCH_OPENED_ACTIONS = new Set(["evaluation.launch", "evaluation.launched"]);

const SENTENCES: Record<string, (n: Names) => string> = {
  /* -- The cycle itself -- */
  "cycle.created": (n) => `${n.actor} created this cycle.`,
  /* One sentence, not two rows. "Both forms went live at once" is dropped
     rather than merged: it restates blind parallel rating (§1), which is how
     every cycle in this product works, so it is a property of the system and
     not news about this launch. */
  "cycle.launched": (n) =>
    n.opened > 0
      ? `${n.actor} launched the cycle — ${n.opened} ${n.opened === 1 ? "evaluation" : "evaluations"} opened, questions frozen.`
      : `${n.actor} launched the cycle. Everyone's questions are now frozen.`,
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
  "evaluation.hr_advance": (n) =>
    `${n.actor} sent ${n.theirSubject} report to HR without one of the two submissions.`,

  /* -- HR -- */
  "evaluation.hr_return": (n) => `${n.actor} returned ${n.theirSubject} form for changes.`,
  "evaluation.hr_approve": (n) => `${n.actor} sent ${n.theirSubject} report to the MD.`,
  "evaluation.hr_close": (n) =>
    `${n.actor} approved ${n.theirSubject} evaluation and completed it, without sending it to the MD.`,

  /* -- The MD -- */
  "evaluation.md_review": (n) => `${n.actor} read ${n.theirSubject} report and approved it.`,
  "evaluation.md_return_to_hr": (n) => `${n.actor} sent ${n.theirSubject} report back to HR.`,
  "evaluation.md_return": (n) => `${n.actor} sent ${n.theirSubject} report back to HR.`,
  "evaluation.md_send_back": (n) => `${n.actor} sent ${n.theirSubject} report back to HR.`,
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

/* -- Which fields a cycle edit touched, in words HR uses.
      "changed the cycle setup" nine times says nothing about what moved.
      `updateCycle` now records a before/after diff, so the row can name the
      thing rather than the table. Unlisted keys are skipped rather than
      slugified: a column name in a history is worse than a slightly vaguer
      sentence. -- */
const FIELD_WORDS: Record<string, string> = {
  name: "the name",
  period_label: "the period",
  starts_on: "the start date",
  self_due_on: "the employee deadline",
  lead_due_on: "the lead deadline",
  md_due_on: "the final deadline",
  variance_threshold: "the gap threshold",
  disclosure: "what employees are shown",
  cycle_type: "the cycle type",
  cycle_kind: "how people join",
  default_self_days: "the default employee window",
  default_lead_days: "the default lead window",
};

function changedFields(diff: unknown): string[] {
  if (!diff || typeof diff !== "object") return [];
  const after = (diff as { after?: unknown }).after;
  if (!after || typeof after !== "object") return [];
  return Object.keys(after as Record<string, unknown>)
    .map((k) => FIELD_WORDS[k])
    .filter((w): w is string => Boolean(w));
}

/** "a, b and c" — an Oxford-less list, because these are read aloud in meetings. */
function listOf(items: string[]): string {
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function sentenceFor(action: string, names: Names, diff?: unknown): string {
  /* -- Name the field, on the edit that survives to the screen.
        `cycle.dates_extended` is the one an ACTIVE cycle writes — somebody has
        moved a deadline that people are already working to, which is worth a
        line and worth saying WHICH deadline. "extended a deadline on the cycle"
        made the reader open the cycle to find out.

        The same naming used to be spent on `cycle.updated`, which is now hidden
        outright: it is pre-launch wizard churn, and naming a field on a row
        nobody should be reading only made the noise more specific. Falls
        through to the generic sentence when the diff predates this or holds
        only fields not worth naming. -- */
  if (action === "cycle.dates_extended") {
    const fields = changedFields(diff);
    if (fields.length > 0 && fields.length <= 3) {
      return `${names.actor} moved ${listOf(fields)}.`;
    }
  }

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
    /* -- `diff` is here so a cycle edit can name what it changed. Written out
          in full, never concatenated: supabase-js infers the row type from this
          string at compile time and degrades everything to GenericStringError
          on any string it cannot statically parse (P3-11). -- */
    .select(
      "id, actor_id, entity, entity_id, action, from_status, to_status, reason, diff, created_at",
    )
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

  /* -- How many evaluations this launch opened, counted before anything is
        rendered so the launch line can carry the figure the suppressed rows
        were carrying.

        Counted from the AUDIT rows, not from `evaluations`: the table holds
        every evaluation in the cycle including any milestone joiner added
        months later, and attributing those to the launch would be a number
        that grows after the event it describes. -- */
  const openedAtLaunch = rows.filter((r) => LAUNCH_OPENED_ACTIONS.has(r.action)).length;

  /* -- The per-evaluation launch rows are only folded away when there is a
        launch line to fold them INTO. Without that guard a cycle whose
        `cycle.launched` row is missing — an older cycle, a partial history, a
        `limit` that cut across the boundary — would lose the fact that it ever
        opened. A gap in a history is worse than a duplicated line in one. -- */
  const hasLaunchRow = rows.some((r) => r.action === "cycle.launched");

  const visible = rows.filter((row) => {
    if (HIDDEN_ACTIONS.has(row.action)) return false;
    if (hasLaunchRow && LAUNCH_OPENED_ACTIONS.has(row.action)) return false;
    return true;
  });

  return {
    ok: true,
    data: collapseRuns(visible.map((row) => {
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
        firstAt: row.created_at,
        repeated: 1,
        action: row.action,
        sentence: sentenceFor(
          row.action,
          { actor, subject, theirSubject: possessive(subject), opened: openedAtLaunch },
          row.diff,
        ),
        reason: row.reason,
      };
    })),
  };
}

/**
 * Fold a run of identical events into one row.
 *
 * Twelve lines of "changed the period and the gap threshold" is not a history —
 * it is the same fact twelve times, and it buries the four events somebody
 * actually opened this panel to find. One line saying it happened twelve times,
 * between 10:18 and 10:22, says everything the twelve said and leaves the
 * launches and submissions visible.
 *
 * CONSECUTIVE only. Two runs of the same edit either side of a launch stay two
 * rows, because what happened in between is the thing that makes them different
 * events rather than one.
 *
 * Nothing is discarded: every row is still in `audit_log`, which no policy
 * permits anybody to delete (§12). This changes what is SHOWN.
 */
function collapseRuns(entries: ActivityEntry[]): ActivityEntry[] {
  const out: ActivityEntry[] = [];

  for (const entry of entries) {
    const previous = out[out.length - 1];

    // Keyed on the rendered sentence, not the action: two edits that changed
    // different fields now read differently (P32 named the fields), and folding
    // them together would claim they were the same change.
    if (previous && previous.sentence === entry.sentence && previous.reason === entry.reason) {
      // Rows arrive newest first, so the one arriving is the EARLIER of the two.
      previous.repeated += 1;
      previous.firstAt = entry.at;
      continue;
    }

    out.push({ ...entry });
  }

  return out;
}
