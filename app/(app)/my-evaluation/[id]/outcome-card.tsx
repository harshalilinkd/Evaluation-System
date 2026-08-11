/**
 * What the employee sees once their evaluation closes (P21).
 *
 * §9 and the cycle's disclosure policy, and NO MORE. There is no prop here for
 * a rating, a gap, a remark or a department median — `EmployeeOutcome` carries
 * only what they may see, so this component could not render one if it tried.
 * That is deliberate: the safest way to keep a figure off a screen is for the
 * screen to have no way to reach it.
 */

import { CheckCircle2 } from "lucide-react";

import { monthlyFromAnnual } from "@/lib/increment/calc";
import type { EmployeeOutcome } from "@/lib/increment/queries";
import { formatDate, formatInr } from "@/lib/utils/date";

export function OutcomeCard({ outcome }: { outcome: EmployeeOutcome }) {
  return (
    <section className="rounded-card-lg border border-final/40 bg-final-tint p-6">
      <h2 className="flex items-center gap-2 font-sans text-display-sm text-final">
        <CheckCircle2 className="size-5" aria-hidden />
        Your evaluation is complete
      </h2>

      <p className="mt-2 font-sans text-body text-ink">
        Thank you for filling it in. It has been reviewed and closed.
      </p>

      {/* The key is ABSENT unless this is an increment cycle and the disclosure
          policy allows it — omitted, not blanked (P20-3). So there is no empty
          salary row to explain away when there is nothing to tell them. */}
      {outcome.newCtc !== undefined ? (
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-control border border-rule bg-surface p-4">
            {/* -- MONTHLY LEADS, the annual figure follows as context.
                  0061 moved what the employee TYPES to a monthly figure, so a
                  bare annual number under "Your new salary" is read against the
                  wrong unit by the one person it matters most to. Same shape as
                  the current-salary readout on the self form (P34-7): monthly is
                  what they think in, annual is what appears on their letter, and
                  dropping either makes the two look like they disagree. -- */}
            <dt className="type-label text-ink-muted">Your new salary</dt>
            <dd className="tabular text-display-md text-ink">
              {formatInr(monthlyFromAnnual(outcome.newCtc ?? null))} a month
            </dd>
            <p className="tabular mt-1 text-body-sm text-ink-muted">
              {formatInr(outcome.newCtc ?? null)} a year
            </p>
          </div>
          {outcome.effectiveFrom ? (
            <div className="rounded-control border border-rule bg-surface p-4">
              <dt className="type-label text-ink-muted">Effective from</dt>
              <dd className="tabular text-display-md text-ink">{formatDate(outcome.effectiveFrom)}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <p className="mt-4 font-sans text-body-sm text-ink-muted">
        Speak to HR if you have any questions about your evaluation.
      </p>
    </section>
  );
}
