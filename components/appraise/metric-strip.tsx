/** MetricStrip — the row of compact figures that opens an analytics screen. */

import { cn } from "@/lib/utils";
import { CHART_COLORS, Sparkline } from "@/components/appraise/charts";

/**
 * One figure, its caption, and an optional shape behind it.
 *
 * WHY THE NUMBER IS IN INK AND NOT IN THE ACCENT COLOUR: §13.1 reserves the
 * three tier hues, and the dataviz rule that text wears text tokens applies to
 * a metric card as much as to a chart — a coloured numeral claims to mean
 * something, and here the colour is only decoration. The hue lives in the icon
 * chip and the sparkline, which is where identity belongs.
 *
 * The trend line is deliberately unlabelled and unaxised. It is a shape, not a
 * chart: it answers "rising or flat" at a glance and defers the actual reading
 * to the full chart below. Giving it ticks would invite people to read values
 * off eight pixels of height.
 */
export type Metric = {
  label: string;
  value: string | number;
  /** The small line under the caption — what this figure is out of, or of. */
  caption?: string;
  /** The sparkline series. Omitted where there is no history to draw. */
  series?: readonly number[];
  /** Which hue the chip and sparkline take. */
  tone?: "primary" | "cyan" | "pink" | "green" | "amber";
  icon?: React.ReactNode;
  /** Rendered under the value as a share bar, 0–1. */
  share?: number | null;
};

const TONE: Record<
  NonNullable<Metric["tone"]>,
  { chip: string; bar: string; spark: "primary" | "cyan" | "pink" | "green" | "amber" }
> = {
  /* -- Written out in full, never interpolated. Tailwind scans source
        statically, so `bg-${tone}/10` compiles to nothing (P7-1). -- */
  primary: { chip: "bg-primary/10 text-primary", bar: "bg-primary", spark: "primary" },
  cyan: { chip: "bg-self-tint text-self", bar: "bg-self", spark: "cyan" },
  pink: { chip: "bg-lead-tint text-lead", bar: "bg-lead", spark: "pink" },
  green: { chip: "bg-success/10 text-success", bar: "bg-success", spark: "green" },
  amber: { chip: "bg-warning/10 text-warning", bar: "bg-warning", spark: "amber" },
};

export function MetricStrip({ metrics, className }: { metrics: Metric[]; className?: string }) {
  if (metrics.length === 0) return null;

  return (
    /* -- `auto-fit` rather than a fixed column count: six cards on a wide
          monitor, three on a laptop, two on a phone — decided by the space
          available rather than by a breakpoint guessed in advance. `minmax`
          with a floor is what stops a card collapsing narrower than its own
          numeral. -- */
    <div
      className={cn("grid gap-3", className)}
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}
    >
      {metrics.map((metric) => (
        <MetricCard key={metric.label} {...metric} />
      ))}
    </div>
  );
}

function MetricCard({ label, value, caption, series, tone = "primary", icon, share }: Metric) {
  const t = TONE[tone];

  return (
    <article className="card-surface flex flex-col gap-3 p-4">
      <header className="flex items-start justify-between gap-2">
        <h3 className="font-sans text-body-sm font-medium text-ink">{label}</h3>
        {icon ? (
          <span
            className={cn("flex size-7 shrink-0 items-center justify-center rounded-control", t.chip)}
            aria-hidden
          >
            {icon}
          </span>
        ) : null}
      </header>

      <div className="space-y-1">
        <p className="tabular font-sans text-display-md leading-none text-ink">{value}</p>
        {caption ? <p className="font-sans text-body-sm text-ink-muted">{caption}</p> : null}
      </div>

      {/* -- A share bar OR a sparkline, never both: two shapes describing one
            number is one shape too many, and the card stops being scannable. -- */}
      {share !== null && share !== undefined ? (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-mute">
          <div
            className={cn("h-full rounded-full", t.bar)}
            style={{ width: `${Math.round(Math.min(1, Math.max(0, share)) * 100)}%` }}
          />
        </div>
      ) : series && series.length > 1 ? (
        <Sparkline data={[...series]} color={CHART_COLORS[t.spark]} height={32} />
      ) : (
        /* -- Holds the row even when a card has neither, so six cards in a row
              keep their baselines level instead of one riding up. -- */
        <div className="h-8" aria-hidden />
      )}
    </article>
  );
}
