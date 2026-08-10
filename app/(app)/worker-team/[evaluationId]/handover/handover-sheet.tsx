"use client";

/** The hand-over sheet. One sitting, no draft, and nothing readable afterwards. */

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Send } from "lucide-react";

import { FormLetterhead } from "@/components/appraise/form-letterhead";
import { SubmittedDialog } from "@/components/appraise/submitted-dialog";
import { TickScale } from "@/components/appraise/tick-scale";
import { Button } from "@/components/ui/button";
import { submitHandover } from "@/lib/worker/handover";
import type { WorkerTick } from "@/lib/worker/form";

export type HandoverQuestion = {
  questionId: string;
  text: string;
  helpText: string | null;
  isRequired: boolean;
};

/**
 * NO DRAFT SAVING, deliberately, and this is the one place that rule differs
 * from every other form in the product (§13.6 autosaves everything).
 *
 * A saved draft would sit on the supervisor's device, in their session, between
 * one hand-over and the next — readable by whoever holds the tablet. The whole
 * point of this screen is that the worker answers without their supervisor
 * seeing, so the answers exist only in this page's memory until they are
 * submitted, and after that only HR and management can read them.
 *
 * The cost is real and worth naming: a worker who closes the page loses their
 * ticks and starts again. Eight taps is a price worth paying for the guarantee;
 * a thirty-question form would not be.
 */
export function HandoverSheet({
  evaluationId,
  workerName,
  questions,
}: {
  evaluationId: string;
  workerName: string;
  questions: HandoverQuestion[];
}) {
  const router = useRouter();
  const [answers, setAnswers] = React.useState<Record<string, WorkerTick>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const [thanked, setThanked] = React.useState(false);

  const answered = questions.filter((q) => answers[q.questionId]).length;

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await submitHandover(evaluationId, answers);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setDone(true);
    setThanked(true);
  }

  /* -- What the SUPERVISOR sees when the device comes back.
        A confirmation and nothing else — no summary, no count by rating, no
        "you can review it below". §5 is enforced in the database, and this is
        the screen where it would be easiest to undo by accident. -- */
  if (done) {
    return (
      <>
        <div className="mx-auto max-w-form space-y-5 py-10 text-center">
          <CheckCircle2 className="mx-auto size-12 text-success" aria-hidden />
          <h1 className="text-display-sm font-semibold text-ink">Thank you</h1>
          <p className="font-sans text-body text-ink-muted">
            {workerName}&rsquo;s answers are recorded. They are sealed — not even their supervisor
            can read them. Only HR and management see both sides.
          </p>
          <Button onClick={() => router.push("/worker-team")} className="min-h-11">
            Back to the shop floor
          </Button>
        </div>

        {/* -- THE SAME GREETING EVERY OTHER FORM GIVES, and it rides ON TOP of
              the replacement page rather than replacing it.

              The three other forms show this dialog over their own form, which
              is fine because the person who filled it in is the person still
              looking at it. This one is a SHARED DEVICE: the worker ticks the
              sheet and hands the tablet straight back to their supervisor, so
              the page underneath must already be scrubbed of the answers before
              anything is shown over it. A dialog alone would leave the worker's
              ticks sitting behind a translucent overlay for the supervisor to
              read — §5, breached by a courtesy.

              So the page still replaces itself, and the greeting sits on top of
              a screen that is already safe. Addressed to the worker, because
              they are the one still holding it when it appears; the page behind
              is the supervisor's hand-back screen. -- */}
        <SubmittedDialog
          open={thanked}
          onOpenChange={setThanked}
          tier="self"
          title="Thank you — that is your sheet in."
          body={`Your answers are sealed, ${workerName}. Nobody on the floor can read them — only HR and management, alongside your supervisor's separate ratings. Please hand the device back.`}
          actionLabel="Done"
          onAction={() => setThanked(false)}
        />
      </>
    );
  }

  return (
    <div className="mx-auto max-w-form space-y-5 pb-24 lg:pb-6">
      <header className="rounded-card-lg bg-ink p-4 sm:p-5">
        <FormLetterhead tone="dark" className="mb-3" />
        {/* Addressed to the WORKER, because they are the one holding it now. */}
        <p className="font-sans text-display-sm text-ink-invert">{workerName}, this is your sheet</p>
        <p className="mt-1 font-sans text-body-sm text-ink-invert/70">
          Tick how you feel you have done. Your supervisor cannot see your answers.
        </p>
        <p className="tabular mt-3 font-sans text-body-sm text-ink-invert/70">
          {answered} of {questions.length} ticked
        </p>
      </header>

      <p className="rounded-card bg-warning-tint px-4 py-3 font-sans text-body-sm text-ink">
        Finish in one go. There is no save — your answers are only recorded when you press Submit,
        and that is what keeps them private.
      </p>

      <div className="card-surface divide-y divide-rule p-0">
        {questions.map((question) => (
          <div key={question.questionId} className="space-y-3 p-4 sm:p-5">
            <p className="font-sans text-body-lg text-ink">
              {question.text}
              {question.isRequired ? (
                <span className="ml-1 text-critical" aria-hidden>
                  *
                </span>
              ) : null}
            </p>
            {question.helpText ? (
              <p className="hidden font-sans text-body-sm text-ink-muted sm:block">
                {question.helpText}
              </p>
            ) : null}

            <TickScale
              value={answers[question.questionId] ?? null}
              onChange={(next) =>
                setAnswers((prev) => ({ ...prev, [question.questionId]: next as WorkerTick }))
              }
              tier="self"
              label={question.text}
              name={question.questionId}
            />
          </div>
        ))}
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-card bg-critical-tint px-4 py-3 font-sans text-body-sm text-critical"
        >
          {error}
        </p>
      ) : null}

      <div className="glass fixed inset-x-0 bottom-0 z-20 flex h-16 items-center gap-3 border-t border-rule px-4 lg:static lg:h-auto lg:border-0 lg:bg-transparent lg:px-0">
        <p className="font-sans text-body-sm text-ink-muted">Hand the device back after this.</p>
        <Button
          className="ml-auto min-h-11"
          onClick={() => void submit()}
          disabled={busy || answered === 0}
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
          Submit
        </Button>
      </div>
    </div>
  );
}
