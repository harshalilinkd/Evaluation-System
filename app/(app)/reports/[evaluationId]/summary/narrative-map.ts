/** Sorts the free-text answers into the blocks the executive summary shows. */

import type { NarrativeBlock } from "@/lib/reports/types";

export type Classified = {
  strengths: NarrativeBlock[];
  improvements: NarrativeBlock[];
  /** Short answers that read as a verdict — rendered as status tags. */
  verdicts: NarrativeBlock[];
  /** Everything that matched nothing. Rendered as-is, so nothing is lost. */
  other: NarrativeBlock[];
};

/**
 * MATCHING IS BEST-EFFORT AND THE FALLBACK IS THE POINT.
 *
 * §0.2 freezes question text, but HR authors new questions freely (P8), so any
 * classifier keyed on wording will meet a question it does not recognise. The
 * honest design is therefore not a cleverer matcher — it is a guaranteed
 * `other` bucket, so an unrecognised question is still shown rather than
 * silently dropped from a screen a pay decision is made on.
 *
 * A question is claimed once. Removing it from the pool as it is matched is
 * what stops "Main strengths" also appearing under "other".
 */
const STRENGTH = /\bstrength|\bdoing well|\bwhat went well|achievement|accomplish/i;
const IMPROVE = /\bimprove|\bdevelop|\bweak|\bconcern about performance|\bgap|\bchallenge|\bgrowth|\bgoal/i;

/** Short enough to be a verdict rather than prose. */
const VERDICT_MAX = 40;
const VERDICT_HINT = /promotion|risk|responsib|training|recommend|increment type/i;

/**
 * Verdicts the EXECUTIVE SUMMARY does not show, at the owner's instruction.
 *
 * "Any concern or risk about this person? — Yes" is a bare flag. On its own it
 * puts an unexplained accusation on the screen a pay conversation happens at,
 * and the detail that would qualify it lives in a separate follow-up question
 * that is frequently left blank.
 *
 * IT IS NOT REMOVED FROM THE RECORD. The full report's lead assessment lists
 * every question the manager answered, this one included — §12 and the whole
 * point of the detailed view. This suppresses it from the one-screen summary
 * only, which is a presentation decision rather than an editorial one.
 */
const SUMMARY_SUPPRESSED = /concern|risk/i;

export function classifyNarratives(blocks: NarrativeBlock[]): Classified {
  const pool = blocks.filter((b) => b.answer !== null && b.answer.trim().length > 0);

  const out: Classified = { strengths: [], improvements: [], verdicts: [], other: [] };
  const taken = new Set<NarrativeBlock>();

  /* -- Claimed and then dropped, deliberately.
        Marking them taken is what stops them falling through to `other` and
        reappearing as a paragraph two cards down — which is what a plain
        `filter` at the render site would have done. -- */
  for (const b of pool) {
    if (SUMMARY_SUPPRESSED.test(b.question)) taken.add(b);
  }

  const claim = (b: NarrativeBlock, into: NarrativeBlock[]) => {
    if (taken.has(b)) return;
    taken.add(b);
    into.push(b);
  };

  /* -- Verdicts FIRST. "Promotion recommendation" answered "Can be considered"
        matches nothing else, but "Any concern or risk about this person?" would
        otherwise be swallowed by the improvement pattern and rendered as a
        paragraph when it is a one-word answer. Shape before subject. -- */
  for (const b of pool) {
    const answer = (b.answer ?? "").trim();
    if (answer.length <= VERDICT_MAX && VERDICT_HINT.test(b.question)) claim(b, out.verdicts);
  }
  for (const b of pool) {
    if (!taken.has(b) && STRENGTH.test(b.question)) claim(b, out.strengths);
  }
  for (const b of pool) {
    if (!taken.has(b) && IMPROVE.test(b.question)) claim(b, out.improvements);
  }
  for (const b of pool) {
    if (!taken.has(b)) claim(b, out.other);
  }

  return out;
}

export type Tone = "good" | "watch" | "risk" | "neutral";

/**
 * What colour a verdict wears.
 *
 * Read from the ANSWER, never the question — "Any concern or risk?" is bad news
 * when answered Yes, and "Can this person handle more responsibility?" is good
 * news for the same word. So the question decides which way round Yes means,
 * and only then does the answer pick the tone.
 */
export function verdictTone(question: string, answer: string): Tone {
  const a = answer.trim().toLowerCase();
  const inverted = /risk|concern|issue|problem/i.test(question);

  const yes = /^(yes|y|true)\b/.test(a);
  const no = /^(no|n|false|none|nil)\b/.test(a);

  if (yes) return inverted ? "risk" : "good";
  if (no) return inverted ? "good" : "neutral";

  if (/recommend|ready|strong|promote/i.test(a)) return "good";
  if (/consider|maybe|partial|hold/i.test(a)) return "watch";
  if (/not |defer|reject/i.test(a)) return "neutral";

  return "neutral";
}

/** "3 yrs 2 mo" from a joining date. Empty when there is none on record. */
export function tenureLabel(dateOfJoining: string | null, now: Date): string | null {
  if (!dateOfJoining) return null;
  const from = new Date(dateOfJoining);
  if (Number.isNaN(from.getTime())) return null;

  let months =
    (now.getFullYear() - from.getFullYear()) * 12 + (now.getMonth() - from.getMonth());
  if (now.getDate() < from.getDate()) months -= 1;
  if (months < 0) return null;

  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${rest} mo`;
  if (rest === 0) return `${years} yr${years === 1 ? "" : "s"}`;
  return `${years} yr${years === 1 ? "" : "s"} ${rest} mo`;
}
