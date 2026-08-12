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

/**
 * The toolbar selects, at a third of a phone.
 *
 * `min-w-0` is what lets a grid cell be narrower than its content instead of
 * blowing the row out — a select's intrinsic minimum is its longest option, and
 * "Every department" is wider than 375÷3.
 *
 * The padding comes back at `lg`, where there is room for it. Trimming it on a
 * phone buys ~8px of visible text per control, which is the difference between
 * "Every departm…" and "Every department" on most handsets. Some clipping at
 * this width is unavoidable and acceptable: the selected value is short
 * ("Printing", "Design") — it is only the placeholder that is long.
 */
const SELECT_TIGHT = "min-w-0 px-2 lg:px-3";

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
        header: () => <TierHead tier="lead">Manager</TierHead>,
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
                    {row.original.selfSkipped ? "Self layer skipped." : "Manager layer skipped."}{" "}
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
        size: 150,
        enableResizing: false,
        meta: { align: "center" },
        /* -- Both views, on the row itself.
              They were only in the row-details dialog, which opens on a click
              somebody has to know to make — so the interview view existed and
              was effectively undiscoverable. A feature reachable only from a
              modal nobody opens is a feature that is not there. -- */
        cell: ({ row }) => (
          <div className="flex justify-center gap-1.5">
            <Button asChild size="sm" className="min-h-11 lg:h-8">
              <Link href={`/reports/${row.original.evaluationId}/summary`} title="Executive summary — scores and salary on one screen">
                Summary
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="min-h-11 lg:h-8">
              <Link href={`/reports/${row.original.evaluationId}`} title="The full report and audit trail">
                {isHr ? "Open" : "Read"}
              </Link>
            </Button>
          </div>
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
        /* -- "Nothing is waiting for review" was true of HR's own inbox and
              false of the screen: a record the MD had reviewed still needs
              closing, and saying nothing is waiting sends somebody away from
              work that is theirs. It now names the next thing to do. -- */
        subtitle={
          queue.pendingHr === 0
            ? queue.readyToClose > 0
              ? `${queue.readyToClose} ${queue.readyToClose === 1 ? "report has" : "reports have"} been reviewed by the MD and can be closed.`
              : "Nothing is waiting for review."
            : queue.oldestWaiting !== null
              ? `${queue.pendingHr} ${queue.pendingHr === 1 ? "report is" : "reports are"} waiting for your review · the oldest has waited ${queue.oldestWaiting} ${queue.oldestWaiting === 1 ? "day" : "days"}`
              : `${queue.pendingHr} ${queue.pendingHr === 1 ? "report is" : "reports are"} waiting for your review`
        }
      />

      {/* The three coloured counts, restored at the owner's instruction — half
          the height they were, and the numeral is ink rather than the tint's
          own hue, which is what makes them readable (§13.8). */}
      {/* -- Four, not three. §8 has four live states before CLOSED and the row
            showed three, so a record the MD had just reviewed was counted
            nowhere — every tile read 0 with a report sitting in the table
            below. "Ready to close" is where MD_REVIEWED and INTERVIEW_DONE
            land, which is also the tile that says whose turn it now is. -- */}
      <KpiRow>
        <KpiCard label="Pending your review" value={queue.pendingHr} tone="self" />
        <KpiCard label="With the MD" value={queue.withMd} tone="lead" />
        <KpiCard label="Ready to close" value={queue.readyToClose} tone="final" />
        <KpiCard label="Closed" value={queue.closedThisCycle} tone="final" />
      </KpiRow>

      {/* ---------- Filters ----------
          TWO FIXED ROWS OF THREE ON A PHONE, one flowing line on a laptop.

          `ScreenToolbar` is `flex-wrap`, which decides the breaks from whatever
          each control happens to measure — so the seven filters fell into
          3 / 2 / 2 at 400px, with "Gap ≥" and "Flagged only" stranded on a line
          of their own and the whole strip four rows deep. Wrapping is the right
          behaviour for a wide screen and no behaviour at all for a narrow one.

          So the phone gets a stated layout — search · cycle · type, then
          department · status · gap — and `lg:contents` dissolves both wrappers
          above 1024px so the seven controls rejoin the flex line exactly as
          before. Nothing about the desktop strip changes. */}
      <ScreenToolbar>
        <div className="grid w-full grid-cols-3 gap-2 lg:contents">
          <div className="relative min-w-0 lg:w-[260px]">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
            />
            {/* -- A SHORT placeholder, and the long form in the tooltip.
                  At a third of 375px the field is ~105px, of which the icon
                  and its padding take 34 — "Search by name, code or
                  department" arrives as "Search by ", which reads as a label
                  that has been cut off rather than as a hint. The `aria-label`
                  is unchanged, so nothing is lost to a screen reader. -- */}
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              title="Search by name, code or department"
              aria-label="Search reports by name, code or department"
              className="min-h-11 w-full min-w-0 border-rule bg-surface pl-8 lg:pl-9"
            />
          </div>
          <select value={cycle} onChange={(e) => setCycle(e.target.value)} aria-label="Filter by cycle" className={cn(SELECT_CLASS, SELECT_TIGHT)}>
            <option value={ANY}>Every cycle</option>
            {queue.cycles.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by cycle type" className={cn(SELECT_CLASS, SELECT_TIGHT)}>
            <option value={ANY}>Both types</option>
            <option value="Evaluation">Evaluation</option>
            <option value="Increment">Increment</option>
          </select>
        </div>

        <div className="grid w-full grid-cols-3 gap-2 lg:contents">
          <select value={department} onChange={(e) => setDepartment(e.target.value)} aria-label="Filter by department" className={cn(SELECT_CLASS, SELECT_TIGHT)}>
            <option value={ANY}>Every department</option>
            {queue.departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" className={cn(SELECT_CLASS, SELECT_TIGHT)}>
            <option value={ANY}>Every status</option>
            <option value="PENDING_HR_REVIEW">Pending HR review</option>
            <option value="HR_APPROVED">With the MD</option>
            <option value="MD_REVIEWED">Reviewed</option>
            <option value="INTERVIEW_DONE">Interview done</option>
            <option value="CLOSED">Closed</option>
          </select>
          {/* -- ONE control, not a floating label beside a boxed input.
                The old shape was the text "Gap ≥" sitting outside a bordered
                field, which measured ~120px and could not share a third of a
                phone with anything. Folding the prefix inside the same box
                makes it the same size and shape as the two selects next to it,
                which is also why the row now reads as a row. -- */}
          {/* -- The ring moves to the WRAPPER, because the box is what a
                sighted keyboard user sees. A borderless input inside a bordered
                label has nowhere of its own to draw focus, and dropping the
                ring rather than relocating it is how a control becomes
                unreachable-looking for exactly the people §13.8 is about. -- */}
          <label className="flex min-h-11 min-w-0 items-center gap-1.5 rounded-control border border-rule bg-surface px-2.5 text-body-sm text-ink-muted focus-within:ring-1 focus-within:ring-ring lg:w-[108px]">
            <span className="shrink-0">Gap ≥</span>
            <input
              value={minGap}
              onChange={(e) => setMinGap(e.target.value)}
              inputMode="decimal"
              placeholder="2"
              aria-label="Minimum absolute gap"
              className="tabular w-full min-w-0 bg-transparent text-body-sm text-ink outline-none placeholder:text-ink-faint"
            />
          </label>
        </div>

        <div className="flex w-full items-center gap-3 lg:contents">
          <Button
            type="button"
            variant={flaggedOnly ? "default" : "secondary"}
            className="min-h-11 flex-1 lg:flex-none"
            aria-pressed={flaggedOnly}
            onClick={() => setFlaggedOnly((v) => !v)}
          >
            <Flag className="mr-2 size-4" aria-hidden />
            Flagged only
          </Button>

          {/* -- Shown on a phone too, where the grid's own status bar is at the
                bottom of a scrolling table and therefore off screen. Somebody
                who has just narrowed the list needs to know it narrowed. -- */}
          <p className="tabular shrink-0 text-body-sm text-ink-muted lg:ml-auto">
            {rows.length} of {queue.rows.length} {queue.rows.length === 1 ? "report" : "reports"}
          </p>
        </div>
      </ScreenToolbar>

      <DataGrid
        data={rows}
        columns={columns}
        storageKey="appraise.reports-queue.column-widths"
        rowNoun="report"
        rowTitle={(r) => r.employeeName}
        /* -- Two ways in, because they are two different moments.
              "Executive summary" is the live-interview view: the two scores and
              the whole salary model on one screen, no scrolling. The full report
              is the record — every question, every comment, the audit trail —
              and is unchanged.
              The summary is offered FIRST because it is the one somebody opens
              with a person sitting opposite them. -- */
        rowActions={(r) => (
          <div className="flex flex-wrap gap-2">
            <Button asChild className="min-h-11">
              <Link href={`/reports/${r.evaluationId}/summary`}>Executive summary</Link>
            </Button>
            <Button asChild variant="secondary" className="min-h-11">
              <Link href={`/reports/${r.evaluationId}`}>
                {isHr ? "Full report" : "Read full report"}
              </Link>
            </Button>
          </div>
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
