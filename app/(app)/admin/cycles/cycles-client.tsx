"use client";

/** The cycle list. One structured grid, the same as every other table-first screen. */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarPlus, MoreHorizontal, Pencil, Plus, Send, SquareArrowOutUpRight, Trash2 } from "lucide-react";

import { DataGrid, GridCell } from "@/components/appraise/data-grid";
import { SegmentedProgress } from "@/components/appraise/segmented-bar";
import { EmptyState } from "@/components/appraise/states";
import { StatusChip } from "@/components/appraise/status-chip";
import { CycleTypeChip } from "@/components/appraise/cycle-type-chip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { moveCycleToBin } from "@/lib/cycles/actions";
import type { CycleListRow } from "@/lib/cycles/queries";
import { formatDate } from "@/lib/utils/date";

/** §11 / P7-9: absent is an em dash, never blank and never a zero. */
function dash(value: string | null): string {
  return value ? formatDate(value) : "—";
}

export function CyclesClient({
  cycles,
  greetingName,
}: {
  cycles: CycleListRow[];
  greetingName: string;
}) {
  const router = useRouter();
  const [search, setSearch] = React.useState("");
  const [binning, setBinning] = React.useState<CycleListRow | null>(null);

  const rows = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return cycles;
    return cycles.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) || c.periodLabel.toLowerCase().includes(needle),
    );
  }, [cycles, search]);

  const columns = React.useMemo<ColumnDef<CycleListRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Cycle",
        size: 200,
        meta: { frozen: true },
        cell: ({ row }) => (
          <Link
            href={`/admin/cycles/${row.original.id}`}
            title={row.original.name}
            className="block truncate text-body-sm font-medium text-ink hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: "periodLabel",
        header: "Period",
        size: 130,
        cell: ({ row }) => <GridCell value={row.original.periodLabel} />,
      },
      {
        accessorKey: "status",
        header: "Status",
        size: 130,
        cell: ({ row }) => (
          <StatusChip
            status={row.original.status === "ACTIVE" ? "CYCLE_ACTIVE" : row.original.status}
          />
        ),
      },
      /*
        WHAT KIND OF CYCLE THIS IS.

        §1: the two types share the same form and the same blind parallel flow
        and differ only in how they end — an increment cycle carries on into
        salary, a plain evaluation stops when the MD has read the report. That
        is a large difference in what happens to the people in it, and until now
        nothing on this screen said which was which. Two live cycles were
        indistinguishable.

        Its own column rather than a tint on the name: a colour alone would be
        unreadable to anybody who cannot see it and meaningless to everybody who
        has not been told the convention (§13.8). The word is the signal.
      */
      {
        id: "cycleType",
        header: "Type",
        size: 118,
        cell: ({ row }) => <CycleTypeChip type={row.original.cycleType} />,
      },
      {
        accessorKey: "participants",
        header: "People",
        size: 84,
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="tabular text-body-sm text-ink">{row.original.participants}</span>
        ),
      },
      /*
        The three layers get a COLUMN EACH rather than three labelled dots
        crammed into one cell. That was the complaint and it was right: "Self
        submitted 0 Lead reviewed 0 MD finalised 0" is a sentence, not data, and
        it cannot be scanned down a column or compared between rows.
      */
      {
        id: "self",
        header: "Self in",
        size: 84,
        meta: { align: "right" },
        cell: ({ row }) => <Count value={row.original.progress.self} of={row.original.participants} />,
      },
      {
        id: "lead",
        header: "Lead in",
        size: 84,
        meta: { align: "right" },
        cell: ({ row }) => <Count value={row.original.progress.lead} of={row.original.participants} />,
      },
      {
        id: "final",
        header: "Finalised",
        size: 90,
        meta: { align: "right" },
        cell: ({ row }) => <Count value={row.original.progress.final} of={row.original.participants} />,
      },
      {
        id: "progress",
        header: "Progress",
        size: 160,
        cell: ({ row }) => (
          <SegmentedProgress
            total={row.original.participants}
            self={row.original.progress.self}
            lead={row.original.progress.lead}
            final={row.original.progress.final}
          />
        ),
      },
      /* One date per column. Three stacked lines in a single cell made every row
         three lines tall and none of the dates line up between rows. */
      {
        accessorKey: "selfDueOn",
        header: "Self due",
        size: 116,
        cell: ({ row }) => <GridCell value={dash(row.original.selfDueOn)} className="tabular" />,
      },
      {
        accessorKey: "leadDueOn",
        header: "Lead due",
        size: 116,
        cell: ({ row }) => <GridCell value={dash(row.original.leadDueOn)} className="tabular" />,
      },
      {
        accessorKey: "mdDueOn",
        header: "MD due",
        size: 116,
        cell: ({ row }) => <GridCell value={dash(row.original.mdDueOn)} className="tabular" />,
      },
      {
        id: "actions",
        header: "",
        size: 64,
        enableResizing: false,
        meta: { align: "center" },
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-ink-faint hover:text-ink"
                aria-label={`Actions for ${row.original.name}`}
              >
                <MoreHorizontal className="size-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 border-rule">
              <DropdownMenuItem asChild>
                <Link href={`/admin/cycles/${row.original.id}`}>
                  <SquareArrowOutUpRight className="size-4" aria-hidden />
                  Open
                </Link>
              </DropdownMenuItem>
              {row.original.status === "DRAFT" ? (
                <DropdownMenuItem asChild>
                  <Link href={`/admin/cycles/${row.original.id}/edit`}>
                    <Pencil className="size-4" aria-hidden />
                    Edit setup
                  </Link>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem asChild>
                <Link href={`/admin/cycles/${row.original.id}/distribute`}>
                  <Send className="size-4" aria-hidden />
                  Send links
                </Link>
              </DropdownMenuItem>

              <DropdownMenuSeparator className="bg-rule" />

              <DropdownMenuItem
                onSelect={() => setBinning(row.original)}
                className="text-critical focus:text-critical"
              >
                <Trash2 className="size-4" aria-hidden />
                Move to recycle bin
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [],
  );

  return (
    // The grid IS this screen, the same shape as the question bank, Settings ›
    // Users and Team review. `data-full-bleed` drops the shell's 1180px cap.
    <div
      data-full-bleed
      className="flex h-[calc(100dvh-theme(spacing.topbar))] min-h-[26rem] flex-col overflow-hidden bg-surface"
    >
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-4 border-b border-rule px-4 py-3 lg:px-6">
        <div className="min-w-0">
          <h1 className="text-display-sm font-semibold text-ink">
            {greetingName ? `Hello, ${greetingName}` : "Evaluation cycles"}
          </h1>
          <p className="mt-0.5 text-body-sm text-ink-muted">
            Open a period, freeze everyone&rsquo;s questions, and watch it come back in.
          </p>
        </div>

        <Button asChild className="min-h-11">
          <Link href="/admin/cycles/new">
            <Plus className="size-4" aria-hidden />
            New cycle
          </Link>
        </Button>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule bg-surface-mute px-3 py-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search cycles"
          aria-label="Search cycles"
          className="min-h-11 w-full border-rule bg-surface sm:w-[260px]"
        />
        <p className="ml-auto hidden text-body-sm text-ink-muted lg:block">
          Deleted cycles go to Settings › Recycle bin, and can be restored.
        </p>
      </div>

      <DataGrid
        data={rows}
        columns={columns}
        storageKey="appraise.cycles.column-widths"
        minWidth={1540}
        empty={
          <EmptyState
            icon={<CalendarPlus className="size-6" aria-hidden />}
            title={cycles.length === 0 ? "No evaluation cycles yet" : "Nothing matches that"}
            body={
              cycles.length === 0
                ? "Create one to open self-evaluations for your team."
                : "Try a different name or period."
            }
            action={
              cycles.length === 0 ? (
                <Button asChild className="min-h-11">
                  <Link href="/admin/cycles/new">
                    <Plus className="size-4" aria-hidden />
                    New cycle
                  </Link>
                </Button>
              ) : undefined
            }
          />
        }
        status={
          <span className="tabular text-body-sm text-ink">
            {rows.length} of {cycles.length} {cycles.length === 1 ? "cycle" : "cycles"}
          </span>
        }
      />

      <BinDialog
        key={binning?.id ?? "none"}
        cycle={binning}
        onClose={() => setBinning(null)}
        onDone={() => {
          setBinning(null);
          router.refresh();
        }}
      />
    </div>
  );
}

/** A count against its total, so "0" is legible as "0 of 12" rather than bare. */
function Count({ value, of }: { value: number; of: number }) {
  return (
    <span className="tabular text-body-sm">
      <span className={value > 0 ? "text-ink" : "text-ink-faint"}>{value}</span>
      <span className="text-ink-faint">/{of}</span>
    </span>
  );
}

/**
 * Binning a cycle.
 *
 * The dialog is emphatic that nothing is destroyed, because the word "delete"
 * beside a cycle holding forty frozen snapshots would otherwise read as one —
 * and §5 would never permit that. 0032 marks the row; the contents are not
 * touched at all.
 */
function BinDialog({
  cycle,
  onClose,
  onDone,
}: {
  cycle: CycleListRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!cycle) return null;

  async function bin() {
    if (!cycle) return;
    setBusy(true);
    setError(null);
    const result = await moveCycleToBin(cycle.id, reason);
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
          <DialogTitle>Move {cycle.name} to the recycle bin?</DialogTitle>
          <DialogDescription>
            It disappears from this list. Nothing inside it is deleted.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <p className="rounded-control border border-rule bg-surface-mute p-3 text-body-sm text-ink">
            {cycle.participants > 0
              ? `${cycle.participants} ${cycle.participants === 1 ? "person is" : "people are"} in this cycle. Their answers and their frozen question sets stay exactly as they are — restoring brings the whole thing back.`
              : "Nobody is in this cycle yet, so there is nothing inside it to keep."}
          </p>

          <div className="space-y-1.5">
            <label htmlFor="bin-reason" className="type-label block text-ink-muted">
              Why (optional)
            </label>
            <Textarea
              id="bin-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Created by mistake — wrong period."
            />
            <p className="text-body-sm text-ink-faint">
              Shown in the recycle bin, so whoever finds it later knows why it is there.
            </p>
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-control border border-critical/40 bg-critical-tint px-3 py-2 text-body-sm text-critical"
            >
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={onClose} disabled={busy}>
            Keep it
          </Button>
          <Button variant="destructive" className="min-h-11" onClick={() => void bin()} disabled={busy}>
            {busy ? "Moving…" : "Move to recycle bin"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
