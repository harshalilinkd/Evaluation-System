"use client";

/** The round board. Every row says what is outstanding and who is holding it. */

import * as React from "react";
import Link from "next/link";
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
import { formatDate, formatInr } from "@/lib/utils/date";

/* §17 keeps the source form's wording; these are the three cells it prints. */
const OVERALL_WORD: Record<string, string> = {
  EXCELLENT: "Excellent",
  SATISFACTORY: "Satisfactory",
  NEEDS_IMPROVEMENT: "Needs improvement",
};
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
  department: string | null;
  trainingRequired: boolean | null;
  /* -- §5 data, on a screen guarded to HR and the MD. Null where nobody has
        recorded it, never 0 — a salary of zero is a different claim from one
        that has not been entered (P7-9). -- */
  salaryChanged: boolean | null;
  newCtc: number | null;
  incrementPct: number | null;
  currentCtc: number | null;
  lastIncrementDate: string | null;
  nextIncrementDate: string | null;
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
  if (row.supervisorIn) {
    return { text: "Filled in — ready for your review", tone: "ready" };
  }
  return { text: `Waiting on ${row.supervisorName} to fill it in`, tone: "wait" };
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

  /* Ready means the supervisor has submitted AND nobody has reviewed it — the
     only state on this screen HR can act on. Counting reviewed ones too meant
     the number never fell as they worked through them. */
  const inProgress = rows.filter((r) => r.status === "OPEN").length;
  const readyCount = rows.filter((r) => r.status === "PENDING_REVIEW").length;
  const withMd = rows.filter((r) => r.status === "REVIEWED").length;
  const closedCount = rows.filter((r) => r.status === "CLOSED").length;

  /* -- The tiles are the filter, because a count above a list it describes
        invites a press and there was nothing behind it. Three states and no
        "All" tile: the ACTIVE one toggles off, which is one control rather than
        four and means the row cannot end up with nothing selected. -- */
  const [filter, setFilter] = React.useState<
    "all" | "waiting" | "ready" | "md" | "closed"
  >("all");

  const visible = React.useMemo(() => {
    /* Keyed on the STATUS, not on the timestamps. The status is the one thing
       that distinguishes "waiting for HR" from "with the MD" — both have the
       supervisor's side in, so a timestamp cannot tell them apart. */
    if (filter === "waiting") return rows.filter((r) => r.status === "OPEN");
    if (filter === "ready") return rows.filter((r) => r.status === "PENDING_REVIEW");
    if (filter === "md") return rows.filter((r) => r.status === "REVIEWED");
    if (filter === "closed") return rows.filter((r) => r.status === "CLOSED");
    return rows;
  }, [rows, filter]);

  const toggle = (next: "waiting" | "ready" | "md" | "closed") =>
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
        id: "supervisor",
        header: "Filled in",
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
        id: "department",
        header: "Department",
        size: 150,
        cell: ({ row }) => <GridCell value={row.original.department ?? "—"} />,
      },
      {
        id: "overall",
        header: "Overall",
        size: 150,
        cell: ({ row }) => (
          <GridCell
            value={
              row.original.overallTick
                ? (OVERALL_WORD[row.original.overallTick] ?? row.original.overallTick)
                : "—"
            }
          />
        ),
      },
      {
        id: "training",
        header: "Training",
        size: 110,
        cell: ({ row }) => (
          <GridCell
            value={
              row.original.trainingRequired === null
                ? "—"
                : row.original.trainingRequired
                  ? "Yes"
                  : "No"
            }
          />
        ),
      },
      {
        /* -- Pay, in one column rather than four.
              Old, new, percent and "same or new" as separate columns would be
              four headings for one decision, three of them blank on every
              appraisal that changes nothing — which is most of them. One column
              that says either "No change" or "+15% to ₹2,40,000" carries the
              whole answer and stays readable at a glance. -- */
        id: "salary",
        header: "Salary",
        size: 190,
        cell: ({ row }) => {
          const r = row.original;
          if (r.salaryChanged === null) return <GridCell value="—" />;
          if (!r.salaryChanged) return <GridCell value="No change" />;
          const pct = r.incrementPct === null ? null : `+${r.incrementPct}%`;
          const to = r.newCtc === null ? null : formatInr(r.newCtc);
          return <GridCell value={[pct, to].filter(Boolean).join(" to ") || "New salary"} />;
        },
      },
      {
        id: "lastIncrement",
        header: "Last increment",
        size: 150,
        cell: ({ row }) => (
          <GridCell
            value={
              row.original.lastIncrementDate ? formatDate(row.original.lastIncrementDate) : "—"
            }
          />
        ),
      },
      {
        /* -- The way in to the review.
              The row-detail dialog answers "what is on this row"; it cannot
              answer "and now let me approve it", because approving is a
              different screen with the ticks, the comment and the salary on it.
              A board that says "ready for your review" and offers nothing to
              press is the gap this closes. -- */
        id: "open",
        header: "",
        size: 110,
        cell: ({ row }) =>
          row.original.supervisorIn ? (
            <Link
              href={`/admin/worker-appraisals/${cycle.id}/${row.original.id}`}
              className="font-sans text-body-sm font-medium text-primary underline underline-offset-2"
            >
              {row.original.status === "REVIEWED" || row.original.status === "CLOSED"
                ? "View"
                : "Review"}
            </Link>
          ) : null,
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
        {/* -- THE STAGES, in the order an appraisal passes through them.
              They were "In this round / Ready for you / With their supervisor",
              which mixed a TOTAL with two of its own parts — the numbers summed
              to each other, so the first was arithmetic on the other two and
              read as a third finding.

              These are three points on one journey instead, which is what
              somebody scanning the screen is actually trying to place a row in.

              WITH MANAGEMENT appears only when it has something to report. Most
              rounds never use Send to MD, and a permanent zero is a column
              teaching people to ignore it — but leaving the state out entirely
              would let rows vanish from every count, which is worse than a
              fourth card. -- */}
        <KpiRow>
          <KpiCard
            label="In progress"
            value={inProgress}
            caption="with their supervisor"
            tone="plain"
            onSelect={() => toggle("waiting")}
            active={filter === "waiting"}
          />
          <KpiCard
            label="Ready for you"
            value={readyCount}
            caption="filled in, not yet reviewed"
            tone="final"
            onSelect={() => toggle("ready")}
            active={filter === "ready"}
          />
          {withMd > 0 ? (
            <KpiCard
              label="With management"
              value={withMd}
              caption="sent to the MD to sign off"
              tone="lead"
              onSelect={() => toggle("md")}
              active={filter === "md"}
            />
          ) : null}
          <KpiCard
            label="Closed"
            value={closedCount}
            caption="finished"
            tone="plain"
            onSelect={() => toggle("closed")}
            active={filter === "closed"}
          />
        </KpiRow>

        {/* -- A way back, said out loud.
              Pressing the active card again clears it, and nobody knows that.
              The "In this round" card used to be the way out; now that the
              cards are stages rather than a total plus its parts, the escape
              has to be its own thing or a filtered board is a dead end
              (§13.4). -- */}
        {filter !== "all" ? (
          <p className="font-sans text-body-sm text-ink-muted">
            Showing {visible.length} of {rows.length}.{" "}
            <button
              type="button"
              onClick={() => setFilter("all")}
              className="font-medium text-primary underline underline-offset-2"
            >
              Show all
            </button>
          </p>
        ) : null}

        {/* -- Said once, above the grid, because it is the answer to "so what do
              I do now" for the whole round rather than for one row. HR fills
              neither sheet, and a screen that does not say so leaves somebody
              looking for a button that should not exist. -- */}
        <p className="font-sans text-body-sm text-ink-muted">
          You do not fill the sheet. Each supervisor completes it from{" "}
          <span className="font-medium text-ink">Shop floor</span> in their own menu, and it reaches
          you when they submit. The worker fills nothing.
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
