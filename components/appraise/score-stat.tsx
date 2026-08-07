/** ScoreStat — a mono numeral with a caption. Used across dashboards. */

import { cn } from "@/lib/utils";
import { formatScore } from "@/lib/utils/date";
import { TIER_CLASSES, type Tier } from "@/components/appraise/tier";

export type ScoreStatProps = {
  label: string;
  value: number | string | null | undefined;
  /** Tints the numeral and the surface. Omit for a figure that belongs to no tier. */
  tier?: Tier;
  /** e.g. "of 5" or "12 questions". */
  caption?: string;
  /** Δ chips and counts are not scores; skip the two-decimal treatment. */
  raw?: boolean;
  className?: string;
};

/**
 * §3: "Every number in a table or card uses mono with tabular-nums so columns
 * align" — and §1: a score should read as a fact, not a decoration.
 *
 * An absent score renders as an em dash, never as 0. §11 is explicit that a
 * missing value is not a zero, and a dashboard showing 0.00 for an unstarted
 * appraisal is the kind of thing people escalate about.
 */
export function ScoreStat({ label, value, tier, caption, raw = false, className }: ScoreStatProps) {
  const display =
    typeof value === "string" ? value : raw ? (value ?? "—") : formatScore(value as number | null);

  return (
    <div
      className={cn(
        "rounded-control border p-4",
        tier ? TIER_CLASSES[tier].chip : "border-rule bg-surface",
        className,
      )}
    >
      <p className={cn("type-label", tier ? undefined : "text-ink-muted")}>{label}</p>
      <p
        className={cn(
          "tabular text-display-lg",
          tier ? TIER_CLASSES[tier].numeral : "text-ink",
        )}
      >
        {display}
      </p>
      {caption ? <p className="font-sans text-body-sm text-ink-faint">{caption}</p> : null}
    </div>
  );
}

/**
 * The variance chip from §6.4: sign and magnitude in mono, warning at |Δ| ≥ 2,
 * critical at ≥ 3. Never colours a whole row — only the chip.
 */
export function DeltaChip({
  delta,
  threshold = 2,
  className,
}: {
  delta: number | null;
  threshold?: number;
  className?: string;
}) {
  if (delta === null) {
    return <span className={cn("tabular text-body-sm text-ink-faint", className)}>—</span>;
  }

  const magnitude = Math.abs(delta);
  const level = magnitude >= threshold + 1 ? "critical" : magnitude >= threshold ? "warning" : "none";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill border px-2 py-0.5 tabular text-body-sm",
        level === "critical" && "border-critical/40 bg-critical-tint text-critical",
        level === "warning" && "border-warning/40 bg-warning-tint text-warning",
        level === "none" && "border-rule bg-surface-mute text-ink-muted",
        className,
      )}
    >
      {/* The sign is the point: positive means the lead rated above the employee. */}
      {delta > 0 ? `+${delta.toFixed(2)}` : delta.toFixed(2)}
    </span>
  );
}
