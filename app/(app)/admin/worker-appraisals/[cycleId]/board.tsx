"use client";

/** The round board. Every row says what is outstanding and who is holding it. */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import {
  StartRoundDialog,
  type RaterRow,
  type WorkerRow,
} from "@/app/(app)/admin/worker-appraisals/cycles-client";
import { KpiCard, KpiRow } from "@/components/appraise/screen";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils/date";

export type BoardRow = {
  id: string;
  workerName: string;
  supervisorName: string;
  selfIn: boolean;
  supervisorIn: boolean;
  selfSubmittedAt: string | null;
  supervisorSubmittedAt: string | null;
  handedOver: boolean;
  status: string;
  overallTick: string | null;
};

/**
 * WHAT HAPPENS NEXT, per row.
 *
 * The board said "Not yet / Not yet / Open" and stopped, which is a statement
 * of fact with no verb in it — reported, fairly, as "I did not see any next
 * step". A round is chased person by person, so the instruction belongs on the
 * person's row rather than in a paragraph above the table.
 *
 * It names WHO is holding it, because that is the actionable half: HR cannot
 * fill either sheet, so every outstanding row resolves to somebody to ring.
 */
function nextStep(row: BoardRow): { text: string; tone: "wait" | "ready" | "done" } {
  if (row.status === "REVIEWED" || row.status === "CLOSED") {
    return { text: "Finished", tone: "done" };
  }
  if (row.selfIn && row.supervisorIn) {
    return { text: "Both sides in — ready for your review", tone: "ready" };
  }
  if (!row.selfIn && !row.supervisorIn) {
    return { text: `Waiting on ${row.supervisorName} to run both steps`, tone: "wait" };
  }
  if (!row.selfIn) {
    return { text: `${row.supervisorName} still to hand ${row.workerName} the form`, tone: "wait" };
  }
  return { text: `Waiting on ${row.supervisorName} to rate them`, tone: "wait" };
}

export function WorkerBoard({
  cycle,
  allCycles,
  rows,
  workers,
  raters,
}: {
  cycle: {
    id: string;
    name: string;
    period_label: string;
    status: string;
    supervisor_due_on: string | null;
  };
  allCycles: Array<{ id: string; name: string; period_label: string }>;
  rows: BoardRow[];
  workers: WorkerRow[];
  raters: RaterRow[];
}) {
  const router = useRouter();
  const [starting, setStarting] = React.useState(false);

  const bothIn = rows.filter((r) => r.selfIn && r.supervisorIn).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-sans text-h2 text-ink">Worker appraisals</h1>
          <p className="mt-1 font-sans text-body-sm text-ink-muted">
            The shop-floor three-tick sheet. The worker and their supervisor tick the same sheet at
            the same time, and neither sees the other&rsquo;s answers.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Only when there is a choice to make. A picker holding one round is
              a control that cannot do anything. */}
          {allCycles.length > 1 ? (
            <select
              value={cycle.id}
              onChange={(e) => router.push(`/admin/worker-appraisals/${e.target.value}`)}
              aria-label="Which round"
              className="min-h-11 rounded-input border border-rule bg-surface px-3 font-sans text-body text-ink"
            >
              {allCycles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.period_label}
                </option>
              ))}
            </select>
          ) : null}

          <Button onClick={() => setStarting(true)} className="min-h-11">
            <Plus className="size-4" aria-hidden />
            Start a round
          </Button>
        </div>
      </header>

      <div>
        <p className="font-sans text-body-lg text-ink">{cycle.name}</p>
        <p className="font-sans text-body-sm text-ink-muted">
          {cycle.period_label} · supervisor due {formatDate(cycle.supervisor_due_on)}
        </p>
      </div>

      <KpiRow>
        <KpiCard label="In this round" value={rows.length} caption="workers" />
        <KpiCard label="Both sides in" value={bothIn} caption="ready for review" tone="final" />
        <KpiCard
          label="Still waiting"
          value={rows.length - bothIn}
          caption="one or both outstanding"
          tone="lead"
        />
      </KpiRow>

      <div className="overflow-x-auto rounded-card border border-rule">
        <table className="w-full">
          <thead>
            <tr className="border-b border-rule bg-surface-mute">
              {["Worker", "Supervisor", "Worker's sheet", "Supervisor's sheet", "What happens next"].map(
                (h) => (
                  <th key={h} scope="col" className="type-label whitespace-nowrap px-4 py-2.5 text-left text-ink">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 font-sans text-body-sm text-ink-muted">
                  Nobody is in this round.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const step = nextStep(row);
                return (
                  <tr key={row.id} className="border-b border-rule last:border-b-0">
                    <td className="px-4 py-3 font-sans text-body-sm text-ink">{row.workerName}</td>
                    <td className="px-4 py-3 font-sans text-body-sm text-ink-muted">
                      {row.supervisorName}
                    </td>
                    {/* Both sides shown, because this screen is HR's — §5 keeps
                        each side from the OTHER, never from HR, who are the one
                        party entitled to see both. */}
                    <td className="whitespace-nowrap px-4 py-3 font-sans text-body-sm text-ink-muted">
                      {row.selfSubmittedAt ? formatDate(row.selfSubmittedAt) : "Not yet"}
                      {/* §17: a hand-over is never shown as though the worker
                          submitted independently. */}
                      {row.handedOver ? (
                        <span className="block text-[11px] text-ink-faint">on their supervisor&rsquo;s device</span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-sans text-body-sm text-ink-muted">
                      {row.supervisorSubmittedAt ? formatDate(row.supervisorSubmittedAt) : "Not yet"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          step.tone === "ready"
                            ? "font-sans text-body-sm font-medium text-primary"
                            : step.tone === "done"
                              ? "font-sans text-body-sm text-ink-muted"
                              : "font-sans text-body-sm text-ink"
                        }
                      >
                        {step.text}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* -- Said once, under the table, because it is the answer to "so what do
            I do now" for the whole round rather than for one row. HR fills
            neither sheet, and a screen that does not say so leaves somebody
            looking for a button that should not exist. -- */}
      <p className="rounded-card bg-accent px-4 py-3 font-sans text-body-sm text-accent-foreground">
        You do not fill either sheet. Each supervisor hands their worker the form to tick, then rates
        them separately — both from <span className="font-medium">Shop floor</span> in their own
        menu. Once both sides are in, the appraisal comes to you.
      </p>

      <StartRoundDialog
        open={starting}
        onOpenChange={setStarting}
        workers={workers}
        raters={raters}
      />
    </div>
  );
}
