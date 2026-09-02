"use client";

/**
 * The supervisor's review of a production appraisal (0100).
 *
 * The team leader's ticks, read-only, and the three things the supervisor
 * records before it reaches HR: a comment, the training tick, and — where they
 * are recommending a rise — a percentage.
 *
 * §5: there is no salary AMOUNT on this screen, and no state that could hold
 * one. The server does not fetch one and no action here accepts one (0064,
 * confirmed again at 0100).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Send } from "lucide-react";

import { FormLetterhead } from "@/components/appraise/form-letterhead";
import { TickScale } from "@/components/appraise/tick-scale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils/date";
import {
  saveWorkerReview,
  submitWorkerReview,
  type WorkerReviewSheet,
} from "@/lib/worker/review-sheet";

const TICK_WORD: Record<string, string> = {
  EXCELLENT: "Excellent",
  SATISFACTORY: "Satisfactory",
  NEEDS_IMPROVEMENT: "Needs improvement",
};

export function WorkerReviewForm({ sheet }: { sheet: WorkerReviewSheet }) {
  const router = useRouter();

  const [comment, setComment] = React.useState(sheet.comment);
  const [training, setTraining] = React.useState<boolean | null>(sheet.trainingRequired);
  const [salaryChanged, setSalaryChanged] = React.useState(sheet.salaryChanged);
  const [pct, setPct] = React.useState<number | null>(sheet.incrementPct);

  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState<Date | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  const readOnly = !sheet.isOpen;

  const input = React.useMemo(
    () => ({ salaryChanged, incrementPct: pct, comment, trainingRequired: training }),
    [salaryChanged, pct, comment, training],
  );

  async function persist(): Promise<boolean> {
    if (readOnly) return true;
    setBusy(true);
    /* -- Cleared BEFORE the send, not on the response. Clearing it afterwards
          uses the snapshot the request left with, so anything typed while it
          was in flight is marked clean and never sent again (F16-6). -- */
    setDirty(false);
    const result = await saveWorkerReview(sheet.evaluationId, input);
    setBusy(false);
    if (!result.ok) {
      setDirty(true);
      setError(result.error.message);
      return false;
    }
    setSaved(new Date());
    setError(null);
    return true;
  }

  async function send() {
    if (readOnly) return;
    setBusy(true);
    setError(null);
    const result = await submitWorkerReview(sheet.evaluationId, input);
    setBusy(false);
    if (!result.ok) {
      setDirty(true);
      setError(result.error.message);
      return;
    }
    setSent(true);
    router.refresh();
  }

  /* -- What is still missing, worded as the next thing to do rather than as a
        state. The server refuses the same two things (0100 §8) — this is the
        form agreeing with the gate rather than being the gate (§9), and both
        say it in the same words so the form cannot accept what the server then
        rejects (P13-6). -- */
  const blocker =
    training === null
      ? "Say whether training is required before sending this to HR."
      : salaryChanged && !(pct && pct > 0)
        ? "You have recommended a new salary but no percentage. HR has nothing to price without one."
        : null;

  if (sent || sheet.isSent) {
    return (
      <div className="space-y-6">
        <FormLetterhead />
        <div className="card-surface flex items-start gap-3 p-5">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          <div>
            <p className="font-sans text-body-lg text-ink">Sent to HR</p>
            <p className="mt-1 font-sans text-body-sm text-ink-muted">
              {sheet.workerName}&rsquo;s appraisal is with HR now. They price the increment and
              management approves it.
            </p>
          </div>
        </div>
        <Button variant="secondary" className="min-h-11" onClick={() => router.push("/worker-team")}>
          Back to your team
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-40 lg:pb-8">
      <FormLetterhead />

      {/* ---------- Who this is about ---------- */}
      <div className="card-surface p-4 sm:p-5">
        <h1 className="text-display-sm font-semibold text-ink">{sheet.workerName}</h1>
        <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {[
            ["Employee ID", sheet.employeeCode],
            ["Designation", sheet.designation],
            ["Team", sheet.department],
            ["Round", `${sheet.cycleName}${sheet.periodLabel ? ` · ${sheet.periodLabel}` : ""}`],
            ["Rated by", sheet.ratedBy],
            ["Rated on", sheet.ratedAt ? formatDate(sheet.ratedAt) : null],
          ].map(([label, value]) => (
            <div key={label as string} className="flex min-w-0 gap-2">
              <dt className="type-label shrink-0 text-ink-muted">{label}</dt>
              <dd className="min-w-0 font-sans text-body-sm text-ink">{value || "—"}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* ---------- The team leader's ticks, read-only ----------
            The supervisor does not re-rate: they read what the team leader
            recorded and decide what follows from it. Drawn with the shared
            `TickScale` in read-only mode rather than a second renderer, so a
            tick looks the same wherever it is shown (P9-1). */}
      <div className="space-y-4">
        <div>
          <h2 className="font-sans text-body-lg text-ink">
            {sheet.ratedByYou
              ? "What you recorded"
              : `What ${sheet.ratedBy ?? "the team leader"} recorded`}
          </h2>
          <p className="mt-0.5 font-sans text-body-sm text-ink-muted">
            {sheet.ratedByYou
              ? "Your own ratings, as submitted and now locked. Read them back, then record your decision below."
              : "Their ratings, as submitted. You are not re-rating — read them, then record your decision below."}
          </p>
        </div>

        {sheet.rows.map((row) => (
          <div key={row.questionId} className="card-surface space-y-3 p-4 sm:p-5">
            <div>
              <p className="font-sans text-body-lg text-ink">{row.text}</p>
              {row.helpText ? (
                <p className="hidden font-sans text-body-sm text-ink-muted sm:block">
                  {row.helpText}
                </p>
              ) : null}
            </div>
            {row.tick ? (
              <TickScale
                value={row.tick}
                tier="lead"
                readOnly
                label={row.text}
                name={row.questionId}
              />
            ) : (
              <p className="font-sans text-body-sm text-ink-muted">Not answered.</p>
            )}
          </div>
        ))}
      </div>

      {/* -- What the team leader wrote, if anything. Read-only, and above the
            supervisor's own box so it is read before it is answered. Absent
            rather than an empty card when they wrote nothing: a blank box
            headed with somebody's name reads as a comment that failed to
            load. -- */}
      {sheet.raterComment ? (
        <div className="card-surface space-y-2 p-4 sm:p-5">
          <p className="type-label text-ink-muted">
            {sheet.ratedByYou ? "Your comment" : `${sheet.ratedBy ?? "Team leader"}'s comment`}
          </p>
          <p className="whitespace-pre-wrap font-sans text-body text-ink">{sheet.raterComment}</p>
        </div>
      ) : null}

      {/* ---------- The supervisor's own three fields ---------- */}
      <div className="card-surface space-y-5 p-4 sm:p-5">
        <div>
          <p className="font-sans text-body-lg text-ink">Your review</p>
          <p className="mt-0.5 font-sans text-body-sm text-ink-muted">
            Read by HR and management. Never by {sheet.workerName}.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="review_comment">Supervisor comment</Label>
          <Textarea
            id="review_comment"
            value={comment}
            onChange={(e) => {
              setComment(e.target.value);
              setDirty(true);
            }}
            disabled={readOnly}
            rows={4}
            placeholder="Anything worth recording about how they have worked this period."
          />
        </div>

        <fieldset className="space-y-2" disabled={readOnly}>
          <legend className="font-sans text-body font-medium text-ink">Training required</legend>
          <div className="flex gap-2">
            {/* Three states, not two: null is "not answered yet", which is a
                different thing from No and must not default to it. */}
            {[
              { label: "Yes", value: true },
              { label: "No", value: false },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                aria-pressed={training === option.value}
                onClick={() => {
                  setTraining(training === option.value ? null : option.value);
                  setDirty(true);
                }}
                className={cn(
                  "min-h-11 flex-1 rounded-control border px-4 font-sans text-body transition-colors",
                  training === option.value
                    ? "border-lead bg-lead-tint text-ink"
                    : "border-rule bg-surface text-ink-muted hover:bg-surface-mute",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      {/* ---------- Salary ----------
            A PERCENTAGE AND NO AMOUNT. 0064 took the figures away from
            supervisors at the owner's instruction — they do not know what the
            people they rate are paid — and 0100 was checked against that
            decision rather than assuming it had moved. The server has no
            parameter for an amount, so this is not a screen withholding
            something it holds: there is nothing there to withhold. */}
      <div className="card-surface space-y-5 p-4 sm:p-5">
        <div>
          <p className="font-sans text-body-lg text-ink">Salary</p>
          <p className="mt-0.5 font-sans text-body-sm text-ink-muted">
            Your recommendation. HR turns it into money.
          </p>
        </div>

        <fieldset className="space-y-2" disabled={readOnly}>
          <legend className="font-sans text-body font-medium text-ink">After this appraisal</legend>
          <div className="flex gap-2">
            {[
              { label: "Same", value: false },
              { label: "New salary", value: true },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                aria-pressed={salaryChanged === option.value}
                onClick={() => {
                  setSalaryChanged(option.value);
                  if (!option.value) setPct(null);
                  setDirty(true);
                }}
                className={cn(
                  "min-h-11 flex-1 rounded-control border px-4 font-sans text-body transition-colors",
                  salaryChanged === option.value
                    ? "border-lead bg-lead-tint text-ink"
                    : "border-rule bg-surface text-ink-muted hover:bg-surface-mute",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        {salaryChanged ? (
          <div className="space-y-1.5 sm:max-w-xs">
            <Label htmlFor="review_pct">Recommended increment %</Label>
            <Input
              id="review_pct"
              inputMode="decimal"
              disabled={readOnly}
              value={pct ?? ""}
              onChange={(e) => {
                const raw = e.target.value === "" ? null : Number(e.target.value);
                // Out of range reads as absent rather than being clamped: this
                // figure becomes somebody's pay, and a silently corrected 500
                // is worse than a blank (P4-10).
                const next =
                  raw !== null && Number.isFinite(raw) && raw > 0 && raw <= 100 ? raw : null;
                setPct(next);
                setDirty(true);
              }}
              placeholder="e.g. 10"
              className="min-h-11 tabular"
            />
            <p className="font-sans text-body-sm text-ink-muted">
              You are not shown anybody&rsquo;s salary and do not need it to answer this.
            </p>
          </div>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-card bg-critical-tint px-4 py-3 font-sans text-body-sm text-critical"
        >
          {error}
        </p>
      ) : null}

      {readOnly ? (
        <p className="rounded-card bg-surface-mute px-4 py-3 font-sans text-body-sm text-ink-muted">
          This appraisal is no longer with you.
        </p>
      ) : (
        /* -- Its own bar rather than `FormActionBar`: that one counts answered
              questions out of a total, and this screen has none to count. The
              offset is `--bottom-nav-h`, so the buttons sit ABOVE the mobile
              navigation rather than underneath it (F15-1). -- */
        <div
          className="fixed inset-x-0 z-20 border-t border-rule bg-surface/95 px-4 py-3 backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0"
          style={{ bottom: "var(--bottom-nav-h, 0px)" }}
        >
          <div className="mx-auto flex max-w-form flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            {blocker ? (
              <p className="order-last font-sans text-body-sm text-ink-muted sm:order-first sm:mr-auto">
                {blocker}
              </p>
            ) : saved ? (
              <p className="order-last font-sans text-body-sm text-ink-muted sm:order-first sm:mr-auto">
                Saved {saved.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              </p>
            ) : null}

            <Button
              variant="secondary"
              className="min-h-11"
              disabled={busy || !dirty}
              onClick={() => void persist()}
            >
              {busy ? <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden /> : null}
              Save
            </Button>
            <Button className="min-h-11" disabled={busy || blocker !== null} onClick={() => void send()}>
              {busy ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden />
              ) : (
                <Send className="mr-1.5 size-4" aria-hidden />
              )}
              Send to HR
            </Button>
          </div>
        </div>
      )}

      {/* Screen-reader summary of the overall tick, which §11 makes the score. */}
      {sheet.overallTick ? (
        <p className="sr-only">
          Overall performance recorded as {TICK_WORD[sheet.overallTick] ?? sheet.overallTick}.
        </p>
      ) : null}
    </div>
  );
}
