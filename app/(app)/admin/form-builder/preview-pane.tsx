/** Pane 3 — the live preview, drawn by the REAL FormRenderer. */

"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Eye, Monitor, Smartphone } from "lucide-react";

import { FormLetterhead } from "@/components/appraise/form-letterhead";
import { FormRenderer } from "@/components/appraise/form-renderer";
import { ScaleLegend } from "@/components/appraise/rating-scale";
import type { FormDefinition } from "@/lib/forms/types";
import { cn } from "@/lib/utils";

/**
 * WHO the preview is drawn for.
 *
 * The toggle used to read "Employee | Lead" with no statement of what it
 * changed, and it was read as a filter on the question list rather than a
 * change of viewer. It is the second one: the same form, seen by the two people
 * who fill it in. A question set to "Lead" simply is not on the employee's side
 * of the form, and this is where that becomes visible before a cycle launches.
 */
/** Said once, in one place, so it cannot drift between the two audiences. */
const NOT_AN_ANSWER = "nothing typed here is saved as an answer";

const AUDIENCES = [
  {
    value: "SELF" as const,
    label: "Employee",
    heading: "What the employee fills in",
    blurb: "Their own rating of themselves. They never see the lead's side.",
  },
  {
    value: "LEAD" as const,
    label: "Manager",
    heading: "What the lead fills in",
    blurb: "The lead's rating, with the employee's answers beside it once submitted.",
  },
];

export function PreviewPane({
  form,
  audience,
  onAudienceChange,
  phone,
  onPhoneChange,
  departmentName,
  questionCount,
  focusQuestionId,
  focusSection,
}: {
  form: FormDefinition;
  audience: "SELF" | "LEAD";
  onAudienceChange: (next: "SELF" | "LEAD") => void;
  phone: boolean;
  onPhoneChange: (next: boolean) => void;
  departmentName: string;
  questionCount: number;
  /** The question being edited. Ringed, and scrolled to when it changes. */
  focusQuestionId: string | null;
  /** The open section. Scrolled to when no single question is selected. */
  focusSection: string | null;
}) {
  const reduced = useReducedMotion();
  const current = AUDIENCES.find((a) => a.value === audience) ?? AUDIENCES[0]!;
  const scrollerRef = React.useRef<HTMLDivElement>(null);

  /* -- Keep the preview on whatever is being worked on.
        Without this the preview is a second document that has to be scrolled by
        hand every time the selection moves — which on a 30-question form means
        hunting for the row you just edited, every edit.

        Scrolls WITHIN the pane, never the page: `scrollIntoView` on a nested
        scroller will happily move the whole window too, which on this screen
        drags the structure list and the editor out of view to show something in
        the third pane. -- */
  React.useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const target = focusQuestionId
      ? scroller.querySelector(`[id="q-${CSS.escape(focusQuestionId)}"]`)
      : focusSection
        ? scroller.querySelector(`[id="sec-${CSS.escape(focusSection)}"]`)
        : null;
    if (!(target instanceof HTMLElement)) return;

    // Offset by the element's position within the scroller rather than calling
    // scrollIntoView, so only this pane moves.
    const top = target.offsetTop - scroller.offsetTop - 12;
    scroller.scrollTo({ top: Math.max(0, top), behavior: reduced ? "auto" : "smooth" });
    // `form` is a dependency because a question can move between sections, and
    // the element does not exist until that render has committed.
  }, [focusQuestionId, focusSection, form, reduced]);

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card-lg bg-canvas">
      {/* ---------- Controls ---------- */}
      <header className="shrink-0 space-y-3 border-b border-border/60 bg-surface px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-body-sm font-semibold uppercase tracking-wide text-ink-muted">
            <Eye aria-hidden className="size-3.5" />
            Live preview
          </span>

          <div className="flex items-center gap-2">
            <Segmented
              label="Preview as"
              value={audience}
              onChange={(v) => onAudienceChange(v as "SELF" | "LEAD")}
              options={AUDIENCES.map((a) => ({ value: a.value, label: a.label }))}
            />
            <Segmented
              label="Screen size"
              value={phone ? "phone" : "desktop"}
              onChange={(v) => onPhoneChange(v === "phone")}
              options={[
                { value: "desktop", label: "Desktop", icon: Monitor },
                { value: "phone", label: "Phone", icon: Smartphone },
              ]}
            />
          </div>
        </div>

        {/* The sentence that was missing. It names the viewer, the team and the
            fact that nothing here is an answer — the three things somebody
            looking at this screen actually needs to know. */}
        <motion.p
          key={audience}
          initial={reduced ? false : { opacity: 0, y: -3 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="text-body-sm leading-snug text-ink"
        >
          <strong className="font-semibold text-ink">{current.heading}</strong> · {current.blurb}
          <span className="mt-0.5 block text-body-sm text-ink-muted">
            {departmentName} · {questionCount}{" "}
            {questionCount === 1 ? "question" : "questions"} · {NOT_AN_ANSWER}
          </span>
        </motion.p>
      </header>

      {/* ---------- The paper ---------- */}
      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto p-5">
        <motion.div
          layout={!reduced}
          transition={{ type: "spring", stiffness: 300, damping: 34 }}
          // 387px, not 375: the 6px bezel sits OUTSIDE the screen, so the glass
          // is exactly 375px — the width §13.2 names.
          className={cn("mx-auto", phone ? "w-[387px] max-w-full" : "w-full max-w-[760px]")}
        >
          {/* At 375px the frame is drawn, because §13.2 makes the phone the
              first case: HR needs to see the real width, not a narrow column
              floating in a wide pane. */}
          <div
            className={cn(
              phone &&
                "overflow-hidden rounded-[28px] border-[6px] border-ink bg-canvas shadow-dashboard",
            )}
          >
            {/* p-4 because `.app-main` is px-4 — the preview must not be
                roomier than the screen it claims to be. */}
            <div className={cn(phone && "max-h-[70vh] overflow-y-auto p-4")}>
              {/* The mark the real form carries, so the preview is the whole
                  document rather than only its questions. */}
              <FormLetterhead caption="Performance evaluation" className="mb-4" />

              {form.questions.length === 0 ? (
                <p className="rounded-card border border-dashed border-border p-8 text-center text-body-sm text-ink-muted">
                  No questions are on this side of the form yet.
                </p>
              ) : (
                /* THE POINT OF THE SCREEN. A real FormDefinition handed to the
                   real FormRenderer — not an approximation. If it renders here
                   it renders identically for the employee, and that equivalence
                   is the whole value. A lookalike would be the second renderer
                   P9-1 forbids. */
                /* `compact` is what makes the phone frame TRUTHFUL. The inputs'
                   responsive rules key on `sm`, which is the viewport — and the
                   viewport here is a 1600px monitor, so a 340px frame was
                   getting the desktop layout: six rating cells across ~45px
                   each, "dissatisfied" breaking mid-word, and a hover-only
                   readout on a surface that has no hover. The frame said phone
                   and the form inside it did not. */
                <>
                  {/* §6's wording sits at the TOP of the form, once — the
                      placement the employee's screen uses. The preview drew it
                      under every question instead, which is why this pane did
                      not look like the form it was previewing. */}
                  <ScaleLegend form={form} className="mb-4" />

                  <FormRenderer
                    form={form}
                    readOnly
                    values={{}}
                    highlightQuestionId={focusQuestionId}
                    compact={phone}
                  />
                </>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* ---------- Segmented control ---------- */
//
// Defined at module scope, never inside the component. A component created
// during render is a new type every render, so the subtree remounts and every
// control loses focus mid-interaction (P14-12).
function Segmented({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: ReadonlyArray<{ value: string; label: string; icon?: React.ElementType }>;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="relative flex items-center gap-0.5 rounded-control bg-canvas p-0.5"
    >
      {options.map((option) => {
        const active = value === option.value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={cn(
              "relative flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-body-sm font-medium transition-colors",
              active ? "text-ink-invert" : "text-ink-muted hover:text-ink",
            )}
          >
            {active ? (
              <motion.span
                layoutId={`segmented-${label}`}
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
                className="absolute inset-0 rounded-[6px] bg-ink"
                aria-hidden
              />
            ) : null}
            {Icon ? <Icon aria-hidden className="relative size-3.5" /> : null}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
