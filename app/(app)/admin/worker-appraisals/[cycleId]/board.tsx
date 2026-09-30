"use client";

/** The round board. Every row says what is outstanding and who is holding it. */

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Pencil, Plus, Send, Trash2 } from "lucide-react";

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
import { roundLabel } from "@/lib/utils/round-label";

/* §17 keeps the source form's wording; these are the three cells it prints. */
const OVERALL_WORD: Record<string, string> = {
  EXCELLENT: "Excellent",
  SATISFACTORY: "Satisfactory",
  NEEDS_IMPROVEMENT: "Needs improvement",
};
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  deleteWorkerAppraisal,
  reassignWorkerRaters,
  resendWorkerSheet,
} from "@/lib/worker/cycle-actions";
import type { ColumnDef } from "@tanstack/react-table";

export type BoardRow = {
  id: string;
  /** The profile, so the board can tell who is NOT yet in this round. */
  workerId: string;
  workerName: string;
  /* -- The TEAM LEADER: who fills the tick sheet. `supervisor_id` on the row,
        and the column is named for what the person does rather than what the
        column has been called since 0047 (0100). -- */
  supervisorId: string | null;
  supervisorName: string;
  supervisorEmail: string | null;
  selfIn: boolean;
  supervisorIn: boolean;
  selfSubmittedAt: string | null;
  supervisorSubmittedAt: string | null;
  handedOver: boolean;
  /** 0100: the supervisor reviewing the ratings, where one is assigned. */
  reviewerId: string | null;
  reviewerName: string | null;
  reviewerEmail: string | null;
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
  /* -- WHETHER THE SHEET ACTUALLY WENT. Read from `notifications_log`, never
        inferred from the round having launched: a launched round proves the
        appraisals were OPENED, which is a different fact from a message
        arriving, and treating the two as one is what let a launch that reached
        nobody report plain success. -- */
  sheet: {
    status: "SENT" | "FAILED" | null;
    at: string | null;
    error: string | null;
    attempts: number;
  };
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
function nextStep(
  row: BoardRow,
  mdView: boolean,
): { text: string; action: string | null; tone: "wait" | "ready" | "done" } {
  /* -- REVIEWED IS NOT FINISHED, and calling it that was the bug.
        In this module REVIEWED means "HR has sent it UP" — it is sitting with
        management, waiting to be signed off. The board said "Finished" in grey
        for exactly the row the MD had to act on, so the one person who could
        move it was told there was nothing to do. -- */
  if (row.status === "CLOSED") {
    return { text: "Finished", action: "View", tone: "done" };
  }

  if (row.status === "REVIEWED") {
    return mdView
      ? { text: "Waiting on you to sign off", action: "Sign off", tone: "ready" }
      : { text: "With management", action: "View", tone: "wait" };
  }

  if (row.status === "PENDING_REVIEW") {
    return mdView
      ? { text: "With HR", action: null, tone: "wait" }
      : { text: "Filled in — ready for your review", action: "Review", tone: "ready" };
  }

  /* -- 0100: rated, and now with the supervisor. Named, because that is the
        actionable half — neither HR nor the MD can record the comment, the
        training tick or the recommended percentage, so an outstanding row here
        resolves to somebody to ring. -- */
  if (row.status === "PENDING_SUPERVISOR") {
    return {
      text: `Rated — with ${row.reviewerName ?? "their supervisor"} to review`,
      action: null,
      tone: "wait",
    };
  }

  return {
    text: `Waiting on ${row.supervisorName} to fill it in`,
    action: null,
    tone: "wait",
  };
}

/**
 * A person, with the address the sheet is actually sent to underneath.
 *
 * The board named one person and called them "Supervisor", which since 0100 is
 * two different people doing two different jobs — and neither was reachable
 * from the screen without going to look them up. The email is the personal one
 * falling back to the work one, because `contacts.ts` files the production
 * rating invite as personal: printing one address and sending to another is
 * worse than printing none.
 */
/**
 * WAS THE SHEET SENT.
 *
 * Module scope, because TanStack renders a `cell` with
 * `createElement(cell, ctx)` — the function IS the component type, and one
 * built during render is a new type every render, so the subtree remounts
 * (P14-12, and the focus-loss bug that came from it).
 *
 * NEVER A COLOUR ALONE (§13.8): each state has its own word, and a failure
 * carries the provider's own text in `title` rather than a paraphrase —
 * "number not on WhatsApp" and "invalid token" need different fixes, and
 * rewording them is how somebody chases the wrong one (P23-6).
 */
function SheetCell({ row }: { row: BoardRow }) {
  const { sheet } = row;

  if (!row.supervisorName || row.supervisorName === "—") {
    return <GridCell value="—" />;
  }

  if (sheet.status === null) {
    /* -- NOT AN ERROR AND NOT A BLANK. The appraisal exists and the sheet can
          be filled in from the app whether or not a message went — so this
          says what did not happen, not that something is broken. -- */
    return (
      <span className="block min-w-0">
        <span className="block truncate text-body-sm text-warning">Not sent</span>
        <span className="block truncate text-body-sm text-ink-muted">Send it below</span>
      </span>
    );
  }

  if (sheet.status === "FAILED") {
    return (
      <span className="block min-w-0" title={sheet.error ?? undefined}>
        <span className="block truncate text-body-sm font-medium text-critical">
          Could not send
        </span>
        <span className="block truncate text-body-sm text-ink-muted">
          {sheet.error ?? "The provider gave no reason."}
        </span>
      </span>
    );
  }

  return (
    <span className="block min-w-0">
      <span className="block truncate text-body-sm text-ink">Sent</span>
      <span className="block truncate text-body-sm text-ink-muted">
        {sheet.at ? formatDate(sheet.at) : ""}
        {sheet.attempts > 2 ? ` · ${Math.ceil(sheet.attempts / 2)} tries` : ""}
      </span>
    </span>
  );
}

/**
 * The two pickers, and the Save that goes with them.
 *
 * Its own component and KEYED ON THE ROW at the call site, because it seeds two
 * `useState` from props — and a `useState` initialiser runs once, at mount. Held
 * inside the dialog without a key it would have been mounted from the board's
 * first render with `row = null` and never re-read (the bug the Employment
 * page's comment records, arrived at one level down).
 */
function RaterFields({
  row,
  raters,
  busy,
  error,
  onCancel,
  onSave,
}: {
  row: BoardRow;
  raters: readonly RaterRow[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (supervisorId: string, reviewerId: string) => void;
}) {
  const [supervisorId, setSupervisorId] = React.useState(row.supervisorId ?? "");
  const [reviewerId, setReviewerId] = React.useState(row.reviewerId ?? "");

  /* -- THE PERSON ALREADY ON THE ROW IS ALWAYS OFFERED, even when they hold no
        Supervisor grant — a team leader is whoever the worker reports to,
        "despite their access level", so dropping them would make the current
        answer unselectable and force a permission change to keep things as they
        are. The same widening the launch dialog does. -- */
  const teamLeaders =
    row.supervisorId && !raters.some((r) => r.id === row.supervisorId)
      ? [{ id: row.supervisorId, name: row.supervisorName, designation: null }, ...raters]
      : raters;

  const label = (r: RaterRow) => (r.designation ? `${r.name} · ${r.designation}` : r.name);

  return (
    <>
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block font-sans text-body-sm font-medium text-ink">
            Team leader — fills in the ratings
          </span>
          <select
            value={supervisorId}
            onChange={(e) => setSupervisorId(e.target.value)}
            className="min-h-11 w-full rounded-input border border-rule bg-surface px-2 font-sans text-body-sm text-ink"
          >
            <option value="">Choose a team leader</option>
            {teamLeaders.map((r) => (
              <option key={r.id} value={r.id}>
                {label(r)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block font-sans text-body-sm font-medium text-ink">
            Supervisor — reviews them and recommends the rise
          </span>
          <select
            value={reviewerId}
            onChange={(e) => setReviewerId(e.target.value)}
            className="min-h-11 w-full rounded-input border border-rule bg-surface px-2 font-sans text-body-sm text-ink"
          >
            <option value="">Choose a supervisor</option>
            {raters.map((r) => (
              <option key={r.id} value={r.id}>
                {label(r)}
              </option>
            ))}
          </select>
          {/* -- Said before the press, in the same words the action refuses
                with, so the form cannot accept what the server then rejects
                (P13-6). -- */}
          {raters.length === 0 ? (
            <span className="mt-1.5 block font-sans text-body-sm text-critical">
              Nobody holds the Supervisor access level. Grant it on Settings › Users.
            </span>
          ) : null}
        </label>
      </div>

      {error ? (
        <p role="alert" className="font-sans text-body-sm text-critical">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <Button variant="ghost" className="min-h-11" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          className="min-h-11"
          disabled={busy || !supervisorId || !reviewerId}
          onClick={() => onSave(supervisorId, reviewerId)}
        >
          {busy ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}

function PersonCell({ name, email }: { name: string | null; email: string | null }) {
  if (!name) return <GridCell value="—" />;
  return (
    <span className="block min-w-0">
      <span title={name} className="block truncate text-body-sm text-ink">
        {name}
      </span>
      {email ? (
        <span title={email} className="block truncate text-body-sm text-ink-muted">
          {email}
        </span>
      ) : (
        <span className="block truncate text-body-sm text-warning">No email on file</span>
      )}
    </span>
  );
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
  const router = useRouter();
  /* -- 0100: removing ONE appraisal, leaving the round and everybody else in
        it. Held here rather than inside the details dialog because that dialog
        closes when this one opens, and a confirmation whose subject vanished
        with the screen behind it has nothing to name. -- */
  const [deleting, setDeleting] = React.useState<BoardRow | null>(null);
  const [deleteBusy, setDeleteBusy] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  /* -- Send the sheet again, and change who fills it in. Both held here for
        the same reason `deleting` is: the row-detail dialog closes when one of
        these opens, so a subject read off that dialog would vanish with it. -- */
  const [resending, setResending] = React.useState<BoardRow | null>(null);
  const [resendBusy, setResendBusy] = React.useState(false);
  const [resendNote, setResendNote] = React.useState<
    { tone: "ok" | "error"; text: string } | null
  >(null);

  const [editing, setEditing] = React.useState<BoardRow | null>(null);
  const [editBusy, setEditBusy] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);

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
                  {roundLabel(row.original.roundName, row.original.roundPeriod) || "—"}
                </Link>
              ),
            } as ColumnDef<BoardRow>,
          ]
        : []),
      {
        accessorKey: "supervisorName",
        // Renamed at the owner's instruction: this column has always held the
        // person who FILLS the sheet, and since 0100 that is the team leader.
        header: "Team leader",
        size: 220,
        cell: ({ row }) => (
          <PersonCell name={row.original.supervisorName} email={row.original.supervisorEmail} />
        ),
      },
      {
        id: "reviewer",
        header: "Supervisor",
        size: 220,
        /* -- Null where nobody reviews — every round launched before 0100, and
              any HR has deliberately sent straight through. Said in words
              rather than left as a dash, because an empty cell beside a filled
              one reads as data that failed to load rather than as a round that
              works differently (FIX-30). -- */
        cell: ({ row }) =>
          row.original.reviewerName ? (
            <PersonCell name={row.original.reviewerName} email={row.original.reviewerEmail} />
          ) : (
            <GridCell value="Straight to HR" className="text-ink-muted" />
          ),
      },
      {
        /* -- BETWEEN the team leader and whether they filled it in, because
              that is the order the two facts happen in: the sheet goes out,
              then it comes back. Reported as "no status shown like sent or
              not" — there was no such column anywhere on this board, and the
              only way to find out was to ring the person. -- */
        id: "sheet",
        header: "Sheet sent",
        size: 180,
        cell: ({ row }) => <SheetCell row={row.original} />,
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
        id: "next",
        header: "What happens next",
        size: 340,
        /* -- THE SENTENCE IS THE LINK, at the owner's instruction. There was a
              column with no heading holding a "Review" link, which is a column
              whose job nobody could read — and the sentence beside it already
              said what was waiting. Two controls for one destination, one of
              them unlabelled.

              The row itself still opens the details dialog, so the two are
              distinct: the row gives the summary, this gives the full report.
              `DataGrid`'s row handler already steps aside for a click that
              lands on an `<a>`, so no change was needed there.

              ONLY WHERE THERE IS SOMETHING TO OPEN. A sheet nobody has filled
              in has no report behind it, so "Waiting on X to fill it in" stays
              plain text — a link to an empty page is worse than no link, and
              the honest reading is that there is nothing to see yet. -- */
        /* -- A SENTENCE AND, WHERE THERE IS ONE, A BUTTON.
              An underlined phrase in grey is not a control — reported exactly
              that way, by the person it was blocking: "how will she know she
              need to click this text". A button looks pressable because it is,
              and the sentence beside it says why.

              THE STAGE IS READ FROM THE VIEWER, not only from the row. The
              same appraisal is "with management" to HR and "waiting on you" to
              the MD, and one wording for both told one of them the wrong
              thing.

              No button where there is nothing behind it: a sheet nobody has
              filled in has no report to open, and a row that is not yours to
              act on gets a sentence rather than a control that would do
              somebody else's job. -- */
        cell: ({ row }) => {
          const step = nextStep(row.original, mdView);

          return (
            <span className="flex min-w-0 items-center gap-3">
              <span
                className={cn(
                  "truncate font-sans text-body-sm",
                  step.tone === "ready"
                    ? "font-medium text-ink"
                    : step.tone === "done"
                      ? "text-ink-muted"
                      : "text-ink",
                )}
              >
                {step.text}
              </span>

              {step.action ? (
                <Button
                  asChild
                  size="sm"
                  variant={step.tone === "ready" ? "default" : "outline"}
                  className="h-8 shrink-0"
                >
                  <Link
                    href={`/admin/worker-appraisals/${row.original.cycleId}/${row.original.id}`}
                  >
                    {step.action}
                  </Link>
                </Button>
              ) : null}
            </span>
          );
        },
      },
      /* -- DELETE, ON THE ROW, at the owner's instruction — asked for twice.
            It was put inside the details dialog first, on the reasoning that a
            destructive control one press from a table row is too easy to hit.
            That is a real risk and it is answered by the confirmation rather
            than by hiding the control: an action nobody can find is not safe,
            it is just absent, and the owner went looking for it twice.

            An icon with an accessible name rather than a word, because it sits
            at the end of eleven columns and a "Delete" label there would read
            as another field. HR only — the MD reads this board and does not
            curate it, and the function refuses them regardless (§9). -- */
      /* -- SEND AGAIN, and CHANGE WHO FILLS IT IN.
            Delete was the ONLY control on a row, so HR who picked the wrong
            person, or whose message never arrived, had exactly one way out:
            destroy the appraisal and run the round again. That is what was
            done, and it is what stranded three rounds — an ACTIVE round with
            no appraisals renders no row, and the board is reachable only from
            a row (see `deleteWorkerAppraisal`).

            Both are hidden once the sheet is in: there is nothing left to
            chase, and moving the rater afterwards would attribute their
            ratings to somebody who did not make them (P19B-14). A control that
            would be refused is not drawn (§13.4). -- */
      ...(mdView
        ? []
        : [
            {
              id: "controls",
              header: "",
              size: 132,
              enableResizing: false,
              cell: ({ row }: { row: { original: BoardRow } }) => (
                <span className="flex items-center gap-1">
                  {row.original.supervisorIn ? null : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setResendNote(null);
                          setResending(row.original);
                        }}
                        aria-label={`Send ${row.original.workerName}'s sheet again`}
                        title={
                          row.original.sheet.status === null
                            ? `Send ${row.original.workerName}'s sheet`
                            : `Send ${row.original.workerName}'s sheet again`
                        }
                        className="inline-flex size-11 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-surface-mute hover:text-ink lg:size-8"
                      >
                        <Send aria-hidden className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditError(null);
                          setEditing(row.original);
                        }}
                        aria-label={`Change who fills in ${row.original.workerName}'s sheet`}
                        title={`Change who fills in ${row.original.workerName}'s sheet`}
                        className="inline-flex size-11 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-surface-mute hover:text-ink lg:size-8"
                      >
                        <Pencil aria-hidden className="size-4" />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteError(null);
                      setDeleting(row.original);
                    }}
                    aria-label={`Delete ${row.original.workerName}'s appraisal`}
                    title={`Delete ${row.original.workerName}'s appraisal`}
                    className="inline-flex size-11 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-critical-tint hover:text-critical lg:size-8"
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </button>
                </span>
              ),
            } as ColumnDef<BoardRow>,
          ]),
    ],
    [allRounds, mdView],
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
              : `${roundLabel(cycle.name, cycle.period_label)} · supervisor due ${formatDate(cycle.supervisor_due_on)}`}
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
            label="Being rated"
            value={inProgress}
            caption="with the team leader"
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
            caption={mdView ? "with HR, not yet sent up" : "set the salary, send it up"}
            tone="final"
            onSelect={() => toggle("ready")}
            active={filter === "ready"}
          />
          {/* Shown to everybody, always. It was hidden at zero for HR because
              most rounds never used Send to MD — but management approval is
              required on every production appraisal now, so this stage is
              never a permanent zero, and it is where HR looks to see what is
              waiting on the MD. */}
          <KpiCard
            label={mdView ? "Ready for you" : "With management"}
            value={withMd}
            caption={mdView ? "sent up for you to sign off" : "sent to the MD to sign off"}
            tone="lead"
            onSelect={() => toggle("md")}
            active={filter === "md"}
          />
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
        {/* -- THE FLOW, IN ONE LINE. It said "each supervisor completes it"
              and "it reaches you when they submit" — the pre-0100 flow, with
              no team leader and no review step, on a board whose own tiles now
              show both. -- */}
        <p className="font-sans text-body-sm text-ink-muted">
          {mdView ? (
            <>
              The team leader rates, their supervisor reviews, HR sets the salary — then it comes to
              you to approve or send back.
            </>
          ) : (
            <>
              The team leader rates each worker from{" "}
              <span className="font-medium text-ink">Production Team</span>, their supervisor
              reviews, then it reaches you: set the salary and send it to management. The worker
              fills nothing.
            </>
          )}
        </p>
      </div>

      <DataGrid
        data={visible}
        columns={columns}
        storageKey="appraise.worker-board.column-widths"
        rowNoun="worker"
        rowTitle={(r) => r.workerName}
        /* -- Rendered INSIDE the details dialog, so removing an appraisal takes
              opening the row first. That is the friction this needs: one press
              on a table row should not be able to destroy a record, and the
              dialog is where somebody is already looking at what they would be
              deleting.

              HR only. The MD reads this board and does not curate it (§9 as
              amended), and the action refuses them server-side regardless. -- */
        rowActions={
          mdView
            ? undefined
            : (row) => (
                <>
                  <Button asChild variant="secondary" className="min-h-11">
                    <Link href={`/admin/worker-appraisals/${row.cycleId}/${row.id}`}>
                      Open the report
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    className="min-h-11 text-critical hover:text-critical"
                    onClick={() => {
                      setDeleteError(null);
                      setDeleting(row);
                    }}
                  >
                    <Trash2 aria-hidden className="size-4" />
                    Delete this appraisal
                  </Button>
                </>
              )
        }
        // +250 for the Supervisor column and the widened Team leader one, so
       // neither is squeezed below the address it now carries.
       // 110 narrower: the unnamed Review column is gone and its job moved
       // onto the sentence in "What happens next".
       // +180 for "Sheet sent" and +76 for the two new row controls, so no
       // column is squeezed below the two lines it now carries.
       minWidth={1556}
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

      {/* -- WHAT GOES, NAMED. This is the last press before an appraisal
            record is destroyed, and §13.4 asks an irreversible action to
            describe itself precisely — "are you sure?" is not a description.
            There is no bin for a single row, and the text says so rather than
            letting somebody assume one. -- */}
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? null : setDeleting(null))}
      >
        <DialogContent className="w-[min(96vw,480px)] border-rule">
          <DialogHeader>
            <DialogTitle className="text-display-sm text-ink">
              Delete {deleting?.workerName}&rsquo;s appraisal?
            </DialogTitle>
            <DialogDescription className="font-sans text-body-sm text-ink-muted">
              This removes their ratings, both comments, the training answer, the increment
              recommendation and the frozen sheet they were given. It cannot be undone and there is
              no recycle bin for one appraisal.
            </DialogDescription>
          </DialogHeader>

          {/* -- AND IF IT IS THE LAST ONE, SAY SO BEFORE THE PRESS.
                A round with no appraisals left renders no row, and this board
                is reachable only from a row — so the round would disappear
                from the product entirely. It goes to the recycle bin with the
                appraisal now, and somebody about to press this needs to know
                that is what they are doing (§13.4). -- */}
          {deleting && rows.filter((r) => r.cycleId === deleting.cycleId).length === 1 ? (
            <p className="rounded-control bg-warning-tint px-3 py-2 font-sans text-body-sm text-ink">
              This is the only appraisal in{" "}
              <span className="font-medium">{deleting.roundName}</span>, so the round goes to
              Settings › Recycle bin with it. You can restore it from there.
            </p>
          ) : null}

          {deleteError ? (
            <p role="alert" className="font-sans text-body-sm text-critical">
              {deleteError}
            </p>
          ) : null}

          <DialogFooter>
            <Button variant="ghost" className="min-h-11" onClick={() => setDeleting(null)}>
              Keep it
            </Button>
            <Button
              className="min-h-11 bg-critical text-ink-invert hover:bg-critical/90"
              disabled={deleteBusy}
              onClick={async () => {
                if (!deleting) return;
                setDeleteBusy(true);
                setDeleteError(null);
                const result = await deleteWorkerAppraisal(deleting.id);
                setDeleteBusy(false);
                if (!result.ok) {
                  setDeleteError(result.error.message);
                  return;
                }
                setDeleting(null);
                router.refresh();
              }}
            >
              Delete for good
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* -- SEND IT AGAIN, AND SAY WHAT HAPPENED.
            A production round sent once, at launch, from a function that
            discarded the result — so a message that never arrived could not be
            diagnosed and could not be retried. Unlike the launch, this one
            reports: somebody pressing Send is asking a question, and "we tried"
            is not an answer to it (§0.7). -- */}
      <Dialog
        open={resending !== null}
        onOpenChange={(open) => {
          if (open) return;
          setResending(null);
          setResendNote(null);
        }}
      >
        <DialogContent className="w-[min(96vw,480px)] border-rule">
          <DialogHeader>
            <DialogTitle className="text-display-sm text-ink">
              {resending?.sheet.status === null ? "Send the sheet" : "Send the sheet again"}
            </DialogTitle>
            <DialogDescription className="font-sans text-body-sm text-ink-muted">
              {resending
                ? `${resending.supervisorName} gets a message with a link to ${resending.workerName}'s sheet, on WhatsApp and by email wherever we have one.`
                : null}
            </DialogDescription>
          </DialogHeader>

          {resending && resending.sheet.status === "FAILED" && resending.sheet.error ? (
            <p className="rounded-control bg-critical-tint px-3 py-2 font-sans text-body-sm text-ink">
              Last time: {resending.sheet.error}
            </p>
          ) : null}

          {resendNote ? (
            <p
              role={resendNote.tone === "error" ? "alert" : undefined}
              className={cn(
                "font-sans text-body-sm",
                resendNote.tone === "error" ? "text-critical" : "text-ink",
              )}
            >
              {resendNote.text}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              variant="ghost"
              className="min-h-11"
              onClick={() => {
                setResending(null);
                setResendNote(null);
              }}
            >
              Close
            </Button>
            <Button
              className="min-h-11"
              disabled={resendBusy}
              onClick={async () => {
                if (!resending) return;
                setResendBusy(true);
                setResendNote(null);
                const result = await resendWorkerSheet(resending.id);
                setResendBusy(false);

                if (!result.ok) {
                  setResendNote({ tone: "error", text: result.error.message });
                  return;
                }

                /* -- THE OUTCOME, NOT "DONE". `sent: 0` is the case this whole
                      change exists for — on a development server every send is
                      refused because the app URL is localhost (P28-1), and
                      reporting that as success is exactly what hid it. -- */
                const { sent, failed, problems } = result.data;
                if (sent > 0) {
                  setResendNote({
                    tone: "ok",
                    text: `Sent to ${resending.supervisorName}${
                      failed > 0 ? `, though one channel failed: ${problems[0] ?? ""}` : "."
                    }`,
                  });
                } else {
                  setResendNote({
                    tone: "error",
                    text:
                      problems[0] ??
                      "Nothing was sent, and the provider gave no reason. Check Settings › Messages.",
                  });
                }
                router.refresh();
              }}
            >
              {resendBusy ? "Sending…" : "Send it"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* -- CHANGE WHO FILLS IT IN, without destroying the appraisal.
            Delete was the only control on a row, so a wrong pick meant deleting
            and running the round again — which is what stranded three rounds.
            Refused once the sheet is in, because moving the rater afterwards
            attributes their ratings to somebody who did not make them
            (P19B-14); the button is not drawn in that case either. -- */}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => (open ? null : setEditing(null))}
      >
        <DialogContent className="w-[min(96vw,560px)] border-rule">
          <DialogHeader>
            <DialogTitle className="text-display-sm text-ink">
              Who fills in {editing?.workerName}&rsquo;s sheet?
            </DialogTitle>
            <DialogDescription className="font-sans text-body-sm text-ink-muted">
              The team leader ticks the eight qualities. Their supervisor then reviews those ticks
              and records the comment, the training answer and the recommended rise.
            </DialogDescription>
          </DialogHeader>

          {editing ? (
            <RaterFields
              key={editing.id}
              row={editing}
              raters={raters}
              busy={editBusy}
              error={editError}
              onCancel={() => setEditing(null)}
              onSave={async (supervisorId, reviewerId) => {
                setEditBusy(true);
                setEditError(null);
                const result = await reassignWorkerRaters(editing.id, {
                  supervisorId,
                  reviewerId,
                });
                setEditBusy(false);
                if (!result.ok) {
                  setEditError(result.error.message);
                  return;
                }
                setEditing(null);
                router.refresh();
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

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
