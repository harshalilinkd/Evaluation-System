"use client";

/** Settings → Recycle bin. Nothing here was destroyed; it is hidden and restorable. */

import * as React from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { RotateCcw, Trash2 } from "lucide-react";

import { DataGrid, GridCell } from "@/components/appraise/data-grid";
import { EmptyState } from "@/components/appraise/states";
import { StatusChip } from "@/components/appraise/status-chip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteCycleForever, restoreCycleFromBin } from "@/lib/cycles/actions";
import type { BinnedCycleRow } from "@/lib/cycles/queries";
import { formatDate } from "@/lib/utils/date";

export function RecycleBinTab({ cycles }: { cycles: BinnedCycleRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [purging, setPurging] = React.useState<BinnedCycleRow | null>(null);

  const restore = React.useCallback(
    async (id: string) => {
      setBusyId(id);
      setError(null);
      const result = await restoreCycleFromBin(id);
      setBusyId(null);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.refresh();
    },
    [router],
  );

  const columns = React.useMemo<ColumnDef<BinnedCycleRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Cycle",
        size: 170,
        meta: { frozen: true },
        cell: ({ row }) => (
          <GridCell value={row.original.name} className="font-medium text-ink" />
        ),
      },
      {
        accessorKey: "periodLabel",
        header: "Period",
        size: 110,
        cell: ({ row }) => <GridCell value={row.original.periodLabel} />,
      },
      {
        accessorKey: "status",
        // "Status when binned" truncated to "STATUS WHEN BIN…". A header that
        // has to be clipped is too long for its column, and the surrounding
        // caption already establishes that everything here is binned.
        header: "Status",
        size: 116,
        cell: ({ row }) => (
          <StatusChip
            status={row.original.status === "ACTIVE" ? "CYCLE_ACTIVE" : row.original.status}
          />
        ),
      },
      {
        accessorKey: "participants",
        header: "People",
        size: 84,
        meta: { align: "right" },
        // The number that decides whether restoring matters: an empty draft is
        // a click, a cycle holding forty frozen snapshots is a decision.
        cell: ({ row }) => (
          <span className="tabular text-body-sm text-ink">{row.original.participants}</span>
        ),
      },
      {
        accessorKey: "deletedAt",
        header: "Deleted",
        size: 112,
        cell: ({ row }) => (
          <GridCell value={formatDate(row.original.deletedAt)} className="tabular" />
        ),
      },
      {
        accessorKey: "deletedByName",
        header: "By",
        size: 140,
        cell: ({ row }) => <GridCell value={row.original.deletedByName ?? "—"} />,
      },
      {
        accessorKey: "reason",
        header: "Why",
        size: 190,
        cell: ({ row }) => <GridCell value={row.original.reason ?? "—"} />,
      },
      {
        id: "actions",
        header: "",
        size: 150,
        enableResizing: false,
        meta: { align: "right" },
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              className="px-2"
              disabled={busyId === row.original.id}
              onClick={() => void restore(row.original.id)}
            >
              <RotateCcw className="size-4" aria-hidden />
              {busyId === row.original.id ? "Restoring…" : "Restore"}
            </Button>

            {/*
              ENABLED even when it will refuse.

              It was disabled with the reason in a `title`, and that is not an
              explanation — P13-11 made the same call: a tooltip does not exist
              on a touch screen, and a greyed control with no visible cause
              reads as the product being broken. The dialog explains instead,
              which is somewhere the reason can actually be read.
            */}
            <Button
              variant="ghost"
              size="icon"
              className="size-9 text-ink-muted hover:text-critical"
              aria-label={`Delete ${row.original.name} for good`}
              disabled={busyId === row.original.id}
              onClick={() => setPurging(row.original)}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </div>
        ),
      },
    ],
    [busyId, restore],
  );

  return (
    // max-h, not h: with one row the card is one row tall. A fixed 68vh left
    // most of it empty, which is the complaint the board had too.
    <div className="flex max-h-[70vh] flex-col overflow-hidden rounded-card bg-surface shadow-dashboard">
      <div className="shrink-0 border-b border-rule px-4 py-3">
        <h2 className="text-body font-medium text-ink">Recycle bin</h2>
        <p className="mt-0.5 max-w-[90ch] text-body-sm text-ink-muted">
          {/*
            Said plainly because the word "deleted" would otherwise imply loss.
            §5 does not permit destroying a cycle: it cascades to evaluations
            and from there to the frozen question sets, so the bin marks the row
            and hides it, and restoring is the mark going away.
          */}
          Deleting a cycle never destroys anything. Everything inside it — answers, ratings and
          the frozen question set each person was launched with — stays exactly as it was, and
          restoring brings the whole cycle back.
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          className="shrink-0 border-b border-critical/40 bg-critical-tint px-4 py-2 text-body-sm text-critical"
        >
          {error}
        </p>
      ) : null}

      <DataGrid
        data={cycles}
        columns={columns}
        storageKey="appraise.recycle-bin.column-widths"
        rowNoun="binned cycle"
        rowTitle={(c) => `${c.name} · ${c.periodLabel}`}
        rowActions={(c) => (
          <Button className="min-h-11" disabled={busyId === c.id} onClick={() => void restore(c.id)}>
            {busyId === c.id ? "Restoring…" : "Restore"}
          </Button>
        )}
        // The real column total (~1116), so the filler absorbs the slack and
        // the grid only scrolls on a screen narrower than its own columns. It
        // was 1180 — wider than the space it sits in, which is why every row
        // had a horizontal scrollbar under it.
        minWidth={1080}
        empty={
          <EmptyState
            icon={<Trash2 className="size-6" aria-hidden />}
            title="The recycle bin is empty"
            body="Cycles you delete appear here, and can be restored at any time."
          />
        }
        status={
          <span className="tabular text-body-sm text-ink">
            {cycles.length} {cycles.length === 1 ? "cycle" : "cycles"} in the bin
          </span>
        }
      />

      <PurgeDialog
        key={purging?.id ?? "none"}
        cycle={purging}
        onClose={() => setPurging(null)}
        onDone={() => {
          setPurging(null);
          router.refresh();
        }}
      />
    </div>
  );
}

/**
 * Deleting for good.
 *
 * The one irreversible action in the product, so it says exactly what goes and
 * what cannot: only a cycle that was never launched can be destroyed, because
 * a launched one holds frozen question sets that §5 does not permit losing.
 * 0009's trigger is what enforces that; this dialog explains it.
 */
function PurgeDialog({
  cycle,
  onClose,
  onDone,
}: {
  cycle: BinnedCycleRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!cycle) return null;

  // 0009's trigger refuses to delete anything that is not a DRAFT, because
  // `evaluation_cycles` cascades to `evaluations` and from there to
  // `evaluation_questions` — a launched cycle's frozen question sets would go
  // with it, which §5 exists to prevent. Checked here so the dialog can EXPLAIN
  // rather than let somebody press a button that always fails.
  const canDestroy = cycle.status === "DRAFT";

  async function purge() {
    if (!cycle) return;
    setBusy(true);
    setError(null);
    const result = await deleteCycleForever(cycle.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onDone();
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent onInteractOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>
            {canDestroy ? `Delete ${cycle.name} for good?` : `${cycle.name} cannot be deleted`}
          </DialogTitle>
          <DialogDescription>
            {canDestroy
              ? "This cannot be undone. The cycle and its participant list are removed from the database entirely."
              : "It stays in the recycle bin, where it takes up nothing and can be restored at any time."}
          </DialogDescription>
        </DialogHeader>

        {canDestroy ? (
          <p className="rounded-control border-l-2 border-l-critical bg-critical-tint/40 py-3 pl-4 pr-4 text-body-sm text-ink">
            {cycle.name} was never launched, so nothing has been answered and no question set was
            frozen — there is nothing inside it to lose. Restoring will no longer be possible.
          </p>
        ) : (
          <div className="space-y-2 rounded-control border-l-2 border-l-warning bg-warning-tint/40 py-3 pl-4 pr-4 text-body-sm text-ink">
            <p>
              <span className="font-medium">This cycle was launched.</span> It holds the frozen
              question set each of its {cycle.participants}{" "}
              {cycle.participants === 1 ? "person" : "people"} was given, and whatever they have
              answered so far. Destroying the cycle would destroy those with it, which the database
              refuses.
            </p>
            <p className="text-ink-muted">
              Being in the bin is enough: it is already out of every list and every report. If you
              want it out of the way permanently, leave it here.
            </p>
          </div>
        )}

        {error ? (
          <p
            role="alert"
            className="rounded-control border border-critical/40 bg-critical-tint px-3 py-2 text-body-sm text-critical"
          >
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={onClose} disabled={busy}>
            {canDestroy ? "Keep it in the bin" : "Close"}
          </Button>
          {canDestroy ? (
            <Button
              variant="destructive"
              className="min-h-11"
              onClick={() => void purge()}
              disabled={busy}
            >
              {busy ? "Deleting…" : "Delete for good"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
