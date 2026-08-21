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
import { byEmployeeCode } from "@/lib/utils/employee-code";
import { cn } from "@/lib/utils";
import { TRACK_LABELS } from "@/lib/forms/labels";

export type PersonRow = {
  id: string;
  fullName: string;
  employeeCode: string | null;
  designation: string | null;
  departmentName: string | null;
  leadName: string | null;
  /** The second reviewer (0083), if this person has one. Most people do not. */
  coReviewerName: string | null;
  isActive: boolean;
  /* -- Which team they are on. Production workers are appraised in their own
        module (§7), so every staff-evaluation cell below reads "Production
        team" for them rather than an em dash — a dash beside four other dashes
        says "not rated yet", which is a different and untrue claim. -- */
  track: string;
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
  cycles,
  cycleId,
}: {
  rows: PersonRow[];
  departments: string[];
  cycleLabel: string | null;
  /** Every open or closed cycle, newest first. The switcher's options. */
  cycles: Array<{ id: string; name: string; periodLabel: string }>;
  /** The one the stage and score columns describe. */
  cycleId: string | null;
}) {
  const [search, setSearch] = React.useState("");
  const [department, setDepartment] = React.useState(ANY);
  const [status, setStatus] = React.useState(ANY);
  /* -- Both teams are on one roster now, so there has to be a way to see one.
        `ANY` is the default: HR looking for a person does not know or care
        which module appraises them, and the point of one list is that they do
        not have to. -- */
  const [team, setTeam] = React.useState(ANY);
  const [showInactive, setShowInactive] = React.useState(false);
  const router = useRouter();
  // The per-row entrance animation went with the list. A grid of forty rows
  // staggering in is motion for its own sake, and DataGrid renders a table
  // rather than a stack of cards — framer-motion is no longer imported here.

  /* -- ORDERED BY EMPLOYEE ID: 01, 02, 03.
        The list came back alphabetically by name, which is a fine default and
        not the one HR asked for — their codes run in joining order (NA-01,
        KA-02, KE-03…), so sorting by them puts the roster in the sequence the
        payroll sheet is already in.

        `byEmployeeCode` is SHARED with Settings › Users, which shows the same
        people. A roster that orders itself differently depending on which
        screen you opened is the kind of difference nobody can explain later —
        and the second copy is always the one that drifts. -- */
  const filtered = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!showInactive && !r.isActive) return false;
      if (department !== ANY && r.departmentName !== department) return false;
      if (status !== ANY && r.status !== status) return false;
      if (team !== ANY && r.track !== team) return false;
      if (!needle) return true;
      // Employee code as well as name: HR looks people up by code as often as
      // by spelling, and a name search alone makes them scroll.
      return (
        r.fullName.toLowerCase().includes(needle) ||
        (r.employeeCode ?? "").toLowerCase().includes(needle) ||
        (r.designation ?? "").toLowerCase().includes(needle)
      );
    }).sort(byEmployeeCode);
  }, [rows, search, department, status, team, showInactive]);

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
      /* -- Counted PER TEAM, because one number over two modules answers
            nothing: a production worker is never in a staff cycle, so folding
            them into "Backend Team" would overstate it and folding them into
            the stage counts would understate every one of those. -- */
      staff: rows.filter((r) => r.isActive && r.track !== "WORKER").length,
      workers: rows.filter((r) => r.isActive && r.track === "WORKER").length,
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
                "grid size-7 shrink-0 place-items-center rounded-pill text-body-xs font-semibold",
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
              <span className="shrink-0 rounded-pill bg-surface-mute px-1.5 py-0.5 text-body-xs font-medium text-ink-muted">
                Inactive
              </span>
            ) : null}
          </span>
        ),
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
        accessorKey: "coReviewerName",
        header: "Second reviewer",
        size: 170,
        cell: ({ row }) => <GridCell value={dash(row.original.coReviewerName)} />,
      },
      {
        id: "team",
        header: "Team",
        size: 130,
        cell: ({ row }) => (
          <GridCell
            value={row.original.track === "WORKER" ? "Production" : "Backend"}
          />
        ),
      },
      {
        id: "stage",
        header: "Stage",
        size: 160,
        cell: ({ row }) =>
          /* -- A WORKER IS NOT "not in this cycle". They are appraised in their
                own module on their own rounds (§7), so saying they are absent
                from a staff cycle is true and useless — and it reads as
                somebody who was left out. Named, and linked to where their
                appraisals actually are. -- */
          row.original.track === "WORKER" ? (
            <Link
              href="/admin/worker-appraisals"
              className="text-body-sm text-ink-muted underline-offset-2 hover:text-primary hover:underline"
            >
              Production appraisals
            </Link>
          ) : row.original.excluded ? (
            // P10-6: withdrawal is an `excluded_at`, not a status — somebody
            // nobody is waiting on should not sit in the chase list.
            <span className="rounded-pill bg-surface-mute px-2.5 py-1 text-body-xs font-medium text-ink-muted">
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
        cell: ({ row }) =>
          row.original.track === "WORKER" ? (
            <span className="text-body-sm text-ink-faint">—</span>
          ) : (
            <Score value={row.original.self} className={TIER_CLASSES.self.numeral} />
          ),
      },
      {
        id: "lead",
        header: "HOD",
        size: 84,
        meta: { align: "right" },
        cell: ({ row }) =>
          row.original.track === "WORKER" ? (
            <span className="text-body-sm text-ink-faint">—</span>
          ) : (
            <Score value={row.original.lead} className={TIER_CLASSES.lead.numeral} />
          ),
      },
      /* -- AVERAGE, NOT "FINAL", and the difference is real rather than a
            rename (AMEND-5, at the owner's instruction).

            The column read `evaluations.final_overall`, which since 0046 is
            written in exactly ONE place: `confirm_increment`, when an INCREMENT
            cycle closes. On an evaluation cycle it is null for ever — so for
            most of this roster the column was a permanent em dash, and where it
            did fill in it was a settled increment score, not an average of
            anything. Relabelling that "Average" would have put a wrong name on
            a real number, which is worse than a column nobody reads.

            So it now IS the average §11 permits: the mean of Self and HOD,
            computed on read, stored nowhere.

            BOTH OR NOTHING (A5-2). One side alone is not an average of two, and
            printing the manager's figure there would say the two sides agreed
            when only one of them has answered.

            PLAIN INK, no tier colour (A5-4). Cyan means "the employee said
            this" and pink "their HOD did"; an average belongs to neither, which
            is exactly the objection §11 raised before the owner chose it. -- */
      {
        id: "average",
        header: "Average",
        size: 84,
        meta: { align: "right" },
        cell: ({ row }) => {
          const { self, lead, track } = row.original;
          if (track === "WORKER") return <span className="text-body-sm text-ink-faint">—</span>;
          const mean = self !== null && lead !== null ? (self + lead) / 2 : null;
          return <Score value={mean} className="text-ink" />;
        },
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
                className="min-h-11 min-w-11 text-ink-muted hover:text-ink lg:size-8"
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
    // The grid IS this screen, so it takes the viewport — the same shape as
    // the question bank and Settings › Users, which this now lives beside.
    // `data-full-bleed` drops the shell's 1180px cap and its gutters (the
    // :has() rule in globals.css). The `-5rem` matches Users' own calc: this
    // renders under Settings' TabsList now, not straight below the topbar, so
    // it has to give back the height that strip takes — Users' comment
    // explains the same subtraction for the same reason.
    <div
      data-full-bleed
      className="flex h-[calc(100dvh-theme(spacing.topbar)-5rem-var(--bottom-nav-h))] min-h-[26rem] flex-col overflow-hidden bg-surface"
    >
      {/* ---------- Header ---------- */}
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-4 border-b border-rule px-4 py-3 lg:px-6">
        <div className="min-w-0">
          <h1 className="text-display-sm font-semibold text-ink">Team review</h1>
          <p className="mt-0.5 text-body-sm text-ink-muted">
            {/* -- The list no longer depends on a staff cycle running, so it
                  no longer says it does. It carried "No cycle is running yet.
                  This list fills in once one is launched" over five populated
                  rows, which was already odd; with the production team in it
                  the sentence would be plainly wrong. Everybody is here always,
                  and the CYCLE is what the stage and score columns describe. -- */}
            {cycleLabel
              ? `Everybody, both teams. Stages and scores are for ${cycleLabel}.`
              : "Everybody, both teams. Stages and scores fill in once a cycle is launched."}
          </p>

          {/* -- WHICH CYCLE, when there is more than one.
                Only rendered above one: a single chip that cannot be switched
                away from is a control with nothing to do, and the sentence
                above already names the cycle.

                It SWITCHES rather than merges. An Evaluation round and an
                Increment round are two different exercises, so a mean over both
                describes neither and §11 keeps a score inside the cycle it was
                given in. The four counters change with it, which is what keeps
                them meaningful — "0 In progress" is then a fact about one
                exercise rather than a mix of two.

                Links, not state: the choice belongs in the URL so it survives a
                refresh and can be sent to somebody, and the rows are a server
                read anyway. The dashboard's own switcher, on the screen that
                never got one. -- */}
          {cycles.length > 1 ? (
            <div
              role="group"
              aria-label="Choose a cycle"
              className="mt-2 flex flex-wrap items-center gap-1"
            >
              {cycles.map((c) => {
                const current = c.id === cycleId;
                return (
                  <Link
                    key={c.id}
                    href={`/admin/settings?tab=team-review&cycle=${c.id}`}
                    aria-current={current ? "true" : undefined}
                    title={c.periodLabel}
                    className={cn(
                      "inline-flex min-h-11 items-center rounded-pill px-3 text-body-sm transition-colors sm:min-h-0 sm:py-1",
                      current
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-ink-muted hover:bg-surface-mute hover:text-ink",
                    )}
                  >
                    {c.name}
                  </Link>
                );
              })}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Tally label={TRACK_LABELS.STAFF} value={counts.staff} />
          <Tally label={TRACK_LABELS.WORKER} value={counts.workers} />
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

        <select
          value={team}
          onChange={(e) => setTeam(e.target.value)}
          aria-label="Filter by team"
          className={SELECT_CLASS}
        >
          <option value={ANY}>Both teams</option>
          <option value="STAFF">{TRACK_LABELS.STAFF}</option>
          <option value="WORKER">{TRACK_LABELS.WORKER}</option>
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
        /* -- The employee code IS the row number here, so it takes the gutter
              rather than sitting in a column beside a counter that says the
              same thing. The gutter keeps its job as the one focusable control
              per row — "remove the #" could not be granted by deleting it. -- */
        rowLabel={{ header: "Employee ID", value: (p) => p.employeeCode || "—" }}
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
      <div className="text-body-xs text-ink-muted">{label}</div>
    </div>
  );
}
