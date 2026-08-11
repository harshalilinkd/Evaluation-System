/** ProgressRail — where the record stands and who is holding it. DESIGN.md §6.6. */

import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils/date";
import type { ChipStatus } from "@/components/appraise/status-chip";

/**
 * Five nodes (§6.6), not six: DRAFT is before the cycle launches, when the
 * employee has nothing to look at. The rail starts where their involvement does.
 *
 * Node colours follow the tier that owns each stage — amber once the employee
 * has submitted, blue once the lead has, emerald once the MD finalises. The
 * first and last are accent and ink-muted, because "in progress" and "closed"
 * belong to no tier and §2 forbids borrowing a tier colour for anything else.
 */
const NODES = [
  {
    status: "CYCLE_ACTIVE" as const,
    internal: "Cycle active",
    employee: "In progress",
    done: "bg-primary border-primary",
    ring: "ring-primary",
  },
  {
    status: "SELF_SUBMITTED" as const,
    internal: "Self submitted",
    employee: "Submitted",
    done: "bg-self border-self",
    ring: "ring-self",
  },
  {
    status: "LEAD_REVIEWED" as const,
    internal: "Manager reviewed",
    employee: "Under review",
    done: "bg-lead border-lead",
    ring: "ring-lead",
  },
  {
    status: "MD_FINALIZED" as const,
    internal: "MD finalized",
    employee: "Under review",
    done: "bg-final border-final",
    ring: "ring-final",
  },
  {
    status: "CLOSED" as const,
    internal: "Closed",
    employee: "Completed",
    done: "bg-ink-muted border-ink-muted",
    ring: "ring-ink-muted",
  },
] as const;

/**
 * StepRail — the same rail, driven by arbitrary steps rather than by §8.
 *
 * P10 asks for "a ProgressRail variant with four nodes" as the wizard stepper.
 * It is a sibling rather than a prop on ProgressRail because the two answer
 * different questions: ProgressRail says where a record stands in the state
 * machine, and its node colours are tier colours carrying tier meaning (§13.1).
 * A wizard step is not a tier, so this one is accent throughout — tinting step 2
 * pink would imply the lead had said something.
 *
 * Steps already visited are clickable, so somebody on step 4 can go back and fix
 * a date without losing their place. Steps ahead are not: they depend on what
 * has not been filled in yet.
 */
export function StepRail({
  steps,
  current,
  furthest,
  onSelect,
  className,
}: {
  steps: readonly string[];
  current: number;
  /** How far they have got, so completed steps stay reachable. */
  furthest: number;
  onSelect?: (index: number) => void;
  className?: string;
}) {
  return (
    <ol className={cn("flex items-center gap-2", className)} aria-label="Steps">
      {steps.map((label, index) => {
        const isComplete = index < current;
        const isCurrent = index === current;
        const reachable = index <= furthest;

        const dot = (
          <span
            aria-current={isCurrent ? "step" : undefined}
            className={cn(
              "block size-3 shrink-0 rounded-pill border transition-colors duration-hover",
              isComplete && "border-primary bg-primary",
              isCurrent && "border-primary bg-background ring-2 ring-primary ring-offset-1 ring-offset-background",
              !isComplete && !isCurrent && "border-rule bg-background",
            )}
          />
        );

        /*
          The label sits BESIDE the dot, not under it.

          Stacked, the rail was a 44px hit target plus a gap plus a line of
          text — near 80px of height before the form began, on a four-step
          wizard where the rail is orientation rather than content. Beside it,
          the row is exactly the height of the target it already has to be.
          The 44px itself does not move: that is §13.8's floor, not padding.
        */
        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <div className="flex shrink-0 items-center gap-2">
              {reachable && onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(index)}
                  // 44px target (§13.2) around a 12px dot: the dot is the
                  // graphic, the padding is the thing you can actually hit.
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-control"
                  aria-label={`Go to step ${index + 1}: ${label}`}
                >
                  {dot}
                </button>
              ) : (
                <span className="flex min-h-11 min-w-11 items-center justify-center">{dot}</span>
              )}

              <span
                className={cn(
                  "hidden whitespace-nowrap font-sans text-body-sm leading-tight sm:block",
                  isCurrent ? "font-medium text-ink" : reachable ? "text-ink-muted" : "text-ink-muted",
                )}
              >
                <span className="tabular">{index + 1}</span> · {label}
              </span>
            </div>

            {index < steps.length - 1 ? (
              <span aria-hidden className={cn("h-px flex-1", isComplete ? "bg-primary" : "bg-rule")} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export type ProgressRailProps = {
  status: ChipStatus;
  /** Whose desk it is on now — "With Nikita Dhawade since 12-08-2026" (§6.6). */
  holderName?: string | null;
  holderSince?: string | Date | null;
  /** §8: employees never see a raw status enum. */
  audience?: "internal" | "employee";
  className?: string;
};

export function ProgressRail({
  status,
  holderName,
  holderSince,
  audience = "internal",
  className,
}: ProgressRailProps) {
  // RETURNED and OVERDUE are not positions on the rail; they describe the stage
  // the record is sitting at. Treat a returned form as back at CYCLE_ACTIVE.
  const effective: ChipStatus =
    status === "RETURNED" ? "CYCLE_ACTIVE" : status === "OVERDUE" ? "CYCLE_ACTIVE" : status;

  const currentIndex = NODES.findIndex((n) => n.status === effective);
  // DRAFT sits before the rail begins: nothing is complete, nothing is current.
  const activeIndex = effective === "DRAFT" ? -1 : currentIndex;

  return (
    <div className={cn("space-y-3", className)}>
      <ol className="flex items-center gap-1" aria-label="Progress">
        {NODES.map((node, index) => {
          const isComplete = activeIndex > index;
          const isCurrent = activeIndex === index;
          const label = audience === "employee" ? node.employee : node.internal;

          return (
            <li key={node.status} className="flex flex-1 items-center gap-1">
              <div className="flex flex-col items-center gap-1.5">
                <span
                  aria-current={isCurrent ? "step" : undefined}
                  className={cn(
                    "block h-3 w-3 shrink-0 rounded-pill border transition-colors duration-hover",
                    isComplete && node.done,
                    // §6.6: the current node is ringed, not filled — it is where
                    // the work is, not where the work is done.
                    isCurrent && cn("bg-background ring-2 ring-offset-1 ring-offset-background", node.ring, node.done.split(" ")[1]),
                    !isComplete && !isCurrent && "border-rule bg-background",
                  )}
                />
                <span
                  className={cn(
                    "hidden whitespace-nowrap text-center font-sans text-[11px] leading-tight sm:block",
                    isCurrent ? "text-ink" : "text-ink-muted",
                  )}
                >
                  {label}
                </span>
              </div>

              {/* The rail itself: a hairline, filled up to where we have got to. */}
              {index < NODES.length - 1 ? (
                <span
                  aria-hidden
                  className={cn(
                    "mb-5 h-px flex-1",
                    activeIndex > index ? "bg-rule" : "bg-rule",
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>

      {/* Mobile has no room for five labels, so name the current stage instead. */}
      <p className="font-sans text-body-sm text-ink-muted sm:hidden">
        {activeIndex >= 0
          ? (audience === "employee" ? NODES[activeIndex]?.employee : NODES[activeIndex]?.internal)
          : "Not started"}
      </p>

      {holderName ? (
        <p className="font-sans text-body-sm text-ink-muted">
          With <span className="text-ink">{holderName}</span>
          {holderSince ? (
            <>
              {" "}
              since <span className="tabular text-body-sm">{formatDate(holderSince)}</span>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
