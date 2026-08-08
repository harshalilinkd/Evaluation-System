"use client";

/** The scorecard. Where it stands, how it scored, and what moved between cycles. */

import * as React from "react";
import { EyeOff, Minus, Sparkles, Target, TrendingDown, TrendingUp } from "lucide-react";

import {
  RATING_BANDS,
  SectionRadarChart,
  TrendAreaChart,
} from "@/components/appraise/charts";
import { DashboardCard } from "@/components/appraise/metric-widget";
import { ProgressRail } from "@/components/appraise/progress-rail";
import { EmptyState } from "@/components/appraise/states";
import { TIER_CLASSES, TIER_LABELS } from "@/components/appraise/tier";
import { Button } from "@/components/ui/button";
import { SECTION_LABELS, sectionRank } from "@/lib/forms/labels";
import type { QuestionSection } from "@/lib/forms/types";
import type { Scorecard, ScorecardQuestion } from "@/lib/analytics/queries";
import { formatDate, formatScore } from "@/lib/utils/date";
import { cn } from "@/lib/utils";

/** §11's flag threshold. A gap this wide is worth a conversation. */
const NOTABLE_GAP = 2;

/** What the person is waiting on, in their own terms. */
/*
   AMEND-3 retired all four of the statuses this used to key on, so the panel
   showed nothing for any live cycle.

   Two of the old lines were also a BLINDNESS LEAK once they were rewritten
   rather than dropped: "With your lead — they are reviewing your answers" tells
   the employee their HOD has started, and "Your lead has finished" tells them it
   is done. §5 says the employee learns nothing about the other side, at any
   status. So the wording below describes where the RECORD is, never what
   anybody else has done with it.
*/
const WAITING: Record<string, { who: string; what: string }> = {
  DRAFT: { who: "Not open yet", what: "This cycle has not been launched." },
  OPEN: { who: "Open", what: "Fill in your self-evaluation while it is open." },
  PENDING_HR_REVIEW: { who: "Being reviewed", what: "HR is reading it." },
  HR_APPROVED: { who: "With management", what: "It is waiting for the final review." },
  MD_REVIEWED: { who: "Reviewed", what: "The result is recorded and will be released to you." },
  INTERVIEW_DONE: { who: "Interview done", what: "The outcome has been agreed and is being applied." },
  CLOSED: { who: "Complete", what: "This cycle is closed." },
};

export function ScorecardClient({ card, isSelf }: { card: Scorecard; isSelf: boolean }) {
  // Every chart has a table fallback (P16). Not a nicety: a trend line is
  // unreadable to a screen reader, and these are somebody's appraisal numbers.
  const [asTable, setAsTable] = React.useState(false);
  const [sectionsAsTable, setSectionsAsTable] = React.useState(false);

  /* -- NULL, never 0.
        `?? 0` here was drawing a straight decline from 4 to 0 across a person's
        history — a collapse in their performance that never happened. Every
        cycle they have not been rated in became a floor value, and the chart
        said so in a smooth confident curve while the header beside it said
        "not rated".

        §11 and P7-9 are both explicit that missing is not zero, and this is the
        screen where getting that wrong is most expensive: it is somebody's
        appraisal history, and 0 is the worst score there is. Recharts leaves a
        gap for a null point, which is the honest drawing — nothing is claimed
        about a period nobody scored. -- */
  const trend = card.history
    .filter(
      (h) => h.self_overall !== null || h.lead_overall !== null || h.final_overall !== null,
    )
    .map((h) => ({
      period: h.period_label,
      self: h.self_overall ?? null,
      lead: h.lead_overall ?? null,
      final: h.final_overall ?? null,
    }));

  /* -- Which cycle the detail below is about.
        "" is every cycle. The picker is the thing that turns this from a page
        about a person into a page about one appraisal, which is what somebody
        preparing for a conversation actually needs. -- */
  const [cycleFilter, setCycleFilter] = React.useState<string>("");
  const visibleHistory = cycleFilter
    ? card.history.filter((h) => String(h.evaluation_id) === cycleFilter)
    : card.history;

  /* -- The headline numbers describe the last appraisal that PRODUCED one.
        Reading the last row outright meant a draft cycle sitting above a rated
        one turned all three tiles to "not rated" while the table below listed
        the scores — the card contradicting itself on the same screen.

        `previous` is the rated cycle before that one, so the delta compares
        two appraisals rather than an appraisal against an empty draft. Where
        this cycle STANDS is a different question and still reads `card.current`,
        which is deliberately the newest cycle whatever state it is in. -- */
  const ratedHistory = card.history.filter(
    (h) => h.self_overall !== null || h.lead_overall !== null || h.final_overall !== null,
  );
  const latest = ratedHistory[ratedHistory.length - 1] ?? card.history[card.history.length - 1] ?? null;
  const previous = ratedHistory[ratedHistory.length - 2] ?? null;

  /* -- Their OWN section averages, from their own answers.
        This used to read `v_section_scores`, which is a DEPARTMENT average — on
        a page headed with somebody's name that reads as their profile and is
        not. -- */
  const sections = React.useMemo(() => {
    const bySection = new Map<
      QuestionSection,
      { self: number[]; lead: number[]; final: number[] }
    >();
    for (const q of card.questions) {
      const entry = bySection.get(q.section) ?? { self: [], lead: [], final: [] };
      if (q.self !== null) entry.self.push(q.self);
      if (q.lead !== null) entry.lead.push(q.lead);
      if (q.final !== null) entry.final.push(q.final);
      bySection.set(q.section, entry);
    }
    const mean = (xs: number[]) =>
      xs.length === 0 ? null : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100;

    return [...bySection.entries()]
      .map(([section, v]) => ({
        section,
        label: SECTION_LABELS[section],
        count: Math.max(v.self.length, v.lead.length, v.final.length),
        self: mean(v.self),
        lead: mean(v.lead),
        final: mean(v.final),
      }))
      .sort((a, b) => sectionRank(a.section) - sectionRank(b.section));
  }, [card.questions]);

  /* -- The gap per section. Only sections BOTH sides rated: a difference
        against a blank is not a difference, and drawing one would invent a
        disagreement out of a layer that never submitted. -- */
  const sectionGaps = React.useMemo(
    () =>
      sections
        .filter((s) => s.self !== null && s.lead !== null)
        .map((s) => ({
          section: s.section,
          label: s.label,
          self: s.self,
          lead: s.lead,
          delta: Math.round(((s.lead ?? 0) - (s.self ?? 0)) * 100) / 100,
        })),
    [sections],
  );

  const [gapsAsTable, setGapsAsTable] = React.useState(false);

  /* -- The radar's rows. Only sections at least one layer rated: an axis with
        nothing on it draws a zero-length spoke, which reads as "scored nothing
        here" rather than "not asked here" (P14-10 made the same call about
        KPI). Final is offered only where it DIFFERS from the lead — otherwise
        it lies exactly on the lead polygon and just thickens the line. -- */
  const radar = React.useMemo(
    () =>
      sections
        .filter((s) => s.self !== null || s.lead !== null || s.final !== null)
        .map((s) => ({
          section: s.label,
          self: s.self,
          lead: s.lead,
          final: s.final,
        })),
    [sections],
  );

  const radarHasFinal = radar.some((r) => r.final !== null && r.final !== r.lead);

  /* -- How their answers spread across the scale.
        Two averages that match can still be built from completely different
        answers — a steady 3.5 everywhere and a mix of 5s and 2s are the same
        mean and very different reviews. This is the panel that tells them
        apart, and it is the only place the SHAPE of somebody's rating shows. -- */
  const distribution = React.useMemo(() => {
    const bandOf = (v: number) => Math.min(Math.floor(v), 4);
    const counts = RATING_BANDS.map((band) => ({ band, self: 0, lead: 0 }));
    for (const q of card.questions) {
      if (q.self !== null) counts[bandOf(q.self)]!.self += 1;
      if (q.lead !== null) counts[bandOf(q.lead)]!.lead += 1;
    }
    return counts;
  }, [card.questions]);

  const distributionTotal = distribution.reduce((n, b) => n + b.self + b.lead, 0);

  /* -- The four numbers worth reading before any chart.
        "Agreed" is where both sides landed on the same score — the single
        clearest signal of whether this review is settled, and nothing on the
        page stated it. -- */
  const bothRated = card.questions.filter((q) => q.self !== null && q.lead !== null);
  const agreed = bothRated.filter((q) => q.self === q.lead).length;
  const widest = [...bothRated].sort(
    (a, b) => Math.abs((b.lead ?? 0) - (b.self ?? 0)) - Math.abs((a.lead ?? 0) - (a.self ?? 0)),
  )[0];
  const strongestSection = [...sections]
    .filter((s) => (s.final ?? s.lead ?? s.self) !== null)
    .sort((a, b) => (b.final ?? b.lead ?? b.self ?? 0) - (a.final ?? a.lead ?? a.self ?? 0))[0];

  /* -- What the scores actually say.
        The settled value per question is the final where one exists, else the
        lead's, else their own — the same precedence §11 uses to resolve a
        score, so this cannot disagree with the stored overall. -- */
  const settled = React.useCallback(
    (q: ScorecardQuestion) => q.final ?? q.lead ?? q.self,
    [],
  );

  const ranked = React.useMemo(
    () =>
      card.questions
        .filter((q) => settled(q) !== null)
        .sort((a, b) => (settled(b) ?? 0) - (settled(a) ?? 0)),
    [card.questions, settled],
  );

  const strengths = ranked.slice(0, 3);
  const focus = [...ranked].reverse().slice(0, 3);

  /* -- Where the two sides saw it differently. Variance is Lead − Self (§11),
        the same direction the collision view uses, so a person reading both
        screens sees the same sign. -- */
  const gaps = React.useMemo(
    () =>
      card.questions
        .filter((q) => q.self !== null && q.lead !== null)
        .map((q) => ({ ...q, delta: (q.lead ?? 0) - (q.self ?? 0) }))
        .filter((q) => Math.abs(q.delta) >= NOTABLE_GAP)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
    [card.questions],
  );

  const scoredCount = card.questions.filter((q) => settled(q) !== null).length;
  const waiting = card.current ? WAITING[card.current.status] : null;

  return (
    <div className="mx-auto w-full max-w-content space-y-5">
      {/* ---------- Identity and the three-layer verdict ---------- */}
      <header className="card-surface flex flex-wrap items-center justify-between gap-5 p-6">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden
            className="flex size-[62px] shrink-0 items-center justify-center rounded-pill bg-gradient-to-br from-self to-final text-display-sm font-semibold text-white"
          >
            {card.profile.initials}
          </span>
          <div className="min-w-0">
            <h1 className="text-display-md text-ink">{card.profile.name}</h1>
            <p className="text-body text-ink-muted">
              {[card.profile.designation, card.profile.department].filter(Boolean).join(" · ") ||
                "No department set"}
            </p>
            {card.profile.dateOfJoining ? (
              <p className="tabular text-body-sm text-ink-muted">
                Joined {formatDate(card.profile.dateOfJoining)}
              </p>
            ) : null}
          </div>
        </div>

        {latest ? (
          <div className="grid grid-cols-3 gap-2.5">
            <TierScore tier="self" value={latest.self_overall} />
            <TierScore tier="lead" value={latest.lead_overall} />
            <TierScore
              tier="final"
              value={latest.final_overall}
              delta={
                previous && latest.final_overall !== null && previous.final_overall !== null
                  ? latest.final_overall - previous.final_overall
                  : null
              }
            />
          </div>
        ) : null}
      </header>

      {card.history.length === 0 ? (
        <EmptyState
          title="Not in any cycle yet"
          body={
            isSelf
              ? "Your scorecard fills in as soon as you are included in a cycle — you will see your self, lead and final scores here as each one is recorded."
              : "This person has not been included in an evaluation cycle. Add them to one from Evaluation Cycles, and their scores will appear here as the cycle progresses."
          }
        />
      ) : (
        <>
          {/* ---------- Where this cycle stands ---------- */}
          {/* The card was a page of em dashes for anybody mid-cycle. Scores are
              the last thing to exist, so the state of the evaluation is what it
              has to say until they do. */}
          {card.current && waiting ? (
            <DashboardCard title={`${card.current.cycleName} · ${card.current.periodLabel}`}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-body font-medium text-ink">{waiting.who}</p>
                  <p className="mt-0.5 text-body-sm text-ink-muted">{waiting.what}</p>
                </div>
                <dl className="flex flex-wrap gap-x-6 gap-y-1 text-body-sm">
                  <Due label="Self due" value={card.current.selfDueOn} />
                  <Due label="Lead review due" value={card.current.leadDueOn} />
                  <Due label="Final due" value={card.current.mdDueOn} />
                </dl>
              </div>
              {/* §8's five visible stages, in the employee vocabulary — a raw
                  status enum is never shown to an employee (P7-6). */}
              <ProgressRail
                className="mt-4"
                status={card.current.status}
                audience={isSelf ? "employee" : "internal"}
              />
              <p className="mt-3 text-[11px] text-ink-muted">
                {scoredCount === 0
                  ? "No answers have been scored yet. The breakdown below fills in as each layer submits."
                  : `${scoredCount} rated ${scoredCount === 1 ? "question" : "questions"} so far.`}
              </p>
            </DashboardCard>
          ) : null}

          {/* ---------- Trend ----------
              Gated on RATED cycles, not on cycles. Four periods of which one
              carries a score draws a single dot adrift in three-quarters of
              empty axis — which reads as a broken chart rather than as a person
              with one appraisal behind them. N3-8's rule, applied to the row
              set the line is actually made of. */}
          {ratedHistory.length > 1 ? (
            <DashboardCard
              title="Overall score across cycles"
              action={
                <Button
                  variant="ghost"
                  className="min-h-11"
                  aria-pressed={asTable}
                  onClick={() => setAsTable((v) => !v)}
                >
                  {asTable ? "Chart" : "View as table"}
                </Button>
              }
            >
              {asTable ? null : (
                <TrendAreaChart
                  data={trend}
                  xKey="period"
                  series={[
                    { key: "self", label: "Self", color: "cyan" },
                    { key: "lead", label: "Lead", color: "pink" },
                    { key: "final", label: "Final", color: "primary" },
                  ]}
                />
              )}
              {asTable ? <HistoryTable history={card.history} /> : null}
            </DashboardCard>
          ) : null}

          {/* ---------- The four numbers, before any chart ----------
              A reader should be able to take the review in without parsing a
              single figure. These are the ones a conversation actually opens
              with, and every one of them was previously only derivable by
              reading the whole table at the bottom. */}
          {bothRated.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MiniStat
                label="Questions rated"
                value={String(card.questions.length)}
                hint="by at least one side"
              />
              <MiniStat
                label="Agreed exactly"
                value={`${agreed} of ${bothRated.length}`}
                hint={
                  bothRated.length > 0
                    ? `${Math.round((agreed / bothRated.length) * 100)}% of the form`
                    : undefined
                }
              />
              <MiniStat
                label="Widest difference"
                value={widest ? signed((widest.lead ?? 0) - (widest.self ?? 0)) : "—"}
                hint={widest?.text}
              />
              <MiniStat
                label="Strongest section"
                value={
                  strongestSection
                    ? formatScore(
                        strongestSection.final ?? strongestSection.lead ?? strongestSection.self,
                      )
                    : "—"
                }
                hint={strongestSection?.label}
              />
            </div>
          ) : null}

          {/* ---------- Shape, and spread ----------
              The radar answers "where is this person strong" in one glance;
              the distribution answers "what kind of rating is this" — a steady
              3.5 everywhere and a mix of 5s and 2s share a mean and are
              completely different reviews. Neither question was on the page. */}
          {radar.length >= 3 || distributionTotal > 0 ? (
            <div className="grid gap-5 lg:grid-cols-2">
              {radar.length >= 3 ? (
                <DashboardCard title="Section profile">
                  <SectionRadarChart
                    data={radar}
                    series={[
                      { key: "self", label: "Self", color: "cyan" },
                      { key: "lead", label: "Lead", color: "pink" },
                      ...(radarHasFinal
                        ? [{ key: "final", label: "Final", color: "primary" as const }]
                        : []),
                    ]}
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-ink-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden className="size-2.5 rounded-[2px] bg-self" />
                      Self
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden className="size-2.5 rounded-[2px] bg-lead" />
                      Lead
                    </span>
                    {radarHasFinal ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span aria-hidden className="size-2.5 rounded-[2px] bg-final" />
                        Final
                      </span>
                    ) : null}
                  </div>
                </DashboardCard>
              ) : null}

              {distributionTotal > 0 ? (
                <DashboardCard title="How the ratings were spread">
                  <table className="w-full text-left">
                    <caption className="sr-only">
                      Number of questions at each score band, self against lead.
                    </caption>
                    <thead>
                      <tr className="border-b border-rule text-body-sm text-ink-muted">
                        <th className="py-2 font-medium">Band</th>
                        <th className="py-2 font-medium">Self</th>
                        <th className="py-2 font-medium">Lead</th>
                      </tr>
                    </thead>
                    <tbody>
                      {distribution.map((b) => {
                        const max = Math.max(
                          1,
                          ...distribution.map((d) => Math.max(d.self, d.lead)),
                        );
                        return (
                          <tr key={b.band} className="border-b border-rule/60 last:border-0">
                            <td className="py-2 text-body text-ink">{b.band}</td>
                            <td className="py-2">
                              <CountBar tier="self" n={b.self} max={max} />
                            </td>
                            <td className="py-2">
                              <CountBar tier="lead" n={b.lead} max={max} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="mt-3 text-[11px] text-ink-muted">
                    A band counts questions, not people. 4-5 means the answer scored
                    between 4 and 5.
                  </p>
                </DashboardCard>
              ) : null}
            </div>
          ) : null}

          {/* ---------- Strengths and focus ---------- */}
          {ranked.length >= 2 ? (
            <div className="grid gap-5 lg:grid-cols-2">
              <DashboardCard title="Strongest">
                <QuestionList rows={strengths} settled={settled} tone="success" />
              </DashboardCard>
              <DashboardCard title="Where to focus">
                <QuestionList rows={focus} settled={settled} tone="warning" />
              </DashboardCard>
            </div>
          ) : null}

          {/* ---------- Where the two sides disagreed, by section ----------
              The one figure on this page that answers "did my lead and I see
              this the same way", which is the conversation the appraisal
              exists to have. §11 defines the gap as Lead − Self, so pink to
              the right means the lead rated higher and cyan to the left means
              the employee did — the reserved tier hues carrying exactly the
              meaning §13.1 gives them (UI-1's collision-chart exception).

              Diverging, so it needs a NEUTRAL midpoint and two hues, never a
              ramp: zero is agreement, and agreement is not a small amount of
              disagreement. Every bar is directly labelled, which is also what
              discharges the validator's contrast warning on cyan. */}
          {sectionGaps.length > 0 ? (
            <DashboardCard
              title="Where you and your lead agreed — and did not"
              action={
                <Button
                  variant="ghost"
                  className="min-h-11"
                  aria-pressed={gapsAsTable}
                  onClick={() => setGapsAsTable((v) => !v)}
                >
                  {gapsAsTable ? "Chart" : "View as table"}
                </Button>
              }
            >
              {gapsAsTable ? (
                <table className="w-full text-left">
                  <caption className="sr-only">
                    Difference between the lead&apos;s average and your own, by section.
                  </caption>
                  <thead>
                    <tr className="border-b border-rule text-body-sm text-ink-muted">
                      <th className="py-2 font-medium">Section</th>
                      <th className="py-2 font-medium">Self</th>
                      <th className="py-2 font-medium">Lead</th>
                      <th className="py-2 font-medium">Difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sectionGaps.map((g) => (
                      <tr key={g.section} className="border-b border-rule/60 last:border-0">
                        <td className="py-2 text-body text-ink">{g.label}</td>
                        <td className="tabular py-2 text-body text-self">{formatScore(g.self)}</td>
                        <td className="tabular py-2 text-body text-lead">{formatScore(g.lead)}</td>
                        <td className="tabular py-2 text-body text-ink">{signed(g.delta)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <>
                  <DivergingGapChart rows={sectionGaps} />
                  <p className="mt-4 text-body-sm text-ink-muted">
                    A difference is not a mistake — it is the part of the review worth
                    talking about.
                  </p>
                </>
              )}
            </DashboardCard>
          ) : null}

          {/* ---------- Section profile + verdict ---------- */}
          <div className="grid gap-5 lg:grid-cols-2">
            <DashboardCard
              title="By section"
              action={
                sections.length > 0 ? (
                  <Button
                    variant="ghost"
                    className="min-h-11"
                    aria-pressed={sectionsAsTable}
                    onClick={() => setSectionsAsTable((v) => !v)}
                  >
                    {sectionsAsTable ? "Bars" : "View as table"}
                  </Button>
                ) : undefined
              }
            >
              {sections.length === 0 ? (
                <p className="text-body-sm text-ink-muted">
                  Your section scores appear as soon as the first rated answers are submitted.
                </p>
              ) : sectionsAsTable ? (
                <table className="w-full">
                  <caption className="sr-only">Average score per section, by layer</caption>
                  <thead>
                    <tr>
                      {["Section", "Self", "Lead", "Final"].map((h) => (
                        <th key={h} scope="col" className="type-label py-2 text-left font-bold text-ink">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sections.map((s) => (
                      <tr key={s.section} className="border-t border-rule">
                        <th scope="row" className="py-2 text-left text-body font-normal text-ink">
                          {s.label}
                        </th>
                        <td className="tabular py-2 text-body text-self">{formatScore(s.self)}</td>
                        <td className="tabular py-2 text-body text-lead">{formatScore(s.lead)}</td>
                        <td className="tabular py-2 text-body text-final">{formatScore(s.final)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <ul className="space-y-4">
                  {sections.map((s) => (
                    <li key={s.section}>
                      <div className="mb-1.5 flex items-baseline justify-between gap-3">
                        <span className="truncate text-body-sm text-ink">{s.label}</span>
                        <span className="tabular shrink-0 text-body-sm text-ink-muted">
                          {formatScore(s.final ?? s.lead ?? s.self)}
                        </span>
                      </div>
                      {/* Three tracks, not one: the gap between layers is the
                          point, and a single bar hides exactly that. */}
                      <div className="space-y-1">
                        <SectionBar tier="self" value={s.self} />
                        <SectionBar tier="lead" value={s.lead} />
                        <SectionBar tier="final" value={s.final} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </DashboardCard>

            <DashboardCard title="Latest verdict">
              {latest ? (
                <>
                  <dl className="space-y-2.5">
                    <Row label="Cycle" value={`${latest.cycle_name} · ${latest.period_label}`} />
                    <Row
                      label="Composite"
                      value={`${formatScore(latest.final_overall)} / 5.00`}
                      emphasis
                    />
                    {/* §9: the decision is withheld when the cycle's policy says
                        so, and it says withheld rather than going blank — a gap
                        with no explanation reads as missing data. */}
                    <Row
                      label="Promotion"
                      value={
                        card.redacted ? "Not disclosed" : (latest.promotion_recommendation ?? "—")
                      }
                    />
                    <Row
                      label="Increment"
                      value={
                        card.redacted
                          ? "Not disclosed"
                          : latest.increment_pct !== null
                            ? `${latest.increment_pct}%${latest.increment_type ? ` · ${latest.increment_type}` : ""}`
                            : "—"
                      }
                    />
                  </dl>

                  {card.redacted ? (
                    <p className="mt-4 flex items-start gap-2 rounded-card bg-surface-mute p-3 text-body-sm text-ink-muted">
                      <EyeOff aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                      Under this cycle&apos;s disclosure policy you see the final score and the
                      decision, never the raw lead comments.
                    </p>
                  ) : null}
                </>
              ) : null}
            </DashboardCard>
          </div>

          {/* ---------- Where the two sides differed ---------- */}
          {gaps.length > 0 ? (
            <DashboardCard title="Where you and your lead saw it differently">
              <p className="mb-3 text-body-sm text-ink-muted">
                {gaps.length} {gaps.length === 1 ? "answer differs" : "answers differ"} by{" "}
                {NOTABLE_GAP} or more. A gap is not a mistake — it is the conversation worth having.
              </p>
              <ul className="divide-y divide-rule">
                {gaps.map((q) => (
                  <li key={q.questionId} className="flex items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-ink">{q.text}</span>
                      <span className="text-[11px] text-ink-muted">
                        {SECTION_LABELS[q.section]}
                      </span>
                    </span>
                    <span className={cn("tabular w-10 text-center text-body font-semibold", TIER_CLASSES.self.numeral)}>
                      {q.self}
                    </span>
                    <span className={cn("tabular w-10 text-center text-body font-semibold", TIER_CLASSES.lead.numeral)}>
                      {q.lead}
                    </span>
                    {/* The glyph carries the direction, never colour alone
                        (§13.8) — and green/red here describe movement, which is
                        the one thing they are allowed to mean (UI2-2). */}
                    <span
                      className={cn(
                        "flex w-16 items-center justify-end gap-0.5 text-body-sm font-medium",
                        q.delta > 0 ? "text-success" : "text-critical",
                      )}
                    >
                      {q.delta > 0 ? (
                        <TrendingUp aria-hidden className="size-3.5" />
                      ) : (
                        <TrendingDown aria-hidden className="size-3.5" />
                      )}
                      {q.delta > 0 ? "+" : ""}
                      {q.delta}
                    </span>
                  </li>
                ))}
              </ul>
            </DashboardCard>
          ) : null}

          {/* ---------- Every answer ---------- */}
          {card.questions.length > 0 ? (
            <DashboardCard title="Every rated answer">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      {["Question", "Self", "Lead", "Final"].map((h) => (
                        <th key={h} scope="col" className="type-label py-2 text-left font-bold text-ink">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {card.questions.map((q) => (
                      <tr key={q.questionId} className="border-t border-rule">
                        <td className="py-2 pr-4 text-body text-ink">
                          {q.text}
                          <span className="block text-[11px] text-ink-muted">
                            {SECTION_LABELS[q.section]}
                          </span>
                        </td>
                        <td className="tabular py-2 text-body text-self">{formatScore(q.self)}</td>
                        <td className="tabular py-2 text-body text-lead">{formatScore(q.lead)}</td>
                        <td className="tabular py-2 text-body font-medium text-final">
                          {formatScore(q.final)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DashboardCard>
          ) : null}

          {/* ---------- Every cycle ---------- */}
          <DashboardCard
            title="Every cycle"
            action={
              /* -- One cycle, or all of them.
                    A scorecard is read for two different reasons: "how has this
                    person done over time", which wants every row, and "what
                    happened in THIS appraisal", which is the question somebody
                    has five minutes before the conversation. The picker is what
                    lets one screen answer both. Hidden with one cycle, where it
                    would be a control with a single option. -- */
              card.history.length > 1 ? (
                <label className="flex items-center gap-2 text-body-sm text-ink">
                  <span className="text-ink-muted">Show</span>
                  <select
                    value={cycleFilter}
                    onChange={(e) => setCycleFilter(e.target.value)}
                    className="min-h-9 rounded-input border border-rule bg-surface px-2 text-body-sm text-ink"
                  >
                    <option value="">All cycles</option>
                    {card.history.map((h) => (
                      <option key={h.evaluation_id} value={String(h.evaluation_id)}>
                        {h.period_label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    {["Period", "Self", "Lead", "Final", "Promotion", "Increment %"].map((h) => (
                      <th key={h} scope="col" className="type-label py-2 text-left font-bold text-ink">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleHistory.map((h) => (
                    <tr key={h.evaluation_id} className="border-t border-rule">
                      <td className="py-2 text-body text-ink">{h.period_label}</td>
                      <td className="tabular py-2 text-body text-ink">{formatScore(h.self_overall)}</td>
                      <td className="tabular py-2 text-body text-ink">{formatScore(h.lead_overall)}</td>
                      <td className="tabular py-2 text-body font-medium text-ink">
                        {formatScore(h.final_overall)}
                      </td>
                      <td className="py-2 text-body text-ink">
                        {card.redacted ? "Not disclosed" : (h.promotion_recommendation ?? "—")}
                      </td>
                      <td className="tabular py-2 text-body text-ink">
                        {card.redacted ? "—" : (h.increment_pct ?? "—")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DashboardCard>
        </>
      )}
    </div>
  );
}

/* ---------- Small parts ---------- */

function HistoryTable({ history }: { history: Scorecard["history"] }) {
  return (
    <table className="w-full">
      <caption className="sr-only">Overall score for every cycle</caption>
      <thead>
        <tr>
          {["Period", "Self", "Lead", "Final"].map((h) => (
            <th key={h} scope="col" className="type-label py-2 text-left font-bold text-ink">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {history.map((h) => (
          <tr key={h.evaluation_id} className="border-t border-rule">
            <th scope="row" className="py-2 text-left text-body font-normal text-ink">
              {h.period_label}
            </th>
            <td className="tabular py-2 text-body text-self">{formatScore(h.self_overall)}</td>
            <td className="tabular py-2 text-body text-lead">{formatScore(h.lead_overall)}</td>
            <td className="tabular py-2 text-body text-final">{formatScore(h.final_overall)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function QuestionList({
  rows,
  settled,
  tone,
}: {
  rows: ScorecardQuestion[];
  settled: (q: ScorecardQuestion) => number | null;
  tone: "success" | "warning";
}) {
  const Icon = tone === "success" ? Sparkles : Target;
  return (
    <ul className="space-y-2.5">
      {rows.map((q) => (
        <li key={q.questionId} className="flex items-center gap-3">
          <Icon
            aria-hidden
            className={cn("size-4 shrink-0", tone === "success" ? "text-success" : "text-warning")}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body text-ink">{q.text}</span>
            <span className="text-[11px] text-ink-muted">{SECTION_LABELS[q.section]}</span>
          </span>
          <span className="tabular shrink-0 text-body-lg font-semibold text-ink">
            {formatScore(settled(q))}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Due({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[11px] text-ink-muted">{label}</dt>
      <dd className="tabular text-body-sm text-ink">{formatDate(value)}</dd>
    </div>
  );
}

/**
 * One layer's headline score. An absent score is an em dash, never 0.00 —
 * missing is not zero (§11, P7-9), and a dashboard reading 0.00 for an
 * unstarted appraisal is the kind of thing people escalate about.
 */
function TierScore({
  tier,
  value,
  delta,
}: {
  tier: "self" | "lead" | "final";
  value: number | null;
  delta?: number | null;
}) {
  const classes = TIER_CLASSES[tier];
  return (
    <div className={cn("rounded-card px-4 py-2.5 text-center", classes.chip)}>
      <div className="text-[11px] font-medium">{TIER_LABELS[tier]}</div>
      <div className="tabular text-display-sm font-semibold">
        {value === null ? "—" : value.toFixed(2)}
      </div>
      {/* Green up / red down is the TREND colour and never a tier (UI2-2). It
          appears here only because it describes movement, not a layer. */}
      {delta !== null && delta !== undefined && delta !== 0 ? (
        <div
          className={cn(
            "mt-0.5 flex items-center justify-center gap-0.5 text-[10px] font-medium",
            delta > 0 ? "text-success" : "text-critical",
          )}
        >
          {delta > 0 ? (
            <TrendingUp aria-hidden className="size-3" />
          ) : (
            <TrendingDown aria-hidden className="size-3" />
          )}
          {delta > 0 ? "+" : ""}
          {delta.toFixed(2)} vs last
        </div>
      ) : (
        <div className="mt-0.5 flex items-center justify-center gap-0.5 text-[10px] text-ink-muted">
          <Minus aria-hidden className="size-3" />
          {value === null ? "not rated" : "first cycle"}
        </div>
      )}
    </div>
  );
}

/**
 * One headline number with its label above and its context below.
 *
 * Deliberately not `MetricWidget`: that carries a trend pill and a sparkline,
 * neither of which exists here, and a widget rendering half its parts reads as
 * something that failed to load rather than as something smaller.
 */
function MiniStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string | null;
}) {
  return (
    <div className="card-surface p-4">
      <p className="text-[11px] uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="tabular mt-1 text-h3 text-ink">{value}</p>
      {hint ? <p className="mt-1 line-clamp-2 text-body-sm text-ink-muted">{hint}</p> : null}
    </div>
  );
}

/** A count as a bar plus the number. Never the bar alone — a length is not a value. */
function CountBar({ tier, n, max }: { tier: "self" | "lead"; n: number; max: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 min-w-16 flex-1 overflow-hidden rounded-pill bg-surface-mute">
        <div
          className={cn("h-full rounded-pill", tier === "self" ? "bg-self" : "bg-lead")}
          style={{ width: `${max > 0 ? (n / max) * 100 : 0}%` }}
        />
      </div>
      <span className="tabular w-6 shrink-0 text-right text-body-sm text-ink">{n}</span>
    </div>
  );
}

/** A signed score, so a reader never has to work out which way a gap runs. */
function signed(n: number): string {
  if (n === 0) return "0.00";
  return `${n > 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}`;
}

/**
 * Diverging bars: how far the lead's section average sits from the employee's.
 *
 * Hand-built rather than charted. A diverging bar is a centre line and two
 * rectangles, and Recharts spends more effort being talked out of its axis
 * defaults than the geometry costs to state directly — which also keeps the
 * 2px surface gap and the rounded data-end under our control rather than the
 * library's.
 *
 * The domain is symmetric and taken from the largest gap present, so the two
 * sides are always comparable in length. Floored at 1 point: without it, a
 * person whose worst disagreement is 0.2 gets a full-width bar that reads as a
 * chasm.
 */
function DivergingGapChart({
  rows,
}: {
  rows: { section: string; label: string; self: number | null; lead: number | null; delta: number }[];
}) {
  const bound = Math.max(1, ...rows.map((r) => Math.abs(r.delta)));

  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const pct = (Math.abs(r.delta) / bound) * 50;
        const higher = r.delta > 0;
        return (
          <div key={r.section}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="truncate text-body-sm text-ink">{r.label}</span>
              <span className="tabular shrink-0 text-body-sm text-ink">
                {formatScore(r.self)} → {formatScore(r.lead)}
              </span>
            </div>

            <div className="relative h-6">
              {/* The centre line IS the neutral midpoint. A diverging scale
                  needs one, and it must not be a third hue. */}
              <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-rule" />

              {r.delta === 0 ? (
                <div className="absolute inset-y-0 left-1/2 flex -translate-x-1/2 items-center">
                  <span className="tabular rounded-pill bg-surface-mute px-2 py-0.5 text-[11px] text-ink-muted">
                    agreed
                  </span>
                </div>
              ) : (
                <div
                  className={cn(
                    "absolute inset-y-1 flex items-center",
                    higher ? "left-1/2 justify-start" : "right-1/2 justify-end",
                  )}
                  style={{ width: `${pct}%` }}
                >
                  <div
                    className={cn(
                      "h-full w-full",
                      // 4px rounded data-end, square against the baseline.
                      higher ? "rounded-r-[4px] bg-lead" : "rounded-l-[4px] bg-self",
                    )}
                  />
                </div>
              )}

              {/* Direct label, outside the bar so it is legible whatever the
                  fill does — and the relief the palette validator requires. */}
              {r.delta === 0 ? null : (
                <div
                  className={cn(
                    "absolute inset-y-0 flex items-center px-2",
                    higher ? "left-1/2" : "right-1/2",
                  )}
                  style={higher ? { marginLeft: `${pct}%` } : { marginRight: `${pct}%` }}
                >
                  <span className="tabular text-[11px] font-medium text-ink">
                    {signed(r.delta)}
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Legend — identity is never colour alone (§13.8). */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-rule pt-3 text-[11px] text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[2px] bg-self" />
          You rated higher
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[2px] bg-lead" />
          Your lead rated higher
        </span>
      </div>
    </div>
  );
}

function SectionBar({ tier, value }: { tier: "self" | "lead" | "final"; value: number | null }) {
  const classes = TIER_CLASSES[tier];
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-mute"
      role="img"
      aria-label={`${TIER_LABELS[tier]} ${value === null ? "not rated" : value.toFixed(2)} out of 5`}
    >
      <div
        className={cn("h-full rounded-pill transition-[width] duration-500", classes.fill)}
        style={{ width: `${((value ?? 0) / 5) * 100}%` }}
      />
    </div>
  );
}

function Row({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-body-sm text-ink-muted">{label}</dt>
      <dd
        className={cn(
          "tabular text-right text-body",
          emphasis ? "font-semibold text-final" : "text-ink",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
