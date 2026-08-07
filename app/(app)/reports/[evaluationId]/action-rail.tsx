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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MIN_REASON_LENGTH } from "@/lib/evaluations/transitions";
import {
  closeEvaluation,
  mdApprove,
  mdSendBack,
  returnForChanges,
  saveHrReview,
  sendToMd,
} from "@/lib/reports/actions";
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
          <Textarea
            id="hr_summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={5}
            disabled={!atHr}
            placeholder="What should the MD know before they read this?"
          />
          <p className="font-sans text-body-sm text-ink-muted">
            Required before this can go to the MD.
          </p>
        </div>

        <fieldset className="space-y-2" disabled={!atHr}>
          <legend className="type-label pb-1 text-ink-muted">Recommendation</legend>
          {RECOMMENDATIONS.map((option) => (
            <label
              key={option.value}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-3 rounded-control border px-3",
                recommendation === option.value
                  ? "border-primary/40 bg-accent"
                  : "border-rule bg-surface",
                !atHr && "cursor-default opacity-70",
              )}
            >
              <input
                type="radio"
                name="hr_recommendation"
                value={option.value}
                checked={recommendation === option.value}
                onChange={() => setRecommendation(option.value)}
                className="size-4"
              />
              <span className="font-sans text-body text-ink">{option.label}</span>
            </label>
          ))}
        </fieldset>

        {atHr ? (
          <div className="space-y-2">
            {/* One primary action (§13.3). */}
            <Button type="button" className="min-h-11 w-full" disabled={busy} onClick={onSend}>
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
        {reviewed && report.isIncrement ? (
          <p className="rounded-control border border-rule bg-surface-mute px-3 py-2 font-sans text-body-sm text-ink-muted">
            This is an increment cycle. The interview step is added in P21.
          </p>
        ) : null}

        <PrintActions evaluationId={report.evaluationId} />
      </div>

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
        <h2 className="font-sans text-body font-medium text-ink">Your remarks</h2>

        {error ? <Notice tone="error">{error}</Notice> : null}

        <Textarea
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          rows={5}
          disabled={!atMd}
          aria-label="Management remarks"
          placeholder="Your remarks on this report."
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
