"use client";

/**
 * The lead's rating screen. BLIND.
 *
 * AMEND-3 deleted the paired mode, the employee's self column, the variance
 * strip and the jump-to-differences control from this screen. They are not
 * hidden behind a flag — the data behind them is gone: 0021 revoked the lead's
 * SELF-layer read, so there would be nothing to render even if the markup
 * survived. §1: "the disagreement we want to measure is the disagreement that
 * exists before either side is anchored."
 *
 * The return-to-employee action is gone too, for a plainer reason: a lead
 * cannot return a form they cannot see. Returns are HR's now (§8).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, MessageSquarePlus, RotateCcw, Send } from "lucide-react";

import { AutosaveIndicator, type AutosaveState } from "@/components/appraise/autosave-indicator";
import { BackLink } from "@/components/appraise/back-link";
import { FormLetterhead } from "@/components/appraise/form-letterhead";
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
import { Textarea } from "@/components/ui/textarea";
import { saveLeadDraft, submitLeadReview } from "@/lib/evaluations/lead-actions";
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
import { isBlank, validateAnswers } from "@/lib/forms/zod-generator";
import type { FormDefinition, FormQuestion } from "@/lib/forms/types";
import type { EvaluationStatus } from "@/lib/evaluations/transitions";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils/date";

export type ReviewMeta = {
  evaluationId: string;
  employeeName: string;
  employeeFirstName: string;
  employeeCode: string | null;
  designation: string | null;
  departmentName: string | null;
  periodLabel: string;
  leadDueOn: string | null;
  status: EvaluationStatus;
  /** The LEAD layer's own timestamp. Nothing here reports the other side. */
  leadSubmittedAt: string | null;
};

const AUTOSAVE_DEBOUNCE_MS = 800;
const AUTOSAVE_FLUSH_MS = 20_000;

export function ReviewScreen({ form, meta }: { form: FormDefinition; meta: ReviewMeta }) {
  const router = useRouter();

  const [values, setValues] = React.useState<Record<string, unknown>>(form.answers);
  const [comments, setComments] = React.useState<Record<string, string>>(form.comments);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saveState, setSaveState] = React.useState<AutosaveState>("idle");
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [submitted, setSubmitted] = React.useState(form.isSubmitted);
  // Only for the submission that just happened — not every time a finished
  // review is opened again to be read.
  const [thanked, setThanked] = React.useState(false);
  const [openComments, setOpenComments] = React.useState<ReadonlySet<string>>(new Set());
  const cacheKey = draftKey(meta.evaluationId, "LEAD");

  const pending = React.useRef<{
    answers: Record<string, unknown>;
    comments: Record<string, string>;
  }>({ answers: {}, comments: {} });
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  /* -- Whether the server has everything, as a ref rather than reading
        `saveState`. Reading the state would put it in `flush`'s dependency
        list, and `flush` is what the unload listeners and the 20-second
        guaranteed save are keyed on — so every idle→saving→saved cycle would
        tear those down and restart the interval, starving the very retry this
        change exists to make real. -- */
  const inSync = React.useRef(true);

  /* -- A hidden conditional is neither required nor stored (§6), so the schema
        is a function of the current answers rather than a constant (P12-2). -- */
  
  /** Returns whether the server now holds everything typed so far. */
  const flush = React.useCallback(async (): Promise<boolean> => {
    const answersPatch = pending.current.answers;
    const commentsPatch = pending.current.comments;
    if (Object.keys(answersPatch).length === 0 && Object.keys(commentsPatch).length === 0) {
      // An empty queue is not proof the server has everything: the last attempt
      // may have failed and left nothing new to send. `inSync` is that answer.
      return inSync.current;
    }

    pending.current = { answers: {}, comments: {} };
    setSaveState("saving");

    // Answers and comments ride the SAME call: split across two, one can land
    // and the other not, and a comment would outlive the score it explains
    // (P13-9).
    const result = await saveLeadDraft(meta.evaluationId, answersPatch, commentsPatch);
    if (result.ok) {
      inSync.current = true;
      setSaveState("saved");
      setSavedAt(new Date());
      return true;
    }

    /* -- The patch goes BACK on the queue, with anything typed during the round
          trip winning. Without this the indicator says "retrying" while the
          answers have in fact been discarded — the next flush finds an empty
          queue and returns immediately, so nothing is ever resent and the
          rating is simply gone. P12's self form has always restored it; this
          screen dropped the line, and a transient failure was enough to lose
          work somebody had spent twenty minutes on (§13.6). -- */
    pending.current = {
      answers: { ...answersPatch, ...pending.current.answers },
      comments: { ...commentsPatch, ...pending.current.comments },
    };
    inSync.current = false;
    setSaveState("error");
    setActionError(result.error.message);
    return false;
  }, [meta.evaluationId]);

  const queue = React.useCallback(
    (answers: Record<string, unknown>, nextComments: Record<string, string>) => {
      pending.current.answers = { ...pending.current.answers, ...answers };
      pending.current.comments = { ...pending.current.comments, ...nextComments };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), AUTOSAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  /* -- The tab-local mirror, read once on mount.
        It cannot be a lazy `useState` initialiser: this component is still
        server-rendered, and touching sessionStorage there is both unavailable
        and a hydration mismatch. A one-shot mount effect is the documented way
        to bring a browser-only value in — it is not the props-into-state
        cascade PC-4 and P10-11 rule out, and it runs exactly once. -- */
  const mountDraft = React.useSyncExternalStore(
    subscribeToNothing,
    () => mountDraftSnapshot(cacheKey),
    noDraftOnServer,
  );
  const recovered = React.useMemo(
    () => (form.isSubmitted ? null : unsavedFrom(mountDraft, form.answers, form.comments)),
    [mountDraft, form.answers, form.comments, form.isSubmitted],
  );

  /* -- Applied DURING RENDER, not from an effect.
        React's documented "adjust state when something changes", and PC-4 made
        the same call for the same reasons: an effect calling setState is the
        cascading-render shape the compiler rejects, and it also paints once
        with the un-restored values first — visible as the answers flickering
        in. `appliedKey` is what makes it happen exactly once. -- */
  const [appliedKey, setAppliedKey] = React.useState<string | null>(null);
  if (recovered && appliedKey !== cacheKey) {
    setAppliedKey(cacheKey);
    setValues((prev) => ({ ...prev, ...recovered.answers }));
    setComments((prev) => ({ ...prev, ...recovered.comments }));
  }

  /* -- Getting the recovery onto the wire IS a side effect, so it lives in one.
        Only a ref is written synchronously; the send is deferred by a timeout,
        which is what keeps setState out of the effect body. -- */
  React.useEffect(() => {
    if (!recovered) return;
    pending.current.answers = { ...recovered.answers, ...pending.current.answers };
    pending.current.comments = { ...recovered.comments, ...pending.current.comments };
    const t = setTimeout(() => void flush(), 0);
    return () => clearTimeout(t);
  }, [recovered, flush]);

  /* -- A frozen snapshot must not outlive the screen: returning to this form
        should read the tab again rather than replay the load before last. -- */
  React.useEffect(() => () => forgetMountDraft(cacheKey), [cacheKey]);

  /* -- Once submitted the layer is locked (§8) and the server has it, so the
        mirror has nothing left to protect — and ratings left in the tab past
        that point are exposure with no purpose. Clearing only; the WRITE lives
        in the change handlers, for the reason below. -- */
  React.useEffect(() => {
    if (submitted) clearDraft(cacheKey);
  }, [cacheKey, submitted]);

  /** How much this tab put back, for the banner. Derived — never state. */
  const restored = recovered?.count ?? 0;

  /* -- §13.6: never lose a half-filled form. `visibilitychange` as well as
        unload, because iOS Safari does not reliably fire unload when an app is
        backgrounded — exactly when somebody walks away (P12-11). -- */
  React.useEffect(() => {
    const onHide = () => void flush();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onHide);
    const interval = setInterval(() => void flush(), AUTOSAVE_FLUSH_MS);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onHide);
      clearInterval(interval);
    };
  }, [flush]);

  /* -- The tab mirror is written HERE, from the change that caused it, and
        never from an effect on `values`.

        An effect was the obvious way and it was wrong in a way that destroyed
        the thing it existed to protect. Effects run on the hydration commit,
        BEFORE `useSyncExternalStore` re-reads the store — so on every reload
        the effect fired first with the server's (empty) values and wrote them
        over the saved draft, and the restore then found nothing. The form came
        back blank exactly as if there had been no mirror at all.

        A change handler cannot have that ordering: it only ever runs because a
        person typed, so it can only ever write something they meant. -- */
  const mirror = (
    nextValues: Record<string, unknown>,
    nextComments: Record<string, string>,
  ) => {
    if (!submitted) writeDraft(cacheKey, nextValues, nextComments);
  };

  const onChange = (questionId: string, value: unknown) => {
    const next = { ...values, [questionId]: value };
    setValues(next);
    mirror(next, comments);
    setErrors((prev) => {
      if (!prev[questionId]) return prev;
      const rest = { ...prev };
      delete rest[questionId];
      return rest;
    });
    queue({ [questionId]: value }, {});
  };

  const onComment = (questionId: string, text: string) => {
    const next = { ...comments, [questionId]: text };
    setComments(next);
    mirror(values, next);
    queue({}, { [questionId]: text });
  };

  /**
   * The live average, by §11's rule — the mean of answered SCALE_0_5 answers.
   * Nothing reads it back: §11 stores scores at submit time from the server's
   * copy, and this is a preview of what that will be (P13-7).
   */
  const liveAverage = React.useMemo(() => {
    const scored = form.questions
      .filter((q) => q.responseType === "SCALE_0_5")
      .map((q) => values[q.questionId])
      .filter((v): v is number => typeof v === "number");
    if (scored.length === 0) return null;
    return Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 100) / 100;
  }, [form.questions, values]);

  const answered = form.questions.filter((q) => !isBlank(values[q.questionId])).length;
  const total = form.questions.length;
  const readOnly = submitted;

  async function doSubmit() {
    setBusy(true);
    setActionError(null);

    // Everything outstanding goes first. Submitting validates the SERVER's
    // copy, so an unsent keystroke would be validated as blank.
    if (timer.current) clearTimeout(timer.current);
    const saved = await flush();

    /* -- Stop here if the draft never reached the server.
          Going on would ask the server to validate a copy that does not have
          the answers in it, and it would refuse with "N questions still need an
          answer" — which blames the rater for questions they demonstrably DID
          answer, and sends them back to re-enter work that is sitting on screen
          in front of them. The honest failure is the save, so that is the one
          to report (§0.7). -- */
    if (!saved) {
      setBusy(false);
      setConfirmOpen(false);
      setActionError(
        "Your answers have not reached the server yet, so there is nothing to submit. Nothing you have typed is lost — leave this page open and it will keep trying, then submit again.",
      );
      return;
    }

    const result = await submitLeadReview(meta.evaluationId);
    setBusy(false);

    if (!result.ok) {
      // Closed FIRST: the error renders on the page, and a dialog left open
      // covers it completely — which is how a failed submit reads as a button
      // that does nothing at all.
      setConfirmOpen(false);
      setActionError(result.error.message);
      return;
    }
    setConfirmOpen(false);
    setSubmitted(true);
    setThanked(true);
    // The server has it and the layer is locked (§8). The mirror has nothing
    // left to protect, and leaving ratings in the tab past that point is
    // exposure with no purpose.
    clearDraft(cacheKey);
    // The confirmation is at the top of the page and the submit button is at
    // the bottom, so without this the one thing they are waiting for is a
    // scroll away and the screen looks unchanged.
    window.scrollTo({ top: 0, behavior: "smooth" });
    router.refresh();
  }

  function askToSubmit() {
    // The client's validity is never the decision — the action re-reads the
    // frozen snapshot and re-validates server-side (P12-7). This only saves a
    // round trip and puts the error next to the field.
    const result = validateAnswers(form, "LEAD", values);
    if (!result.ok) {
      setErrors(result.errors);
      const first = result.missingIds[0];
      if (first) {
        document
          .getElementById(`q-${first}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }
    setErrors({});
    setActionError(null);
    setConfirmOpen(true);
  }

  return (
    <div className="mx-auto w-full max-w-[860px] space-y-5">
      {/* ---------- Header ---------- */}
      <BackLink href="/team" label="My team" />

      <header className="card-surface space-y-3 p-5 sm:p-6">
        {/* The same mark the employee's form and the printed pack carry. */}
        <FormLetterhead caption="Performance evaluation" className="pb-1" />

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-display-md text-ink">{meta.employeeName}</h1>
            <p className="text-body text-ink-muted">
              {[meta.designation, meta.departmentName, meta.employeeCode, meta.periodLabel]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="text-right">
            <p className="type-label text-ink-faint">Your average</p>
            <p className="tabular text-display-sm font-semibold text-lead">
              {liveAverage === null ? "—" : liveAverage.toFixed(2)}
            </p>
          </div>
        </div>

        {/* The blind-rating explainer that stood here was removed at the
            owner's explicit instruction. AMEND-3's behaviour is unchanged —
            the lead still cannot read the SELF layer, and 0021's policy is
            what enforces that, not this sentence. */}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-body-sm text-ink-muted">
            {answered} of {total} answered
            {meta.leadDueOn ? ` · due ${formatDate(meta.leadDueOn)}` : ""}
          </p>
          <AutosaveIndicator state={saveState} savedAt={savedAt} />
        </div>
      </header>

      {submitted ? (
        <p className="rounded-card border border-lead/40 bg-lead-tint px-4 py-3 text-body-sm text-lead">
          Your review was submitted
          {meta.leadSubmittedAt ? ` on ${formatDate(meta.leadSubmittedAt)}` : ""} and is now
          read-only. HR reviews it alongside {meta.employeeFirstName}&apos;s.
        </p>
      ) : null}

      {/* Only shown when the mirror genuinely held something the server did
          not. It is written on every keystroke, so announcing a restore on
          every reload would teach people to ignore the one that matters. */}
      {restored > 0 && !submitted ? (
        <p className="flex items-start gap-2 rounded-card border border-warning/40 bg-warning-tint px-4 py-3 text-body-sm text-ink">
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

      {actionError ? (
        <p className="flex items-start gap-2 rounded-card border border-critical/40 bg-critical-tint px-4 py-3 text-body-sm text-critical">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {actionError}
        </p>
      ) : null}

      {/* ---------- The form ---------- */}
      {/* The SAME renderer the employee gets, in the lead tier. No `pair`, no
          `referenceValues`, no `referenceLayer` — there is no second column to
          feed them, and passing an empty one would leave the shape of a thing
          that is meant to be gone. */}
      <FormRenderer
        form={form}
        values={values}
        errors={errors}
        readOnly={readOnly}
        onChange={onChange}
        renderAside={(question: FormQuestion) => (
          <CommentField
            question={question}
            value={comments[question.questionId] ?? ""}
            open={openComments.has(question.questionId)}
            readOnly={readOnly}
            onOpen={() => setOpenComments((prev) => new Set(prev).add(question.questionId))}
            onChange={(text) => onComment(question.questionId, text)}
          />
        )}
      />

      {/* ---------- Submit ---------- */}
      {/* One primary action (§13.3). The return-to-employee button that used to
          sit beside it is deleted: a lead cannot return a form they cannot
          read, and §8 gives returns to HR. */}
      {!readOnly ? (
        <div className="flex justify-end pb-8">
          <Button className="min-h-11" onClick={askToSubmit} disabled={busy}>
            {busy ? (
              <Loader2 aria-hidden className="size-4 animate-spin" />
            ) : (
              <Send aria-hidden className="size-4" />
            )}
            Submit review
          </Button>
        </div>
      ) : null}

      <SubmittedDialog
        open={thanked}
        onOpenChange={setThanked}
        tier="lead"
        title={`Thank you — your review of ${meta.employeeFirstName} is in.`}
        body={
          `Rating somebody fairly takes real thought, and we are grateful for the time. ` +
          `HR reads it alongside ${meta.employeeFirstName}'s own answers. Nothing further is needed from you.`
        }
        actionLabel="Back to my team"
        onAction={() => {
          setThanked(false);
          router.push("/team");
        }}
      />

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit your review of {meta.employeeName}?</DialogTitle>
            <DialogDescription>
              Your ratings and comments lock when you submit and you will not be able to change
              them. HR reviews your answers and {meta.employeeFirstName}&apos;s together.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="min-h-11" onClick={() => setConfirmOpen(false)}>
              Keep editing
            </Button>
            <Button className="min-h-11" onClick={() => void doSubmit()} disabled={busy}>
              {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
              Submit review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------- Per-question comment ---------- */
//
// Inline, never a modal (P13-9): a comment explains the score beside it, and a
// dialog covers the thing being written about.
function CommentField({
  question,
  value,
  open,
  readOnly,
  onOpen,
  onChange,
}: {
  question: FormQuestion;
  value: string;
  open: boolean;
  readOnly: boolean;
  onOpen: () => void;
  onChange: (text: string) => void;
}) {
  if (readOnly && !value) return null;

  if (!open && !value) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex min-h-11 items-center gap-1.5 text-body-sm font-medium text-ink-muted transition-colors hover:text-ink"
      >
        <MessageSquarePlus aria-hidden className="size-3.5" />
        Add a comment
      </button>
    );
  }

  return (
    <div>
      <label
        htmlFor={`comment-${question.questionId}`}
        className="mb-1 block text-body-sm font-medium text-ink-muted"
      >
        Your comment
      </label>
      <Textarea
        id={`comment-${question.questionId}`}
        rows={2}
        maxLength={1000}
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Why this rating? One or two lines is plenty."
        className={cn(readOnly && "bg-surface-mute")}
      />
    </div>
  );
}
