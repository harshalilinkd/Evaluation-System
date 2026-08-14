"use client";

/** The increment calendar. Salary figures here — HR and the MD only (§5). */

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, HardHat, Rocket, Search, Upload } from "lucide-react";

import { EmploymentImportDialog } from "@/app/(app)/admin/increments/import-panel";
import { DataGrid, GridCell } from "@/components/appraise/data-grid";
import {
  KpiCard,
  KpiRow,
  SCREEN_SELECT_CLASS as SELECT_CLASS,
  ScreenHeader,
  ScreenToolbar,
  TableScreen,
} from "@/components/appraise/screen";
import { EmptyState } from "@/components/appraise/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { IncrementCalendar, IncrementDue } from "@/lib/employment/queries";
import { formatDate, formatInr } from "@/lib/utils/date";

const ANY = "__any__";

/** "Aug 2026" — HR thinks in months on this screen. */
function monthLabel(iso: string): string {
  const d = new Date(`${iso.slice(0, 7)}-01T00:00:00`);
  return d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

export function IncrementsClient({
  calendar,
  departments,
  canImport,
}: {
  calendar: IncrementCalendar;
  departments: string[];
  /** §9: the MD reads the employment record, HR writes it. Import is a write. */
  canImport: boolean;
}) {
  const [department, setDepartment] = React.useState(ANY);
  const [month, setMonth] = React.useState(ANY);
  const [overdueOnly, setOverdueOnly] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [importOpen, setImportOpen] = React.useState(false);
  /* -- The three counts, made pressable.
        Its OWN key rather than driving the month select, because the counts use
        predicates that select cannot express: "due this month" is the month AND
        not already late, so routing it through the month filter would reveal
        overdue rows under a tile reading 0. The month strings come from the
        server, so the tile filters by exactly what its number was counted
        from — a client `new Date()` could disagree across midnight or in
        another timezone (§0.10). -- */
  const [tile, setTile] = React.useState<null | "this" | "next" | "overdue">(null);
  const toggleTile = (next: "this" | "next" | "overdue") =>
    setTile((current) => (current === next ? null : next));

  const months = React.useMemo(
    () => [...new Set(calendar.rows.map((r) => r.nextIncrementDate.slice(0, 7)))].sort(),
    [calendar.rows],
  );

  const filtered = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return calendar.rows.filter((r) => {
      if (department !== ANY && r.departmentName !== department) return false;
      if (month !== ANY && !r.nextIncrementDate.startsWith(month)) return false;
      if (overdueOnly && r.daysRemaining >= 0) return false;
      // Mirrors `getIncrementCalendar`'s own predicates, clause for clause.
      if (tile === "this" && !(r.nextIncrementDate.startsWith(calendar.thisMonth) && r.daysRemaining >= 0))
        return false;
      if (tile === "next" && !r.nextIncrementDate.startsWith(calendar.nextMonth)) return false;
      if (tile === "overdue" && r.daysRemaining >= 0) return false;
      if (!needle) return true;
      return (
        r.name.toLowerCase().includes(needle) ||
        (r.employeeCode ?? "").toLowerCase().includes(needle)
      );
    });
  }, [calendar.rows, calendar.thisMonth, calendar.nextMonth, department, month, overdueOnly, tile, search]);

  /* -- WHO A ROUND WOULD COVER: overdue, plus this month and next.
        The same set the wizard selects for `?increment_for=due`, counted here
        so the button can say how many people it is about rather than opening a
        screen to find out. Both read the next-increment date against the
        SERVER's month keys, never a browser clock (F50-3). -- */
  /* -- ONE BUTTON BECAME TWO, at the owner's instruction: "give two different
        buttons, one for the production team and one for the backend team, so it
        will not create confusion."

        This settles an argument that went round twice. A staff increment CYCLE
        cannot hold a production worker — §7 gives them their own rounds, their
        own tick sheet and their own salary block — so a single button either
        over-promised (reading 8 and selecting 3) or disagreed with the tiles
        beside it (reading 3 under "3 overdue · 5 due"). Both were reported.

        Splitting it removes the choice between those two wrongs: each button
        counts its own team, each says which team it is for, and each lands on
        the screen that can actually start that round. Nothing needs explaining
        after the fact, because nothing drops. -- */
  const dueSoon = React.useMemo(
    () =>
      calendar.rows.filter(
        (r) =>
          r.daysRemaining < 0 ||
          r.nextIncrementDate.startsWith(calendar.thisMonth) ||
          r.nextIncrementDate.startsWith(calendar.nextMonth),
      ),
    [calendar.rows, calendar.thisMonth, calendar.nextMonth],
  );

  /* Split by §7's module. `track` is on the row for exactly this. */
  const productionDue = dueSoon.filter((r) => r.track === "WORKER").length;
  const backendDue = dueSoon.length - productionDue;

  /*
     ONE TABLE, not a section per month.

     The screen used to render a card per month with its own header and its own
     `<table>`, plus a toggle between that and a flat list. Two shapes for one
     list is two things to keep in step, and the grouped shape put a fresh header
     row every few people — so a column could not be compared down the page,
     which is the whole reason this is a table. The month is a filter and it is
     legible in "Next due"; it does not also need to be a heading.
  */
  const columns = React.useMemo<ColumnDef<IncrementDue>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Employee",
        size: 220,
        meta: { frozen: true },
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden
              className="grid size-7 shrink-0 place-items-center rounded-pill bg-primary/10 text-[11px] font-semibold text-primary"
            >
              {initials(row.original.name)}
            </span>
            <span title={row.original.name} className="truncate text-body-sm font-medium text-ink">
              {row.original.name}
            </span>
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
        /* -- WHICH MODULE APPRAISES THEM.
              The two round buttons above split by exactly this, and the table
              underneath said nothing about it — so "Start for Production team
              (5)" named a group nobody could pick out of the list. Department
              does not answer it either: Nandkishor is in "production
              Coordinator" and is Backend Team.
              A word, not a colour: §13.8, and neither team is a state. -- */
        accessorKey: "track",
        header: "Team",
        size: 130,
        cell: ({ row }) => (
          <GridCell value={row.original.track === "WORKER" ? "Production" : "Backend"} />
        ),
      },
      {
        accessorKey: "departmentName",
        header: "Department",
        size: 160,
        cell: ({ row }) => <GridCell value={dash(row.original.departmentName)} />,
      },
      {
        accessorKey: "dateOfJoining",
        header: "Joined",
        size: 120,
        cell: ({ row }) => (
          <GridCell value={formatDate(row.original.dateOfJoining)} className="tabular" />
        ),
      },
      {
        accessorKey: "lastIncrementDate",
        header: "Last increment",
        size: 140,
        cell: ({ row }) => (
          <GridCell value={formatDate(row.original.lastIncrementDate)} className="tabular" />
        ),
      },
      {
        // Was the second line under the name. A grid cell is one line, so it
        // becomes a column of its own rather than being dropped — "13 months
        // since last" is the figure that says whether a date is really overdue.
        accessorKey: "monthsSinceLast",
        header: "Months since",
        size: 120,
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="tabular text-body-sm text-ink-muted">
            {row.original.monthsSinceLast ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "nextIncrementDate",
        header: "Next due",
        size: 130,
        cell: ({ row }) => (
          <span className="tabular truncate text-body-sm font-medium text-ink">
            {formatDate(row.original.nextIncrementDate)}
          </span>
        ),
      },
      {
        // Late is a glyph AND a word, never the rose alone (§13.8) — this is the
        // one signal the grouped headers used to carry.
        accessorKey: "daysRemaining",
        header: "Days",
        size: 110,
        meta: { align: "right" },
        cell: ({ row }) =>
          row.original.daysRemaining < 0 ? (
            <span className="tabular inline-flex items-center gap-1 rounded-pill bg-critical-tint px-2 py-0.5 text-body-sm font-medium text-critical">
              <AlertTriangle aria-hidden className="size-3" />
              {Math.abs(row.original.daysRemaining)} late
            </span>
          ) : (
            <span className="tabular text-body-sm text-ink-muted">{row.original.daysRemaining}</span>
          ),
      },
      {
        // §0.10: ₹ with Indian digit grouping, tabular so a column of salaries
        // lines up at the decimal point.
        accessorKey: "currentCtc",
        header: "Current CTC",
        size: 140,
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="tabular text-body-sm font-medium text-ink">
            {formatInr(row.original.currentCtc)}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        size: 150,
        enableResizing: false,
        cell: ({ row }) => (
          <Button asChild variant="outline" size="sm" className="min-h-11 whitespace-nowrap lg:h-8">
            {/* -- ROUTED BY TRACK, and this was a real defect.
                  Every row linked to the staff wizard, so pressing it on a
                  production worker opened the office 0–5 form for somebody who
                  is appraised on a tick sheet by their supervisor. §7 gives the
                  worker module its own rounds, its own questions and its own
                  salary block; there is no staff form for them at all.

                  The two round buttons above already split this way. This is the
                  same split, one row at a time.

                  STEP 2 on the staff path, like both round buttons: the type,
                  the name and the period are all decided before the link is
                  followed, so landing on Basics made HR press Continue through
                  a form nobody had to fill in. -- */}
            <Link
              href={
                row.original.track === "WORKER"
                  ? `/admin/worker-appraisals?start=${row.original.profileId}`
                  : `/admin/cycles/new?increment_for=${row.original.profileId}&step=2`
              }
            >
              Start increment
            </Link>
          </Button>
        ),
      },
    ],
    [],
  );

  return (
    // The grid IS this screen, so it takes the viewport. `TableScreen` carries
    // the `data-full-bleed` that drops the shell's 1180px cap and its gutters.
    <TableScreen>
      <ScreenHeader
        title="Increment calendar"
        subtitle={`${calendar.next90} ${calendar.next90 === 1 ? "increment is" : "increments are"} due in the next 90 days · overdue people first`}
        action={
          /* -- ONE BUTTON FOR THE WHOLE ROUND, at the owner's instruction:
                "HR filters to due next month, then clicks a single button. That
                button redirects her straight to the evaluation page with all
                overdue + due-next-month employees already selected."

                It was one "Start increment" per row, so a pay round of twelve
                people meant twelve cycles — which is not what a round is. The
                per-row button stays for the genuine single case (somebody
                promoted off-cycle) and is now the secondary of the two.

                No list of ids in the URL: `?increment_for=due` says WHAT to
                select and the wizard works out WHO, from the same
                `isIncrementDue` the counts above use. A URL carrying fifty
                uuids is one that breaks at the browser's length limit and
                cannot be typed, bookmarked or reasoned about. -- */
          canImport ? (
            <div className="flex flex-wrap items-center gap-2">
              {backendDue > 0 ? (
                <Button asChild className="min-h-11">
                  {/* STEP 2, because step 1 is already answered: the type,
                      the name and the period are all filled in before this
                      screen opens. Landing on Basics made HR press Continue
                      through a form nobody had to fill in. */}
                  <Link href="/admin/cycles/new?increment_for=due&step=2">
                    <Rocket aria-hidden className="size-4" />
                    Start for Backend team ({backendDue})
                  </Link>
                </Button>
              ) : null}

              {/* -- The production half. It lands on the round dialog rather
                    than the staff wizard, because a worker is appraised on a
                    tick sheet by their supervisor — there is no form for them
                    on the other screen at all.
                    `?start=due` says WHAT to tick, not who: the same rule this
                    button counts by resolves the list on arrival, so a URL
                    never carries a page of uuids (PR-8's reasoning). -- */}
              {productionDue > 0 ? (
                <Button asChild variant={backendDue > 0 ? "outline" : "default"} className="min-h-11">
                  <Link href="/admin/worker-appraisals?start=due">
                    <HardHat aria-hidden className="size-4" />
                    Start for Production team ({productionDue})
                  </Link>
                </Button>
              ) : null}

            <Button
              variant={dueSoon.length > 0 ? "outline" : "default"}
              className="ml-1 min-h-11"
              onClick={() => setImportOpen(true)}
            >
              <Upload aria-hidden className="size-4" />
              Import employment data
            </Button>
            </div>
          ) : null
        }
      />

      <KpiRow>
        <KpiCard
          label="Due this month"
          value={calendar.dueThisMonth}
          tone="self"
          onSelect={() => toggleTile("this")}
          active={tile === "this"}
        />
        <KpiCard
          label="Due next month"
          value={calendar.dueNextMonth}
          tone="lead"
          onSelect={() => toggleTile("next")}
          active={tile === "next"}
        />
        <KpiCard
          label="Overdue"
          value={calendar.overdue}
          tone={calendar.overdue > 0 ? "critical" : "plain"}
          caption={calendar.overdue > 0 ? "Already past their date" : "Nobody is late"}
          onSelect={() => toggleTile("overdue")}
          active={tile === "overdue"}
        />
      </KpiRow>

      {/* ---------- Toolbar ---------- */}
      <ScreenToolbar>
        <div className="relative min-w-0 flex-1 sm:w-[300px] sm:flex-none">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or code"
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
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          aria-label="Filter by month"
          className={SELECT_CLASS}
        >
          <option value={ANY}>Any month</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>

        <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-control border border-rule bg-surface px-3 text-body-sm text-ink">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(e) => setOverdueOnly(e.target.checked)}
            className="size-4 accent-critical"
          />
          Overdue only
        </label>
      </ScreenToolbar>

      {/* ---------- The calendar ---------- */}
      <DataGrid
        data={filtered}
        columns={columns}
        storageKey="appraise.increments.column-widths"
        rowNoun="person"
        rowTitle={(r) => r.name}
        rowActions={(r) => (
          <Button asChild className="min-h-11">
            <Link href={`/admin/cycles/new?increment_for=${r.profileId}`}>Start increment</Link>
          </Button>
        )}
        minWidth={1380}
        empty={
          <EmptyState
            title="Nobody matches that"
            body={
              calendar.rows.length === 0
                ? "No employment records carry a next increment date yet. Add joining details on a person's Employment tab, or import the whole payroll from a CSV."
                : "Try a different department, month or search."
            }
          />
        }
        status={
          <span className="tabular text-body-sm text-ink">
            {filtered.length} of {calendar.rows.length}{" "}
            {calendar.rows.length === 1 ? "person" : "people"}
          </span>
        }
      />

      {canImport ? (
        <EmploymentImportDialog open={importOpen} onOpenChange={setImportOpen} />
      ) : null}
    </TableScreen>
  );
}

/* ---------- Small parts ---------- */

/** Initials for the avatar. Two at most — three stops reading as initials. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** §11 / P7-9: absent is an em dash, never an empty cell. */
function dash(value: string | null | undefined): string {
  return value && value.trim() ? value : "—";
}

/* `Tally` and the select class moved to components/appraise/screen.tsx when the
   same header appeared on a fifth screen. One implementation, not five. */

