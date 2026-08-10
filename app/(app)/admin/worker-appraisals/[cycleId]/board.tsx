"use client";

/** The round board. Every row says what is outstanding and who is holding it. */

import * as React from "react";
import { Plus } from "lucide-react";

import {
  StartRoundDialog,
  type RaterRow,
  type WorkerRow,
} from "@/app/(app)/admin/worker-appraisals/cycles-client";
import { DataGrid, GridCell } from "@/components/appraise/data-grid";
import { KpiCard, KpiRow } from "@/components/appraise/screen";
import { EmptyState } from "@/components/appraise/states";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils/date";
import { cn } from "@/lib/utils";
import type { ColumnDef } from "@tanstack/react-table";

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
  rows: BoardRow[];
  workers: WorkerRow[];
  raters: RaterRow[];
}) {
  const [starting, setStarting] = React.useState(false);

  const bothIn = rows.filter((r) => r.selfIn && r.supervisorIn).length;

  /* -- The tiles are the filter, because a count above a list it describes
        invites a press and there was nothing behind it. Three states and no
        "All" tile: the ACTIVE one toggles off, which is one control rather than
        four and means the row cannot end up with nothing selected. -- */
  const [filter, setFilter] = React.useState<"all" | "ready" | "waiting">("all");

  const visible = React.useMemo(() => {
    if (filter === "ready") return rows.filter((r) => r.selfIn && r.supervisorIn);
    if (filter === "waiting") return rows.filter((r) => !(r.selfIn && r.supervisorIn));
    return rows;
  }, [rows, filter]);

  const toggle = (next: "all" | "ready" | "waiting") =>
    setFilter((current) => (current === next ? "all" : next));

  /* ---------- Columns ----------
     Defined once and memoised, because `DataGrid` keys its stored widths on
     column identity — a fresh array each render re-registers every column and
     the remembered widths are lost on the next keystroke anywhere on the page. */
  const columns = React.useMemo<ColumnDef<BoardRow>[]>(
    () => [
      {
        accessorKey: "workerName",
        header: "Worker",
        size: 200,
        cell: ({ row }) => <GridCell value={row.original.workerName} />,
      },
      {
        accessorKey: "supervisorName",
        header: "Supervisor",
        size: 190,
        cell: ({ row }) => <GridCell value={row.original.supervisorName} />,
      },
      {
        id: "self",
        header: "Worker's sheet",
        size: 190,
        cell: ({ row }) => (
          <div className="min-w-0">
            <GridCell value={row.original.selfSubmittedAt ? formatDate(row.original.selfSubmittedAt) : "Not yet"} />
            {/* §17: a hand-over is never shown as though the worker submitted
                independently. */}
            {row.original.handedOver ? (
              <span className="block truncate text-body-sm text-ink-muted">
                on their supervisor&rsquo;s device
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: "supervisor",
        header: "Supervisor's sheet",
        size: 180,
        cell: ({ row }) => (
          <GridCell
            value={
              row.original.supervisorSubmittedAt
                ? formatDate(row.original.supervisorSubmittedAt)
                : "Not yet"
            }
          />
        ),
      },
      {
        id: "next",
        header: "What happens next",
        size: 340,
        cell: ({ row }) => {
          const step = nextStep(row.original);
          return (
            <span
              className={cn(
                "truncate font-sans text-body-sm",
                step.tone === "ready"
                  ? "font-medium text-primary"
                  : step.tone === "done"
                    ? "text-ink-muted"
                    : "text-ink",
              )}
            >
              {step.text}
            </span>
          );
        },
      },
    ],
    [],
  );

  return (
    /* -- The same shell as Evaluation cycles: full-bleed, pinned to the
          viewport, a fixed header bar, the counts, then the grid filling what
          is left. `data-full-bleed` drops the shell's 1180px cap — a roster is a
          grid, and a grid centred in 1180px wastes half a wide monitor
          (UI2-9). -- */
    <div
      data-full-bleed
      className="flex h-[calc(100dvh-theme(spacing.topbar))] min-h-[26rem] flex-col overflow-hidden bg-surface"
    >
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-4 border-b border-rule px-4 py-3 lg:px-6">
        <div className="min-w-0">
          {/* -- `text-h2` was here and is not a class this project defines, so
                Tailwind emitted nothing and preflight rendered the page title at
                plain body size. `display-sm` is the step the type scale actually
                ships, and the one the cycles screen uses. -- */}
          <h1 className="text-display-sm font-semibold text-ink">Worker appraisals</h1>
          <p className="mt-0.5 text-body-sm text-ink-muted">
            {cycle.name} · {cycle.period_label} · supervisor due{" "}
            {formatDate(cycle.supervisor_due_on)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* -- THE ROUND PICKER IS GONE, at the owner's instruction.
                It listed every round in a select — five entries here, three of
                them reading "Floor · Aug" because rounds are free to share a
                name — so it offered a choice nobody could tell apart, to switch
                to a screen reachable from the list one click away.

                Worker Appraisals in the sidebar IS that list, and it shows each
                round with its status and dates. One way to change round, on the
                screen built for it. -- */}
          <Button onClick={() => setStarting(true)} className="min-h-11">
            <Plus className="size-4" aria-hidden />
            Start a round
          </Button>
        </div>
      </div>

      <div className="shrink-0 space-y-3 border-b border-rule px-4 py-3 lg:px-6">
        <KpiRow>
          <KpiCard
            label="In this round"
            value={rows.length}
            caption="workers"
            tone="self"
            onSelect={() => setFilter("all")}
            active={filter === "all"}
          />
          <KpiCard
            label="Both sides in"
            value={bothIn}
            caption="ready for review"
            tone="final"
            onSelect={() => toggle("ready")}
            active={filter === "ready"}
          />
          <KpiCard
            label="Still waiting"
            value={rows.length - bothIn}
            caption="one or both outstanding"
            tone="lead"
            onSelect={() => toggle("waiting")}
            active={filter === "waiting"}
          />
        </KpiRow>

        {/* -- Said once, above the grid, because it is the answer to "so what do
              I do now" for the whole round rather than for one row. HR fills
              neither sheet, and a screen that does not say so leaves somebody
              looking for a button that should not exist. -- */}
        <p className="font-sans text-body-sm text-ink-muted">
          You do not fill either sheet. Each supervisor hands their worker the form to tick, then
          rates them separately — both from <span className="font-medium text-ink">Shop floor</span>{" "}
          in their own menu. Once both sides are in, the appraisal comes to you.
        </p>
      </div>

      <DataGrid
        data={visible}
        columns={columns}
        storageKey="appraise.worker-board.column-widths"
        rowNoun="worker"
        rowTitle={(r) => r.workerName}
        minWidth={1100}
        empty={
          <EmptyState
            title={filter === "all" ? "Nobody is in this round" : "Nothing matches"}
            body={
              filter === "all"
                ? "Start a round and choose who is in it."
                : "Press the same tile again to show everybody."
            }
          />
        }
      />

      <StartRoundDialog
        open={starting}
        onOpenChange={setStarting}
        workers={workers}
        raters={raters}
      />
    </div>
  );
}
