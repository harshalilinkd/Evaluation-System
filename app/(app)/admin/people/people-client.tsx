/** The staff roster. Search, filter, and one row per person into their scorecard. */

"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { BadgeIndianRupee, LineChart, MoreHorizontal, Search, Users } from "lucide-react";

import { DataGrid, GridCell } from "@/components/appraise/data-grid";
import { EmptyState } from "@/components/appraise/states";
import { StatusChip } from "@/components/appraise/status-chip";
import { TIER_CLASSES } from "@/components/appraise/tier";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { Enums } from "@/types/database";
import { cn } from "@/lib/utils";
import { TRACK_LABELS } from "@/lib/forms/labels";

export type PersonRow = {
  id: string;
  fullName: string;
  employeeCode: string | null;
  designation: string | null;
  departmentName: string | null;
  leadName: string | null;
  isActive: boolean;
  status: Enums<"evaluation_status"> | null;
  excluded: boolean;
  self: number | null;
  lead: number | null;
  final: number | null;
};

const ANY = "__any__";


/** Initials for the avatar. Two at most — three stops reading as initials. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function PeopleClient({
  rows,
  departments,
  cycleLabel,
}: {
  rows: PersonRow[];
  departments: string[];
  cycleLabel: string | null;
}) {
  const [search, setSearch] = React.useState("");
  const [department, setDepartment] = React.useState(ANY);
  const [status, setStatus] = React.useState(ANY);
  const [showInactive, setShowInactive] = React.useState(false);
  const router = useRouter();
  // The per-row entrance animation went with the list. A grid of forty rows
  // staggering in is motion for its own sake, and DataGrid renders a table
  // rather than a stack of cards — framer-motion is no longer imported here.

  const filtered = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!showInactive && !r.isActive) return false;
      if (department !== ANY && r.departmentName !== department) return false;
      if (status !== ANY && r.status !== status) return false;
      if (!needle) return true;
      // Employee code as well as name: HR looks people up by code as often as
      // by spelling, and a name search alone makes them scroll.
      return (
        r.fullName.toLowerCase().includes(needle) ||
        (r.employeeCode ?? "").toLowerCase().includes(needle) ||
        (r.designation ?? "").toLowerCase().includes(needle)
      );
    });
  }, [rows, search, department, status, showInactive]);

  /*
     Counted against the CURRENT §8 statuses.

     These read CYCLE_ACTIVE / SELF_SUBMITTED / MD_FINALIZED before — the four
     statuses AMEND-3 retired. They are still in the enum because historical
     rows carry them, but nothing live ever reaches one, so three of these four
     tallies were permanently zero and three of the stage filter's options could
     never match a row.

     There is also no "awaiting self" any more, and that is the point of blind
     rating: both layers are open together during OPEN, so a screen cannot say
     which side is outstanding without reporting one side's progress to the
     other (§1, A3-8).
  */
  const counts = React.useMemo(
    () => ({
      total: rows.filter((r) => r.isActive).length,
      open: rows.filter((r) => r.isActive && r.status === "OPEN").length,
      withHr: rows.filter(
        (r) => r.isActive && (r.status === "PENDING_HR_REVIEW" || r.status === "HR_APPROVED"),
      ).length,
      done: rows.filter(
        (r) =>
          r.isActive &&
          (r.status === "MD_REVIEWED" || r.status === "INTERVIEW_DONE" || r.status === "CLOSED"),
      ).length,
    }),
    [rows],
  );

  const columns = React.useMemo<ColumnDef<PersonRow>[]>(
    () => [
      {
        accessorKey: "fullName",
        header: "Person",
        size: 240,
        meta: { frozen: true },
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-pill text-[11px] font-semibold",
                row.original.isActive
                  ? "bg-primary/10 text-primary"
                  : "bg-surface-mute text-ink-muted",
              )}
            >
              {initials(row.original.fullName)}
            </span>
            <span
              title={row.original.fullName}
              className="truncate text-body-sm font-medium text-ink"
            >
              {row.original.fullName}
            </span>
            {!row.original.isActive ? (
              <span className="shrink-0 rounded-pill bg-surface-mute px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
                Inactive
              </span>
            ) : null}
          </span>
        ),
      },
      {
        accessorKey: "employeeCode",
        header: "Code",
        size: 110,
        cell: ({ row }) => <GridCell value={dash(row.original.employeeCode)} className="tabular" />,
      },
      {
        accessorKey: "designation",
        header: "Designation",
        size: 180,
        cell: ({ row }) => <GridCell value={dash(row.original.designation)} />,
      },
      {
        accessorKey: "departmentName",
        header: "Department",
        size: 150,
        cell: ({ row }) => <GridCell value={dash(row.original.departmentName)} />,
      },
      {
        accessorKey: "leadName",
        header: "Reports to",
        size: 170,
        cell: ({ row }) => <GridCell value={dash(row.original.leadName)} />,
      },
      {
        id: "stage",
        header: "Stage",
        size: 160,
        cell: ({ row }) =>
          row.original.excluded ? (
            // P10-6: withdrawal is an `excluded_at`, not a status — somebody
            // nobody is waiting on should not sit in the chase list.
            <span className="rounded-pill bg-surface-mute px-2.5 py-1 text-[11px] font-medium text-ink-muted">
              Withdrawn
            </span>
          ) : row.original.status ? (
            <StatusChip status={row.original.status} />
          ) : (
            <span className="text-body-sm text-ink-muted">Not in this cycle</span>
          ),
      },
      /* The three layers, in their reserved colours, in the same order on every
         screen in the product (§13.1). */
      {
        id: "self",
        header: "Self",
        size: 84,
        meta: { align: "right" },
        cell: ({ row }) => <Score value={row.original.self} className={TIER_CLASSES.self.numeral} />,
      },
      {
        id: "lead",
        header: "Manager",
        size: 84,
        meta: { align: "right" },
        cell: ({ row }) => <Score value={row.original.lead} className={TIER_CLASSES.lead.numeral} />,
      },
      {
        id: "final",
        header: "Final",
        size: 84,
        meta: { align: "right" },
        cell: ({ row }) => (
          <Score value={row.original.final} className={TIER_CLASSES.final.numeral} />
        ),
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
                className="size-8 text-ink-muted hover:text-ink"
                aria-label={`Actions for ${row.original.fullName}`}
              >
                <MoreHorizontal className="size-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 border-rule">
              <DropdownMenuItem asChild>
                <Link href={`/scorecard?person=${row.original.id}`}>
                  <LineChart className="size-4" aria-hidden />
                  Open scorecard
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-rule" />
              {/* §5: salary lives behind this link, and it is a separate item
                  rather than part of the row — opening somebody's scorecard and
                  opening their pay record are two deliberate acts. */}
              <DropdownMenuItem asChild>
                <Link href={`/admin/people/${row.original.id}/employment`}>
                  <BadgeIndianRupee className="size-4" aria-hidden />
                  Employment &amp; pay
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [],
  );

  return (
    // The grid IS this screen, so it takes the viewport — the same shape as the
    // question bank and the people list in Settings. `data-full-bleed` drops
    // the shell's 1180px cap and its gutters (the :has() rule in globals.css).
    <div
      data-full-bleed
      className="flex h-[calc(100dvh-theme(spacing.topbar))] min-h-[26rem] flex-col overflow-hidden bg-surface"
    >
      {/* ---------- Header ---------- */}
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-4 border-b border-rule px-4 py-3 lg:px-6">
        <div className="min-w-0">
          <h1 className="text-display-sm font-semibold text-ink">Team review</h1>
          <p className="mt-0.5 text-body-sm text-ink-muted">
            {cycleLabel
              ? `Everyone in ${cycleLabel}. Open a person to see their scorecard.`
              : "No cycle is running yet. This list fills in once one is launched."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Tally label={TRACK_LABELS.STAFF} value={counts.total} />
          <Tally label="In progress" value={counts.open} tone="self" />
          <Tally label="With HR" value={counts.withHr} tone="warning" />
          <Tally label="Completed" value={counts.done} tone="final" />
        </div>
      </div>

      {/* ---------- Toolbar ---------- */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule bg-surface-mute px-3 py-2">
        <div className="relative min-w-0 flex-1 sm:w-[300px] sm:flex-none">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, code or designation"
            aria-label="Search people"
            className="min-h-11 border-rule bg-surface pl-9"
          />
        </div>

        <select
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          aria-label="Filter by department"
          className={SELECT_CLASS}
        >
          <option value={ANY}>All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>

        {/* The §8 statuses that a live evaluation can actually hold. The four
            AMEND-3 retired are not offered: an option that can never match a
            row is a dead control. */}
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter by stage"
          className={SELECT_CLASS}
        >
          <option value={ANY}>Any stage</option>
          <option value="OPEN">In progress</option>
          <option value="PENDING_HR_REVIEW">With HR</option>
          <option value="HR_APPROVED">Ready for the MD</option>
          <option value="MD_REVIEWED">Reviewed</option>
          <option value="INTERVIEW_DONE">Interview done</option>
          <option value="CLOSED">Closed</option>
        </select>

        <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-control border border-rule bg-surface px-3 text-body-sm text-ink">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="size-4 accent-primary"
          />
          Show inactive
        </label>

        <p className="ml-auto hidden items-center gap-1.5 text-body-sm text-ink-muted lg:flex">
          <Users aria-hidden className="size-3.5" />
          Accounts and reporting lines live in Settings › Users
        </p>
      </div>

      {/* ---------- The roster ---------- */}
      <DataGrid
        data={filtered}
        columns={columns}
        storageKey="appraise.team-review.column-widths"
        minWidth={1240}
        // Clicking a row opens that person's Employment & pay record. The ⋯
        // menu carries the same item and stays — a clickable <tr> is neither
        // focusable nor announced, so it is the enhancement and the menu is the
        // route a keyboard or screen-reader user takes (§13.8).
        //
        // §5: this lands on salary. Permitted because the screen is already
        // guarded to HR and the MD, and the employment route re-checks that for
        // itself rather than trusting this one.
        onRowClick={(person) => router.push(`/admin/people/${person.id}/employment`)}
        empty={
          <EmptyState
            title="Nobody matches that"
            body={
              rows.length === 0
                ? "No staff have been added yet. Add people in Settings › Users."
                : "Try a different search, department or stage."
            }
          />
        }
        status={
          <span className="tabular text-body-sm text-ink">
            {filtered.length} of {rows.length} {rows.length === 1 ? "person" : "people"}
          </span>
        }
      />
    </div>
  );
}

/* ---------- Small parts ---------- */

/** An absent score is an em dash, never 0.00 — missing is not zero (§11, P7-9). */
function Score({ value, className }: { value: number | null; className: string }) {
  return value === null ? (
    <span className="tabular text-body-sm text-ink-muted">—</span>
  ) : (
    <span className={cn("tabular text-body-sm font-semibold", className)}>{value.toFixed(1)}</span>
  );
}

/** §11 / P7-9: absent is an em dash, never an empty cell. */
function dash(value: string | null | undefined): string {
  return value && value.trim() ? value : "—";
}

/** The native select, styled to match the Input it sits beside in the toolbar. */
const SELECT_CLASS =
  "min-h-11 rounded-control border border-rule bg-surface px-3 text-body-sm text-ink";

const TALLY_TONE = {
  neutral: "text-ink",
  warning: "text-warning",
  self: TIER_CLASSES.self.numeral,
  final: TIER_CLASSES.final.numeral,
} as const;

function Tally({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: keyof typeof TALLY_TONE;
}) {
  return (
    <div className="rounded-card bg-surface px-3.5 py-2">
      <div className={cn("tabular text-body-lg font-semibold", TALLY_TONE[tone])}>{value}</div>
      <div className="text-[11px] text-ink-muted">{label}</div>
    </div>
  );
}
