"use client";

/** The three-tick sheet. Draws with the shared TickScale — no second renderer. */

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Send } from "lucide-react";

import { FormLetterhead } from "@/components/appraise/form-letterhead";
import { SubmittedDialog } from "@/components/appraise/submitted-dialog";
import { TickScale } from "@/components/appraise/tick-scale";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  saveWorkerSheet,
  submitWorkerSheet,
  type WorkerSheet,
  type WorkerTick,
} from "@/lib/worker/form";
import { formatDate } from "@/lib/utils/date";

/*
 * ONE RENDERER RULE, honoured across the module boundary. `TickScale` is a UI
 * primitive — the same distinction P9-3 drew when the department preview was
 * made to return the identical shape so one component could draw both. What §7
 * forbids is reusing staff LOGIC: nothing here calls `getEvaluationForm`,
 * `buildZodSchema` or `computeScores`, and a tick sheet has none of the things
 * those exist for.
 */
export function WorkerSheetForm({ sheet }: { sheet: WorkerSheet }) {
  const router = useRouter();
  const [answers, setAnswers] = React.useState<Record<string, WorkerTick>>(sheet.answers);
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState<Date | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [thanked, setThanked] = React.useState(false);
  const [comment, setComment] = React.useState(sheet.overallComment);
  const [training, setTraining] = React.useState<boolean | null>(sheet.trainingRequired);

  const isSelf = sheet.layer === "SELF";
  const readOnly = !sheet.isOpen;

  const answered = sheet.questions.filter((q) => answers[q.questionId]).length;

  function tick(questionId: string, value: WorkerTick) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    setError(null);
  }

  async function save() {
    setBusy(true);
    const result = await saveWorkerSheet(sheet.evaluationId, answers, {
      overallComment: comment,
      trainingRequired: training,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setSaved(new Date(result.data.savedAt));
    setError(null);
  }

  async function submit() {
    setBusy(true);
    const result = await submitWorkerSheet(sheet.evaluationId, answers, {
      overallComment: comment,
      trainingRequired: training,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setThanked(true);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-form space-y-5 pb-24 lg:pb-6">
      <header className="rounded-card-lg bg-ink p-4 sm:p-5">
        <FormLetterhead tone="dark" className="mb-3" />
        <p className="font-sans text-display-sm text-ink-invert">
          {/* Named for whose sheet it is. A supervisor may hold several open at
              once, and "Worker appraisal" on all of them is not a heading. */}
          {isSelf ? "Your appraisal" : sheet.workerName}
        </p>
        <p className="mt-1 font-sans text-body-sm text-ink-invert/70">
          {sheet.cycleName} · {sheet.periodLabel}
          {sheet.dueOn ? ` · due ${formatDate(sheet.dueOn)}` : ""}
        </p>
        <p className="tabular mt-3 font-sans text-body-sm text-ink-invert/70">
          {answered} of {sheet.questions.length} ticked
          {saved ? ` · saved ${formatDate(saved.toISOString())}` : ""}
        </p>
      </header>

      {/* -- The paper form's metadata band.
            Drawn from the profile and the round, never typed: a field somebody
            can edit here is a field that can disagree with the record it came
            from (P12-14, P2-9). Two columns even at 375px — six short values in
            one column is most of a phone screen before the first question. -- */}
      <dl className="card-surface grid grid-cols-2 gap-x-4 gap-y-3 p-4 sm:p-5">
        <div>
          <dt className="type-label text-ink-muted">Worker</dt>
          <dd className="font-sans text-body text-ink">{sheet.workerName}</dd>
        </div>
        <div>
          <dt className="type-label text-ink-muted">Period</dt>
          <dd className="font-sans text-body text-ink">{sheet.periodLabel || "—"}</dd>
        </div>
        <div>
          <dt className="type-label text-ink-muted">Department</dt>
          <dd className="font-sans text-body text-ink">{sheet.department ?? "—"}</dd>
        </div>
        <div>
          <dt className="type-label text-ink-muted">Designation</dt>
          <dd className="font-sans text-body text-ink">{sheet.designation ?? "—"}</dd>
        </div>
        <div className="col-span-2">
          <dt className="type-label text-ink-muted">Supervisor</dt>
          <dd className="font-sans text-body text-ink">{sheet.supervisorName ?? "—"}</dd>
        </div>
      </dl>

      {/* -- Said once, plainly, on both sides.
            The worker should know their supervisor is filling one too and that
            neither will read the other's; the supervisor should know the same.
            Said in the same words to both, because a difference in wording is
            how one side starts to guess at the other's. -- */}
      <p className="rounded-card bg-accent px-4 py-3 font-sans text-body-sm text-accent-foreground">
        {isSelf
          ? "Your supervisor is filling in the same sheet about you at the same time. Neither of you sees the other's ticks — only HR and management see both."
          : `${sheet.workerName} is filling in the same sheet about themselves at the same time. Neither of you sees the other's ticks — only HR and management see both.`}
      </p>

      {sheet.isSubmitted ? (
        <p className="flex items-center gap-2 rounded-card bg-success-tint px-4 py-3 font-sans text-body-sm text-ink">
          <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
          This is in. It cannot be changed now.
        </p>
      ) : null}

      <div className="card-surface divide-y divide-rule p-0">
        {sheet.questions.map((question) => (
          <div key={question.questionId} className="space-y-3 p-4 sm:p-5">
            <div>
              <p className="font-sans text-body-lg text-ink">
                {question.text}
                {question.isRequired ? (
                  <span className="ml-1 text-critical" aria-hidden>
                    *
                  </span>
                ) : null}
              </p>
              {/* Guidance is desktop-only, as on the staff form: a line of
                  explanation under every quality is a screenful on a phone. */}
              {question.helpText ? (
                <p className="hidden font-sans text-body-sm text-ink-muted sm:block">
                  {question.helpText}
                </p>
              ) : null}
            </div>

            <TickScale
              value={answers[question.questionId] ?? null}
              onChange={(next) => tick(question.questionId, next as WorkerTick)}
              /* The tier says WHO is rating, and it means the same here as
                 everywhere else (§13.1): cyan for the person's own view, pink
                 for the person above them. */
              tier={isSelf ? "self" : "lead"}
              readOnly={readOnly}
              label={question.text}
              name={question.questionId}
            />
          </div>
        ))}
      </div>

      {/* -- The two fields the paper form asks the SUPERVISOR for and nobody
            else. Not on the worker's sheet at all — not rendered and ignored,
            not rendered — and stored on the supervisor's response row, so the
            worker cannot read them however the screen changes later. -- */}
      {!isSelf ? (
        <div className="card-surface space-y-5 p-4 sm:p-5">
          <div className="space-y-2">
            <Label htmlFor="worker_comment">Supervisor comment</Label>
            <Textarea
              id="worker_comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
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
                  onClick={() => setTraining(training === option.value ? null : option.value)}
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
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-card bg-critical-tint px-4 py-3 font-sans text-body-sm text-critical"
        >
          {error}
        </p>
      ) : null}

      {!readOnly ? (
        <div className="glass fixed inset-x-0 bottom-0 z-20 flex h-16 items-center gap-3 border-t border-rule px-4 lg:static lg:h-auto lg:border-0 lg:bg-transparent lg:px-0 lg:py-0">
          <Button
            variant="ghost"
            className="min-h-11 flex-1 lg:flex-none"
            onClick={() => void save()}
            disabled={busy}
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Save draft
          </Button>
          <Button
            className="min-h-11 flex-1 lg:ml-auto lg:flex-none"
            onClick={() => void submit()}
            disabled={busy}
          >
            <Send className="size-4" aria-hidden />
            Submit
          </Button>
        </div>
      ) : null}

      <SubmittedDialog
        open={thanked}
        onOpenChange={setThanked}
        tier={isSelf ? "self" : "lead"}
        title="Thank you — that is in."
        body={
          isSelf
            ? "HR will read your answers alongside your supervisor's ratings. Nothing more is needed from you."
            : `Your ratings for ${sheet.workerName} are recorded. HR will read them alongside their own answers.`
        }
        actionLabel="Done"
        onAction={() => setThanked(false)}
      />
    </div>
  );
}
