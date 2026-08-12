"use client";

/** The lead's queue: banner, three tiles, and the table of direct reports. */

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";

import { EmptyState } from "@/components/appraise/states";
import {
  KpiCard,
  KpiRow,
  ScreenBody,
  ScreenHeader,
  ScreenToolbar,
  TableScreen,
} from "@/components/appraise/screen";
import { StatusChip } from "@/components/appraise/status-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TeamQueue, TeamRow } from "@/lib/evaluations/team-queue";
import { formatDate } from "@/lib/utils/date";

const ANY = "ANY";

/**
 * The LEAD's own three states. These used to be record statuses — including
 * "Not yet submitted", which meant the EMPLOYEE had not submitted and was
 * therefore a filter over the other side's progress.
 */
const STATUS_FILTERS = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "submitted", label: "Submitted" },
] as const;

export function TeamClient({ queue, firstName }: { queue: TeamQueue; firstName: string }) {
  const [status, setStatus] = React.useState<string>(ANY);
  const [search, setSearch] = React.useState("");

  const rows = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return queue.rows.filter((row) => {
      // Filters on the LEAD's state, never the record's status.
      if (status !== ANY && row.leadState !== status) return false;
      if (!needle) return true;
      return (
        row.name.toLowerCase().includes(needle) ||
        (row.employeeCode ?? "").toLowerCase().includes(needle)
      );
    });
  }, [queue.rows, status, search]);

  // §13.6-adjacent: the banner is a reminder, not a block. A lead may review
  // their team before finishing their own form, and P13 says so explicitly —
  // gating the queue on it would stop the work the screen exists for.
  // AMEND-3's rename: this was never true, so a lead was never reminded that
  // their OWN appraisal was open (P13-12's banner).
  // Every open one, not the first. A HOD with two cycles running owes two
  // self-evaluations, and a banner naming one leaves the other unprompted.
  const ownOpen = queue.ownEvaluations.filter((e) => e.status === "OPEN");

  /* -- The subtitle when there is more than one cycle. Naming one of them and
        its date would state a deadline that is wrong for half the list, so it
        says how many and quotes the SOONEST — which is the one that matters. */
  const soonestDue = queue.cycles
    .map((c) => c.leadDueOn)
    .filter((d): d is string => Boolean(d))
    .sort()[0];

  const onlyCycle = queue.cycles.length === 1 ? queue.cycles[0] : undefined;

  const subtitle =
    queue.cycles.length === 0
      ? "No cycle is running at the moment."
      : onlyCycle
        ? onlyCycle.periodLabel
          ? `${onlyCycle.periodLabel} · your review is due ${formatDate(onlyCycle.leadDueOn)}`
          : "Your reviews are open."
        : `${queue.cycles.length} cycles open · your soonest review is due ${formatDate(soonestDue ?? null)}`;

  /* -- The greeting, three tiles and a filter row cost ~430px before the first
        report. The greeting and the due date are one line now, the three counts
        sit beside them, and the list starts immediately. -- */
  return (
    <TableScreen>
      <ScreenHeader
        title={`Hello ${firstName}`}
        subtitle={subtitle}
      />

      {/* AMEND-3: all three count the LEAD's OWN side. The old middle one
          counted "not yet submitted BY THE EMPLOYEE", which is precisely the
          signal about the other side that blindness withholds. */}
      {/* -- THE TILES DRIVE THE STAGE SELECT, rather than carrying a filter of
            their own. Here the three tiles ARE the three values of `leadState`,
            so a second piece of state could only ever disagree with the control
            beside it — one source, two ways to reach it. Pressing the active
            tile clears back to Any stage. -- */}
      <KpiRow>
        <KpiCard
          label="Not started"
          value={queue.counts.notStarted}
          caption="You have not opened these yet"
          tone="plain"
          onSelect={() => setStatus((c) => (c === "not_started" ? ANY : "not_started"))}
          active={status === "not_started"}
        />
        <KpiCard
          label="In progress"
          value={queue.counts.inProgress}
          caption="Started, not submitted"
          tone="lead"
          onSelect={() => setStatus((c) => (c === "in_progress" ? ANY : "in_progress"))}
          active={status === "in_progress"}
        />
        <KpiCard
          label="Submitted"
          value={queue.counts.submitted}
          caption="Now with HR"
          tone="final"
          onSelect={() => setStatus((c) => (c === "submitted" ? ANY : "submitted"))}
          active={status === "submitted"}
        />
      </KpiRow>

      <ScreenToolbar>
        <div className="relative min-w-0 flex-1 sm:w-[300px] sm:flex-none">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or employee code"
            aria-label="Search your team"
            className="min-h-11 border-rule bg-surface pl-9"
          />
        </div>

        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label="Filter by status" className="min-h-11 w-auto min-w-[8rem] shrink-0 border-rule bg-surface sm:w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All statuses</SelectItem>
            {STATUS_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <p className="tabular ml-auto hidden text-body-sm text-ink-muted lg:block">
          {rows.length} of {queue.rows.length}{" "}
          {queue.rows.length === 1 ? "report" : "reports"}
        </p>
      </ScreenToolbar>

      <ScreenBody className="space-y-3 p-4 lg:p-5">
        {/* Content, not chrome — so it stays, and it scrolls with the list
            rather than being pinned above it. */}
        {ownOpen.map((own) => (
          <section
            key={own.id}
            className="flex flex-wrap items-center justify-between gap-4 rounded-card bg-self-tint px-4 py-3"
          >
            <p className="text-body text-ink">
              {/* Named once there are two, because "your own self-evaluation"
                  twice over is two banners a reader cannot tell apart. */}
              Your own self-evaluation
              {ownOpen.length > 1 ? ` for ${own.cycleName}` : ""} is still open — please finish it
              before {formatDate(own.selfDueOn)}.
            </p>
            {/* P6-8: a lead's own appraisal lives at /my-evaluation and is
                reached from here as a link, never opened as a review here. */}
            <Button asChild className="min-h-11">
              <Link href={`/my-evaluation/${own.id}`}>
                Continue
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          </section>
        ))}

        {queue.rows.length === 0 ? (
          <EmptyState
            /* Was "Nobody on your team has submitted yet" — which is a
               statement about the EMPLOYEES' side, and under blind parallel
               rating (§5) the lead is told nothing about it. It was also simply
               wrong: rows appear here from launch, whether or not anybody has
               submitted, so this state means "you have no reports in this
               cycle", not "they have not started". */
            title="Nobody is assigned to you this cycle"
            body="When HR launches a cycle with people reporting to you, their ratings appear here."
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nobody matches those filters"
            body="Widen the filter or clear the search to see your whole team."
          />
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <TeamCard key={row.evaluationId} row={row} showCycle={queue.cycles.length > 1} />
            ))}
          </ul>
        )}
      </ScreenBody>
    </TableScreen>
  );
}

/**
 * One report.
 *
 * A card list rather than a table: the row carries an avatar, three lines of
 * identity, a status and an action, and at 375px a table of those columns is
 * either a horizontal scroll or eight-point type. §13.2 makes the phone the
 * first case, not the fallback.
 */
function TeamCard({ row, showCycle }: { row: TeamRow; showCycle: boolean }) {
  const initials = row.name
    .split(" ")
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  return (
    <li className="card-surface flex flex-wrap items-center gap-4 p-4">
      <span
        aria-hidden
        className="flex size-11 shrink-0 items-center justify-center rounded-pill bg-accent text-body font-medium text-accent-foreground"
      >
        {initials}
      </span>

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-body-lg text-ink">
          {row.name}
          {row.employeeCode ? (
            <span className="tabular text-body-sm text-ink-muted">{row.employeeCode}</span>
          ) : null}
        </p>
        <p className="text-body-sm text-ink-muted">
          {[row.designation, row.departmentName].filter(Boolean).join(" · ") || "—"}
        </p>
        {/* Which cycle this rating is for. Only when two are running: on a
            single-cycle queue it would be the same badge on every row, and a
            badge that never varies is one people stop reading. Without it, a
            person who appears twice is two identical rows. */}
        {showCycle ? (
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-body-sm text-ink-muted">
            <span className="type-label rounded-pill bg-surface-mute px-2 py-0.5 text-ink">
              {row.cycleName}
            </span>
            {row.periodLabel ? <span>{row.periodLabel}</span> : null}
          </p>
        ) : null}
        {row.isSelfLed ? (
          // P13 edge case. Neutral, not a warning: a department head with nobody
          // above them is a fact about the org chart, not a mistake they made.
          <p className="mt-1 text-body-sm text-ink-muted">
            You are recorded as your own lead for this cycle.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col items-start gap-1 sm:items-end">
        {/* YOUR state, never theirs. */}
        <StatusChip status={row.chipStatus} />
        <p className="tabular text-body-sm text-ink-muted">
          {row.leadState === "submitted"
            ? `You submitted ${row.leadSubmittedAt ? formatDate(row.leadSubmittedAt) : ""}`.trim()
            : row.leadState === "in_progress"
              ? "You have started this"
              : "You have not started this"}
        </p>
        {row.daysToLeadDue !== null && !row.isOverdue && row.leadState !== "submitted" ? (
          <p className="tabular text-body-sm text-ink-muted">
            {row.daysToLeadDue === 0
              ? "Due today"
              : row.daysToLeadDue > 0
                ? `${row.daysToLeadDue} ${row.daysToLeadDue === 1 ? "day" : "days"} left`
                : null}
          </p>
        ) : null}
        {row.isOverdue ? (
          <span className="type-label rounded-pill border border-critical/40 bg-critical-tint px-2.5 py-1 text-critical">
            Overdue
          </span>
        ) : null}
      </div>

      <div className="w-full sm:w-auto">
        {/* ALWAYS openable. Both layers are open together (§8), so there is no
            longer a "waiting for the employee" state — and the disabled button
            that used to say so was itself a readout of the other side. */}
        <Button asChild variant="outline" className="min-h-11 w-full sm:w-auto">
          <Link href={`/team/${row.evaluationId}`}>
            {row.leadState === "submitted" ? "View" : "Rate"}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </div>
    </li>
  );
}
