"use client";

/** HR's own section names, available to any client screen without prop threading. */

import * as React from "react";

import { SECTION_LABELS, type QuestionSection } from "@/lib/forms/labels";

/**
 * WHY A CONTEXT AND NOT A PROP.
 *
 * P25 made the eight section names editable, and every rendered FORM picked
 * that up for free because a form travels as a `FormDefinition` and the label
 * rides on it. Screens that name a section in their own CHROME did not: the
 * question-bank filter, the departments list and its mapping screen, the cycle
 * wizard's review step, the cycle board, the scorecard. They import
 * `SECTION_LABELS` — the SHIPPED defaults — so renaming "Job Specific Skills"
 * changed every form and left eight screens still calling it the old thing.
 *
 * Those screens are all client components, so they cannot read the config
 * themselves — it is a server read (P25-6, cached per request). Threading a
 * prop would mean editing eight server pages and eight component signatures
 * for a string none of them otherwise cares about, and the ninth screen would
 * be the one somebody forgets.
 *
 * The shell already reads once per request. It provides; screens consume.
 *
 * THE DEFAULTS REMAIN THE BACKSTOP, deliberately. A section with no name is a
 * blank heading on somebody's appraisal, which is worse than an old name
 * (P25-4) — so a missing entry, an unreadable table or a provider that is not
 * there all fall through to what shipped.
 */
const SectionLabelContext = React.createContext<Partial<Record<QuestionSection, string>> | null>(
  null,
);

export function SectionLabelProvider({
  labels,
  children,
}: {
  labels: Partial<Record<QuestionSection, string>>;
  children: React.ReactNode;
}) {
  return <SectionLabelContext.Provider value={labels}>{children}</SectionLabelContext.Provider>;
}

/**
 * One section's name, as HR calls it today.
 *
 * Safe outside a provider — it returns the shipped default — so a component
 * can be rendered in isolation, in a test, or in the print tree without
 * needing one.
 */
export function useSectionLabel(section: QuestionSection): string {
  const labels = React.useContext(SectionLabelContext);
  return labels?.[section] ?? SECTION_LABELS[section] ?? section;
}

/** All eight, for a screen that lists or filters by section. */
export function useSectionLabels(): Record<QuestionSection, string> {
  const labels = React.useContext(SectionLabelContext);
  return React.useMemo(
    () => ({ ...SECTION_LABELS, ...(labels ?? {}) }) as Record<QuestionSection, string>,
    [labels],
  );
}
