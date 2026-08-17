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
import { StatusChip } from "@/components/appraise/status-chip";
import { Button } from "@/components/ui/button";
import type { SalaryBand } from "@/lib/increment/queries";
import type { NarrativeBlock, EvaluationReport } from "@/lib/reports/types";
import { formatDate, formatInr } from "@/lib/utils/date";
import { cn } from "@/lib/utils";
import { moneyMonthly } from "@/components/appraise/money-input";

const score = (v: number | null) => (v === null ? "—" : v.toFixed(2));
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

  const lead = classifyNarratives(narratives.leadAssessment);
  const self = classifyNarratives(narratives.employeeVoice);
  const tenure = tenureLabel(header.dateOfJoining, new Date());
  // "Employee requested" is a form label; the person has a name and it reads as
  // a sentence. Same device the detailed report uses.
  const firstName = header.employeeName.trim().split(/\s+/)[0] || "They";

  return (
    <div
      data-full-bleed
      className="flex h-[calc(100dvh-var(--topbar,64px))] flex-col overflow-hidden"
    >
      {/* ================= HEADER — compact, fixed ================= */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule bg-surface px-4 py-2.5 lg:px-6">
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

      {/* ================= THE 50/50 SPLIT ================= */}
      <div className="grid min-h-0 flex-1 gap-px overflow-hidden bg-rule lg:grid-cols-2">
        {/* ---------------- LEFT: appraisal ---------------- */}
        <section className="min-h-0 space-y-3 overflow-y-auto bg-canvas p-4 lg:p-5">
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
          <div className="card-surface grid grid-cols-3 divide-x divide-rule">
            <Headline label="Employee" value={score(summary.selfOverall)} accent="self" />
            <Headline label="Manager" value={score(summary.leadOverall)} accent="lead" />
            <Headline
              label="Gap"
              value={signed(summary.overallGap)}
              accent="none"
              caption={
                summary.flaggedCount === 1 ? "1 question flagged" : `${summary.flaggedCount} flagged`
              }
            />
          </div>

          {/* Verdict tags — the binary answers, consolidated */}
          {lead.verdicts.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {lead.verdicts.map((v) => (
                <VerdictTag key={v.question} block={v} />
              ))}
            </div>
          ) : null}

          {/* Section comparison — bars, not a list of numbers */}
          <Card title="Section by section">
            {/* A key, once, rather than a legend repeated per row. */}
            <div className="mb-2 flex items-center justify-end gap-3 border-b border-rule pb-1.5">
              <span className="flex items-center gap-1.5 type-label text-ink-muted">
                <span aria-hidden className="size-2 rounded-pill bg-self" />
                Self
              </span>
              <span className="flex items-center gap-1.5 type-label text-ink-muted">
                <span aria-hidden className="size-2 rounded-pill bg-lead" />
                Manager
              </span>
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
                  <li
                    key={s.section}
                    className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-1"
                  >
                    <span className="truncate font-sans text-body-sm text-ink">{s.label}</span>
                    <span className="flex shrink-0 items-baseline gap-3">
                      <span className="tabular w-9 text-right font-sans text-body-sm text-ink">
                        {score(s.self)}
                      </span>
                      <span className="tabular w-9 text-right font-sans text-body-sm text-ink">
                        {score(s.lead)}
                      </span>
                      {/* -- BOTH OR NOTHING (AMEND-5, A5-2). Manager Review has
                            no self score at all; printing the manager's figure
                            there as an "average" would state that both sides
                            agreed on a section only one of them answered. -- */}
                      <span className="tabular w-9 text-right font-sans text-body-sm text-ink">
                        {s.self === null || s.lead === null
                          ? "—"
                          : ((s.self + s.lead) / 2).toFixed(2)}
                      </span>
                      <Badge tone={tone}>{signed(gap)}</Badge>
                    </span>

                    {/* Two tracks, one per layer. The tier hue IS the identity
                        here (§13.1), and the two lengths make the difference a
                        shape rather than a subtraction the reader performs. */}
                    <div className="col-span-2 space-y-1 pb-1">
                      <Track value={s.self} className="bg-self" />
                      <Track value={s.lead} className="bg-lead" />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>

          {/* The manager's words */}
          <Card title={`Manager${header.leadName ? ` · ${header.leadName}` : ""}`}>
            <Blocks
              groups={[
                { label: "Main strengths", items: lead.strengths },
                { label: "Areas for improvement", items: lead.improvements },
                { label: "Other notes", items: lead.other },
              ]}
              empty="The manager recorded no written feedback."
            />
          </Card>

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
        <section className="min-h-0 space-y-3 overflow-y-auto bg-canvas p-4 lg:p-5">
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
                    label="Joining Salary"
                    value={moneyMonthly(salary.joiningCtc)}
                    caption={
                      salary.joiningCtc === null
                        ? "Not on their record."
                        : `${formatInr(salary.joiningCtc)} a year`
                    }
                  />
                  <Fact
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

              <Card title="What was asked for">
                <dl className="grid gap-3 sm:grid-cols-2">
                  <Fact
                    label={`${firstName} asked for`}
                    // Monthly: the unit the employee typed it in (0061).
                    value={moneyMonthly(salary.review?.employee_expectation_ctc ?? null)}
                    caption={
                      salary.review?.employee_expectation_ctc
                        ? undefined
                        : "Not specified by employee."
                    }
                  />
                  <Fact
                    label="Typical in this team"
                    value={
                      salary.departmentMedianPct === null
                        ? "—"
                        : `${salary.departmentMedianPct.toFixed(1)}%`
                    }
                    caption={
                      salary.departmentSampleSize > 0
                        ? `Median across ${salary.departmentSampleSize} agreed ${
                            salary.departmentSampleSize === 1 ? "figure" : "figures"
                          }.`
                        : "Not enough figures in this team yet to give an average."
                    }
                  />
                </dl>
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
                title={role === "HR_ADMIN" ? "Manager proposed salary hike" : "Approval"}
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
                <dl className="mt-3 border-t border-rule pt-3">
                  <dt className="type-label text-ink-muted">Management approved</dt>
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
  accent: "self" | "lead" | "none";
}) {
  return (
    <div className="px-4 py-3">
      <p className="flex items-center gap-1.5 type-label leading-tight text-ink-muted">
        {accent === "none" ? null : (
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-pill",
              accent === "self" ? "bg-self" : "bg-lead",
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
function Track({ value, className }: { value: number | null; className: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-mute">
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

function Blocks({
  groups,
  empty,
}: {
  groups: Array<{ label: string; items: NarrativeBlock[] }>;
  empty: string;
}) {
  const any = groups.some((g) => g.items.length > 0);
  if (!any) return <p className="font-sans text-body-sm text-ink-muted">{empty}</p>;

  return (
    <div className="space-y-2.5">
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <div key={g.label}>
            <p className="type-label text-ink-muted">{g.label}</p>
            <dl className="mt-1 space-y-1.5">
              {g.items.map((b) => (
                <div key={b.question}>
                  <dt className="font-sans text-body-sm text-ink-muted">{b.question}</dt>
                  <dd className="font-sans text-body-sm leading-snug text-ink">{b.answer}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
    </div>
  );
}

function Fact({
  label,
  value,
  caption,
  strong,
}: {
  label: string;
  value: string;
  caption?: string;
  strong?: boolean;
}) {
  return (
    <div>
      <dt className="type-label leading-tight text-ink-muted">{label}</dt>
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
