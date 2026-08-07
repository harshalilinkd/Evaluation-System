"use client";

/** The six bands of the combined report (P20). Read-only — there is no rating control here. */

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Flag, Lock } from "lucide-react";

import { ProgressRail } from "@/components/appraise/progress-rail";
import { StatusChip } from "@/components/appraise/status-chip";
import { Button } from "@/components/ui/button";
import { SECTION_LABELS } from "@/lib/forms/labels";
import type { EvaluationReport } from "@/lib/reports/types";
import { formatDate, formatDateTime } from "@/lib/utils/date";
import { cn } from "@/lib/utils";

/* ---------- Who said it, READABLY ----------

   The tier hues were being used as the TEXT colour of the values: cyan #06B6D4
   is 2.3:1 on white and pink #EC4899 is 3.6:1, against §13.8's 4.5:1 floor. So
   every self and lead answer on this report — the numbers AND the wording — was
   below the contrast minimum. On a document meant to go to the MD that is not a
   preference, it is unreadable.

   §13.1 is unchanged and untouched: the tier still says who spoke. It says it
   the way P15-10 already made the printed pack say it — by COLUMN rather than by
   letterform. A tier-tinted column with ink text is ~15:1, and it identifies the
   speaker more strongly than a tinted word ever did, because the whole column
   carries it rather than one value at a time.

   Where a column is not available (a label above a paragraph), a filled dot
   carries the hue and the text stays ink. Colour is then never the only signal,
   which is the other half of §13.8. */
const TIER_COLUMN = {
  self: "bg-self-tint/50",
  lead: "bg-lead-tint/50",
} as const;

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
        <span className="hidden text-body-sm text-ink-muted sm:inline">
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
          Every numeral is INK now. The tier is carried by the tint behind it and
          by the dot on its label — a 15:1 reading of the number instead of the
          2.3:1 the cyan gave it (§13.8). The gap is labelled because §11
          confines it to HR and the MD, and a number nobody can explain is a
          number somebody will repeat. */}
      <div
        className={cn(
          "grid divide-y divide-rule sm:divide-x sm:divide-y-0",
          // A fourth panel only once there is a final score. An empty "Final —"
          // on a report still with HR would read as a figure somebody forgot.
          summary.finalOverall === null ? "sm:grid-cols-3" : "sm:grid-cols-4",
        )}
      >
        <figure className="bg-self-tint/50 px-6 py-4">
          <figcaption>
            <TierTag tier="self">Self average</TierTag>
          </figcaption>
          <p className="tabular mt-1 text-display-lg text-ink">{score(summary.selfOverall)}</p>
          <p className="font-sans text-body-sm text-ink-muted">What they said about themselves</p>
        </figure>

        <figure className="bg-lead-tint/50 px-6 py-4">
          <figcaption>
            <TierTag tier="lead">Lead average</TierTag>
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
        {summary.finalOverall !== null ? (
          <figure className="bg-final-tint/50 px-6 py-4">
            <figcaption>
              <span className="flex items-center gap-2">
                <span aria-hidden className="size-2 shrink-0 rounded-pill bg-final" />
                <span className="type-label font-bold text-ink">Final score</span>
              </span>
            </figcaption>
            <p className="tabular mt-1 text-display-lg text-ink">{score(summary.finalOverall)}</p>
            <p className="font-sans text-body-sm text-ink-muted">
              Agreed with the MD and recorded by HR
            </p>
          </figure>
        ) : null}

        <figure className={cn("px-6 py-4", flagged ? "bg-critical-tint/50" : "bg-surface-mute")}>
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
            Lead minus self.{" "}
            {summary.flaggedCount > 0
              ? `${summary.flaggedCount} question${summary.flaggedCount === 1 ? "" : "s"} flagged at ${summary.flagThreshold} or more.`
              : "Nothing flagged."}
          </p>
        </figure>
      </div>

      {summary.sections.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse">
            <thead>
              <tr className="border-b border-rule">
                <th className="type-label px-6 py-2 text-left font-bold text-ink">Section</th>
                {/* The heading carries the tier dot, and the column beneath it
                    carries the tint. Together they say who spoke without asking
                    anybody to read cyan text. */}
                <th className={cn("px-3 py-2 text-right", TIER_COLUMN.self)}>
                  <TierTag tier="self">Self</TierTag>
                </th>
                <th className={cn("px-3 py-2 text-right", TIER_COLUMN.lead)}>
                  <TierTag tier="lead">Lead</TierTag>
                </th>
                <th className="type-label px-6 py-2 text-right font-bold text-ink">Gap</th>
              </tr>
            </thead>
            <tbody>
              {summary.sections.map((s) => {
                const wide =
                  s.gap !== null && Math.abs(s.gap) >= summary.flagThreshold;
                return (
                  <tr key={s.section} className="border-b border-rule last:border-b-0">
                    <td className="px-6 py-2 font-sans text-body text-ink">{s.label}</td>
                    <td
                      className={cn(
                        "tabular px-3 py-2 text-right text-body font-semibold text-ink",
                        TIER_COLUMN.self,
                      )}
                    >
                      {score(s.self)}
                    </td>
                    <td
                      className={cn(
                        "tabular px-3 py-2 text-right text-body font-semibold text-ink",
                        TIER_COLUMN.lead,
                      )}
                    >
                      {score(s.lead)}
                    </td>
                    <td
                      className={cn(
                        "tabular px-6 py-2 text-right text-body font-semibold",
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
      ) : null}
    </section>
  );
}

/* ---------- Band 2 ---------- */

export function RatingsBand({ report }: { report: EvaluationReport }) {
  const [flaggedOnly, setFlaggedOnly] = React.useState(false);

  const sections = report.sections
    .map((s) => ({ ...s, rows: flaggedOnly ? s.rows.filter((r) => r.flag !== "none") : s.rows }))
    .filter((s) => s.rows.length > 0);

  return (
    <section className="space-y-4">
      <BandHeading
        index={1}
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

            <div className="overflow-x-auto">
              {/* `table-fixed` with explicit widths: the two answer columns hold
                  wording like "4 · Effective (Exceeds objective)", and with auto
                  layout one long question text squeezed them to nothing. */}
              <table className="w-full min-w-[760px] table-fixed border-collapse">
                <colgroup>
                  <col />
                  <col className="w-[190px]" />
                  <col className="w-[190px]" />
                  <col className="w-[80px]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-rule">
                    <th className="type-label px-4 py-2 text-left font-bold text-ink">Question</th>
                    <th className={cn("px-4 py-2 text-left", TIER_COLUMN.self)}>
                      <TierTag tier="self">Self</TierTag>
                    </th>
                    <th className={cn("px-4 py-2 text-left", TIER_COLUMN.lead)}>
                      <TierTag tier="lead">Lead</TierTag>
                    </th>
                    <th className="type-label px-4 py-2 text-right font-bold text-ink">Gap</th>
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map((row) => (
                    <tr
                      key={row.questionId}
                      className={cn(
                        "border-b border-rule align-top last:border-b-0",
                        // A left bar AND a glyph AND the sr-only text: §13.8,
                        // the flagged row is the one thing this screen exists to
                        // surface, so it is the last place to encode a state in
                        // hue alone. The row tint is gone — it fought the two
                        // tier columns, and the bar plus the flag already say it.
                        row.flag !== "none" && "border-l-2 border-l-critical",
                      )}
                    >
                      <td className="px-4 py-2.5">
                        <span className="flex items-start gap-2">
                          {row.flag !== "none" ? (
                            <Flag className="mt-0.5 size-3.5 shrink-0 text-critical" aria-hidden />
                          ) : null}
                          <span>
                            <span className="block font-sans text-body text-ink">{row.text}</span>
                            {row.flag !== "none" ? (
                              <span className="sr-only">Flagged difference.</span>
                            ) : null}
                            {row.leadComment ? (
                              // The lead's own note on their score. Kept beside
                              // the question rather than in the lead column, so
                              // a long comment cannot squash the answers.
                              <span className="mt-1.5 block border-l-2 border-lead pl-3 font-sans text-body-sm italic text-ink-muted">
                                {row.leadComment}
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </td>
                      {/* INK, not cyan and pink. The tint behind the column is
                          what says who spoke; the wording stays readable. */}
                      <td
                        className={cn(
                          "px-4 py-2.5 font-sans text-body text-ink",
                          TIER_COLUMN.self,
                        )}
                      >
                        {row.selfAnswer ?? <span className="text-ink-muted">—</span>}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-2.5 font-sans text-body text-ink",
                          TIER_COLUMN.lead,
                        )}
                      >
                        {row.leadAnswer ?? <span className="text-ink-muted">—</span>}
                      </td>
                      <td
                        className={cn(
                          "tabular px-4 py-2.5 text-right text-body font-semibold",
                          row.flag !== "none" ? "text-critical" : "text-ink-muted",
                        )}
                      >
                        {gapText(row.gap)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        ))
      )}
    </section>
  );
}

/* ---------- Band 3 ---------- */

export function LearningBand({ report }: { report: EvaluationReport }) {
  const { paired } = report.narratives;
  if (paired.length === 0) return null;

  const employee = firstName(report.header.employeeName);
  const lead = firstName(report.header.leadName);

  return (
    <section className="space-y-4">
      <BandHeading
        index={3}
        title="Learning and improvement"
        hint="The two sides side by side. Nothing here is scored or matched — read them together."
      />

      {paired.map((pair) => (
        <article key={pair.topic} className="card-surface overflow-hidden print:break-inside-avoid">
          <h3 className="border-b border-rule px-6 py-3 font-sans text-body font-semibold text-ink">
            {pair.topic}
          </h3>

          {/* The tint runs the full height of each half, so the two voices are
              told apart by ground rather than by tinting their words (§13.8). */}
          <div className="grid md:grid-cols-2">
            <div className={cn("space-y-1.5 px-6 py-4", TIER_COLUMN.self)}>
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

            <div className={cn("space-y-1.5 px-6 py-4", TIER_COLUMN.lead)}>
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
          <dt className="text-ink-muted">Lead submitted</dt>
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
