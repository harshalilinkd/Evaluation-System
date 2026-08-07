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
import { ArrowRight, ClipboardList, FileText, Flag, Users } from "lucide-react";

import { LabelledBarChart, RankedBarChart, StatusDonutChart } from "@/components/appraise/charts";
import { EmptyState } from "@/components/appraise/states";
import { HeroCard, StatTile } from "@/components/appraise/stat-tile";
import { Button } from "@/components/ui/button";
import { SECTION_LABELS } from "@/lib/forms/labels";
import type { Analytics } from "@/lib/analytics/queries";
import { formatDate } from "@/lib/utils/date";

export type DueSummary = {
  total: number;
  thisMonth: number;
  overdue: number;
  increments: number;
};

/** A titled panel. `card-surface` is the borderless 16px card from UI-REFRESH. */
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
    <section className="card-surface space-y-4 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-0.5">
          <h2 className="font-sans text-body font-medium text-ink">{title}</h2>
          {subtitle ? <p className="font-sans text-body-sm text-ink-faint">{subtitle}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

const score = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : Number(v).toFixed(2);

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
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <HeroCard
            label={`Namaste ${firstName}`}
            value={
              myEvaluationId
                ? "Your evaluation is open"
                : toRate > 0
                  ? `${toRate} to rate`
                  : "Nothing needs you"
            }
            caption={
              myEvaluationId
                ? myDueOn
                  ? `Due ${formatDate(myDueOn)}. It takes about ten minutes.`
                  : "It takes about ten minutes."
                : toRate > 0
                  ? "Your team is waiting on your ratings."
                  : activeCycle
                    ? `${activeCycle.name} · ${activeCycle.periodLabel}`
                    : "No cycle is running at the moment."
            }
            action={
              myEvaluationId ? (
                <Button asChild variant="secondary">
                  <Link href={`/my-evaluation/${myEvaluationId}`}>
                    Fill it in
                    <ArrowRight className="ml-2 size-4" aria-hidden />
                  </Link>
                </Button>
              ) : toRate > 0 ? (
                <Button asChild variant="secondary">
                  <Link href="/team">
                    Open my team
                    <ArrowRight className="ml-2 size-4" aria-hidden />
                  </Link>
                </Button>
              ) : undefined
            }
          />
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
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="In progress"
              value={String(progress?.not_started ?? 0)}
              icon={<ClipboardList className="size-4" aria-hidden />}
              caption="Nobody has submitted yet"
            />
            <StatTile
              label="Self submitted"
              value={String(progress?.self_submitted ?? 0)}
              tone="self"
              icon={<Users className="size-4" aria-hidden />}
            />
            <StatTile
              label="Rated by their lead"
              value={String(progress?.lead_reviewed ?? 0)}
              tone="lead"
              icon={<Flag className="size-4" aria-hidden />}
            />
            <StatTile
              label="Reviewed"
              value={String(progress?.md_finalized ?? 0)}
              tone="final"
              icon={<FileText className="size-4" aria-hidden />}
              caption={
                progress ? `${Number(progress.percent_complete ?? 0).toFixed(0)}% of the cycle done` : undefined
              }
            />
          </section>

          {isAdmin ? <AdminView analytics={analytics} /> : <LeadView analytics={analytics} />}
        </>
      )}
    </div>
  );
}

/* ---------- HR and the MD ---------- */

function AdminView({ analytics }: { analytics: Analytics }) {
  const { departments, sections, variance, distribution, needsAttention } = analytics;

  return (
    <>
      <section className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="Where the ratings sit"
          subtitle="Every scored answer this cycle, by band"
        >
          {distribution.length === 0 ? (
            <EmptyState title="Nothing rated yet" body="Bands appear once ratings come in." />
          ) : (
            <StatusDonutChart
              data={distribution.map((b, i) => ({
                name: String(b.bucket ?? ""),
                value: Number(b.people ?? 0),
                fill: ["rgb(var(--critical))", "rgb(var(--warning))", "rgb(var(--primary))", "rgb(var(--final))"][
                  i % 4
                ]!,
              }))}
            />
          )}
        </Panel>

        <Panel
          title="By department"
          subtitle="Lead averages. Job Specific Skills is excluded — the questions differ per team, so the numbers are not comparable."
        >
          {departments.length === 0 ? (
            <EmptyState title="No department has a score yet" body="Averages appear as leads submit." />
          ) : (
            <LabelledBarChart
              data={departments.map((d) => ({
                label: String(d.department_name ?? "—"),
                value: Number(d.avg_lead ?? 0),
              }))}
              labelKey="label"
              valueKey="value"
              color="pink"
            />
          )}
        </Panel>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="How each lead rates"
          subtitle="Mean difference from the employee's own score. A lead who is consistently high or low is worth a conversation — for HR and the MD only."
        >
          {variance.length === 0 ? (
            <EmptyState title="No leads have submitted yet" body="This fills in as reviews arrive." />
          ) : (
            <RankedBarChart
              data={variance.map((v) => ({
                label: String(v.lead_name ?? "—"),
                value: Number(v.mean_delta ?? 0),
              }))}
              labelKey="label"
              valueKey="value"
              color="primary"
            />
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
            <EmptyState title="Nobody is late" body="Everything outstanding is still within its date." />
          ) : (
            <ul className="space-y-2">
              {needsAttention.slice(0, 6).map((person) => (
                <li
                  key={person.evaluationId}
                  className="flex items-center justify-between gap-3 rounded-control border border-rule px-3 py-2"
                >
                  <span>
                    <span className="block font-sans text-body-sm text-ink">{person.name}</span>
                    <span className="block font-sans text-body-sm text-ink-faint">
                      {person.department ?? "—"}
                    </span>
                  </span>
                  <span className="tabular text-body-sm text-critical">
                    {person.daysLate}d late
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>

      {sections.length > 0 ? (
        <Panel
          title="By section"
          subtitle="Company-wide averages, self against lead"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse">
              <thead>
                <tr className="border-b border-rule">
                  {["Section", "Self", "Lead", "Gap"].map((h) => (
                    <th key={h} className="type-label px-3 py-2 text-left text-ink-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pivotSections(sections).map((row) => (
                  <tr key={row.section} className="border-b border-rule last:border-b-0">
                    <td className="px-3 py-2 font-sans text-body-sm text-ink">{row.label}</td>
                    <td className="px-3 py-2 tabular text-body-sm text-self">{score(row.self)}</td>
                    <td className="px-3 py-2 tabular text-body-sm text-lead">{score(row.lead)}</td>
                    <td className="px-3 py-2 tabular text-body-sm text-ink-muted">
                      {row.gap === null ? "—" : `${row.gap > 0 ? "+" : ""}${row.gap.toFixed(2)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
    <section className="grid gap-6 lg:grid-cols-2">
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
          <EmptyState title="Nothing outstanding" body="Everyone in your team is up to date." />
        ) : (
          <ul className="space-y-2">
            {needsAttention.slice(0, 8).map((person) => (
              <li
                key={person.evaluationId}
                className="flex items-center justify-between gap-3 rounded-control border border-rule px-3 py-2"
              >
                <span className="font-sans text-body-sm text-ink">{person.name}</span>
                <span className="tabular text-body-sm text-critical">{person.daysLate}d late</span>
              </li>
            ))}
          </ul>
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
    <section className="grid gap-6 lg:grid-cols-2">
      <Panel title="Your appraisals" subtitle="How they have gone">
        {ownHistory.length === 0 ? (
          <EmptyState
            title="Nothing completed yet"
            body="Your first result appears here once your evaluation closes."
          />
        ) : (
          <ul className="space-y-2">
            {ownHistory.slice(0, 5).map((row, i) => (
              <li
                key={`${row.cycle_id}-${i}`}
                className="flex items-center justify-between gap-3 rounded-control border border-rule px-3 py-2"
              >
                <span className="font-sans text-body-sm text-ink">
                  {String(row.period_label ?? row.cycle_name ?? "—")}
                </span>
                <span className="tabular text-body-sm text-lead">{score(row.lead_overall)}</span>
              </li>
            ))}
          </ul>
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
