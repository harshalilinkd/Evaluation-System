"use client";

/** The status board. P10 screen 3 — five columns, filters, per-row actions. */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, CalendarClock, Check, MoreHorizontal, Printer, Search, Send } from "lucide-react";

import { SegmentedLegend, SegmentedProgress } from "@/components/appraise/segmented-bar";
import { StatusChip } from "@/components/appraise/status-chip";
import { CycleTypeChip } from "@/components/appraise/cycle-type-chip";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { archiveCycle } from "@/lib/cycles/actions";
import { BackLink } from "@/components/appraise/back-link";
import { ActivityPanel } from "@/app/(app)/admin/cycles/[id]/activity-panel";
import { DataGrid, GridCell } from "@/components/appraise/data-grid";
import type { ActivityEntry } from "@/lib/cycles/activity";
import { EmptyState } from "@/components/appraise/states";
import type { BoardColumnKey, CycleBoard } from "@/lib/cycles/queries";
import { daysBetween, plural, today } from "@/lib/cycles/schema";
import { SECTION_LABELS } from "@/lib/forms/labels";
import type { SelectablePerson } from "@/lib/cycles/queries";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils/date";
import { ExtendDatesDialog, ReassignDialog, WithdrawDialog } from "@/app/(app)/admin/cycles/[id]/board-dialogs";

/**
 * Item 17. The v3 statuses.
 *
 * The old columns were "Self submitted" then "Lead reviewed" — a sequence that
 * no longer exists: both sides run at once, and which of them has come in is a
 * property of the row, not of the column (item 18).
 *
 * Interview is INCREMENT-only (§8), so it is dropped from an evaluation cycle
 * rather than standing empty and implying a step that will never happen.
 */
type BoardCard = CycleBoard["cards"][number];

/** Toolbar selects: 36px, label inside the control, no stacked <Label> above. */
const FILTER_CLASS =
  "h-9 rounded-control border border-rule bg-surface px-2.5 text-body-sm text-ink";

const ALL_COLUMNS: ReadonlyArray<{ key: BoardColumnKey; label: string; accent: string }> = [
  { key: "open", label: "Open", accent: "bg-ink-faint" },
  { key: "hr_review", label: "Waiting for your review", accent: "bg-self" },
  { key: "with_md", label: "With MD", accent: "bg-lead" },
  { key: "interview", label: "Interview", accent: "bg-final" },
  { key: "closed", label: "Closed", accent: "bg-ink" },
];

export function BoardClient({
  board,
  candidates,
  justLaunched,
  activity,
}: {
  board: CycleBoard;
  candidates: SelectablePerson[];
  justLaunched: boolean;
  /** §12's trail, made readable. See lib/cycles/activity.ts. */
  activity: ActivityEntry[];
}) {
  const router = useRouter();

  const [search, setSearch] = React.useState("");
  const [department, setDepartment] = React.useState("all");
  const [lead, setLead] = React.useState("all");
  const [overdueOnly, setOverdueOnly] = React.useState(false);

  const [reassign, setReassign] = React.useState<{ id: string; name: string } | null>(null);
  const [withdraw, setWithdraw] = React.useState<{ id: string; name: string } | null>(null);
  const [extend, setExtend] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const visible = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return board.cards.filter((card) => {
      if (department !== "all" && card.departmentId !== department) return false;
      if (lead !== "all" && card.leadId !== lead) return false;
      if (overdueOnly && card.daysLate === 0) return false;
      if (needle && !card.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [board.cards, search, department, lead, overdueOnly]);

  /* -- The lanes, as a filter rather than as five containers. --
        Clicking one narrows the table; clicking it again clears. The counts are
        what the kanban columns were genuinely good for, so they survive; the
        cramped 180px cards they held do not. */
  const [laneFilter, setLaneFilter] = React.useState<BoardColumnKey | null>(null);

  const lanes = React.useMemo(
    () =>
      ALL_COLUMNS.filter(
        (c) => c.key !== "interview" || board.cycle.cycleType === "INCREMENT",
      ).map((c) => ({ ...c, count: visible.filter((card) => card.column === c.key).length })),
    [visible, board.cycle.cycleType],
  );

  const laneFiltered = React.useMemo(
    () => (laneFilter ? visible.filter((c) => c.column === laneFilter) : visible),
    [visible, laneFilter],
  );

  const laneLabel = React.useCallback(
    (key: BoardColumnKey) => ALL_COLUMNS.find((c) => c.key === key)?.label ?? key,
    [],
  );

  const boardColumns = React.useMemo<ColumnDef<BoardCard>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Person",
        size: 190,
        meta: { frozen: true },
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-2.5">
            {/* Rose marks overdue, and the "late" column carries the same fact
                in words — colour is never the only signal (§13.8). */}
            <span
              aria-hidden
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-pill text-[11px] font-medium",
                row.original.daysLate > 0
                  ? "bg-critical text-ink-invert"
                  : "bg-accent text-primary",
              )}
            >
              {row.original.initials}
            </span>
            <span title={row.original.name} className="truncate text-body-sm font-medium text-ink">
              {row.original.name}
            </span>
          </span>
        ),
      },
      {
        accessorKey: "departmentName",
        header: "Department",
        size: 130,
        cell: ({ row }) => <GridCell value={row.original.departmentName ?? "—"} />,
      },
      {
        accessorKey: "leadName",
        header: "HOD",
        size: 140,
        cell: ({ row }) => <GridCell value={row.original.leadName ?? "Unassigned"} />,
      },
      {
        id: "stage",
        header: "Stage",
        size: 150,
        cell: ({ row }) => <GridCell value={laneLabel(row.original.column)} />,
      },
      /* Item 18: the two sides, independently. HR is the one role entitled to
         see both (§9), and this is the screen where HR chases people — so the
         pair is shown here and nowhere a rater can reach. */
      {
        id: "employee_side",
        header: "Employee",
        size: 104,
        meta: { align: "center" },
        // No label inside the chip: the COLUMN is the label. Repeating it made
        // every cell read "Employee: not yet" and wrap onto two lines.
        cell: ({ row }) => (
          <SideState done={row.original.selfSubmitted} skipped={row.original.selfSkipped} />
        ),
      },
      {
        id: "hod_side",
        header: "HOD",
        size: 104,
        meta: { align: "center" },
        cell: ({ row }) => (
          <SideState done={row.original.leadSubmitted} skipped={row.original.leadSkipped} />
        ),
      },
      {
        accessorKey: "daysInState",
        // "Days here" truncated to "DAYS HE…" at this width. A header that has
        // to be clipped is a header that is too long for its column.
        header: "Days",
        size: 76,
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="tabular text-body-sm text-ink">{row.original.daysInState}</span>
        ),
      },
      {
        accessorKey: "daysLate",
        header: "Late",
        size: 82,
        meta: { align: "right" },
        cell: ({ row }) =>
          row.original.daysLate > 0 ? (
            <span className="tabular rounded-pill bg-critical-tint px-2 py-0.5 text-body-sm font-medium text-critical">
              {plural(row.original.daysLate, "day")}
            </span>
          ) : (
            <span className="tabular text-body-sm text-ink-muted">—</span>
          ),
      },
      {
        id: "actions",
        header: "",
        size: 64,
        enableResizing: false,
        meta: { align: "center" },
        cell: ({ row }) => (
          <RowMenu
            cycleId={board.cycle.id}
            card={{
              id: row.original.evaluationId,
              name: row.original.name,
              status: row.original.status,
            }}
            onReassign={() =>
              setReassign({ id: row.original.evaluationId, name: row.original.name })
            }
            onWithdraw={() =>
              setWithdraw({ id: row.original.evaluationId, name: row.original.name })
            }
          />
        ),
      },
    ],
    [board.cycle.id, laneLabel],
  );

  const percent =
    board.totals.participants === 0
      ? 0
      : Math.round(
          // Each evaluation is worth three steps: self, lead, MD. Completion is
          // how many of those 3n steps are done — a bar that only moved when
          // somebody finished entirely would sit at zero for most of the cycle.
          ((board.totals.self + board.totals.lead + board.totals.final) /
            (board.totals.participants * 3)) *
            100,
        );

  const countdown = board.cycle.selfDueOn ? daysBetween(today(), board.cycle.selfDueOn) : null;

  const onArchive = async () => {
    setBusy(true);
    const result = await archiveCycle(board.cycle.id);
    setBusy(false);
    if (result.ok) router.refresh();
  };

  return (
    // Full bleed: ten columns do not fit inside the shell's 1180px cap, and a
    // table you have to scroll sideways to read is a table you cannot compare
    // rows in. The gutters come back as padding here so the content still
    // breathes at the edges.
    <div data-full-bleed className="space-y-5 px-4 py-6 lg:px-6">
      {justLaunched ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-card bg-success-tint px-4 py-3 text-body text-ink"
        >
          <Check aria-hidden className="size-4 text-success" />
          Launched. {plural(board.totals.participants, "evaluation")} created and every question set
          frozen. Send the links when you are ready.
        </p>
      ) : null}

      {/* ---------- Header ----------
          ONE BAND, NOT FOUR STACKED ROWS.

          This was a back link, then a title row, then the period, then a
          definition list of three due dates, then a full-width black hero for
          one percentage — five blocks and roughly 400px of chrome before a
          single person appeared. Identity, dates and completion are all facts
          ABOUT the cycle, so they share one strip and the table starts near the
          top of the screen where it belongs. */}
      <header className="space-y-3">
        {/* The back link, the identity and the actions on ONE line. They were
            two rows for four short things — a link, a name, a chip and a
            period, none of which needs a row of its own. */}
        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <BackLink href="/admin/cycles" label="All cycles" />
            <span aria-hidden className="h-5 w-px bg-rule" />
            <h1 className="text-display-sm font-semibold text-ink">{board.cycle.name}</h1>
            {/* Beside the name, because this is the screen somebody is on when
                they press Launch or Send links — and an increment cycle ends
                somewhere entirely different from an evaluation one (§1). */}
            <CycleTypeChip type={board.cycle.cycleType} />
            <StatusChip
              status={board.cycle.status === "ACTIVE" ? "CYCLE_ACTIVE" : board.cycle.status}
            />
            <span className="text-body-sm text-ink-muted">{board.cycle.periodLabel}</span>
          </div>

          <div className="flex flex-wrap gap-2">
            {/* Wired in P11. Disabled only while the cycle is DRAFT: there is no
                form behind a link until launch. */}
            <Button asChild variant="outline" size="sm" className="min-h-9" disabled={board.cycle.status === "DRAFT"}>
              <Link href={`/admin/cycles/${board.cycle.id}/distribute`}>
                <Send className="size-4" aria-hidden />
                Send links
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="min-h-9">
              <Link href={`/print/cycle/${board.cycle.id}`} target="_blank" rel="noopener">
                <Printer className="size-4" aria-hidden />
                Print pack
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="min-h-9"
              onClick={() => setExtend(true)}
              disabled={board.cycle.status === "CLOSED"}
            >
              <CalendarClock className="size-4" aria-hidden />
              Extend dates
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="min-h-9"
              onClick={() => void onArchive()}
              disabled={busy || board.cycle.status === "CLOSED"}
            >
              <Archive className="size-4" aria-hidden />
              Archive
            </Button>
          </div>
        </div>

        {/* Completion, the three tier counts and the three deadlines, on one
            line. The black hero card spent 180px saying "0%". */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-card border border-rule bg-surface px-4 py-2.5">
          <div className="flex min-w-[220px] flex-1 items-center gap-3">
            <span className="tabular shrink-0 text-display-sm font-semibold text-ink">{percent}%</span>
            <div className="min-w-[100px] flex-1">
              <SegmentedProgress
                total={board.totals.participants}
                self={board.totals.self}
                lead={board.totals.lead}
                final={board.totals.final}
              />
            </div>
            <span className="shrink-0 whitespace-nowrap text-body-sm text-ink-muted">
              {plural(board.totals.participants, "person")}
            </span>
          </div>

          <SegmentedLegend
            self={board.totals.self}
            lead={board.totals.lead}
            final={board.totals.final}
          />

          <span aria-hidden className="hidden h-6 w-px bg-rule lg:block" />

          <dl className="tabular flex flex-wrap gap-x-5 gap-y-1 text-body-sm">
            {(
              [
                ["Self", board.cycle.selfDueOn],
                ["Lead", board.cycle.leadDueOn],
                // "MD" is gone: it now always equals the lead's date, so it was
                // the same figure printed twice.
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex gap-1.5">
                <dt className="text-ink-muted">{label}</dt>
                <dd className="text-ink">{formatDate(value)}</dd>
              </div>
            ))}
            {countdown !== null ? (
              <div className="flex gap-1.5">
                <dt className="text-ink-muted">Countdown</dt>
                <dd className={cn(countdown < 0 ? "font-medium text-critical" : "text-ink")}>
                  {countdown >= 0
                    ? `${plural(countdown, "day")} left`
                    : `${plural(Math.abs(countdown), "day")} overdue`}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      </header>

      {/* ---------- The board ----------
          ONE TABLE, NOT FIVE COLUMNS, and one toolbar rather than a padded card
          of labelled dropdowns above a separate row of lane chips. Every filter
          is a 36px control on one line: labels sit inside the controls, because
          a select reading "All departments" does not also need the word
          "Department" stacked above it. */}
      <div className="overflow-hidden rounded-card border border-rule bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-rule bg-surface-mute px-3 py-2">
          <div className="relative min-w-0 flex-1 sm:w-[220px] sm:flex-none">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
            />
            <Input
              id="board-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name"
              aria-label="Search by name"
              className="h-9 min-h-9 border-rule bg-surface pl-9"
            />
          </div>

          <select
            id="board-department"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            aria-label="Filter by department"
            className={FILTER_CLASS}
          >
            <option value="all">All departments</option>
            {board.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>

          <select
            id="board-lead"
            value={lead}
            onChange={(e) => setLead(e.target.value)}
            aria-label="Filter by lead"
            className={FILTER_CLASS}
          >
            <option value="all">All leads</option>
            {board.leads.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>

          <Button
            type="button"
            variant={overdueOnly ? "default" : "outline"}
            size="sm"
            className="h-9"
            aria-pressed={overdueOnly}
            onClick={() => setOverdueOnly((v) => !v)}
          >
            Overdue only
          </Button>

          <span aria-hidden className="mx-1 hidden h-6 w-px bg-rule lg:block" />

          {/* The lane counts, as a filter. This is the one thing five columns
              genuinely told you at a glance; the cramped cards they held were
              not. Click to narrow, click again to clear. */}
          {lanes.map((lane) => (
            <button
              key={lane.key}
              type="button"
              aria-pressed={laneFilter === lane.key}
              onClick={() => setLaneFilter(laneFilter === lane.key ? null : lane.key)}
              className={cn(
                "flex h-9 items-center gap-1.5 rounded-control border px-2.5 text-body-sm transition-colors duration-hover",
                laneFilter === lane.key
                  ? "border-primary/40 bg-accent text-ink"
                  : "border-rule bg-surface text-ink-muted hover:text-ink",
              )}
            >
              <span aria-hidden className={cn("size-2 shrink-0 rounded-pill", lane.accent)} />
              <span className="whitespace-nowrap">{lane.label}</span>
              <span className="tabular font-medium text-ink">{lane.count}</span>
            </button>
          ))}
        </div>

        {/* max-h, not h: with one person the grid is one row tall, and with
            forty it scrolls. A fixed height left most of the card empty. */}
        <div className="flex max-h-[58vh] flex-col">
          <DataGrid
            data={laneFiltered}
            columns={boardColumns}
            storageKey="appraise.cycle-board.column-widths"
            rowNoun="person"
            rowTitle={(c) => c.name}
            rowActions={(c) => (
              <Button asChild className="min-h-11">
                <Link href={`/reports/${c.evaluationId}`}>Open their report</Link>
              </Button>
            )}
            // Sum of the column sizes above (~1000px). Setting it at the real
            // total means the filler absorbs everything spare and the grid only
            // scrolls on a screen genuinely narrower than its own columns.
            minWidth={1000}
            empty={
              <EmptyState
                title="Nobody here"
                body={
                  laneFilter
                    ? "No one is at that stage. Clear the filter to see everybody."
                    : "Nobody matches those filters."
                }
              />
            }
            status={
              <span className="tabular text-body-sm text-ink">
                {laneFiltered.length} of {board.cards.length}{" "}
                {board.cards.length === 1 ? "person" : "people"}
              </span>
            }
          />
        </div>
      </div>

      {/* ---------- Everything that has happened, and who did it ----------
          §12 has required an audit row for every status change since P4, and
          nothing in the product displayed one — the trail was real and only
          readable from a SQL console, which for the person accountable for a
          cycle is the same as not existing. It sits under the board because
          that is the screen somebody is on when they ask "who returned this,
          and when?". */}
      <ActivityPanel entries={activity} />

      {/* ---------- The one thing worth saying about departments ----------
          The per-department cohort cards were removed at the owner's request:
          a heading, a caption and a tile reading "Data Analyst · 5 questions ·
          1 person" took a third of the screen to restate what the table above
          already shows, on the screen HR uses to chase people.

          This warning is NOT that, and is kept. It fires only when people are
          in the cycle and NONE of them has a department — the P9-7 problem, and
          a genuine blocker: Job Specific Skills questions are chosen by
          department, so every form would launch with that section empty and
          nobody would notice until the first person opened theirs. */}
      {board.totals.participants > 0 && board.cohorts.length === 0 ? (
        <p className="flex items-start gap-3 rounded-card border-l-2 border-l-warning bg-warning-tint/40 py-3 pl-4 pr-4 text-body-sm text-ink">
          <span>
            <span className="font-medium">Nobody in this cycle has a department set.</span>{" "}
            {SECTION_LABELS.DEPARTMENT_SPECIFIC} questions are chosen by department, so as it
            stands every form here will have that section empty. Set each person&rsquo;s
            department in Settings › Users
            {board.cycle.status === "DRAFT" ? " before you launch." : "."}
          </span>
        </p>
      ) : null}

      {/* ---------- Withdrawn ---------- */}
      {board.excluded.length > 0 ? (
        <section className="card-surface p-5">
          <h2 className="text-display-sm text-ink">Withdrawn from this cycle</h2>
          <p className="text-body-sm text-ink-muted">
            Their evaluations are kept, not deleted. Nothing they answered is lost.
          </p>
          <ul className="mt-3 divide-y divide-rule">
            {board.excluded.map((row) => (
              <li key={row.evaluationId} className="flex items-baseline justify-between gap-4 py-2">
                <span className="text-body text-ink">{row.name}</span>
                <span className="text-body-sm text-ink-muted">{row.reason ?? "No reason given"}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ---------- Dialogs ---------- */}
      {/* Keyed on the target so each dialog opens genuinely fresh. Resetting
          fields in an effect instead is the cascading-render pattern the React
          compiler rejects, and a remount is the clearer statement anyway: this
          is a new form, not the old one wiped. */}
      <ReassignDialog
        key={`reassign-${reassign?.id ?? "none"}`}
        target={reassign}
        candidates={candidates}
        onClose={() => setReassign(null)}
        onDone={() => {
          setReassign(null);
          router.refresh();
        }}
      />
      <WithdrawDialog
        key={`withdraw-${withdraw?.id ?? "none"}`}
        target={withdraw}
        onClose={() => setWithdraw(null)}
        onDone={() => {
          setWithdraw(null);
          router.refresh();
        }}
      />
      <ExtendDatesDialog
        key={`extend-${extend}`}
        open={extend}
        cycle={board.cycle}
        onClose={() => setExtend(false)}
        onDone={() => {
          setExtend(false);
          router.refresh();
        }}
      />
    </div>
  );
}

/* ---------- One side's submission state ---------- */
//
// Two chips, never one combined readout: "1 of 2 submitted" tells HR a number
// when what they need is a name to chase.
/** The table cell: the state alone, because the column header is the label. */
function SideState({ done, skipped }: { done: boolean; skipped: boolean }) {
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap rounded-pill px-2 py-0.5 text-[11px] font-medium",
        skipped
          ? "bg-warning-tint text-warning"
          : done
            ? "bg-success/15 text-success"
            : "bg-surface-mute text-ink-muted",
      )}
    >
      {skipped ? "Skipped" : done ? "In" : "Not yet"}
    </span>
  );
}

/* `SideChip` — the labelled variant — went with the kanban cards. It carried
   its own label because a 180px card has no column heading to do it; a table
   does, so keeping it would be a second way to draw one fact. */

/* ---------- The per-row menu ---------- */

function RowMenu({
  card,
  cycleId,
  onReassign,
  onWithdraw,
}: {
  cycleId: string;
  card: { id: string; name: string; status: string };
  onReassign: () => void;
  onWithdraw: () => void;
}) {
  // §8 allows the lead to be changed only before the review is written. After
  // that the LEAD layer is locked and carries the reviewer's name, so swapping
  // the lead would attribute one person's words to another.
  const canReassign = card.status === "OPEN";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-11 shrink-0" aria-label={`Actions for ${card.name}`}>
          <MoreHorizontal className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem asChild>
          <Link href={`/my-evaluation/${card.id}`}>View form</Link>
        </DropdownMenuItem>

        {/* Both live on the distribution screen, which is where the send
            history and the failure states are. A second send path here would be
            a second place for a send to go unlogged. */}
        <DropdownMenuItem asChild>
          <Link href={`/admin/cycles/${cycleId}/distribute`}>Resend link</Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem disabled={!canReassign} onSelect={() => canReassign && onReassign()}>
          Reassign lead
        </DropdownMenuItem>

        {/*
          ⚠ CLAUDE.md §8 CONFLICT — see reopenEvaluation in lib/cycles/actions.ts.

          P10 lists "Reopen (HR only)". §8 gives the two return transitions to
          the lead and to the MD, and HR appears on neither row. §0 says the
          Constitution wins and to stop and ask rather than deviate, so the item
          is shown disabled with the reason rather than as a button that would
          be refused by apply_evaluation_transition anyway.
        */}
        <DropdownMenuItem disabled>Reopen — lead or MD only (§8)</DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem className="text-critical" onSelect={() => onWithdraw()}>
          Withdraw from cycle
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
