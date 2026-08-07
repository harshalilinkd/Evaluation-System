"use client";

/** Live preview of one question, drawn by the shared renderer. */

import { useMemo } from "react";

import { FormRenderer } from "@/components/appraise/form-renderer";
import { dependencySentence, type ResponseType } from "@/lib/questions/labels";
import type { FormDefinition, FormQuestion, QuestionSection } from "@/lib/forms/types";

export type PreviewProps = {
  text: string;
  helpText: string;
  section: QuestionSection;
  responseType: ResponseType;
  required: boolean;
  options: { label: string; value: string }[];
  parentText?: string | null;
  dependsValue?: string | null;
  /** Set when the preview sits in a narrow pane beside the form. */
  compact?: boolean;
  /** The caller already has a heading for it; suppress this one. */
  hideHeading?: boolean;
};

/**
 * §13.5: "That preview is the trust-builder — make it exact."
 *
 * It draws with `FormRenderer` — the same component the department preview and
 * the real self-evaluation use. There is deliberately no input-rendering logic
 * here: a second renderer looks identical on the day it is written and drifts
 * quietly afterwards, and the drift only surfaces once an employee is looking
 * at something the preview never showed.
 *
 * The trick is that a preview is just a `FormDefinition` with one question in
 * it. Everything else follows.
 */
export function QuestionPreview({
  text,
  helpText,
  section,
  responseType,
  required,
  options,
  parentText,
  dependsValue,
  compact = false,
  hideHeading = false,
}: PreviewProps) {
  const form = useMemo<FormDefinition>(() => {
    const question: FormQuestion = {
      questionId: "preview",
      text: text || "Your question will appear here",
      helpText: helpText || null,
      section,
      responseType,
      answeredBy: "EMPLOYEE_AND_LEAD",
      isRequired: required,
      minValue: null,
      maxValue: null,
      // The condition is described in words above rather than enforced here:
      // a preview that hides the question being edited would show HR nothing.
      dependsOn: null,
      dependsValue: null,
      options: options.length > 0 ? options.map((o, i) => ({ ...o, sort_order: (i + 1) * 10 })) : null,
      sortOrder: 10,
    };

    return {
      evaluationId: "preview:question",
      layer: "SELF",
      evaluationStatus: "CYCLE_ACTIVE",
      track: "STAFF",
      sections: [{ section, questions: [question] }],
      questions: [question],
      answers: {},
      comments: {},
      isSubmitted: false,
      submittedAt: null,
      hiddenQuestionIds: [],
    };
  }, [text, helpText, section, responseType, required, options]);

  return (
    <div className="space-y-3">
      {hideHeading ? null : <p className="type-label text-ink-faint">Preview</p>}

      {parentText && dependsValue ? (
        <p className="rounded-control border border-rule bg-surface-mute px-3 py-2 text-body-sm text-ink-muted">
          {dependencySentence(parentText, dependsValue)}
        </p>
      ) : null}

      {/* Interactive on purpose — HR should be able to click a rating and see
          how it behaves before they save it. */}
      <FormRenderer form={form} compact={compact} />
    </div>
  );
}
