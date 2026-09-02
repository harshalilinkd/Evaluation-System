"use client";

/** The round board. Every row says what is outstanding and who is holding it. */

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";

import {
  AddWorkersDialog,
  BinRoundDialog,
  StartRoundDialog,
  type RaterRow,
  type WorkerRow,
} from "@/app/(app)/admin/worker-appraisals/cycles-client";
import { DataGrid, GridCell } from "@/components/appraise/data-grid";
import { KpiCard, KpiRow } from "@/components/appraise/screen";
import { EmptyState } from "@/components/appraise/states";
import { Button } from "@/components/ui/button";
import { formatDate, formatInr } from "@/lib/utils/date";

/* §17 keeps the source form's wording; these are the three cells it prints. */
const OVERALL_WORD: Record<string, string> = {
  EXCELLENT: "Excellent",
  SATISFACTORY: "Satisfactory",
  NEEDS_IMPROVEMENT: "Needs improvement",
};
import { cn } from "@/lib/utils";
import type { ColumnDef } from "@tanstack/react-table";

export type BoardRow = {
  id: string;
  /** The profile, so the board can tell who is NOT yet in this round. */
  workerId: string;
  workerName: string;
  supervisorName: string;
  selfIn: boolean;
  supervisorIn: boolean;
  selfSubmittedAt: string | null;
  supervisorSubmittedAt: string | null;
  handedOver: boolean;
  /** 0100: the supervisor reviewing the ratings, where one is assigned. */
  reviewerName: string | null;
  status: string;
  overallTick: string | null;
  department: string | null;
  trainingRequired: boolean | null;
  /* -- §5 data, on a screen guarded to HR and the MD. Null where nobody has
        recorded it, never 0 — a salary of zero is a different claim from one
        that has not been entered (P7-9). -- */
  salaryChanged: boolean | null;
  newCtc: number | null;
  incrementPct: number | null;
  currentCtc: number | null;
  lastIncrementDate: string | null;
  /* -- ITS OWN ROUND, on the row.
        Every appraisal is a row of its own now, so the round is a column rather
        than a count of "earlier" ones hanging off the worker's name. That count
        was a workaround for a table that could only show one round at a time;
        with all of them listed it would restate what the reader can already
        see. -- */
  cycleId: string;
  roundName: string;
  roundPeriod: string;
  nextIncrementDate: string | null;
};

/**
 * WHAT HAPPENS NEXT, per row.
 *
 * The board said "Not yet / Not yet / Open" and stopped, which is a statement
 * of fact with no verb in it — reported, fairly, as "I did not see any next
 * step". A round is chased person by person, so the instruction belongs on the
 * person's row rather than in a paragraph above the table.
 *
 * It names WHO is holding it, because that is the actionable half: HR cannot
 * fill either sheet, so every outstanding row resolves to somebody to ring.
 */
function nextStep(row: BoardRow): { text: string; tone: "wait" | "ready" | "done" } {
  if (row.status === "REVIEWED" || row.status === "CLOSED") {
    return { text: "Finished", tone: "done" };
  }
  /* -- 0100: rated, and now with the supervisor. Named, because that is the
        actionable half — HR cannot record the comment, the training tick or
        the recommended percentage, so an outstanding row here resolves to
        somebody to ring, exactly as an unrated one does. -- */
  if (row.status === "PENDING_SUPERVISOR") {
    return {
      text: `Rated — with ${row.reviewerName ?? "their supervisor"} to review`,
      tone: "wait",
    };
  }
  if (row.supervisorIn) {
    return { text: "Filled in — ready for your review", tone: "ready" };
  }
  return { text: `Waiting on ${row.supervisorName} to fill it in`, tone: "wait" };
}

export function WorkerBoard({
  cycle,
  rows,
  workers,
  raters,
  lastReviewerId,
  adminIds,
  startDue,
  startWorkerId,
  mdView = false,
}: {
  /* -- ABSENT MEANS EVERY ROUND, and that is now the ordinary case.
        The rounds LIST is gone at the owner's instruction: Production
        Appraisals opens straight onto the table, and every appraisal in every
        round is a row of its own with the round named in a column. Nothing is
        hidden behind a card somebody has to pick first.
        Present means one round, which is what the per-round URL still
        renders — the evaluation detail lives under it, and a link somebody
        bookmarked should not stop working. -- */
  /* -- TWO VOCABULARIES FOR ONE ROW OF CARDS, which is P7-6's rule applied to
        a queue instead of a status chip.

        The stages were written from HR's chair: "Ready for you" is the sheet a
        supervisor has submitted and HR has not yet reviewed. On the MD's screen
        that is a sheet sitting with HR — nothing to do with them — while the
        one actually waiting on them is filed under "With management", their own
        name in the third person.

        So the MD reading their own queue was told the wrong thing twice over.
        The counts, the filters and the rows are identical; only the two labels
        that name an AUDIENCE change. -- */
  mdView?: boolean;
  cycle: {
    id: string;
    name: string;
    period_label: string;
    status: string;
    supervisor_due_on: string | null;
  } | null;
  rows: BoardRow[];
  workers: WorkerRow[];
  raters: RaterRow[];
  /** Whoever reviewed the last round — the launch dialog's default (0100). */
  lastReviewerId?: string | null;
  /** Everybody holding HR_ADMIN or MD, so the launch dialog can flag them. */
  adminIds?: readonly string[];
  /**
   * `?start=due` from the increment calendar's "Start for Production team".
   * Resolved on the server so the client never has to parse a query string, and
   * so a stray value cannot open a dialog in a state nobody chose.
   */
  startDue?: boolean;
  /** One worker, from "Start increment" on a single calendar row. */
  startWorkerId?: string;
}) {
  const allRounds = cycle === null;
  /* -- Opens on arrival when the calendar sent us. The dialog is gated on
        `open`, so it MOUNTS with the flag set and reads it in its own state
        initialisers — no effect copying props into state, and nothing to keep
        in step once HR starts ticking (F4-5's reasoning, one layer up). -- */
  const [starting, setStarting] = React.useState(Boolean(startDue || startWorkerId));
  const [adding, setAdding] = React.useState(false);
  /* -- Binning moved here with the rounds list, because deleting that list
        would otherwise have removed the only way to bin a round: Settings ›
        Recycle bin lists what is already binned and restores it, and nothing
        there puts a round in. This is the better home anyway — you are looking
        at the round you are binning. -- */
  const [binning, setBinning] = React.useState(false);

  /* -- Who is NOT yet in this round. A latecomer, or somebody HR missed when
        the round opened — until now there was no way to appraise either of them
        in it, because the launch refuses a cycle that is already running. -- */
  const inRound = new Set(rows.map((r) => r.workerId));
  const available = workers.filter((w) => !inRound.has(w.id));

  /* Ready means the supervisor has submitted AND nobody has reviewed it — the
     only state on this screen HR can act on. Counting reviewed ones too meant
     the number never fell as they worked through them. */
  const inProgress = rows.filter((r) => r.status === "OPEN").length;
  // 0100: rated by the team leader, now with the supervisor. Not HR's yet.
  const withSupervisor = rows.filter((r) => r.status === "PENDING_SUPERVISOR").length;
  const readyCount = rows.filter((r) => r.status === "PENDING_REVIEW").length;
  const withMd = rows.filter((r) => r.status === "REVIEWED").length;
  const closedCount = rows.filter((r) => r.status === "CLOSED").length;

  /* -- The tiles are the filter, because a count above a list it describes
        invites a press and there was nothing behind it.

        THERE IS AN "ALL" TILE NOW, at the owner's instruction, and this comment
        used to argue against one — that the active tile toggling off was one
        control rather than four. That is still true and is still how the stage
        tiles behave; what it missed is that toggling off is invisible. The
        escape was a "Show all" link nobody reads until they need it, and a tile
        is the same control where the eye already is. The row now reads as a
        total and its parts, and exactly one card is lit at any moment. -- */
  const [filter, setFilter] = React.useState<
    "all" | "waiting" | "supervisor" | "ready" | "md" | "closed"
  >("all");

  const visible = React.useMemo(() => {
    /* Keyed on the STATUS, not on the timestamps. The status is the one thing
       that distinguishes "waiting for HR" from "with the MD" — both have the
       supervisor's side in, so a timestamp cannot tell them apart. */
    if (filter === "waiting") return rows.filter((r) => r.status === "OPEN");
    if (filter === "supervisor") return rows.filter((r) => r.status === "PENDING_SUPERVISOR");
    if (filter === "ready") return rows.filter((r) => r.status === "PENDING_REVIEW");
    if (filter === "md") return rows.filter((r) => r.status === "REVIEWED");
    if (filter === "closed") return rows.filter((r) => r.status === "CLOSED");
    return rows;
  }, [rows, filter]);

  const toggle = (next: "waiting" | "supervisor" | "ready" | "md" | "closed") =>
    setFilter((current) => (current === next ? "all" : next));

  /* ---------- Columns ----------
     Defined once and memoised, because `DataGrid` keys its stored widths on
     column identity — a fresh array each render re-registers every column and
     the remembered widths are lost on the next keystroke anywhere on the page. */
  const columns = React.useMemo<ColumnDef<BoardRow>[]>(
    () => [
      {
        accessorKey: "workerName",
        header: "Worker",
        size: 200,
        /* -- THE EARLIER APPRAISALS, NAMED ON THE ROW.
              This is the answer to "a new entry overwrites the first": it does
              not, and here is the count to prove it. A worker may be in as many
              rounds as there are rounds — one appraisal per round, which is what
              `unique (cycle_id, worker_id)` says — but until now the only place
              that was visible was a round the board could not reach.

              Linked to their scorecard rather than restated here: the history
              belongs to the person, and duplicating it on every board is a
              second place for it to drift (N1-13's reasoning). -- */
        cell: ({ row }) => <GridCell value={row.original.workerName} />,
      },
      /* -- THE ROUND, first after the worker.
            One row per appraisal, so the round is what tells two of the same
            person's rows apart — and it is the column the owner asked for in
            place of "1 earlier appraisal" hanging off a name. Only in the
            all-rounds table: on a single round every row would repeat it. -- */
      ...(allRounds
        ? [
            {
              id: "round",
              header: "Round",
              size: 190,
              cell: ({ row }: { row: { original: BoardRow } }) => (
                /* Linked, because the round is where round-level actions live —
                   adding a latecomer, and binning it. */
                <Link
                  href={`/admin/worker-appraisals/${row.original.cycleId}`}
                  className="block truncate px-3 py-2 text-body-sm text-ink underline-offset-2 hover:underline"
                >
                  {[row.original.roundName, row.original.roundPeriod]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </Link>
              ),
            } as ColumnDef<BoardRow>,
          ]
        : []),
      {
        accessorKey: "supervisorName",
        header: "Supervisor",
        size: 190,
        cell: ({ row }) => <GridCell value={row.original.supervisorName} />,
      },
      {
        id: "supervisor",
        header: "Filled in",
        size: 180,
        cell: ({ row }) => (
          <GridCell
            value={
              row.original.supervisorSubmittedAt
                ? formatDate(row.original.supervisorSubmittedAt)
                : "Not yet"
            }
          />
        ),
      },
      {
        id: "department",
        header: "Department",
        size: 150,
        cell: ({ row }) => <GridCell value={row.original.department ?? "—"} />,
      },
      {
        id: "overall",
        header: "Overall",
        size: 150,
        cell: ({ row }) => (
          <GridCell
            value={
              row.original.overallTick
                ? (OVERALL_WORD[row.original.overallTick] ?? row.original.overallTick)
                : "—"
            }
          />
        ),
      },
      {
        id: "training",
        header: "Training",
        size: 110,
        cell: ({ row }) => (
          <GridCell
            value={
              row.original.trainingRequired === null
                ? "—"
                : row.original.trainingRequired
                  ? "Yes"
                  : "No"
            }
          />
        ),
      },
      {
        /* -- Pay, in one column rather than four.
              Old, new, percent and "same or new" as separate columns would be
              four headings for one decision, three of them blank on every
              appraisal that changes nothing — which is most of them. One column
              that says either "No change" or "+15% to ₹2,40,000" carries the
              whole answer and stays readable at a glance. -- */
        id: "salary",
        header: "Salary",
        size: 190,
        cell: ({ row }) => {
          const r = row.original;
          if (r.salaryChanged === null) return <GridCell value="—" />;
          if (!r.salaryChanged) return <GridCell value="No change" />;
          const pct = r.incrementPct === null ? null : `+${r.incrementPct}%`;
          const to = r.newCtc === null ? null : formatInr(r.newCtc);
          return <GridCell value={[pct, to].filter(Boolean).join(" to ") || "New salary"} />;
        },
      },
      {
        id: "lastIncrement",
        header: "Last increment",
        size: 150,
        cell: ({ row }) => (
          <GridCell
            value={
              row.original.lastIncrementDate ? formatDate(row.original.lastIncrementDate) : "—"
            }
          />
        ),
      },
      {
        /* -- The way in to the review.
              The row-detail dialog answers "what is on this row"; it cannot
              answer "and now let me approve it", because approving is a
              different screen with the ticks, the comment and the salary on it.
              A board that says "ready for your review" and offers nothing to
              press is the gap this closes. -- */
        id: "open",
        header: "",
        size: 110,
        cell: ({ row }) =>
          row.original.supervisorIn ? (
            <Link
              href={`/admin/worker-appraisals/${row.original.cycleId}/${row.original.id}`}
              className="font-sans text-body-sm font-medium text-primary underline underline-offset-2"
            >
              {row.original.status === "REVIEWED" || row.original.status === "CLOSED"
                ? "View"
                : "Review"}
            </Link>
          ) : null,
      },
      {
        id: "next",
        header: "What happens next",
        size: 340,
        cell: ({ row }) => {
          const step = nextStep(row.original);
          return (
            <span
              className={cn(
                "truncate font-sans text-body-sm",
                step.tone === "ready"
                  ? "font-medium text-primary"
                  : step.tone === "done"
                    ? "text-ink-muted"
                    : "text-ink",
              )}
            >
              {step.text}
            </span>
          );
        },
      },
    ],
    [allRounds],
  );

  return (
    /* -- The same shell as Evaluation cycles: full-bleed, pinned to the
          viewport, a fixed header bar, the counts, then the grid filling what
          is left. `data-full-bleed` drops the shell's 1180px cap — a roster is a
          grid, and a grid centred in 1180px wastes half a wide monitor
          (UI2-9). -- */
    <div
      data-full-bleed
      className="flex h-[calc(100dvh-theme(spacing.topbar))] min-h-[26rem] flex-col overflow-hidden bg-surface"
    >
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-4 border-b border-rule px-4 py-3 lg:px-6">
        <div className="min-w-0">
          {/* -- `text-h2` was here and is not a class this project defines, so
                Tailwind emitted nothing and preflight rendered the page title at
                plain body size. `display-sm` is the step the type scale actually
                ships, and the one the cycles screen uses. -- */}
          {/* -- A BACK LINK, on the per-round view only.
                It was the landing screen, so there was nowhere to go back TO.
                Production Appraisals now opens the full table, and a screen you
                arrive at from a list needs the way out (§13.4). -- */}
          {allRounds ? null : (
            <Link
              href="/admin/worker-appraisals"
              className="inline-flex items-center gap-1.5 text-body-sm text-ink-muted"
            >
              <ArrowLeft className="size-4" aria-hidden />
              All production appraisals
            </Link>
          )}
          {/* -- `text-h2` was here and is not a class this project defines, so
                Tailwind emitted nothing and preflight rendered the page title at
                plain body size. `display-sm` is the step the type scale actually
                ships, and the one the cycles screen uses. -- */}
          <h1 className="text-display-sm font-semibold text-ink">
            {allRounds ? "Production appraisals" : "Worker appraisals"}
          </h1>
          <p className="mt-0.5 text-body-sm text-ink-muted">
            {allRounds
              ? `Every round, every worker — ${rows.length} appraisal${rows.length === 1 ? "" : "s"} in all.`
              : `${cycle.name} · ${cycle.period_label} · supervisor due ${formatDate(cycle.supervisor_due_on)}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* -- THE ROUND PICKER IS GONE, at the owner's instruction.
                It listed every round in a select — five entries here, three of
                them reading "Floor · Aug" because rounds are free to share a
                name — so it offered a choice nobody could tell apart, to switch
                to a screen reachable from the list one click away.

                Worker Appraisals in the sidebar IS that list, and it shows each
                round with its status and dates. One way to change round, on the
                screen built for it. -- */}
          {/* Only while the round is open to changes, and only when there is
              somebody to add — a control that can do nothing is a dead end. */}
          {!allRounds && cycle.status === "ACTIVE" && available.length > 0 ? (
            <Button variant="secondary" onClick={() => setAdding(true)} className="min-h-11">
              <Plus className="size-4" aria-hidden />
              Add workers
            </Button>
          ) : null}

          {allRounds ? null : (
            <Button variant="ghost" onClick={() => setBinning(true)} className="min-h-11">
              <Trash2 className="size-4" aria-hidden />
              Move round to bin
            </Button>
          )}

          <Button onClick={() => setStarting(true)} className="min-h-11">
            <Plus className="size-4" aria-hidden />
            Start a round
          </Button>
        </div>
      </div>

      <div className="shrink-0 space-y-3 border-b border-rule px-4 py-3 lg:px-6">
        {/* -- THE STAGES, in the order an appraisal passes through them.
              They were "In this round / Ready for you / With their supervisor",
              which mixed a TOTAL with two of its own parts — the numbers summed
              to each other, so the first was arithmetic on the other two and
              read as a third finding.

              These are three points on one journey instead, which is what
              somebody scanning the screen is actually trying to place a row in.

              WITH MANAGEMENT appears only when it has something to report. Most
              rounds never use Send to MD, and a permanent zero is a column
              teaching people to ignore it — but leaving the state out entirely
              would let rows vanish from every count, which is worse than a
              fourth card. -- */}
        <KpiRow>
          {/* -- ALL, at the owner's instruction, and it is the way back.

                The row was three stages with no total, and the escape from a
                filtered board was a "Show all" link under it — discoverable
                only by somebody who had already read it. A tile is the same
                control in the place the eye already is, and it makes the row
                read as a total and its parts rather than three stages that
                happen to sit together.

                It is `active` when nothing is filtered, so the row always has
                exactly one card lit and there is never a state where the reader
                cannot tell what they are looking at. -- */}
          <KpiCard
            label="All"
            value={rows.length}
            caption="every appraisal in view"
            tone="plain"
            onSelect={() => setFilter("all")}
            active={filter === "all"}
          />
          <KpiCard
            label="In progress"
            value={inProgress}
            caption="with their supervisor"
            tone="plain"
            onSelect={() => toggle("waiting")}
            active={filter === "waiting"}
          />
          {/* -- 0100. Hidden at zero for the same reason "With management" is:
                 a round where nobody has a supervisor assigned never reaches
                 this stage, and a permanent zero teaches people to stop reading
                 the row. -- */}
          {withSupervisor > 0 ? (
            <KpiCard
              label="With supervisor"
              value={withSupervisor}
              caption="rated, waiting on their review"
              tone="plain"
              onSelect={() => toggle("supervisor")}
              active={filter === "supervisor"}
            />
          ) : null}
          <KpiCard
            label={mdView ? "Under HR review" : "Ready for you"}
            value={readyCount}
            caption={mdView ? "with HR, not yet sent up" : "filled in, not yet reviewed"}
            tone="final"
            onSelect={() => toggle("ready")}
            active={filter === "ready"}
          />
          {/* -- Hidden at zero for HR, because most rounds never use Send to
                 MD and a permanent zero teaches people to ignore a column.
                 ALWAYS shown to the MD: it is THEIR queue, and "nothing needs
                 you" is the answer they came for. An absent card is not that
                 answer — it is no answer at all. -- */}
          {withMd > 0 || mdView ? (
            <KpiCard
              label={mdView ? "Ready for you" : "With management"}
              value={withMd}
              caption={mdView ? "sent up for you to sign off" : "sent to the MD to sign off"}
              tone="lead"
              onSelect={() => toggle("md")}
              active={filter === "md"}
            />
          ) : null}
          <KpiCard
            label="Closed"
            value={closedCount}
            caption="finished"
            tone="plain"
            onSelect={() => toggle("closed")}
            active={filter === "closed"}
          />
        </KpiRow>

        {/* -- A way back, said out loud.
              Pressing the active card again clears it, and nobody knows that.
              The "In this round" card used to be the way out; now that the
              cards are stages rather than a total plus its parts, the escape
              has to be its own thing or a filtered board is a dead end
              (§13.4). -- */}
        {/* The COUNT stays; the "Show all" button does not. The All card above
            is that control now, and two controls doing one job is how they end
            up looking and behaving differently. */}
        {filter !== "all" ? (
          <p className="font-sans text-body-sm text-ink-muted">
            Showing {visible.length} of {rows.length}. Press{" "}
            <span className="font-medium text-ink">All</span> to clear.
          </p>
        ) : null}

        {/* -- Said once, above the grid, because it is the answer to "so what do
              I do now" for the whole round rather than for one row. HR fills
              neither sheet, and a screen that does not say so leaves somebody
              looking for a button that should not exist. -- */}
        <p className="font-sans text-body-sm text-ink-muted">
          You do not fill the sheet. Each supervisor completes it from{" "}
          <span className="font-medium text-ink">Production Team</span> in their own menu, and it reaches
          you when they submit. The worker fills nothing.
        </p>
      </div>

      <DataGrid
        data={visible}
        columns={columns}
        storageKey="appraise.worker-board.column-widths"
        rowNoun="worker"
        rowTitle={(r) => r.workerName}
        minWidth={1100}
        empty={
          <EmptyState
            title={filter === "all" ? "Nobody is in this round" : "Nothing matches"}
            body={
              filter === "all"
                ? "Start a round and choose who is in it."
                : "Press the same tile again to show everybody."
            }
          />
        }
      />

      <AddWorkersDialog
        open={adding}
        onOpenChange={setAdding}
        cycleId={cycle?.id ?? ""}
        available={available}
        raters={raters}
      />

      <BinRoundDialog cycle={binning && cycle ? cycle : null} onClose={() => setBinning(false)} />

      <StartRoundDialog
        open={starting}
        onOpenChange={setStarting}
        workers={workers}
        raters={raters}
        lastReviewerId={lastReviewerId}
        adminIds={adminIds}
        preselect={startDue ? "increment-due" : startWorkerId ? "these-people" : undefined}
        preselectIds={startWorkerId ? [startWorkerId] : undefined}
      />
    </div>
  );
}
