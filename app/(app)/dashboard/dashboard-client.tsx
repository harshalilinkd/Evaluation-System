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
import { ArrowRight } from "lucide-react";

import { LabelledBarChart, RankedBarChart, StatusDonutChart, ratingBandColor, ratingBandIndex } from "@/components/appraise/charts";
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
 * `h-full` and the column layout are what stop a row going ragged: two panels
 * side by side with different amounts of content used to leave a gap under the
 * shorter one, which reads as a rendering fault rather than as a design.
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
  myEvaluationId,
  myDueOn,
  toRate,
  due,
}: {
  analytics: Analytics;
  firstName: string;
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
              label={`Namaste ${firstName}`}
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
            <div className="card-surface flex h-full flex-col justify-center gap-1 p-6">
              <p className="type-label text-ink-muted">Namaste {firstName}</p>
              <p className="font-sans text-h3 text-ink">
                {activeCycle ? activeCycle.name : "No cycle is running"}
              </p>
              <p className="font-sans text-body-sm text-ink-muted">
                {activeCycle
                  ? `${activeCycle.periodLabel} · nothing is waiting on you`
                  : "Nothing is waiting on you."}
              </p>
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

function AdminView({ analytics }: { analytics: Analytics }) {
  const { departments, sections, variance, distribution, needsAttention } = analytics;

  /*
    A CYCLE THAT HAS PRODUCED NOTHING YET IS NOT FOUR EMPTY CHARTS.

    Early on — which is where every cycle starts and where the product is most
    often seen — distribution, departments and variance are all empty, and the
    grid rendered four chart-shaped holes with a caption in each. That reads as
    broken rather than as early.

    So the analytics section only appears once there is something to analyse.
    Until then one line says so, and the counts and the progress bar above it
    are doing the real work.
  */
  const hasAnalytics =
    distribution.length > 0 || departments.length > 0 || variance.length > 0;

  if (!hasAnalytics) {
    return (
      <section className="grid items-stretch gap-6 lg:grid-cols-2">
        <Panel
          title="Analysis"
          subtitle="Rating bands, department averages and how each lead rates."
        >
          <PanelEmpty>
            These appear as ratings come in. Nothing has been submitted on this cycle yet.
          </PanelEmpty>
        </Panel>

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
      </section>
    );
  }

  return (
    <>
      <section className="grid items-stretch gap-6 lg:grid-cols-2">
        <Panel
          title="Where the ratings sit"
          subtitle="Every scored answer this cycle, by band"
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

        <Panel
          title="By department"
          subtitle="Lead averages. Job Specific Skills is excluded — the questions differ per team, so the numbers are not comparable."
        >
          {departments.length === 0 ? (
            <PanelEmpty>Averages appear as each team&rsquo;s ratings arrive.</PanelEmpty>
          ) : (
            <ChartFigure
              caption="Lead averages by department"
              rows={departments}
              columns={[
                { header: "Department", cell: (d) => String(d.department_name ?? "—") },
                { header: "Lead average", cell: (d) => score(d.avg_lead), align: "right" },
              ]}
            >
            <LabelledBarChart
              data={departments.map((d) => ({
                label: String(d.department_name ?? "—"),
                value: Number(d.avg_lead ?? 0),
              }))}
              labelKey="label"
              valueKey="value"
              color="pink"
            />
            </ChartFigure>
          )}
        </Panel>
      </section>

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

      <section className="grid items-stretch gap-6 lg:grid-cols-2">
        <Panel
          title="How each lead rates"
          subtitle="Mean difference from the employee's own score. A lead who is consistently high or low is worth a conversation — for HR and the MD only."
        >
          {variance.length === 0 ? (
            <PanelEmpty>This fills in as reviews arrive.</PanelEmpty>
          ) : (
            <ChartFigure
              caption="How each lead rates, against their team's own scores"
              rows={[...variance].sort(
                (a, b) => Number(b.mean_delta ?? 0) - Number(a.mean_delta ?? 0),
              )}
              columns={[
                { header: "Lead", cell: (v) => String(v.lead_name ?? "—") },
                {
                  header: "Mean difference",
                  cell: (v) => {
                    const d = Number(v.mean_delta ?? 0);
                    // Signed in the table too: "0.40" and "-0.40" are opposite
                    // findings and must not read the same at a glance.
                    return `${d > 0 ? "+" : ""}${d.toFixed(2)}`;
                  },
                  align: "right",
                },
              ]}
            >
            <RankedBarChart
              /* Signed data: above the line the lead rated higher than the
                 employee did, below it lower. Sorted so the two poles sit at
                 the ends and the leads who agree with their team collapse
                 toward the middle — which is the shape HR is looking for. */
              data={[...variance]
                .sort((a, b) => Number(b.mean_delta ?? 0) - Number(a.mean_delta ?? 0))
                .map((v) => ({
                  label: String(v.lead_name ?? "—"),
                  value: Number(v.mean_delta ?? 0),
                }))}
              labelKey="label"
              valueKey="value"
              diverging
            />
            </ChartFigure>
          )}
        </Panel>

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
      </section>

      {sections.length > 0 ? (
        <Panel
          title="By section"
          subtitle="Company-wide averages, self against lead"
        >
          {/*
            A TABLE OF FOUR NUMBERS PER ROW IS NOT HOW YOU READ A GAP.

            The question this panel answers is "where do the two sides
            disagree", and a reader had to subtract in their head across a
            column. A dumbbell puts the two points on one track and makes the
            distance between them the most visible thing — the gap becomes the
            shape, not an arithmetic exercise.

            `ChartFigure` keeps the table a click away, which is also what
            discharges the cyan contrast warning the palette validator raised.
          */}
          <ChartFigure
            caption="Company-wide section averages, self against lead"
            rows={pivotSections(sections)}
            columns={[
              { header: "Section", cell: (r) => r.label },
              { header: "Self", cell: (r) => score(r.self), align: "right" },
              { header: "Lead", cell: (r) => score(r.lead), align: "right" },
              {
                header: "Gap",
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
    </>
  );
}

/**
 * `v_section_scores` carries ONE ROW PER LAYER, so the self and lead figures for
 * a section arrive as two rows. Pivoting here rather than in the view keeps the
 * view a plain aggregate that any caller can read (P16), and the gap is computed
 * once from the pair — never stored, because §11 makes it a reporting figure.
 */
function pivotSections(rows: Analytics["sections"]) {
  const bySection = new Map<string, { label: string; self: number | null; lead: number | null }>();

  for (const row of rows) {
    // Job Specific Skills asks different questions per department, so a
    // company-wide average of it compares unrelated things. The view flags it;
    // this is the consumer honouring the flag (P16-4).
    if (!row.is_comparable) continue;

    const key = String(row.section);
    const entry = bySection.get(key) ?? {
      label: SECTION_LABELS[row.section] ?? key,
      self: null,
      lead: null,
    };
    if (row.layer === "SELF") entry.self = row.avg_score === null ? null : Number(row.avg_score);
    if (row.layer === "LEAD") entry.lead = row.avg_score === null ? null : Number(row.avg_score);
    bySection.set(key, entry);
  }

  return [...bySection.entries()].map(([section, v]) => ({
    section,
    ...v,
    gap: v.self === null || v.lead === null ? null : Math.round((v.lead - v.self) * 100) / 100,
  }));
}

/* ---------- A head of department ---------- */

function LeadView({ analytics }: { analytics: Analytics }) {
  const { needsAttention } = analytics;

  return (
    <section className="grid items-stretch gap-6 lg:grid-cols-2">
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
    <section className="grid items-stretch gap-6 lg:grid-cols-2">
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
