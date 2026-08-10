"use client";

/** The sticky rails. HR prepares and reviews; the MD approves — never the same person. */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MIN_REASON_LENGTH } from "@/lib/evaluations/transitions";
import {
  closeEvaluation,
  hrCompleteEvaluation,
  mdApprove,
  mdSendBack,
  returnForChanges,
  saveHrReview,
  sendToMd,
} from "@/lib/reports/actions";
import { saveProposal } from "@/lib/increment/actions";
import type { EvaluationReport } from "@/lib/reports/types";
import { formatDateTime } from "@/lib/utils/date";
import { cn } from "@/lib/utils";

const RECOMMENDATIONS = [
  { value: "PROCEED", label: "Proceed" },
  { value: "HOLD", label: "Hold" },
  { value: "NEEDS_DISCUSSION", label: "Needs discussion" },
] as const;

function Notice({ tone, children }: { tone: "error" | "ok"; children: React.ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-control border px-3 py-2 font-sans text-body-sm",
        tone === "error"
          ? "border-critical/40 bg-critical-tint text-critical"
          : "border-final/40 bg-final-tint text-final",
      )}
    >
      {children}
    </p>
  );
}

function PrintActions({ evaluationId }: { evaluationId: string }) {
  return (
    <div className="flex gap-2">
      <Button asChild variant="secondary" size="sm" className="flex-1">
        <a href={`/print/report/${evaluationId}`} target="_blank" rel="noopener noreferrer">
          <Printer className="mr-2 size-4" aria-hidden />
          Export PDF
        </a>
      </Button>
      <Button asChild variant="ghost" size="sm" className="flex-1">
        <a href={`/print/report/${evaluationId}?print=1`} target="_blank" rel="noopener noreferrer">
          Print
        </a>
      </Button>
    </div>
  );
}

/* ---------- HR ---------- */

export function HrRail({ report }: { report: EvaluationReport }) {
  const router = useRouter();
  const [summary, setSummary] = React.useState(report.review.hrSummary ?? "");
  const [recommendation, setRecommendation] = React.useState(
    report.review.hrRecommendation ?? "PROCEED",
  );
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<string | null>(null);

  const [returnOpen, setReturnOpen] = React.useState(false);
  const [returnedTo, setReturnedTo] = React.useState<"SELF" | "LEAD" | "BOTH">("SELF");
  const [reason, setReason] = React.useState("");
  // Completing is the one irreversible act on this screen — §8 has no path out
  // of CLOSED for anybody — so it is confirmed rather than done on one click.
  const [completeOpen, setCompleteOpen] = React.useState(false);
  /* -- The agreed final score, typed by HR on the MD's behalf.
        Seeded from whatever is already stored, so reopening the dialog shows
        the figure rather than an empty box that looks like nothing was set. -- */
  /* -- THE SAME RULE AS THE INCREMENT (0046): the mean of the employee's own
        average and their HOD's, not the HOD's alone.

        It used to seed from the lead average, which quietly made the manager's
        view the default answer and the employee's view a thing HR had to
        remember to weigh. The owner's rule is that the figure is CALCULATED
        from both sides and then confirmed — so both sides are in it.

        Still editable, and deliberately: HR asks the MD and may agree something
        else, which is the capability this dialog was built for. What has
        changed is what it starts at, so pressing Complete without touching it
        records the calculated figure rather than half of it.

        A layer with no stored average is left out rather than counted as zero —
        averaging a missing side as 0 would halve a real appraisal (§11, P7-9).
        Identical arithmetic to `salary-band.tsx` and to 0046's SQL. -- */
  const layerScores = [report.summary.selfOverall, report.summary.leadOverall].filter(
    (v): v is number => v !== null && v !== undefined,
  );
  const calculatedFinal =
    layerScores.length === 0
      ? null
      : Math.round((layerScores.reduce((a, b) => a + b, 0) / layerScores.length) * 100) / 100;

  const [finalScore, setFinalScore] = React.useState(
    calculatedFinal === null ? "" : String(calculatedFinal),
  );

  /* -- HR's proposed salary, offered HERE rather than only in the Salary
        section further down.

        Starts BLANK rather than seeded. `ReportSalary` carries the outcome
        columns — old, pct, new — not the proposal, and inventing a field on it
        to prefill a box would put a second source of truth beside
        `increment_reviews`. Blank also reads correctly: the field is optional,
        and an empty one says "the MD sets it" rather than looking like a figure
        that failed to load. The Salary section below shows what is on record. -- */
  const [proposedCtc, setProposedCtc] = React.useState("");
  const [proposalNote, setProposalNote] = React.useState("");

  const atHr = report.header.status === "PENDING_HR_REVIEW";
  const reviewed = report.header.status === "MD_REVIEWED";

  async function onSave() {
    setBusy(true);
    setError(null);
    const result = await saveHrReview({ evaluationId: report.evaluationId, summary, recommendation });
    setBusy(false);
    if (!result.ok) setError(result.error.message);
    else {
      setSaved(new Date().toISOString());
      router.refresh();
    }
  }

  async function onSend() {
    setBusy(true);
    setError(null);

    /* -- THE PROPOSAL GOES FIRST, and only if HR typed one.
          It was only ever reachable from the Salary section further down the
          report, and HR presses Send from up here — so a record could reach the
          MD with "HR PROPOSED —" and nothing for them to approve, which is what
          was reported.

          Optional, at the owner's instruction: HR may genuinely want the MD to
          set the first figure. So a blank field sends exactly as before.

          Before the transition rather than after: `saveProposal` also re-runs
          `record_salary_expectation`, which is the second chance at lifting the
          employee's stated figure out of the answers blob (P21-8). Doing it
          after the record has moved would leave the MD reading a report whose
          expectation had not been picked up yet. A failure here stops the send
          rather than being swallowed — a proposal HR believes they made is
          worse than one they know did not save. -- */
    const typed = proposedCtc.trim().replace(/[₹,\s]/g, "");
    if (report.isIncrement && typed !== "") {
      const amount = Number(typed);
      if (!Number.isFinite(amount) || amount <= 0) {
        setBusy(false);
        setError("That proposed salary is not a number. Leave it blank to let the MD set it.");
        return;
      }
      const proposal = await saveProposal({
        evaluationId: report.evaluationId,
        proposedCtc: amount,
        justification: proposalNote.trim(),
      });
      if (!proposal.ok) {
        setBusy(false);
        setError(proposal.error.message);
        return;
      }
    }

    const result = await sendToMd({ evaluationId: report.evaluationId, summary, recommendation });
    setBusy(false);
    if (!result.ok) setError(result.error.message);
    else router.refresh();
  }

  async function onReturn() {
    setBusy(true);
    setError(null);
    const result = await returnForChanges({ evaluationId: report.evaluationId, returnedTo, reason });
    setBusy(false);
    if (!result.ok) setError(result.error.message);
    else {
      setReturnOpen(false);
      router.refresh();
    }
  }

  async function onClose() {
    setBusy(true);
    setError(null);
    const result = await closeEvaluation({ evaluationId: report.evaluationId });
    setBusy(false);
    if (!result.ok) setError(result.error.message);
    else router.refresh();
  }

  /* -- Finish it here, without the MD (0039). EVALUATION cycles only; the
        button is not offered on an increment and the server refuses it twice
        over if it were. -- */
  async function onComplete() {
    setBusy(true);
    setError(null);
    const result = await hrCompleteEvaluation({
      evaluationId: report.evaluationId,
      summary,
      recommendation,
      finalScore,
    });
    setBusy(false);
    if (!result.ok) setError(result.error.message);
    else {
      setCompleteOpen(false);
      router.refresh();
    }
  }

  /* -- What a return actually does, named exactly. §13.4: an irreversible
        action whose consequence is described vaguely is how somebody clears a
        submission they meant to keep. -- */
  const consequence =
    returnedTo === "SELF"
      ? "The employee's answers will unlock and their submission will be cleared. The lead's review stays locked and untouched."
      : returnedTo === "LEAD"
        ? "The lead's answers will unlock and their submission will be cleared. The employee's answers stay locked and untouched."
        : "Both sides will unlock and both submissions will be cleared.";

  const recipient =
    returnedTo === "SELF"
      ? "The employee"
      : returnedTo === "LEAD"
        ? "The lead"
        : "Both of them";

  return (
    <aside className="space-y-4 lg:sticky lg:top-20">
      <div className="card-surface space-y-4 p-4">
        <h2 className="font-sans text-body font-medium text-ink">Your review</h2>

        {error ? <Notice tone="error">{error}</Notice> : null}
        {saved && !error ? <Notice tone="ok">Saved {formatDateTime(saved)}.</Notice> : null}

        <div className="space-y-2">
          <Label htmlFor="hr_summary" className="type-label text-ink-muted">
            Summary
          </Label>
          {/* -- The shadcn default is a 6px radius and a hard border, which
                next to a 16px card reads as a browser control dropped into a
                designed page. 12px, a hairline, and the focus ring as a soft
                halo rather than a hard outline puts it on the same system as
                everything around it. -- */}
          <Textarea
            id="hr_summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={5}
            disabled={!atHr}
            placeholder="What should the MD know before they read this?"
            className="min-h-28 resize-y rounded-card border-rule bg-surface px-3.5 py-3 text-body leading-relaxed shadow-none transition-shadow placeholder:text-ink-faint focus-visible:border-primary/50 focus-visible:ring-4 focus-visible:ring-primary/10"
          />
          <p className="font-sans text-body-sm text-ink-muted">
            {report.isIncrement
              ? "Required before this can go to the MD."
              : "Required either way — to complete this yourself, or to send it to the MD."}
          </p>
        </div>

        {/* -- THE PROPOSED SALARY, on an increment and while it is HR's.
              It existed only in the Salary section further down the report, and
              HR presses Send from up here — so a record could reach the MD with
              nothing proposed and nothing for them to approve.

              OPTIONAL, at the owner's instruction. Blank sends exactly as
              before, which is the right default when HR wants the MD to set the
              first figure themselves. The label says so rather than leaving an
              empty field looking like something forgotten. -- */}
        {report.isIncrement && atHr ? (
          <div className="space-y-2">
            <Label htmlFor="hr_proposed_ctc" className="flex items-baseline gap-1.5 type-label text-ink-muted">
              Proposed salary
              <span className="font-normal normal-case tracking-normal">optional</span>
            </Label>
            <Input
              id="hr_proposed_ctc"
              value={proposedCtc}
              onChange={(e) => setProposedCtc(e.target.value)}
              inputMode="numeric"
              placeholder="e.g. 210000"
              className="tabular min-h-11"
            />
            <Textarea
              value={proposalNote}
              onChange={(e) => setProposalNote(e.target.value)}
              rows={2}
              placeholder="Why this figure (optional)"
              className="resize-y rounded-card border-rule bg-surface px-3.5 py-2.5 text-body shadow-none placeholder:text-ink-faint focus-visible:border-primary/50 focus-visible:ring-4 focus-visible:ring-primary/10"
            />
            <p className="font-sans text-body-sm text-ink-muted">
              Saved with the record when you send. Leave blank to let the MD set the figure —
              either way they approve it, and the full salary panel is in section{" "}
              {report.narratives.paired.length > 0 ? 5 : 4} below.
            </p>
          </div>
        ) : null}

        {/* -- A CUSTOM DOT, because the native one cannot be styled.
              A browser radio paints its own blue in its own size on every
              platform, so it was the one element on the rail that ignored the
              design system entirely — and next to a 16px card it is what made
              the panel read as a form rather than a product.

              The input is still a real `type="radio"`: it stays in the tab
              order, arrow keys still move within the group, and the label still
              activates it. `sr-only` hides it visually and `peer` drives the
              drawn dot beside it, so nothing is reimplemented — only
              repainted. The focus ring is on the drawn dot via `peer-focus`,
              because a hidden input cannot show one (§13.8). -- */}
        <fieldset className="space-y-2" disabled={!atHr}>
          <legend className="type-label pb-1 text-ink-muted">Recommendation</legend>
          {RECOMMENDATIONS.map((option) => (
            <label
              key={option.value}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-3 rounded-card border px-3.5 py-2.5 transition-colors duration-hover",
                recommendation === option.value
                  ? "border-primary/40 bg-primary/[0.06]"
                  : "border-rule bg-surface hover:border-rule hover:bg-surface-mute",
                !atHr && "cursor-default opacity-70",
              )}
            >
              <input
                type="radio"
                name="hr_recommendation"
                value={option.value}
                checked={recommendation === option.value}
                onChange={() => setRecommendation(option.value)}
                className="peer sr-only"
              />
              <span
                aria-hidden
                className={cn(
                  "flex size-[18px] shrink-0 items-center justify-center rounded-pill border-2 transition-colors duration-hover",
                  "peer-focus-visible:ring-4 peer-focus-visible:ring-primary/20",
                  recommendation === option.value ? "border-primary" : "border-rule",
                )}
              >
                <span
                  className={cn(
                    "size-2 rounded-pill bg-primary transition-transform duration-hover",
                    recommendation === option.value ? "scale-100" : "scale-0",
                  )}
                />
              </span>
              <span className="font-sans text-body text-ink">{option.label}</span>
            </label>
          ))}
        </fieldset>

        {atHr ? (
          <div className="space-y-2">
            {/* ---------- The two endings ----------
                0039 makes the MD OPTIONAL on an evaluation. Completing is the
                primary action because it is the ordinary case — HR reads the
                report, talks it over with the MD in person, and finishes it.
                Sending to the MD is a deliberate choice for when a second
                reading in the product is wanted, so it stays and is secondary.

                On an INCREMENT there is only one ending: the MD approves the
                salary. The complete button is not rendered at all rather than
                rendered disabled — §13.4 wants a disabled control explained,
                and the honest explanation here is that the action does not
                exist on this track (AMEND-2's second pair of eyes on pay). */}
            {report.isIncrement ? null : (
              <Button
                type="button"
                className="min-h-11 w-full"
                disabled={busy}
                onClick={() => setCompleteOpen(true)}
              >
                {busy ? "Working…" : "Approve and complete"}
              </Button>
            )}

            <Button
              type="button"
              variant={report.isIncrement ? "default" : "secondary"}
              className="min-h-11 w-full"
              disabled={busy}
              onClick={onSend}
            >
              {busy ? "Working…" : "Send to MD"}
            </Button>

            <Button
              type="button"
              variant="secondary"
              className="min-h-11 w-full"
              disabled={busy}
              onClick={onSave}
            >
              Save without sending
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 w-full"
              disabled={busy}
              onClick={() => setReturnOpen(true)}
            >
              Return for changes
            </Button>
          </div>
        ) : (
          <p className="rounded-control border border-rule bg-surface-mute px-3 py-2 font-sans text-body-sm text-ink-muted">
            {report.header.status === "HR_APPROVED"
              ? "This is with the MD. You will be told when they have read it."
              : reviewed
                ? "The MD has read this report."
                : "This report is not at your stage."}
          </p>
        )}

        {/* §8: MD_REVIEWED → CLOSED, HR's move, EVALUATION cycles only. */}
        {reviewed && !report.isIncrement ? (
          <Button type="button" className="min-h-11 w-full" disabled={busy} onClick={onClose}>
            Close this evaluation
          </Button>
        ) : null}
        {/* -- The old text here read "The interview step is added in P21."
              P21 shipped, and the step it promised is the Confirm-and-close
              card in the Salary band below. A placeholder naming an unshipped
              phase is worse than no message: it tells the reader the product is
              unfinished when the control they need is on the same page. -- */}
        {reviewed && report.isIncrement ? (
          <p className="rounded-control border border-rule bg-surface-mute px-3 py-2 font-sans text-body-sm text-ink-muted">
            An increment closes from the Salary section below — <span className="text-ink">Confirm
            and close</span> writes the agreed figure to the employee&rsquo;s pay record and closes
            the evaluation in one step.
          </p>
        ) : null}

        <PrintActions evaluationId={report.evaluationId} />
      </div>

      {/* ---------- Confirming the completion ----------
          §13.4: an irreversible action described vaguely is how somebody ends a
          cycle they meant to send on. This names all three consequences —
          it closes, the MD does not see it, and it cannot be undone. */}
      <Dialog open={completeOpen} onOpenChange={setCompleteOpen}>
        <DialogContent className="border-rule bg-surface">
          <DialogHeader>
            <DialogTitle>Complete this evaluation?</DialogTitle>
            <DialogDescription>
              {report.header.employeeName}&rsquo;s evaluation will be marked completed and closed.
              It will not go to the MD, and your review is what the record carries.
            </DialogDescription>
          </DialogHeader>

          {/* ---------- The agreed final score ----------
              HR speaks to the MD, the MD gives a figure, HR types it here. It
              is asked for at the moment of completing rather than sitting in
              the rail all along, because that is when the conversation has
              happened — a field filled in an hour earlier is a figure nobody
              agreed to.

              NOT AN OVERRIDE. §17 forbids rewriting a submitted question score
              and nothing here does: both layers stay exactly as they were
              submitted, every answer is untouched, and the report still carries
              both averages and the gap. This is one headline number for the
              record. */}
          <div className="space-y-2">
            <Label htmlFor="final_score" className="type-label text-ink-muted">
              Final score
              <span className="ml-2 font-sans text-body-sm normal-case tracking-normal text-ink-muted">
                agreed with the MD
              </span>
            </Label>
            <div className="flex flex-wrap items-center gap-3">
              <Input
                id="final_score"
                value={finalScore}
                onChange={(e) => setFinalScore(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                aria-describedby="final_score_hint"
                className="tabular min-h-11 w-28"
              />
              <span className="font-sans text-body-sm text-ink-muted">
                out of 5 · self {report.summary.selfOverall?.toFixed(2) ?? "—"} · lead{" "}
                {report.summary.leadOverall?.toFixed(2) ?? "—"}
              </span>
            </div>
            <p id="final_score_hint" className="font-sans text-body-sm text-ink-muted">
              Calculated as the mean of the employee&rsquo;s{" "}
              {report.summary.selfOverall?.toFixed(2) ?? "—"} and their HOD&rsquo;s{" "}
              {report.summary.leadOverall?.toFixed(2) ?? "—"}. Confirm it, or change it to whatever
              you and the MD agreed. This is what the employee sees if the cycle discloses a score.
            </p>
          </div>

          <p className="rounded-control border border-warning/40 bg-warning-tint px-3 py-2 font-sans text-body-sm text-ink">
            There is no way back from completed. If you want the MD to read it first, cancel and
            choose <span className="font-medium">Send to MD</span> instead.
          </p>

          {error ? <Notice tone="error">{error}</Notice> : null}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              onClick={() => setCompleteOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" className="min-h-11" disabled={busy} onClick={onComplete}>
              {busy ? "Completing…" : "Complete it"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {report.review.mdRemarks ? (
        <div className="card-surface space-y-2 p-4">
          <h3 className="type-label text-ink-muted">The MD said</h3>
          <p className="whitespace-pre-wrap font-sans text-body-sm text-ink">{report.review.mdRemarks}</p>
          {report.review.mdReviewedByName ? (
            <p className="font-sans text-body-sm text-ink-muted">
              {report.review.mdReviewedByName}
              {report.review.mdReviewedAt ? ` · ${formatDateTime(report.review.mdReviewedAt)}` : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Return for changes</DialogTitle>
            <DialogDescription>
              Choose which side needs to look at this again.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="type-label pb-1 text-ink-muted">Return to</legend>
              {[
                { value: "SELF", label: "The employee" },
                { value: "LEAD", label: "The lead" },
                { value: "BOTH", label: "Both" },
              ].map((option) => (
                <label
                  key={option.value}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-3 rounded-control border px-3",
                    returnedTo === option.value ? "border-primary/40 bg-accent" : "border-rule bg-surface",
                  )}
                >
                  <input
                    type="radio"
                    name="returned_to"
                    value={option.value}
                    checked={returnedTo === option.value}
                    onChange={() => setReturnedTo(option.value as "SELF" | "LEAD" | "BOTH")}
                    className="size-4"
                  />
                  <span className="font-sans text-body text-ink">{option.label}</span>
                </label>
              ))}
            </fieldset>

            <div className="space-y-2">
              <Label htmlFor="return_reason" className="type-label text-ink-muted">
                Reason
              </Label>
              <Textarea
                id="return_reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                placeholder="What needs to change?"
              />
              <p className="font-sans text-body-sm text-ink-muted">
                At least {MIN_REASON_LENGTH} characters. It is sent to them word for word.
              </p>
            </div>

            <p className="rounded-control border border-critical/40 bg-critical-tint px-3 py-2 font-sans text-body-sm text-critical">
              {consequence} {recipient} will get a WhatsApp message with your reason.
            </p>

            {error ? <Notice tone="error">{error}</Notice> : null}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setReturnOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={onReturn} disabled={busy || reason.trim().length < MIN_REASON_LENGTH}>
              {busy ? "Returning…" : "Return it"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}

/* ---------- The MD ---------- */

export function MdRail({ report }: { report: EvaluationReport }) {
  const router = useRouter();
  const [remarks, setRemarks] = React.useState(report.review.mdRemarks ?? "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [backOpen, setBackOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");

  const atMd = report.header.status === "HR_APPROVED";

  async function onApprove() {
    setBusy(true);
    setError(null);
    const result = await mdApprove({ evaluationId: report.evaluationId, remarks });
    setBusy(false);
    if (!result.ok) setError(result.error.message);
    else router.refresh();
  }

  async function onSendBack() {
    setBusy(true);
    setError(null);
    const result = await mdSendBack({ evaluationId: report.evaluationId, reason });
    setBusy(false);
    if (!result.ok) setError(result.error.message);
    else {
      setBackOpen(false);
      router.refresh();
    }
  }

  return (
    <aside className="space-y-4 lg:sticky lg:top-20">
      {/* HR's review first — it is the thing the MD is meant to read before
          forming their own view. */}
      <div className="card-surface space-y-2 p-4">
        <h2 className="type-label text-ink-muted">HR&rsquo;s review</h2>
        {report.review.hrSummary ? (
          <>
            <p className="whitespace-pre-wrap font-sans text-body-sm text-ink">
              {report.review.hrSummary}
            </p>
            <p className="font-sans text-body-sm text-ink-muted">
              {report.review.hrRecommendation
                ? RECOMMENDATIONS.find((r) => r.value === report.review.hrRecommendation)?.label
                : ""}
              {report.review.hrReviewedByName ? ` · ${report.review.hrReviewedByName}` : ""}
              {report.review.hrReviewedAt ? ` · ${formatDateTime(report.review.hrReviewedAt)}` : ""}
            </p>
          </>
        ) : (
          <p className="font-sans text-body-sm text-ink-muted">HR has not written a summary yet.</p>
        )}
      </div>

      <div className="card-surface space-y-4 p-4">
        <div className="space-y-1">
          <h2 className="flex items-baseline gap-2 font-sans text-body font-medium text-ink">
            Your remarks
            {/* Said on the field, not discovered by pressing Approve. A control
                whose rules only appear as an error after the click is §13.4's
                dead end wearing a friendlier face. */}
            <span className="font-sans text-body-sm font-normal text-ink-muted">optional</span>
          </h2>
          <p className="font-sans text-body-sm text-ink-muted">
            Anything you write is kept with the record. Approving without it is fine — the approval
            is still dated and attributed to you.
          </p>
        </div>

        {error ? <Notice tone="error">{error}</Notice> : null}

        <Textarea
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          rows={5}
          disabled={!atMd}
          maxLength={4000}
          aria-label="Management remarks (optional)"
          placeholder="Anything the record should carry. Leave blank to approve without a note."
        />

        {atMd ? (
          <div className="space-y-2">
            <Button type="button" className="min-h-11 w-full" disabled={busy} onClick={onApprove}>
              {busy ? "Working…" : "Approve"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 w-full"
              disabled={busy}
              onClick={() => setBackOpen(true)}
            >
              Send back to HR
            </Button>
          </div>
        ) : (
          <p className="rounded-control border border-rule bg-surface-mute px-3 py-2 font-sans text-body-sm text-ink-muted">
            {report.header.status === "PENDING_HR_REVIEW"
              ? "HR is still reviewing this. It comes to you when they send it."
              : "This report is not at your stage."}
          </p>
        )}

        <PrintActions evaluationId={report.evaluationId} />
      </div>

      <Dialog open={backOpen} onOpenChange={setBackOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send back to HR</DialogTitle>
            <DialogDescription>HR will be told, with your reason word for word.</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="md_reason" className="type-label text-ink-muted">
              Reason
            </Label>
            <Textarea
              id="md_reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              placeholder="What needs to change?"
            />
            <p className="font-sans text-body-sm text-ink-muted">
              At least {MIN_REASON_LENGTH} characters.
            </p>
            {error ? <Notice tone="error">{error}</Notice> : null}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setBackOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={onSendBack} disabled={busy || reason.trim().length < MIN_REASON_LENGTH}>
              {busy ? "Sending…" : "Send it back"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
