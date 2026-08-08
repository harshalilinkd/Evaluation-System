/** Where a cycle stands: two parallel sides, then the pipeline. */

// No hooks and no handlers — a server component renders it straight through.

import { ORDINAL_STEPS } from "@/components/appraise/charts";
import { cn } from "@/lib/utils";

/**
 * WHY THIS IS NOT A FUNNEL.
 *
 * A funnel implies survivors narrowing through ordered stages, and the obvious
 * one to draw here — opened → self in → lead in → reviewed → closed — would be
 * WRONG. §1: both sides rate the same form AT THE SAME TIME, blind to each
 * other. The lead does not wait for the employee, so putting them in sequence
 * would tell HR a story the product deliberately does not have. 0027 makes the
 * same point in SQL: `self_submitted` and `lead_reviewed` are read from the two
 * TIMESTAMPS precisely because no single status can order them (P19B-15).
 *
 * So the honest shape is two things:
 *
 *   1. TWO PARALLEL TRACKS — how far each side has got, side by side, in the
 *      reserved tier hues, because "who has answered" is exactly what §13.1
 *      reserves cyan and pink to say.
 *   2. ONE ORDERED BAR — where the RECORDS are, which genuinely is a sequence:
 *      open → with HR → reviewed → closed. Sequential ramp, one hue, light to
 *      dark, because these are positions in one process rather than four kinds
 *      of thing.
 *
 * The four flat stat tiles this replaces gave the same numbers with no
 * denominator and no relationship between them, which is the difference between
 * data and an answer.
 */

export type CycleShape = {
  total: number;
  /** Employee side, from `self_submitted_at`. */
  selfIn: number;
  /** HOD side, from `lead_submitted_at`. Parallel to the above, never after it. */
  leadIn: number;
  withHr: number;
  reviewed: number;
  closed: number;
};

/** Not started is derived, never a column: it is whatever is left. */
function openCount(shape: CycleShape): number {
  return Math.max(0, shape.total - shape.withHr - shape.reviewed - shape.closed);
}

const STAGES = [
  { key: "open", label: "Open", hint: "Still being filled in" },
  { key: "withHr", label: "With HR", hint: "Both sides in, waiting on review" },
  { key: "reviewed", label: "Reviewed", hint: "HR or the MD has read it" },
  { key: "closed", label: "Closed", hint: "Finished and disclosed" },
] as const;

export function CycleShapeChart({ shape }: { shape: CycleShape }) {
  const open = openCount(shape);
  const counts: Record<(typeof STAGES)[number]["key"], number> = {
    open,
    withHr: shape.withHr,
    reviewed: shape.reviewed,
    closed: shape.closed,
  };

  const total = Math.max(1, shape.total);
  const present = STAGES.filter((s) => counts[s.key] > 0);

  return (
    <div className="space-y-6">
      {/* ---------- 1. The two sides, in parallel ---------- */}
      <div className="grid gap-4 sm:grid-cols-2">
        <SideTrack
          label="Employees"
          hint="have submitted their own"
          done={shape.selfIn}
          total={shape.total}
          tone="self"
        />
        <SideTrack
          label="HODs"
          hint="have submitted their rating"
          done={shape.leadIn}
          total={shape.total}
          tone="lead"
        />
      </div>

      {/* ---------- 2. Where the records are ---------- */}
      <div className="space-y-2">
        <p className="type-label text-ink-muted">Where the records are</p>

        {/* A 2px surface gap between segments, per the mark spec — abutting
            fills read as one bar with a colour change rather than as parts. */}
        <div
          className="flex h-4 w-full gap-0.5 overflow-hidden rounded-pill bg-surface-mute"
          role="img"
          aria-label={STAGES.map((s) => `${s.label}: ${counts[s.key]}`).join(". ")}
        >
          {STAGES.map((stage, index) => {
            const value = counts[stage.key];
            if (value === 0) return null;
            return (
              <div
                key={stage.key}
                title={`${stage.label}: ${value} of ${shape.total}`}
                style={{
                  width: `${(value / total) * 100}%`,
                  // Indexed by the stage's POSITION in the pipeline, never by
                  // its row in a result — a colour that follows rank repaints
                  // itself when a stage empties, and a reader who learned "the
                  // dark one is closed" is then misled.
                  backgroundColor: ORDINAL_STEPS[index],
                }}
                className="first:rounded-l-pill last:rounded-r-pill"
              />
            );
          })}
        </div>

        {/* ≥2 series, so a legend is always present — identity is never left to
            colour alone. Only the stages that exist are listed: a legend entry
            for an empty stage is a key to something not on screen. */}
        {present.length > 0 ? (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
            {present.map((stage) => (
              <li key={stage.key} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-pill"
                  style={{ backgroundColor: ORDINAL_STEPS[STAGES.indexOf(stage)] }}
                />
                {/* Text wears text tokens, never the series colour. */}
                <span className="text-body-sm text-ink">{stage.label}</span>
                <span className="tabular text-body-sm font-semibold text-ink">
                  {counts[stage.key]}
                </span>
                <span className="text-body-sm text-ink-muted">· {stage.hint}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body-sm text-ink-muted">
            Nobody is in this cycle yet, so there is nothing to place.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * One side's completion.
 *
 * A bar with the fraction ON it rather than beside it: the number is the thing
 * being read and a legend lookup to find it is a step nobody should have to
 * take. Cyan is 2.36:1 on this surface — below the 3:1 mark floor — so the
 * label is not decoration, it is the relief that makes the bar legible.
 */
function SideTrack({
  label,
  hint,
  done,
  total,
  tone,
}: {
  label: string;
  hint: string;
  done: number;
  total: number;
  tone: "self" | "lead";
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn("size-2 shrink-0 rounded-pill", tone === "self" ? "bg-self" : "bg-lead")}
          />
          <span className="type-label text-ink-muted">{label}</span>
        </span>
        <span className="tabular text-body-sm text-ink">
          <span className="font-semibold">{done}</span>
          <span className="text-ink-muted"> of {total}</span>
        </span>
      </div>

      <div
        className="h-2.5 w-full overflow-hidden rounded-pill bg-surface-mute"
        role="img"
        aria-label={`${label}: ${done} of ${total} submitted, ${pct}%`}
      >
        <div
          className={cn("h-full rounded-pill", tone === "self" ? "bg-self" : "bg-lead")}
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="text-body-sm text-ink-muted">
        {pct}% {hint}
      </p>
    </div>
  );
}
