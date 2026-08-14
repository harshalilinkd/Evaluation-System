"use client";

/** Evaluation Due — every employee review that is coming up or late. */

import * as React from "react";
import { useRouter } from "next/navigation";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, RotateCcw, Rocket, Search, Send } from "lucide-react";

import { DataGrid, GridCell } from "@/components/appraise/data-grid";
import {
  KpiCard,
  KpiRow,
  SCREEN_SELECT_CLASS,
  ScreenHeader,
  ScreenToolbar,
  TableScreen,
} from "@/components/appraise/screen";
import { Input } from "@/components/ui/input";
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
import { createAndSend, refreshDueItems, skipDueItem } from "@/lib/due/actions";
import type { DueList, DueRow } from "@/lib/due/queries";
import { formatDate } from "@/lib/utils/date";
import { cn } from "@/lib/utils";

/** "Any department" — a sentinel, because "" is a legitimate select value. */
const ANY = "__any__";

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
  /* Three tones, because there are three outcomes: it worked, it failed, or it
     worked and something still needs doing. Collapsing the third into "ok"
     would report a successful send that never happened. */
  const [message, setMessage] = React.useState<
    { tone: "ok" | "warn" | "error"; text: string } | null
  >(null);
  const [skipping, setSkipping] = React.useState<DueRow | null>(null);
  const [reason, setReason] = React.useState("");
  const [refreshing, setRefreshing] = React.useState(false);
  /* -- The three counts, made pressable. Milestone and increment are the two
        kinds of item; overdue cuts across both, which is why it is its own key
        rather than a third kind. Pressing the active one clears it. -- */
  const [tile, setTile] = React.useState<null | "milestone" | "soon" | "overdue">(null);
  const toggleTile = (next: "milestone" | "soon" | "overdue") =>
    setTile((current) => (current === next ? null : next));

  const [search, setSearch] = React.useState("");
  const [department, setDepartment] = React.useState(ANY);

  /* Only the departments PRESENT on this list — an option that matches nothing
     is a filter that looks broken when it is pressed. */
  const departments = React.useMemo(
    () =>
      [...new Set(list.rows.map((r) => r.department).filter((d): d is string => Boolean(d)))].sort(
        (a, b) => a.localeCompare(b),
      ),
    [list.rows],
  );

  const visible = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return list.rows.filter((r) => {
      if (tile === "overdue" && r.daysRemaining >= 0) return false;
      /* Thirty days AND not already late — the same predicate the count uses,
         so a tile can never disagree with its own number (F50-3). */
      if (tile === "soon" && !(r.daysRemaining >= 0 && r.daysRemaining <= 30)) return false;
      if (department !== ANY && r.department !== department) return false;
      if (!needle) return true;
      /* Name, employee ID and designation — the three things somebody has in
         front of them when they come looking for one person. Their manager too:
         "who is Mahesh waiting on" is a real question on this screen. */
      return (
        r.name.toLowerCase().includes(needle) ||
        (r.employeeCode ?? "").toLowerCase().includes(needle) ||
        (r.designation ?? "").toLowerCase().includes(needle) ||
        (r.leadName ?? "").toLowerCase().includes(needle)
      );
    });
  }, [list.rows, tile, department, search]);

  /* -- WHO A ROUND WOULD COVER: everybody due or already late.
        The same set "Start evaluations for everyone due" preselects, counted
        here so the button says how many people it is about rather than opening
        a screen to find out. DISTINCT people, not items: somebody with two
        reviews falling together is one person in one cycle. -- */
  const dueOrOverdueCount = React.useMemo(
    () => new Set(list.rows.filter((r) => r.daysRemaining <= 30).map((r) => r.profileId)).size,
    [list.rows],
  );

  /** Recompute what is due. A refresh, not an action with consequences. */
  async function onRefresh() {
    setRefreshing(true);
    setMessage(null);
    const result = await refreshDueItems();
    setRefreshing(false);
    if (!result.ok) {
      setMessage({ tone: "error", text: result.error.message });
      return;
    }
    setMessage({
      tone: "ok",
      text:
        result.data.found === 0
          ? "Nothing new is due. Anything added today with a milestone in the next few weeks would appear here."
          : `${result.data.found} new ${result.data.found === 1 ? "item" : "items"} added.`,
    });
    router.refresh();
  }

  async function onCreate(row: DueRow) {
    setBusyId(row.id);
    setMessage(null);
    const result = await createAndSend(row.id);
    setBusyId(null);
    if (!result.ok) setMessage({ tone: "error", text: result.error.message });
    else {
      /* -- CREATED, THEN REVIEWED, THEN SENT — at the owner's instruction.
            This used to create the evaluation and message both people on the
            same press. A cycle launch shows a roster, a readiness report and a
            recipient choice before anything leaves; this was the one path in
            the product where an appraisal opened for a real person and the
            links went out with nothing in between.

            So it hands over to the round's distribution screen, which already
            has the link status, the contact details, the retry and the choice
            of who gets messaged. Nothing is sent here.

            `router.push`, not `replace`: Back returns to the due list, which is
            where somebody working through several of these wants to be. -- */
      setMessage({
        tone: "ok",
        text: `${row.name}'s ${row.what.toLowerCase()} is open. Review and send their links.`,
      });
      if (result.data.cycleId) {
        router.push(`/admin/cycles/${result.data.cycleId}/distribute`);
      } else {
        // No cycle came back — the evaluation exists, so say so rather than
        // navigating nowhere (§13.4).
        setMessage({
          tone: "warn",
          text: `${row.name}'s ${row.what.toLowerCase()} is open, but the round could not be opened. Find it under Evaluation Cycles to send their links.`,
        });
        router.refresh();
      }
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
      /* The Code column is gone: it is the gutter now, headed Employee ID. */
      {
        accessorKey: "designation",
        header: "Designation",
        size: 170,
        cell: ({ row }) => <GridCell value={row.original.designation ?? "—"} />,
      },
      {
        accessorKey: "department",
        header: "Department",
        size: 160,
        cell: ({ row }) => <GridCell value={row.original.department ?? "—"} />,
      },
      {
        /* -- WHO WILL RATE THEM. Already on the row and never rendered.
              It is the thing HR chases when a review stalls, and the one field
              whose absence BLOCKS the primary action — "Nobody is set to rate
              them" was reported in a tooltip beside a disabled button while the
              column that would have shown it was not on screen. -- */
        accessorKey: "leadName",
        header: "Reports to",
        size: 170,
        cell: ({ row }) => (
          <GridCell
            value={row.original.leadName ?? "Nobody set"}
            className={row.original.leadName ? undefined : "text-critical"}
          />
        ),
      },
      {
        /* -- LAST REVIEWED, from `closed_at`.
              Empty for everybody today and honestly so: nothing has been closed
              in this system yet. It fills in as cycles finish, which is what
              makes "when were they last actually reviewed" answerable at all —
              until now it lived only in whoever remembered. -- */
        id: "lastCompleted",
        accessorFn: (row) => row.lastCompletedOn ?? "",
        header: "Last completed",
        size: 140,
        cell: ({ row }) =>
          row.original.lastCompletedOn ? (
            <GridCell value={formatDate(row.original.lastCompletedOn)} className="tabular" />
          ) : (
            <span className="text-body-sm text-ink-faint">Not yet</span>
          ),
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
                Create · review links
              </Button>
              {/* -- THE FIX, IN THE ROW, replacing a sentence the column was
                    too narrow to show. It read "Nobody is s…" beside a dead
                    button, which is worse than saying nothing: it looks like a
                    fault rather than a task. The full sentence stays in the
                    `title` and is spelled out in the row's dialog, where there
                    is room; here it is a short label that goes somewhere. -- */}
              {row.original.blockedFix ? (
                <Button asChild size="sm" variant="outline" className="min-h-11 whitespace-nowrap lg:h-8">
                  <Link href={row.original.blockedFix.href} title={row.original.blockedBecause ?? undefined}>
                    {row.original.blockedFix.label}
                    <ArrowUpRight className="size-3.5" aria-hidden />
                  </Link>
                </Button>
              ) : (
                <span
                  title={row.original.blockedBecause}
                  className="truncate text-body-sm text-critical"
                >
                  {row.original.blockedBecause}
                </span>
              )}
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <Button
                size="sm"
                className="min-h-11 lg:h-8"
                disabled={busyId === row.original.id}
                onClick={() => onCreate(row.original)}
              >
                {busyId === row.original.id ? "Working…" : "Create · review links"}
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
        title="Evaluation Due"
        subtitle={
          /* -- THE OFFICE TEAM, and the screen now SAYS so.
                It always has been: all three branches of `compute_due_items`
                filter `track = 'STAFF'`, because the production team is not
                reviewed on intervals at all — they take one increment a year
                and are appraised on their own rounds (§7, WORKER-1).
                Nothing said it, so the owner reasonably expected to find them
                here and asked for them to be removed. There was nothing to
                remove; there was a sentence missing. -- */
          list.rows.length === 0
            ? "No evaluations are waiting. Reviews are worked out from each person's joining date and their last increment, and appear here as the dates approach. Office team only — the production team is not reviewed on intervals. If you have just added somebody, press Check again."
            : `${list.thisMonth} ${list.thisMonth === 1 ? "thing needs" : "things need"} your attention this month · ${list.rows.length} in total · office team`
        }
        /* -- ON DEMAND, because the sweep used to run only overnight.
              Somebody entered this morning did not appear until tomorrow, and
              HR notices that on the day they add a joiner — which is exactly
              when they want to see the milestone appear.

              A secondary action, not the primary one: the job on this screen is
              acting on what is listed, and §13.3 gives that slot to "Create and
              send". Safe to press repeatedly — the sweep writes pending items
              and nothing else, and a unique index means a second run over the
              same window creates nothing. -- */
        action={
          canAct ? (
            <div className="flex flex-wrap items-center gap-2">
              {/* -- ONE PRESS FOR THE WHOLE ROUND, at the owner's instruction:
                    "Add a button that redirects HR to the evaluation cycle
                    screen with everything pre-filled."

                    It was one "Create and send" per row, so a month with nine
                    reviews due meant nine separate cycles — which is not what a
                    review round is. The per-row action stays for the genuine
                    single case and is still the primary one ON A ROW.

                    The URL says WHAT to select, never a list of ids: the wizard
                    resolves who from the same due items this page is showing,
                    and a URL carrying fifty uuids breaks at the browser's
                    length limit. -- */}
              {dueOrOverdueCount > 0 ? (
                <Button asChild className="min-h-11">
                  {/* Step 2 — the basics are prefilled, so Basics has
                      nothing left to ask. */}
                  <Link href="/admin/cycles/new?evaluate=due&step=2">
                    <Rocket aria-hidden className="size-4" />
                    Start evaluations for everyone due ({dueOrOverdueCount})
                  </Link>
                </Button>
              ) : null}
              <Button
                variant="outline"
                className="min-h-11"
                disabled={refreshing}
                onClick={() => void onRefresh()}
              >
                <RotateCcw aria-hidden className={cn("size-4", refreshing && "animate-spin")} />
                {refreshing ? "Checking…" : "Check again"}
              </Button>

              {/* -- WHERE THE RECORD OF EVERY SENT LINK ALREADY LIVES.
                    Asked for as "I should have a track of all evaluation forms
                    sent." There are two answers and both existed; neither was
                    reachable from here, which is where the question is asked.

                    Per round: the distribution screen, which this screen now
                    hands over to after Create — link status, last sent, the
                    channels used and a per-row history.

                    Across everything: the message log, every message with its
                    provider outcome and a retry. Linked rather than rebuilt —
                    a second view of `notifications_log` would be a second
                    answer to "did it go", and P11-3 made that table the one
                    record of a send. -- */}
              <Button asChild variant="ghost" className="min-h-11">
                <Link href="/admin/settings?tab=messages">
                  <Send aria-hidden className="size-4" />
                  Sent links
                </Link>
              </Button>
            </div>
          ) : undefined
        }
      />

      <KpiRow>
        <KpiCard
          label="Milestone evaluations due"
          value={list.milestonesDue}
          tone="self"
          onSelect={() => toggleTile("milestone")}
          active={tile === "milestone"}
        />
        {/* -- "Increments due" was here. Increments have their own menu
                section and their own calendar, so counting them on the
                evaluation screen was the one card that sent HR somewhere else.
                "Due soon" is the evaluation question this page can answer. -- */}
        <KpiCard
          label="Due in the next 30 days"
          value={list.dueSoon}
          tone="lead"
          onSelect={() => toggleTile("soon")}
          active={tile === "soon"}
        />
        <KpiCard
          label="Evaluations overdue"
          value={list.overdue}
          tone={list.overdue > 0 ? "critical" : "plain"}
          caption={list.overdue > 0 ? "Past their date" : "Nothing is late"}
          onSelect={() => toggleTile("overdue")}
          active={tile === "overdue"}
        />
      </KpiRow>

      {/* -- Search and a department filter, at the owner's request.
            Twenty-one rows is already past the point where finding one person
            means reading the column, and it grows with the company. -- */}
      <ScreenToolbar>
        <div className="relative min-w-56 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search by name, employee ID, designation or manager"
            title="Search by name, employee ID, designation or manager"
            /* Short, because at a third of 375px the long form arrives as
               "Search by nam" and reads as a truncated label rather than a
               hint (F13-8). The full sentence is in the aria-label. */
            placeholder="Search"
            className="min-h-11 pl-9"
          />
        </div>

        <select
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          aria-label="Department"
          className={cn(SCREEN_SELECT_CLASS, "min-h-11 min-w-0")}
        >
          <option value={ANY}>All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>

        {/* The match count, ON A PHONE TOO: `DataGrid`'s own status bar is
            below the list, and somebody who has just narrowed it needs to know
            it narrowed (F13-7). */}
        <span className="tabular text-body-sm text-ink-muted">
          {visible.length === list.rows.length
            ? `${list.rows.length} ${list.rows.length === 1 ? "item" : "items"}`
            : `${visible.length} of ${list.rows.length}`}
        </span>
      </ScreenToolbar>

      {/* -- WHY SOMEBODY IS NOT ON THIS LIST.
            It is the milestones still WAITING, not the staff roster — an item
            leaves the moment it is created or skipped, which is why the count
            falls as HR works through it. Reported as "all employee names are
            not showing here", and the screen said nothing either way. -- */}
      <p className="px-4 pb-1 text-body-sm text-ink-muted lg:px-0">
        Reviews still waiting. Somebody drops off this list once their evaluation
        has been created or the milestone skipped — the whole staff list is under
        Team review.
      </p>

      {message ? (
        <p
          /* A warning is announced like an error — it says something still has
             to be done, and a `status` is not read out promptly enough for
             that to land (§13.8). */
          role={message.tone === "ok" ? "status" : "alert"}
          className={cn(
            "shrink-0 border-b px-4 py-2 font-sans text-body-sm",
            message.tone === "error"
              ? "border-critical/40 bg-critical-tint text-critical"
              : message.tone === "warn"
                ? "border-warning/40 bg-warning-tint text-ink"
                : "border-final/40 bg-final-tint text-final",
          )}
        >
          {message.text}
        </p>
      ) : null}

      <DataGrid
        data={visible}
        columns={columns}
        storageKey="appraise.due.column-widths"
        rowNoun="item"
        /* -- EMPLOYEE ID IN THE GUTTER, the treatment Team review and Settings ›
              Users already have.
              The `#` it replaces was a row counter, which says nothing about
              the person — and the gutter is the one focusable control per row,
              so it could not simply be deleted (F59-4). -- */
        rowLabel={{ header: "Employee ID", value: (r) => r.employeeCode ?? "—" }}
        rowTitle={(r) => `${r.name} · ${r.what}`}
        // §13.4: the reason a control is unavailable sits beside it, never in a
        // tooltip — and the dialog is where somebody reads the whole row, so it
        // is the right place to say why this one cannot go ahead.
        rowActions={(r) =>
          !canAct ? (
            <span className="text-body-sm text-ink-muted">HR acts on this</span>
          ) : r.blockedBecause ? (
            /* -- THE REASON AND THE WAY TO FIX IT, together.
                  The sentence alone was a dead end: "Nobody is set to rate
                  them" in a dialog whose only other control is Close, and each
                  of the four causes is fixed on a different screen. The link
                  carries `?find=` so the roster opens on that person rather
                  than on the whole company (§13.4). -- */
            <span className="flex flex-col items-start gap-1.5">
              <span className="text-body-sm text-critical">{r.blockedBecause}</span>
              {r.blockedFix ? (
                <Button asChild variant="outline" size="sm" className="min-h-11">
                  <Link href={r.blockedFix.href}>
                    {r.blockedFix.label}
                    <ArrowUpRight className="size-3.5" aria-hidden />
                  </Link>
                </Button>
              ) : null}
            </span>
          ) : (
            <Button
              className="min-h-11"
              disabled={busyId === r.id}
              onClick={() => onCreate(r)}
            >
              {busyId === r.id ? "Working…" : "Create · review links"}
            </Button>
          )
        }
        minWidth={1240}
        empty={
          <EmptyState
            title="Nothing is due"
            /* -- "An increment appears as its date approaches" was FALSE.
                  `getDueList` filters INCREMENT out at source, deliberately —
                  increments have their own menu section — so this promised the
                  one thing the screen is guaranteed never to show. It sat under
                  a heading reading "Nothing is due", which is where somebody
                  goes looking for why. -- */
            body="A new joiner appears here a month after they start, and again at six months. After an increment, again at three and nine months. Office team only — the production team takes one increment a year and is appraised on its own rounds. Increments live under Increments."
          />
        }
        status={
          <span className="tabular text-body-sm text-ink">
            {visible.length} {visible.length === 1 ? "item" : "items"}
            {tile ? ` of ${list.rows.length}` : ""} · soonest first
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
