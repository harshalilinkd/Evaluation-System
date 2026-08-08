/** EmptyState, ErrorState and TableSkeleton. DESIGN.md §8 copy tone, §13.4 no dead ends. */

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * §13.4: "every list has an empty state, every async action has a loading state,
 * every error states what to do next."
 *
 * The copy passed in should follow §8 — plain, warm, adult, no exclamation
 * marks, no emoji, no "Oops!". The worked example there is the bar:
 * "No evaluations are open for you right now. You'll get a WhatsApp message when
 * the next cycle starts."
 */
export function EmptyState({
  title,
  body,
  action,
  icon,
  className,
}: {
  title: string;
  body: string;
  action?: ReactNode;
  /** DESIGN.md §7: an empty state may carry an illustration. Decorative only. */
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-card border border-dashed border-rule bg-surface px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        // aria-hidden on the wrapper: the title already says what is missing, and
        // a screen reader announcing an icon name adds nothing.
        <span aria-hidden className="flex size-12 items-center justify-center rounded-pill bg-accent text-primary">
          {icon}
        </span>
      ) : null}
      <p className="font-sans text-body-lg text-ink">{title}</p>
      <p className="max-w-form font-sans text-body text-ink-muted">{body}</p>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

/**
 * An error the user can act on.
 *
 * `detail` is for a code or a reference someone might quote to HR — never a
 * stack trace and never a raw status enum (§8). §0.7 forbids swallowing an
 * error into a blank screen; this is what "loudly" should look like.
 */
export function ErrorState({
  title = "Something went wrong",
  body,
  detail,
  action,
  className,
}: {
  title?: string;
  body: string;
  detail?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "space-y-3 rounded-card border border-critical/40 bg-critical-tint px-6 py-6",
        className,
      )}
      role="alert"
    >
      <p className="font-sans text-body-lg text-ink">{title}</p>
      <p className="font-sans text-body text-ink-muted">{body}</p>
      {detail ? <p className="tabular text-body-sm text-ink-muted">{detail}</p> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

/**
 * Loading placeholder for a table.
 *
 * Rows are 44px to match §4's compact density on HR and MD tables, so the
 * skeleton occupies the same space the real rows will — the point of a skeleton
 * is that nothing jumps when the data arrives.
 */
export function TableSkeleton({
  rows = 5,
  columns = 4,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("overflow-hidden card-surface", className)}
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading</span>

      <div className="flex h-11 items-center gap-4 border-b border-rule bg-surface-mute px-4">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1 rounded-sm" />
        ))}
      </div>

      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          className="flex h-11 items-center gap-4 border-b border-rule px-4 last:border-b-0"
        >
          {Array.from({ length: columns }).map((_, colIndex) => (
            <Skeleton
              key={colIndex}
              className="h-3 flex-1 rounded-sm"
              // Slight variation so it reads as content rather than a grid.
              style={{ opacity: colIndex === 0 ? 1 : 0.7 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
