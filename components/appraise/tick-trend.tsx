"use client";

/** A production worker's overall tick across rounds, drawn as words. */

import { TICK_3_OPTIONS } from "@/components/appraise/tier";
import { cn } from "@/lib/utils";

/* -- THE THREE CELLS COME FROM §6'S CONSTANT, NOT RETYPED.
      §17 forbids improving wording that came from a source form, and there are
      already four transcriptions of these three strings in the tree — a fifth
      is a fifth chance for one of them to drift. `TICK_3_OPTIONS` is the one
      P7-4 established for exactly this.

      REVERSED, because the constant is ordered best-first (as the paper form
      prints it) and a chart's rank has to run worst-first. Derived rather than
      restated, so the two orders cannot disagree. -- */
const RANK: string[] = [...TICK_3_OPTIONS].reverse().map((t) => t.value);
const WORD: Record<string, string> = Object.fromEntries(
  TICK_3_OPTIONS.map((t) => [t.value, t.label]),
);

/* -- One hue, three steps, light to dark.
      The ticks are ORDERED, so they take an ordinal ramp rather than three
      unrelated hues — a reader learns "darker is better" once. Deliberately
      not green/amber/red: that is the status palette, and a worker's own sheet
      is the last place to render a past appraisal as an alarm. -- */
const STEP: Record<string, string> = {
  NEEDS_IMPROVEMENT: "bg-primary/25",
  SATISFACTORY: "bg-primary/55",
  EXCELLENT: "bg-primary",
};

export type TickPoint = { id: string; label: string; tick: string | null };

/**
 * How the overall tick has moved, round by round.
 *
 * NO NUMERAL ANYWHERE, and that is the constraint that shaped it. §6.2 keeps
 * the 5/3/1 analytics mapping off a worker-track form, and this is the most
 * worker-facing surface in the product — so the vertical axis is the three
 * words, the marks carry the word, and nothing on it can be read as a score.
 * The rank exists only to decide a height.
 *
 * Built here rather than on Recharts: the axis is three ordinal labels and the
 * series is one, which is a job for three rows of CSS. Pulling in a cartesian
 * chart to draw it would also have to be argued out of printing a numeric
 * y-axis, which is the one thing it must not do.
 *
 * CHRONOLOGICAL, never sorted by result. Ranking would destroy the only axis
 * that carries the finding.
 */
export function TickTrend({ points }: { points: TickPoint[] }) {
  const rated = points.filter((p) => p.tick !== null);

  /* -- A direction needs two points. One mark on a three-row grid is a dot on
        an axis, which is exactly the "trend line through a single point"
        P33-8 removed from the staff card. -- */
  if (rated.length < 2) return null;

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        {/* The axis: the three words, best at the top. */}
        <div
          aria-hidden
          className="flex shrink-0 flex-col justify-between py-1 text-right text-[11px] leading-none text-ink-muted"
        >
          {TICK_3_OPTIONS.map((t) => (
            <span key={t.value} className="h-4 whitespace-nowrap">
              {t.label}
            </span>
          ))}
        </div>

        {/* -- One column per round. A COLUMN and not a line: the scale is
              ordinal, and a line drawn between two ordinal levels implies the
              positions between them mean something, which they do not — there
              is no half-way between Satisfactory and Excellent. -- */}
        <ol className="flex min-w-0 flex-1 items-end gap-2 overflow-x-auto">
          {rated.map((p) => {
            const rank = RANK.indexOf(p.tick as string);
            const height = ((rank < 0 ? 0 : rank) + 1) / RANK.length;
            return (
              <li key={p.id} className="flex min-w-[3.5rem] flex-1 flex-col items-center gap-1.5">
                <div className="flex h-24 w-full items-end">
                  <div
                    className={cn(
                      "w-full rounded-t-[4px]",
                      STEP[p.tick as string] ?? "bg-surface-mute",
                    )}
                    style={{ height: `${height * 100}%` }}
                  />
                </div>
                {/* -- The word under every column, not only on hover.
                      Identity is never left to shade alone (§13.8), and three
                      steps of one hue is exactly the case where it would be —
                      the ramp is a reading aid, and the word is the reading. -- */}
                <span className="w-full text-center text-[11px] leading-tight text-ink">
                  {WORD[p.tick as string] ?? "—"}
                </span>
                <span className="w-full truncate text-center text-[11px] leading-tight text-ink-muted">
                  {p.label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <p className="text-body-sm text-ink-muted">Oldest first.</p>
    </div>
  );
}
