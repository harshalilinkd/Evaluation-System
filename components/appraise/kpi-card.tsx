"use client";

/** The compact KPI card: label, number, caption, sparkline. DESIGN.md §5.4. */

import type { ReactNode } from "react";

import { Sparkline } from "@/components/appraise/charts";
import { cn } from "@/lib/utils";

/**
 * §5.4's metric widget, tightened.
 *
 * Four things in a fixed order — label, number, caption, trace — so a row of six
 * scans as one object rather than six. The icon sits opposite the label in a
 * tinted chip; it is decoration and is marked aria-hidden, because the label
 * beside it already says what the card is.
 *
 * ACCENT IS A ROLE, NOT A PREFERENCE. Each accent below means one thing across
 * the whole dashboard: amber needs attention, cyan is in flight, green is done,
 * indigo is the primary quantity. Picking one because a row looks better with
 * some variety is how a palette stops carrying meaning.
 *
 * The tier hues are absent by construction — cyan/pink/indigo answer "who said
 * this" (§13.1), and a KPI card is not a tier.
 */
export type KpiAccent = "indigo" | "cyan" | "amber" | "green" | "rose" | "slate";

const ACCENT: Record<KpiAccent, { chip: string; stroke: string }> = {
  indigo: { chip: "bg-accent-primary/10 text-accent-primary", stroke: "rgb(var(--accent-primary))" },
  cyan: { chip: "bg-accent-cyan/10 text-accent-cyan", stroke: "rgb(var(--accent-cyan))" },
  amber: { chip: "bg-warning/10 text-warning", stroke: "rgb(var(--warning))" },
  green: { chip: "bg-success/10 text-success", stroke: "rgb(var(--success))" },
  rose: { chip: "bg-critical/10 text-critical", stroke: "rgb(var(--critical))" },
  slate: { chip: "bg-surface-mute text-ink-muted", stroke: "rgb(var(--ink-faint))" },
};

export function KpiCard({
  label,
  value,
  caption,
  icon,
  accent = "indigo",
  spark,
  enterIndex,
  className,
}: {
  label: string;
  value: ReactNode;
  caption?: string;
  icon?: ReactNode;
  accent?: KpiAccent;
  /** The shape under the number. Absent draws nothing rather than a flat lie. */
  spark?: number[];
  enterIndex?: number;
  className?: string;
}) {
  const tone = ACCENT[accent];

  return (
    <div
      className={cn("card-enter card-surface flex flex-col overflow-hidden", className)}
      style={enterIndex === undefined ? undefined : ({ "--enter-index": enterIndex } as React.CSSProperties)}
    >
      <div className="flex flex-1 flex-col gap-1 p-5 pb-2">
        <div className="flex items-start justify-between gap-3">
          <p className="text-body-sm text-ink-muted">{label}</p>
          {icon ? (
            <span aria-hidden className={cn("flex size-7 items-center justify-center rounded-input", tone.chip)}>
              {icon}
            </span>
          ) : null}
        </div>

        {/* §3: display-lg, tabular, so six cards in a row line up. */}
        <p className="tabular text-display-lg leading-none text-ink">{value}</p>
        {caption ? <p className="text-body-sm text-ink-muted">{caption}</p> : null}
      </div>

      {/* Flush to the card's edge — the trace is a foot, not a chart in a box. */}
      {spark && spark.length > 0 ? <Sparkline data={spark} color={tone.stroke} /> : null}
    </div>
  );
}
