/** The three-tier progress bar. CLAUDE.md §13.1 — tier colours, used as tiers. */

import { cn } from "@/lib/utils";

/**
 * Self / lead / final progress as one bar.
 *
 * This is one of the few places tier colours are correct rather than merely
 * available: each segment counts how many evaluations a given layer has spoken
 * on, which is precisely what cyan, pink and indigo mean (§13.1).
 *
 * THE SEGMENTS ARE CUMULATIVE, AND THE BAR IS DRAWN IN REVERSE.
 *
 * Somebody at MD_FINALIZED has also submitted their self layer and had it
 * reviewed, so self >= lead >= final always. Three overlapping bars stacked
 * back to front — widest first — read as one bar filling up, with the darker
 * indigo advancing inside the cyan. Laying them side by side from exclusive
 * counts would make the bar shrink as work progressed.
 */
export function SegmentedProgress({
  total,
  self,
  lead,
  final,
  className,
  height = "h-2",
}: {
  total: number;
  self: number;
  lead: number;
  final: number;
  className?: string;
  height?: string;
}) {
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

  return (
    <div
      className={cn("relative w-full overflow-hidden rounded-pill bg-surface-mute", height, className)}
      role="img"
      aria-label={
        total === 0
          ? "No participants yet"
          : `${self} of ${total} self-submitted, ${lead} reviewed by a lead, ${final} finalised by the MD`
      }
    >
      {/* Back to front: self is the widest, final the narrowest and darkest. */}
      <span className="absolute inset-y-0 left-0 bg-self" style={{ width: `${pct(self)}%` }} />
      <span className="absolute inset-y-0 left-0 bg-lead" style={{ width: `${pct(lead)}%` }} />
      <span className="absolute inset-y-0 left-0 bg-final" style={{ width: `${pct(final)}%` }} />
    </div>
  );
}

/** The key. Kept beside the bar wherever it appears — three unlabelled colours are a puzzle. */
export function SegmentedLegend({
  self,
  lead,
  final,
  className,
  invert = false,
}: {
  self: number;
  lead: number;
  final: number;
  className?: string;
  invert?: boolean;
}) {
  const items = [
    { label: "Self submitted", value: self, dot: "bg-self" },
    { label: "Lead reviewed", value: lead, dot: "bg-lead" },
    { label: "MD finalised", value: final, dot: "bg-final" },
  ];

  return (
    <ul className={cn("flex flex-wrap items-center gap-x-5 gap-y-2", className)}>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2">
          <span aria-hidden className={cn("size-2 rounded-pill", item.dot)} />
          <span className={cn("text-body-sm", invert ? "text-ink-invert/70" : "text-ink-muted")}>
            {item.label}
          </span>
          <span className={cn("tabular text-body-sm font-medium", invert ? "text-ink-invert" : "text-ink")}>
            {item.value}
          </span>
        </li>
      ))}
    </ul>
  );
}
