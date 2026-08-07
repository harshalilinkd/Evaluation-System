/** Tier identity. DESIGN.md §2 — these three colours are reserved and mean one thing. */

import type { Enums } from "@/types/database";

/**
 * DESIGN.md §2: "exactly three colours carry meaning — the three rating tiers.
 * Nothing else in the product is allowed to be amber, blue or emerald."
 *
 * Every class string is written out in full because Tailwind scans source
 * statically — `bg-${tier}-tint` compiles to nothing. That is not boilerplate,
 * it is the reason the tier colours cannot be applied by accident anywhere else.
 */
export type Tier = "self" | "lead" | "final";

export const TIER_LABELS: Record<Tier, string> = {
  self: "Self",
  lead: "Lead",
  final: "Final",
};

/** Which rating layer each tier renders. Keeps the DB enum and the palette aligned. */
export const TIER_FOR_LAYER: Record<Enums<"rating_layer">, Tier> = {
  SELF: "self",
  LEAD: "lead",
  MD: "final",
};

type TierClasses = {
  /** Selected cell: tint fill plus a 1.5px tier border (§6.1). */
  selected: string;
  /** The numeral inside a selected cell. */
  numeral: string;
  /** 8px dot for TierBadge (§6.3). */
  dot: string;
  /** Tinted chip background with a 40% border of the same hue (§6.5). */
  chip: string;
  /** Solid fill, for completed ProgressRail nodes (§6.6). */
  fill: string;
  ring: string;
};

export const TIER_CLASSES: Record<Tier, TierClasses> = {
  self: {
    selected: "bg-self-tint border-self text-self",
    numeral: "text-self",
    dot: "bg-self",
    chip: "bg-self-tint border-self/40 text-self",
    fill: "bg-self border-self",
    ring: "ring-self",
  },
  lead: {
    selected: "bg-lead-tint border-lead text-lead",
    numeral: "text-lead",
    dot: "bg-lead",
    chip: "bg-lead-tint border-lead/40 text-lead",
    fill: "bg-lead border-lead",
    ring: "ring-lead",
  },
  final: {
    selected: "bg-final-tint border-final text-final",
    numeral: "text-final",
    dot: "bg-final",
    chip: "bg-final-tint border-final/40 text-final",
    fill: "bg-final border-final",
    ring: "ring-final",
  },
};

/* ---------- SCALE_0_5 ---------- */

/**
 * CLAUDE.md §6, verbatim. "Fixed wording — do not paraphrase", and §17 forbids
 * improving anything that came from the source forms.
 *
 * `word` is the one-word summary shown under each numeral; `full` is the
 * complete label shown on selection, on hover/focus, and as the mobile legend.
 */
export const SCALE_0_5_LABELS = [
  { value: 0, word: "Very dissatisfied", full: "Very dissatisfied (Not implemented)" },
  { value: 1, word: "Poor", full: "Poor (Reconsider implementation)" },
  { value: 2, word: "Inefficient", full: "Inefficient (Needs improvement)" },
  { value: 3, word: "Adequate", full: "Adequate (Meets objective)" },
  { value: 4, word: "Effective", full: "Effective (Exceeds objective)" },
  { value: 5, word: "Outstanding", full: "Outstanding (Well exceeds objective)" },
] as const;

/** §6.1: anchor words sit outside the group, in ink-faint. */
export const SCALE_ANCHORS = { low: "Very dissatisfied", high: "Outstanding" } as const;

/* ---------- TICK_3 ---------- */

/**
 * CLAUDE.md §6. The stored values are these keys; the numeric mapping
 * (5 / 3 / 1) exists for analytics only and is NEVER rendered on a worker form.
 */
export const TICK_3_OPTIONS = [
  { value: "EXCELLENT", label: "Excellent" },
  { value: "SATISFACTORY", label: "Satisfactory" },
  { value: "NEEDS_IMPROVEMENT", label: "Needs Improvement" },
] as const;

export type Tick3Value = (typeof TICK_3_OPTIONS)[number]["value"];
