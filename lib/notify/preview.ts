/**
 * Every template rendered with placeholders, for the Settings preview.
 *
 * Placeholders, never a real person: the preview exists so HR can read the
 * wording, and rendering it with somebody's actual name and link would put a
 * live invite token on a settings screen (§10).
 *
 * The list is derived from TEMPLATE_LABELS, so a template added without a
 * preview shows up here as a gap rather than silently missing.
 */

import {
  TEMPLATE_LABELS,
  evaluationClosed,
  evaluationFinalised,
  formReturned,
  hrDueDigest,
  evaluationsOverdue,
  incrementsOverdue,
  leadReviewInvite,
  workerRatingInvite,
  leadReviewOverdue,
  leadReviewReminder,
  mdReviewPending,
  reportReady,
  selfEvaluationInvite,
  selfEvaluationOverdue,
  selfEvaluationReminder,
  type RenderedMessage,
  type TemplateKey,
} from "@/lib/notify/templates";

const SAMPLE = {
  name: "{employee}",
  leadName: "{head of department}",
  employeeName: "{employee}",
  department: "{department}",
  period: "{period}",
  dueDate: "{date}",
  days: 3,
  link: "{their personal link}",
  reason: "{your reason, word for word}",
  finalScore: "{score}",
} as const;

const LISTED = [
  { name: "{employee}", department: "{department}", date: "{date}" },
  { name: "{another employee}", department: "{department}", date: "{date}" },
];

/** One rendered example per template key. */
const PREVIEWS: Record<TemplateKey, RenderedMessage> = {
  selfEvaluationInvite: selfEvaluationInvite(SAMPLE),
  selfEvaluationReminder: selfEvaluationReminder(SAMPLE),
  selfEvaluationOverdue: selfEvaluationOverdue(SAMPLE),
  leadReviewInvite: leadReviewInvite(SAMPLE),
  workerRatingInvite: workerRatingInvite(SAMPLE),
  leadReviewReminder: leadReviewReminder(SAMPLE),
  leadReviewOverdue: leadReviewOverdue(SAMPLE),
  mdReviewPending: mdReviewPending(SAMPLE),
  reportReady: reportReady(SAMPLE),
  formReturned: formReturned(SAMPLE),
  evaluationFinalised: evaluationFinalised(SAMPLE),
  evaluationClosed: evaluationClosed({ ...SAMPLE, disclosure: "SCORE_AND_DECISION" }),
  hrDueDigest: hrDueDigest({
    increments: LISTED,
    milestones: LISTED,
    reportsWaiting: 2,
    link: SAMPLE.link,
  }),
  incrementsOverdue: incrementsOverdue({ items: LISTED, link: SAMPLE.link }),
  evaluationsOverdue: evaluationsOverdue({
    employees: 6,
    leads: 3,
    cycleName: "Q3 FY26",
    link: SAMPLE.link,
  }),
};

export type TemplatePreview = {
  key: string;
  label: string;
  subject: string;
  body: string;
};

export function templatePreviewList(): TemplatePreview[] {
  return (Object.keys(TEMPLATE_LABELS) as TemplateKey[]).map((key) => {
    const rendered = PREVIEWS[key];
    return {
      key,
      label: TEMPLATE_LABELS[key],
      subject: rendered?.subject ?? "—",
      body: rendered?.body ?? "This message has no preview yet.",
    };
  });
}
