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
  StatusDonutChart,
  TIER_CHART_COLORS,
  ratingBandColor,
} from "@/components/appraise/charts";
import { DashboardCard } from "@/components/appraise/metric-widget";
import { ProgressRail } from "@/components/appraise/progress-rail";
import { EmptyState } from "@/components/appraise/states";
import { SCALE_0_5_LABELS, TIER_CLASSES, TIER_LABELS } from "@/components/appraise/tier";
import { useSectionLabels } from "@/components/appraise/section-labels";
import { sectionRank } from "@/lib/forms/labels";
import type { QuestionSection } from "@/lib/forms/types";
import type { Scorecard, ScorecardQuestion } from "@/lib/analytics/queries";
import { coLeadRole } from "@/lib/reports/reviewer";
import { formatDate, formatScore } from "@/lib/utils/date";
import { cn } from "@/lib/utils";

/** Reused from the tier chart palette, so a second reviewer takes the same
 *  distinct colour everywhere it appears — the executive summary included. */
const SECOND_REVIEWER_COLOR = TIER_CHART_COLORS.secondReviewer;

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

export function ScorecardClient({
  card,
  isSelf,
  containerClassName = "mx-auto w-full max-w-content space-y-5",
}: {
  card: Scorecard;
  isSelf: boolean;
  /** Overrides the outer wrapper's width. Defaults to the single-subject
   *  centred column every other caller (the standalone /scorecard route,
   *  a person's own scorecard page) already uses — Reports' own tab passes a
   *  wider one, since it sits beside a full-bleed queue and the centred
   *  column there read as mostly empty canvas. */
  containerClassName?: string;
}) {
  // HR's own names, not the shipped defaults (P25).
  const sectionNames = useSectionLabels();
  /* -- Every chart carries a table fallback, and it is not a nicety.
        The palette validator reports cyan below 3:1 on a white surface, which
        obligates relief rather than a different hue — and a polygon is
        unreadable to a screen reader whatever its contrast. These are somebody's
        appraisal numbers, so the exact figures are always one press away.
        `ChartFigure` owns that toggle now; nothing here holds it. -- */

  /* -- Which cycles the HISTORY TABLE lists. "" is all of them.
        The comment here claimed the picker "turns this from a page about a
        person into a page about one appraisal". It does not, and it cannot:
        every chart above the table is built from `card.questions`, which the
        server returns for the LATEST rated cycle only. Filtering the page to an
        older one would empty the section profile, the rating mix and the gaps
        while leaving their headings — and filtering the trend to one cycle
        would draw a trend through a single point, which is the thing P33-8
        removed. A comment describing an ambition rather than the behaviour is
        how the next person builds against it. It scopes the table it sits in. -- */
  const [cycleFilter, setCycleFilter] = React.useState<string>("");
  const visibleHistory = cycleFilter
    ? card.history.filter((h) => String(h.evaluation_id) === cycleFilter)
    : card.history;
  /** Whether any cycle CURRENTLY SHOWN has a second reviewer's figure — the
   *  column and its header appear and disappear with the "Show" filter, which
   *  is honest: a cycle with no second reviewer should not carry an empty one. */
  const visibleHistoryHaveCoLead = visibleHistory.some((h) => h.co_lead_overall !== null);

  /* -- WHAT THE MANAGERS SAID. `manager_overall` (0087) is the mean of both
        where this person has two managers, and equal to `lead_overall` where
        they have one. Falling back the other way would show a designer half
        their review.

        NOT a fallback across the §5 strip: `withoutLeadLayer` nulls both
        columns for an employee reading their own card, so both being null means
        withheld rather than missing — and reaching past one to the other would
        undo the strip on the very screen it was written for.

        DECLARED HERE, before its first use: it was defined further down the
        component and referenced above that point (in `ratedHistory` below, and
        in the headline figures), which is a `const` read in its own temporal
        dead zone — a crash on every render, not just some. -- */
  const managerOf = (
    h: { manager_overall: number | null; lead_overall: number | null } | null | undefined,
  ) =>
    h?.manager_overall ?? h?.lead_overall ?? null;

  /* -- The headline numbers describe the last appraisal that PRODUCED one.
        Reading the last row outright meant a draft cycle sitting above a rated
        one turned all three tiles to "not rated" while the table below listed
        the scores — the card contradicting itself on the same screen.

        `previous` is the rated cycle before that one, so the delta compares
        two appraisals rather than an appraisal against an empty draft. Where
        this cycle STANDS is a different question and still reads `card.current`,
        which is deliberately the newest cycle whatever state it is in. -- */
  const ratedHistory = card.history.filter(
    (h) => h.self_overall !== null || managerOf(h) !== null || h.final_overall !== null,
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
      { self: number[]; lead: number[]; coLead: number[]; final: number[] }
    >();
    for (const q of card.questions) {
      const entry = bySection.get(q.section) ?? { self: [], lead: [], coLead: [], final: [] };
      if (q.self !== null) entry.self.push(q.self);
      if (q.lead !== null) entry.lead.push(q.lead);
      if (q.coLead !== null) entry.coLead.push(q.coLead);
      if (q.final !== null) entry.final.push(q.final);
      bySection.set(q.section, entry);
    }
    const mean = (xs: number[]) =>
      xs.length === 0 ? null : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100;

    return [...bySection.entries()]
      .map(([section, v]) => ({
        section,
        label: sectionNames[section],
        count: Math.max(v.self.length, v.lead.length, v.coLead.length, v.final.length),
        self: mean(v.self),
        lead: mean(v.lead),
        coLead: mean(v.coLead),
        final: mean(v.final),
      }))
      .sort((a, b) => sectionRank(a.section) - sectionRank(b.section));
    // `sectionNames` is HR's live naming: a rename has to re-label these rows,
    // not wait for the answers to change.
  }, [card.questions, sectionNames]);

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
        lead: managerOf(h),
        // 0095. The second reviewer's OWN figure per cycle — added at the
        // owner's instruction ("coordinator ratings still not added in all
        // charts"). `managerOf` above stays the BLEND (0087) — this is the
        // other of the two numbers a blend is made from, not a duplicate.
        coLead: h.co_lead_overall,
        final: h.final_overall,
      })),
    [ratedHistory],
  );
  const comboRowsHaveCoLead = comboRows.some((r) => r.coLead !== null);

  /* -- Sections as grouped bars: self, manager, second reviewer, final.
        Grouped and not stacked: self 4 and lead 3 is not a section worth 7.
        AT THE OWNER'S INSTRUCTION, this is now the ONLY chart carrying section
        shape — the radar that used to sit beside it drew the identical numbers
        as a polygon, and a diverging "where you disagreed" chart and a
        by-band comparison chart each restated the self/lead pair a third and
        fourth time in different shapes lower down the page. One chart, every
        series it needs, including the one that was missing entirely: a
        second reviewer's own answers (0083) were never shown anywhere on
        this card. -- */
  const sectionBars = React.useMemo(
    () =>
      sections
        .filter((s) => s.self !== null || s.lead !== null || s.coLead !== null || s.final !== null)
        .map((s) => ({
          label: s.label,
          self: s.self,
          lead: s.lead,
          coLead: s.coLead,
          final: s.final,
        })),
    [sections],
  );

  const sectionBarsHaveFinal = sectionBars.some((s) => s.final !== null && s.final !== s.lead);
  const sectionBarsHaveCoLead = sectionBars.some((s) => s.coLead !== null);
  /* -- Their designation, never an invented role like "2nd reviewer" — the
        same rule the executive summary and the printed sheet already follow
        (lib/reports/reviewer.ts). Only computed for display where a co-lead
        actually exists; `card.coLeadName` is null otherwise, and every render
        site below guards on that before reading this. -- */
  const coLeadHeader = coLeadRole(card.coLeadDesignation, card.coLeadName);
  /** Whether ANY question actually carries a second-reviewer answer — a
   *  co-lead can be assigned and not yet have rated anything, and a column
   *  of nothing but em dashes is not a reason to draw a fourth column. */
  const questionsHaveCoLead = card.questions.some((q) => q.coLead !== null);

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
        the number does not have. `managerOf` is declared near the top of the
        component, before `ratedHistory` — see the comment there. -- */
  const headline = latest?.final_overall ?? managerOf(latest) ?? latest?.self_overall ?? null;
  const headlineLayer: "final" | "lead" | "self" | null =
    latest?.final_overall != null
      ? "final"
      : managerOf(latest) != null
        ? "lead"
        : latest?.self_overall != null
          ? "self"
          : null;

  const headlinePrev =
    previous?.final_overall ?? managerOf(previous) ?? previous?.self_overall ?? null;
  const headlineDelta =
    headline !== null && headlinePrev !== null ? headline - headlinePrev : null;

  return (
    <div className={containerClassName}>
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
                    not have.

                    "Managers' average", not "Manager score", when a second
                    reviewer exists and this figure IS the blend (0087) — it
                    was reported as reading like a mistake: this line said
                    3.75 while the tile beside it said 3.83, because the tile
                    is the reporting lead's OWN figure and this is both
                    managers together. Different numbers, correctly, and now
                    said differently too. */}
                <p className="text-body-sm text-ink-muted">
                  {headlineLayer === "lead" && card.coLeadName
                    ? "Managers' average score"
                    : `${TIER_LABELS[headlineLayer ?? "final"]} score`}
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

              {/* Up to four layers, small, beside the headline rather than
                  instead of it. Which side said what is the second question on
                  this page; what the score IS, is the first. */}
              <div className="flex flex-wrap gap-2.5">
                <HeroTier tier="self" value={latest?.self_overall ?? null} />
                {/* §5: not shown on your own card, at any status. The server
                    has already nulled it — this stops an em dash standing in,
                    which would read as "your manager did not rate you". */}
                {card.showLead ? (
                  <HeroTier tier="lead" value={latest?.lead_overall ?? null} />
                ) : null}
                {/* -- THE SECOND REVIEWER (0083), missing entirely before this.
                      Gated on the reporting lead's OWN tile having a real
                      number rather than on `card.coLeadOverall` alone: that
                      figure is scoped to the last RATED cycle, which can be an
                      older one than `latest` when the newest cycle is still a
                      draft — and showing a real figure beside three em dashes
                      would be a different appraisal wearing this one's hero. -- */}
                {card.showLead && card.coLeadName && latest?.lead_overall != null ? (
                  <HeroTierCoLead label={coLeadHeader} value={card.coLeadOverall} />
                ) : null}
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
              <p className="mt-3 text-body-xs text-ink-muted">
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
              {/* -- Both of these describe the two sides against each other,
                     so §5 keeps them off your own card. Not merely hidden for
                     tidiness: `bothRated` is empty there, so "Agreed exactly"
                     computed 0/0 and rendered NaN%. -- */}
              {card.showLead ? (
                <>
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
                </>
              ) : null}
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
          {/* -- SIDE BY SIDE, AT THE OWNER'S INSTRUCTION. Both are read
                together — one is "what happened over time", the other "where
                it happened" — and stacked full-width each took a whole
                screenful before the other came into view. Either card spans
                the full row alone if the other has nothing to show, rather
                than leaving an empty cell beside it. -- */}
          <div className="grid items-start gap-5 lg:grid-cols-2">
          {comboRows.length >= 1 ? (
            <DashboardCard
              title={comboRows.length > 1 ? "Appraisals over time" : "This appraisal, by layer"}
              className={sectionBars.length === 0 ? "lg:col-span-2" : undefined}
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
                  ...(card.showLead
                    ? [
                        {
                          header: "Manager",
                          cell: (r: (typeof comboRows)[number]) => formatScore(r.lead),
                          align: "right" as const,
                        },
                      ]
                    : []),
                  ...(card.showLead && comboRowsHaveCoLead
                    ? [
                        {
                          header: coLeadHeader,
                          cell: (r: (typeof comboRows)[number]) => formatScore(r.coLead),
                          align: "right" as const,
                        },
                      ]
                    : []),
                  { header: "Final", cell: (r) => formatScore(r.final), align: "right" },
                ]}
              >
                <ScoreComboChart
                  data={comboRows}
                  xKey="period"
                  bars={[
                    { key: "self", label: "Self", color: TIER_CHART_COLORS.self },
                    ...(card.showLead
                      ? [{ key: "lead", label: "Manager", color: TIER_CHART_COLORS.lead }]
                      : []),
                    ...(card.showLead && comboRowsHaveCoLead
                      ? [{ key: "coLead", label: coLeadHeader, color: SECOND_REVIEWER_COLOR }]
                      : []),
                  ]}
                  line={{ key: "final", label: "Final", color: TIER_CHART_COLORS.final }}
                />
                <TierLegend
                  showFinal
                  lineFinal
                  showLead={card.showLead}
                  coLeadLabel={card.showLead && comboRowsHaveCoLead ? coLeadHeader : null}
                />
              </ChartFigure>
            </DashboardCard>
          ) : null}

          {/* ---------- Section scores, as bars ----------
              AT THE OWNER'S INSTRUCTION, this is now the ONLY chart carrying
              section shape. A radar used to sit beside it drawing the exact
              same numbers as a polygon — the same information told twice, and
              the harder of the two to read once a second reviewer added a
              third overlapping outline to a four-axis diamond. Bars scale to
              however many layers rated a section; a radar does not.

              Every bar is directly labelled, which is what discharges the
              validator's contrast warning on cyan. -- */}
          {sectionBars.length > 0 ? (
            <DashboardCard
              title="Score by section"
              className={comboRows.length === 0 ? "lg:col-span-2" : undefined}
            >
              <ChartFigure
                caption="Average score per section, by layer"
                rows={sectionBars}
                columns={[
                  { header: "Section", cell: (s) => s.label },
                  { header: "Self", cell: (s) => formatScore(s.self), align: "right" },
                  ...(card.showLead
                    ? [
                        {
                          header: "Manager",
                          cell: (s: (typeof sectionBars)[number]) => formatScore(s.lead),
                          align: "right" as const,
                        },
                      ]
                    : []),
                  ...(card.showLead && sectionBarsHaveCoLead
                    ? [
                        {
                          header: coLeadHeader,
                          cell: (s: (typeof sectionBars)[number]) => formatScore(s.coLead),
                          align: "right" as const,
                        },
                      ]
                    : []),
                  { header: "Final", cell: (s) => formatScore(s.final), align: "right" },
                ]}
              >
                <GroupedBarChart
                  data={sectionBars}
                  labelKey="label"
                  series={[
                    { key: "self", label: "Self", color: TIER_CHART_COLORS.self },
                    ...(card.showLead
                      ? [{ key: "lead", label: "Manager", color: TIER_CHART_COLORS.lead }]
                      : []),
                    ...(card.showLead && sectionBarsHaveCoLead
                      ? [{ key: "coLead", label: coLeadHeader, color: SECOND_REVIEWER_COLOR }]
                      : []),
                    ...(sectionBarsHaveFinal
                      ? [{ key: "final", label: "Final", color: TIER_CHART_COLORS.final }]
                      : []),
                  ]}
                />
                <TierLegend
                  showFinal={sectionBarsHaveFinal}
                  showLead={card.showLead}
                  coLeadLabel={card.showLead && sectionBarsHaveCoLead ? coLeadHeader : null}
                />
              </ChartFigure>
            </DashboardCard>
          ) : null}
          </div>

          {/* ---------- Rating mix ----------
              What KIND of review this is — a steady 3.5 everywhere and a mix
              of 5s and 2s share a mean and are completely different reviews.
              A ring can only carry one series honestly, so this is the
              SETTLED answer per question, not a per-layer breakdown; the bars
              above are where each layer is told apart. -- */}
          {showRatingMix ? (
            <DashboardCard title="Rating mix">
              <p className="-mt-2 mb-1 text-body-sm text-ink-muted">
                Every rated answer, by the score it settled at.
              </p>
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

          {/* ---------- Three panels were here ----------
              "Where you and your lead agreed — and did not" (a diverging
              section-gap chart), "How each of you marked" (a by-band
              comparison) and "Are you and your lead converging?" (the same
              gap over past cycles) are REMOVED, AT THE OWNER'S INSTRUCTION —
              "keep only informative and analytical information, not all...
              don't show the same repetitive information". All three drew the
              identical self-vs-lead comparison "Score by section" already
              shows, in three further shapes lower down a page that was
              already long. §11's gap is still the finding "Where you and your
              lead saw it differently" exists to surface below, per question —
              nothing about that reasoning is lost, only its restatement four
              more times. -- */}

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
                checked.

                On your OWN card it is absent entirely. Its empty state reads
                "this appears once both sides have rated the same questions",
                which on a self-view is a promise the product must never keep
                (§5) — a card that waits for ever for something forbidden is
                worse than no card. */}
            {card.showLead ? (
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
                            {sectionNames[q.section]}
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
            ) : null}
          </div>

          {/* ---------- Every answer ----------
              The one exhaustive list on the page, and the only place a specific
              question can be looked up. The sparkbar beside each row is what
              makes it scannable: a reader picking out the rows where the
              tracks are ragged has found every disagreement without reading a
              single number.

              THE SECOND REVIEWER'S TRACK AND COLUMN, added at the owner's
              instruction — reported as still missing after every OTHER chart
              on this page had it. `q.coLead` has carried this since the
              server was extended for it; this was the one table that never
              read the field. -- */}
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
                      {/* §5 again — header, profile track and cell all drop
                          together. The lead track was drawn even here: a bar
                          whose LENGTH is the manager's score is the same
                          disclosure as the number. */}
                      {[
                        "Self",
                        ...(card.showLead ? ["Manager"] : []),
                        ...(card.showLead && questionsHaveCoLead ? [coLeadHeader] : []),
                        "Final",
                      ].map((h) => (
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
                            {sectionNames[q.section]}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4">
                          {/* Decorative: the figures are in the same row, so
                              labelling each track makes a reader hear the row
                              twice. */}
                          <div className="space-y-1">
                            <SectionBar decorative tier="self" value={q.self} />
                            {card.showLead ? (
                              <SectionBar decorative tier="lead" value={q.lead} />
                            ) : null}
                            {card.showLead && questionsHaveCoLead ? (
                              <SectionBar
                                decorative
                                tier="coLead"
                                label={coLeadHeader}
                                value={q.coLead}
                              />
                            ) : null}
                            <SectionBar decorative tier="final" value={q.final} />
                          </div>
                        </td>
                        <td className="tabular py-2.5 text-right text-body text-ink">
                          {formatScore(q.self)}
                        </td>
                        {card.showLead ? (
                          <td className="tabular py-2.5 text-right text-body text-ink">
                            {formatScore(q.lead)}
                          </td>
                        ) : null}
                        {card.showLead && questionsHaveCoLead ? (
                          <td className="tabular py-2.5 text-right text-body text-ink">
                            {formatScore(q.coLead)}
                          </td>
                        ) : null}
                        <td className="tabular py-2.5 text-right text-body font-medium text-ink">
                          {formatScore(q.final)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TierLegend
                showFinal
                showLead={card.showLead}
                coLeadLabel={card.showLead && questionsHaveCoLead ? coLeadHeader : null}
                className="mt-4"
              />
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
                    {/* §5: the Manager column is absent on your own card, not
                        empty. The header and the cell are dropped TOGETHER —
                        they are two literals describing one column, and the
                        classic way a table like this breaks is one of them
                        being edited without the other. */}
                    {[
                      "Period",
                      "Self",
                      ...(card.showLead ? ["Manager"] : []),
                      ...(card.showLead && visibleHistoryHaveCoLead ? [coLeadHeader] : []),
                      "Final",
                      "Promotion",
                      "Increment %",
                    ].map((h) => (
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
                      {card.showLead ? (
                        <td className="tabular py-2 text-body text-ink">
                          {formatScore(h.lead_overall)}
                        </td>
                      ) : null}
                      {/* 0095. The second reviewer's own figure per cycle —
                          absent below in exactly the case the header above
                          it is: no second reviewer on THAT cycle, or (§5)
                          this is somebody's own card. */}
                      {card.showLead && visibleHistoryHaveCoLead ? (
                        <td className="tabular py-2 text-body text-ink">
                          {formatScore(h.co_lead_overall)}
                        </td>
                      ) : null}
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
 * The second reviewer's own tile (0083) — the SAME shape as `HeroTier`, but
 * not built from `TIER_CLASSES`: a second reviewer shares the Lead HUE by
 * definition (§13.1 — both are "an HOD said this") and is NOT a fourth tier,
 * so it takes the dedicated second-reviewer token rather than a tier class,
 * and its own name rather than a generic "2nd reviewer" (the owner's
 * objection to that exact phrase — see lib/reports/reviewer.ts).
 */
function HeroTierCoLead({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-card border border-second-reviewer/40 bg-second-reviewer/10 px-3.5 py-2.5">
      <span className="flex items-center gap-1.5 text-body-sm text-ink-muted">
        <span aria-hidden className="size-2 rounded-pill bg-second-reviewer" />
        {label}
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
  showLead = true,
  lineFinal = false,
  /** The second reviewer's role/name, or null with none on this evaluation
   *  (0083). Not a boolean: the entry needs a real label, not a generic one —
   *  the owner's objection to "2nd reviewer" as an invented role name applies
   *  here exactly as it does everywhere else this pairing is shown. */
  coLeadLabel = null,
  className,
}: {
  showFinal?: boolean;
  /** §5: false on somebody's own card, where the manager series is not drawn.
   *  A legend entry for a series that is not there is worse than no legend — it
   *  tells the reader to look for something the page will never show them. */
  showLead?: boolean;
  lineFinal?: boolean;
  coLeadLabel?: string | null;
  className?: string;
}) {
  return (
    <ul
      className={cn(
        "flex flex-wrap items-center gap-x-5 gap-y-1.5 text-body-sm text-ink-muted",
        className,
      )}
    >
      {(showLead ? (["self", "lead"] as const) : (["self"] as const)).map((tier) => (
        <li key={tier} className="flex items-center gap-1.5">
          <span aria-hidden className={cn("size-2.5 rounded-mark", TIER_CLASSES[tier].dot)} />
          {TIER_LABELS[tier]}
        </li>
      ))}
      {coLeadLabel ? (
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-mark bg-second-reviewer" />
          {coLeadLabel}
        </li>
      ) : null}
      {showFinal ? (
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn(
              lineFinal ? "h-0.5 w-4 rounded-pill" : "size-2.5 rounded-mark",
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
  // HR's own names, not the shipped defaults (P25).
  const sectionNames = useSectionLabels();
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
            <span className="text-body-xs text-ink-muted">{sectionNames[q.section]}</span>
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
      <dt className="text-body-xs text-ink-muted">{label}</dt>
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
  /** Only read for "coLead" — there is no TIER_LABELS entry for a role that
   *  is not a tier (§13.1), so the caller passes the second reviewer's own
   *  designation or name instead. */
  label,
}: {
  tier: "self" | "lead" | "final" | "coLead";
  value: number | null;
  decorative?: boolean;
  label?: string;
}) {
  // A second reviewer is not a tier (§13.1) — same token everywhere else
  // this pairing is drawn, not one of TIER_CLASSES' three fills.
  const fillClass = tier === "coLead" ? "bg-second-reviewer" : TIER_CLASSES[tier].fill;
  const spokenLabel = tier === "coLead" ? (label ?? "Second reviewer") : TIER_LABELS[tier];
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-mute"
      {...(decorative
        ? { "aria-hidden": true }
        : {
            role: "img",
            "aria-label": `${spokenLabel} ${
              value === null ? "not rated" : value.toFixed(2)
            } out of 5`,
          })}
    >
      {value === null ? null : (
        <div
          className={cn("h-full rounded-pill transition-[width] duration-500", fillClass)}
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
