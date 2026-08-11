"use client";

/** The self-evaluation form. P12 screen 2 — mobile-first, autosaving, one renderer. */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Loader2, Lock, RotateCcw, Send } from "lucide-react";

import { FormLetterhead } from "@/components/appraise/form-letterhead";
import { ScaleLegend } from "@/components/appraise/rating-scale";
import { FormRenderer } from "@/components/appraise/form-renderer";
import { SubmittedDialog } from "@/components/appraise/submitted-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { monthlyFromAnnual } from "@/lib/increment/calc";
import { saveSelfDraft, submitSelfEvaluation } from "@/lib/evaluations/self-actions";
import {
  clearDraft,
  draftKey,
  forgetMountDraft,
  mountDraftSnapshot,
  noDraftOnServer,
  subscribeToNothing,
  unsavedFrom,
  writeDraft,
} from "@/lib/forms/draft-cache";
import { buildZodSchema, isBlank, validateAnswers } from "@/lib/forms/zod-generator";
import { SECTION_LABELS } from "@/lib/forms/labels";
import type { FormDefinition } from "@/lib/forms/types";
import { cn } from "@/lib/utils";
import { formatDate, formatInr, formatTime } from "@/lib/utils/date";
import { describeSaveFailure } from "@/lib/forms/save-failure";

export type SelfFormMeta = {
  evaluateeName: string;
  leadName: string | null;
  departmentName: string | null;
  designation: string | null;
  cycleName: string;
  periodLabel: string;
  selfDueOn: string | null;
  /** Set when the lead sent it back. Shown above everything else. */
  returnedReason: string | null;
  returnedAt: string | null;
  /** Their OWN current CTC, on an increment cycle only (0040). Null otherwise. */
  currentCtc: number | null;
  isIncrement: boolean;
};

const AUTOSAVE_DEBOUNCE_MS = 800;
const AUTOSAVE_FLUSH_MS = 20_000;


type SaveState = "idle" | "saving" | "saved" | "error";

export function SelfForm({ form, meta }: { form: FormDefinition; meta: SelfFormMeta }) {
  const router = useRouter();

  const [values, setValues] = React.useState<Record<string, unknown>>(form.answers);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saveState, setSaveState] = React.useState<SaveState>("idle");
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);
  const [failures, setFailures] = React.useState(0);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(form.isSubmitted);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  // Shown once, on the submission that just happened — never on a form that was
  // already submitted when the page loaded, which would thank somebody every
  // time they came back to look at it.
  const [thanked, setThanked] = React.useState(false);

  /* -- Locked EITHER because it was submitted, or for one of the reasons the
        save gate carries and the render used to ignore — withdrawn, skipped, or
        moved past OPEN. Without the second half this form rendered fully
        editable and refused every keystroke. -- */
  const readOnly = submitted || form.lockedReason != null;
  // This form collects no per-question comments, so the mirror's comment half
  // is always empty here. Kept in the shared shape rather than given a second
  // storage format — one reader, one writer, one thing to get right.
  const cacheKey = draftKey(form.evaluationId, "SELF");

  /* ---------- Visibility and progress ---------- */

  // Rebuilt whenever an answer changes, because visibility depends on the
  // answers and visibility decides what is required (§6). Memoised on the
  // values so a keystroke in a textarea does not rebuild the whole schema.
  const { activeQuestions, hiddenQuestionIds } = React.useMemo(
    () => buildZodSchema(form, "SELF", values),
    [form, values],
  );

  const answered = activeQuestions.filter((q) => !isBlank(values[q.questionId])).length;
  const total = activeQuestions.length;
  const progress = total > 0 ? Math.round((answered / total) * 100) : 0;

  /* ---------- Autosave ---------- */

  // Pending changes not yet sent. A patch, never the whole object: two saves in
  // flight carrying the whole object can land out of order and lose an answer.
  const pending = React.useRef<Record<string, unknown>>({});
  const inFlight = React.useRef(false);

  /* -- Whether the server holds everything typed so far. A ref, not state, so
        it never enters `flush`'s dependency list — `flush` is what the unload
        listeners and the guaranteed 20-second save are keyed on, and churning
        its identity on every save would restart those timers. -- */
  const inSync = React.useRef(true);

  /** Returns whether the server now holds everything typed so far. */
  /* -- The server's own words, kept.
        This was thrown away, so a refused save showed a four-word indicator in
        a header that is scrolled off-screen on a phone — and the person went on
        filling a form nothing was recording. §0.7: fail loudly. -- */
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const flush = React.useCallback(async (): Promise<boolean> => {
    if (readOnly) return true;
    const patch = pending.current;
    // An empty queue is not proof the server has everything: the last attempt
    // may have failed and left nothing new to send.
    if (Object.keys(patch).length === 0 || inFlight.current) return inSync.current;

    pending.current = {};
    inFlight.current = true;
    setSaveState("saving");

    /* -- The await MUST be guarded. --
          A rejected promise here — a dropped mobile connection, a 500, a
          server action that threw — skipped `inFlight.current = false` and
          every line after it. The flag stayed true for the life of the page,
          so every later autosave returned early at the guard above and NOTHING
          was ever sent again. The indicator sat on "saving…" for ever, which
          is why a full form came back empty with no error anywhere: the one
          state that reports a problem was unreachable.

          `finally` is what makes the flag honest. It is the difference between
          a failed save and a form that has quietly stopped saving. -- */
    let result: Awaited<ReturnType<typeof saveSelfDraft>>;
    try {
      result = await saveSelfDraft(form.evaluationId, patch);
    } catch (cause) {
      pending.current = { ...patch, ...pending.current };
      inSync.current = false;
      setSaveState("error");
      setFailures((n) => n + 1);
      setSaveError(describeSaveFailure(cause));
      return false;
    } finally {
      inFlight.current = false;
    }

    if (result.ok) {
      inSync.current = true;
      setSaveState("saved");
      setSavedAt(new Date(result.data.savedAt));
      setFailures(0);
      setSaveError(null);
      return true;
    }

    // Put the patch back so the next attempt carries it. Merged UNDER any
    // newer edit, so a retry cannot resurrect a value the person has since
    // changed.
    pending.current = { ...patch, ...pending.current };
    inSync.current = false;
    setSaveState("error");
    setFailures((n) => n + 1);
    setSaveError(result.error.message);
    return false;
  }, [form.evaluationId, readOnly]);

  /* -- The tab-local mirror, frozen as it was when the page loaded. §13.6.
        Not a lazy `useState` initialiser: this component is server-rendered
        first, where sessionStorage does not exist, so the two renders would
        disagree and hydration would mismatch on the very fields being
        restored. `useSyncExternalStore` with a server snapshot is how this
        codebase reads browser-only state (theme.tsx, resizable-panes.tsx). -- */
  const mountDraft = React.useSyncExternalStore(
    subscribeToNothing,
    () => mountDraftSnapshot(cacheKey),
    noDraftOnServer,
  );
  const recovered = React.useMemo(
    () => (form.isSubmitted ? null : unsavedFrom(mountDraft, form.answers, {})),
    [mountDraft, form.answers, form.isSubmitted],
  );

  /* -- Applied DURING RENDER, not from an effect. React's documented "adjust
        state when something changes" (PC-4): an effect calling setState is the
        cascading-render shape the compiler rejects, and it paints once with
        the un-restored values first — visible as the answers flickering in. -- */
  const [appliedKey, setAppliedKey] = React.useState<string | null>(null);
  if (recovered && appliedKey !== cacheKey) {
    setAppliedKey(cacheKey);
    setValues((prev) => ({ ...prev, ...recovered.answers }));
  }

  /* -- Getting the recovery onto the wire IS a side effect. Only a ref is
        written synchronously; the send is deferred by a timeout, which keeps
        setState out of the effect body. -- */
  React.useEffect(() => {
    if (!recovered) return;
    pending.current = { ...recovered.answers, ...pending.current };
    const t = setTimeout(() => void flush(), 0);
    return () => clearTimeout(t);
  }, [recovered, flush]);

  /* -- A frozen snapshot must not outlive the screen. -- */
  React.useEffect(() => () => forgetMountDraft(cacheKey), [cacheKey]);

  /* -- Mirror every change. Written from `values`, so the stored copy is the
        WHOLE draft: a restore must be able to rebuild the form on its own
        rather than replay a sequence of patches. -- */
  React.useEffect(() => {
    // Clearing only. The WRITE lives in the change handler, because an effect
    // fires on the hydration commit — BEFORE `useSyncExternalStore` re-reads
    // the store — so it wrote the server's empty values over the saved draft
    // and the restore then found nothing. The form came back blank exactly as
    // if there had been no mirror at all.
    if (readOnly) clearDraft(cacheKey);
  }, [cacheKey, readOnly]);

  /** How much this tab put back, for the banner. Derived — never state. */
  const restored = recovered?.count ?? 0;

  // Debounced save. The timer restarts on every keystroke, so a burst of typing
  // is one request rather than thirty.
  React.useEffect(() => {
    if (readOnly) return;
    const timer = setTimeout(() => void flush(), AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [values, flush, readOnly]);

  // The guaranteed flush. Debouncing alone means somebody who types
  // continuously for ten minutes never saves.
  React.useEffect(() => {
    if (readOnly) return;
    const timer = setInterval(() => void flush(), AUTOSAVE_FLUSH_MS);
    return () => clearInterval(timer);
  }, [flush, readOnly]);

  // Tab hidden, or the page going away. `visibilitychange` is the one that
  // actually fires on mobile — iOS Safari does not reliably fire `unload` when
  // an app is backgrounded, which is exactly when a phone user leaves a form.
  React.useEffect(() => {
    if (readOnly) return;

    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length === 0) return;
      void flush();
      event.preventDefault();
      // Required by some browsers for the native "leave site?" prompt.
      event.returnValue = "";
    };

    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [flush, readOnly]);

  /* ---------- Change ---------- */

  const onChange = React.useCallback(
    (questionId: string, value: unknown) => {
      const next = { ...values, [questionId]: value };
      setValues(next);

      /* -- The tab mirror is written HERE, from the change that caused it, and
            never from an effect on `values`.

            An effect was the obvious way and it destroyed the very thing it
            existed to protect: effects run on the hydration commit, BEFORE
            `useSyncExternalStore` re-reads the store, so on every reload it
            fired first with the server's empty values, wrote them over the
            saved draft, and the restore then found nothing. The form came back
            blank exactly as if there had been no mirror at all.

            A change handler cannot have that ordering — it only ever runs
            because a person typed. -- */
      if (!readOnly) writeDraft(cacheKey, next, {});

      pending.current[questionId] = value;
      // Clear this field's error the moment it is touched. Leaving it up while
      // somebody types the answer reads as the app not noticing.
      setErrors((previous) => {
        if (!(questionId in previous)) return previous;
        const rest = { ...previous };
        delete rest[questionId];
        return rest;
      });
    },
    [values, cacheKey, readOnly],
  );

  /* ---------- Submit ---------- */

  const attemptSubmit = () => {
    const result = validateAnswers(form, "SELF", values);

    if (!result.ok) {
      setErrors(result.errors);

      // Scroll to the first error IN FORM ORDER, not in Zod's order — "the
      // first error" has to be the topmost one on the page.
      const first = result.missingIds[0];
      if (first) {
        const node = document.getElementById(`q-${first}`);
        node?.scrollIntoView({ behavior: "smooth", block: "center" });
        node?.querySelector<HTMLElement>("input,textarea,button,select")?.focus();
      }
      return;
    }

    setErrors({});
    setConfirmOpen(true);
  };

  const doSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);

    // Everything outstanding goes first. Submitting validates the SERVER's
    // copy, so an unsent keystroke would be validated as blank.
    const saved = await flush();

    /* -- Stop if the draft never reached the server. Going on would have the
          server validate a copy that does not hold the answers, and it would
          refuse with "N questions still need an answer" — blaming the person
          for questions they demonstrably DID answer, and sending them back to
          re-enter work that is on screen in front of them. The save is the
          honest failure, so that is the one to report (§0.7). -- */
    if (!saved) {
      setSubmitting(false);
      setSubmitError(
        "Your answers have not reached us yet, so there is nothing to submit. Nothing you have typed is lost — stay on this page and it will keep trying, then submit again.",
      );
      return;
    }

    const result = await submitSelfEvaluation(form.evaluationId);
    setSubmitting(false);

    if (!result.ok) {
      setSubmitError(result.error.message);
      return;
    }

    setConfirmOpen(false);
    setSubmitted(true);
    setThanked(true);
    // The server has it and the layer is locked (§8). The mirror has nothing
    // left to protect, and leaving answers in the tab past that point is
    // exposure with no purpose.
    clearDraft(cacheKey);
    router.refresh();
  };

  const errorCount = Object.keys(errors).length;

  return (
    <div className="mx-auto w-full max-w-[780px] pb-28 lg:pb-8">
      {/* ---------- Closed for a reason other than submitting ---------- */}
      {/* §13.4: a form that will not save has to say so BEFORE somebody fills
          it in. This is the render agreeing with the save gate — withdrawn,
          skipped, or moved past OPEN — and it sits first because it changes
          what every control below it can do. */}
      {form.lockedReason && !submitted ? (
        <p className="mb-4 flex items-start gap-2 rounded-card border border-warning/40 bg-warning-tint px-4 py-3 text-body-sm text-ink">
          <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{form.lockedReason}</span>
        </p>
      ) : null}

      {/* ---------- Recovered draft ---------- */}
      {/* Only when the mirror genuinely held something the server did not. It
          is written on every keystroke, so announcing a restore on every reload
          would teach people to ignore the one that matters. */}
      {restored > 0 && !submitted ? (
        <p className="mb-4 flex items-start gap-2 rounded-card border border-warning/40 bg-warning-tint px-4 py-3 text-body-sm text-ink">
          <RotateCcw aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            <span className="font-medium">
              {restored} {restored === 1 ? "answer was" : "answers were"} recovered
            </span>{" "}
            from this tab — they had not reached us before the page reloaded. Check they are right,
            then carry on.
          </span>
        </p>
      ) : null}

      {/* ---------- Returned banner ---------- */}
      {meta.returnedReason && !submitted ? (
        <section className="mb-4 rounded-card border border-critical/40 bg-critical-tint p-5">
          <h2 className="text-display-sm text-ink">
            {meta.leadName ?? "Your lead"} has asked you to look at this again.
          </h2>
          {/* Verbatim. §8 requires a reason on every return, and paraphrasing it
              would leave the employee guessing at what to change — which is the
              entire content of the message. */}
          <p className="mt-2 text-body-lg text-ink">{meta.returnedReason}</p>
          {meta.returnedAt ? (
            <p className="tabular mt-2 text-body-sm text-ink-muted">{formatDate(meta.returnedAt)}</p>
          ) : null}
        </section>
      ) : null}

      {/* ---------- Submitted confirmation ---------- */}
      {submitted ? (
        <section className="mb-4 rounded-card-lg bg-ink p-5 sm:p-6">
          <FormLetterhead tone="dark" className="mb-4" />
          <div className="flex items-start gap-3">
            <Check aria-hidden className="mt-1 size-5 shrink-0 text-accent-green" />
            <div>
              <h1 className="text-display-sm text-ink-invert">
                Your evaluation is submitted and locked.
              </h1>
              <p className="mt-1 text-body text-ink-invert/80">
                {meta.leadName
                  ? `${meta.leadName} rates the same form separately. HR reads both together.`
                  : "Your manager rates the same form separately. HR reads both together."}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <Link
                  href="/my-evaluation"
                  className="inline-flex min-h-11 items-center text-body-sm font-medium text-ink-invert underline underline-offset-4"
                >
                  Back to your evaluations
                </Link>
                {/* ?copy=employee is the redacted copy — §9 keeps the lead's
                    comments off it unless the cycle's policy is FULL. */}
                <Link
                  href={`/print/evaluation/${form.evaluationId}?copy=employee`}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex min-h-11 items-center text-body-sm font-medium text-ink-invert underline underline-offset-4"
                >
                  Print your copy
                </Link>
              </div>
            </div>
          </div>
        </section>
      ) : (
        /* ---------- Header ----------
           NOT sticky any more. A 160px card pinned under the topbar took a
           third of a phone screen away from the form for its whole length, and
           what it holds — a title, a due date and a progress count — is
           orientation, not something anybody needs while answering question 22.
           The action bar at the bottom is what has to stay reachable, and it
           still does. */
        <header className="mb-4 rounded-card-lg bg-ink p-4 sm:p-5">
          {/* The mark, above the fold on the phone most people open this on. */}
          <FormLetterhead tone="dark" className="mb-3" />

          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-display-sm text-ink-invert">Your self-evaluation</h1>
              <p className="mt-1 text-body-sm text-ink-invert/80">
                {meta.periodLabel} · due {formatDate(meta.selfDueOn)}
                {meta.leadName ? ` · reviewed by ${meta.leadName}` : ""}
              </p>
            </div>

            <div className="text-right">
              {/* §3: one family, tabular figures. DESIGN.md is explicit that
                  there is no separate mono for numerals. */}
              <p className="tabular text-display-md leading-none text-ink-invert">
                {answered}/{total}
              </p>
              <p
                className={cn(
                  "mt-1 text-body-sm",
                  saveState === "error" ? "text-critical" : "text-ink-invert/70",
                )}
              >
                {saveState === "saving"
                  ? "saving…"
                  : saveState === "error"
                    ? "not saved — retrying"
                    : savedAt
                      ? `saved ${formatTime(savedAt)}`
                      : "not saved yet"}
              </p>
            </div>
          </div>

          {/* Progress in the SELF tier — cyan. §13.1 reserves the tier colours
              for "who said this", and this bar is the employee's own progress,
              which is exactly that. */}
          <div className="mt-4 h-2 w-full overflow-hidden rounded-pill bg-ink-invert/15">
            <span
              className="block h-full rounded-pill bg-self transition-all duration-panel"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="mt-4 hidden justify-end lg:flex">
            <Button onClick={attemptSubmit} className="min-h-11">
              <Send className="size-4" aria-hidden />
              Submit
            </Button>
          </div>
        </header>
      )}

      {/* ---------- Offline banner ---------- */}
      {failures >= 3 ? (
        <p
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-card border border-critical/40 bg-critical-tint px-4 py-3 text-body-sm text-ink"
        >
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-critical" />
          We cannot reach the server. Your answers are safe in this browser. Do not close this tab.
        </p>
      ) : null}

      {/* ---------- Error summary ---------- */}
      {errorCount > 0 ? (
        <p
          role="alert"
          className="mb-4 rounded-card border border-critical/40 bg-critical-tint px-4 py-3 text-body font-medium text-ink"
        >
          {errorCount} {errorCount === 1 ? "question still needs" : "questions still need"} an answer.
        </p>
      ) : null}

      {/* ---------- Metadata, read-only ---------- */}
      <section className="card-surface mb-4 p-5">
        {/* From SECTION_LABELS, never retyped — labels.ts is the single source
            of section names (§0.2), and P8-PATCH's test fails the build for any
            component that restates one. */}
        <h2 className="text-display-sm text-ink">{SECTION_LABELS.METADATA}</h2>
        {/* A definition list, not inputs. These come from the profile and the
            evaluation record; letting somebody type a name here would let it
            disagree with the record it is drawn from. */}
        {/* -- Two columns from the smallest screen up, not from `sm`. --
              Six single-column rows plus their labels ran to most of a phone
              screen before the first question — on the one form §13.2 says
              must be flawless at 375px. These are six short values; a name and
              a designation sit side by side comfortably at that width, and
              halving the rows takes a screenful of scrolling out of the way of
              the thing somebody actually came to do. -- */}
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
          {[
            ["Employee", meta.evaluateeName],
            ["Evaluated by", meta.leadName ?? "—"],
            ["Department", meta.departmentName ?? "—"],
            ["Designation", meta.designation ?? "—"],
            ["Period", meta.periodLabel],
            ["Date of evaluation", formatDate(new Date())],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="type-label text-ink-muted">{label}</dt>
              <dd className="text-body text-ink">{value}</dd>
            </div>
          ))}
        </dl>

        {meta.leadName === meta.evaluateeName ? (
          <p className="mt-3 text-body-sm text-ink-muted">
            For a self-evaluation these are the same person.
          </p>
        ) : null}

        {/* -- What they are on now. Increment cycles only. --
              READ-ONLY, and not a question. P12-14: metadata is a definition
              list rather than inputs, because a field here would let somebody
              type a salary that disagrees with the record it is drawn from —
              and this particular record is what a pay decision is made
              against. It is never written back into the answers; the only
              figure the employee supplies is their expectation, which is a
              real question further down the form.

              Shown so the expectation question can be answered against
              something. Asking what somebody thinks is fair while withholding
              what they are currently on invites a number anchored on nothing.

              §5 is relaxed for this one figure and no further (0040): their
              own, today's, on an increment form. Not their pay history, not
              anybody else's, and not on an ordinary evaluation. */}
        {meta.isIncrement ? (
          <div className="mt-4 border-t border-rule pt-4">
            {/* -- SHOWN PER MONTH, because that is what the form now ASKS FOR.
                  0061 moved the expectation question to a monthly figure. This
                  block sat directly above it showing the ANNUAL package — so
                  the page would have anchored somebody on one unit and then
                  asked them for the other, which is the 733% incident built
                  into the layout rather than left to chance.

                  The annual figure stays underneath as context: it is what
                  appears on their letter, and dropping it entirely would make
                  the two documents look like they disagree. -- */}
            <dt className="type-label text-ink-muted">Current salary</dt>
            <dd className="tabular mt-0.5 text-display-sm text-ink">
              {meta.currentCtc === null
                ? formatInr(null)
                : `${formatInr(monthlyFromAnnual(meta.currentCtc))} a month`}
            </dd>
            <p className="mt-1 text-body-sm text-ink-muted">
              {meta.currentCtc === null
                ? "Not on record. HR can add it — it does not stop you filling this in."
                : `${formatInr(meta.currentCtc)} a year. From your employment record, so it cannot be edited here. Your expectation is asked further down, per month.`}
            </p>
          </div>
        ) : null}
      </section>

      {/* §6's wording, once — not under all 33 questions. See ScaleLegend. */}
      <ScaleLegend form={form} className="mb-4" />

      {/* ---------- The form ---------- */}
      <FormRenderer
        form={form}
        values={values}
        errors={errors}
        hiddenQuestionIds={hiddenQuestionIds}
        readOnly={readOnly}
        highlightDepartment={meta.departmentName}
        onChange={onChange}
      />

      {/* ---------- The end of the form, on a large screen ----------

            THE ONLY SUBMIT ON DESKTOP WAS IN THE HEADER, and the header is not
            sticky (see the note above it, which removed a 160px card that was
            eating a third of a phone screen). So on a laptop somebody answered
            thirty-odd questions, reached the last one, and found nothing there:
            the button was two screens up, scrolled away, and the sticky bar
            below is `lg:hidden`.

            A form should end with the thing you do when you have finished it.
            The header keeps its Submit — that one is for somebody who opens a
            form they have already filled in — and this is the one for somebody
            who has just reached the bottom.

            Not sticky, deliberately: it sits after the last question, which is
            where a reader is looking when they finish, and a pinned bar on a
            desktop screen is chrome taken from the form for no gain. -- */}
      {!submitted && !readOnly ? (
        <div className="mt-6 hidden lg:block">
          {saveError ? (
            <p role="alert" className="mb-3 text-body-sm text-critical">
              {saveError}
            </p>
          ) : null}

          <div className="card-surface flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="min-w-0">
              <p className="font-sans text-body font-medium text-ink">
                {/* -- From the counters the progress bar already uses, so the
                      two can never disagree. `answered` counts VISIBLE
                      questions, so a conditional nobody triggered is not
                      reported as outstanding (§6, P12-1). -- */}
                {total - answered === 0
                  ? "Everything is answered."
                  : `${total - answered} ${total - answered === 1 ? "question" : "questions"} still to answer.`}
              </p>
              <p className="font-sans text-body-sm text-ink-muted">
                Your answers are saved as you go. Submitting locks them and sends the form to HR.
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap gap-3">
              <Button
                variant="secondary"
                className="min-h-11"
                onClick={() => void flush()}
                disabled={saveState === "saving"}
              >
                {saveState === "saving" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : null}
                Save draft
              </Button>
              <Button className="min-h-11" onClick={attemptSubmit}>
                <Send className="size-4" aria-hidden />
                Submit
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ---------- Mobile sticky bar ---------- */}
      {!submitted ? (
        <>
        {/* -- A refused save, said where it cannot be missed. --
              The header indicator sits at the top of a long form, so on a
              phone it is scrolled away for the entire time somebody is
              filling one in. This sits directly above the button they just
              pressed, carries the server's own words rather than a paraphrase
              (a paraphrase sends people to fix the wrong thing), and says
              plainly that nothing typed is lost — because the answers are
              still in the page and in the tab's own mirror (§13.6). */}
        {saveError ? (
          <div
            role="alert"
            /* Above the action bar, which is itself above the nav. `bottom-16`
               used to clear the 64px bar alone — which is why this banner was
               the ONE thing still visible when the bar underneath it was not. */
            className="fixed inset-x-0 bottom-[calc(var(--bottom-nav-h)+4rem)] z-20 border-t border-critical/40 bg-critical-tint px-4 py-3 lg:hidden"
          >
            <p className="text-body-sm font-medium text-critical">Not saved</p>
            <p className="mt-0.5 text-body-sm text-ink">{saveError}</p>
            <p className="mt-1 text-body-sm text-ink-muted">
              Nothing you have typed is lost. Leave this page open and try Save draft again.
            </p>
          </div>
        ) : null}

        {/* -- THE SUBMIT BUTTON WAS UNREACHABLE ON EVERY PHONE. --

            This bar was `bottom-0 z-20`. `BottomNav` is also fixed at
            `bottom-0` and is `z-40`, so it sat on top and covered this
            completely: an employee filling in their appraisal on a phone —
            which §13.2 makes the FIRST case, not the fallback — could fill
            every question and had no way to submit.

            It hid in review because it only reproduces below `lg`, where the
            nav exists, and because the error banner above it is offset far
            enough to clear the nav and stayed visible. So the screen showed a
            save failure and no button, which reads as one fault and was two.

            Offset by the nav's own height rather than raised above it in the
            stacking order: `z-50` would fix the button by burying the
            navigation, and somebody who cannot leave a form is no better off
            than somebody who cannot submit one. */}
        <div className="glass fixed inset-x-0 bottom-[var(--bottom-nav-h)] z-20 flex h-16 items-center gap-3 border-t border-rule px-4 lg:hidden">
          <Button
            variant="ghost"
            className="min-h-11 flex-1"
            onClick={() => void flush()}
            disabled={saveState === "saving"}
          >
            {saveState === "saving" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Save draft
          </Button>
          <Button className="min-h-11 flex-1" onClick={attemptSubmit}>
            <Send className="size-4" aria-hidden />
            Submit
          </Button>
        </div>
        </>
      ) : null}

      {/* ---------- Confirmation ---------- */}
      <SubmittedDialog
        open={thanked}
        onOpenChange={setThanked}
        tier="self"
        title="Thank you — that is your evaluation in."
        body={
          "It takes real thought to rate your own work honestly, and we are grateful for the time. " +
          "HR reads your answers alongside your manager's ratings of the same form. " +
          "You will hear when there is an outcome."
        }
        actionLabel="Done"
        onAction={() => setThanked(false)}
      />

      <Dialog open={confirmOpen} onOpenChange={(open) => !open && !submitting && setConfirmOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit your evaluation?</DialogTitle>
            <DialogDescription>
              You will not be able to change your answers after this. HR reads them alongside
              your manager&apos;s ratings of the same form.
            </DialogDescription>
          </DialogHeader>

          {submitError ? (
            <p role="alert" className="rounded-control bg-critical-tint px-3 py-2 text-body-sm text-critical">
              {submitError}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              className="min-h-11"
              disabled={submitting}
              onClick={() => setConfirmOpen(false)}
            >
              Not yet
            </Button>
            <Button className="min-h-11" disabled={submitting} onClick={() => void doSubmit()}>
              {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
