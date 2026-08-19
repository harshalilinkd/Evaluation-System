/** The launch payload builder. CLAUDE.md §5 — this is where the snapshot is decided. */

import "server-only";

import { cycleError, type CycleResult } from "@/lib/cycles/schema";
import { loadCycleParticipants, type ParticipantSnapshot } from "@/lib/cycles/validate";
import { generateToken, hashToken } from "@/lib/auth/invite-token";
import { assembleForDepartment } from "@/lib/forms/assemble";
import type { AssembledQuestion } from "@/lib/forms/types";
import type { Enums, Json } from "@/types/database";

/** What launch_cycle() receives for one person. Snake_case: it is read by SQL. */
export type SnapshotRow = {
  question_id: string;
  text: string;
  help_text: string | null;
  section: Enums<"question_section">;
  response_type: Enums<"response_type">;
  answered_by: Enums<"answered_by">;
  is_required: boolean;
  min_value: number | null;
  max_value: number | null;
  depends_on: string | null;
  depends_value: string | null;
  options: Json;
  sort_order: number;
};

export type LaunchPayloadItem = {
  evaluation_id: string;
  questions: SnapshotRow[];
  /**
   * The two invite links, as SHA-256 only (§10).
   *
   * P10-REV item 14e: both people are recipients from launch, so both tokens
   * are part of the same all-or-nothing transaction. The PLAINTEXT never enters
   * this payload — it stays in `links` below, in memory, for the dispatch that
   * runs after the commit. A token in a result set is a token in a log.
   */
  channel: string;
  self_token_hash: string;
  lead_token_hash: string | null;
  /* -- The SECOND manager's link, where the evaluatee carries one (0083/0084).
        Its own token, not a copy of the lead's: §10 scopes a token to
        (evaluation, LAYER, channel), so reusing the lead's would open the LEAD
        form for the coordinator — not a wrong page but a blindness breach
        (F12-2 made the same point about the email link). -- */
  co_lead_token_hash: string | null;
};

/** The plaintext links, kept beside the payload and never sent to SQL. */
export type LaunchLink = {
  evaluationId: string;
  selfToken: string;
  /** Null when the evaluation has no lead — the launch will refuse it anyway. */
  leadToken: string | null;
  /** Null for almost everybody: only a person with a second reviewer has one. */
  coLeadToken: string | null;
};

export type LaunchPlan = {
  payload: LaunchPayloadItem[];
  participants: ParticipantSnapshot[];
  links: LaunchLink[];
  /** For the confirmation dialog and the progress readout. */
  totalQuestions: number;
};

export function toSnapshotRow(question: AssembledQuestion, index: number): SnapshotRow {
  return {
    question_id: question.questionId,
    text: question.text,
    help_text: question.helpText,
    section: question.section,
    response_type: question.responseType,
    answered_by: question.answeredBy,
    is_required: question.isRequired,
    min_value: question.minValue,
    max_value: question.maxValue,
    depends_on: question.dependsOn,
    depends_value: question.dependsValue,
    // Only the select types carry choices. Storing [] for a textarea would
    // suggest to a future reader that options were expected and are missing.
    options: question.options ? (JSON.parse(JSON.stringify(question.options)) as Json) : null,
    // Sequential across the whole merged form in steps of 10, matching
    // snapshot.ts exactly — reading the snapshot back by sort_order alone must
    // reproduce the order the employee saw, and the two writers must not
    // disagree about what that order is.
    sort_order: (index + 1) * 10,
  };
}

/**
 * Assemble every participant's frozen question list, without writing anything.
 *
 * This is the read half of the launch. It runs the SAME assembleForDepartment()
 * that the department preview (P9) and the employee's real form (P12) run —
 * there is one assembly algorithm in this codebase and this is a caller of it,
 * not a copy. A snapshot is frozen for years; a second assembly path would
 * eventually disagree with the preview HR approved, and nobody would find out
 * until the cycle was live.
 *
 * ASSEMBLY IS CACHED PER (department, track), NOT PER PERSON.
 *
 * Every staff employee answers the same form and only Job Specific Skills
 * varies by department, so two people in Accounts assemble identically by
 * construction. Caching turns 47 people across 6 departments into 6 assemblies
 * instead of 47 — and, more importantly, guarantees that everyone in a
 * department freezes the *identical* question set even if somebody edits the
 * bank while the loop is running.
 */
export async function buildLaunchPlan(
  cycleId: string,
  cycle: { cycleType: "EVALUATION" | "INCREMENT"; cycleKind: "BATCH" | "ROLLING" },
): Promise<CycleResult<LaunchPlan>> {
  const participantsResult = await loadCycleParticipants(cycleId);
  if (!participantsResult.ok) return participantsResult;

  const participants = participantsResult.data;
  // A ROLLING cycle opens with nobody in it on purpose (item 5): people are
  // added when their date arrives. Only a BATCH cycle needs a roster now.
  if (participants.length === 0 && cycle.cycleKind === "BATCH") {
    return cycleError("NO_PARTICIPANTS", "This cycle has nobody in it. Add people before launching.");
  }

  const cache = new Map<string, SnapshotRow[]>();
  const payload: LaunchPayloadItem[] = [];
  const links: LaunchLink[] = [];
  let totalQuestions = 0;

  for (const person of participants) {
    // Keyed by cycle type as well: an increment cycle assembles a different set
    // (§6's cycle_scope), and reusing an evaluation cycle's cache would freeze
    // the wrong questions.
    const key = `${person.departmentId ?? "none"}:${person.track}:${cycle.cycleType}`;
    let rows = cache.get(key);

    if (!rows) {
      const assembled = await assembleForDepartment(person.departmentId, person.track, cycle.cycleType);
      if (!assembled.ok) {
        // Named, because P10 requires the failure to say which person and why.
        return cycleError(
          "ASSEMBLY_FAILED",
          `Could not build a form for ${person.name}: ${assembled.error.message}`,
        );
      }

      if (assembled.data.length === 0) {
        return cycleError(
          "ASSEMBLY_EMPTY",
          `No questions could be assembled for ${person.name}${
            person.departmentName ? ` (${person.departmentName})` : ""
          }. Check the question bank and their department mapping.`,
        );
      }

      rows = assembled.data.map(toSnapshotRow);
      cache.set(key, rows);
    }

    const selfToken = generateToken();
    const leadToken = person.leadId ? generateToken() : null;
    // Minted here even though 0084 decides whether it is USED: the plaintext
    // must never enter the payload (PR-6), so it has to be generated on this
    // side of the call whatever SQL then does with the hash. An unused token
    // is one unread row; the alternative is returning a live secret from a
    // function, and from there into anything that logs a result set.
    const coLeadToken = person.coLeadId ? generateToken() : null;

    payload.push({
      evaluation_id: person.evaluationId,
      questions: rows,
      channel: "WHATSAPP",
      self_token_hash: hashToken(selfToken),
      lead_token_hash: leadToken ? hashToken(leadToken) : null,
      co_lead_token_hash: coLeadToken ? hashToken(coLeadToken) : null,
    });
    links.push({ evaluationId: person.evaluationId, selfToken, leadToken, coLeadToken });
    totalQuestions += rows.length;
  }

  return { ok: true, data: { payload, participants, links, totalQuestions } };
}
