/** Section names and order, as HR has them now. Falls back to the defaults in labels.ts. */

import { cache } from "react";

import {
  SECTION_LABELS,
  SECTION_ORDER,
  type QuestionSection,
} from "@/lib/forms/labels";
import { createClient } from "@/lib/supabase/server";

export type SectionConfig = {
  labels: Record<QuestionSection, string>;
  order: readonly QuestionSection[];
  /** Sections HR has parked. Rendered nowhere, but still holding their questions. */
  hidden: readonly QuestionSection[];
};

/**
 * The defaults, as a config.
 *
 * `SECTION_LABELS` and `SECTION_ORDER` stay exactly what they were: the values
 * the product ships with, and what a test asserts against. 0036 seeds the table
 * from them, so applying the migration changes nothing anybody can see — the
 * point is to move them somewhere editable, not to edit them.
 *
 * This is also the fallback whenever the table cannot be read, which matters:
 * a section with no name renders as a blank heading on somebody's appraisal,
 * and that is worse than showing the name it has always had.
 */
export const DEFAULT_SECTION_CONFIG: SectionConfig = {
  labels: SECTION_LABELS,
  order: SECTION_ORDER,
  hidden: [],
};

/**
 * Read once per request.
 *
 * `cache()` is React's per-request memo, so a page that renders six components
 * needing a section name issues one query rather than six — and every one of
 * them sees the same answer, which matters when HR is editing in another tab.
 */
export const getSectionConfig = cache(async (): Promise<SectionConfig> => {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("form_sections")
    .select("section, label, sort_order, is_active")
    .order("sort_order");

  // Before 0036 is applied this table does not exist. Falling back rather than
  // throwing is what keeps every form rendering through the gap between a
  // deploy and a migration.
  if (error || !data || data.length === 0) return DEFAULT_SECTION_CONFIG;

  const labels = { ...SECTION_LABELS };
  const order: QuestionSection[] = [];
  const hidden: QuestionSection[] = [];

  for (const row of data) {
    const section = row.section;
    labels[section] = row.label;
    if (row.is_active) order.push(section);
    else hidden.push(section);
  }

  /* -- Any section the table does not mention keeps its default position at the
        end. 0036 refuses to apply while one is missing, so this only fires if a
        row is deleted by hand — but a missing section must degrade to "last",
        never to "absent", or its questions would silently stop being asked. -- */
  for (const section of SECTION_ORDER) {
    if (!order.includes(section) && !hidden.includes(section)) order.push(section);
  }

  return { labels, order, hidden };
});

/** The rank a section sorts at, under this configuration. */
export function rankIn(config: SectionConfig, section: QuestionSection): number {
  const index = config.order.indexOf(section);
  // Unknown sorts last rather than crashing the form — the same degradation
  // `sectionRank` has always had.
  return index === -1 ? config.order.length : index;
}

/** The label, with the shipped default as the backstop. */
export function labelIn(config: SectionConfig, section: QuestionSection): string {
  return config.labels[section] ?? SECTION_LABELS[section] ?? section;
}
