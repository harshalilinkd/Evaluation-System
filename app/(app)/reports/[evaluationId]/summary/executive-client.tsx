"use client";

/** The executive summary — one screen, two partitions, no page scroll. */

import Link from "next/link";
import { ArrowLeft, ArrowRight, Lock } from "lucide-react";

import { HikeCalculator } from "@/app/(app)/reports/[evaluationId]/summary/hike-calculator";
import {
  classifyNarratives,
  tenureLabel,
  verdictTone,
  type Tone,
} from "@/app/(app)/reports/[evaluationId]/summary/narrative-map";
import { SALARY_DOT, SALARY_TINT, type SalaryTone } from "@/components/appraise/salary-tones";
import { StatusChip } from "@/components/appraise/status-chip";
import { Button } from "@/components/ui/button";
import { hikePct, newCtcFromPct } from "@/lib/increment/calc";
import type { SalaryBand } from "@/lib/increment/queries";
import { coLeadRole, LEAD_ROLE } from "@/lib/reports/reviewer";
import type { NarrativeBlock, EvaluationReport } from "@/lib/reports/types";
import { formatDate, formatInr } from "@/lib/utils/date";
import { cn } from "@/lib/utils";
import { moneyMonthly } from "@/components/appraise/money-input";

const score = (v: number | null) => (v === null ? "—" : v.toFixed(2));
/** A percentage, or an em dash. Two decimals, like every stored one (§11). */
const pctText = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)}%`);
const signed = (v: number | null) => {
  if (v === null) return "—";
  if (v === 0) return "0.00";
  return `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
};

/** A difference worth pointing at, below the cycle's own flag threshold. */
const NOTABLE = 0.5;

/**
 * VIEW 1 OF THE DUAL-REPORT SYSTEM. The detailed report is untouched.
 *
 * ZERO-SCROLL, AND WHAT THAT HONESTLY MEANS: the PAGE never scrolls. It is
 * pinned to the viewport and split 50/50, so both partitions are on screen at
 * 1080p with nothing below the fold. The content inside a partition can exceed
 * its column — a manager who wrote four paragraphs will always be able to — and
 * that partition scrolls within itself rather than pushing the salary engine off
 * the screen. Promising that arbitrary prose fits in half a screen would mean
 * truncating somebody's appraisal, which is the one thing this screen must not
 * do.
 */
export function ExecutiveSummary({
  evaluationId,
  report,
  salary,
  role,
}: {
  evaluationId: string;
  report: EvaluationReport;
  salary: SalaryBand | null;
  role: "HR_ADMIN" | "MD";
}) {
  const { header, summary, narratives } = report;

  const secondManager = header.coLeadName;

  /* -- How each manager's card is headed.
        Their DESIGNATION where they have one — a job title says why this
        person's opinion is on the page, which a name alone does not. Where
        there is none the fallback describes the RELATIONSHIP ("their other
        manager") rather than naming the slot: the owner's objection to "2nd
        reviewer" is that it is not a designation or a role, and putting it
        where a job title goes claims that it is. Unlike the detailed report's
        narrow columns, these two cards sit side by side and each has to be
        identifiable, so the fallback earns its place here. -- */
  const managerCardTitle = (designation: string | null, name: string | null, fallback: string) => {
    const role = designation?.trim() || fallback;
    return name ? `${role} · ${name}` : role;
  };
  /* -- AT THE OWNER'S INSTRUCTION: "instead of names use their designations".
        The grouped verdicts below used to key on the person's NAME — the group
        label AND the React key. Both move to the ROLE, from the one shared
        module every other surface reads. -- */
  const leadRoleLabel = LEAD_ROLE;
  const coLeadRoleLabel = secondManager
    ? coLeadRole(header.coLeadDesignation, header.coLeadName)
    : null;
  /* -- The REPORTING lead is headed "Manager", never their designation. It is a
        free-text field holding whatever was typed there, and on the report that
        prompted this it held "HR-Admin" — an access level, not a job. The
        position they hold on THIS evaluation is the one thing reliably true of
        that card. Their name follows it, because unlike the report's narrow
        columns these two cards are prose blocks with room for it. -- */

  /* -- What the employee's own answer COMES TO. They are asked for a salary,
        not a percentage (0061), so the rise it implies has to be derived — and
        derived through §11's one implementation rather than worked out here,
        or the figure on this screen could disagree with the one on the panel
        HR sets it from (P21-2). -- */
  const expectedCtc = salary?.review?.employee_expectation_ctc ?? null;
  const expectedPct = hikePct(salary?.currentCtc ?? null, expectedCtc);

  /** What the managers TOGETHER say — the mean of the two, or the one there is. */
  const managerMean = (a: number | null, b: number | null): number | null => {
    if (a === null) return b;
    if (b === null) return a;
    return (a + b) / 2;
  };
  /* -- Each manager on their own, for the cards below. `lead` above stays
        POOLED because the strengths/improvements panels are a summary and want
        every point made, not who made it — but a card headed with somebody's
        name must contain only that person's words. -- */
  const leadOwn = classifyNarratives(narratives.leadAssessment);
  const coLeadOwn = classifyNarratives(narratives.coLeadAssessment);

  const self = classifyNarratives(narratives.employeeVoice);
  const tenure = tenureLabel(header.dateOfJoining, new Date());
  return (
    /* -- ONE SCROLL, NOT TWO. This was a fixed-height flex column holding two
          panes that each scrolled on their own, and that is most of what read
          as "messy": two scrollbars on one screen, neither of which moves the
          page. The two columns are never the same length — the appraisal runs
          to five sections and two blocks of prose, the salary panel to a form —
          so one pane was always stranded mid-way while the other had ended.

          It also broke the ordinary things a reader expects of a document:
          browser find scrolls to a match the pane will not show, the scroll
          position is not restored on back, and printing captures one viewport.

          A page that scrolls once, in two columns. The right column ends and
          leaves quiet space rather than holding a second scrollbar open — which
          is the honest shape for two lists of different lengths. -- */
    <div data-full-bleed className="flex min-h-full flex-col">
      {/* ================= HEADER — compact, and it STAYS =================
          Sticky rather than fixed-by-layout: the identity, the stage chip and
          the way back to the full report are what somebody checks while reading
          further down, and they were only reachable by scrolling the whole way
          up once the panes were gone. */}
      <header className="sticky top-0 z-10 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule bg-surface px-4 py-2.5 lg:px-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2 shrink-0">
          <Link href="/reports" aria-label="Back to reports">
            <ArrowLeft className="size-4" aria-hidden />
          </Link>
        </Button>

        <div className="min-w-0">
          <h1 className="truncate font-sans text-body-lg font-medium leading-tight text-ink">
            {header.employeeName}
          </h1>
          <p className="truncate font-sans text-body-sm leading-tight text-ink-muted">
            {[header.designation, header.department, header.period].filter(Boolean).join(" · ")}
          </p>
        </div>

        {tenure ? (
          <span className="tabular shrink-0 rounded-pill bg-surface-mute px-2 py-0.5 font-sans text-body-sm text-ink">
            {tenure}
          </span>
        ) : null}

        <span className="ml-auto flex shrink-0 items-center gap-2">
          <StatusChip status={header.status} />
          <Button asChild variant="secondary" size="sm">
            <Link href={`/reports/${evaluationId}`}>
              <span className="hidden sm:inline">Full detailed audit report</span>
              <span className="sm:hidden">Full report</span>
              <ArrowRight className="ml-1.5 size-4" aria-hidden />
            </Link>
          </Button>
        </span>
      </header>

      {/* ================= TWO COLUMNS, ONE PAGE =================
          `items-start` so each column keeps its own height instead of the
          shorter one being stretched to match — a stretched column puts a
          border or a background where there is no content, which is the other
          half of what read as untidy.

          A real gap rather than the 1px hairline the two panes used: a rule
          between two scroll panes is a frame, and there are no panes now. */}
      <div className="grid flex-1 items-start gap-4 bg-canvas p-4 lg:grid-cols-2 lg:gap-5 lg:p-5">
        {/* ---------------- LEFT: appraisal ---------------- */}
        <section className="space-y-3">
          <PartitionTitle
            title="Appraisal summary"
            note="Both sides rated the same form without seeing each other."
          />

          {/* -- ONE CARD, THREE CELLS, HAIRLINES BETWEEN.
                Three separately bordered boxes made the top of the page read as
                three unrelated widgets; they are one comparison and should look
                like one object. The dot carries the tier — the same device the
                report's own column headings use — so identity is stated without
                a coloured border round every figure. -- */}
          <div
            /* -- ONE PER ROW ON A PHONE. Four cells across 375px is about
                  90px each, and these labels are people's NAMES — so the label
                  wraps to two lines and its value drops below the ones beside
                  it, which is the same misalignment the report's section scores
                  had. The dividers turn with the axis: horizontal while it is a
                  column, vertical once it is a row. -- */
            className={cn(
              "card-surface grid divide-y divide-rule sm:divide-x sm:divide-y-0",
              secondManager ? "grid-cols-1 sm:grid-cols-4" : "grid-cols-1 sm:grid-cols-3",
            )}
          >
            <Headline label="Employee" value={score(summary.selfOverall)} accent="self" />
            <Headline
              label={secondManager ? (header.leadName ?? "Manager") : "Manager"}
              value={score(summary.leadOverall)}
              accent="lead"
            />
            {/* -- Their own panel, not folded into the one beside it: the two
                   managers rated independently and blind to each other, so one
                   figure would hide exactly the disagreement both were asked
                   for. accent="second-reviewer" — reported as still reading
                   pink here even after the chart below took the distinct
                   colour: this card is a different render path (Headline, not
                   Track) and needed the same colour applied to it directly. -- */}
            {secondManager ? (
              <Headline
                label={secondManager}
                value={score(summary.coLeadOverall)}
                accent="second-reviewer"
              />
            ) : null}
            <Headline
              label="Gap"
              value={signed(summary.overallGap)}
              accent="none"
              caption={
                summary.flaggedCount === 1 ? "1 question flagged" : `${summary.flaggedCount} flagged`
              }
            />
          </div>

          {/* -- THE MANAGER'S BINARY ANSWERS, and they now say whose they are.
                Three chips sat loose between the scores and the table with no
                heading, so they read as page furniture rather than as findings
                — and "Promotion recommendation Yes" beside an employee's
                average is ambiguous about who recommended it. A card, with a
                title, in the same rhythm as everything under it. -- */}
          {/* -- ONE GROUP PER MANAGER, and that is a CRASH FIX as much as a
                 clarity one. Pooling the two managers put the same question in
                 the list twice — both answer "Promotion recommendation" — and
                 React refused it: "Encountered two children with the same key".
                 Keying on the question was safe while there was one manager and
                 stopped being safe the moment there were two.

                 Naming the manager also answers the question the chips raised:
                 "Promotion recommendation · Yes" beside an average says nothing
                 about WHO recommended it, and with two reviewers that is the
                 whole point. -- */}
          {leadOwn.verdicts.length > 0 || coLeadOwn.verdicts.length > 0 ? (
            <Card title={secondManager ? "What each manager answered" : "What the manager answered"}>
              <div className="space-y-3">
                {[
                  { who: leadRoleLabel, items: leadOwn.verdicts },
                  ...(coLeadRoleLabel
                    ? [{ who: coLeadRoleLabel, items: coLeadOwn.verdicts }]
                    : []),
                ]
                  .filter((g) => g.items.length > 0)
                  .map((g) => (
                    <div key={g.who}>
                      {secondManager ? (
                        <p className="type-label mb-1.5 text-ink-muted">{g.who}</p>
                      ) : null}
                      <div className="flex flex-wrap gap-1.5">
                        {g.items.map((v) => (
                          <VerdictTag key={`${g.who}:${v.question}`} block={v} />
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            </Card>
          ) : null}

          {/* Section comparison — bars, not a list of numbers */}
          <Card title="Section by section">
            {/* A key, once, rather than a legend repeated per row.

                NAMES, NOT ROLE WORDS, at the owner's instruction — "Self /
                Manager / Coordinator" still left the reader mapping a colour
                to a role to a person. The identity strip at the top of this
                page already does the same thing ("KETAN BHOIR", "SUPRIYA
                SONAWANE"), so this key now says the same words rather than a
                second vocabulary for one fact. `type-label` uppercases
                automatically, which is what keeps a full name from reading
                as a sentence sitting where a short word used to. */}
            <div className="mb-2 flex flex-wrap items-center justify-end gap-3 border-b border-rule pb-1.5">
              <span className="flex items-center gap-1.5 type-label text-ink-muted">
                <span aria-hidden className="size-2 rounded-pill bg-self" />
                {header.employeeName}
              </span>
              <span className="flex items-center gap-1.5 type-label text-ink-muted">
                <span aria-hidden className="size-2 rounded-pill bg-lead" />
                {header.leadName ?? "Manager"}
              </span>
              {/* -- THE THIRD TRACK, NAMED. Reported as "missing completely" —
                    it was not: `s.coLead` has drawn a third bar and a third
                    number below since 0087, `secondManager ? <Track .../> :
                    null` a few lines down. What was missing was THIS line, so
                    an empty third bar (true right now — the coordinator has
                    not submitted) read as nothing being there at all rather
                    than as a labelled column waiting on an answer — Track
                    itself was fixed separately to give an EMPTY bar a visible
                    outline, since bg-surface-mute alone was barely there at
                    6px against the card's own near-white surface.

                    Same pink FAMILY as Manager (§13.1 reserves the hue for
                    "a manager said this", and a second reviewer is one) —
                    told apart by the NAME first. But reported again even
                    with the name in place: two identically solid pink bars
                    sitting one above the other, five rows down, meant
                    constantly tracing back up to this legend to remember
                    which position was which. bg-second-reviewer — a distinct
                    literal colour (#767F9E), CHOSEN BY THE OWNER at their
                    explicit instruction, not a lighter tint of Lead — is what
                    lets every row read on its own without a fourth TIER. -- */}
              {secondManager ? (
                <span className="flex items-center gap-1.5 type-label text-ink-muted">
                  <span aria-hidden className="size-2 rounded-pill bg-second-reviewer" />
                  {secondManager}
                </span>
              ) : null}
              {/* -- AMEND-5's Average, so this table says the same as the
                    detailed report and the printed sheet. Plain ink and no
                    swatch: self is cyan and manager is pink because those say
                    WHO, and an average belongs to neither (§13.1). -- */}
              <span className="type-label w-9 text-right text-ink-muted">Avg</span>
              <span className="type-label w-[4.25rem] text-right text-ink-muted">Gap</span>
            </div>
            <ul className="space-y-2.5">
              {summary.sections.map((s) => {
                const gap = s.gap;
                const abs = gap === null ? 0 : Math.abs(gap);
                const tone: Tone =
                  gap === null
                    ? "neutral"
                    : abs >= summary.flagThreshold
                      ? "risk"
                      : abs >= NOTABLE
                        ? "watch"
                        : "neutral";
                return (
                  /* -- A FIXED GRID, so every number sits in a column.
                        These were a flex row with the figures pushed right,
                        which meant each line's numbers landed wherever the
                        label's length left them — the single biggest reason the
                        block looked untidy. Now: name, self, lead, gap, each in
                        its own track, and the eye reads straight down. -- */
                  /* -- THE BARS BELONG UNDER THE LABEL, NOT UNDER THE PAGE.
                        They spanned both columns, so two full-width lines ran
                        beneath every row — at that length and weight they read
                        as rules separating the rows rather than as the data
                        they are, and five sections produced ten of them. That
                        was the single noisiest thing in the block.

                        Now the left track holds the name with its two bars
                        directly beneath, and the numbers keep their own columns
                        to the right. The bar annotates the thing it is about,
                        and each row is one object instead of two. -- */
                  <li
                    key={s.section}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-sans text-body-sm text-ink">
                        {s.label}
                      </span>
                      {/* Two tracks, one per layer. The tier hue IS the identity
                          here (§13.1), and the two lengths make the difference a
                          shape rather than a subtraction the reader performs. */}
                      <span className="mt-1.5 block space-y-1">
                        <Track value={s.self} className="bg-self" />
                        <Track value={s.lead} className="bg-lead" />
                        {/* -- bg-second-reviewer, matching the legend swatch
                              above — a distinct literal colour (#767F9E),
                              CHOSEN BY THE OWNER at their explicit instruction.
                              Reported as unreadable even once both managers
                              were named: two solid pink bars stacked in every
                              one of five rows still needed tracing back to the
                              legend each time. -- */}
                        {secondManager ? (
                          <Track value={s.coLead} className="bg-second-reviewer" />
                        ) : null}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-baseline gap-3">
                      <span className="tabular w-9 text-right font-sans text-body-sm text-ink">
                        {score(s.self)}
                      </span>
                      <span className="tabular w-9 text-right font-sans text-body-sm text-ink">
                        {score(s.lead)}
                      </span>
                      {secondManager ? (
                        <span className="tabular w-9 text-right font-sans text-body-sm text-ink">
                          {score(s.coLead)}
                        </span>
                      ) : null}
                      {/* -- BOTH OR NOTHING (AMEND-5, A5-2). Manager Review has
                            no self score at all; printing the manager's figure
                            there as an "average" would state that both sides
                            agreed on a section only one of them answered. -- */}
                      <span className="tabular w-9 text-right font-sans text-body-sm text-ink">
                        {/* The MANAGER figure is what the managers together
                            say, so AMEND-5's definition is unchanged: still the
                            mean of the Self and Manager figures. */}
                        {(() => {
                          const managers = managerMean(s.lead, s.coLead);
                          return s.self === null || managers === null
                            ? "—"
                            : ((s.self + managers) / 2).toFixed(2);
                        })()}
                      </span>
                      <Badge tone={tone}>{signed(gap)}</Badge>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>

          {/* -- ONE CARD PER MANAGER, NAMED.
                 Merging them presented one verdict where there are two, on the
                 screen whose whole job is to carry an independent second
                 opinion into an interview. The two rated blind to each other,
                 so running their words together loses the only thing that made
                 collecting both worth doing.

                 Named rather than tinted: both managers share the manager hue
                 (§13.1 reserves three), so the NAME is what tells them apart —
                 and it survives greyscale and a colourblind reader (§13.8). -- */}
          <Card title={managerCardTitle(null, header.leadName, "Manager")}>
            <Blocks
              groups={[
                { label: "Main strengths", items: leadOwn.strengths },
                { label: "Areas for improvement", items: leadOwn.improvements },
                { label: "Other notes", items: leadOwn.other },
              ]}
              empty="This manager recorded no written feedback."
            />
          </Card>

          {secondManager ? (
            <Card title={managerCardTitle(header.coLeadDesignation, secondManager, "Their other manager")}>
              <Blocks
                groups={[
                  { label: "Main strengths", items: coLeadOwn.strengths },
                  { label: "Areas for improvement", items: coLeadOwn.improvements },
                  { label: "Other notes", items: coLeadOwn.other },
                ]}
                empty="This reviewer recorded no written feedback."
              />
            </Card>
          ) : null}

          {/* The employee's own words */}
          <Card title="In the employee's own words">
            <Blocks
              groups={[
                { label: "Achievements", items: self.strengths },
                { label: "Challenges and goals", items: self.improvements },
                { label: "Other notes", items: self.other },
              ]}
              empty="The employee wrote no free-text answers."
            />
          </Card>
        </section>

        {/* ---------------- RIGHT: compensation ---------------- */}
        <section className="space-y-3">
          {salary ? (
            <>
              <PartitionTitle
                title="Salary &amp; compensation"
                note="Every figure here is for HR and the MD only."
                icon={<Lock className="size-4 text-ink-muted" aria-hidden />}
              />

              {/* One unified compensation card */}
              {/* -- THREE FACTS, AND THE SAME PLAIN WORDS AS THE DETAILED
                    REPORT. It was four, two of which answered one question —
                    "Since last rise: 0 mo" beside "Last increment: 01-09-2026".
                    Merged, with the date leading and how long ago underneath,
                    which is the order somebody reads it in. -- */}
              <Card title="Where they are today">
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {/* Monthly, like every other salary in the product. This is the
                      screen the MD approves from, so it is the last place that should
                      still speak a different unit from the one HR typed it in. */}
                  <Fact
                    tone="joining"
                    label="Joining Salary"
                    value={moneyMonthly(salary.joiningCtc)}
                    caption={
                      salary.joiningCtc === null
                        ? "Not on their record."
                        : `${formatInr(salary.joiningCtc)} a year`
                    }
                  />
                  <Fact
                    tone="today"
                    label="Current Salary"
                    value={moneyMonthly(salary.currentCtc)}
                    caption={
                      salary.currentCtc === null
                        ? undefined
                        : `${formatInr(salary.currentCtc)} a year`
                    }
                    strong
                  />
                  <Fact
                    tone="increment"
                    label="Last Increment"
                    value={salary.lastIncrementDate ? formatDate(salary.lastIncrementDate) : "None yet"}
                    caption={
                      salary.monthsSinceLastIncrement === null
                        ? "No raise on record."
                        : salary.monthsSinceLastIncrement === 0
                          ? "This month."
                          : `${salary.monthsSinceLastIncrement} month${
                              salary.monthsSinceLastIncrement === 1 ? "" : "s"
                            } ago.`
                    }
                  />
                </dl>
              </Card>

              {/* -- THE DECISION, IN ONE ROW.
                     This card was "what was asked for" and a team median, which
                     is half a question. The MD is comparing three positions —
                     what the employee wants, what their managers recommend, and
                     what management has approved — and was being asked to
                     hold two of them in their head while reading the third.

                     Every column is the SAME TWO FACTS in the same order: a
                     percentage and the salary it comes to. That is what makes
                     them comparable at a glance; a column that showed only one
                     of the two would send the reader back to arithmetic.

                     The employee's percentage is DERIVED, never asked for: they
                     type a salary (0061) and the rise against their current pay
                     is what that means. Through `hikePct`, which is the one
                     implementation of it (P21-2) — a percentage worked out in a
                     component is one nobody can reproduce. -- */}
              <Card title="The three positions">
                <dl className="grid gap-3 sm:grid-cols-3">
                  <Fact
                    tone="asked"
                    label="Expected salary"
                    value={moneyMonthly(expectedCtc)}
                    caption={
                      expectedCtc === null
                        ? "Not specified by employee."
                        : expectedPct === null
                          ? "No current salary on record to compare against."
                          : `A rise of ${expectedPct.toFixed(2)}% on ${moneyMonthly(salary.currentCtc)}.`
                    }
                  />
                  <Fact
                    tone="proposed"
                    label={
                      salary.recommendedIsAverage ? "Managers recommend" : "Manager recommends"
                    }
                    value={
                      salary.recommendedHikePct === null
                        ? "—"
                        : `${salary.recommendedHikePct.toFixed(2)}%`
                    }
                    caption={
                      salary.recommendedHikePct === null
                        ? "No percentage recommended yet."
                        : `${moneyMonthly(newCtcFromPct(salary.currentCtc, salary.recommendedHikePct))}${
                            salary.recommendedIsAverage
                              ? ` — the mean of ${salary.managerHikePct}% and ${salary.coManagerHikePct}%.`
                              : "."
                          }`
                    }
                  />
                  {/* -- "MANAGEMENT APPROVED", not "Proposed" — at the owner's
                        instruction. This column used to show what HR had put
                        up (`hr_proposed_ctc`), which is an intermediate,
                        administrative figure that is very often still blank —
                        "Nothing proposed yet" was most of what an MD saw here.
                        The three positions that actually matter to a decision
                        are what the employee asked for, what the managers
                        recommended, and what was FINALLY approved — the
                        before/during/after of the whole negotiation. HR's own
                        proposal is still visible in full, further down, inside
                        the "Manager recommended hike" card, where the workflow
                        actually happens.

                        BLANK UNTIL TRUE, same rule as the card below (FIX-36):
                        never defaulting to the proposal, which would show an
                        approval nobody gave on the one figure a salary is paid
                        from. -- */}
                  <Fact
                    tone="approved"
                    label="Management approved"
                    value={moneyMonthly(salary.review?.md_approved_ctc ?? null)}
                    caption={
                      !salary.review?.md_approved_ctc
                        ? "Nothing approved yet."
                        : `${pctText(salary.review?.md_approved_hike_pct ?? null)} on today's salary.`
                    }
                  />
                </dl>

                <p className="mt-3 font-sans text-body-sm text-ink-muted">
                  {salary.departmentSampleSize > 0 && salary.departmentMedianPct !== null
                    ? `For context, the median agreed rise in this team is ${salary.departmentMedianPct.toFixed(1)}% across ${salary.departmentSampleSize} ${salary.departmentSampleSize === 1 ? "figure" : "figures"}.`
                    : "There are not enough agreed figures in this team yet to give a median for context."}
                </p>
              </Card>

              {/* -- THE SAME NAME AS THE DETAILED REPORT.
                    FIX-28 renamed this figure "Manager proposed" at the owner's
                    instruction — only the HOD and the MD decide salary — and
                    this screen was still calling it HR's. One number with two
                    authors depending on which report you opened is worse than
                    either name alone.

                    And the same authorship rule with it (F28-3): the field stays
                    editable, so HR CAN type something other than the manager's
                    recommendation, and the note says which it is rather than
                    letting the heading claim an authorship the number does not
                    have. -- */}
              <Card
                title={role === "HR_ADMIN" ? "Manager recommended hike" : "Approval"}
                note={
                  role === "HR_ADMIN"
                    ? salary.managerHikePct === null
                      ? "The manager recommended no percentage. HR sets the figure; the MD approves it."
                      : `The manager's recommendation of ${salary.managerHikePct}%. The MD approves it.`
                    : `The manager proposed ${moneyMonthly(salary.review?.hr_proposed_ctc ?? null)}.`
                }
              >
                {/* -- Locked once the increment is settled. Past INTERVIEW_DONE
                      the figure is on a pay record and in `salary_history`,
                      which has no UPDATE path for anybody (P19-3) — so an
                      editable form there offers to change something the
                      database will not let anybody change. -- */}
                <HikeCalculator
                  evaluationId={evaluationId}
                  band={salary}
                  role={role}
                  settled={header.status === "INTERVIEW_DONE" || header.status === "CLOSED"}
                />
                {/* -- WHAT MANAGEMENT APPROVED, which this screen never showed.
                      FIX-36 put it on the detailed report: the difference
                      between what was proposed and what was approved IS the
                      decision AMEND-2's second pair of eyes exists to produce,
                      and it was visible in the workflow and on no summary.

                      Blank until it is true — never defaulting to the proposal,
                      which would display an approval nobody gave on the one
                      number a salary is paid from. -- */}
                <dl
                  className={cn(
                    "mt-3",
                    salary.review?.md_approved_ctc
                      ? cn("rounded-card p-3", SALARY_TINT.approved)
                      : "border-t border-rule pt-3",
                  )}
                >
                  <dt className="type-label flex items-center gap-1.5 text-ink-muted">
                    {salary.review?.md_approved_ctc ? (
                      <span
                        aria-hidden
                        className={cn("size-2 shrink-0 rounded-pill", SALARY_DOT.approved)}
                      />
                    ) : null}
                    Management approved
                  </dt>
                  {salary.review?.md_approved_ctc ? (
                    <>
                      <dd className="tabular mt-0.5 font-sans text-body-lg text-ink">
                        {moneyMonthly(salary.review.md_approved_ctc)}
                      </dd>
                      <dd className="font-sans text-body-sm text-ink-muted">
                        {formatInr(salary.review.md_approved_ctc)} a year
                        {salary.review.md_approved_hike_pct === null
                          ? ""
                          : ` · ${salary.review.md_approved_hike_pct.toFixed(2)}%`}
                      </dd>
                    </>
                  ) : (
                    <dd className="mt-0.5 font-sans text-body-sm text-ink-muted">
                      {salary.review?.hr_proposed_ctc
                        ? "Waiting on management. It fills in when they approve and close."
                        : "Nothing to approve yet — the proposal has to be saved first."}
                    </dd>
                  )}
                </dl>

                <NextStep
                  status={header.status}
                  hasProposal={salary.review?.hr_proposed_ctc !== null && salary.review?.hr_proposed_ctc !== undefined}
                  hasApproval={salary.review?.md_approved_ctc !== null && salary.review?.md_approved_ctc !== undefined}
                  evaluationId={evaluationId}
                />
              </Card>

              {/* -- FROM JOINING, LIKE THE DETAILED REPORT (FIX-31).
                    It listed revisions only, so somebody with no rise yet saw no
                    history at all while their starting salary sat in the card
                    above — and where there were revisions, the run started
                    part-way through the story. The baseline is a COLUMN, not a
                    `salary_history` row (P19E-1), which is why it has to be
                    prepended here rather than arriving in the list. It carries
                    no percentage: it is what changes are measured FROM, and a
                    rise against it would describe an increment that never
                    happened. -- */}
              {salary.joiningCtc !== null || salary.history.length > 0 ? (
                <Card title="Salary history">
                  <ul className="space-y-1">
                    {salary.joiningCtc === null ? null : (
                      <li className="flex justify-between gap-3 font-sans text-body-sm">
                        <span className="text-ink-muted">
                          {formatDate(salary.dateOfJoining)} · Joining
                        </span>
                        <span className="tabular text-ink">{moneyMonthly(salary.joiningCtc)}</span>
                      </li>
                    )}
                    {salary.history.map((h) => (
                      <li
                        key={`${h.effectiveFrom}-${h.newCtc}`}
                        className="flex justify-between gap-3 font-sans text-body-sm"
                      >
                        <span className="text-ink-muted">{formatDate(h.effectiveFrom)}</span>
                        <span className="tabular text-ink">
                          {moneyMonthly(h.newCtc)}
                          {h.hikePct === null ? "" : ` · ${h.hikePct.toFixed(1)}%`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}
            </>
          ) : (
            /* -- The salary key is ABSENT from the report object, not blanked
                  (P20-3), so this branch cannot tell an evaluation cycle from a
                  caller who is not entitled — and does not try to. -- */
            <Card title="Salary &amp; compensation">
              <p className="font-sans text-body-sm text-ink-muted">
                This is an evaluation cycle, so no salary review is attached to it. Compensation is
                recorded on an increment cycle.
              </p>
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}

/* ---------- What is still outstanding ---------- */

/**
 * THE MISSING SENTENCE.
 *
 * Saving a figure records a NUMBER; it never moves the evaluation. §8 closes an
 * increment through `MD_REVIEWED → INTERVIEW_DONE → CLOSED`, and the control
 * that does it — the interview card on the full report — only appears once the
 * MD has reviewed. So somebody could save a proposal, see "saved", and have no
 * way of knowing the cycle was still three steps from closing.
 *
 * Nothing here performs a transition. It names the next step and links to the
 * screen that owns it, which is the honest fix: the guards belong where they
 * are, and a second close button on a second screen is a second path for §8 to
 * be worked around.
 */
function NextStep({
  status,
  hasProposal,
  hasApproval,
  evaluationId,
}: {
  status: EvaluationReport["header"]["status"];
  hasProposal: boolean;
  hasApproval: boolean;
  evaluationId: string;
}) {
  const steps: string[] = [];

  // "HR proposes a figure" was the last sentence on this screen still calling
  // the figure HR's — FIX-28 renamed it everywhere else, and a next-step line
  // that names a different author from the card it points at is worse than none.
  if (!hasProposal) steps.push("Save the manager's proposed figure above.");
  if (status === "PENDING_HR_REVIEW") steps.push("HR reviews the report and sends it to the MD.");
  if (!hasApproval) steps.push("The MD approves the figure.");
  if (status === "HR_APPROVED") steps.push("The MD records their review on the full report.");
  if (status === "MD_REVIEWED") {
    // Reachable from this screen now, so it no longer sends anybody elsewhere.
    steps.push("Confirm the final amount — Approve and close, above.");
  }
  /* -- Kept, and it should almost never fire. `confirm_increment` runs
        MD_REVIEWED -> INTERVIEW_DONE -> CLOSED in one transaction, so a record
        only rests here if that call was interrupted between its two halves —
        which cannot happen, but a status with no sentence attached is how a
        stuck record ends up with nobody knowing what it needs. -- */
  if (status === "INTERVIEW_DONE") steps.push("Close the evaluation.");

  if (status === "CLOSED") {
    return (
      <p className="mt-3 border-t border-rule pt-3 font-sans text-body-sm text-ink-muted">
        This increment is closed. The agreed figure is on the employee&rsquo;s pay record.
      </p>
    );
  }

  if (steps.length === 0) return null;

  return (
    <div className="mt-3 border-t border-rule pt-3">
      <p className="type-label text-ink-muted">Still to happen</p>
      <ol className="mt-1.5 space-y-1">
        {steps.map((s, i) => (
          <li key={s} className="flex gap-2 font-sans text-body-sm text-ink">
            <span className="tabular shrink-0 text-ink-muted">{i + 1}.</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      <Link
        href={`/reports/${evaluationId}`}
        className="mt-2 inline-block font-sans text-body-sm font-medium text-primary underline-offset-2 hover:underline"
      >
        Open the full report to do this
      </Link>
    </div>
  );
}

/* ---------- Pieces ---------- */

function PartitionTitle({
  title,
  note,
  icon,
}: {
  title: string;
  note: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <h2 className="font-sans text-body font-medium leading-tight text-ink">{title}</h2>
        <p className="font-sans text-body-sm leading-tight text-ink-muted">{note}</p>
      </div>
      {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
    </div>
  );
}

function Card({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card-surface p-3.5">
      <h3 className="font-sans text-body-sm font-medium text-ink">{title}</h3>
      {note ? <p className="font-sans text-body-sm text-ink-muted">{note}</p> : null}
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

function Headline({
  label,
  value,
  caption,
  accent,
}: {
  label: string;
  value: string;
  caption?: string;
  accent: "self" | "lead" | "second-reviewer" | "none";
}) {
  return (
    <div className="px-4 py-3">
      <p className="flex items-center gap-1.5 type-label leading-tight text-ink-muted">
        {accent === "none" ? null : (
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-pill",
              accent === "self"
                ? "bg-self"
                : accent === "second-reviewer"
                  ? "bg-second-reviewer"
                  : "bg-lead",
            )}
          />
        )}
        {label}
      </p>
      <p className="tabular mt-1 font-sans text-display-md leading-none text-ink">{value}</p>
      <p className="mt-1 font-sans text-body-sm leading-tight text-ink-muted">{caption ?? " "}</p>
    </div>
  );
}

/** A 0–5 score as a proportion of the scale. Fixed domain, never fitted. */
/**
 * `border` on the groove, not just `bg-surface-mute`, at the owner's
 * instruction — reported as a genuinely missing third bar when it was an
 * unfilled one: `bg-surface-mute` against the card's own near-white surface
 * is barely there at 6px tall, so an EMPTY coordinator track read as no track
 * at all rather than as "a real slot, waiting on an answer". A filled bar
 * paints over the border; an empty one still shows its own outline.
 */
function Track({ value, className }: { value: number | null; className: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full border border-rule bg-surface-mute">
      {value === null ? null : (
        <div
          className={cn("h-full rounded-full", className)}
          style={{ width: `${Math.min(100, Math.max(0, (value / 5) * 100))}%` }}
        />
      )}
    </div>
  );
}

/* -- COLOUR EARNS ITS PLACE, OR IT DOES NOT APPEAR.
      This screen was spending five hues at once — green for good, amber for
      watch, rose for risk, plus the two tier colours and an indigo wash on the
      calculator. Six meanings competing on one screen is what makes a dashboard
      gaudy; it also makes the two that matter stop registering, because a
      reader cannot tell which colour is load-bearing.

      So the page keeps exactly TWO jobs for colour:

        · CYAN and PINK — who said it. §13.1's reserved meaning, and the whole
          subject of the screen.
        · AMBER, then ROSE — a difference worth a conversation, and one past the
          cycle's own flag threshold.

      Everything else is ink on a neutral chip. "Promotion: can be considered"
      does not need to be green; it needs to be legible. And the attention hues
      are TEXT on a neutral ground rather than a filled tint, which reads as
      emphasis instead of as a warning label. -- */
const TONE_TEXT: Record<Tone, string> = {
  good: "text-ink",
  watch: "text-warning",
  risk: "text-critical",
  neutral: "text-ink",
};

function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "tabular w-[4.25rem] shrink-0 rounded-control bg-surface-mute px-1.5 py-0.5 text-right font-sans text-body-sm font-medium",
        TONE_TEXT[tone],
      )}
    >
      {children}
    </span>
  );
}

function VerdictTag({ block }: { block: NarrativeBlock }) {
  const answer = (block.answer ?? "").trim();
  const tone = verdictTone(block.question, answer);
  // The question is trimmed to a label; the answer is never trimmed.
  const label = block.question.replace(/\?$/, "").replace(/^(any|can this person)\s+/i, "");
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-control border border-rule bg-surface px-2 py-1 font-sans text-body-sm">
      <span className="text-ink-muted">{label}</span>
      {/* Only a genuine risk takes a colour. A neutral verdict in ink reads as
          information; four coloured pills in a row read as an alarm panel. */}
      <span className={cn("font-medium", TONE_TEXT[tone])}>{answer}</span>
    </span>
  );
}

/**
 * ONLY THE FORM'S OWN QUESTION AND ANSWER, at the owner's instruction —
 * "Main strengths" / "Areas for improvement" / "Other notes" are generic
 * bucket names chosen at the CALL SITE, not read from the form, and a
 * bucket usually holding one question put its own name directly above
 * that question's REAL wording — "Challenges and goals" over "Areas for
 * Improvement" is not the same string, but it is the same idea said twice,
 * which reads as a mistake rather than as two facts.
 *
 * The buckets still decide the ORDER items appear in (strengths, then
 * improvements, then everything else) — only the heading naming each
 * bucket is gone. `groups` therefore still exists as the caller's input
 * shape; this flattens it into one list rather than three.
 */
function Blocks({
  groups,
  empty,
}: {
  groups: Array<{ label: string; items: NarrativeBlock[] }>;
  empty: string;
}) {
  const items = groups.flatMap((g) => g.items);
  if (items.length === 0) return <p className="font-sans text-body-sm text-ink-muted">{empty}</p>;

  return (
    <dl className="space-y-2.5">
      {/* -- QUESTION AS A PROMPT, ANSWER AS THE POINT.
             Italic and muted so it never reads as content itself — the real,
             verbatim form question (§17 forbids paraphrasing it) — with the
             answer inside its own tinted card, the one thing here with any
             weight, so the eye lands there first. This is the section the MD
             said matters most, read minutes before an interview.

             `whitespace-pre-wrap` because these are free-text answers and
             somebody who wrote three lines meant three lines. -- */}
      {items.map((b) => (
        <div key={b.question} className="rounded-card bg-surface-mute/70 p-3">
          <dt className="font-sans text-body-sm italic leading-snug text-ink-muted">{b.question}</dt>
          <dd className="mt-1 whitespace-pre-wrap font-sans text-body font-medium leading-snug text-ink">
            {b.answer}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* -- The same tints the detailed report's salary cards wear, from the same
      exported map — FIX-42 had to close five separate drifts between these two
      screens, and a sixth would be careless. `tone` is optional and absent
      means unchanged, so every Fact outside the salary section is untouched.

      The dot is what names the layer without spending contrast on it: §13.8
      keeps the label ink on a tint, so the hue alone could not be the signal,
      and it never is — the dot always sits beside a label saying the same
      thing in words. -- */
function Fact({
  label,
  value,
  caption,
  strong,
  tone,
}: {
  label: string;
  value: string;
  caption?: string;
  strong?: boolean;
  tone?: SalaryTone;
}) {
  return (
    <div className={tone ? cn("rounded-card p-3", SALARY_TINT[tone]) : undefined}>
      <dt className="type-label flex items-center gap-1.5 leading-tight text-ink-muted">
        {/* Only a card that IS a layer carries one — SALARY_DOT is partial, so
            the record cards have no entry and render nothing. */}
        {tone && SALARY_DOT[tone] ? (
          <span aria-hidden className={cn("size-2 shrink-0 rounded-pill", SALARY_DOT[tone])} />
        ) : null}
        {label}
      </dt>
      <dd
        className={cn(
          "tabular mt-0.5 font-sans leading-tight text-ink",
          strong ? "text-body-lg font-medium" : "text-body-lg",
        )}
      >
        {value}
      </dd>
      {caption ? (
        <p className="mt-0.5 font-sans text-body-sm leading-tight text-ink-muted">{caption}</p>
      ) : null}
    </div>
  );
}
