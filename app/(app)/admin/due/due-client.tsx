"use client";

/** What is due, grouped by month. This screen is how HR runs the year. */

import * as React from "react";
import { useRouter } from "next/navigation";

import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle } from "lucide-react";

import { DataGrid, GridCell } from "@/components/appraise/data-grid";
import {
  KpiCard,
  KpiRow,
  ScreenHeader,
  TableScreen,
} from "@/components/appraise/screen";
import { EmptyState } from "@/components/appraise/states";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createAndSend, skipDueItem } from "@/lib/due/actions";
import type { DueList, DueRow } from "@/lib/due/queries";
import { formatDate } from "@/lib/utils/date";
import { cn } from "@/lib/utils";

/** "August 2026" — HR thinks in months on this screen. */
function monthLabel(iso: string): string {
  return new Date(`${iso.slice(0, 7)}-01T00:00:00`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

export function DueClient({ list, canAct }: { list: DueList; canAct: boolean }) {
  const router = useRouter();
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [skipping, setSkipping] = React.useState<DueRow | null>(null);
  const [reason, setReason] = React.useState("");

  async function onCreate(row: DueRow) {
    setBusyId(row.id);
    setMessage(null);
    const result = await createAndSend(row.id);
    setBusyId(null);
    if (!result.ok) setMessage({ tone: "error", text: result.error.message });
    else {
      setMessage({
        tone: "ok",
        text: `${row.name}'s ${row.what.toLowerCase()} is open. ${result.data.sent} message${result.data.sent === 1 ? "" : "s"} sent${result.data.failed ? `, ${result.data.failed} failed` : ""}.`,
      });
      router.refresh();
    }
  }

  async function onSkip() {
    if (!skipping) return;
    setBusyId(skipping.id);
    const result = await skipDueItem({ dueItemId: skipping.id, reason });
    setBusyId(null);
    if (!result.ok) setMessage({ tone: "error", text: result.error.message });
    else {
      setSkipping(null);
      setReason("");
      router.refresh();
    }
  }

  /* -- ONE GRID, and the month is a COLUMN.
        It was a card per month, each with its own header and its own <table>.
        The dates are already in the rows and already sorted, so the grouping
        was chrome — and a single `DataGrid` is what makes this the SAME table
        as the question bank, the roster and the report queue. -- */
  const columns = React.useMemo<ColumnDef<DueRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Employee",
        size: 200,
        meta: { frozen: true },
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-2">
            {row.original.daysRemaining < 0 ? (
              <AlertTriangle className="size-3.5 shrink-0 text-critical" aria-hidden />
            ) : null}
            <span title={row.original.name} className="truncate text-body-sm font-medium text-ink">
              {row.original.name}
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
        size: 160,
        cell: ({ row }) => <GridCell value={row.original.department ?? "—"} />,
      },
      {
        accessorKey: "what",
        header: "What is due",
        size: 190,
        cell: ({ row }) => <GridCell value={row.original.what} />,
      },
      {
        id: "month",
        header: "Month",
        size: 130,
        cell: ({ row }) => <GridCell value={monthLabel(row.original.dueOn.slice(0, 7))} />,
      },
      {
        accessorKey: "dueOn",
        header: "Date",
        size: 120,
        cell: ({ row }) => (
          <span className="tabular text-body-sm text-ink">{formatDate(row.original.dueOn)}</span>
        ),
      },
      {
        accessorKey: "daysRemaining",
        header: "Days",
        size: 96,
        meta: { align: "right" },
        cell: ({ row }) =>
          row.original.daysRemaining < 0 ? (
            // A word as well as the rose — colour is never the only signal (§13.8).
            <span className="tabular text-body-sm font-semibold text-critical">
              {Math.abs(row.original.daysRemaining)} late
            </span>
          ) : (
            <span className="tabular text-body-sm text-ink-muted">{row.original.daysRemaining}</span>
          ),
      },
      {
        id: "actions",
        header: "",
        size: 230,
        enableResizing: false,
        cell: ({ row }) =>
          !canAct ? (
            <span className="text-body-sm text-ink-muted">HR acts on this</span>
          ) : row.original.blockedBecause ? (
            // §13.4: the reason sits beside the disabled control, not in a
            // tooltip — each of these has a different fix.
            <span className="flex items-center gap-2">
              <Button size="sm" className="min-h-11 lg:h-8" disabled>
                Create and send
              </Button>
              <span
                title={row.original.blockedBecause}
                className="truncate text-body-sm text-critical"
              >
                {row.original.blockedBecause}
              </span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <Button
                size="sm"
                className="min-h-11 lg:h-8"
                disabled={busyId === row.original.id}
                onClick={() => onCreate(row.original)}
              >
                {busyId === row.original.id ? "Working…" : "Create and send"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="min-h-11 lg:h-8"
                disabled={busyId === row.original.id}
                onClick={() => {
                  setSkipping(row.original);
                  setReason("");
                }}
              >
                Skip
              </Button>
            </span>
          ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canAct, busyId],
  );

  return (
    <TableScreen>
      <ScreenHeader
        title="What is due"
        subtitle={
          list.rows.length === 0
            ? "Nothing is waiting. New joiners and increments appear here as their dates approach."
            : `${list.thisMonth} ${list.thisMonth === 1 ? "thing needs" : "things need"} your attention this month · ${list.rows.length} in total`
        }
      />

      <KpiRow>
        <KpiCard label="Milestone evaluations due" value={list.milestonesDue} tone="self" />
        <KpiCard label="Increments due" value={list.incrementsDue} tone="lead" />
        <KpiCard
          label="Overdue"
          value={list.overdue}
          tone={list.overdue > 0 ? "critical" : "plain"}
          caption={list.overdue > 0 ? "Past their date" : "Nothing is late"}
        />
      </KpiRow>

      {message ? (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={cn(
            "shrink-0 border-b px-4 py-2 font-sans text-body-sm",
            message.tone === "error"
              ? "border-critical/40 bg-critical-tint text-critical"
              : "border-final/40 bg-final-tint text-final",
          )}
        >
          {message.text}
        </p>
      ) : null}

      <DataGrid
        data={list.rows}
        columns={columns}
        storageKey="appraise.due.column-widths"
        rowNoun="item"
        rowTitle={(r) => `${r.name} · ${r.what}`}
        // §13.4: the reason a control is unavailable sits beside it, never in a
        // tooltip — and the dialog is where somebody reads the whole row, so it
        // is the right place to say why this one cannot go ahead.
        rowActions={(r) =>
          !canAct ? (
            <span className="text-body-sm text-ink-muted">HR acts on this</span>
          ) : r.blockedBecause ? (
            <span className="text-body-sm text-critical">{r.blockedBecause}</span>
          ) : (
            <Button
              className="min-h-11"
              disabled={busyId === r.id}
              onClick={() => onCreate(r)}
            >
              {busyId === r.id ? "Working…" : "Create and send"}
            </Button>
          )
        }
        minWidth={1240}
        empty={
          <EmptyState
            title="Nothing is due"
            body="A new joiner appears here a month after they start, and again at six months. An increment appears as its date approaches."
          />
        }
        status={
          <span className="tabular text-body-sm text-ink">
            {list.rows.length} {list.rows.length === 1 ? "item" : "items"} · soonest first
          </span>
        }
      />


      <Dialog open={skipping !== null} onOpenChange={(open) => !open && setSkipping(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Skip this one</DialogTitle>
            <DialogDescription>
              {skipping
                ? `${skipping.name}'s ${skipping.what.toLowerCase()} will not be created. It stays on the record as skipped.`
                : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="skip_reason" className="type-label text-ink-muted">
              Reason
            </Label>
            <Textarea
              id="skip_reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Why is this one not going ahead?"
            />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setSkipping(null)}>
              Cancel
            </Button>
            <Button onClick={onSkip} disabled={reason.trim().length < 5 || busyId !== null}>
              Skip it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TableScreen>
  );
}
