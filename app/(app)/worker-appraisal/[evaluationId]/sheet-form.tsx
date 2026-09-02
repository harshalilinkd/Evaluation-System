"use client";

/** The three-tick sheet. Draws with the shared TickScale — no second renderer. */

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Send } from "lucide-react";

import { FormActionBar } from "@/components/appraise/form-action-bar";
import { FormLetterhead } from "@/components/appraise/form-letterhead";
import { SubmittedDialog } from "@/components/appraise/submitted-dialog";
import { TickScale } from "@/components/appraise/tick-scale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  saveWorkerSalary,
  saveWorkerSheet,
  submitWorkerCombined,
  submitWorkerSheet,
  type WorkerSheet,
  type WorkerTick,
} from "@/lib/worker/form";
import { saveWorkerReview } from "@/lib/worker/review-sheet";
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
  /* -- Its own state, not `error`. A refused pay figure and a refused
        appraisal are different failures with different fixes, and sharing one
        slot is what let the salary message stand in front of a sheet that had
        actually saved. -- */
  const [salaryError, setSalaryError] = React.useState<string | null>(null);
  const [thanked, setThanked] = React.useState(false);
  const [comment, setComment] = React.useState(sheet.overallComment);
  const [training, setTraining] = React.useState<boolean | null>(sheet.trainingRequired);
  const [saveState, setSaveState] = React.useState<"idle" | "saving" | "saved" | "error">("idle");

  /* -- The salary block. Present only when the server sent one, which happens
        only for a supervisor or an administrator (0051) — a worker's sheet has
        `salary: null` and this state is never used. -- */
  /* -- `withPct` is GONE with the two amounts it derived from. The percentage
        is no longer a consequence of an old and a new salary the supervisor
        typed — it is the only thing they enter, and HR turns it into money
        against a figure the supervisor is not shown (0064). -- */

  const [salary, setSalary] = React.useState(
    sheet.salary ?? { salaryChanged: false, oldCtc: null, incrementPct: null, newCtc: null },
  );

  const isSelf = sheet.layer === "SELF";
  const readOnly = !sheet.isOpen;

  const answered = sheet.questions.filter((q) => answers[q.questionId]).length;

  function tick(questionId: string, value: WorkerTick) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    setDirty(true);
    setError(null);
  }

  /* -- AUTOSAVE. §13.6: never lose a half-filled form.
        This screen had none — ticks lived in the page until somebody pressed
        Save draft, so a refresh threw the lot away. That is the same class of
        loss FIX-3 and FIX-4 fixed on the staff form, arriving here because this
        one was written fresh rather than from that one.

        The hand-over sheet still has none, and that is deliberate rather than
        an oversight: a draft there would sit in the SUPERVISOR's session
        between hand-overs, readable by whoever holds the tablet. -- */
  /* -- AUTOSAVE. §13.6: never lose a half-filled form.
        This screen had none — ticks lived in the page until somebody pressed
        Save draft, so a refresh threw the lot away. Same class of loss FIX-3
        and FIX-4 fixed on the staff form, arriving here because this one was
        written fresh rather than from that one.

        DEBOUNCED ON STATE, with no refs. The first version mirrored every field
        into a ref so a 15-second interval could read the latest values without
        being torn down — and `react-hooks/immutability` refused it, because a
        ref captured by a hook may not then be written to. It was also more
        machinery than the problem needs: eight ticks and three fields settle in
        under a second, so waiting for a pause and saving is both simpler and
        has no stale closure to get wrong.

        The hand-over sheet still has NO autosave, and that stays deliberate: a
        draft there would sit in the supervisor's session between hand-overs,
        readable by whoever holds the tablet. -- */
  const [dirty, setDirty] = React.useState(false);
  /* -- The PROMISE, not a boolean.
        `if (inFlight.current) return true` claimed the server was up to date
        when nothing had been sent — and Submit reads that return value to
        decide whether it may go ahead. Holding the promise lets a second
        caller wait for the first instead of being lied to. -- */
  const inFlight = React.useRef<Promise<boolean> | null>(null);

  const persist = React.useCallback(async (): Promise<boolean> => {
    if (readOnly) return true;

    // Wait out a save already on the wire, then send the CURRENT state on top
    // of it. Two sends is harmless — each carries the whole sheet.
    const running = inFlight.current;
    if (running) await running;

    setSaveState("saving");

    /* -- CLEARED BEFORE THE SEND, and that is the fix for a lost tick.
          It used to be cleared after the response came back, using the answers
          captured when the request left. A tick made while that request was in
          flight set `dirty` — and the completing save then cleared it, so the
          debounce effect saw a clean form and never scheduled another send.
          The tick stayed on screen and never reached the server.

          Clearing at the moment the snapshot is taken inverts that: anything
          typed after this line re-dirties the form and is picked up by the next
          debounce. -- */
    setDirty(false);

    /* -- The await is GUARDED. A rejected promise — a dropped connection, a
          500 — would otherwise skip the cleanup and every line after it,
          leaving the ref set for the life of the page so nothing was ever sent
          again. That is precisely what happened on the staff form (FIX-12);
          `finally` is what makes it honest.

          Wrapped in a promise the ref can HOLD, so a second caller joins this
          write rather than starting a racing one — two whole-sheet writes
          landing out of order would let a stale snapshot overwrite a newer. -- */
    const run = (async (): Promise<boolean> => {
    try {
      const result = await saveWorkerSheet(
        sheet.evaluationId,
        answers,
        // Dropped on the combined path — they are written above instead, and
        // sending them twice would put one answer in two places.
        sheet.alsoDecides ? undefined : { overallComment: comment, trainingRequired: training },
      );
      if (!result.ok) {
        setSaveState("error");
        setError(result.error.message);
        // Refused, so the form is still unsaved — see the note above.
        setDirty(true);
        return false;
      }

      /* -- THE TICKS ARE SAVED AT THIS POINT, so that is recorded FIRST and
            unconditionally.

            This used to sit after the salary call, and a salary refusal
            returned `false` — so `setDirty(false)` never ran, `dirty` stayed
            true for the life of the page, and Submit (`if (dirty &&
            !(await persist())) return;`) became a permanent no-op. The
            supervisor had a complete sheet, correctly saved, and a Submit
            button that did nothing, for ever, with a message about salary.

            It fires easily: `saveWorkerSalary` refuses a new figure below the
            old one, so typing the new salary before correcting the old one is
            enough. And §5 puts the salary block on every SUPERVISOR sheet
            whether or not that supervisor may write it, so a policy refusal
            reaches this branch on every autosave.

            Two writes, two tables, two policies — so two outcomes. A failure
            to record pay must never be reported as a failure to record the
            appraisal, and must never block submitting one.

            NOTE: `setDirty(false)` is deliberately NOT repeated here. It now
            runs before the send, and clearing it again on the response would
            re-create the lost-tick race — a tick made while this request was
            in flight would be marked clean without ever having been sent. -- */
      setSaveState("saved");
      setSaved(new Date(result.data.savedAt));
      setError(null);

      /* -- WHERE THE THREE FIELDS GO (0101).
            The rater who is also the supervisor writes them to
            `worker_evaluation_decisions`, exactly as a separate supervisor
            does — one storage location whoever filled them, and the only one
            they can read back. 0064 lets a supervisor WRITE the legacy salary
            block and not READ it, so the older path below can store a
            percentage it cannot show again; that is why this branch exists. -- */
      if (sheet.alsoDecides) {
        const reviewResult = await saveWorkerReview(sheet.evaluationId, {
          salaryChanged: salary.salaryChanged,
          incrementPct: salary.incrementPct,
          comment,
          trainingRequired: training,
        });
        setSalaryError(reviewResult.ok ? null : reviewResult.error.message);
      } else if (sheet.salary) {
        const salaryResult = await saveWorkerSalary(sheet.evaluationId, salary);
        setSalaryError(salaryResult.ok ? null : salaryResult.error.message);
      }

      return true;
    } catch {
      setSaveState("error");
      setError("The connection dropped before your ticks reached us. They are still on screen.");
      // Put the flag back: this snapshot never landed, so the form IS dirty.
      setDirty(true);
      return false;
    }
    })();

    inFlight.current = run;
    try {
      return await run;
    } finally {
      // Only if it is still ours: a later persist may already own the slot.
      if (inFlight.current === run) inFlight.current = null;
    }
  }, [readOnly, sheet.evaluationId, sheet.salary, sheet.alsoDecides, answers, comment, training, salary]);

  // Save once the person stops for a moment.
  React.useEffect(() => {
    if (!dirty || readOnly) return;
    const timer = setTimeout(() => void persist(), 1200);
    return () => clearTimeout(timer);
  }, [dirty, readOnly, persist]);

  /* -- `visibilitychange`, not only `beforeunload`. iOS Safari does not
        reliably fire unload when an app is backgrounded — which is exactly when
        somebody on a phone leaves a form (P12-11). -- */
  React.useEffect(() => {
    if (!dirty || readOnly) return;
    const flush = () => void persist();
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("beforeunload", flush);
    };
  }, [dirty, readOnly, persist]);

  async function save() {
    setBusy(true);
    await persist();
    setBusy(false);
  }

  /* -- 0101: what is still missing on a form that both rates AND decides.
        The same two rules `submit_worker_combined` enforces, in the same words,
        so the form cannot accept what the server then rejects (P13-6). Said
        before the press rather than only after it (§13.4); the button stays
        live because `FormActionBar` is shared with the staff forms and one
        caller's rule does not belong in it. -- */
  const decisionBlocker = !sheet.alsoDecides
    ? null
    : training === null
      ? "Say whether training is required before sending this to HR."
      : salary.salaryChanged && !(salary.incrementPct && salary.incrementPct > 0)
        ? "You have recommended a new salary but no percentage. HR has nothing to price without one."
        : null;

  async function submit() {
    setBusy(true);
    /* -- If the draft never reached the server, say so rather than submitting
          a copy the server does not have — which is how "N still need a tick"
          reaches somebody looking at a full form (FIX-3). -- */
    if (dirty && !(await persist())) {
      setBusy(false);
      return;
    }
    /* -- ONE PRESS, at the owner's instruction, where the same person rates
          and decides: the ticks, the comment, the training tick and the
          percentage all commit together and it goes straight to HR. There is
          no second screen for them, because there is no hand-over. -- */
    const result = sheet.alsoDecides
      ? await submitWorkerCombined(sheet.evaluationId, answers, {
          salaryChanged: salary.salaryChanged,
          incrementPct: salary.incrementPct,
          comment,
          trainingRequired: training,
        })
      : await submitWorkerSheet(sheet.evaluationId, answers, {
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
        <p className="mt-1 font-sans text-body-sm text-ink-invert-muted">
          {sheet.cycleName} · {sheet.periodLabel}
          {sheet.dueOn ? ` · due ${formatDate(sheet.dueOn)}` : ""}
        </p>
        {/* -- The save state, where somebody filling the form can see it.
              §13.6 asks for a visible "Saved HH:MM"; the point of showing the
              failure is that a form which has quietly stopped saving looks
              identical to one that is saving fine. -- */}
        <p className="tabular mt-3 font-sans text-body-sm text-ink-invert-muted">
          {answered} of {sheet.questions.length} ticked
          {saveState === "saving"
            ? " · saving…"
            : saveState === "error"
              ? " · not saved"
              : saved
                ? ` · saved ${saved.toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                    timeZone: "Asia/Kolkata",
                  })}`
                : ""}
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

      {/* -- What happens to it, said once.
            The worker fills nothing and sees nothing: this is the paper tick
            sheet, which has one column and a Supervisor Signature under it. -- */}
      <p className="rounded-card bg-accent px-4 py-3 font-sans text-body-sm text-accent-foreground">
        You are rating {sheet.workerName}. HR reads this afterwards; it is not shown to them.
      </p>

      {sheet.isSubmitted ? (
        <p className="flex items-center gap-2 rounded-card bg-success-tint px-4 py-3 font-sans text-body-sm text-ink">
          <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
          This is in. It cannot be changed now.
        </p>
      ) : null}

      <div className="card-surface divide-y divide-rule p-0">
        {sheet.questions.map((question, index) => (
          /* -- A HOVER STATE, and a number.
                The hover is the row saying it is one thing: eight qualities on
                one card surface with only a hairline between them read as a
                wall, and the tint under the pointer is what separates the row
                being answered from the seven around it. Pointer only — there is
                no hover on a phone, and `focus-within` covers the keyboard,
                which is the reader §13.8 is actually about.

                The number matches the printed sheet's Sr. column. A supervisor
                may well have the paper form beside them, and "3" against
                Attendance in both places is what makes the two the same
                document. -- */
          <div
            key={question.questionId}
            className="space-y-3 p-4 transition-colors focus-within:bg-surface-mute sm:p-5 lg:hover:bg-surface-mute"
          >
            <div className="flex gap-3">
              <span
                aria-hidden
                className="tabular mt-0.5 shrink-0 font-sans text-body-sm text-ink-faint"
              >
                {index + 1}.
              </span>
              <div className="min-w-0 flex-1">
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
      ) : null}

      {/* -- The salary block (0051).
            Rendered only when the server sent one. §5 confines salary to HR and
            the MD; 0051 admits the worker's own supervisor as well, at the
            owner's instruction and for this module only. The WORKER never sees
            it — not by this condition, but because no policy admits them to the
            row, so there is nothing to render. -- */}
      {sheet.salary ? (
        <div className="card-surface space-y-5 p-4 sm:p-5">
          <div>
            <p className="font-sans text-body-lg text-ink">Salary</p>
            <p className="mt-0.5 font-sans text-body-sm text-ink-muted">
              Seen by you, HR and management. Never by {sheet.workerName}.
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
                  aria-pressed={salary.salaryChanged === option.value}
                  onClick={() => {
                    setSalary((s) => ({ ...s, salaryChanged: option.value }));
                    setDirty(true);
                  }}
                  className={cn(
                    "min-h-11 flex-1 rounded-control border px-4 font-sans text-body transition-colors",
                    salary.salaryChanged === option.value
                      ? "border-lead bg-lead-tint text-ink"
                      : "border-rule bg-surface text-ink-muted hover:bg-surface-mute",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          {/* -- THE PERCENTAGE IS THE INPUT NOW, AND THE AMOUNTS ARE GONE.

                A supervisor does not know what the people they rate are paid,
                and 0064 makes that structural: their read of the salary block
                is revoked, a column guard refuses any write to an amount, and
                what they read back comes from a view that carries no figure at
                all. Leaving the fields on screen and disabling them would still
                have told them a salary exists and roughly where it sits.

                Worth knowing what was actually lost: the old salary they used
                to type was never auto-filled. That read runs on the
                supervisor's session and `employment_records` admits only HR and
                the MD, so it has never once returned a row — the figure was
                recalled from memory and checked against nothing.

                The percentage used to be DERIVED from the two amounts and shown
                read-only. It is now the one thing they enter, so it is a real
                field: HR turns it into money against a salary the supervisor
                cannot see. -- */}
          {salary.salaryChanged ? (
            <div className="space-y-1.5 sm:max-w-xs">
              <Label htmlFor="w_pct">Recommended increment %</Label>
              <Input
                id="w_pct"
                inputMode="decimal"
                disabled={readOnly}
                value={salary.incrementPct ?? ""}
                onChange={(e) => {
                  const raw = e.target.value === "" ? null : Number(e.target.value);
                  // Out of range reads as absent rather than being clamped: this
                  // figure becomes somebody's pay, and a silently corrected 500
                  // is worse than a blank (P4-10).
                  const pct = raw !== null && Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : null;
                  setSalary((s) => ({ ...s, incrementPct: pct, oldCtc: null, newCtc: null }));
                  setDirty(true);
                }}
                placeholder="e.g. 10"
                className="min-h-11 tabular"
              />
              <p className="font-sans text-body-sm text-ink-muted">
                Your recommendation. HR works out the amount — you are not shown
                anybody&rsquo;s salary and do not need it to answer this.
              </p>
            </div>
          ) : null}
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

      {/* Named, so it cannot be read as "the appraisal did not save" — and it
          says plainly that the ticks are safe, because the commonest way to
          reach this is a salary typo on a sheet that is otherwise complete. */}
      {salaryError ? (
        <p
          role="alert"
          className="rounded-card bg-warning-tint px-4 py-3 font-sans text-body-sm text-ink"
        >
          <span className="font-medium">The salary block was not saved.</span> {salaryError} Your
          ticks are saved and you can still submit the appraisal.
        </p>
      ) : null}

      {/* Offset by the nav's height, for the same reason as the employee's
          form: `BottomNav` is fixed at `bottom-0` and `z-40`, so a bar at
          `bottom-0 z-20` is covered by it and Save draft / Submit cannot be
          reached on a phone. A supervisor fills this ON the shop floor, on a
          handset — this bar being hidden is indistinguishable from the form
          refusing to save. */}
      {!readOnly ? (
        <>
          {/* -- THE PHONE'S BAR CARRIES THE COUNT NOW.
                A supervisor fills this ON the shop floor, on a handset — and
                the "6 of 8 ticked · saved 15:58" lived in the header at the
                top of the page, gone after the first swipe. This is the same
                component the employee's and the manager's forms use, so the
                three cannot drift apart in spacing or in when Save is
                disabled.

                The tier is `lead`: this sheet is filled in by the supervisor,
                who is this module's lead, and §13.1 reserves the hue for whose
                rating it is. A worker filling their own is the retired
                hand-over path (WORKER-1) and still reads correctly — the
                progress is theirs either way, and the alternative would be a
                third tier this module does not have. -- */}
          {decisionBlocker ? (
            <p className="mb-3 rounded-card bg-surface-mute px-4 py-3 font-sans text-body-sm text-ink-muted">
              {decisionBlocker}
            </p>
          ) : null}

          <FormActionBar
            answered={answered}
            total={sheet.questions.length}
            saveState={saveState}
            savedAt={saved}
            onSave={() => void save()}
            onSubmit={() => void submit()}
            busy={busy}
            tier="lead"
          />

          {/* The laptop keeps an inline bar in the flow rather than a fixed
              strip: there is no bottom navigation to clear and nothing to
              scroll past, so a floating bar there is chrome over a page that
              has room for it. */}
          <div className="hidden gap-3 lg:flex">
            <Button
              variant="ghost"
              className="min-h-11"
              onClick={() => void save()}
              disabled={busy}
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Save draft
            </Button>
            <Button className="ml-auto min-h-11" onClick={() => void submit()} disabled={busy}>
              <Send className="size-4" aria-hidden />
              Submit
            </Button>
          </div>
        </>
      ) : null}

      <SubmittedDialog
        open={thanked}
        onOpenChange={setThanked}
        tier={isSelf ? "self" : "lead"}
        title="Thank you — that is in."
        body={
          isSelf
            ? "HR will read your answers alongside your supervisor's ratings. Nothing more is needed from you."
            : sheet.hasReviewer
              ? /* -- 0100: it does not go to HR from here. Saying so would tell
                     the team leader their part was the last one, and the first
                     they would hear otherwise is somebody asking them about a
                     training tick they were never shown. -- */
                `Your ratings for ${sheet.workerName} are recorded. Their supervisor reviews them next and decides on training and any increment.`
              : sheet.alsoDecides
                ? `Your ratings and your decision for ${sheet.workerName} are recorded and are with HR. Nothing more is needed from you.`
                : `Your ratings for ${sheet.workerName} are recorded. HR will read them alongside their own answers.`
        }
        actionLabel="Done"
        onAction={() => setThanked(false)}
      />
    </div>
  );
}
