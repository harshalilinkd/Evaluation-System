"use client";

/** The six bands of the combined report (P20). Read-only — there is no rating control here. */

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Flag, LayoutDashboard, Lock } from "lucide-react";

import { ProgressRail } from "@/components/appraise/progress-rail";
import { StatusChip } from "@/components/appraise/status-chip";
import { Button } from "@/components/ui/button";
import { SECTION_LABELS } from "@/lib/forms/labels";
import type { EvaluationReport } from "@/lib/reports/types";
import { formatDate, formatDateTime } from "@/lib/utils/date";
import { cn } from "@/lib/utils";

/* ---------- Who said it, READABLY ----------

   The tier hues were once the TEXT colour of the values: cyan #06B6D4 is 2.3:1
   on white and pink #EC4899 is 3.6:1, against §13.8's 4.5:1 floor — so every
   self and lead answer, numbers and wording alike, was below the contrast
   minimum on a document meant to go to the MD.

   That was fixed by tinting the COLUMN and leaving the text ink. The values have
   been readable ever since and stay so; what has changed is that the tint itself
   has gone (see below), and the dot in the column heading now carries the
   identity on its own. */
/* -- A HAIRLINE, NOT A WASH.
      The two answer columns used to be filled `bg-self-tint/50` and
      `bg-lead-tint/50` all the way down. It stated the speaker unmistakably and
      it cost the screen its composure: two saturated bands running the height
      of every table, competing with each other, with the indigo primary, and
      with the rose on a flagged row.

      §13.1 is untouched. The rule is that these three hues mean "who said
      this" and are never spent on anything else — not that they must be a
      filled cell. The identity moved to the DOT in each column heading, which
      is the same device the queue's `TierHead` and the scorecard's legends
      already use, so the report now says it the way the rest of the product
      does. A hairline keeps the two columns grouped without tinting anything.

      Colour is still never the only signal: the heading carries a dot AND the
      word (§13.8). -- */
const TIER_CELL = "border-l border-rule/60";

const TIER_DOT = {
  self: "bg-self",
  lead: "bg-lead",
} as const;

/** A tier label: the hue as a dot, the words in readable ink. */
function TierTag({ tier, children }: { tier: "self" | "lead"; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className={cn("size-2 shrink-0 rounded-pill", TIER_DOT[tier])} />
      <span className="type-label font-bold text-ink">{children}</span>
    </span>
  );
}

function score(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

function gapText(value: number | null): string {
  if (value === null) return "—";
  return value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
}

/**
 * The mean of the two sides.
 *
 * ADDED AT THE OWNER'S EXPLICIT INSTRUCTION — a deliberate amendment to §11,
 * which said "there is no final score column" on the reasoning that averaging a
 * self-rating with a manager's produces a number describing neither. That
 * reasoning was put to the owner and they chose the column. Recorded in §18.
 *
 * The screen and the printed sheet carry the same four columns deliberately: a
 * report whose printout has a column the screen does not is two documents.
 */
function average(self: number | null, lead: number | null): string {
  if (self === null || lead === null) return "—";
  return ((self + lead) / 2).toFixed(2);
}

function firstName(full: string | null): string {
  return (full ?? "").trim().split(/\s+/)[0] || "they";
}

/* ---------- The way back, and where you are ---------- */

/**
 * A sticky one-line strip: out, who this is about, and what stage it is at.
 *
 * The screen had no way back at all — the only exit was the browser button or
 * the sidebar. It is a `BackLink`-style named destination rather than
 * `history.back()`, for that component's reason: somebody who arrived from a
 * notification link has no history, and a control that does nothing is §13.4's
 * dead end.
 *
 * Sticky and 44px, so it costs one line and is still there after two screens of
 * scrolling — which is when somebody actually wants it.
 */
export function ReportTopBar({ report }: { report: EvaluationReport }) {
  const { header } = report;

  return (
    <div className="sticky top-0 z-20 -mx-4 mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule bg-canvas/95 px-4 py-2 backdrop-blur lg:-mx-8 lg:px-8">
      <Link
        href="/reports"
        className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-control px-2 text-body-sm font-medium text-ink-muted transition-colors duration-hover hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Reports
      </Link>

      <span aria-hidden className="text-ink-muted">/</span>

      <span className="truncate text-body-sm font-medium text-ink">{header.employeeName}</span>

      <span className="ml-auto flex items-center gap-2">
        {/* -- The other half of the dual-report toggle.
              PURELY ADDITIVE: one link in the chrome. Nothing about the report
              below is moved, removed or reworded — the record is unchanged, and
              this is only the way across to the interview view.

              It is here because a toggle that exists on one side only is a
              toggle nobody finds: the executive view links here, and without
              this there was no way back to it except the queue. -- */}
        <Link
          href={`/reports/${report.evaluationId}/summary`}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-control border border-rule px-2.5 text-body-sm font-medium text-ink transition-colors duration-hover hover:bg-surface-mute lg:min-h-9"
        >
          <LayoutDashboard className="size-4" aria-hidden />
          <span className="hidden sm:inline">Executive summary</span>
          <span className="sm:hidden">Summary</span>
        </Link>

        <span className="hidden text-body-sm text-ink-muted lg:inline">
          {header.cycleName} · {header.period}
        </span>
        <StatusChip status={header.status} />
      </span>
    </div>
  );
}

/**
 * A numbered section heading.
 *
 * What made this read as a pile of cards rather than a document was that its
 * five parts had no order and no weight — and the class they used for their
 * headings did not exist in the type scale at all, so Tailwind emitted nothing
 * and preflight rendered every one of them at plain body size. Four such
 * phantom utilities were in the tree; all four are gone.
 *
 * Numbering is what a reader uses to say "look at three" out loud, which is the
 * whole point of a document somebody discusses with the MD.
 */
export function BandHeading({
  index,
  title,
  hint,
  action,
}: {
  index: number;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-rule pb-2">
      <div className="min-w-0">
        <h2 className="flex items-baseline gap-2 font-sans text-display-sm text-ink">
          <span aria-hidden className="tabular text-body-sm font-semibold text-ink-muted">
            {index}
          </span>
          {title}
        </h2>
        {hint ? <p className="font-sans text-body-sm text-ink-muted">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}

/* ---------- Band 1 ---------- */

export function HeaderBand({ report }: { report: EvaluationReport }) {
  const { header, summary } = report;

  /* -- THE FINAL SCORE, BEFORE IT IS STORED.
        `final_overall` is written at the close and not a moment earlier, so the
        tile was absent for the whole life of a record and appeared only once
        there was nothing left to decide. That is the wrong way round: the
        figure is what HR and the MD are discussing, and it was the one number
        not on the screen while they discussed it.

        Identical arithmetic to 0046's SQL and to both dialogs — the mean of the
        two stored layer averages, a missing side left out rather than counted
        as zero (§11, P7-9). It is a PREVIEW and the caption says so: nothing is
        stored until the record closes, and a figure presented as final before
        it is agreed would be a claim the record cannot back. -- */
  const layerScores = [summary.selfOverall, summary.leadOverall].filter(
    (v): v is number => v !== null && v !== undefined,
  );
  const projectedFinal =
    layerScores.length === 0
      ? null
      : Math.round((layerScores.reduce((a, b) => a + b, 0) / layerScores.length) * 100) / 100;

  /** What the tile shows: the stored figure once there is one, else the preview. */
  const shownFinal = summary.finalOverall ?? projectedFinal;
  const flagged =
    summary.overallGap !== null && Math.abs(summary.overallGap) >= summary.flagThreshold;

  return (
    <section className="card-surface overflow-hidden rounded-card-lg">
      {/* ---------- Identity ---------- */}
      <div className="space-y-1 border-b border-rule px-6 py-5">
        <h1 className="font-sans text-display-md text-ink">{header.employeeName}</h1>
        <p className="font-sans text-body text-ink-muted">
          {[header.employeeCode, header.designation, header.department]
            .filter(Boolean)
            .join(" · ") || "—"}
        </p>
        <p className="font-sans text-body-sm text-ink-muted">
          {header.cycleName} · {header.period} · {header.cycleType}
          {header.leadName ? ` · rated by ${header.leadName}` : ""}
          {header.dateOfJoining ? ` · joined ${formatDate(header.dateOfJoining)}` : ""}
        </p>
      </div>

      <div className="border-b border-rule px-6 py-4">
        <ProgressRail status={header.status} />
      </div>

      {/* ---------- The three figures ----------
          Every numeral is INK — 15:1 against the 2.3:1 the cyan gave it
          (§13.8). The tier is carried by the dot on the label and the rule at
          the edge. The gap is labelled because §11 confines it to HR and the
          MD, and a number nobody can explain is a number somebody will
          repeat. */}
      <div
        className={cn(
          "grid divide-y divide-rule sm:divide-x sm:divide-y-0",
          // A fourth panel only once there is a final score. An empty "Final —"
          // on a report still with HR would read as a figure somebody forgot.
          shownFinal === null ? "sm:grid-cols-3" : "sm:grid-cols-4",
        )}
      >
        {/* -- White, with the hue as a dot and a 2px rule.
              These were filled tiles too, and three saturated blocks across the
              top set the tone for everything under them. The dot and the rule
              carry the same identity at a fraction of the ink, and the figure —
              which is what anybody is here to read — is the loudest thing in
              the tile again. -- */}
        <figure className="relative px-6 py-5">
          <span aria-hidden className="absolute inset-y-4 left-0 w-0.5 rounded-pill bg-self" />
          <figcaption>
            <TierTag tier="self">Self average</TierTag>
          </figcaption>
          <p className="tabular mt-1 text-display-lg text-ink">{score(summary.selfOverall)}</p>
          <p className="font-sans text-body-sm text-ink-muted">What they said about themselves</p>
        </figure>

        <figure className="relative px-6 py-5">
          <span aria-hidden className="absolute inset-y-4 left-0 w-0.5 rounded-pill bg-lead" />
          <figcaption>
            <TierTag tier="lead">Manager average</TierTag>
          </figcaption>
          <p className="tabular mt-1 text-display-lg text-ink">{score(summary.leadOverall)}</p>
          <p className="font-sans text-body-sm text-ink-muted">
            What {firstName(header.leadName)} said about them
          </p>
        </figure>

        {/* ---------- The agreed final score ----------
            §13.1's third tier, and legitimately so: indigo means "the final,
            authoritative answer", which is exactly what this is. It only
            renders once one exists — before that there is nothing agreed. */}
        {shownFinal !== null ? (
          <figure className="relative px-6 py-5">
            <span aria-hidden className="absolute inset-y-4 left-0 w-0.5 rounded-pill bg-final" />
            <figcaption>
              <span className="flex items-center gap-2">
                <span aria-hidden className="size-2 shrink-0 rounded-pill bg-final" />
                <span className="type-label font-bold text-ink">Final score</span>
                {summary.finalOverall === null ? (
                  <span className="type-label font-normal normal-case tracking-normal text-ink-muted">
                    not yet recorded
                  </span>
                ) : null}
              </span>
            </figcaption>
            <p
              className={cn(
                "tabular mt-1 text-display-lg",
                // Muted while it is a projection, so it does not read as decided.
                summary.finalOverall === null ? "text-ink-muted" : "text-ink",
              )}
            >
              {score(shownFinal)}
            </p>
            <p className="font-sans text-body-sm text-ink-muted">
              {summary.finalOverall === null
                ? "The mean of both averages. Recorded when the cycle closes."
                : "Agreed with the MD and recorded by HR"}
            </p>
          </figure>
        ) : null}

        {/* The gap tile keeps a ground, because it is the one panel that is
            RESTRICTED (§5) rather than merely tinted — the lock and the muted
            surface together say "not everyone sees this". Rose only when the
            figure is actually over the threshold, and even then a tint rather
            than the old half-strength fill. */}
        <figure className={cn("px-6 py-5", flagged ? "bg-critical-tint/40" : "bg-surface-mute")}>
          <figcaption className="type-label flex items-center gap-1.5 text-ink-muted">
            <Lock className="size-3" aria-hidden />
            Gap · HR and MD only
          </figcaption>
          <p
            className={cn(
              "tabular mt-1 text-display-lg",
              flagged ? "text-critical" : "text-ink",
            )}
          >
            {gapText(summary.overallGap)}
          </p>
          <p className="font-sans text-body-sm text-ink-muted">
            Manager minus self.{" "}
            {summary.flaggedCount > 0
              ? `${summary.flaggedCount} question${summary.flaggedCount === 1 ? "" : "s"} flagged at ${summary.flagThreshold} or more.`
              : "Nothing flagged."}
          </p>
        </figure>
      </div>

      {summary.sections.length > 0 ? (
        /* Two renderings of one set of figures — the table above `lg`, cards
           below — so the ternary now yields a fragment rather than a single
           element. */
        <>
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[520px] border-collapse">
            <thead>
              <tr className="border-b border-rule">
                <th className="type-label px-6 py-3 text-left font-bold text-ink">Section</th>
                {/* The heading carries the tier dot, and the column beneath it
                    carries the tint. Together they say who spoke without asking
                    anybody to read cyan text. */}
                <th className={cn("px-4 py-3 text-right", TIER_CELL)}>
                  <TierTag tier="self">Self</TierTag>
                </th>
                <th className={cn("px-4 py-3 text-right", TIER_CELL)}>
                  <TierTag tier="lead">Manager</TierTag>
                </th>
                {/* Added at the owner's instruction — a deliberate amendment to
                    §11, recorded in §18. Plain ink and no tier dot: it belongs
                    to neither side, which is precisely why §11 did not want
                    it. */}
                <th className="type-label px-4 py-3 text-right font-bold text-ink">Average</th>
                <th className="type-label px-6 py-3 text-right font-bold text-ink">Gap</th>
              </tr>
            </thead>
            <tbody>
              {summary.sections.map((s) => {
                const wide =
                  s.gap !== null && Math.abs(s.gap) >= summary.flagThreshold;
                return (
                  <tr key={s.section} className="border-b border-rule last:border-b-0">
                    <td className="px-6 py-3 font-sans text-body text-ink">{s.label}</td>
                    <td
                      className={cn(
                        "tabular px-4 py-3 text-right text-body font-semibold text-ink",
                        TIER_CELL,
                      )}
                    >
                      {score(s.self)}
                    </td>
                    <td
                      className={cn(
                        "tabular px-4 py-3 text-right text-body font-semibold text-ink",
                        TIER_CELL,
                      )}
                    >
                      {score(s.lead)}
                    </td>
                    {/* Both or nothing: Manager Review has no self score, and
                        printing the manager's figure there as an "average" would
                        say both sides agreed on a section only one of them
                        answered. */}
                    <td className="tabular px-4 py-3 text-right text-body font-semibold text-ink">
                      {average(s.self, s.lead)}
                    </td>
                    <td
                      className={cn(
                        "tabular px-6 py-3 text-right text-body font-semibold",
                        wide ? "text-critical" : "text-ink-muted",
                      )}
                    >
                      {gapText(s.gap)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* -- THE SAME FIGURES AS CARDS ON A PHONE.
              A 520px table in a 375px window is panned, and the two columns
              that matter most — Average and Gap — are the ones off the right.
              Section per card, the four figures in a row beneath it: they are
              short numbers, so they fit where the table's own padding did not.

              Self is cyan and Manager pink here as everywhere (§13.1); Average
              and Gap stay in ink, because an average belongs to neither layer
              and a gap is a reporting figure rather than a verdict. -- */}
        <ul className="divide-y divide-rule lg:hidden">
          {summary.sections.map((s) => {
            const wide = s.gap !== null && Math.abs(s.gap) >= summary.flagThreshold;
            return (
              <li key={s.section} className="px-4 py-3">
                <p className="font-sans text-body text-ink">{s.label}</p>
                <dl className="mt-2 grid grid-cols-4 gap-2">
                  <div>
                    <dt className="type-label text-self">Self</dt>
                    <dd className="tabular text-body font-semibold text-ink">{score(s.self)}</dd>
                  </div>
                  <div>
                    <dt className="type-label text-lead">Manager</dt>
                    <dd className="tabular text-body font-semibold text-ink">{score(s.lead)}</dd>
                  </div>
                  <div>
                    <dt className="type-label text-ink-muted">Average</dt>
                    <dd className="tabular text-body font-semibold text-ink">
                      {average(s.self, s.lead)}
                    </dd>
                  </div>
                  <div>
                    <dt className="type-label text-ink-muted">Gap</dt>
                    <dd
                      className={cn(
                        "tabular text-body font-semibold",
                        wide ? "text-critical" : "text-ink-muted",
                      )}
                    >
                      {gapText(s.gap)}
                    </dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>
        </>
      ) : null}
    </section>
  );
}

/* ---------- Band 2 ---------- */

export function RatingsBand({ report, index }: { report: EvaluationReport; index: number }) {
  const [flaggedOnly, setFlaggedOnly] = React.useState(false);

  const sections = report.sections
    .map((s) => ({ ...s, rows: flaggedOnly ? s.rows.filter((r) => r.flag !== "none") : s.rows }))
    .filter((s) => s.rows.length > 0);

  return (
    <section className="space-y-4">
      <BandHeading
        index={index}
        title="Ratings"
        hint="Every question both sides answered, in the order they were asked."
        action={
          <Button
            type="button"
            variant={flaggedOnly ? "default" : "secondary"}
            size="sm"
            className="min-h-11"
            aria-pressed={flaggedOnly}
            onClick={() => setFlaggedOnly((v) => !v)}
          >
            <Flag className="mr-2 size-4" aria-hidden />
            Flagged only
          </Button>
        }
      />

      {sections.length === 0 ? (
        <p className="card-surface p-6 font-sans text-body-sm text-ink-muted">
          {flaggedOnly ? "Nothing is flagged on this report." : "No ratings were recorded."}
        </p>
      ) : (
        sections.map((section) => (
          <article key={section.section} className="card-surface overflow-hidden print:break-inside-avoid">
            <header className="border-b border-rule px-6 py-3">
              <h3 className="font-sans text-body font-semibold text-ink">{section.label}</h3>
            </header>

            <div className="hidden overflow-x-auto lg:block">
              {/* `table-fixed` with explicit widths: the two answer columns hold
                  wording like "4 · Effective (Exceeds objective)", and with auto
                  layout one long question text squeezed them to nothing. */}
              <table className="w-full min-w-[900px] table-fixed border-collapse">
                <colgroup>
                  {/* -- 300, not 190, and the number is measured rather than
                        chosen. §6's six labels run from "3 · Adequate (Meets
                        objective)" at ~213px to "5 · Outstanding (Well exceeds
                        objective)" at ~284px, so a 190px column — 150px of text
                        after padding — guaranteed that EVERY answer in the
                        product wrapped to two lines. The ragged rows were an
                        arithmetic result, not a styling one.

                        300 with `px-4` leaves 268px, which holds four of the
                        six on one line. Sizing for all six would need 324 each,
                        and two of those plus the gap column would leave the
                        question under 280px on a 1440 page — trading a common
                        problem for a worse one. The two extremes still wrap;
                        the table no longer looks uniformly broken.

                        §6's wording is untouched. It is fixed and §17 forbids
                        paraphrasing it, so the column moves, not the label. -- */}
                  <col />
                  <col className="w-[300px]" />
                  <col className="w-[300px]" />
                  <col className="w-[104px]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-rule">
                    <th className="type-label px-5 py-3 text-left font-bold text-ink">Question</th>
                    <th className={cn("px-4 py-3 text-left", TIER_CELL)}>
                      <TierTag tier="self">Self</TierTag>
                    </th>
                    <th className={cn("px-4 py-3 text-left", TIER_CELL)}>
                      <TierTag tier="lead">Manager</TierTag>
                    </th>
                    <th className="type-label px-5 py-3 text-right font-bold text-ink">Gap</th>
                  </tr>
                </thead>
                {/* -- THE FLAG IS A BADGE ON THE NUMBER, not a bar on the row.
                      A 2px critical rule down the left of every flagged row,
                      plus a red glyph, plus red text in the gap column, was
                      three shouts for one fact — and on a report with a third
                      of its rows flagged it read as an error state rather than
                      as the finding the screen exists to surface.

                      One rose pill now carries all three channels at once: the
                      glyph, the tint and the figure itself (§13.8 — never
                      colour alone). It sits ON the gap, which is the thing that
                      is actually flagged, and the row stays calm.

                      The comment lives HERE, above the map, and not inside the
                      `=> (` below it: a braced JSX comment in that position is
                      parsed as an object literal rather than a comment, and the
                      error it raises names a missing paren twenty lines away.
                      (P30 hit the same family — a line comment between two JSX
                      attributes.) -- */}
                <tbody>
                  {section.rows.map((row) => (
                    <tr
                      key={row.questionId}
                      className="border-b border-rule align-top last:border-b-0"
                    >
                      <td className="px-5 py-4">
                        <span className="block font-sans text-body text-ink">{row.text}</span>
                        {row.flag !== "none" ? (
                          <span className="sr-only">Flagged difference.</span>
                        ) : null}
                        {row.leadComment ? (
                          // The lead's own note on their score. Kept beside the
                          // question rather than in the lead column, so a long
                          // comment cannot squash the answers.
                          <span className="mt-2 block border-l-2 border-lead/50 pl-3 font-sans text-body-sm italic text-ink-muted">
                            {row.leadComment}
                          </span>
                        ) : null}
                      </td>
                      {/* Ink, always. The heading's dot says who spoke; the
                          wording stays readable (§13.8's 4.5:1). */}
                      <td className={cn("px-4 py-4 font-sans text-body text-ink", TIER_CELL)}>
                        {row.selfAnswer ?? <span className="text-ink-muted">—</span>}
                      </td>
                      <td className={cn("px-4 py-4 font-sans text-body text-ink", TIER_CELL)}>
                        {row.leadAnswer ?? <span className="text-ink-muted">—</span>}
                      </td>
                      <td className="px-5 py-4 text-right">
                        {row.flag !== "none" ? (
                          <span className="tabular inline-flex items-center gap-1.5 rounded-pill bg-critical-tint px-2.5 py-1 text-body-sm font-semibold text-critical">
                            <Flag aria-hidden className="size-3 shrink-0" />
                            {gapText(row.gap)}
                          </span>
                        ) : (
                          <span className="tabular text-body text-ink-muted">
                            {gapText(row.gap)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* -- THE SAME ROWS AS CARDS ON A PHONE.
                  A 900px table in a 375px window is the worst case on this
                  screen: the question is readable and both answers — the whole
                  reason the report exists — are off the right-hand edge, so
                  comparing them means panning back and forth for every row.

                  Stacked instead. The question, then Self and Manager as two
                  labelled halves, with the gap where the flag already is. Both
                  answers are on screen at once, which is the comparison. -- */}
            <ul className="divide-y divide-rule lg:hidden">
              {section.rows.map((row) => (
                <li key={row.questionId} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 font-sans text-body text-ink">{row.text}</span>
                    {row.flag !== "none" ? (
                      <span className="tabular inline-flex shrink-0 items-center gap-1.5 rounded-pill bg-critical-tint px-2.5 py-1 text-body-sm font-semibold text-critical">
                        <Flag aria-hidden className="size-3 shrink-0" />
                        {gapText(row.gap)}
                        <span className="sr-only">Flagged difference.</span>
                      </span>
                    ) : (
                      <span className="tabular shrink-0 text-body-sm text-ink-muted">
                        {gapText(row.gap)}
                      </span>
                    )}
                  </div>

                  <dl className="mt-2 grid grid-cols-2 gap-3">
                    <div className="min-w-0">
                      <dt className="type-label text-self">Self</dt>
                      <dd className="font-sans text-body-sm text-ink">
                        {row.selfAnswer ?? <span className="text-ink-muted">—</span>}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="type-label text-lead">Manager</dt>
                      <dd className="font-sans text-body-sm text-ink">
                        {row.leadAnswer ?? <span className="text-ink-muted">—</span>}
                      </dd>
                    </div>
                  </dl>

                  {row.leadComment ? (
                    <p className="mt-2 border-l-2 border-lead/50 pl-3 font-sans text-body-sm italic text-ink-muted">
                      {row.leadComment}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </article>
        ))
      )}
    </section>
  );
}

/* ---------- Band 3 ---------- */

export function LearningBand({ report, index }: { report: EvaluationReport; index: number }) {
  const { paired } = report.narratives;
  if (paired.length === 0) return null;

  const employee = firstName(report.header.employeeName);
  const lead = firstName(report.header.leadName);

  return (
    <section className="space-y-4">
      <BandHeading
        index={index}
        title="Learning and improvement"
        hint="The two sides on one topic, for reading together. Nothing here is scored or matched, and every answer below also appears in full in its own side's section."
      />

      {paired.map((pair) => (
        <article key={pair.topic} className="card-surface overflow-hidden print:break-inside-avoid">
          <h3 className="border-b border-rule px-6 py-3 font-sans text-body font-semibold text-ink">
            {pair.topic}
          </h3>

          {/* The tint runs the full height of each half, so the two voices are
              told apart by ground rather than by tinting their words (§13.8). */}
          <div className="grid md:grid-cols-2">
            <div className={cn("space-y-1.5 px-6 py-4", TIER_CELL)}>
              <TierTag tier="self">What {employee} said</TierTag>
              {pair.selfQuestion ? (
                <p className="font-sans text-body-sm text-ink-muted">{pair.selfQuestion}</p>
              ) : null}
              <p className="whitespace-pre-wrap font-sans text-body text-ink">
                {pair.selfAnswer ?? (
                  <span className="text-ink-muted">
                    {pair.selfQuestion ? "Left blank." : "The form did not ask this of the employee."}
                  </span>
                )}
              </p>
            </div>

            <div className={cn("space-y-1.5 px-6 py-4", TIER_CELL)}>
              <TierTag tier="lead">What {lead} said</TierTag>
              {pair.leadQuestion ? (
                <p className="font-sans text-body-sm text-ink-muted">{pair.leadQuestion}</p>
              ) : null}
              <p className="whitespace-pre-wrap font-sans text-body text-ink">
                {pair.leadAnswer ?? (
                  <span className="text-ink-muted">
                    {pair.leadQuestion ? "Left blank." : "The form did not ask this of the lead."}
                  </span>
                )}
              </p>
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}

/* ---------- Bands 4 and 5 ---------- */

export function NarrativeBand({
  index,
  title,
  hint,
  blocks,
  tone,
}: {
  index: number;
  title: string;
  hint: string;
  blocks: Array<{ question: string; answer: string | null }>;
  tone: "self" | "lead";
}) {
  if (blocks.length === 0) return null;

  return (
    <section className="space-y-4">
      <BandHeading index={index} title={title} hint={hint} />

      <article className="card-surface overflow-hidden print:break-inside-avoid">
        {/* One tier rule down the left of the whole block, rather than tinting
            each question. The question was `type-label text-self` — small caps
            in 2.3:1 cyan, which is the least readable combination on the page. */}
        <div
          className={cn(
            "divide-y divide-rule border-l-2",
            tone === "self" ? "border-l-self" : "border-l-lead",
          )}
        >
          {blocks.map((block) => (
            <div key={block.question} className="space-y-1.5 px-6 py-4">
              <p className="type-label text-ink-muted">{block.question}</p>
              {/* Never truncated. The brief is explicit, and a difficulty
                  somebody wrote three sentences about is not served by two. */}
              <p className="whitespace-pre-wrap font-sans text-body text-ink">
                {block.answer ?? <span className="text-ink-muted">Left blank.</span>}
              </p>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}

/* ---------- The quiet meta panel ---------- */

export function MetaPanel({ report }: { report: EvaluationReport }) {
  const { meta } = report;

  return (
    <div className="card-surface space-y-3 p-4">
      <h3 className="type-label text-ink-muted">What happened</h3>

      <dl className="space-y-1.5 font-sans text-body-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-ink-muted">Self submitted</dt>
          <dd className="tabular text-ink">
            {meta.selfSkipped ? "Skipped" : meta.selfSubmittedAt ? formatDateTime(meta.selfSubmittedAt) : "—"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-muted">Manager submitted</dt>
          <dd className="tabular text-ink">
            {meta.leadSkipped ? "Skipped" : meta.leadSubmittedAt ? formatDateTime(meta.leadSubmittedAt) : "—"}
          </dd>
        </div>
      </dl>

      {meta.returns.length > 0 ? (
        <div className="space-y-2 border-t border-rule pt-3">
          <p className="type-label text-ink-muted">Returned before</p>
          {meta.returns.map((r, index) => (
            <div key={`${r.at}-${index}`} className="space-y-0.5">
              <p className="font-sans text-body-sm text-ink">
                {formatDate(r.at)}
                {r.returnedTo ? ` · to ${r.returnedTo.toLowerCase()}` : ""}
                {r.by ? ` · by ${r.by}` : ""}
              </p>
              {r.reason ? (
                <p className="font-sans text-body-sm text-ink-muted">&ldquo;{r.reason}&rdquo;</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {(meta.selfSkipped || meta.leadSkipped) ? (
        <p className="rounded-control border border-critical/40 bg-critical-tint px-3 py-2 font-sans text-body-sm text-critical">
          {meta.selfSkipped && meta.leadSkipped
            ? "Both layers were skipped."
            : meta.selfSkipped
              ? "The employee never submitted; HR advanced this record."
              : "The lead never submitted; HR advanced this record."}
        </p>
      ) : null}
    </div>
  );
}

export { SECTION_LABELS };
