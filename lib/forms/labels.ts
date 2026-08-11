/** The single source of section names and section order. Pure — no database. */

import type { Enums } from "@/types/database";

export type QuestionSection = Enums<"question_section">;

/**
 * Display names for every section.
 *
 * **No component may hardcode a section name.** Every screen, preview, export
 * and print route reads from here, so renaming a section is one edit rather
 * than a grep-and-hope across the codebase.
 *
 * Note DEPARTMENT_SPECIFIC → "Job Specific Skills". The enum value is the
 * stored value and is never renamed (§0.2, and the P8-PATCH brief is explicit);
 * only the label changes. That distinction is the whole point of this file:
 * what the database calls a thing and what a person calls it are allowed to
 * differ, and only one of them is safe to change.
 */
export const SECTION_LABELS: Record<QuestionSection, string> = {
  METADATA: "Details",
  KPI: "Quantitative Performance (KPI)",
  CORE_PERFORMANCE: "Core Performance",
  DEPARTMENT_SPECIFIC: "Job Specific Skills",
  BEHAVIOURAL: "Behavioural, Team Skills & Learning",
  LEARNING: "Learning & Development",
  NARRATIVE: "Add-ons & Key Achievements",
  /* -- Was "Manager Review (Team Lead only)". The rename made it "Team Manager
        only", which says Manager twice — and the parenthetical only ever
        existed to say "not the employee", which the title now says on its own.
        This is the shipped DEFAULT; a name HR has already edited through P25's
        `form_sections` is stored and is not touched by this. -- */
  MANAGER_REVIEW: "Manager Review",
};

export function sectionLabel(section: QuestionSection): string {
  return SECTION_LABELS[section] ?? section;
}

/**
 * The order every form renders in.
 *
 * Job Specific Skills sits after Core Performance and before Behavioural —
 * the department-specific questions belong with the rest of the performance
 * assessment, not tacked on after the narrative sections.
 *
 * This deliberately does NOT match the Postgres enum's declaration order.
 * Changing an enum's order means dropping and recreating the type, which would
 * rename nothing but would break every column using it; ordering in TypeScript
 * costs nothing and keeps the stored values untouched. Every renderer sorts
 * through `sectionRank`, never through `order by section`.
 */
export const SECTION_ORDER: readonly QuestionSection[] = [
  "METADATA",
  "KPI",
  "CORE_PERFORMANCE",
  "DEPARTMENT_SPECIFIC",
  "BEHAVIOURAL",
  "LEARNING",
  "NARRATIVE",
  "MANAGER_REVIEW",
] as const;

export function sectionRank(section: QuestionSection): number {
  const index = SECTION_ORDER.indexOf(section);
  // An unknown section sorts last rather than crashing the form: a new enum
  // value added without updating this list should degrade, not break.
  return index === -1 ? SECTION_ORDER.length : index;
}

/** Sections in render order, with their labels — for pickers and filters. */
export const SECTION_OPTIONS = SECTION_ORDER.map((value) => ({
  value,
  label: SECTION_LABELS[value],
}));

/**
 * The one section whose questions differ by department (CLAUDE.md §1). Every
 * other section is identical company-wide.
 */
export const DEPARTMENT_SECTION: QuestionSection = "DEPARTMENT_SPECIFIC";

/* ---------- Tracks ---------- */

export type Track = Enums<"track_type">;

/**
 * What each track is CALLED. Renamed at the owner's explicit instruction:
 * Staff → Backend Team, Shop floor → Production Team.
 *
 * **THE ENUM VALUES DO NOT CHANGE, AND MUST NOT.** `STAFF` and `WORKER` are the
 * stored values in `profiles.track`, `questions.track` and
 * `evaluation_cycles.track_scope`, and they are frozen into every launched
 * evaluation. Renaming them would rewrite what every past appraisal says about
 * the person it describes — §0.2, and the same call P8P-1 made for
 * DEPARTMENT_SPECIFIC.
 *
 * That distinction is why this file exists: what the database calls a thing and
 * what a person calls it are allowed to differ, and only one is safe to change.
 * The `worker_` table prefix and the `lib/worker` module keep their names for
 * the same reason — they are schema and code, not something anybody reads.
 *
 * **No screen may hardcode a track name.** It was typed by hand in six places
 * before this existed, which is why one rename touched six files.
 */
export const TRACK_LABELS: Record<Track, string> = {
  STAFF: "Backend Team",
  WORKER: "Production Team",
  // `BOTH` is a cycle SCOPE, never a person's track — nobody is in both teams.
  BOTH: "Both teams",
};

/** The instrument each track answers, for a picker that has to explain itself. */
export const TRACK_FORM_LABELS: Record<Track, string> = {
  STAFF: "Backend Team — 0 to 5 evaluation",
  WORKER: "Production Team — three-tick sheet",
  BOTH: "Both teams",
};

export function trackLabel(track: Track | string | null | undefined): string {
  if (!track) return "—";
  return TRACK_LABELS[track as Track] ?? String(track);
}
