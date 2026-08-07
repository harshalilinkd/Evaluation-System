/** Band 3's topic pairing. Curated, never computed. Pure. */

import { createHash } from "node:crypto";

/**
 * The question ids 0017 seeded, derived the same way it derived them.
 *
 * 0017 writes `md5('linkd.q.' || key)::uuid`, so the id for a given key is
 * fixed and knowable without a lookup. That matters here: §5 freezes the
 * question TEXT into every snapshot, so matching on text would break the first
 * time HR rewords a question — while the id is stable for ever.
 */
function qid(key: string): string {
  const hex = createHash("md5").update(`linkd.q.${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Band 3 — what each side said, aligned by topic.
 *
 * This is a CURATED layout, not automatic matching. The brief is explicit:
 * "Do not attempt to score or match this automatically — present it side by
 * side and let a human read it." So the pairing is three named topics chosen by
 * a person, and the report does no similarity work of any kind.
 *
 * Degrading is the important part. A snapshot may not contain either question —
 * an evaluation frozen before 0017, or a form HR has since authored themselves.
 * A topic with neither side present is dropped; a topic with one side present
 * renders that side and says the other was not asked. **Nothing an employee or
 * a lead actually wrote is ever lost**: every narrative answer this map does
 * not claim falls through to Band 4 or Band 5.
 */
export const NARRATIVE_TOPICS: ReadonlyArray<{
  topic: string;
  selfQuestionId: string | null;
  leadQuestionId: string | null;
}> = [
  {
    topic: "What was learned, and what stands out",
    selfQuestionId: qid("learn.learned"),
    leadQuestionId: qid("mgr.strengths"),
  },
  {
    // No self question, and that is not an omission: this form does not ask
    // anybody to name a weakness in themselves. Showing the topic with the left
    // column empty says so, which is more useful to HR than quietly pairing the
    // lead's answer with something the employee wrote about a different thing.
    topic: "Where to improve",
    selfQuestionId: null,
    leadQuestionId: qid("mgr.improvement"),
  },
  {
    topic: "Training needed",
    selfQuestionId: qid("learn.next"),
    leadQuestionId: qid("mgr.training"),
  },
];

/** Every question id Band 3 may claim, so Bands 4 and 5 can skip them. */
export const PAIRED_QUESTION_IDS: ReadonlySet<string> = new Set(
  NARRATIVE_TOPICS.flatMap((t) => [t.selfQuestionId, t.leadQuestionId]).filter(
    (id): id is string => id !== null,
  ),
);
