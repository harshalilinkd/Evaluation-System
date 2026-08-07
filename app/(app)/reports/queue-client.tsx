"use client";

/** The report queue. Sorted by the largest gap — that is where HR's attention pays. */

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Flag, Search } from "lucide-react";

import { DataGrid, GridCell } from "@/components/appraise/data-grid";
import {
  KpiCard,
  KpiRow,
  SCREEN_SELECT_CLASS as SELECT_CLASS,
  ScreenHeader,
  ScreenToolbar,
  TableScreen,
} from "@/components/appraise/screen";
import { StatusChip } from "@/components/appraise/status-chip";
import { EmptyState } from "@/components/appraise/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { QueueRow, ReportQueue } from "@/lib/reports/queries";
import { cn } from "@/lib/utils";

const ANY = "__any__";

/** An absent score is an em dash, never 0.00 — §11, missing is not zero (P7-9). */
function score(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

/** Signed, so the direction reads at a glance. §11 defines it as Lead − Self. */
function gapText(value: number | null): string {
  if (value === null) return "—";
  return value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
}

/**
 * A tier-marked column heading: the hue as a dot, the word in readable ink.
 *
 * The tier used to be the VALUE's text colour, and cyan on white is 2.3:1
 * against §13.8's 4.5:1 floor. §13.1 is unchanged — the tier still says who
 * spoke, it just says it on the heading instead of inside every numeral.
 */
function TierHead({ tier, children }: { tier: "self" | "lead"; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-pill", tier === "self" ? "bg-self" : "bg-lead")}
      />
      {children}
    </span>
  );
}

export function ReportsQueueClient({ queue, isHr }: { queue: ReportQueue; isHr: boolean }) {
  const [cycle, setCycle] = React.useState(ANY);
  const [type, setType] = React.useState(ANY);
  const [department, setDepartment] = React.useState(ANY);
  const [status, setStatus] = React.useState(ANY);
  const [flaggedOnly, setFlaggedOnly] = React.useState(false);
  const [minGap, setMinGap] = React.useState("");
  const [search, setSearch] = React.useState("");

  const rows = React.useMemo(() => {
    const threshold = Number(minGap);
    return queue.rows.filter((r) => {
      if (cycle !== ANY && r.cycleId !== cycle) return false;
      if (type !== ANY && r.cycleType !== type) return false;
      if (department !== ANY && r.department !== department) return false;
      if (status !== ANY && r.status !== status) return false;
      if (flaggedOnly && r.flaggedCount === 0) return false;
      if (minGap !== "" && Number.isFinite(threshold)) {
        if (r.gap === null || Math.abs(r.gap) < threshold) return false;
      }
      if (search.trim()) {
        const needle = search.trim().toLowerCase();
        const haystack = `${r.employeeName} ${r.employeeCode ?? ""} ${r.department ?? ""}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [queue.rows, cycle, type, department, status, flaggedOnly, minGap, search]);

  /* -- ONE GRID, and the cycle is a COLUMN.
        It was a card per cycle, each with its own header and its own <table>.
        The brief asked for grouping, and a column plus the cycle filter beside
        it delivers the same reading with none of the chrome — and it is what
        makes this table the SAME table as the question bank and the roster,
        which is the uniformity that was asked for. `DataGrid` brings the frozen
        header, the frozen name column, drag-to-resize, remembered widths, the
        row gutter and the status bar with it. -- */
  const columns = React.useMemo<ColumnDef<QueueRow>[]>(
    () => [
      {
        accessorKey: "employeeName",
        header: "Employee",
        size: 200,
        meta: { frozen: true },
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-2">
            {row.original.flaggedCount > 0 ? (
              <Flag className="size-3.5 shrink-0 text-critical" aria-hidden />
            ) : null}
            <span
              title={row.original.employeeName}
              className="truncate text-body-sm font-medium text-ink"
            >
              {row.original.employeeName}
            </span>
          </span>
        ),
      },
      {
        accessorKey: "employeeCode",
        header: "Code",
        size: 100,
        cell: ({ row }) => <GridCell value={row.original.employeeCode ?? "—"} className="tabular" />,
      },
      {
        accessorKey: "department",
        header: "Department",
        size: 150,
        cell: ({ row }) => <GridCell value={row.original.department ?? "—"} />,
      },
      {
        id: "cycle",
        header: "Cycle",
        size: 150,
        cell: ({ row }) => (
          <GridCell value={`${row.original.cycleName} · ${row.original.period}`} />
        ),
      },
      {
        accessorKey: "cycleType",
        header: "Type",
        size: 110,
        cell: ({ row }) => (
          <span
            className={cn(
              "type-label rounded-pill border px-2 py-0.5",
              row.original.cycleType === "Increment"
                ? "border-primary/40 bg-accent text-primary"
                : "border-rule bg-surface-mute text-ink-muted",
            )}
          >
            {row.original.cycleType}
          </span>
        ),
      },
      /* Self and Lead keep their tier hue on the HEADING, and the value is ink
         — cyan text is 2.3:1 against §13.8's 4.5:1 floor (the same fault the
         report carried). The dot says who spoke; the number stays readable. */
      {
        id: "self",
        header: () => <TierHead tier="self">Self</TierHead>,
        size: 80,
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="tabular text-body-sm font-medium text-ink">
            {score(row.original.selfAverage)}
          </span>
        ),
      },
      {
        id: "lead",
        header: () => <TierHead tier="lead">Lead</TierHead>,
        size: 80,
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="tabular text-body-sm font-medium text-ink">
            {score(row.original.leadAverage)}
          </span>
        ),
      },
      {
        /* The agreed figure. Indigo IS the right tier here — §13.1 gives it to
           "the final, authoritative answer", which is what this is. An em dash
           until a cycle closes, never 0.00 (§11, P7-9). */
        id: "final",
        header: () => (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2 shrink-0 rounded-pill bg-final" />
            Final
          </span>
        ),
        size: 80,
        meta: { align: "right" },
        cell: ({ row }) =>
          row.original.finalAverage === null ? (
            <span className="tabular text-body-sm text-ink-muted">—</span>
          ) : (
            <span className="tabular text-body-sm font-semibold text-ink">
              {row.original.finalAverage.toFixed(2)}
            </span>
          ),
      },
      {
        accessorKey: "gap",
        header: "Gap",
        size: 80,
        meta: { align: "right" },
        cell: ({ row }) => (
          <span
            className={cn(
              "tabular text-body-sm font-semibold",
              row.original.gap !== null && Math.abs(row.original.gap) >= 2
                ? "text-critical"
                : "text-ink-muted",
            )}
          >
            {gapText(row.original.gap)}
          </span>
        ),
      },
      {
        accessorKey: "flaggedCount",
        header: "Flagged",
        size: 88,
        meta: { align: "right" },
        cell: ({ row }) =>
          row.original.flaggedCount > 0 ? (
            // A glyph as well as the colour — §13.8, colour is never the only
            // signal.
            <span className="tabular inline-flex items-center gap-1 text-body-sm font-semibold text-critical">
              <Flag className="size-3.5" aria-hidden />
              {row.original.flaggedCount}
            </span>
          ) : (
            <span className="text-body-sm text-ink-muted">—</span>
          ),
      },
      {
        accessorKey: "status",
        header: "Status",
        size: 150,
        cell: ({ row }) => {
          const skipped = row.original.selfSkipped || row.original.leadSkipped;
          return (
            <span className="flex items-center gap-1.5">
              <StatusChip status={row.original.status} />
              {skipped ? (
                // §13.4: a marker with no explanation is a dead end. The reason
                // is in `title` and repeated as sr-only text, because a tooltip
                // is not an explanation on a touch screen.
                <span
                  className="inline-flex items-center text-critical"
                  title={
                    row.original.skipReason ??
                    `${row.original.selfSkipped ? "The self" : "The lead"} layer was skipped.`
                  }
                >
                  <AlertTriangle className="size-3.5" aria-hidden />
                  <span className="sr-only">
                    {row.original.selfSkipped ? "Self layer skipped." : "Lead layer skipped."}{" "}
                    {row.original.skipReason ?? ""}
                  </span>
                </span>
              ) : null}
            </span>
          );
        },
      },
      {
        accessorKey: "daysWaiting",
        header: "Waiting",
        size: 88,
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="tabular text-body-sm text-ink-muted">
            {row.original.daysWaiting === null ? "—" : `${row.original.daysWaiting}d`}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        size: 84,
        enableResizing: false,
        meta: { align: "center" },
        cell: ({ row }) => (
          <Button asChild variant="outline" size="sm" className="h-8">
            <Link href={`/reports/${row.original.evaluationId}`}>{isHr ? "Open" : "Read"}</Link>
          </Button>
        ),
      },
    ],
    [isHr],
  );

  /* -- The hero said "Reports · 1 · report is waiting for your review", and the
        three tiles under it said 1 / 0 / 0. That is 480px of chrome to carry
        four integers and the page's own name, and it pushed the table — the
        only thing on this screen anybody acts on — below the fold.

        The same four numbers now sit on the title line, and the oldest-waiting
        figure moves into the subtitle where it belongs: it is a sentence about
        the queue, not a statistic of its own. -- */
  return (
    <TableScreen>
      <ScreenHeader
        title="Reports"
        subtitle={
          queue.pendingHr === 0
            ? "Nothing is waiting for review."
            : queue.oldestWaiting !== null
              ? `${queue.pendingHr} ${queue.pendingHr === 1 ? "report is" : "reports are"} waiting for your review · the oldest has waited ${queue.oldestWaiting} ${queue.oldestWaiting === 1 ? "day" : "days"}`
              : `${queue.pendingHr} ${queue.pendingHr === 1 ? "report is" : "reports are"} waiting for your review`
        }
      />

      {/* The three coloured counts, restored at the owner's instruction — half
          the height they were, and the numeral is ink rather than the tint's
          own hue, which is what makes them readable (§13.8). */}
      <KpiRow>
        <KpiCard label="Pending your review" value={queue.pendingHr} tone="self" />
        <KpiCard label="With the MD" value={queue.withMd} tone="lead" />
        <KpiCard label="Closed" value={queue.closedThisCycle} tone="final" />
      </KpiRow>

      {/* ---------- Filters ---------- */}
      <ScreenToolbar>
        <div className="relative w-full sm:w-[260px]">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, code or department"
            aria-label="Search reports"
            className="min-h-11 border-rule bg-surface pl-9"
          />
        </div>
        <select value={cycle} onChange={(e) => setCycle(e.target.value)} aria-label="Filter by cycle" className={SELECT_CLASS}>
          <option value={ANY}>Every cycle</option>
          {queue.cycles.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by cycle type" className={SELECT_CLASS}>
          <option value={ANY}>Both types</option>
          <option value="Evaluation">Evaluation</option>
          <option value="Increment">Increment</option>
        </select>
        <select value={department} onChange={(e) => setDepartment(e.target.value)} aria-label="Filter by department" className={SELECT_CLASS}>
          <option value={ANY}>Every department</option>
          {queue.departments.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" className={SELECT_CLASS}>
          <option value={ANY}>Every status</option>
          <option value="PENDING_HR_REVIEW">Pending HR review</option>
          <option value="HR_APPROVED">With the MD</option>
          <option value="MD_REVIEWED">Reviewed</option>
          <option value="INTERVIEW_DONE">Interview done</option>
          <option value="CLOSED">Closed</option>
        </select>
        {/* The gap threshold sits with the flag filter it qualifies, rather
            than on a second line of its own. */}
        <label className="flex min-h-11 items-center gap-2 font-sans text-body-sm text-ink-muted">
          Gap ≥
          <Input
            value={minGap}
            onChange={(e) => setMinGap(e.target.value)}
            inputMode="decimal"
            placeholder="2"
            aria-label="Minimum absolute gap"
            className="tabular min-h-11 w-16 border-rule bg-surface"
          />
        </label>
        <Button
          type="button"
          variant={flaggedOnly ? "default" : "secondary"}
          className="min-h-11"
          aria-pressed={flaggedOnly}
          onClick={() => setFlaggedOnly((v) => !v)}
        >
          <Flag className="mr-2 size-4" aria-hidden />
          Flagged only
        </Button>

        <p className="tabular ml-auto hidden text-body-sm text-ink-muted lg:block">
          {rows.length} of {queue.rows.length} {queue.rows.length === 1 ? "report" : "reports"}
        </p>
      </ScreenToolbar>

      <DataGrid
        data={rows}
        columns={columns}
        storageKey="appraise.reports-queue.column-widths"
        rowNoun="report"
        rowTitle={(r) => r.employeeName}
        rowActions={(r) => (
          <Button asChild className="min-h-11">
            <Link href={`/reports/${r.evaluationId}`}>{isHr ? "Open report" : "Read report"}</Link>
          </Button>
        )}
        minWidth={1320}
        empty={
          <EmptyState
            title="Nothing matches"
            body={
              queue.rows.length === 0
                ? "No evaluation has reached review yet. A report appears here once both sides have submitted."
                : "No report matches these filters. Clear one and try again."
            }
          />
        }
        status={
          <span className="tabular text-body-sm text-ink">
            {rows.length} of {queue.rows.length}{" "}
            {queue.rows.length === 1 ? "report" : "reports"} · largest difference first
          </span>
        }
      />
    </TableScreen>
  );
}
