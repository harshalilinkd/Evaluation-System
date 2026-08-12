"use client";

/** Jump between sections of a long form. Phones only. */

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";

import { sectionLabel } from "@/lib/forms/labels";
import { isBlank } from "@/lib/forms/zod-generator";
import type { FormDefinition, RatingLayer } from "@/lib/forms/types";
import { LAYER_ANSWERED_BY } from "@/lib/forms/types";
import { cn } from "@/lib/utils";

/**
 * WHY THIS EXISTS
 *
 * A 31-question form is about twenty screenfuls on a phone, and roughly
 * twenty-five swipes from the first question to the Submit button. That was
 * reported as the form being unusable on a phone, and it is the half of that
 * complaint the save fixes did not touch: somebody who wants to check one answer
 * near the top has no way back but their thumb, and somebody returning to a
 * half-finished form has no way to find where they stopped.
 *
 * DELIBERATELY NOT PAGING. Splitting the form into steps would mean a partial
 * validation per step, a notion of "current step" to keep in sync with the
 * autosave, and a person who cannot see the whole thing before submitting it —
 * on a document they are signing. This moves the viewport and changes nothing
 * else: every question stays mounted, every answer stays in one form, and the
 * submit path is untouched.
 *
 * Sections are already anchored — `form-renderer` has emitted `id="sec-…"` since
 * NAV-2 — so this needed no change to the renderer at all.
 */
export function FormSectionNav({
  form,
  layer,
  values,
  hiddenQuestionIds,
}: {
  form: FormDefinition;
  layer: RatingLayer;
  values: Record<string, unknown>;
  hiddenQuestionIds: readonly string[];
}) {
  // Same shape the renderer takes, so both read one value with no conversion
  // at either call site.
  const hidden = React.useMemo(() => new Set(hiddenQuestionIds), [hiddenQuestionIds]);
  const [open, setOpen] = React.useState(false);
  const [current, setCurrent] = React.useState<string | null>(null);

  /* -- Only the sections that actually render. `form-renderer` drops a section
        whose every question is hidden, so listing it here would offer a jump to
        somewhere that does not exist. -- */
  const sections = React.useMemo(() => {
    const answeredBy = LAYER_ANSWERED_BY[layer];
    return form.sections
      .map((section) => {
        const mine = section.questions.filter(
          (q) => !hidden.has(q.questionId) && answeredBy.includes(q.answeredBy),
        );
        const visible = section.questions.filter((q) => !hidden.has(q.questionId));
        return {
          key: section.section,
          label: section.label ?? sectionLabel(section.section),
          total: mine.length,
          answered: mine.filter((q) => !isBlank(values[q.questionId])).length,
          renders: visible.length > 0,
        };
      })
      .filter((s) => s.renders);
  }, [form.sections, layer, values, hidden]);

  /* -- Which section is on screen. An observer rather than a scroll handler:
        a scroll handler runs on every frame of a flick and has to measure the
        DOM each time, which is exactly the work a mid-range phone cannot spare
        while a form of this size is mounted. -- */
  React.useEffect(() => {
    const nodes = sections
      .map((s) => document.getElementById(`sec-${s.key}`))
      .filter((n): n is HTMLElement => n !== null);
    if (nodes.length === 0) return;

    const seen = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) seen.set(entry.target.id, entry.intersectionRatio);
        let best: string | null = null;
        let bestRatio = 0;
        for (const [id, ratio] of seen) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            best = id;
          }
        }
        if (best && bestRatio > 0) setCurrent(best.replace(/^sec-/, ""));
      },
      // A band across the upper middle: the section somebody is READING, not the
      // one whose heading happens to be nearest the top of the viewport.
      { rootMargin: "-20% 0px -55% 0px", threshold: [0, 0.25, 0.5, 1] },
    );

    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [sections]);

  if (sections.length < 2) return null;

  const index = Math.max(
    0,
    sections.findIndex((s) => s.key === current),
  );
  const active = sections[index];
  const totalAnswered = sections.reduce((n, s) => n + s.answered, 0);
  const totalQuestions = sections.reduce((n, s) => n + s.total, 0);

  function jump(key: string) {
    setOpen(false);
    const node = document.getElementById(`sec-${key}`);
    if (!node) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // The sticky bar sits over the top of the page, so an unadjusted scroll puts
    // the heading underneath it.
    const top = node.getBoundingClientRect().top + window.scrollY - 96;
    window.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
  }

  return (
    <div className="sticky top-0 z-30 -mx-4 mb-4 bg-surface/95 px-4 py-2 backdrop-blur lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-control border border-rule bg-surface px-3 text-left"
      >
        <span className="min-w-0">
          <span className="block truncate font-sans text-body-sm font-medium text-ink">
            {active?.label ?? "This form"}
          </span>
          <span className="block font-sans text-body-sm text-ink-muted">
            Section {index + 1} of {sections.length} · {totalAnswered} of {totalQuestions} answered
          </span>
        </span>
        <ChevronDown
          aria-hidden
          className={cn("size-4 shrink-0 text-ink-muted transition-transform", open && "rotate-180")}
        />
      </button>

      {open ? (
        <ul className="mt-2 max-h-[60vh] overflow-y-auto rounded-control border border-rule bg-surface">
          {sections.map((s, i) => {
            const done = s.total > 0 && s.answered === s.total;
            return (
              <li key={s.key} className="border-b border-rule last:border-b-0">
                <button
                  type="button"
                  onClick={() => jump(s.key)}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left",
                    s.key === active?.key && "bg-surface-mute",
                  )}
                >
                  {/* Never colour alone (§13.8): the tick carries "finished",
                      the count carries how far, and the word is in the label. */}
                  <span className="w-4 shrink-0">
                    {done ? <Check aria-hidden className="size-4 text-success" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-sans text-body-sm text-ink">
                      {i + 1}. {s.label}
                    </span>
                  </span>
                  <span className="tabular shrink-0 font-sans text-body-sm text-ink-muted">
                    {s.total === 0 ? "—" : `${s.answered}/${s.total}`}
                    <span className="sr-only">
                      {s.total === 0 ? " nothing to answer here" : done ? " — finished" : " answered"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
