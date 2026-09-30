/** Where a production appraisal is, who has it, and whether it is your turn. */

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils/date";

/*
 * WHY THIS EXISTS.
 *
 * Every complaint about the production appraisal came back to one question
 * nobody's screen answered: where is it, and whose move is it. The board had a
 * sentence per row; the review screen had a banner only once it had reached
 * management; the team leader's list dropped a sheet the moment it was
 * submitted; the supervisor saw "no longer with you" and nothing more. So an
 * appraisal disappeared from each person's view at the moment they finished
 * their part, and the next person did not know it had arrived.
 *
 * One tracker, drawn from the same five facts on every screen, so the team
 * leader, the supervisor, HR and management all see the same picture of the
 * same appraisal.
 *
 * NOT THE STAFF `ProgressRail`, deliberately. That one is built on the staff
 * statuses and paints each step in a tier colour (§13.1), and §7 forbids
 * refactoring a staff component to serve the worker module. Nothing here is a
 * tier: done is a tick, now is the primary colour, and each step carries its
 * own words, so colour is never the only signal (§13.8).
 */

export type WorkerProgressInput = {
  status: string;
  /** Who ticks the sheet (`supervisor_id`). */
  teamLeader: string | null;
  /** Who reviews the ticks (`reviewer_id`). Null on a round with no review. */
  reviewer: string | null;
  /** The team leader IS the reviewer — one form, one step (0101). */
  combined: boolean;
  ratedAt: string | null;
  reviewedAt: string | null;
  sentUpAt: string | null;
  approvedAt: string | null;
};

/** Which of the steps the person looking at the screen is responsible for. */
export type WorkerProgressViewer = {
  teamLeader?: boolean;
  reviewer?: boolean;
  hr?: boolean;
  md?: boolean;
};

export type WorkerStep = {
  key: "rate" | "review" | "price" | "approve";
  label: string;
  who: string;
  state: "done" | "now" | "later";
  at: string | null;
  /** True when the viewer is the one this step is waiting on. */
  yours: boolean;
};

/* The status each step is WAITING at. Anything past it means the step is done. */
const ORDER = ["OPEN", "PENDING_SUPERVISOR", "PENDING_REVIEW", "REVIEWED", "CLOSED"] as const;

function position(status: string): number {
  const i = ORDER.indexOf(status as (typeof ORDER)[number]);
  // An unknown status sorts as "not started" rather than as finished: a
  // tracker that marks every step done on a value it does not recognise would
  // be claiming work nobody did.
  return i === -1 ? 0 : i;
}

/**
 * The steps, worked out from the facts. Pure, so it can be tested rather than
 * restated — a probe that reimplements this is not a check of it (FIX-12).
 */
export function workerSteps(
  input: WorkerProgressInput,
  viewer: WorkerProgressViewer = {},
): WorkerStep[] {
  const at = position(input.status);
  /* A separate review step exists only where somebody OTHER than the team
     leader reviews. Combined is one person and one press; a round with no
     reviewer (every one launched before 0100) goes straight to HR. */
  const separateReview = input.reviewer !== null && !input.combined;

  const state = (waitingAt: number, doneFrom: number): WorkerStep["state"] =>
    at >= doneFrom ? "done" : at === waitingAt ? "now" : "later";

  const steps: WorkerStep[] = [
    {
      key: "rate",
      label: input.combined ? "Rated and reviewed" : "Ratings",
      who: input.teamLeader ?? "Team leader",
      // Done once the sheet has left OPEN: to the supervisor, or straight on.
      state: state(0, 1),
      at: input.ratedAt,
      yours: Boolean(viewer.teamLeader || (input.combined && viewer.reviewer)),
    },
  ];

  if (separateReview) {
    steps.push({
      key: "review",
      label: "Supervisor review",
      who: input.reviewer ?? "Supervisor",
      state: state(1, 2),
      at: input.reviewedAt,
      yours: Boolean(viewer.reviewer),
    });
  }

  steps.push(
    {
      key: "price",
      label: "Salary set",
      who: "HR",
      state: state(2, 3),
      at: input.sentUpAt,
      yours: Boolean(viewer.hr),
    },
    {
      key: "approve",
      label: "Approved",
      who: "Management",
      state: state(3, 4),
      at: input.approvedAt,
      yours: Boolean(viewer.md),
    },
  );

  return steps;
}

/** One sentence: what is happening now, said to the person reading it. */
export function workerNowLine(steps: readonly WorkerStep[]): string {
  const now = steps.find((s) => s.state === "now");
  if (!now) return "Finished. Nothing more is needed from anybody.";

  if (now.yours) {
    switch (now.key) {
      case "rate":
        return "Your turn — tick the eight qualities and submit.";
      case "review":
        return "Your turn — read the ratings and record your decision.";
      case "price":
        return "Your turn — set the salary and send it to management.";
      case "approve":
        return "Your turn — approve it, or send it back to HR.";
    }
  }

  switch (now.key) {
    case "rate":
      return `Waiting on ${now.who} to fill in the ratings.`;
    case "review":
      return `Waiting on ${now.who} to review the ratings.`;
    case "price":
      return "With HR, who set the salary and send it to management.";
    case "approve":
      return "With management for approval.";
  }
}

export function WorkerProgress({
  input,
  viewer,
  className,
}: {
  input: WorkerProgressInput;
  viewer?: WorkerProgressViewer;
  className?: string;
}) {
  const steps = workerSteps(input, viewer);
  const now = steps.find((s) => s.state === "now");

  return (
    <section
      aria-label="Where this appraisal is"
      className={cn("card-surface space-y-4 p-4 sm:p-5", className)}
    >
      <p
        className={cn(
          "font-sans text-body",
          now?.yours ? "font-medium text-ink" : "text-ink-muted",
        )}
      >
        {workerNowLine(steps)}
      </p>

      {/* Stacked on a phone, one row from `sm`. The steps are few and their
          names short, so a row fits; stacked, each keeps its name, its person
          and its date on their own lines rather than truncating any of them. */}
      <ol
        className={cn(
          "grid gap-3",
          steps.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-4",
        )}
      >
        {steps.map((step, index) => (
          <li
            key={step.key}
            aria-current={step.state === "now" ? "step" : undefined}
            className={cn(
              "flex items-start gap-3 rounded-control p-3",
              step.state === "now" && "bg-accent",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-pill border font-sans text-body-sm tabular",
                step.state === "done" && "border-success bg-success text-ink-invert",
                step.state === "now" && "border-primary bg-primary text-ink-invert",
                step.state === "later" && "border-rule bg-surface text-ink-muted",
              )}
            >
              {step.state === "done" ? <Check className="size-4" /> : index + 1}
            </span>

            <span className="min-w-0">
              <span className="block font-sans text-body-sm font-medium text-ink">
                {step.label}
                <span className="sr-only">
                  {step.state === "done" ? " — done" : step.state === "now" ? " — now" : " — not yet"}
                </span>
              </span>
              <span className="block truncate font-sans text-body-sm text-ink-muted">
                {step.yours ? "You" : step.who}
              </span>
              <span className="block font-sans text-body-sm text-ink-muted">
                {step.state === "done"
                  ? step.at
                    ? formatDate(step.at)
                    : "Done"
                  : step.state === "now"
                    ? step.yours
                      ? "Your turn"
                      : "In progress"
                    : "Not yet"}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
