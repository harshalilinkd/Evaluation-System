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
  /* -- WHAT EACH REVIEWER IS, not only who. A column headed with a name says
        nothing about why that person's opinion is on the page; "Design
        Coordinator" does. Already fetched with the names — it was simply never
        carried out of the query. -- */
  leadDesignation: string | null;
  coLeadDesignation: string | null;
  /**
   * The SECOND manager, where the person has one (0083).
   *
   * Null is the signal every consumer branches on: no name, no third column,
   * and the report is exactly the two-column document it has always been.
   */
  coLeadName: string | null;
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
  /**
   * The SECOND manager, where the person has one (0083). Null for everybody
   * else, and every consumer renders the column only when the report says
   * there IS a second manager — so an ordinary report is unchanged.
   */
  coLead: number | null;
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
  /** The second manager's overall, where there is one (0083). */
  coLeadOverall: number | null;
  /**
   * Lead − Self. §11: a reporting figure, visible to HR and the MD alone.
   *
   * Still measured against the REPORTING lead even where there are two
   * managers, and deliberately: §11 defines the gap that way, the threshold and
   * the flags are calibrated to it, and quietly re-defining it as
   * "average-of-managers − self" would change every flag in the system for one
   * team without anybody asking for it. The second manager's own difference is
   * visible beside it in the columns.
   */
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
  /** The second manager's answer, where there is one. */
  coLeadAnswer: string | null;
  /**
   * The 0-5 integer behind a scale answer, so the report can draw a strength
   * bar rather than repeat §6's wording in every cell.
   *
   * CARRIED, NOT PARSED. The rendered string always begins with the numeral, so
   * reading it back out would work today and would be a second definition of
   * what the answer IS — one that breaks silently the moment `readableAnswer`
   * changes its separator. Null for anything that is not a valid SCALE_0_5
   * answer, including an out-of-range value (P4-10 scores those as null, and a
   * bar must not draw nine segments out of five).
   */
  selfScale: number | null;
  leadScale: number | null;
  coLeadScale: number | null;
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
  /** The SECOND manager's answer to the lead's question, where there is one. */
  coLeadAnswer: string | null;
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
  /**
   * Band 5, again, for a SECOND manager (0083).
   *
   * Its own band rather than merged into the one above, and that is the point
   * of collecting two opinions: the two managers write blind to each other, so
   * running their prose together would present one verdict where there are two
   * and leave the reader unable to tell who said what. Empty for almost
   * everybody, and the screen draws nothing when it is.
   */
  coLeadAssessment: NarrativeBlock[];
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
  /** A data URI (0065), or null for a ruled line. */
  hrSignature: string | null;
  mdRemarks: string | null;
  mdOutcome: string | null;
  mdReviewedAt: string | null;
  mdReviewedByName: string | null;
  mdSignature: string | null;
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
