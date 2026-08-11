"use client";

/** The scorecard. Where it stands, how it scored, and what moved between cycles. */

import * as React from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  EyeOff,
  Handshake,
  Layers,
  Minus,
  Sparkles,
  Split,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { ChartFigure } from "@/components/appraise/chart-figure";
import {
  GroupedBarChart,
  RATING_BANDS,
  ScoreComboChart,
  SectionRadarChart,
  StatusDonutChart,
  TIER_CHART_COLORS,
  ratingBandColor,
} from "@/components/appraise/charts";
import { DashboardCard } from "@/components/appraise/metric-widget";
import { ProgressRail } from "@/components/appraise/progress-rail";
import { EmptyState } from "@/components/appraise/states";
import { SCALE_0_5_LABELS, TIER_CLASSES, TIER_LABELS } from "@/components/appraise/tier";
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
  /* -- Every chart carries a table fallback, and it is not a nicety.
        The palette validator reports cyan below 3:1 on a white surface, which
        obligates relief rather than a different hue — and a polygon is
        unreadable to a screen reader whatever its contrast. These are somebody's
        appraisal numbers, so the exact figures are always one press away.
        `ChartFigure` owns that toggle now; nothing here holds it. -- */

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

  /* -- What the scores actually say.
        The settled value per question is the final where one exists, else the
        lead's, else their own — the same precedence §11 uses to resolve a
        score, so this cannot disagree with the stored overall. -- */
  const settled = React.useCallback((q: ScorecardQuestion) => q.final ?? q.lead ?? q.self, []);

  /* -- The same spread, as ONE series, for the donut.
        A ring can only carry one series honestly — two concentric rings read as
        a part-to-whole relationship they do not have. So the donut shows the
        SETTLED answer per question, which is the one figure that is a whole:
        every rated question lands in exactly one band, and the bands sum to the
        form.

        Colour comes from the band's own position on the scale, never from its
        row number (P29-3): the bands are ORDERED, so they take the single-hue
        ordinal ramp. A reader learns "darker is higher" once. -- */
  const settledBands = React.useMemo(() => {
    const counts = RATING_BANDS.map((band) => ({
      name: band,
      value: 0,
      fill: ratingBandColor(band),
    }));
    for (const q of card.questions) {
      const v = settled(q);
      if (v === null) continue;
      counts[Math.min(Math.floor(v), RATING_BANDS.length - 1)]!.value += 1;
    }
    // A band nobody landed in is not a zero-width slice — it is absent. A donut
    // rendering five arcs of which three are invisible reads as a broken ring.
    return counts.filter((c) => c.value > 0);
  }, [card.questions, settled]);

  const settledTotal = settledBands.reduce((n, b) => n + b.value, 0);

  /* -- A ring needs something to divide.
        With every answer in one band there is no part-to-whole relationship to
        draw, and a single 360° arc is a circle pretending to be a chart. The
        card says the fact in words instead. -- */
  const showRatingMix = settledBands.length > 1;

  /* -- Appraisal history as columns and a line.
        Self and lead are the two OPINIONS, drawn as columns; final is the
        settled answer, drawn over them as a line. All three are the same
        measure on the same 0–5 scale, which is the only condition under which
        combining the two forms says anything true. -- */
  const comboRows = React.useMemo(
    () =>
      ratedHistory.map((h) => ({
        period: h.period_label,
        self: h.self_overall,
        lead: h.lead_overall,
        final: h.final_overall,
      })),
    [ratedHistory],
  );

  /* -- Sections as grouped bars, self against lead.
        Grouped and not stacked: self 4 and lead 3 is not a section worth 7. -- */
  const sectionBars = React.useMemo(
    () =>
      sections
        .filter((s) => s.self !== null || s.lead !== null || s.final !== null)
        .map((s) => ({ label: s.label, self: s.self, lead: s.lead, final: s.final })),
    [sections],
  );

  const sectionBarsHaveFinal = sectionBars.some((s) => s.final !== null && s.final !== s.lead);

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

  /* -- The one number the page is about.
        Final where the MD has recorded one, else the lead's — §11's precedence
        again, and §11's own instruction that where a single headline figure is
        needed it is the lead average, LABELLED as such. The caption under it
        says which layer it came from, so the hero never implies an authority
        the number does not have. -- */
  const headline = latest?.final_overall ?? latest?.lead_overall ?? latest?.self_overall ?? null;
  const headlineLayer: "final" | "lead" | "self" | null =
    latest?.final_overall != null
      ? "final"
      : latest?.lead_overall != null
        ? "lead"
        : latest?.self_overall != null
          ? "self"
          : null;

  const headlinePrev =
    previous?.final_overall ?? previous?.lead_overall ?? previous?.self_overall ?? null;
  const headlineDelta =
    headline !== null && headlinePrev !== null ? headline - headlinePrev : null;

  return (
    <div className="mx-auto w-full max-w-content space-y-5">
      {/* ---------- Identity, and the headline ----------
          ON THE CARD SURFACE IN BOTH THEMES, and that is a correctness call
          rather than a preference.

          The obvious premium treatment here is the dashboard's `night` card —
          `bg-ink` with inverted text. It cannot be used: in dark mode `--ink` IS
          the light text colour (#CCD0CF), so a night card flips to a pale slab,
          and the tier dots that carry identity on it are #22D3EE cyan on light
          grey — about 1.1:1, invisible. A hero whose whole job is to say which
          layer produced the number cannot have its layer marks disappear in one
          of the two themes.

          So the weight comes from type and space, and the colour from a single
          soft wash keyed to the tier the headline came from — which every other
          tier surface on the page already handles correctly in both themes. */}
      <header className="card-surface relative overflow-hidden p-6 sm:p-7">
        {headline !== null ? (
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute -right-20 -top-24 size-64 rounded-pill opacity-40 blur-3xl",
              headlineLayer === "final"
                ? "bg-final-tint"
                : headlineLayer === "lead"
                  ? "bg-lead-tint"
                  : "bg-self-tint",
            )}
          />
        ) : null}

        <div className="relative flex flex-wrap items-start justify-between gap-x-8 gap-y-6">
          <div className="flex min-w-0 items-center gap-4">
            <span
              aria-hidden
              className="flex size-[64px] shrink-0 items-center justify-center rounded-pill bg-gradient-to-br from-self to-final text-display-sm font-semibold text-white"
            >
              {card.profile.initials}
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-display-md text-ink">{card.profile.name}</h1>
              <p className="text-body text-ink-muted">
                {[card.profile.designation, card.profile.department].filter(Boolean).join(" · ") ||
                  "No department set"}
              </p>
              {card.profile.dateOfJoining ? (
                <p className="tabular mt-1 inline-flex items-center gap-1.5 text-body-sm text-ink-muted">
                  <CalendarDays aria-hidden className="size-3.5" />
                  Joined {formatDate(card.profile.dateOfJoining)}
                </p>
              ) : null}
            </div>
          </div>

          {headline !== null ? (
            <div className="flex flex-wrap items-end gap-x-8 gap-y-5">
              <div>
                {/* §11: where a single headline figure is needed, it is the
                    lead average and it is LABELLED as such. The caption names
                    the layer, so the number never claims an authority it does
                    not have. */}
                <p className="text-body-sm text-ink-muted">
                  {TIER_LABELS[headlineLayer ?? "final"]} score
                  {latest ? ` · ${latest.period_label}` : ""}
                </p>
                <p className="flex items-baseline gap-1.5">
                  <span className="text-display-lg leading-none text-ink">
                    {headline.toFixed(2)}
                  </span>
                  <span className="text-body text-ink-muted">/ 5.00</span>
                </p>
                {/* §6's wording, from the constant — never retyped, and never
                    paraphrased (§17). "Nearest" is doing real work: an average
                    of 4.20 is close to the 4 anchor, not equal to it. */}
                <p className="mt-2 inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="rounded-pill bg-surface-mute px-2.5 py-0.5 text-body-sm font-medium text-ink">
                    Nearest: {nearestBand(headline)}
                  </span>
                  <Delta value={headlineDelta} />
                </p>
              </div>

              {/* The three layers, small, beside the headline rather than
                  instead of it. Which side said what is the second question on
                  this page; what the score IS, is the first. */}
              <div className="flex gap-2.5">
                <HeroTier tier="self" value={latest?.self_overall ?? null} />
                <HeroTier tier="lead" value={latest?.lead_overall ?? null} />
                <HeroTier tier="final" value={latest?.final_overall ?? null} />
              </div>
            </div>
          ) : null}
        </div>
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
                  <Due label="Manager review due" value={card.current.leadDueOn} />
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

          {/* ---------- The four numbers, before any chart ----------
              A reader should be able to take the review in without parsing a
              single mark. These are the figures a conversation actually opens
              with, and every one of them was previously only derivable by
              reading the whole table at the bottom. */}
          {bothRated.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MiniStat
                icon={<Layers className="size-4" />}
                accent="primary"
                label="Questions rated"
                value={String(card.questions.length)}
                hint="answered by at least one side"
              />
              <MiniStat
                icon={<Handshake className="size-4" />}
                accent="green"
                label="Agreed exactly"
                value={`${Math.round((agreed / bothRated.length) * 100)}%`}
                hint={`${agreed} of ${bothRated.length} both sides rated`}
                meter={agreed / bothRated.length}
              />
              {/* NOT amber. Amber reads as "needs attention", and §11 makes the
                  gap a reporting figure rather than a verdict — the same call
                  P29-5 made about lead variance. A lead who rated two points
                  above is not a problem to be fixed, they are a conversation to
                  be had, and a warning colour on this tile would tell the
                  employee their own review is defective. */}
              <MiniStat
                icon={<Split className="size-4" />}
                accent="primary"
                label="Widest difference"
                value={widest ? signed((widest.lead ?? 0) - (widest.self ?? 0)) : "—"}
                hint={widest?.text}
              />
              <MiniStat
                icon={<Sparkles className="size-4" />}
                accent="cyan"
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

          {/* ---------- Appraisals over time ----------
              Built from RATED cycles, never from cycles. A draft nobody has
              opened is not a period with a score of nothing, and including one
              would put an empty slot in the middle of somebody's history (N3-8,
              §11).

              Columns are the two opinions, the line is the settled answer. One
              axis, fixed to the instrument's own 0–5 — see the note on
              ScoreComboChart for why that matters more here than anywhere.

              IT RENDERS FROM THE FIRST CYCLE, and the title changes rather than
              the card disappearing. A trend LINE through one point would be
              dishonest, but a column pair with the recorded answer marked on it
              is a real reading of one appraisal — and hiding the panel until
              somebody's second year is how a new joiner's scorecard ends up
              looking half-built. */}
          {comboRows.length >= 1 ? (
            <DashboardCard
              title={comboRows.length > 1 ? "Appraisals over time" : "This appraisal, by layer"}
            >
              <p className="-mt-2 mb-1 max-w-prose text-body-sm text-ink-muted">
                {comboRows.length > 1
                  ? "What each side scored in every cycle, and the answer that was recorded."
                  : "What each side scored, and the answer that was recorded. A second cycle turns this into a trend."}
              </p>
              <ChartFigure
                caption="Overall score by cycle and layer"
                rows={comboRows}
                columns={[
                  { header: "Cycle", cell: (r) => r.period },
                  { header: "Self", cell: (r) => formatScore(r.self), align: "right" },
                  { header: "Manager", cell: (r) => formatScore(r.lead), align: "right" },
                  { header: "Final", cell: (r) => formatScore(r.final), align: "right" },
                ]}
              >
                <ScoreComboChart
                  data={comboRows}
                  xKey="period"
                  bars={[
                    { key: "self", label: "Self", color: TIER_CHART_COLORS.self },
                    { key: "lead", label: "Manager", color: TIER_CHART_COLORS.lead },
                  ]}
                  line={{ key: "final", label: "Final", color: TIER_CHART_COLORS.final }}
                />
                <TierLegend showFinal lineFinal />
              </ChartFigure>
            </DashboardCard>
          ) : null}

          {/* ---------- Shape, and spread ----------
              The radar answers "where is this person strong" in one glance;
              the distribution answers "what kind of rating is this" — a steady
              3.5 everywhere and a mix of 5s and 2s share a mean and are
              completely different reviews. Neither question was on the page. */}
          {radar.length >= 3 || showRatingMix ? (
            <div className="grid gap-5 lg:grid-cols-5">
              {radar.length >= 3 ? (
                <DashboardCard
                  title="Section profile"
                  className={showRatingMix ? "lg:col-span-3" : "lg:col-span-5"}
                >
                  <p className="-mt-2 mb-1 max-w-prose text-body-sm text-ink-muted">
                    Two polygons sitting on top of each other mean the review is settled. One
                    pulled in on a spoke is where the conversation is.
                  </p>
                  <ChartFigure
                    caption="Average score per section, by layer"
                    rows={sections}
                    columns={[
                      { header: "Section", cell: (s) => s.label },
                      { header: "Self", cell: (s) => formatScore(s.self), align: "right" },
                      { header: "Manager", cell: (s) => formatScore(s.lead), align: "right" },
                      { header: "Final", cell: (s) => formatScore(s.final), align: "right" },
                    ]}
                  >
                    <SectionRadarChart
                      data={radar}
                      height={320}
                      series={[
                        { key: "self", label: "Self", color: TIER_CHART_COLORS.self },
                        { key: "lead", label: "Manager", color: TIER_CHART_COLORS.lead },
                        ...(radarHasFinal
                          ? [{ key: "final", label: "Final", color: TIER_CHART_COLORS.final }]
                          : []),
                      ]}
                    />
                    <TierLegend showFinal={radarHasFinal} />
                  </ChartFigure>
                </DashboardCard>
              ) : null}

              {/* Not a second view of the radar: the radar says WHERE the
                  scores are, this says what KIND of review it is. A steady 3.5
                  everywhere and a mix of 5s and 2s share a mean and are
                  completely different appraisals — the ring is the only thing
                  on the page that tells them apart. */}
              {showRatingMix ? (
                /* Takes the whole row when there is no radar beside it. A
                   two-fifths card floating against an empty three-fifths reads
                   as something that failed to load. */
                <DashboardCard
                  title="Rating mix"
                  className={radar.length >= 3 ? "lg:col-span-2" : "lg:col-span-5"}
                >
                  <p className="-mt-2 mb-1 text-body-sm text-ink-muted">
                    Every rated answer, by the score it settled at.
                  </p>
                  {/* Capped so the ring and its key stay a readable block when
                      this card takes the full row on its own. */}
                  <div className="mx-auto w-full max-w-[340px]">
                    <StatusDonutChart
                      data={settledBands}
                      height={200}
                      centerValue={String(settledTotal)}
                      centerLabel={settledTotal === 1 ? "answer" : "answers"}
                    />
                  </div>
                  <p className="mt-3 text-body-sm text-ink-muted">
                    A band counts questions, not people. Darker is a higher score.
                  </p>
                </DashboardCard>
              ) : null}
            </div>
          ) : null}

          {/* ---------- Section scores, as bars ----------
              The radar carries shape; this carries VALUE. A polygon is read by
              area and area is the one thing people misjudge, so the same
              numbers appear a second time on a common baseline where two
              near-equal sections can actually be told apart — and every bar is
              directly labelled, which is what discharges the validator's
              contrast warning on cyan. */}
          {sectionBars.length > 0 ? (
            <DashboardCard title="Score by section">
              <ChartFigure
                caption="Average score per section, by layer"
                rows={sectionBars}
                columns={[
                  { header: "Section", cell: (s) => s.label },
                  { header: "Self", cell: (s) => formatScore(s.self), align: "right" },
                  { header: "Manager", cell: (s) => formatScore(s.lead), align: "right" },
                  { header: "Final", cell: (s) => formatScore(s.final), align: "right" },
                ]}
              >
                <GroupedBarChart
                  data={sectionBars}
                  labelKey="label"
                  series={[
                    { key: "self", label: "Self", color: TIER_CHART_COLORS.self },
                    { key: "lead", label: "Manager", color: TIER_CHART_COLORS.lead },
                    ...(sectionBarsHaveFinal
                      ? [{ key: "final", label: "Final", color: TIER_CHART_COLORS.final }]
                      : []),
                  ]}
                />
                <TierLegend showFinal={sectionBarsHaveFinal} />
              </ChartFigure>
            </DashboardCard>
          ) : null}

          {/* ---------- Strengths and focus ----------
              Ranked by the SETTLED value, so the two lists cannot disagree with
              the stored overall. Three each: a "top ten" out of thirty-eight
              questions is a list, not a finding. */}
          {ranked.length >= 2 ? (
            <div className="grid items-start gap-5 lg:grid-cols-2">
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
            <DashboardCard title="Where you and your lead agreed — and did not">
              {/* One toggle component for every chart on the page. This card
                  carried its own `useState` and its own hand-built table, which
                  is how two switches that do the same thing end up looking and
                  behaving differently. */}
              <ChartFigure
                caption="Difference between the lead's section average and your own"
                rows={sectionGaps}
                columns={[
                  { header: "Section", cell: (g) => g.label },
                  { header: "Self", cell: (g) => formatScore(g.self), align: "right" },
                  { header: "Manager", cell: (g) => formatScore(g.lead), align: "right" },
                  { header: "Difference", cell: (g) => signed(g.delta), align: "right" },
                ]}
              >
                <DivergingGapChart rows={sectionGaps} />
                <p className="mt-4 text-body-sm text-ink-muted">
                  A difference is not a mistake — it is the part of the review worth talking
                  about.
                </p>
              </ChartFigure>
            </DashboardCard>
          ) : null}

          {/* ---------- The verdict, beside where the two sides differed ----------
              Deliberately adjacent: the recorded outcome and the questions it
              was least settled on are the two halves of the same conversation,
              and reading one without the other is how a review turns into a
              number nobody can account for. */}
          <div className="grid items-start gap-5 lg:grid-cols-2">
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

            {/* ---------- Where the two sides differed ----------
                Renders even when nothing differs, and says so. "No answer
                differs by 2 or more" is a real finding about a review — a card
                that simply vanishes leaves the reader unsure whether it was
                checked. */}
            <DashboardCard title="Where you and your lead saw it differently">
              {bothRated.length === 0 ? (
                <p className="text-body-sm text-ink-muted">
                  This appears once both sides have rated the same questions.
                </p>
              ) : gaps.length === 0 ? (
                <p className="flex items-start gap-2 rounded-card bg-success-tint p-3 text-body-sm text-ink">
                  <Handshake aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                  No answer differs by {NOTABLE_GAP} or more. On the {bothRated.length} questions
                  both sides rated, this review is settled.
                </p>
              ) : (
                <>
                  <p className="mb-3 text-body-sm text-ink-muted">
                    {gaps.length} {gaps.length === 1 ? "answer differs" : "answers differ"} by{" "}
                    {NOTABLE_GAP} or more. A gap is not a mistake — it is the conversation worth
                    having.
                  </p>
                  <ul className="divide-y divide-rule">
                    {gaps.map((q) => (
                      <li key={q.questionId} className="flex items-center gap-3 py-2.5">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body text-ink">{q.text}</span>
                          <span className="text-body-sm text-ink-muted">
                            {SECTION_LABELS[q.section]}
                          </span>
                        </span>
                        <ScorePip tier="self" value={q.self} />
                        <ScorePip tier="lead" value={q.lead} />
                        {/* The glyph carries the direction, never colour alone
                            (§13.8) — and green/red here describe movement,
                            which is the one thing they may mean (UI2-2). */}
                        <span
                          className={cn(
                            "tabular flex w-14 items-center justify-end gap-0.5 text-body-sm font-medium",
                            q.delta > 0 ? "text-success" : "text-critical",
                          )}
                        >
                          {q.delta > 0 ? (
                            <ArrowUpRight aria-hidden className="size-3.5" />
                          ) : (
                            <ArrowDownRight aria-hidden className="size-3.5" />
                          )}
                          {signed(q.delta)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </DashboardCard>
          </div>

          {/* ---------- Every answer ----------
              The one exhaustive list on the page, and the only place a specific
              question can be looked up. The three-track sparkbar beside each
              row is what makes it scannable: a reader picking out the rows
              where the tracks are ragged has found every disagreement without
              reading a single number. */}
          {card.questions.length > 0 ? (
            <DashboardCard title="Every rated answer">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <caption className="sr-only">
                    Every question at least one side rated, with each layer&apos;s score.
                  </caption>
                  <thead>
                    <tr className="border-b border-rule">
                      <th scope="col" className="type-label py-2 text-left font-bold text-ink">
                        Question
                      </th>
                      <th scope="col" className="type-label w-[168px] py-2 text-left font-bold text-ink">
                        Profile
                      </th>
                      {["Self", "Manager", "Final"].map((h) => (
                        <th
                          key={h}
                          scope="col"
                          className="type-label w-16 py-2 text-right font-bold text-ink"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {card.questions.map((q) => (
                      <tr
                        key={q.questionId}
                        className="border-t border-rule transition-colors duration-hover hover:bg-surface-mute"
                      >
                        <td className="py-2.5 pr-4 text-body text-ink">
                          {q.text}
                          <span className="block text-body-sm text-ink-muted">
                            {SECTION_LABELS[q.section]}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4">
                          {/* Decorative: the three figures are in the same row,
                              so labelling each track makes a reader hear the
                              row twice. */}
                          <div className="space-y-1">
                            <SectionBar decorative tier="self" value={q.self} />
                            <SectionBar decorative tier="lead" value={q.lead} />
                            <SectionBar decorative tier="final" value={q.final} />
                          </div>
                        </td>
                        <td className="tabular py-2.5 text-right text-body text-ink">
                          {formatScore(q.self)}
                        </td>
                        <td className="tabular py-2.5 text-right text-body text-ink">
                          {formatScore(q.lead)}
                        </td>
                        <td className="tabular py-2.5 text-right text-body font-medium text-ink">
                          {formatScore(q.final)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TierLegend showFinal className="mt-4" />
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
                    {["Period", "Self", "Manager", "Final", "Promotion", "Increment %"].map((h) => (
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

/**
 * The nearest anchor word on the 0–5 scale.
 *
 * §6's wording, read from `SCALE_0_5_LABELS` rather than retyped — §6 calls it
 * "fixed wording — do not paraphrase" and §17 forbids improving anything that
 * came from the source forms. P7-4 made the constant the single source and a
 * test asserts it against the constitution itself.
 *
 * "Nearest" is doing real work in the caption that accompanies this: an average
 * of 4.20 is not literally "Effective (Exceeds objective)", it is close to it,
 * and a badge that stated the anchor flatly would be claiming a precision the
 * mean does not have.
 */
function nearestBand(value: number): string {
  const index = Math.min(SCALE_0_5_LABELS.length - 1, Math.max(0, Math.round(value)));
  return SCALE_0_5_LABELS[index]!.word;
}

/**
 * Movement since the previous rated cycle.
 *
 * Green up / red down is the TREND colour and never a tier (UI2-2) — it appears
 * here only because it describes change, not a layer. The arrow carries the
 * direction too, so the sign is never colour alone (§13.8).
 *
 * A first cycle says "first cycle" rather than "0.00": no movement and no
 * previous figure to move from are different facts, and §11 is explicit that
 * missing is not zero.
 */
function Delta({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <span className="inline-flex items-center gap-1 text-body-sm text-ink-muted">
        <Minus aria-hidden className="size-3" />
        no earlier cycle
      </span>
    );
  }

  if (value === 0) {
    return (
      <span className="tabular inline-flex items-center gap-1 text-body-sm text-ink-muted">
        <Minus aria-hidden className="size-3" />
        unchanged
      </span>
    );
  }

  const up = value > 0;
  return (
    <span
      className={cn(
        "tabular inline-flex items-center gap-1 text-body-sm font-medium",
        up ? "text-success" : "text-critical",
      )}
    >
      {up ? (
        <TrendingUp aria-hidden className="size-3" />
      ) : (
        <TrendingDown aria-hidden className="size-3" />
      )}
      {signed(value)} vs last
    </span>
  );
}

/**
 * One layer's score in the hero.
 *
 * The tier tint is the ground and the tier hue is the dot, which is the pairing
 * §13.1 uses everywhere else — so it inverts correctly with the theme rather
 * than needing its own set of colours. The numeral stays in ink: text wears
 * text tokens, and a cyan "4.20" would be both harder to read and redundant
 * beside a cyan dot that already says whose it is.
 *
 * An absent score is an em dash, never 0.00 — missing is not zero (§11, P7-9),
 * and a card reading 0.00 for an unstarted appraisal is the kind of thing
 * people escalate about.
 */
function HeroTier({ tier, value }: { tier: "self" | "lead" | "final"; value: number | null }) {
  return (
    <div className={cn("rounded-card border px-3.5 py-2.5", TIER_CLASSES[tier].chip)}>
      <span className="flex items-center gap-1.5 text-body-sm text-ink-muted">
        <span aria-hidden className={cn("size-2 rounded-pill", TIER_CLASSES[tier].dot)} />
        {TIER_LABELS[tier]}
      </span>
      <span className="tabular mt-0.5 block text-display-sm text-ink">
        {value === null ? "—" : value.toFixed(2)}
      </span>
    </div>
  );
}

/**
 * The key every tier chart on this page shares.
 *
 * Present whenever two or more layers are drawn — identity is never colour
 * alone. `lineFinal` distinguishes the combo chart, where final is a LINE over
 * two columns: a square swatch there would say it is a third bar, and a reader
 * would go looking for a column that is not drawn.
 *
 * The labels wear text tokens, never the series colour: the swatch beside them
 * carries the identity, and a pink word is both harder to read and redundant.
 */
function TierLegend({
  showFinal = false,
  lineFinal = false,
  className,
}: {
  showFinal?: boolean;
  lineFinal?: boolean;
  className?: string;
}) {
  return (
    <ul
      className={cn(
        "flex flex-wrap items-center gap-x-5 gap-y-1.5 text-body-sm text-ink-muted",
        className,
      )}
    >
      {(["self", "lead"] as const).map((tier) => (
        <li key={tier} className="flex items-center gap-1.5">
          <span aria-hidden className={cn("size-2.5 rounded-[2px]", TIER_CLASSES[tier].dot)} />
          {TIER_LABELS[tier]}
        </li>
      ))}
      {showFinal ? (
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn(
              lineFinal ? "h-0.5 w-4 rounded-pill" : "size-2.5 rounded-[2px]",
              TIER_CLASSES.final.dot,
            )}
          />
          <span>{lineFinal ? `${TIER_LABELS.final} (line)` : TIER_LABELS.final}</span>
        </li>
      ) : null}
    </ul>
  );
}

/** One layer's raw answer, as a tinted pill. Reads at a glance in a dense row. */
function ScorePip({ tier, value }: { tier: "self" | "lead"; value: number | null }) {
  return (
    <span
      className={cn(
        "tabular flex size-8 shrink-0 items-center justify-center rounded-input border text-body font-semibold",
        TIER_CLASSES[tier].chip,
      )}
      aria-label={`${TIER_LABELS[tier]} ${value === null ? "not rated" : value}`}
    >
      {value ?? "—"}
    </span>
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
 * One headline number: an icon, a label, the figure, and the context under it.
 *
 * Deliberately not `MetricWidget`. That carries a signed percentage trend pill,
 * and three of these four have no meaningful "vs last" — a widget rendering
 * half its parts reads as something that failed to load rather than as
 * something smaller.
 *
 * ACCENTS ARE NEVER TIER HUES. §13.1 reserves cyan, pink and indigo for "who
 * said this", and none of these tiles is about a layer, so they take chart and
 * status tokens. `accent-cyan` is the chart palette's secondary quantity, which
 * coincides with the self tier in light mode and is a different token doing a
 * different job (see globals.css).
 */
function MiniStat({
  icon,
  accent,
  label,
  value,
  hint,
  meter,
}: {
  icon: React.ReactNode;
  accent: "primary" | "cyan" | "green" | "amber";
  label: string;
  value: string;
  hint?: string | null;
  /** 0–1. Draws a proportion under the figure where the figure IS one. */
  meter?: number;
}) {
  // Written out in full, never interpolated: Tailwind scans statically, so
  // `bg-accent-${accent}/10` compiles to nothing at all.
  const tint = {
    primary: "bg-accent-primary/10 text-accent-primary",
    cyan: "bg-accent-cyan/10 text-accent-cyan",
    green: "bg-accent-green/10 text-accent-green",
    amber: "bg-warning/10 text-warning",
  }[accent];

  const fill = {
    primary: "bg-accent-primary",
    cyan: "bg-accent-cyan",
    green: "bg-accent-green",
    amber: "bg-warning",
  }[accent];

  return (
    <div className="card-surface flex flex-col gap-3 p-5">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className={cn("flex size-8 shrink-0 items-center justify-center rounded-input", tint)}
        >
          {icon}
        </span>
        <p className="text-body-sm text-ink-muted">{label}</p>
      </div>

      <p className="tabular text-display-md leading-none text-ink">{value}</p>

      {meter === undefined ? null : (
        <div className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-mute" aria-hidden>
          <div
            className={cn("h-full rounded-pill transition-[width] duration-500", fill)}
            style={{ width: `${Math.max(0, Math.min(1, meter)) * 100}%` }}
          />
        </div>
      )}

      {hint ? <p className="line-clamp-2 text-body-sm text-ink-muted">{hint}</p> : null}
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

/**
 * One layer's score as a track, 0–5.
 *
 * A null draws NOTHING rather than an empty track at zero width. Both look
 * similar at a glance and mean opposite things — "not rated" and "rated 0",
 * which §6 makes the worst score there is. The tinted rail behind it is what
 * tells the reader the row exists and is unfilled.
 *
 * `decorative` drops the image role where the numbers sit in the same row
 * anyway: three labelled graphics per line, each restating the figure beside
 * it, makes a screen reader read the table three times over.
 */
function SectionBar({
  tier,
  value,
  decorative = false,
}: {
  tier: "self" | "lead" | "final";
  value: number | null;
  decorative?: boolean;
}) {
  const classes = TIER_CLASSES[tier];
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-mute"
      {...(decorative
        ? { "aria-hidden": true }
        : {
            role: "img",
            "aria-label": `${TIER_LABELS[tier]} ${
              value === null ? "not rated" : value.toFixed(2)
            } out of 5`,
          })}
    >
      {value === null ? null : (
        <div
          className={cn("h-full rounded-pill transition-[width] duration-500", classes.fill)}
          style={{ width: `${(value / 5) * 100}%` }}
        />
      )}
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
