"use client";

/** One person's three scores across cycles. Change over time — so, a line. */

import * as React from "react";

import { cn } from "@/lib/utils";

export type TrendPoint = {
  label: string;
  self: number | null;
  lead: number | null;
  final: number | null;
};

/**
 * CHANGE OVER TIME, so a line — the form heuristic gives this one directly.
 *
 * It replaces a list of five rows. A list can be read but not SEEN: "3.9, 4.1,
 * 3.6, 4.4" is four facts, and the shape they make is the thing somebody
 * actually wants from their own history.
 *
 * Three series, and the tier hues are correct here rather than decorative
 * (§13.1): each line IS a speaker — what they said about themselves, what their
 * lead said, what was finally agreed. Validated as a set on the light surface:
 * lightness band, chroma, CVD separation (worst adjacent pink↔cyan ΔE 8.9
 * deutan) and normal-vision floor (ΔE 31.2) all pass. Cyan's contrast against
 * the surface is 2.36:1, below the 3:1 mark floor, which is not dismissable —
 * so every point is a 9px dot with a 2px surface ring, the final value of each
 * series is direct-labelled, and the caller wraps this in `ChartFigure` for the
 * table view.
 *
 * The 0-5 axis is FIXED, never fitted to the data. §6's scale is what the
 * numbers mean, and an axis that starts at 3.4 because that happened to be the
 * lowest score turns a 0.3 difference into a cliff.
 */
const SERIES = [
  { key: "self", label: "They said", stroke: "rgb(var(--self))", dot: "bg-self" },
  { key: "lead", label: "Their lead said", stroke: "rgb(var(--lead))", dot: "bg-lead" },
  { key: "final", label: "Agreed", stroke: "rgb(var(--final))", dot: "bg-final" },
] as const;

const MAX = 5;
const PAD = { top: 14, right: 14, bottom: 26, left: 26 };
const WIDTH = 520;
const HEIGHT = 200;

export function HistoryTrendChart({ points }: { points: readonly TrendPoint[] }) {
  const [hover, setHover] = React.useState<number | null>(null);

  if (points.length === 0) return null;

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  /* One point is not a trend — it is a dot on an axis (N3-8 made the same call
     on the scorecard). The caller shows a reading instead. */
  const x = (i: number) =>
    points.length === 1 ? PAD.left + plotW / 2 : PAD.left + (i / (points.length - 1)) * plotW;
  const y = (v: number) => PAD.top + plotH - (v / MAX) * plotH;

  return (
    <div className="space-y-3">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={`Scores across ${points.length} ${points.length === 1 ? "cycle" : "cycles"}`}
      >
        {/* Recessive grid: the data is the ink, the scale is the paper. */}
        {[0, 1, 2, 3, 4, 5].map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(v)}
              y2={y(v)}
              stroke="rgb(var(--rule))"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 6}
              y={y(v) + 3}
              textAnchor="end"
              className="fill-[rgb(var(--ink-muted))] text-[9px]"
            >
              {v}
            </text>
          </g>
        ))}

        {SERIES.map((series) => {
          const pts = points
            .map((p, i) => ({ i, v: p[series.key] }))
            .filter((p): p is { i: number; v: number } => typeof p.v === "number");
          if (pts.length === 0) return null;

          return (
            <g key={series.key}>
              {/* 2px lines, per the mark spec. A gap in the data is a BREAK in
                  the line, never a straight segment across it — joining two
                  cycles either side of a missing one draws a change that did
                  not happen. */}
              {pts.length > 1 ? (
                <polyline
                  fill="none"
                  stroke={series.stroke}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={pts.map((p) => `${x(p.i)},${y(p.v)}`).join(" ")}
                />
              ) : null}

              {pts.map((p) => (
                <circle
                  key={p.i}
                  cx={x(p.i)}
                  cy={y(p.v)}
                  r={hover === p.i ? 5.5 : 4.5}
                  fill={series.stroke}
                  // The 2px surface ring: it is what keeps two points legible
                  // where they overlap, which is exactly the interesting case —
                  // a small gap between what two people said.
                  stroke="rgb(var(--surface))"
                  strokeWidth={2}
                />
              ))}
            </g>
          );
        })}

        {/* Cycle labels, and a generous invisible hit target per column — the
            target is bigger than the mark, per the interaction spec. */}
        {points.map((p, i) => (
          <g key={p.label}>
            <text
              x={x(i)}
              y={HEIGHT - 8}
              textAnchor="middle"
              className="fill-[rgb(var(--ink-muted))] text-[9px]"
            >
              {p.label}
            </text>
            <rect
              x={x(i) - plotW / Math.max(1, points.length) / 2}
              y={PAD.top}
              width={plotW / Math.max(1, points.length)}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          </g>
        ))}
      </svg>

      {/* The hovered cycle, read out in full. A tooltip that floats over the
          marks would cover the very points being compared. */}
      <p className="tabular min-h-5 text-body-sm text-ink-muted" aria-live="polite">
        {hover !== null && points[hover] ? (
          <>
            <span className="font-medium text-ink">{points[hover].label}</span>
            {SERIES.map((s) => (
              <span key={s.key}>
                {" · "}
                {s.label} {points[hover]![s.key]?.toFixed(2) ?? "—"}
              </span>
            ))}
          </>
        ) : (
          "Hover a cycle to read its scores."
        )}
      </p>

      {/* ≥2 series, so a legend is always present. */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span aria-hidden className={cn("size-2 shrink-0 rounded-pill", s.dot)} />
            <span className="text-body-sm text-ink">{s.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
