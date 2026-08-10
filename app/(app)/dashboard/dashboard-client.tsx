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
  UserCheck,
  Users,
} from "lucide-react";

import {
  StatusDonutChart,
  TIER_CHART_COLORS,
  TrendAreaChart,
  ratingBandColor,
  ratingBandIndex,
} from "@/components/appraise/charts";
import { LeadPerformanceTable } from "@/components/appraise/lead-performance-table";
import { MetricStrip, type Metric } from "@/components/appraise/metric-strip";
import { CycleShapeChart } from "@/components/appraise/cycle-shape-chart";
import { HistoryTrendChart } from "@/components/appraise/history-trend-chart";
import { ChartFigure } from "@/components/appraise/chart-figure";
import { GapChart } from "@/components/appraise/gap-chart";
import { HeroCard } from "@/components/appraise/stat-tile";
import { Button } from "@/components/ui/button";
import { SECTION_LABELS } from "@/lib/forms/labels";
import type { Analytics } from "@/lib/analytics/queries";
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
  firstName,
  greeting,
  myEvaluationId,
  myDueOn,
  toRate,
  due,
}: {
  analytics: Analytics;
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
    <div className="space-y-8">
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

          {isAdmin ? <AdminView analytics={analytics} /> : <LeadView analytics={analytics} />}
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

function AdminView({ analytics }: { analytics: Analytics }) {
  const { departments, sections, variance, distribution, needsAttention, timeline } = analytics;

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
  /* -- WHOSE NUMBERS THESE ARE, said out loud.
        Every aggregate panel below was headed "Company-wide averages" and named
        no population at all — so a reader could not tell whether they were
        looking at forty people or one, and with a single employee in the cycle
        the page was that person's appraisal presented as an organisation's.
        That is the same fault the radar had, and it is not fixed by removing
        the radar.

        `v_department_scores` has carried `people` and `self_count` since P16.
        The counts and the team names come from there; the panel states them,
        and links to /reports so a reader can go from "the two sides disagree
        here" to the actual names. -- */
  const populationPeople = departments.reduce((n, d) => n + Number(d.people ?? 0), 0);
  const populationTeams = departments.length;
  const teamNames = departments
    .map((d) => String(d.department_name ?? "").trim())
    .filter(Boolean);

  /* At one team the name IS the useful fact and there is room for it; past
     three, a list of names is longer than the sentence it sits in. */
  const populationLine =
    populationPeople === 0
      ? null
      : `${populationPeople} ${populationPeople === 1 ? "person" : "people"} across ${populationTeams} ${populationTeams === 1 ? "team" : "teams"}${
          teamNames.length > 0 && teamNames.length <= 3 ? ` — ${teamNames.join(", ")}` : ""
        }.`;

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
      {/* ---------- How the cycle is filling up ----------
          The one thing an HR dashboard is actually asked — "will this land by
          the due date" — is a level and a slope, and nothing on this screen
          carried it. */}
      <section className="grid items-start gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel
            title="How the cycle is filling up"
            subtitle="Cumulative submissions. The two sides are counted separately — they rate at the same time and neither sees the other."
          >
            {!showTimeline ? (
              /* The counts, in words, rather than a flat line pretending to be
                 a trend. This is the number somebody wanted anyway. */
              <PanelEmpty>
                {timelineLast
                  ? `${timelineLast.self} self-${timelineLast.self === 1 ? "evaluation" : "evaluations"} and ${timelineLast.lead} HOD ${timelineLast.lead === 1 ? "rating" : "ratings"} are in. The curve appears once enough submissions arrive across several days to show a trend.`
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
        </div>

        {/* Named its population too, for the same reason — this ring is every
            scored answer in the cycle, and without the count a reader cannot
            tell whether that is four hundred answers or forty. */}
        <Panel
          title="Where the ratings sit"
          subtitle={
            populationLine
              ? `Every scored answer this cycle, by band. From ${populationLine}`
              : "Every scored answer this cycle, by band"
          }
        >
          {distribution.length === 0 ? (
            <PanelEmpty>Bands appear here once ratings come in.</PanelEmpty>
          ) : (
            <ChartFigure
              caption="Scored answers by band"
              rows={[...distribution].sort(
                (a, b) =>
                  ratingBandIndex(String(a.bucket ?? "")) - ratingBandIndex(String(b.bucket ?? "")),
              )}
              columns={[
                { header: "Band", cell: (b) => String(b.bucket ?? "—") },
                { header: "People", cell: (b) => String(b.people ?? 0), align: "right" },
              ]}
            >
            <StatusDonutChart
              /*
                The bands are ORDINAL — 0-1 through 4-5 is one scale, not five
                kinds of thing — so they take the single-hue ramp, light to
                dark, exactly as `ordinalStep` was built for.

                What was here before did three wrong things at once. It cycled
                `i % 4` over FIVE bands, so two shared a colour. It coloured by
                the row's position in a `group by` result, which has no
                guaranteed order — a band emptying would have repainted every
                other one. And it reached for `--critical`, `--warning` and
                `--final`: two reserved status colours and, worse, a TIER
                colour. §13.1 keeps indigo meaning "the MD said this" and
                nothing else, and UI2-12 keeps the tiers out of chart series
                altogether.

                Sorted and mapped BY BAND, so a colour always means the same
                score whatever the query returns.
              */
              data={[...distribution]
                .sort(
                  (a, b) =>
                    ratingBandIndex(String(a.bucket ?? "")) -
                    ratingBandIndex(String(b.bucket ?? "")),
                )
                .map((b) => ({
                  name: String(b.bucket ?? ""),
                  value: Number(b.people ?? 0),
                  fill: ratingBandColor(String(b.bucket ?? "")),
                }))}
            />
            </ChartFigure>
          )}
        </Panel>
      </section>

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
      {sections.length > 0 ? (
        <Panel
          title="Where the two sides disagree"
          subtitle={
            populationLine
              ? `Averaged over ${populationLine} Each section shows what people said about themselves against what their HOD said — the longer the line, the further apart they are.`
              : "Each section shows what people said about themselves against what their HOD said — the longer the line, the further apart they are."
          }
          action={
            /* From the finding to the names. The panel is an average and can
               never say WHO on its own; this is the one click that can. */
            <Button asChild variant="ghost" size="sm">
              <Link href="/reports">See the people</Link>
            </Button>
          }
        >
          <ChartFigure
            caption="Section averages, self against lead"
            rows={pivotSections(sections)}
            columns={[
              { header: "Section", cell: (r) => r.label },
              { header: "They rated themselves", cell: (r) => score(r.self), align: "right" },
              { header: "Their HOD rated them", cell: (r) => score(r.lead), align: "right" },
              {
                header: "Difference",
                cell: (r) =>
                  r.gap === null ? "—" : `${r.gap > 0 ? "+" : ""}${r.gap.toFixed(2)}`,
                align: "right",
              },
            ]}
          >
            <GapChart
              rows={pivotSections(sections).map((r) => ({
                label: r.label,
                self: r.self,
                lead: r.lead,
              }))}
            />
          </ChartFigure>
        </Panel>
      ) : null}

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
      {variance.length > 0 ? (
        <Panel
          title="How each HOD rated their team"
          subtitle="For HR and the MD only. A HOD who sits consistently above or below their team is worth a conversation, not a mark against them."
        >
          <LeadPerformanceTable rows={variance} />
        </Panel>
      ) : null}

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

/**
 * `v_section_scores` carries ONE ROW PER LAYER, so the self and lead figures for
 * a section arrive as two rows. Pivoting here rather than in the view keeps the
 * view a plain aggregate that any caller can read (P16), and the gap is computed
 * once from the pair — never stored, because §11 makes it a reporting figure.
 */
/**
 * Section averages across every department in the cycle.
 *
 * IT USED TO ASSIGN, NOT AGGREGATE — and that was a real fault, invisible at
 * one department and wrong at ten.
 *
 * `v_section_scores` returns one row per (cycle, DEPARTMENT, section, layer).
 * The old loop did `entry.self = row.avg_score` for each matching row, so every
 * department overwrote the one before it and the panel rendered whichever
 * department happened to come last out of Postgres — presented, in a heading,
 * as the company-wide figure. No ordering is guaranteed on that view, so the
 * number could change between two loads of the same page with no data change.
 *
 * The fix is a weighted mean, and weighted rather than plain because a section
 * a forty-person team answered is not worth the same as one a two-person team
 * answered. `answer_count` is on the view for exactly this and had never been
 * read.
 */
function pivotSections(rows: Analytics["sections"]) {
  type Acc = { sum: number; weight: number };
  const zero = (): Acc => ({ sum: 0, weight: 0 });
  const mean = (a: Acc) => (a.weight === 0 ? null : Math.round((a.sum / a.weight) * 100) / 100);

  const bySection = new Map<string, { label: string; self: Acc; lead: Acc }>();

  for (const row of rows) {
    // Job Specific Skills asks different questions per department, so a
    // company-wide average of it compares unrelated things. The view flags it;
    // this is the consumer honouring the flag (P16-4).
    if (!row.is_comparable) continue;
    if (row.avg_score === null) continue;

    const key = String(row.section);
    const entry = bySection.get(key) ?? {
      label: SECTION_LABELS[row.section] ?? key,
      self: zero(),
      lead: zero(),
    };

    // Weight of 1 where the count is missing: an unweighted contribution is
    // wrong, but dropping the row entirely loses a real department's answer.
    const weight = Number(row.answer_count ?? 0) || 1;
    const value = Number(row.avg_score);

    if (row.layer === "SELF") {
      entry.self.sum += value * weight;
      entry.self.weight += weight;
    }
    if (row.layer === "LEAD") {
      entry.lead.sum += value * weight;
      entry.lead.weight += weight;
    }
    bySection.set(key, entry);
  }

  return [...bySection.entries()].map(([section, v]) => {
    const self = mean(v.self);
    const lead = mean(v.lead);
    return {
      section,
      label: v.label,
      self,
      lead,
      gap: self === null || lead === null ? null : Math.round((lead - self) * 100) / 100,
    };
  });
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
            <HistoryTrendChart
              /* Oldest first: time runs left to right, and the view hands them
                 back newest first. */
              points={[...ownHistory]
                .reverse()
                .map((row) => ({
                  label: String(row.period_label ?? row.cycle_name ?? "—"),
                  self: row.self_overall === null ? null : Number(row.self_overall),
                  lead: row.lead_overall === null ? null : Number(row.lead_overall),
                  final: row.final_overall === null ? null : Number(row.final_overall),
                }))}
            />
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
