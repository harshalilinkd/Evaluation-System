"use client";

/** THE evaluation form renderer. The preview (P9) and the real form (P12) both use this. */

import * as React from "react";
import { useState } from "react";

import { RatingScale } from "@/components/appraise/rating-scale";
import { TickScale } from "@/components/appraise/tick-scale";
import { SectionCard } from "@/components/appraise/section-card";
import { TIER_FOR_LAYER, type Tick3Value } from "@/components/appraise/tier";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { DEPARTMENT_SECTION, sectionLabel } from "@/lib/forms/labels";
import { cn } from "@/lib/utils";
import type { FormDefinition, FormQuestion } from "@/lib/forms/types";

/**
 * One renderer, one code path.
 *
 * P9's department preview and P12's real self-evaluation both draw from here,
 * because a preview built by a second renderer drifts from the real thing
 * silently — and the divergence only surfaces once a cycle is live and an
 * employee is looking at something the preview never showed.
 *
 * It takes a `FormDefinition` and nothing else. Where that definition came from
 * — the frozen snapshot or the live bank — is the caller's problem, which is
 * what makes the same component serve both.
 */
export type FormRendererProps = {
  form: FormDefinition;
  /** Read-only kills every input. Used by the preview and by a submitted layer. */
  readOnly?: boolean;
  /** Diagonal watermark across the whole form. */
  watermark?: string;
  /**
   * Highlights the Job Specific Skills section and captions it. P9 passes the
   * department name; P12 passes nothing.
   */
  highlightDepartment?: string | null;
  onChange?: (questionId: string, value: unknown) => void;

  /* -- P12 additions. All optional, so P9's preview is untouched. -- */

  /** Controlled answers. Without it the renderer holds its own state (preview). */
  values?: Record<string, unknown>;
  /** question_id -> message. A 2px rose border and the message beneath. */
  errors?: Record<string, string>;
  /**
   * Ids hidden by an unmet condition (§6). Hidden questions are not rendered,
   * not validated and not stored — the value is cleared server-side on save.
   */
  hiddenQuestionIds?: readonly string[];
  /**
   * Rendered under each question's input. The lead screen supplies its comment
   * control through here rather than the renderer growing to know about
   * comments — a comment is not a property of a *form*.
   */
  renderAside?: (question: FormQuestion) => React.ReactNode;

  /**
   * The question currently being edited, ringed so it can be found at a glance.
   *
   * The form builder shows the same form twice — as a list on the left and as
   * the real thing on the right — and without this the person editing has to
   * work out for themselves which of thirty rows they just changed.
   */
  highlightQuestionId?: string | null;
  /**
   * Render for a narrow CONTAINER — a preview pane beside a form, rather than a
   * narrow viewport. The responsive rules inside the inputs key on `sm`, which
   * cannot see that a 400px column sits on a 1600px screen.
   */
  compact?: boolean;
};


export function FormRenderer({
  form,
  readOnly = false,
  watermark,
  highlightDepartment = null,
  onChange,
  values,
  errors,
  hiddenQuestionIds,
  renderAside,
  highlightQuestionId = null,
  compact = false,
}: FormRendererProps) {
  const hidden = new Set(hiddenQuestionIds ?? form.hiddenQuestionIds ?? []);
  const tier = TIER_FOR_LAYER[form.layer];

  return (
    <div className="relative space-y-6">
      {watermark ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden"
        >
          <span className="-rotate-[24deg] select-none text-display-lg font-bold uppercase tracking-[0.3em] text-ink/[0.06]">
            {watermark}
          </span>
        </div>
      ) : null}

      {form.sections.map((section) => {
        // A section whose every question is hidden renders nothing at all — an
        // empty card reads as a loading failure.
        if (section.questions.every((q) => hidden.has(q.questionId))) return null;

        const isJobSpecific = section.section === DEPARTMENT_SECTION;
        const highlighted = isJobSpecific && Boolean(highlightDepartment);

        return (
          <div
            key={section.section}
            // The scroll target for "show me this section". Sections are unique
            // per form (the enum is fixed, §0.2), so the value is a safe id.
            id={`sec-${section.section}`}
            className="space-y-2"
          >
            <SectionCard
              // HR's name for it (0036) if the form carries one, otherwise the
              // shipped default. Never a literal — §17, and the rule that has
              // caught P9, P12 and P15.
              title={section.label ?? sectionLabel(section.section)}
              description={
                highlighted
                  ? `This section is specific to ${highlightDepartment}. Everything else is the same for all employees.`
                  : undefined
              }
              className={cn(
                highlighted &&
                  // The one section that varies gets a visible frame, so HR can
                  // see at a glance which part of the form they control.
                  "ring-2 ring-accent-primary/40",
              )}
            >
              {section.questions
                // §6: a hidden conditional is not rendered at all. It is also
                // not validated and not stored — see buildZodSchema.
                .filter((question) => !hidden.has(question.questionId))
                .map((question) => (
                  <QuestionField
                    key={question.questionId}
                    question={question}
                    tier={tier}
                    value={(values ?? form.answers)[question.questionId]}
                    error={errors?.[question.questionId]}
                    readOnly={readOnly}
                    onChange={onChange}
                    renderAside={renderAside}
                    highlighted={question.questionId === highlightQuestionId}
                    compact={compact}
                  />
                ))}
            </SectionCard>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- One question ---------- */

function QuestionField({
  question,
  tier,
  value,
  error,
  readOnly,
  onChange,
  renderAside,
  highlighted = false,
  compact = false,
}: {
  question: FormQuestion;
  tier: "self" | "lead" | "final";
  value: unknown;
  error?: string;
  readOnly: boolean;
  onChange?: (questionId: string, value: unknown) => void;
  renderAside?: (question: FormQuestion) => React.ReactNode;
  highlighted?: boolean;
  compact?: boolean;
}) {
  // Local state so the preview is genuinely usable — HR can click a rating and
  // see how it behaves — without the caller having to hold answers it will
  // throw away.
  const [local, setLocal] = useState<unknown>(value);
  const current = onChange ? value : local;

  function set(next: unknown) {
    if (readOnly) return;
    if (onChange) onChange(question.questionId, next);
    else setLocal(next);
  }

  const options = question.options ?? [];


  const input = (
    <>
      {question.responseType === "SCALE_0_5" ? (
        <RatingScale
          tier={tier}
          value={typeof current === "number" ? current : null}
          onChange={readOnly ? undefined : (v) => set(v)}
          readOnly={readOnly}
          label={question.text}
          compact={compact}
        />
      ) : null}

      {question.responseType === "TICK_3" ? (
        <TickScale
          tier={tier}
          value={(current as Tick3Value | null) ?? null}
          onChange={readOnly ? undefined : (v) => set(v)}
          readOnly={readOnly}
          label={question.text}
          compact={compact}
        />
      ) : null}

      {question.responseType === "NUMBER" ? (
        <Input
          type="number"
          inputMode="numeric"
          disabled={readOnly}
          value={typeof current === "number" || typeof current === "string" ? String(current) : ""}
          onChange={(e) => set(e.target.value === "" ? null : Number(e.target.value))}
          min={question.minValue ?? undefined}
          max={question.maxValue ?? undefined}
          className="tabular min-h-11 max-w-[200px]"
        />
      ) : null}

      {question.responseType === "BOOLEAN" ? (
        <RadioGroup
          disabled={readOnly}
          value={current === true ? "yes" : current === false ? "no" : ""}
          onValueChange={(v) => set(v === "yes")}
          className="flex gap-6"
        >
          {[
            { v: "yes", label: "Yes" },
            { v: "no", label: "No" },
          ].map((o) => (
            <div key={o.v} className="flex min-h-11 items-center gap-2">
              <RadioGroupItem value={o.v} id={`${question.questionId}-${o.v}`} />
              <Label htmlFor={`${question.questionId}-${o.v}`} className="text-body">
                {o.label}
              </Label>
            </div>
          ))}
        </RadioGroup>
      ) : null}

      {question.responseType === "TEXT_SHORT" ? (
        <Input
          disabled={readOnly}
          value={typeof current === "string" ? current : ""}
          onChange={(e) => set(e.target.value)}
          className="min-h-11"
        />
      ) : null}

      {question.responseType === "TEXT_LONG" ? (
        <div className="space-y-1">
          <Textarea
            disabled={readOnly}
            rows={4}
            maxLength={1000}
            value={typeof current === "string" ? current : ""}
            onChange={(e) => set(e.target.value)}
          />
          {/* §6: 1000-character cap with a counter that turns rose at the
              limit. maxLength stops the overflow, so the rose state is a
              warning that they have run out of room, not an error. */}
          <p
            className={cn(
              "tabular text-right text-body-sm",
              (typeof current === "string" ? current.length : 0) >= 1000
                ? "font-medium text-critical"
                : "text-ink-muted",
            )}
          >
            {typeof current === "string" ? current.length : 0} / 1000
          </p>
        </div>
      ) : null}

      {question.responseType === "SINGLE_SELECT" ? (
        <RadioGroup
          disabled={readOnly}
          value={typeof current === "string" ? current : ""}
          onValueChange={(v) => set(v)}
          className="space-y-1"
        >
          {options.map((option) => (
            <div key={option.value} className="flex min-h-11 items-center gap-2">
              <RadioGroupItem value={option.value} id={`${question.questionId}-${option.value}`} />
              <Label htmlFor={`${question.questionId}-${option.value}`} className="text-body">
                {option.label}
              </Label>
            </div>
          ))}
        </RadioGroup>
      ) : null}

      {question.responseType === "MULTI_SELECT" ? (
        // P12: wrapped toggle chips, not a checkbox list. On a 375px screen a
        // column of checkboxes is a long scroll of small targets; chips wrap,
        // read as a set, and each one is a 44px tap.
        <div role="group" aria-label={question.text} className="flex flex-wrap gap-2">
          {options.map((option) => {
            const selected = Array.isArray(current) && current.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                disabled={readOnly}
                aria-pressed={selected}
                onClick={() => {
                  const list = Array.isArray(current) ? [...(current as string[])] : [];
                  set(
                    selected
                      ? list.filter((v) => v !== option.value)
                      : [...new Set([...list, option.value])],
                  );
                }}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-pill px-4 text-body transition-colors duration-hover",
                  selected
                    ? TIER_CHIP[tier]
                    : "bg-surface-mute text-ink-muted hover:text-ink",
                  readOnly && "opacity-60",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {question.responseType === "DATE" ? (
        <Input
          type="date"
          disabled={readOnly}
          value={typeof current === "string" ? current : ""}
          onChange={(e) => set(e.target.value)}
          className="tabular min-h-11 max-w-[200px]"
        />
      ) : null}
    </>
  );

  const heading = (
    <div className="space-y-1">
      <p className="text-body-lg text-ink">
        {question.text}
        {question.isRequired ? (
          <span className="ml-1 text-critical" aria-hidden>
            *
          </span>
        ) : null}
        {question.isRequired ? <span className="sr-only"> (required)</span> : null}
      </p>
      {/* -- Guidance is desktop-only. --
            33 questions each carrying a line of explanation is 33 extra lines
            between somebody and the next thing they have to answer, on the
            screen §13.2 says must be flawless at 375px. The question text is
            the question; this elaborates it, and elaboration is what gives way
            when space is the scarce thing.

            It is HIDDEN, not deleted — the same words still print on the pack
            and still show on a laptop. If a question genuinely cannot be
            answered on a phone without its guidance, the fix is to fold that
            into the question text in the form builder, where HR can see it
            being asked rather than relying on a second line nobody reads. -- */}
      {question.helpText ? (
        <p className="hidden text-body-sm text-ink-muted sm:block">{question.helpText}</p>
      ) : null}
    </div>
  );

  const errorMessage = error ? (
    // The message sits with the field, never only in a summary at the top —
    // somebody who scrolls straight to a highlighted row must be able to see
    // what is wrong with it.
    <p role="alert" className="text-body-sm font-medium text-critical">
      {error}
    </p>
  ) : null;

  return (
    // §4: form rows are ≥64px on employee-facing screens, so a long appraisal
    // reads like a page rather than a spreadsheet.
    <div
      // The scroll target for "jump to the first unanswered question".
      id={`q-${question.questionId}`}
      data-question-error={error ? "true" : undefined}
      className={cn(
        "min-h-16 space-y-3 border-b border-rule py-5 first:pt-0 last:border-b-0 last:pb-0",
        // P12: mark the FIELD, never the whole card. A card washed rose makes
        // every question in it look wrong.
        error && "-mx-3 rounded-control border-b-0 border-l-2 border-l-critical bg-critical-tint/30 px-3",
        // The builder's "you are editing this one" marker. A tint rather than a
        // border so nothing shifts by a pixel when it moves between rows, and
        // an error still wins — a highlighted row that is also invalid needs to
        // read as invalid first.
        highlighted && !error && "-mx-3 rounded-control bg-primary/[0.06] px-3 ring-1 ring-primary/30",
      )}
      data-highlighted={highlighted ? "true" : undefined}
    >
      {heading}

      {/* AMEND-3: one column. The paired layout, the reference readout and
          the inline "Employee said" line are all deleted — a lead may not
          read the SELF layer at all now (§5, blindness), so there is no
          second answer to place anywhere. */}
      {input}
      {errorMessage}
      {renderAside?.(question)}
    </div>
  );
}


/** Selected chip fill, per tier. Written out — Tailwind scans statically. */
const TIER_CHIP: Record<"self" | "lead" | "final", string> = {
  self: "bg-self text-white",
  lead: "bg-lead text-white",
  final: "bg-final text-white",
};
