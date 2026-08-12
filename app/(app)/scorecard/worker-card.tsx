/** A production worker's own appraisal history. Server component. */

import { HardHat } from "lucide-react";

import { EmptyState } from "@/components/appraise/states";
import { DashboardCard } from "@/components/appraise/metric-widget";
import type { WorkerScorecard } from "@/lib/worker/scorecard";
import { formatDate } from "@/lib/utils/date";
import { cn } from "@/lib/utils";

/* -- The three ticks, spelled as the source form spells them.
      §17 forbids improving wording that came from a source form, and §6 fixes
      the three cells — so these are read from one map rather than retyped per
      screen. No numeral: §6.2 keeps the 5/3/1 analytics mapping off a worker's
      own sheet, and this is the most worker-facing surface there is. -- */
const TICK_WORD: Record<string, string> = {
  EXCELLENT: "Excellent",
  SATISFACTORY: "Satisfactory",
  NEEDS_IMPROVEMENT: "Needs Improvement",
};

/** What somebody is waiting for, in the words §8 gives an employee. */
const STAGE_WORD: Record<string, string> = {
  DRAFT: "Not started",
  OPEN: "In progress",
  PENDING_REVIEW: "Under review",
  REVIEWED: "Under review",
  CLOSED: "Completed",
};

export function WorkerScorecardCard({
  card,
  isSelf,
  name,
}: {
  card: WorkerScorecard;
  isSelf: boolean;
  name: string;
}) {
  if (card.rounds.length === 0) {
    return (
      <EmptyState
        title={isSelf ? "No appraisals yet" : `Nothing recorded for ${name} yet`}
        body="Production appraisals appear here once a round has been started. Your supervisor fills the sheet and HR reviews it."
      />
    );
  }

  // Narrowed rather than asserted: the empty case returned above, and the
  // compiler is right that `[0]` on an array is not a proof of that.
  const [latest] = card.rounds;
  if (!latest) return null;

  return (
    <div className="space-y-4">
      <DashboardCard title={isSelf ? "Your latest appraisal" : `${name}'s latest appraisal`}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="min-w-0">
            <p className="font-sans text-body text-ink">{latest.cycleName}</p>
            <p className="font-sans text-body-sm text-ink-muted">{latest.periodLabel}</p>
          </div>
          <div className="text-right">
            {/* §11 on this track: the overall IS the supervisor's tick, never a
                mean — so it is shown as the word, never as a score. */}
            <p className="font-sans text-display-sm text-ink">
              {latest.overallTick ? TICK_WORD[latest.overallTick] : "—"}
            </p>
            <p className="font-sans text-body-sm text-ink-muted">
              {latest.overallTick ? "Overall performance" : STAGE_WORD[latest.status] ?? "In progress"}
            </p>
          </div>
        </div>
      </DashboardCard>

      <DashboardCard title="Every appraisal">
        {/* The table scrolls, the page does not — three columns of words and a
            date exceed 375px on their own (FIX-21). */}
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[20rem] border-collapse">
            <thead>
              <tr className="border-b border-rule">
                {["Round", "Period", "Overall", "Stage"].map((h) => (
                  <th key={h} scope="col" className="type-label py-2 text-left font-bold text-ink">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {card.rounds.map((round) => (
                <tr key={round.evaluationId} className="border-b border-rule last:border-b-0">
                  <td className="py-2.5 font-sans text-body-sm text-ink">{round.cycleName}</td>
                  <td className="py-2.5 font-sans text-body-sm text-ink-muted">
                    {round.periodLabel}
                  </td>
                  <td
                    className={cn(
                      "py-2.5 font-sans text-body-sm",
                      round.overallTick ? "text-ink" : "text-ink-muted",
                    )}
                  >
                    {round.overallTick ? TICK_WORD[round.overallTick] : "—"}
                  </td>
                  <td className="py-2.5 font-sans text-body-sm text-ink-muted">
                    {STAGE_WORD[round.status] ?? round.status}
                    {round.closedAt ? ` · ${formatDate(round.closedAt)}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DashboardCard>

      {/* -- Said plainly, because the absence is deliberate and would otherwise
            read as missing data. 0047 admits a worker to their own SELF layer
            only; the supervisor's per-quality ticks and comment are readable by
            the supervisor, HR and management. That is a disclosure decision made
            in the database, not on this screen. -- */}
      {isSelf ? (
        <p className="flex items-start gap-2 font-sans text-body-sm text-ink-muted">
          <HardHat aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            Your overall result is shown here. The quality-by-quality ticks and your
            supervisor&rsquo;s written comments go to HR and management — ask your supervisor if you
            would like to talk them through.
          </span>
        </p>
      ) : null}
    </div>
  );
}
