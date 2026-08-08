"use client";

/**
 * The self-versus-lead dumbbell — the product's central comparison, drawn once.
 *
 * FORM. Two points per row and the distance between them is the whole story, so
 * this is a dumbbell rather than paired bars: bars would ask the reader to
 * compare two lengths from a shared baseline, when what matters is the GAP. The
 * connecting bar makes that distance the most visible thing on the row.
 *
 * COLOUR. Self = cyan, Lead = pink, from §13.1's reserved tiers — not a choice,
 * and it happens to be right: the pair was validated at ΔE 8.9 under deuteranopia
 * (the skill's floor is 6, target 8), and 31.2 for normal vision. Cyan sits below
 * 3:1 against white, which the skill says "obligates visible labels or a table
 * view, not dismissable" — both are present: every dot carries a direct value and
 * the caller wraps this in `ChartFigure`, which ships a table.
 *
 * A legend is always present because there are two series, and identity is never
 * left to colour alone.
 */

import * as React from "react";

import { cn } from "@/lib/utils";

export type GapRow = {
  label: string;
  self: number | null;
  lead: number | null;
};

/** 0–5 is the scale every SCALE_0_5 question uses (§6). */
const MAX = 5;

function pct(value: number): number {
  return Math.max(0, Math.min(100, (value / MAX) * 100));
}

export function GapChart({
  rows,
  className,
}: {
  rows: readonly GapRow[];
  className?: string;
}) {
  const [hovered, setHovered] = React.useState<string | null>(null);

  if (rows.length === 0) return null;

  return (
    <div className={cn("space-y-4", className)}>
      {/* A legend, always, for two series (§ the skill's non-negotiables). The
          swatch carries the colour; the text stays in ink tokens, never the
          series hue. */}
      <div className="flex flex-wrap items-center gap-4">
        <span className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-self" aria-hidden />
          <span className="font-sans text-body-sm text-ink-muted">They rated themselves</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-lead" aria-hidden />
          <span className="font-sans text-body-sm text-ink-muted">Their lead rated them</span>
        </span>
      </div>

      <ul className="space-y-3.5">
        {rows.map((row) => {
          const both = row.self !== null && row.lead !== null;
          const gap = both ? Math.round((row.lead! - row.self!) * 100) / 100 : null;
          const lo = both ? Math.min(row.self!, row.lead!) : null;
          const hi = both ? Math.max(row.self!, row.lead!) : null;
          const active = hovered === row.label;

          return (
            <li
              key={row.label}
              className="space-y-1.5"
              onMouseEnter={() => setHovered(row.label)}
              onMouseLeave={() => setHovered(null)}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-sans text-body-sm text-ink">{row.label}</span>
                {/* Selective labelling: the GAP is the story, so it is the only
                    number that rides every row. The two values live on the dots
                    and in the table. */}
                <span
                  className={cn(
                    "shrink-0 tabular text-body-sm",
                    gap !== null && Math.abs(gap) >= 2 ? "text-critical" : "text-ink-muted",
                  )}
                >
                  {gap === null ? "—" : `${gap > 0 ? "+" : ""}${gap.toFixed(2)}`}
                </span>
              </div>

              {/* The track. A hairline, one step off the surface — recessive. */}
              <div className="relative h-5" aria-hidden>
                <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-rule" />

                {both ? (
                  <>
                    {/* The connecting bar IS the gap. 4px, rounded, so the
                        distance reads as one object rather than two dots. */}
                    <div
                      className="absolute top-1/2 h-1 -translate-y-1/2 rounded-pill bg-ink/15"
                      style={{ left: `${pct(lo!)}%`, width: `${pct(hi!) - pct(lo!)}%` }}
                    />
                    {/* ≥8px markers with a 2px surface ring, so they stay legible
                        where they overlap each other. */}
                    <span
                      className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-self ring-2 ring-surface"
                      style={{ left: `${pct(row.self!)}%` }}
                    />
                    <span
                      className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-lead ring-2 ring-surface"
                      style={{ left: `${pct(row.lead!)}%` }}
                    />
                  </>
                ) : row.self !== null ? (
                  <span
                    className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-self ring-2 ring-surface"
                    style={{ left: `${pct(row.self)}%` }}
                  />
                ) : row.lead !== null ? (
                  <span
                    className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-lead ring-2 ring-surface"
                    style={{ left: `${pct(row.lead)}%` }}
                  />
                ) : null}
              </div>

              {/* The hover layer. An HTML chart IS interactive; the two values
                  appear on the row being read rather than in a floating box that
                  has nowhere to go on a phone. */}
              <p
                className={cn(
                  "font-sans text-body-sm text-ink-muted transition-opacity motion-reduce:transition-none",
                  active ? "opacity-100" : "opacity-0",
                )}
              >
                Self {row.self === null ? "—" : row.self.toFixed(2)} · Lead{" "}
                {row.lead === null ? "—" : row.lead.toFixed(2)}
              </p>
            </li>
          );
        })}
      </ul>

      {/* The scale, once, at the foot — rather than a tick under every row. */}
      <div className="flex justify-between border-t border-rule pt-2 font-sans text-body-sm text-ink-muted">
        <span>0</span>
        <span>Out of {MAX}</span>
        <span>{MAX}</span>
      </div>
    </div>
  );
}
