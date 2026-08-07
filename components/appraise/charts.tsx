"use client";

/** Recharts wrappers. DESIGN.md §5.2 — smooth splines, gradient fills, rounded bars. */

import { useState, useSyncExternalStore } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { cn } from "@/lib/utils";

/**
 * Chart colours come from the CSS variables, not from hex literals — the same
 * rule as everything else (§2). Recharts needs a resolvable CSS colour string
 * rather than a Tailwind class, so `rgb(var(--token))` is the bridge.
 *
 * The tier colours are deliberately absent: a chart series tinted like a tier
 * would claim to mean "who said this" (§2, CLAUDE.md §13.1). A collision chart
 * passes tier colours explicitly instead.
 */
export const CHART_COLORS = {
  primary: "rgb(var(--chart-series-1))",
  cyan: "rgb(var(--chart-series-2))",
  pink: "rgb(var(--accent-pink))",
  green: "rgb(var(--accent-green))",
  // Amber completes the palette's four semantic roles: primary quantity,
  // secondary quantity, good, needs-attention. A fifth decorative hue is what
  // turns a dashboard gaudy, so the set stops here.
  amber: "rgb(var(--warning))",
} as const;

export type ChartColor = keyof typeof CHART_COLORS;

/**
 * The ordinal ramp — one hue, light to dark, for data whose categories have an
 * order. The §8 pipeline is the case that matters: CYCLE_ACTIVE → SELF_SUBMITTED
 * → LEAD_REVIEWED → MD_FINALIZED → CLOSED is a funnel, and colouring five
 * positions in one sequence with five unrelated hues tells the reader they are
 * five different *kinds* of thing.
 *
 * Index into this by the stage's position in the pipeline, never by its row
 * number in a query result — a colour that follows rank repaints itself when a
 * stage empties, and a reader who learned "the dark one is finalised" is then
 * misled.
 */
export const ORDINAL_STEPS = [
  "rgb(var(--chart-step-1))",
  "rgb(var(--chart-step-2))",
  "rgb(var(--chart-step-3))",
  "rgb(var(--chart-step-4))",
  "rgb(var(--chart-step-5))",
] as const;

export function ordinalStep(index: number): string {
  return ORDINAL_STEPS[Math.min(Math.max(index, 0), ORDINAL_STEPS.length - 1)] ?? ORDINAL_STEPS[0];
}

const AXIS = {
  stroke: "rgb(var(--ink-faint))",
  // §3: chart labels are body-sm, and every number is tabular.
  style: { fontSize: 12, fontVariantNumeric: "tabular-nums" as const },
};

/** A hairline one shade off the surface. Solid — a dashed grid reads as a threshold. */
const GRID = { stroke: "rgb(var(--chart-grid))", strokeWidth: 1 };

/**
 * Recharts animates in JavaScript, so the `prefers-reduced-motion` block in
 * globals.css — which only reaches CSS animations — never touches it. Charts
 * have to ask.
 */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    // The server cannot know, and guessing "animate" would make a
    // motion-sensitive reader watch one before the client corrects it.
    () => true,
  );
}

/**
 * The hover layer. An HTML chart IS interactive, so this ships by default rather
 * than being opted into per chart.
 *
 * A tooltip never GATES a value: every chart here also carries an axis, a direct
 * label or a legend, so the number is reachable without a pointer at all.
 */
function ChartTooltip({ unit }: { unit?: string }) {
  return (
    <Tooltip
      cursor={{ fill: "rgb(var(--ink) / 0.04)" }}
      // Recharts' default content restates the series colour as the label text.
      // Text wears text tokens; the swatch beside it carries identity.
      content={({ active, payload, label }) => {
        if (!active || !payload?.length) return null;
        return (
          <div className="rounded-control border border-rule bg-surface px-3 py-2 shadow-dashboard">
            {label ? <p className="mb-1 text-body-sm text-ink-muted">{String(label)}</p> : null}
            <ul className="space-y-0.5">
              {payload.map((entry) => (
                <li key={String(entry.name)} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-pill"
                    style={{ background: entry.color ?? "rgb(var(--ink-faint))" }}
                  />
                  <span className="text-body-sm text-ink-muted">{String(entry.name)}</span>
                  <span className="tabular ml-auto text-body-sm font-medium text-ink">
                    {String(entry.value)}
                    {unit ? ` ${unit}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      }}
    />
  );
}

/* ---------- Area ---------- */

/**
 * §5.2: "Smooth, wavy splines. Lines should be bold (3px+), with a soft,
 * semi-transparent gradient fill dropping down to the x-axis."
 */
export function TrendAreaChart({
  data,
  xKey,
  series,
  height = 240,
  className,
}: {
  data: Array<Record<string, string | number>>;
  xKey: string;
  series: Array<{ key: string; label: string; color: ChartColor }>;
  height?: number;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();

  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {/* left: 0, not -16. A negative left margin pulls the y-axis off the
            canvas and clips its own tick labels — "2.25" arrives as "25". */}
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                {/* Semi-transparent, fading to nothing at the axis. */}
                <stop offset="0%" stopColor={CHART_COLORS[s.color]} stopOpacity={0.25} />
                <stop offset="100%" stopColor={CHART_COLORS[s.color]} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>

          <CartesianGrid vertical={false} {...GRID} />
          <XAxis dataKey={xKey} tickLine={false} axisLine={false} {...AXIS} />
          {/* allowDecimals: these are counts of people. A y-axis offering 2.25
              evaluations is measuring something that cannot exist. */}
          <YAxis tickLine={false} axisLine={false} width={44} allowDecimals={false} {...AXIS} />
          <ChartTooltip />

          {series.map((s) => (
            <Area
              key={s.key}
              // `monotone` is the spline: smooth without the overshoot that
              // makes a natural cubic invent values the data never had.
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={CHART_COLORS[s.color]}
              strokeWidth={2}
              fill={`url(#fill-${s.key})`}
              dot={false}
              // ≥8px, with a 2px surface ring so an active point sitting on the
              // line of another series stays legible.
              activeDot={{ r: 5, strokeWidth: 2, stroke: "rgb(var(--surface))" }}
              isAnimationActive={!reduced}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------- Bar ---------- */

/** §5.2: rounded tops, 4px on the top corners. */
export function CompletionBarChart({
  data,
  xKey,
  valueKey,
  color = "primary",
  height = 240,
  className,
}: {
  data: Array<Record<string, string | number>>;
  xKey: string;
  valueKey: string;
  color?: ChartColor;
  height?: number;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();

  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} {...GRID} />
          <XAxis dataKey={xKey} tickLine={false} axisLine={false} {...AXIS} />
          <YAxis tickLine={false} axisLine={false} width={44} allowDecimals={false} {...AXIS} />
          <ChartTooltip />
          <Bar
            dataKey={valueKey}
            fill={CHART_COLORS[color]}
            radius={[4, 4, 0, 0]}
            maxBarSize={44}
            // The hover affordance is the bar itself lifting, not a border round
            // it — a stroke drawn to separate marks is the thing gaps are for.
            activeBar={{ fillOpacity: 0.82 }}
            isAnimationActive={!reduced}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------- Donut ---------- */

/**
 * §5.2: "A prominent central number (in display-lg) is encouraged." The number
 * is HTML rather than an SVG label so it inherits the type scale and the
 * tabular figures instead of restating them.
 */
export function StatusDonutChart({
  data,
  centerValue,
  centerLabel,
  height = 240,
  className,
}: {
  /** `fill` is a resolved colour string — the caller decides categorical vs ordinal. */
  data: Array<{ name: string; value: number; fill: string }>;
  centerValue?: string;
  centerLabel?: string;
  height?: number;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const [active, setActive] = useState<number | null>(null);

  return (
    <div className={cn("w-full", className)}>
      <div className="relative w-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="88%"
              // A 2px surface gap between segments, not a stroke around them.
              paddingAngle={2}
              stroke="rgb(var(--surface))"
              strokeWidth={2}
              onMouseEnter={(_, index) => setActive(index)}
              onMouseLeave={() => setActive(null)}
              isAnimationActive={!reduced}
            >
              {/* Hover dims the others rather than growing the hovered one:
                  recharts 3 dropped `activeIndex` on Pie, and dimming is the
                  better affordance anyway — it works identically whether the
                  pointer is on the arc or on the legend row below, and nothing
                  changes size, so the ring never jumps. */}
              {data.map((slice, index) => (
                <Cell
                  key={slice.name}
                  fill={slice.fill}
                  fillOpacity={active === null || active === index ? 1 : 0.35}
                />
              ))}
            </Pie>
            <ChartTooltip />
          </PieChart>
        </ResponsiveContainer>

        {centerValue ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            {/* Proportional figures, not tabular: equal-width digits make a
                display-size number look loose. Tabular is for columns. */}
            <span className="text-display-lg text-ink">{centerValue}</span>
            {centerLabel ? <span className="text-body-sm text-ink-muted">{centerLabel}</span> : null}
          </div>
        ) : null}
      </div>

      {/* Identity is never colour alone. The legend carries the value too, so
          the donut is readable without a pointer — a tooltip enhances, it never
          gates. */}
      <ul className="mt-3 space-y-1.5">
        {data.map((slice, index) => (
          <li
            key={slice.name}
            className={cn(
              "flex items-center gap-2 rounded-control px-1.5 py-1 transition-colors duration-hover",
              active === index && "bg-surface-mute",
            )}
            onMouseEnter={() => setActive(index)}
            onMouseLeave={() => setActive(null)}
          >
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-pill"
              style={{ background: slice.fill }}
            />
            <span className="truncate text-body-sm text-ink-muted">{slice.name}</span>
            <span className="tabular ml-auto text-body-sm font-medium text-ink">{slice.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- Radial ---------- */

/**
 * A single completion figure as an arc. Reads at a glance from across a room,
 * which a number alone does not — and unlike a donut it does not imply the
 * remainder is a second category.
 */
export function RadialGauge({
  value,
  max = 100,
  label,
  color = "primary",
  height = 200,
  className,
}: {
  value: number;
  max?: number;
  label?: string;
  color?: ChartColor;
  height?: number;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;

  return (
    <div className={cn("relative w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          data={[{ name: label ?? "", value: pct, fill: CHART_COLORS[color] }]}
          innerRadius="68%"
          outerRadius="100%"
          startAngle={90}
          // Clockwise from twelve o'clock: the direction people read a dial.
          endAngle={-270}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar background={{ fill: "rgb(var(--surface-mute))" }} dataKey="value" cornerRadius={999} />
        </RadialBarChart>
      </ResponsiveContainer>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="tabular text-display-lg leading-none text-ink">{pct}%</span>
        {label ? <span className="mt-1 text-body-sm text-ink-muted">{label}</span> : null}
      </div>
    </div>
  );
}

/* ---------- Stacked bar ---------- */

/**
 * Several series per category, stacked. Used where the parts genuinely sum to
 * the whole — a department's people across pipeline stages — and never to
 * compare unrelated quantities that happen to share an axis.
 */
export function StackedBarChart({
  data,
  xKey,
  series,
  height = 260,
  className,
}: {
  data: Array<Record<string, string | number>>;
  xKey: string;
  /** `fill` is resolved by the caller — a stage stack passes the ordinal ramp. */
  series: Array<{ key: string; label: string; fill: string }>;
  height?: number;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();

  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          {/* Solid hairline. A dashed grid reads as a projection or a threshold
              when it is only a grid. */}
          <CartesianGrid vertical={false} {...GRID} />
          <XAxis dataKey={xKey} tickLine={false} axisLine={false} {...AXIS} />
          <YAxis tickLine={false} axisLine={false} width={44} allowDecimals={false} {...AXIS} />
          <ChartTooltip />
          {series.map((s, index) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stackId="a"
              fill={s.fill}
              // A 2px surface gap between segments rather than a border around
              // each: the gap separates them without adding a second outline
              // colour competing with the fills.
              stroke="rgb(var(--surface))"
              strokeWidth={2}
              // Only the topmost segment gets rounded corners, or every band
              // in the stack looks like a separate floating bar.
              radius={index === series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
              maxBarSize={44}
              activeBar={{ fillOpacity: 0.82 }}
              isAnimationActive={!reduced}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------- Horizontal bar ---------- */

/**
 * Ranked categories. Horizontal because department names are words, and words
 * on a vertical axis are readable where words under a vertical bar are not —
 * they truncate, tilt, or overlap.
 *
 * ONE MEASURE, ONE COLOUR — AND THAT IS DELIBERATE.
 *
 * Departments are nominal: reordering them changes nothing, so there is no
 * sequence for a colour to carry. Painting each bar a different hue would spend
 * the identity channel restating what bar length already says, and a reader
 * would go looking for the meaning of "green" and find none. The variety this
 * chart needs comes from the direct labels and the hover state, not from hue.
 *
 * (Ordered categories — a funnel, size tiers, age bands — are the opposite case
 * and take the ordinal ramp. That is what StackedBarChart's stage stack uses.)
 */
export function RankedBarChart({
  data,
  labelKey,
  valueKey,
  color = "primary",
  height = 260,
  className,
}: {
  data: Array<Record<string, string | number>>;
  labelKey: string;
  valueKey: string;
  color?: ChartColor;
  height?: number;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();

  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {/* right: 32 leaves room for the value label to sit outside the bar end
            rather than being clipped by a short bar. */}
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 32, bottom: 4, left: 8 }}>
          <CartesianGrid horizontal={false} {...GRID} />
          <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} {...AXIS} />
          <YAxis
            type="category"
            dataKey={labelKey}
            tickLine={false}
            axisLine={false}
            width={104}
            {...AXIS}
          />
          <ChartTooltip />
          <Bar
            dataKey={valueKey}
            fill={CHART_COLORS[color]}
            radius={[0, 4, 4, 0]}
            maxBarSize={22}
            activeBar={{ fillOpacity: 0.82 }}
            isAnimationActive={!reduced}
          >
            {/* The validator flags the series hues below 3:1 on a white surface,
                which obligates a relief channel rather than a different colour.
                A direct value at each bar end is that relief — and it is also
                what makes a row of near-equal bars readable at a glance. */}
            <LabelList
              dataKey={valueKey}
              position="right"
              offset={8}
              className="tabular"
              fill="rgb(var(--ink-muted))"
              fontSize={12}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Shared legend, so a chart and its key never disagree about colour.
 *
 * Present whenever a chart carries two or more series — identity is never
 * colour alone. A single-series chart gets none: its title already names it,
 * and a one-item key is furniture.
 */
export function ChartLegend({
  items,
  className,
}: {
  items: Array<{ label: string; fill: string }>;
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", className)}>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2">
          <span aria-hidden className="size-2.5 rounded-pill" style={{ background: item.fill }} />
          {/* Text wears text tokens. The swatch carries identity; a label in the
              series colour would be both harder to read and redundant. */}
          <span className="text-body-sm text-ink-muted">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

/* ---------- Sparkline ---------- */

/**
 * The thin trace along the bottom of a KPI card.
 *
 * It carries shape, not value: there is no axis, no gridline and no tooltip,
 * because at 40px tall none of those can be read honestly. Its job is "this is
 * rising / flat / spiky", and the number above it is the fact. A sparkline that
 * pretended to be readable would invite conclusions its resolution cannot
 * support.
 *
 * `flat` is a real state, not an empty one — a metric that has not moved draws a
 * straight rule rather than nothing, so a card never looks broken.
 */
export function Sparkline({
  data,
  color,
  height = 40,
}: {
  data: number[];
  color: string;
  height?: number;
}) {
  const points = data.length > 1 ? data : [data[0] ?? 0, data[0] ?? 0];
  const flat = points.every((v) => v === points[0]);
  const series = points.map((value, i) => ({ i, value }));
  const id = `spark-${color.replace(/[^a-z0-9]/gi, "")}`;

  return (
    <div style={{ height }} aria-hidden className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={flat ? "transparent" : `url(#${id})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------- Labelled horizontal bar ---------- */

/**
 * Ranked categories with the value printed at the end of each bar.
 *
 * The label on the bar is what removes the axis: a reader who can see "11" does
 * not need to measure the bar against a scale, so the gridlines come out and the
 * chart gets quieter. Horizontal because category names here are words, and
 * words under a vertical bar truncate or tilt.
 *
 * `emphasis` tints the largest bar. One accent, not a rainbow — the ranking is
 * already carried by length, so colour only has to say "this is the top one".
 */
export function LabelledBarChart({
  data,
  labelKey,
  valueKey,
  color = "primary",
  height = 220,
  className,
}: {
  data: Array<Record<string, string | number>>;
  labelKey: string;
  valueKey: string;
  color?: ChartColor;
  height?: number;
  className?: string;
}) {
  const max = Math.max(0, ...data.map((d) => Number(d[valueKey]) || 0));

  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 8 }}>
          <XAxis type="number" hide domain={[0, max || 1]} />
          <YAxis
            type="category"
            dataKey={labelKey}
            tickLine={false}
            axisLine={false}
            width={110}
            {...AXIS}
          />
          <Bar dataKey={valueKey} radius={[0, 6, 6, 0]} maxBarSize={26}>
            {data.map((row, i) => (
              <Cell
                key={i}
                fill={CHART_COLORS[color]}
                // The leader is solid; everything else steps back, so the eye
                // lands on the top row without a legend explaining why.
                fillOpacity={Number(row[valueKey]) === max ? 1 : 0.42}
              />
            ))}
            <LabelList
              dataKey={valueKey}
              position="right"
              className="tabular"
              style={{ fill: "rgb(var(--ink-muted))", fontSize: 12 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------- Bucketed bars ---------- */

/**
 * Counts per band, coloured by how bad the band is.
 *
 * This is the one chart where hue carries severity rather than identity, and it
 * is legitimate because the bands are ORDERED — 0-1 day is fine, 7d+ is not.
 * The order is in the data, so the ramp reinforces what the axis already says
 * instead of inventing a meaning.
 */
export function BucketBarChart({
  data,
  labelKey,
  valueKey,
  severity = false,
  height = 200,
  className,
}: {
  data: Array<Record<string, string | number>>;
  labelKey: string;
  valueKey: string;
  /** Ramps green → amber → red across the buckets. For age and overdue only. */
  severity?: boolean;
  height?: number;
  className?: string;
}) {
  const fills = severity
    ? ["rgb(var(--success))", "rgb(var(--chart-series-2))", "rgb(var(--warning))", "rgb(var(--critical))"]
    : ORDINAL_STEPS.slice();

  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid vertical={false} {...GRID} />
          <XAxis dataKey={labelKey} tickLine={false} axisLine={false} {...AXIS} />
          <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} {...AXIS} />
          <ChartTooltip />
          <Bar dataKey={valueKey} radius={[6, 6, 0, 0]} maxBarSize={48}>
            {data.map((_, i) => (
              <Cell key={i} fill={String(fills[Math.min(i, fills.length - 1)])} />
            ))}
            <LabelList
              dataKey={valueKey}
              position="top"
              className="tabular"
              style={{ fill: "rgb(var(--ink-muted))", fontSize: 12 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
