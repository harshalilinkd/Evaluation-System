/** The combined report's shape (P20). Both sides of a blind evaluation, together. */

import type { FlagLevel } from "@/lib/evaluations/scoring";
import type { Enums } from "@/types/database";

export type QuestionSection = Enums<"question_section">;

/** Who is asking for the report. Decides whether the salary block exists at all. */
export type ReportAudience = "HR_ADMIN" | "MD";

export type ReportHeader = {
  employeeName: string;
  employeeCode: string | null;
  department: string | null;
  designation: string | null;
  dateOfJoining: string | null;
  leadName: string | null;
  cycleName: string;
  cycleType: string;
  period: string;
  status: Enums<"evaluation_status">;
};

export type SectionAverages = {
  section: QuestionSection;
  label: string;
  self: number | null;
  lead: number | null;
  gap: number | null;
};

export type ReportSummary = {
  selfOverall: number | null;
  leadOverall: number | null;
  /**
   * The agreed final score, recorded by HR on the MD's behalf at completion.
   *
   * It was being STORED and shown nowhere: `evaluations.final_overall` had no
   * reader in the report at all, so HR typed a figure, closed the cycle, and
   * the record appeared to have swallowed it. The employee sees this number
   * (per the cycle's disclosure), so it has to be visible to the people who
   * set it.
   */
  finalOverall: number | null;
  /** Lead − Self. §11: a reporting figure, visible to HR and the MD alone. */
  overallGap: number | null;
  flaggedCount: number;
  sections: SectionAverages[];
  /** The cycle's threshold, so the screen can say what "flagged" means. */
  flagThreshold: number;
};

export type ReportRow = {
  questionId: string;
  text: string;
  section: QuestionSection;
  sectionLabel: string;
  responseType: string;
  /** Rendered for a human — "4 · Effective (Exceeds objective)", "Yes", a date. */
  selfAnswer: string | null;
  leadAnswer: string | null;
  /** Numeric only where both sides are scored. Lead − Self. */
  gap: number | null;
  flag: FlagLevel;
  leadComment: string | null;
};

export type ReportSection = {
  section: QuestionSection;
  label: string;
  rows: ReportRow[];
};

/** One topic, both sides. Presented side by side — never matched or scored. */
export type NarrativePair = {
  topic: string;
  selfQuestion: string | null;
  selfAnswer: string | null;
  leadQuestion: string | null;
  leadAnswer: string | null;
};

export type NarrativeBlock = {
  question: string;
  answer: string | null;
};

export type ReportNarratives = {
  /** Band 3 — aligned by topic, both columns. */
  paired: NarrativePair[];
  /** Band 4 — everything else the employee wrote, in form order. */
  employeeVoice: NarrativeBlock[];
  /** Band 5 — everything else the lead wrote, in form order. */
  leadAssessment: NarrativeBlock[];
};

export type ReportMeta = {
  selfSubmittedAt: string | null;
  leadSubmittedAt: string | null;
  selfSkipped: boolean;
  leadSkipped: boolean;
  /** Every prior return, newest first, with the reason verbatim (§12). */
  returns: Array<{ at: string; returnedTo: string | null; reason: string | null; by: string | null }>;
};

export type ReportReview = {
  hrSummary: string | null;
  hrRecommendation: string | null;
  hrReviewedAt: string | null;
  hrReviewedByName: string | null;
  mdRemarks: string | null;
  mdOutcome: string | null;
  mdReviewedAt: string | null;
  mdReviewedByName: string | null;
};

/**
 * The salary block. Present ONLY on an INCREMENT cycle and ONLY for HR and MD.
 *
 * The key is optional on the type on purpose: the brief requires the block be
 * omitted rather than blanked, so anything downstream must be forced to handle
 * its absence rather than reading an empty object and rendering an empty card.
 */
export type ReportSalary = {
  oldSalary: number | null;
  incrementPct: number | null;
  newSalary: number | null;
  incrementType: string | null;
  /** P21 fills this in; P20 renders the placeholder the brief asks for. */
  complete: boolean;
};

export type EvaluationReport = {
  evaluationId: string;
  cycleId: string;
  isIncrement: boolean;
  header: ReportHeader;
  summary: ReportSummary;
  sections: ReportSection[];
  narratives: ReportNarratives;
  meta: ReportMeta;
  review: ReportReview;
  /** Absent unless the cycle is INCREMENT *and* the caller is HR or the MD. */
  salary?: ReportSalary;
};
