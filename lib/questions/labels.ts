/** Plain-language vocabulary for the question bank UI. §13.5 — no schema words on screen. */

import {
  DEPARTMENT_SECTION,
  SECTION_LABELS,
  SECTION_OPTIONS,
  sectionLabel,
} from "@/lib/forms/labels";
import type { Enums } from "@/types/database";

export { DEPARTMENT_SECTION, SECTION_LABELS, sectionLabel };

export type ResponseType = Enums<"response_type">;
export type QuestionSection = Enums<"question_section">;
export type AnsweredBy = Enums<"answered_by">;
export type TrackType = Enums<"track_type">;
export type QuestionCategory = Enums<"question_category">;

/**
 * §13.5: "The HR form builder must be usable by a non-technical person: plain
 * language, no JSON, no schema jargon in the UI."
 *
 * Every enum the database uses is translated here and nowhere else. The value
 * side of each entry is the only place an enum name appears in this feature —
 * a component that needs to show a type reaches for `label`, never the value.
 */
export const RESPONSE_TYPES: ReadonlyArray<{
  value: ResponseType;
  label: string;
  hint: string;
}> = [
  { value: "SCALE_0_5", label: "Rating 0 to 5", hint: "Six labelled options, from Very dissatisfied to Outstanding." },
  {
    value: "TICK_3",
    label: "Tick: Excellent / Satisfactory / Needs improvement",
    hint: "The three-point sheet used for shop-floor staff.",
  },
  { value: "NUMBER", label: "Number", hint: "A figure, like a count of clients." },
  { value: "BOOLEAN", label: "Yes / No", hint: "A simple yes or no." },
  { value: "TEXT_SHORT", label: "Short text", hint: "A single line." },
  { value: "TEXT_LONG", label: "Long text", hint: "A paragraph, with a 1000-character limit." },
  { value: "SINGLE_SELECT", label: "Pick one", hint: "One choice from a list you write." },
  { value: "MULTI_SELECT", label: "Pick many", hint: "Any number of choices from a list you write." },
  { value: "DATE", label: "Date", hint: "A date picker." },
];

// Sourced from lib/forms/labels — the single map every screen, preview, export
// and print route reads. Nothing here may restate a section name.
export const SECTIONS = SECTION_OPTIONS;

export const ANSWERED_BY: ReadonlyArray<{
  value: AnsweredBy;
  label: string;
  hint: string;
}> = [
  {
    value: "EMPLOYEE_AND_LEAD",
    label: "The employee and their manager",
    hint: "Both answer it, and the two answers are compared side by side.",
  },
  { value: "EMPLOYEE_ONLY", label: "The employee only", hint: "Their manager never sees this question on their own form." },
  { value: "LEAD_ONLY", label: "Their manager only", hint: "The employee is not asked this." },
  { value: "MD_ONLY", label: "The Managing Director only", hint: "Only appears on the final review." },
];

export const TRACKS: ReadonlyArray<{ value: TrackType; label: string; hint: string }> = [
  { value: "BOTH", label: "Everyone", hint: "Office staff and shop-floor workers alike." },
  { value: "STAFF", label: "Office staff", hint: "The 0-5 form." },
  { value: "WORKER", label: "Shop-floor workers", hint: "The tick sheet." },
];

// §1: every staff employee fills the same form, and only Job Specific Skills
// varies by department. So "who is asked" is really "is this the one section
// that changes" — worded that way rather than as a schema distinction.
export const CATEGORIES: ReadonlyArray<{
  value: QuestionCategory;
  label: string;
  hint: string;
}> = [
  {
    value: "CORE",
    label: "Everyone answers it",
    hint: "Appears on every employee's form, identical company-wide.",
  },
  {
    value: "DEPARTMENT",
    label: `${SECTION_LABELS.DEPARTMENT_SPECIFIC} — varies by department`,
    hint: "Only the departments you choose are asked this.",
  },
];

/* ---------- Lookups ---------- */

const toLabel = <T extends string>(list: ReadonlyArray<{ value: T; label: string }>) => {
  const map = new Map(list.map((entry) => [entry.value, entry.label]));
  // Falls back to the raw value only if someone adds an enum member without a
  // translation — visible, so it gets fixed, rather than rendering blank.
  return (value: T): string => map.get(value) ?? value;
};

export const responseTypeLabel = toLabel(RESPONSE_TYPES);
// sectionLabel is NOT redefined here — it is re-exported from lib/forms/labels
// above, so there is exactly one function that names a section.
export const answeredByLabel = toLabel(ANSWERED_BY);
export const trackLabel = toLabel(TRACKS);
export const categoryLabel = toLabel(CATEGORIES);

/** Only these two need an option list. */
export function needsOptions(type: ResponseType): boolean {
  return type === "SINGLE_SELECT" || type === "MULTI_SELECT";
}

/** Only a Yes/No question can drive a "show this only if…" rule. */
export function canBeParent(type: ResponseType): boolean {
  return type === "BOOLEAN";
}

/**
 * The dependency, as a sentence: "Shown only when 'Any missed deadlines?' is
 * answered Yes." HR should never have to read a column name to understand it.
 */
export function dependencySentence(parentText: string, value: string): string {
  const answer = value.trim().toLowerCase() === "true" ? "Yes" : "No";
  return `Shown only when “${parentText}” is answered ${answer}.`;
}
