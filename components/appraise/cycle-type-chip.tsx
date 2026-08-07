/** Evaluation or Increment. One chip, wherever a cycle is named. */

import { TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * §1: the two types share the same form and the same blind parallel flow, and
 * differ only in how they END. An evaluation cycle stops when the MD has read
 * the report; an increment cycle carries on into salary — HR proposes, the MD
 * approves, then the interview and a confirmed figure.
 *
 * That is a large difference in what happens to the people in it, and nothing
 * on the cycles list or the board said which was which. Two live cycles were
 * indistinguishable, on the screen where somebody chooses which to launch.
 *
 * ONE component, not one per screen. The distinction is the whole point of the
 * chip, and two copies is how the list and the board end up disagreeing about
 * what an increment cycle is called.
 *
 * Never colour alone (§13.8): both carry the word, and the increment badge
 * carries a glyph as well. The ordinary case is deliberately quiet and the one
 * with money attached is emphatic — an increment is where having the wrong
 * cycle open costs somebody a pay review.
 */
export function CycleTypeChip({
  type,
  className,
}: {
  type: "EVALUATION" | "INCREMENT";
  className?: string;
}) {
  if (type === "INCREMENT") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-pill bg-warning-tint px-2 py-0.5 text-body-sm font-medium text-warning",
          className,
        )}
        title="Ends in a salary review: HR proposes, the MD approves, then the interview."
      >
        <TrendingUp aria-hidden className="size-3" />
        Increment
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill bg-surface-mute px-2 py-0.5 text-body-sm text-ink-muted",
        className,
      )}
      title="Ends when the MD has read the report. No salary step."
    >
      Evaluation
    </span>
  );
}
