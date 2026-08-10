"use client";

/**
 * The dashboard, rebuilt on P16's views (P23).
 *
 * WHAT EACH PERSON SEES IS DECIDED BY `analytics.audience`, and the numbers
 * behind it by RLS — every view is `security_invoker`, so an employee's figures
 * are their own slice by construction. This file chooses the LAYOUT for each
 * audience; it never filters data for safety, because a filter is something
 * somebody can forget.
 */

import Link from "next/link";
import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  ClipboardCheck,
  Star,
  TrendingDown,
  TrendingUp,
  UserCheck,
  Users,
} from "lucide-react";

import {
  RadialGauge,
  TIER_CHART_COLORS,
  TrendAreaChart,
} from "@/components/appraise/charts";
import { MetricStrip, type Metric } from "@/components/appraise/metric-strip";
import { CycleShapeChart } from "@/components/appraise/cycle-shape-chart";
import { HistoryTrendChart } from "@/components/appraise/history-trend-chart";
import { ChartFigure } from "@/components/appraise/chart-figure";
import { HeroCard } from "@/components/appraise/stat-tile";
import { Button } from "@/components/ui/button";
import type { Analytics } from "@/lib/analytics/queries";
import type { SystemPulse } from "@/lib/analytics/pulse";
import { formatDate } from "@/lib/utils/date";
import { cn } from "@/lib/utils";

export type DueSummary = {
  total: number;
  thisMonth: number;
  overdue: number;
  increments: number;
};

/**
 * A titled panel. `card-surface` is the borderless 16px card from UI-REFRESH.
 *
 * IT SIZES TO ITS CONTENT. The rows no longer stretch, and that is deliberate:
 * levelling the card bottoms means the shorter card is padded out to match the
 * taller one, which is fine when both hold something and produces a large empty
 * box when one does not. Early in a cycle almost every panel is empty, so the
 * levelling was buying tidy edges at the cost of a page of voids.
 *
 * Ragged bottoms, honest heights.
 */
function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="card-surface flex h-full flex-col gap-4 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="font-sans text-body font-medium text-ink">{title}</h2>
          {subtitle ? (
            <p className="max-w-prose font-sans text-body-sm leading-relaxed text-ink-muted">
              {subtitle}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      <div className="flex-1">{children}</div>
    </section>
  );
}

/**
 * "Nothing here yet", INSIDE a panel.
 *
 * `EmptyState` is the full-page affordance — a dashed block sized to fill a
 * screen. Dropping one into a dashboard panel is what produced the voids: a
 * card reserving 300px of chart height to say one sentence. Early on, when
 * every panel is empty, that turns the whole page into whitespace with captions
 * floating in it.
 *
 * So a panel with nothing to show COLLAPSES to a line instead of holding a
 * chart-shaped hole open.
 */
function PanelEmpty({ children }: { children: React.ReactNode }) {
  /* -- TOP-ALIGNED, and not `h-full`.
        It was `flex h-full items-center`, which is what put a single sentence
        in the MIDDLE of a 400px card — the panel stretches to match its taller
        sibling (that is what keeps the card edges level), and centring inside
        that stretch left the text adrift with dead space above and below it.

        Sitting under the header is where a reader expects it, and the card is
        no taller for it. Paired with the charts now sizing to their data, an
        early cycle produces short cards rather than large blank ones. -- */
  return <p className="font-sans text-body-sm text-ink-muted">{children}</p>;
}

/** A label over a figure. Used in the greeting card's footing row. */
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="type-label text-ink-muted">{label}</dt>
      <dd className="tabular mt-0.5 font-sans text-body-lg text-ink">{value}</dd>
    </div>
  );
}

/* -- How many cycles a trend line draws.
      Eight is where the x-axis stops being readable at the widths this chart is
      given, and it is more history than anybody reads off a line — the rest is
      in the table beside it. One constant, so every trend in the product agrees
      on the same bound rather than each picking its own. -- */
const TREND_POINTS = 8;

const score = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : Number(v).toFixed(2);

/* -- A difference always carries its sign. "0.40" and "−0.40" are opposite
      findings about a team and must never read alike (P29-7). -- */
const signedScore = (v: number | null | undefined) => {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (n === 0) return "0.00";
  return `${n > 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}`;
};

export function DashboardClient({
  analytics,
  pulse,
  firstName,
  greeting,
  myEvaluationId,
  myDueOn,
  toRate,
  due,
}: {
  analytics: Analytics;
  /** HR and the MD only, and null for everybody else — see `getSystemPulse`. */
  pulse: SystemPulse | null;
  firstName: string;
  /**
   * "Good morning" / "Good afternoon" / "Good evening", already resolved.
   *
   * Passed in rather than computed here: it depends on the clock, and anything
   * derived from `new Date()` inside a client component is computed once on the
   * server and again at hydration. `greetingFor` reads Asia/Kolkata (§0.10), so
   * the server's answer is the right one and there is nothing to disagree with.
   */
  greeting: string;
  myEvaluationId: string | null;
  myDueOn: string | null;
  toRate: number;
  due: DueSummary | null;
}) {
  const { audience, activeCycle, progress } = analytics;
  const isAdmin = audience === "hr" || audience === "md";

  return (
    /* -- EDGE TO EDGE. The dashboard is a GRID, and UI2-9 gave it full bleed for
          exactly that reason: "a grid centred in 1180px wastes half a wide
          monitor. A 2000px-wide text input does not." The attribute had been
          lost somewhere, so a six-tile strip and three-column rows were being
          squeezed into 1180 with a band of canvas either side.

          `data-full-bleed` drops the shell's cap AND its gutters, so the
          padding comes back here — small, and on the page rather than the
          shell, which is the same shape the cycle board uses. Cards flush to
          the viewport edge look like a rendering fault; 16px of gutter reads as
          a decision. -- */
    <div data-full-bleed className="space-y-6 px-4 py-6 lg:px-6">
      {/* ---------- Always first: what THIS person has to do ----------
          Whatever their role, everybody has their own appraisal. A dashboard
          that opens on company statistics while the reader's own form is
          outstanding has its priorities the wrong way round. */}
      {/* -- `items-stretch` HERE and nowhere else. Two cards side by side at the
            very top of a page are read as a pair, so uneven bottoms read as a
            fault — and unlike the panels further down, both of these always have
            content, so levelling them cannot produce an empty box. That is the
            distinction: stretch where both cards are guaranteed to be full,
            never where one might be a single sentence. -- */}
      <section className="grid items-stretch gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {/*
            THE HERO EARNS ITS SIZE, OR IT DOES NOT GET IT.

            A full-bleed dark slab announcing "Nothing needs you" was the
            loudest element on a page whose whole message was that there is
            nothing to do. Weight should follow importance: when the reader has
            something outstanding this is a call to action and takes the night
            treatment; when they do not, it steps back to a quiet strip and lets
            the numbers below lead.
          */}
          {myEvaluationId || toRate > 0 ? (
            <HeroCard
              label={`${greeting}, ${firstName}`}
              value={myEvaluationId ? "Your evaluation is open" : `${toRate} to rate`}
              caption={
                myEvaluationId
                  ? myDueOn
                    ? `Due ${formatDate(myDueOn)}. It takes about ten minutes.`
                    : "It takes about ten minutes."
                  : "Your team is waiting on your ratings."
              }
              action={
                <Button asChild variant="secondary">
                  <Link href={myEvaluationId ? `/my-evaluation/${myEvaluationId}` : "/team"}>
                    {myEvaluationId ? "Fill it in" : "Open my team"}
                    <ArrowRight className="ml-2 size-4" aria-hidden />
                  </Link>
                </Button>
              }
            />
          ) : (
            /* -- IT FILLS THE HEIGHT BY CARRYING MORE, not by centring less.
                  Three lines in a stretched box is the void from the other
                  direction — so the card states which cycle is running, where it
                  has got to, and when the two sides are due. That is orientation
                  the reader would otherwise have to go and find, and it makes
                  the pair either side of it the same size honestly. -- */
            <div className="card-surface flex h-full flex-col gap-1 p-6">
              <p className="type-label text-ink-muted">
                {greeting}, {firstName}
              </p>
              <p className="font-sans text-display-sm text-ink">
                {activeCycle ? activeCycle.name : "No cycle is running"}
              </p>
              <p className="font-sans text-body-sm text-ink-muted">
                {activeCycle
                  ? `${activeCycle.periodLabel} · nothing is waiting on you`
                  : "Nothing is waiting on you."}
              </p>

              {activeCycle && progress ? (
                <dl className="mt-auto grid grid-cols-3 gap-4 pt-5">
                  <Figure
                    label="People"
                    value={String(Number(progress.total ?? 0))}
                  />
                  <Figure
                    label="Both sides in"
                    value={`${Math.min(
                      Number(progress.self_submitted ?? 0),
                      Number(progress.lead_reviewed ?? 0),
                    )} of ${Number(progress.total ?? 0)}`}
                  />
                  <Figure
                    label="Complete"
                    value={`${Number(progress.percent_complete ?? 0).toFixed(0)}%`}
                  />
                </dl>
              ) : null}
            </div>
          )}
        </div>

        {/* P22: "It should be the first thing on their dashboard." */}
        {due ? (
          <Panel
            title="What is due"
            action={
              <Button asChild variant="ghost" size="sm">
                <Link href="/admin/due">Open</Link>
              </Button>
            }
          >
            <div className="space-y-3">
              <p className="tabular text-display-lg text-ink">{due.thisMonth}</p>
              <p className="font-sans text-body-sm text-ink-muted">
                {due.thisMonth === 1 ? "thing needs" : "things need"} your attention this month
              </p>
              <dl className="space-y-1 font-sans text-body-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-muted">Increments coming</dt>
                  <dd className="tabular text-ink">{due.increments}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-muted">Overdue</dt>
                  <dd className={due.overdue > 0 ? "tabular text-critical" : "tabular text-ink"}>
                    {due.overdue}
                  </dd>
                </div>
              </dl>
            </div>
          </Panel>
        ) : null}
      </section>

      {/* ---------- The figures, immediately under the greeting ----------
          Above every chart, because they are the only things on the page that
          are readable at a glance and true from the moment a cycle launches. A
          reader who looks at nothing else should still leave knowing the
          headcount, how much of it is in, and what is not started. */}
      {isAdmin ? <MetricStrip metrics={adminMetrics(analytics)} /> : null}

      {/* ---------- Everything below is for people who see more than their own ---------- */}
      {audience === "employee" ? (
        <EmployeeView analytics={analytics} />
      ) : (
        <>
          {/* ---------- Where the cycle stands ----------
              The four bare counts that were here — In progress / Self submitted
              / Rated by their lead / Reviewed — had no denominator and no
              relationship to each other, which is four facts rather than an
              answer. `CycleShapeChart` shows the two sides in PARALLEL (§1:
              neither waits for the other) and the records' position as one
              ordered bar. */}
          <Panel
            title="Where this cycle stands"
            subtitle={
              activeCycle
                ? `${activeCycle.name} · ${activeCycle.periodLabel}`
                : "No cycle is running at the moment."
            }
            action={
              progress ? (
                <span className="tabular text-body-sm text-ink-muted">
                  {Number(progress.percent_complete ?? 0).toFixed(0)}% complete
                </span>
              ) : undefined
            }
          >
            {!progress || Number(progress.total ?? 0) === 0 ? (
              <PanelEmpty>
                This fills in the moment a cycle is launched — both sides&rsquo; progress, and
                where every record has got to.
              </PanelEmpty>
            ) : (
              <ChartFigure
                caption="Cycle progress: each side's submissions, and where the records are"
                rows={[
                  { k: "Employees submitted", v: `${Number(progress.self_submitted ?? 0)} of ${Number(progress.total)}` },
                  { k: "HODs submitted", v: `${Number(progress.lead_reviewed ?? 0)} of ${Number(progress.total)}` },
                  { k: "With HR", v: String(Number(progress.md_finalized ?? 0)) },
                  { k: "Closed", v: String(Number(progress.closed ?? 0)) },
                  { k: "Complete", v: `${Number(progress.percent_complete ?? 0).toFixed(0)}%` },
                ]}
                columns={[
                  { header: "Measure", cell: (r) => r.k },
                  { header: "Value", cell: (r) => r.v, align: "right" },
                ]}
              >
                <CycleShapeChart
                  shape={{
                    total: Number(progress.total ?? 0),
                    selfIn: Number(progress.self_submitted ?? 0),
                    leadIn: Number(progress.lead_reviewed ?? 0),
                    withHr: Number(progress.md_finalized ?? 0),
                    reviewed: 0,
                    closed: Number(progress.closed ?? 0),
                  }}
                />
              </ChartFigure>
            )}
          </Panel>

          {isAdmin ? (
            <AdminView analytics={analytics} pulse={pulse} />
          ) : (
            <LeadView analytics={analytics} />
          )}
        </>
      )}
    </div>
  );
}

/** Who is late, oldest first. Shared by the admin and lead panels. */
function LateList({
  people,
  limit,
}: {
  people: Analytics["needsAttention"];
  limit: number;
}) {
  return (
    <ul className="space-y-2">
      {people.slice(0, limit).map((person) => (
        <li
          key={person.evaluationId}
          className="flex items-center justify-between gap-3 rounded-control bg-surface-mute px-3 py-2"
        >
          <span className="min-w-0">
            <span className="block truncate font-sans text-body-sm text-ink">{person.name}</span>
            {person.department ? (
              <span className="block truncate font-sans text-body-sm text-ink-muted">
                {person.department}
              </span>
            ) : null}
          </span>
          {/* A number AND the word — colour is never the only signal (§13.8). */}
          <span className="shrink-0 tabular text-body-sm text-critical">
            {person.daysLate}d late
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ---------- HR and the MD ---------- */

/**
 * One stage of the pipeline, as a link.
 *
 * A count somebody cannot act on is a fact, not a dashboard — so each of these
 * goes somewhere: the cycle board for work still being filled in, the report
 * queue for anything waiting on a person.
 *
 * The tone is a chart/status hue, never a tier. §13.1 reserves cyan, pink and
 * indigo for "who said this", and a pipeline stage is not a layer — that was
 * the exact misuse `Tally` was written to avoid.
 */
function PipelineTile({
  label,
  value,
  caption,
  href,
  tone,
}: {
  label: string;
  value: number;
  caption: string;
  href: string;
  tone: "primary" | "amber" | "green";
}) {
  // Written out in full: Tailwind scans statically, so an interpolated class
  // name compiles to nothing at all.
  const bar = {
    primary: "bg-accent-primary",
    amber: "bg-warning",
    green: "bg-accent-green",
  }[tone];

  return (
    <Link
      href={href}
      className="card-surface group flex items-center gap-4 p-5 transition-shadow duration-hover hover:shadow-dashboard-hover"
    >
      <span aria-hidden className={cn("h-10 w-1 shrink-0 rounded-pill", bar)} />
      <span className="min-w-0 flex-1">
        <span className="block font-sans text-body-sm text-ink-muted">{label}</span>
        <span className="tabular block font-sans text-display-md leading-tight text-ink">
          {value}
        </span>
        <span className="block truncate font-sans text-body-sm text-ink-muted">{caption}</span>
      </span>
      <ArrowRight
        aria-hidden
        className="size-4 shrink-0 text-ink-faint transition-transform duration-hover group-hover:translate-x-0.5"
      />
    </Link>
  );
}

/**
 * This month against last, as a pill.
 *
 * Green up / red down is the TREND colour and never a tier (UI2-2) — it appears
 * here because it describes movement. The arrow carries the direction too, so
 * the sign is never colour alone (§13.8).
 *
 * A first month says "first month" rather than "+9": there is nothing to
 * compare against, and a rise measured from no baseline is not a rise.
 */
function MonthDelta({ current, previous }: { current: number; previous: number }) {
  if (previous === 0 && current === 0) {
    return <span className="font-sans text-body-sm text-ink-muted">nothing closed yet</span>;
  }
  if (previous === 0) {
    return <span className="font-sans text-body-sm text-ink-muted">nothing closed last month</span>;
  }

  const delta = current - previous;
  if (delta === 0) {
    return <span className="font-sans text-body-sm text-ink-muted">same as last month</span>;
  }

  const up = delta > 0;
  return (
    <span
      className={cn(
        "tabular inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-body-sm font-medium",
        up ? "bg-success-tint text-success" : "bg-critical-tint text-critical",
      )}
    >
      {up ? (
        <TrendingUp aria-hidden className="size-3" />
      ) : (
        <TrendingDown aria-hidden className="size-3" />
      )}
      {up ? "+" : "−"}
      {Math.abs(delta)} vs last month
    </span>
  );
}

/* ---------- The headline figures ---------- */
/**
 * The six numbers that open the page.
 *
 * At module scope rather than inside `AdminView` because the strip renders
 * at the TOP, beside the greeting, and the greeting belongs to the shell.
 * Passing the built array up is cheaper than hoisting the whole admin
 * section, and it keeps one definition of what each figure means.
 */
function adminMetrics(analytics: Analytics): Metric[] {
  const { departments, progress } = analytics;
  /* ---------- The headline figures ----------

     WHAT EACH COLUMN COUNTS IS NOT GUESSED — 0027 rewrote this view for blind
     rating and kept every column NAME (§0.2, and `queries.ts` selects `*` into a
     generated type). `self_submitted` and `lead_reviewed` now read the two
     TIMESTAMPS, because under blind rating neither layer has a status of its
     own: both fill in during OPEN, so no single status can say "self is in,
     lead is not". Each also counts a row whose status has moved past the point
     that requires it, which is what stops a SKIPPED layer reading as unstarted
     for ever.

     The two share bars are therefore honest: they are counting people, not
     inferring from a status. */
  const total = Number(progress?.total ?? 0);
  const selfIn = Number(progress?.self_submitted ?? 0);
  const leadIn = Number(progress?.lead_reviewed ?? 0);
  const notStarted = Number(progress?.not_started ?? 0);
  const closed = Number(progress?.closed ?? 0);

  /* -- Weighted by headcount, not a mean of means. A five-person team and a
        fifty-person team do not carry equal weight in a company average, and
        averaging the department averages would give them exactly that. -- */
  const rated = departments.filter((d) => d.avg_lead !== null);
  const ratedPeople = rated.reduce((n, d) => n + Number(d.people ?? 0), 0);
  const companyLead =
    ratedPeople > 0
      ? rated.reduce((n, d) => n + Number(d.avg_lead ?? 0) * Number(d.people ?? 0), 0) / ratedPeople
      : null;

  const share = (n: number) => (total > 0 ? n / total : 0);

  return [
    {
      label: "In this cycle",
      value: total,
      caption: total === 1 ? "person being appraised" : "people being appraised",
      tone: "primary",
      icon: <Users className="size-4" />,
    },
    {
      label: "Self-evaluations in",
      value: selfIn,
      caption: `of ${total}`,
      share: share(selfIn),
      tone: "cyan",
      icon: <UserCheck className="size-4" />,
    },
    {
      label: "HOD ratings in",
      value: leadIn,
      caption: `of ${total}`,
      share: share(leadIn),
      tone: "pink",
      icon: <ClipboardCheck className="size-4" />,
    },
    {
      label: "Not started",
      value: notStarted,
      caption: "neither side has answered",
      share: share(notStarted),
      tone: "amber",
      icon: <CircleAlert className="size-4" />,
    },
    {
      label: "Completed",
      value: closed,
      caption: `of ${total} closed`,
      share: share(closed),
      tone: "green",
      icon: <CircleCheck className="size-4" />,
    },
    {
      label: "Average rating",
      value: companyLead === null ? "—" : companyLead.toFixed(2),
      // §11 is explicit that there is no final score and no single headline
      // figure, so this says WHICH average it is rather than presenting itself
      // as "the score".
      caption: companyLead === null ? "no ratings yet" : "lead average, out of 5",
      tone: "primary",
      icon: <Star className="size-4" />,
    },
  ];
}

function AdminView({ analytics, pulse }: { analytics: Analytics; pulse: SystemPulse | null }) {
  const { departments, needsAttention, timeline, progress } = analytics;

  /* -- IS THERE A CURVE TO DRAW, or just a rule?
        `timeline.length < 2` was the wrong test. A cycle with one participant
        who submitted on day one produces three, five, ten timeline points that
        are all the same number — so the guard passed and the panel drew a
        perfectly flat line at y=1 across three days, with a filled gradient
        under it. It looks like a chart, reads like a trend, and says nothing.

        This chart exists to answer "will this land by the due date", which is a
        SLOPE. Two conditions have to hold for that to be a real question: the
        series must actually rise across the window, and the numbers must be
        large enough that the rise is a shape rather than a single step. Below
        that the honest answer is the two counts as words, which is what the
        panel says instead. -- */
  const timelinePeak = Math.max(0, ...timeline.map((r) => Math.max(r.self, r.lead)));
  const timelineFirst = timeline[0];
  const timelineLast = timeline[timeline.length - 1];
  const timelineRises =
    timeline.length > 1 &&
    timelineFirst !== undefined &&
    timelineLast !== undefined &&
    (timelineLast.self > timelineFirst.self || timelineLast.lead > timelineFirst.lead);
  const showTimeline = timelineRises && timelinePeak >= 3;

  /*
    A CYCLE THAT HAS PRODUCED NOTHING YET IS NOT A PAGE OF EMPTY CHARTS.

    It used to swap the whole analytics block for a single "these appear later"
    line, because the alternative was four chart-shaped holes. That solved the
    voids by removing the screen.

    The metric strip above is what actually answers it: a cycle with nothing
    submitted still has a headcount, a not-started count and two share bars at
    zero, all of which are real and none of which needs a chart. So the figures
    always render, and each panel here decides for itself — collapsing to one
    line rather than holding a canvas open.
  */
  return (
    <>
      {/* ---------- WHERE THE WORK IS ----------
          The dashboard opened on six panels of company-wide averages, which is
          a research question. The one an administrator actually arrives with is
          "what is happening, and what needs me" — a state of the system, not a
          distribution of its output.

          These three counts are the whole pipeline in one row: filling in,
          waiting for HR, waiting for the MD. Each is a link, because a count
          somebody cannot act on is a fact rather than a dashboard. */}
      {pulse ? (
        <section className="grid gap-4 lg:grid-cols-4">
          {/* -- An ARC, beside three numbers.
                `RadialGauge` has existed since UI-2 and nothing had ever used
                it. It earns its place here rather than being variety for its
                own sake: this is a single proportion, which is the one thing a
                dial does better than a number — it reads from across a room,
                and unlike a donut it does not imply the remainder is a second
                category.

                `percent_complete` is the view's own figure, not one recomputed
                here: 0027 defines it as three steps per evaluation so the arc
                moves as work happens rather than only when somebody finishes
                entirely, and a second definition on this screen would disagree
                with the segmented bar under the cycle header. -- */}
          <div className="card-surface flex flex-col justify-center p-5">
            <p className="font-sans text-body-sm text-ink-muted">Cycle progress</p>
            <RadialGauge
              value={Number(progress?.percent_complete ?? 0)}
              max={100}
              height={148}
              color="primary"
            />
            <p className="text-center font-sans text-body-sm text-ink-muted">
              {Number(progress?.total ?? 0)} in this cycle · every appraisal is three
              steps
            </p>
          </div>

          {/* -- FOUR STAGES, NOT THREE. The pipeline ended at "With the MD",
                so a record the MD had reviewed was counted nowhere and the row
                read as though nothing were outstanding — the same hole the
                reports queue had until today, and the one place work stalls
                silently because each side assumes the other has it. -- */}
          <div className="grid gap-4 sm:grid-cols-2 lg:col-span-3 xl:grid-cols-4">
            <PipelineTile
              label="Being filled in"
              value={pulse.inProgress}
              caption="both sides still rating"
              href="/admin/cycles"
              tone="primary"
            />
            <PipelineTile
              label="Waiting for HR"
              value={pulse.awaitingHr}
              caption="both sides in, ready to read"
              href="/reports"
              tone="amber"
            />
            <PipelineTile
              label="With the MD"
              value={pulse.withMd}
              caption="sent on, awaiting approval"
              href="/reports"
              tone="green"
            />
            {/* -- Amber, like "Waiting for HR", because both are somebody's
                  outstanding work rather than a stage running its course. The
                  caption names the action and not the state: "reviewed" would
                  read as finished, which is exactly the misreading that let
                  these sit. -- */}
            <PipelineTile
              label="Ready to close"
              value={pulse.readyToClose}
              caption="reviewed — nothing left but to finish it"
              href="/reports"
              tone="amber"
            />
          </div>
        </section>
      ) : null}

      {pulse ? (
        <section className="grid items-stretch gap-6 lg:grid-cols-3">
          {/* ---------- Finished, and how that compares ----------
              A count on its own is a number; a count against last month is a
              direction. The comparison is what turns "9 completed" into
              something somebody can act on. */}
          <Panel
            title="Finished this month"
            subtitle="Evaluations closed, against the same point last month."
          >
            <div className="flex items-end gap-4">
              <p className="tabular text-display-lg leading-none text-ink">
                {pulse.completedThisMonth}
              </p>
              <MonthDelta
                current={pulse.completedThisMonth}
                previous={pulse.completedLastMonth}
              />
            </div>
            <p className="mt-3 font-sans text-body-sm text-ink-muted">
              {pulse.completedLastMonth} closed last month.
            </p>

            {/* -- A COUNT, never an amount. §5 confines pay figures to HR and
                  the MD, and while this panel is theirs alone, a dashboard is a
                  screen people read over each other's shoulders. -- */}
            <div className="mt-4 border-t border-rule pt-4">
              <p className="type-label text-ink-muted">Pay changes recorded</p>
              <p className="tabular mt-0.5 font-sans text-body-lg text-ink">
                {pulse.incrementsThisMonth}{" "}
                <span className="font-sans text-body-sm text-ink-muted">
                  {pulse.incrementsThisMonth === 1 ? "this month" : "this month"}
                </span>
              </p>
            </div>
          </Panel>

          {/* ---------- Coming up ---------- */}
          <Panel
            title="Coming up"
            subtitle="Scheduled reviews and increments not yet started."
            action={
              <Button asChild variant="ghost" size="sm">
                <Link href="/admin/due">Open</Link>
              </Button>
            }
          >
            {pulse.upcoming.length === 0 ? (
              <PanelEmpty>Nothing scheduled in the next 90 days.</PanelEmpty>
            ) : (
              <>
                <ul className="space-y-2.5">
                  {pulse.upcoming.map((item) => (
                    <li
                      key={`${item.profileId}-${item.milestone}-${item.dueOn}`}
                      className="flex items-center gap-3"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-sans text-body-sm text-ink">
                          {item.name}
                        </span>
                        <span className="block truncate font-sans text-body-sm text-ink-muted">
                          {item.milestone}
                        </span>
                      </span>
                      {/* Overdue is a failure, not a tier — and the word
                          carries it as well as the colour (§13.8). */}
                      <span
                        className={cn(
                          "tabular shrink-0 text-body-sm",
                          item.daysAway < 0 ? "font-medium text-critical" : "text-ink-muted",
                        )}
                      >
                        {item.daysAway < 0
                          ? `${Math.abs(item.daysAway)}d late`
                          : item.daysAway === 0
                            ? "today"
                            : `in ${item.daysAway}d`}
                      </span>
                    </li>
                  ))}
                </ul>
                {pulse.upcomingMore > 0 ? (
                  <p className="mt-3 font-sans text-body-sm text-ink-muted">
                    and {pulse.upcomingMore} more.
                  </p>
                ) : null}
              </>
            )}
          </Panel>

          {/* ---------- How the cycle is filling up ----------
              Moved here from a row of its own. It was two-thirds wide beside
              the leaderboard, and when that went the row was one card and a
              gap. Three equal columns instead: what closed, what is coming,
              and how the current cycle is filling — one question about the
              state of the cycle, answered three ways, in a single band. */}
          <Panel
            title="How the cycle is filling up"
            subtitle="Cumulative submissions. Each side is counted separately."
          >
            {!showTimeline ? (
              /* The counts, in words, rather than a flat line pretending to be
                 a trend. This is the number somebody wanted anyway. */
              <PanelEmpty>
                {timelineLast
                  ? `${timelineLast.self} self-${timelineLast.self === 1 ? "evaluation" : "evaluations"} and ${timelineLast.lead} HOD ${timelineLast.lead === 1 ? "rating" : "ratings"} are in. The curve appears once submissions span several days.`
                  : "The curve appears once submissions start arriving."}
              </PanelEmpty>
            ) : (
              <ChartFigure
                caption="Cumulative self-evaluations and HOD ratings, by day"
                rows={[...timeline].reverse()}
                columns={[
                  { header: "Day", cell: (r) => formatDate(r.day) },
                  { header: "Self", cell: (r) => String(r.self), align: "right" },
                  { header: "HOD", cell: (r) => String(r.lead), align: "right" },
                ]}
              >
                {/* -- The two tier hues, and legitimately: the series ARE the
                      rating layers, so the colour IS the meaning (§13.1). This
                      is the documented exception UI2-12 leaves open, and P30
                      validated the pair — ΔE 8.9 deuteranopic, 31.2 normal.
                      Two series, so a legend is always present. -- */}
                <TrendAreaChart
                  data={timeline.map((row) => ({
                    label: formatDate(row.day),
                    self: row.self,
                    lead: row.lead,
                  }))}
                  xKey="label"
                  series={[
                    { key: "self", label: "Self-evaluations", color: TIER_CHART_COLORS.self },
                    { key: "lead", label: "HOD ratings", color: TIER_CHART_COLORS.lead },
                  ]}
                />
              </ChartFigure>
            )}
          </Panel>

        </section>
      ) : null}

      {/* ---------- Where the two sides disagree ----------
          THIS PANEL REPLACES TWO. It used to sit at the bottom of the page
          under a radar of the same numbers ("The shape of the two sides") and a
          bar chart of department averages that "Where each team stands" already
          covers below. Three datasets were each drawn twice, in six panels, and
          the earlier reasoning for that — "two questions, two encodings" — was
          wrong in practice: a reader does not arrive asking two questions, they
          arrive asking one, and the second panel is where they lose the thread.

          The radar went for a second reason the owner named exactly: it plotted
          COMPANY-WIDE averages, so its outline belongs to nobody. There is no
          department on it and no person, and with a single employee in the
          cycle it was that employee's profile presented as an organisation's.
          A radar earns its place on the scorecard, where the axes are one named
          person; it does not earn it here.

          The dumbbell survives because it answers the same question in numbers
          somebody can repeat: two dots on one track, the distance between them
          IS the gap, and the figure is printed at the end of the row. */}
      {/* Removed: the section gap is analysis and belongs to a report being read, not to a landing page. /reports carries it per person. */}

      {/* ---------- Where each team stands ----------
          The most actionable thing on an HR dashboard and it was not here.
          Company-wide progress says the cycle is 60% in; it does not say WHICH
          team to ring. `v_department_scores` has carried `people` and
          `self_count` since P16 and nothing had ever read them.

          Completion and divergence on one row deliberately: a team that is
          behind AND disagreeing with itself is a different problem from one
          that is merely late, and reading the two facts off separate panels is
          how the combination gets missed. */}
      {departments.length > 0 ? (
        <section>
          <Panel
            title="Where each team stands"
            subtitle="How far the self-evaluations have come, and how far apart the two sides are. A team can be finished and still disagree."
          >
            <ChartFigure
              caption="Self-evaluation completion and self-versus-lead difference, by department"
              rows={departments}
              columns={[
                { header: "Department", cell: (d) => String(d.department_name ?? "—") },
                {
                  header: "Self in",
                  cell: (d) => `${Number(d.self_count ?? 0)} of ${Number(d.people ?? 0)}`,
                  align: "right",
                },
                { header: "Difference", cell: (d) => signedScore(d.gap), align: "right" },
              ]}
            >
              <ul className="space-y-3">
                {[...departments]
                  /* -- Least complete first. The list is a work queue, so its
                        order has to be the order somebody would work it — not
                        alphabetical, and not by score. -- */
                  .sort(
                    (a, b) =>
                      Number(a.self_count ?? 0) / Math.max(1, Number(a.people ?? 0)) -
                      Number(b.self_count ?? 0) / Math.max(1, Number(b.people ?? 0)),
                  )
                  .map((d) => {
                    const people = Number(d.people ?? 0);
                    const inCount = Number(d.self_count ?? 0);
                    const pct = people > 0 ? (inCount / people) * 100 : 0;
                    const gap = d.gap === null || d.gap === undefined ? null : Number(d.gap);
                    const wide = gap !== null && Math.abs(gap) >= 1;
                    return (
                      <li key={String(d.department_id ?? d.department_name)}>
                        <div className="mb-1.5 flex items-baseline justify-between gap-3">
                          <span className="truncate text-body-sm text-ink">
                            {String(d.department_name ?? "—")}
                          </span>
                          <span className="tabular shrink-0 text-body-sm text-ink-muted">
                            {inCount} of {people}
                            {gap === null ? null : (
                              <>
                                {" · "}
                                {/* Never colour alone (§13.8): the number carries
                                    its own sign and the word says what it means. */}
                                <span className={wide ? "text-warning" : undefined}>
                                  {signedScore(gap)}
                                  {wide ? " apart" : ""}
                                </span>
                              </>
                            )}
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-pill bg-rule/70">
                          <div
                            className="h-full rounded-pill bg-self"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
              </ul>
            </ChartFigure>
          </Panel>
        </section>
      ) : null}

      {/* ---------- The roster ----------
          Full width and a real table, because this is the panel somebody reads
          a name off and then acts. The diverging bar below it answers the shape
          question — who is furthest out — and the table answers the specific
          one: who, how many, and which way. */}
      {/* Removed: a per-HOD variance table is a study, not a task. /reports sorts by gap, which is the same finding at the moment somebody acts on it. */}

      {/* ---------- Needs chasing ----------
          The diverging bar chart that used to share this row is gone. It ranked
          leads by mean difference — exactly the figure the table directly above
          already prints, beside the lead's name, their rated count, and a
          position bar showing where they sit. The chart was the same data with
          less of it, and at one HOD it was a single bar labelled with the only
          name on the page. */}
      <Panel
        title="Needs chasing"
        subtitle="Oldest first"
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/cycles">Open cycles</Link>
          </Button>
        }
      >
        {needsAttention.length === 0 ? (
          <PanelEmpty>Nobody is late. Everything outstanding is still within its date.</PanelEmpty>
        ) : (
          <LateList people={needsAttention} limit={6} />
        )}
      </Panel>
    </>
  );
}

/* ---------- A head of department ---------- */

function LeadView({ analytics }: { analytics: Analytics }) {
  const { needsAttention } = analytics;

  return (
    <section className="grid items-start gap-6 lg:grid-cols-2">
      <Panel
        title="Your team"
        subtitle="Who has not been rated yet"
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/team">Open my team</Link>
          </Button>
        }
      >
        {needsAttention.length === 0 ? (
          <PanelEmpty>Everyone in your team is up to date.</PanelEmpty>
        ) : (
          <LateList people={needsAttention} limit={8} />
        )}
      </Panel>

      {/* No gap, no self column, no company averages. §5: a lead sees their own
          ratings and their team's dates, and nothing about the other side. */}
      <Panel title="Your own scorecard" subtitle="How your appraisals have gone">
        <div className="space-y-3">
          <p className="font-sans text-body-sm text-ink-muted">
            Your history, your section profile and where you were strongest.
          </p>
          <Button asChild variant="secondary">
            <Link href="/scorecard">
              Open my scorecard
              <ArrowRight className="ml-2 size-4" aria-hidden />
            </Link>
          </Button>
        </div>
      </Panel>
    </section>
  );
}

/* ---------- Everybody else ---------- */

function EmployeeView({ analytics }: { analytics: Analytics }) {
  const { ownHistory } = analytics;

  return (
    <section className="grid items-start gap-6 lg:grid-cols-2">
      <Panel
        title="Your appraisals"
        subtitle="Every cycle you have been through, and what each side scored"
      >
        {ownHistory.length === 0 ? (
          <PanelEmpty>
            Your first result appears here once your evaluation closes.
          </PanelEmpty>
        ) : ownHistory.length === 1 ? (
          /* One point is not a trend, it is a dot on an axis (N3-8). A reading
             is the honest form for a single cycle; the chart arrives with the
             second one. */
          <div className="space-y-2">
            <p className="font-sans text-body-sm text-ink-muted">
              {String(ownHistory[0]?.period_label ?? ownHistory[0]?.cycle_name ?? "Your first cycle")}
            </p>
            <dl className="grid grid-cols-3 gap-3">
              {(
                [
                  ["You said", ownHistory[0]?.self_overall, "text-ink"],
                  ["Your lead", ownHistory[0]?.lead_overall, "text-ink"],
                  ["Agreed", ownHistory[0]?.final_overall, "text-ink"],
                ] as const
              ).map(([label, value, tone]) => (
                <div key={label} className="rounded-control bg-surface-mute px-3 py-2">
                  <dt className="type-label text-ink-muted">{label}</dt>
                  <dd className={cn("tabular text-display-sm", tone)}>{score(value)}</dd>
                </div>
              ))}
            </dl>
            <p className="font-sans text-body-sm text-ink-muted">
              A trend appears here once you have been through a second cycle.
            </p>
          </div>
        ) : (
          /* Change over time, so a line. A list of five numbers can be read but
             not SEEN, and the shape they make is what somebody wants from their
             own history. `ChartFigure` keeps the numbers one click away, which
             is also what discharges cyan's contrast WARN. */
          <ChartFigure
            caption="Your scores across cycles"
            rows={[...ownHistory].reverse()}
            columns={[
              { header: "Cycle", cell: (r) => String(r.period_label ?? r.cycle_name ?? "—") },
              { header: "You said", cell: (r) => score(r.self_overall), align: "right" },
              { header: "Your lead", cell: (r) => score(r.lead_overall), align: "right" },
              { header: "Agreed", cell: (r) => score(r.final_overall), align: "right" },
            ]}
          >
            {/* -- BOUNDED, AND IT SAYS SO.
                  `ownHistory` is every cycle this person has ever had, and it
                  only grows. A trend line does not get more useful past a
                  handful of points — it gets narrower gaps, colliding x-axis
                  labels and a chart nobody can read, and the newest points are
                  the ones being looked at.

                  The most recent eight, oldest-first so time runs left to
                  right. Nothing is lost: `ChartFigure` shows every cycle in the
                  table beside it, and the line below says how many are not
                  drawn. A cap that stays quiet reads as "this is all of it",
                  which is the one thing it must not say. -- */}
            <HistoryTrendChart
              points={[...ownHistory]
                .slice(0, TREND_POINTS)
                .reverse()
                .map((row) => ({
                  label: String(row.period_label ?? row.cycle_name ?? "—"),
                  self: row.self_overall === null ? null : Number(row.self_overall),
                  lead: row.lead_overall === null ? null : Number(row.lead_overall),
                  final: row.final_overall === null ? null : Number(row.final_overall),
                }))}
            />

            {/* The dataviz rule this exists for: a bound that stays quiet reads
                as complete coverage. Named, with where the rest is. */}
            {ownHistory.length > TREND_POINTS ? (
              <p className="mt-2 font-sans text-body-sm text-ink-muted">
                Showing your most recent {TREND_POINTS} cycles.{" "}
                {ownHistory.length - TREND_POINTS} older{" "}
                {ownHistory.length - TREND_POINTS === 1 ? "one is" : "ones are"} in the table.
              </p>
            ) : null}
          </ChartFigure>
        )}
      </Panel>

      <Panel title="Your scorecard" subtitle="Everything in one place">
        <div className="space-y-3">
          <p className="font-sans text-body-sm text-ink-muted">
            Your history, your strongest areas and where to focus next.
          </p>
          <Button asChild variant="secondary">
            <Link href="/scorecard">
              Open my scorecard
              <ArrowRight className="ml-2 size-4" aria-hidden />
            </Link>
          </Button>
        </div>
      </Panel>
    </section>
  );
}
