/** The three-tier progress bar. CLAUDE.md §13.1 — tier colours, used as tiers. */

import { cn } from "@/lib/utils";

/**
 * Self / lead / final progress as one bar.
 *
 * This is one of the few places tier colours are correct rather than merely
 * available: each segment counts how many evaluations a given layer has spoken
 * on, which is precisely what cyan, pink and indigo mean (§13.1).
 *
 * THE SEGMENTS SIT SIDE BY SIDE, AND THE BAR MEASURES WORK DONE OUT OF WORK DUE.
 *
 * They used to be drawn as three CUMULATIVE bars stacked back to front — self
 * widest, final narrowest — on the reasoning that somebody finalised has also
 * self-submitted. It read correctly only while the three counts differed. The
 * ordinary case is that they do not: with one person whose self and lead layers
 * are both in, self and lead were each 100%, the pink painted straight over the
 * cyan, and the bar was solid pink end to end. It said "finished" beside a
 * figure saying 67%, which is worse than saying nothing.
 *
 * So the denominator is the work, not the people. Every participant owes three
 * answers — their own, their lead's, the MD's — and each segment is its count
 * over that total. The three add up to exactly the completion percentage shown
 * beside the bar, and whatever is left is the track: **filled is done, empty is
 * outstanding**, which is the one thing a progress bar has to say.
 */
const STAGES_PER_PERSON = 3;
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
  const due = total * STAGES_PER_PERSON;
  const share = (n: number) => (due > 0 ? (n / due) * 100 : 0);
  const donePct = Math.round(share(self + lead + final));

  return (
    <div
      className={cn(
        // The track. A visible tone rather than a whisper: it is the half of
        // the bar that says how much is still outstanding, so it has to be
        // legible as a shape, not just as the absence of fill.
        "flex w-full overflow-hidden rounded-pill bg-rule/70",
        height,
        className,
      )}
      role="img"
      aria-label={
        total === 0
          ? "No participants yet"
          : `${donePct}% complete — ${self} of ${total} self-submitted, ${lead} reviewed by a lead, ${final} finalised by the MD`
      }
    >
      {/* Side by side, in the order the work happens. Each is its own share of
          the whole, so together they fill exactly `donePct` and the rest of the
          bar is visibly unfinished. */}
      <span className="bg-self" style={{ width: `${share(self)}%` }} />
      <span className="bg-lead" style={{ width: `${share(lead)}%` }} />
      <span className="bg-final" style={{ width: `${share(final)}%` }} />
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
