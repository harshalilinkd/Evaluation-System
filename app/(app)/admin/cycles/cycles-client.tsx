"use client";

/** The cycle list. One structured grid, the same as every other table-first screen. */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import {
  CalendarPlus,
  Check,
  MoreHorizontal,
  Pencil,
  Plus,
  Send,
  SquareArrowOutUpRight,
  Trash2,
} from "lucide-react";

import { CycleSectionNav } from "@/components/appraise/cycle-section-nav";
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
import { cn } from "@/lib/utils";

/** §11 / P7-9: absent is an em dash, never blank and never a zero. */
function dash(value: string | null): string {
  return value ? formatDate(value) : "—";
}

/**
 * OVERDUE was designed into `StatusChip` from the start (DESIGN.md §6.5,
 * "computed from the audit trail and the cycle deadlines") and never actually
 * computed anywhere — the styleguide is the only place the word appeared in
 * the whole app. So a cycle sitting past its own due date with people still
 * unsubmitted read as plain "Cycle active", identical to one that had just
 * launched an hour ago, with nothing on this grid to tell HR the two apart.
 *
 * A cycle counts as overdue when EITHER date it set for itself has passed
 * with that side still short of everybody — never on a DRAFT (nothing was
 * due yet) or a CLOSED one (it is a record, not a wait).
 */
function isPast(iso: string | null): boolean {
  if (!iso) return false;
  return new Date(`${iso}T00:00:00`).getTime() < Date.now();
}

function cycleIsOverdue(row: CycleListRow): boolean {
  if (row.status !== "ACTIVE") return false;
  const selfShort = isPast(row.selfDueOn) && row.progress.self < row.participants;
  const leadShort = isPast(row.leadDueOn) && row.progress.lead < row.participants;
  return selfShort || leadShort;
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
  /* -- The two kinds of cycle, kept apart.
        §1: they share the form and the blind parallel flow and differ only in
        how they END — an increment carries on into salary and needs the MD's
        approval, a plain evaluation does not (0039). Those are different jobs
        on different timetables, and mixing them in one list meant reading the
        Type column on every row to know which was which. -- */
  const [kind, setKind] = React.useState<"EVALUATION" | "INCREMENT">("EVALUATION");

  const counts = React.useMemo(
    () => ({
      evaluation: cycles.filter((c) => c.cycleType === "EVALUATION").length,
      increment: cycles.filter((c) => c.cycleType === "INCREMENT").length,
    }),
    [cycles],
  );

  const rows = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return cycles.filter((c) => {
      if (c.cycleType !== kind) return false;
      if (!needle) return true;
      return (
        c.name.toLowerCase().includes(needle) || c.periodLabel.toLowerCase().includes(needle)
      );
    });
  }, [cycles, search, kind]);

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
            status={
              cycleIsOverdue(row.original)
                ? "OVERDUE"
                : row.original.status === "ACTIVE"
                  ? "CYCLE_ACTIVE"
                  : row.original.status
            }
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
      /* -- TWO POPULATIONS, NOT ONE.
            "People 3" answered half the question. A cycle is three employees
            filling their own form AND however many managers are rating them —
            rarely the same number, because one HOD usually rates several. The
            row detail was reported as not saying how many of each.

            Two columns rather than one reading "3 · 2": the detail dialog
            renders every column as its own labelled row, so splitting them is
            what makes the dialog say "Employees 3 / Managers 2" instead of
            leaving the reader to work out which number is which. -- */
      {
        accessorKey: "participants",
        header: "Employees",
        size: 96,
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="tabular text-body-sm text-ink">{row.original.participants}</span>
        ),
      },
      {
        accessorKey: "managers",
        header: "Managers",
        size: 96,
        meta: { align: "right" },
        cell: ({ row }) => (
          <span
            className="tabular text-body-sm text-ink"
            /* Distinct people, not one per employee — worth saying once, where
               somebody who expects the two counts to match will look. */
            title={
              row.original.managers === 1
                ? "One manager is rating everybody in this cycle."
                : `${row.original.managers} different managers are rating in this cycle.`
            }
          >
            {row.original.managers}
          </span>
        ),
      },
      /*
        WHETHER THE LINKS HAVE GONE OUT.

        The row menu offered "Send links" with nothing beside it to say they
        already had, so the only ways to find out were to open the distribution
        screen or to send them a second time and watch. On the one action that
        messages the whole company, "have I already done this?" has to be
        answerable from the list.

        A word AND a count, never a tick alone — a partial send is the state
        that matters most and a tick cannot express it (§13.8).
      */
      {
        id: "links",
        header: "Links",
        size: 122,
        cell: ({ row }) => (
          <LinksCell sent={row.original.linksSent} of={row.original.participants} />
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
        header: "Manager in",
        size: 84,
        meta: { align: "right" },
        /* -- COUNTS A PERSON ONLY ONCE EVERY MANAGER ASKED HAS ANSWERED.
              Reported as a contradiction: this cell read "0/1" while the
              detail dialog's own manager list showed one of the two — a
              second reviewer's cycle — sitting at "1 of 1". Both numbers were
              right (`reachedLead` requires the REPORTING lead AND a second
              reviewer, where one is assigned, before counting the person as
              in), the confusion was that nothing said so. A tooltip here,
              since a hover is what the grid gets; the dialog gets its own
              sentence below, since nothing there can be hovered on a phone. -- */
        cell: ({ row }) => (
          <Count
            value={row.original.progress.lead}
            of={row.original.participants}
            title="Counts a person once every manager asked has submitted — for somebody with a second reviewer, that is both, not just one."
          />
        ),
      },
      {
        id: "coLead",
        header: "2nd reviewer in",
        size: 110,
        meta: { align: "right" },
        /* -- ITS OWN COLUMN, so it can be tracked separately from "Manager
              in" rather than only inside that column's blended count (which
              needs BOTH managers before it counts anyone, per the comment
              above) or the row-detail dialog, which nothing on a phone or a
              quick scan down the table can reach. `total` here is NOT
              `participants` — it is only the people who actually carry a
              second reviewer, so a cycle with none shows an em dash rather
              than a false "0 of 12". -- */
        cell: ({ row }) =>
          row.original.coReviewerIn ? (
            <Count
              value={row.original.coReviewerIn.done}
              of={row.original.coReviewerIn.total}
              title="Second reviewers only — people with no second reviewer on this cycle are not counted."
            />
          ) : (
            <span className="text-body-sm text-ink-muted">—</span>
          ),
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
        header: "Manager due",
        size: 116,
        cell: ({ row }) => <GridCell value={dash(row.original.leadDueOn)} className="tabular" />,
      },
      /* The "MD due" column is gone — `md_due_on` is derived from the lead's
         date now, so it was a column repeating the one beside it. */
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
              {/* The label says what pressing it would DO, given what has
                  already happened. "Send links" on a cycle whose links all went
                  out last week invites somebody to message the whole company
                  twice — the menu is the last place that should stay silent
                  about it. */}
              <DropdownMenuItem asChild>
                <Link href={`/admin/cycles/${row.original.id}/distribute`}>
                  <Send className="size-4" aria-hidden />
                  {row.original.linksSent === 0
                    ? "Send links"
                    : row.original.linksSent >= row.original.participants
                      ? "Links sent · resend"
                      : `Send the remaining ${row.original.participants - row.original.linksSent}`}
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
      <CycleSectionNav />

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

      {/* ---------- Two tabs: Evaluation, Increment ----------
          Not a filter with an "All" — the two are different jobs on different
          timetables, and since 0039 they even END differently: an evaluation
          can be completed by HR alone, an increment still needs the MD on the
          salary. A list mixing them means reading the Type column on every row
          to know which kind you are looking at.

          Tabs rather than a segmented control because this is navigation
          between two views, not a filter over one. The count is on each tab so
          "do we have any increments running?" is answered without switching. */}
      <div
        role="tablist"
        aria-label="Which kind of cycle"
        className="flex shrink-0 items-end gap-1 border-b border-rule px-4 lg:px-6"
      >
        {(
          [
            { value: "EVALUATION", label: "Evaluation", count: counts.evaluation },
            { value: "INCREMENT", label: "Increment", count: counts.increment },
          ] as const
        ).map((tab) => {
          const active = kind === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setKind(tab.value)}
              className={cn(
                "-mb-px flex min-h-11 items-center gap-2 border-b-2 px-4 text-body-sm font-medium transition-colors",
                active
                  ? "border-b-primary text-ink"
                  : "border-b-transparent text-ink-muted hover:text-ink",
              )}
            >
              {tab.label}
              <span
                className={cn(
                  "tabular rounded-pill px-1.5 py-0.5 text-body-xs",
                  active ? "bg-primary/10 text-primary" : "bg-surface-mute text-ink-muted",
                )}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule bg-surface-mute px-3 py-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search cycles"
          aria-label="Search cycles"
          className="min-h-11 w-full border-rule bg-surface sm:w-[240px]"
        />
        <p className="ml-auto hidden text-body-sm text-ink-muted lg:block">
          Deleted cycles go to Settings › Recycle bin, and can be restored.
        </p>
      </div>

      <DataGrid
        data={rows}
        columns={columns}
        storageKey="appraise.cycles.column-widths"
        rowNoun="cycle"
        rowTitle={(c) => `${c.name} · ${c.periodLabel}`}
        // The dialog SHOWS the row; these are what can be done with it. Without
        // them it is a read-only summary of a row the reader is looking at,
        // which is the least useful thing it could be.
        /* -- WHO IS IN IT, AND WHO IS HOLDING IT UP.
              The counts above say how much work there is; these say who to
              talk to. A column cannot hold a list, so it goes in the dialog's
              own slot beneath the fields.

              §5 IS SATISFIED BY THE ROUTE, not by this component. `/admin/
              cycles` is HR and MD only, and §9 gives both of them each side —
              so naming who has submitted on both layers is theirs to see. On a
              lead-facing screen the same list would be a leak, which is why the
              query's own comment says so. -- */
        rowDetail={(c) => (
          <div className="space-y-3">
            {/* -- THE TWO MANAGERS, SEPARATELY — reported as unclear: "Manager
                  in 0/1" up top read lower than the breakdown below, which
                  already showed one of the two managers fully done, and a
                  tooltip explaining the blended figure was not enough to
                  resolve the confusion. Two plain rows instead, styled like
                  "Self in"/"Manager in" above — the same shape everywhere a
                  count appears on this dialog — so each number needs no
                  explanation of its own. Shown only when this cycle actually
                  has a second reviewer; the ordinary two-form cycle carries
                  no extra rows to read past. -- */}
            {c.coReviewerIn ? (
              <dl className="rounded-control border border-rule">
                <div className="grid grid-cols-[9rem_1fr] items-baseline gap-3 border-b border-rule px-3 py-2.5">
                  <dt className="type-label font-bold text-ink">Manager in</dt>
                  <dd className="font-sans text-body text-ink">
                    {c.reportingLeadIn.done}/{c.reportingLeadIn.total}
                  </dd>
                </div>
                <div className="grid grid-cols-[9rem_1fr] items-baseline gap-3 px-3 py-2.5">
                  {/* Not the designation of any one person — a cycle can mix
                      second reviewers with different titles, and this is
                      the same word the roster elsewhere already uses for
                      the role (Team review's "2nd rating"). */}
                  <dt className="type-label font-bold text-ink">2nd reviewer in</dt>
                  <dd className="font-sans text-body text-ink">
                    {c.coReviewerIn.done}/{c.coReviewerIn.total}
                  </dd>
                </div>
              </dl>
            ) : null}
            <div className="grid gap-5 sm:grid-cols-2">
              <PeopleList
                title="Employees"
                empty="Nobody has been added yet."
                rows={c.employees.map((e, i) => ({
                  // Names are not unique (§0.2 forbids inventing an id here
                  // that does not exist on the row), so the index breaks a
                  // tie rather than two "Priya Sharma" rows colliding as one
                  // React key.
                  key: `${e.name}-${i}`,
                  name: e.name,
                  designation: e.designation,
                  done: e.submitted,
                  note: e.submitted ? "Submitted" : "Not yet",
                }))}
              />
              <PeopleList
                title="Managers"
                empty="Nobody has a manager assigned."
                rows={c.managerRows.map((m, i) => ({
                  key: `${m.name}-${i}`,
                  name: m.name,
                  designation: m.designation,
                  done: m.done === m.total,
                  /* -- The FRACTION, not "pending". A HOD rating six people
                        can be finished for four, and one word would say the
                        same thing about them as about somebody who has done
                        none. -- */
                  note: `${m.done} of ${m.total}`,
                }))}
              />
            </div>
          </div>
        )}
        rowActions={(c) => (
          <>
            <Button asChild variant="secondary" className="min-h-11">
              <Link href={`/admin/cycles/${c.id}/distribute`}>
                <Send className="size-4" aria-hidden />
                {c.linksSent === 0 ? "Send links" : "Links"}
              </Link>
            </Button>
            <Button asChild className="min-h-11">
              <Link href={`/admin/cycles/${c.id}`}>Open cycle</Link>
            </Button>
          </>
        )}
        minWidth={1746}
        empty={
          // The empty state speaks for the TAB, not the whole list. "Nothing
          // matches that" on an untouched Increment tab reads as a broken
          // search when the truth is that none exist yet.
          <EmptyState
            icon={<CalendarPlus className="size-6" aria-hidden />}
            title={
              counts[kind === "EVALUATION" ? "evaluation" : "increment"] === 0
                ? kind === "EVALUATION"
                  ? "No evaluation cycles yet"
                  : "No increment cycles yet"
                : "Nothing matches that"
            }
            body={
              counts[kind === "EVALUATION" ? "evaluation" : "increment"] === 0
                ? kind === "EVALUATION"
                  ? "Create one to open self-evaluations for your team."
                  : "An increment cycle runs the same form and then carries on into salary."
                : "Try a different name or period."
            }
            action={
              counts[kind === "EVALUATION" ? "evaluation" : "increment"] === 0 ? (
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
function Count({ value, of, title }: { value: number; of: number; title?: string }) {
  return (
    <span className="tabular text-body-sm" title={title}>
      <span className={value > 0 ? "text-ink" : "text-ink-muted"}>{value}</span>
      <span className="text-ink-muted">/{of}</span>
    </span>
  );
}

/**
 * Have the links gone out?
 *
 * Three states, and the middle one is why this is not a tick: a cycle where
 * some people have been sent a link and some have not is the state HR most
 * needs to notice, and it is the one a boolean cannot express. The count is
 * always shown once anything has been sent.
 */
/**
 * A named list with a done/not-done state per row.
 *
 * ONE COMPONENT FOR BOTH SIDES, so the employees and the managers cannot drift
 * apart in how "done" reads — which they would, being two lists built from two
 * different facts.
 *
 * NEVER COLOUR ALONE (§13.8). Each row carries a tick or a dash AND a word, so
 * the state survives a monochrome screen and reaches a screen reader. The tick
 * is `success` because it means finished, which is the one thing green means in
 * this product (UI2-2) — it is not a tier and does not claim to say who rated.
 */
function PeopleList({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: Array<{ key: string; name: string; designation: string | null; done: boolean; note: string }>;
  empty: string;
}) {
  return (
    <div className="min-w-0">
      <p className="type-label text-ink-muted">
        {title}
        {rows.length > 0 ? <span className="tabular ml-1.5">{rows.length}</span> : null}
      </p>
      {rows.length === 0 ? (
        <p className="mt-2 font-sans text-body-sm text-ink-muted">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {rows.map((r) => (
            <li key={r.key} className="flex items-start gap-2">
              {r.done ? (
                <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-success" />
              ) : (
                <span aria-hidden className="mt-0.5 w-3.5 shrink-0 text-center text-ink-muted">
                  –
                </span>
              )}
              {/* -- NAME AND DESIGNATION, stacked. A row used to be a name
                    alone, and a cycle with two "Priya Sharma" or an unresolved
                    second reviewer had nothing to tell them apart by. The
                    designation is what a person actually goes by on a roster —
                    absent for nobody who has one, and simply not shown for
                    somebody whose record has none rather than printing an
                    em dash into a crowded row. -- */}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-sans text-body-sm text-ink">{r.name}</span>
                {r.designation ? (
                  <span className="block truncate font-sans text-body-xs text-ink-muted">
                    {r.designation}
                  </span>
                ) : null}
              </span>
              <span
                className={cn(
                  "tabular shrink-0 font-sans text-body-sm",
                  r.done ? "text-ink-muted" : "text-ink",
                )}
              >
                {r.note}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LinksCell({ sent, of }: { sent: number; of: number }) {
  if (of === 0) return <span className="text-body-sm text-ink-muted">—</span>;

  if (sent === 0) {
    return <span className="text-body-sm text-ink-muted">Not sent</span>;
  }

  const all = sent >= of;
  return (
    <span
      title={
        all
          ? `A link has been sent to all ${of} ${of === 1 ? "person" : "people"}.`
          : `${of - sent} of ${of} have not been sent a link yet.`
      }
      className={cn(
        "tabular inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5 text-body-sm font-medium",
        /* -- Green means "done" here, not a tier — UI2-2 keeps it out of
              §13.1's reserved three for exactly this kind of use, and the words
              carry it too. THE CLASS SAID INDIGO while this comment said green:
              `final-tint` is the MD's layer, and "all links sent" is not a
              layer at all. The comment was right and the code was not. -- */
        all ? "bg-success-tint text-ink" : "bg-warning-tint text-ink",
      )}
    >
      {all ? <Check className="size-3.5" aria-hidden /> : <Send className="size-3.5" aria-hidden />}
      {all ? "Sent" : `${sent}/${of}`}
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
            <p className="text-body-sm text-ink-muted">
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
