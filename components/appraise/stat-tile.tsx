/** StatTile and HeroCard. DESIGN.md §5.1 (dashboard card) and §5.4 (metric widget). */

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * P10 asks for "a bento row of three StatTiles" with a "night HeroCard
 * variant". Neither name exists in DESIGN.md, so both are built as variants of
 * the two things that do: §5.1's dashboard card and §5.4's metric widget —
 * "a label (body-sm, --ink-muted), a massive number (display-lg, --ink), and a
 * small trend indicator".
 *
 * The `tone` prop is what the brief calls the variant:
 *
 *   plain  the standard white card
 *   self / lead / final   tinted with a tier colour
 *   night  the HeroCard — dark, for the one tile that leads the row
 *
 * TIER TONES ARE NOT DECORATION. §13.1 reserves cyan, pink and indigo for "who
 * said this", and they are admissible here for exactly that reason: the tiles
 * count evaluations by which layer has spoken. Do not reach for `tone="lead"`
 * because a card needs some pink.
 *
 * `night` uses --ink as a surface rather than a new token. DESIGN.md §2 has no
 * dark surface, and inventing one would put a nineteenth colour outside the
 * block that §2 calls the only place a colour is defined.
 */
export type StatTone = "plain" | "self" | "lead" | "final" | "night";

const TONE: Record<StatTone, { card: string; label: string; value: string; caption: string }> = {
  plain: {
    card: "card-surface",
    label: "text-ink-muted",
    value: "text-ink",
    caption: "text-ink-muted",
  },
  self: {
    card: "rounded-card bg-self-tint shadow-dashboard",
    label: "text-ink-muted",
    value: "text-ink",
    caption: "text-ink-muted",
  },
  lead: {
    card: "rounded-card bg-lead-tint shadow-dashboard",
    label: "text-ink-muted",
    value: "text-ink",
    caption: "text-ink-muted",
  },
  final: {
    card: "rounded-card bg-final-tint shadow-dashboard",
    label: "text-ink-muted",
    value: "text-ink",
    caption: "text-ink-muted",
  },
  night: {
    card: "rounded-card-lg bg-ink shadow-dashboard",
    label: "text-ink-invert-muted",
    value: "text-ink-invert",
    caption: "text-ink-invert-muted",
  },
};

export function StatTile({
  label,
  value,
  caption,
  tone = "plain",
  icon,
  footer,
  enterIndex,
  className,
}: {
  label: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
  tone?: StatTone;
  icon?: React.ReactNode;
  footer?: React.ReactNode;
  enterIndex?: number;
  className?: string;
}) {
  const t = TONE[tone];

  return (
    <div
      className={cn(t.card, "card-enter flex flex-col gap-3 p-5", className)}
      style={enterIndex === undefined ? undefined : ({ "--enter-index": enterIndex } as React.CSSProperties)}
    >
      <div className="flex items-start justify-between gap-3">
        <p className={cn("type-label", t.label)}>{label}</p>
        {icon ? <span className={cn("shrink-0", t.label)}>{icon}</span> : null}
      </div>

      {/* §5.4: "a massive number". tabular so it does not jitter between renders. */}
      <p className={cn("tabular text-display-lg leading-none", t.value)}>{value}</p>

      {caption ? <p className={cn("text-body-sm", t.caption)}>{caption}</p> : null}
      {footer}
    </div>
  );
}

/**
 * The wide lead tile. Same anatomy as StatTile, given room for a chart or a
 * stacked bar underneath — the status board's completion header is one.
 */
export function HeroCard({
  label,
  value,
  caption,
  tone = "night",
  action,
  children,
  enterIndex,
  className,
}: {
  label: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
  tone?: StatTone;
  action?: React.ReactNode;
  children?: React.ReactNode;
  enterIndex?: number;
  className?: string;
}) {
  const t = TONE[tone];

  return (
    <section
      className={cn(t.card, "card-enter flex flex-col gap-4 p-6", className)}
      style={enterIndex === undefined ? undefined : ({ "--enter-index": enterIndex } as React.CSSProperties)}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className={cn("type-label", t.label)}>{label}</p>
          <p className={cn("tabular mt-2 text-display-lg leading-none", t.value)}>{value}</p>
          {caption ? <p className={cn("mt-2 text-body-sm", t.caption)}>{caption}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
