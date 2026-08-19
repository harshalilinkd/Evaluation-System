"use client";

/** One question at a time, with progress and navigation. */

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";

import { QuestionField } from "@/components/appraise/form-renderer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FormDefinition, FormQuestion } from "@/lib/forms/types";

/* -- WHY THIS SITS BESIDE FormRenderer RATHER THAN REPLACING IT.
      P9-1 allows exactly one component that RENDERS A QUESTION, and this is not
      it: every question here is drawn by `QuestionField`, imported from the
      renderer. What this owns is the WALK — which question is on screen, how far
      through you are, and what happens when you press Continue.

      The long scrolling form stays for the increment cycle, which is thirty-odd
      questions grouped into sections a rater moves around in. This is for the
      evaluation form: ten questions, no sections. That is a sequence, and a
      sequence is better walked than scrolled. */

export type GuidedFormProps = {
  form: FormDefinition;
  values: Record<string, unknown>;
  errors?: Record<string, string>;
  hiddenQuestionIds?: readonly string[];
  tier: "self" | "lead" | "final";
  readOnly?: boolean;
  onChange: (questionId: string, value: unknown) => void;
  /** Replaces Continue on the last question. */
  submitLabel?: string;
  onSubmit?: () => void;
  submitting?: boolean;
  /** The screen owns autosave; this only shows what it reports. */
  status?: React.ReactNode;
};

/** Answered means it holds something. `0` and `false` are answers (P4-9, P12-3). */
function isAnswered(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Says what to do, in the words of the control it is about. */
function requiredMessage(question: FormQuestion): string {
  switch (question.responseType) {
    case "SCALE_0_5":
    case "TICK_3":
      return "Choose a rating before continuing.";
    case "SINGLE_SELECT":
    case "MULTI_SELECT":
      return "Choose an option before continuing.";
    case "BOOLEAN":
      return "Choose yes or no before continuing.";
    case "DATE":
      return "Pick a date before continuing.";
    default:
      return "Write an answer before continuing.";
  }
}

export function GuidedForm({
  form,
  values,
  errors,
  hiddenQuestionIds,
  tier,
  readOnly = false,
  onChange,
  submitLabel = "Submit",
  onSubmit,
  submitting = false,
  status,
}: GuidedFormProps) {
  const reduced = useReducedMotion();
  const hidden = React.useMemo(() => new Set(hiddenQuestionIds ?? []), [hiddenQuestionIds]);

  /* -- Sections are FLATTENED, not assumed away. The evaluation form has none,
        but a FormDefinition is always sections of questions, so this walks them
        in order and forgets the grouping — which means it degrades sensibly if
        it is ever pointed at a sectioned form. */
  const questions: FormQuestion[] = React.useMemo(
    () => form.sections.flatMap((s) => s.questions).filter((q) => !hidden.has(q.questionId)),
    [form.sections, hidden],
  );

  const [index, setIndex] = React.useState(0);
  const [touched, setTouched] = React.useState(false);

  /* -- The index has to survive a question vanishing under it. Answering a
        conditional "No" removes its child from `questions`, and an index past
        the end renders nothing — a blank card with working navigation, which
        reads as the form having broken rather than as a question going away. */
  const total = questions.length;
  const safeIndex = Math.min(index, Math.max(0, total - 1));
  const question = questions[safeIndex];

  const answeredCount = questions.filter((q) => isAnswered(values[q.questionId])).length;

  if (!question) return null;

  const isLast = safeIndex === total - 1;
  const serverError = errors?.[question.questionId];
  const blocked = question.isRequired && !isAnswered(values[question.questionId]);
  const localError = touched && blocked ? requiredMessage(question) : undefined;

  function goNext() {
    /* -- Stays on the question rather than refusing silently or jumping ahead.
          The message appears under the control it is about, which is where
          somebody is already looking. */
    if (blocked) {
      setTouched(true);
      return;
    }
    setTouched(false);
    if (isLast) onSubmit?.();
    else setIndex((i) => Math.min(total - 1, i + 1));
  }

  function goBack() {
    setTouched(false);
    setIndex((i) => Math.max(0, i - 1));
  }

  return (
    <div className="space-y-8">
      {/* ---------- Progress ---------- */}
      <div className="space-y-2.5">
        {/* -- Segments up to twelve, a single bar beyond. Thirteen segments on a
               phone are narrower than the gaps between them and stop being
               countable, which is the one thing a segmented row is for. */}
        {total <= 12 ? (
          <div aria-hidden className="flex items-center gap-1.5">
            {questions.map((q, i) => (
              <span
                key={q.questionId}
                className={cn(
                  "h-1.5 flex-1 rounded-pill transition-colors duration-hover",
                  i <= safeIndex ? "bg-primary" : "bg-rule",
                )}
              />
            ))}
          </div>
        ) : (
          <div aria-hidden className="h-1.5 w-full overflow-hidden rounded-pill bg-rule">
            <div
              className="h-full rounded-pill bg-primary transition-[width] duration-300 ease-out"
              style={{ width: `${((safeIndex + 1) / total) * 100}%` }}
            />
          </div>
        )}

        <p className="text-body-sm text-ink-muted" role="status" aria-live="polite">
          Question {safeIndex + 1} of {total}
          {answeredCount > 0 ? ` · ${answeredCount} answered` : ""}
        </p>
      </div>

      {/* ---------- The question ---------- */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={question.questionId}
          initial={reduced ? false : { opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduced ? undefined : { opacity: 0, x: -12 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          <QuestionField
            question={question}
            tier={tier}
            value={values[question.questionId]}
            error={serverError ?? localError}
            readOnly={readOnly}
            onChange={(v) => {
              setTouched(false);
              onChange(question.questionId, v);
            }}
          />
        </motion.div>
      </AnimatePresence>

      {/* ---------- Navigation ---------- */}
      <div className="space-y-3 border-t border-rule pt-5">
        {status ? <div className="text-body-sm text-ink-muted">{status}</div> : null}

        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={goBack}
            disabled={safeIndex === 0 || submitting}
            className="min-h-11 gap-2"
          >
            <ArrowLeft aria-hidden className="size-4" />
            Back
          </Button>

          <Button
            type="button"
            onClick={goNext}
            disabled={submitting}
            className="min-h-11 min-w-[9.5rem] gap-2"
          >
            {isLast ? (
              <>
                <Check aria-hidden className="size-4" />
                {submitLabel}
              </>
            ) : (
              <>
                Continue
                <ArrowRight aria-hidden className="size-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
