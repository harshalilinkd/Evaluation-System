"use client";

/** RatingScale — the SCALE_0_5 input. DESIGN.md §6.1, labels from CLAUDE.md §6. */

import { useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import {
  SCALE_0_5_LABELS,
  SCALE_ANCHORS,
  TIER_CLASSES,
  type Tier,
} from "@/components/appraise/tier";

export type RatingScaleProps = {
  value: number | null;
  onChange?: (value: number) => void;
  /** Which layer is filling this in — decides the fill colour (§6.1). */
  tier: Tier;
  readOnly?: boolean;
  /** Message shown below; also puts a 1px critical border on the group. */
  error?: string | null;
  /**
   * §6.4: the MD's override cell pre-fills with the Lead score as a ghost value
   * until the MD touches it, so the number they are moving away from stays
   * visible while they decide.
   */
  showGhost?: boolean;
  ghostValue?: number | null;
  /** Accessible name. Normally the question text. */
  label?: string;
  name?: string;
  /**
   * Render for a narrow CONTAINER rather than a narrow viewport.
   *
   * The responsive rules below key on `sm`, which is the viewport — correct for
   * a phone, wrong for a 400px preview pane on a 1600px monitor. There the
   * viewport says "wide", six cells get ~55px each, and "dissatisfied" is
   * simply longer than that.
   *
   * Container queries would answer this directly but need a Tailwind plugin
   * (§17), so the caller says so instead. It reuses the 3x2 layout that already
   * ships for 375px — a case that is already designed rather than a third one.
   */
  compact?: boolean;
};

/**
 * Six segmented cells, 0 to 5.
 *
 * Keyboard model is a radiogroup with a roving tabindex, which is what makes it
 * one Tab stop rather than six: arrow keys move between ratings, Home and End
 * jump to the ends. A rating is a single choice among six, and Tab should carry
 * on to the next question.
 *
 * The full label wording is fixed by CLAUDE.md §6 and appears in three places
 * (§6.1): under the selected cell, on hover or focus, and — because there is no
 * hover on a phone — as a permanent legend below the group on mobile.
 */
export function RatingScale({
  value,
  onChange,
  tier,
  readOnly = false,
  error = null,
  showGhost = false,
  ghostValue = null,
  label,
  name,
  compact = false,
}: RatingScaleProps) {
  const groupId = useId();
  const errorId = `${groupId}-error`;
  const [focusedValue, setFocusedValue] = useState<number | null>(null);
  const cellRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const tierClasses = TIER_CLASSES[tier];
  const isInteractive = !readOnly && Boolean(onChange);

  // What the description line reads: whatever is under the pointer or keyboard
  // focus, falling back to the current selection.
  const shown = SCALE_0_5_LABELS.find((l) => l.value === (focusedValue ?? value));

  function select(next: number) {
    if (!isInteractive) return;
    onChange?.(next);
    cellRefs.current[next]?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!isInteractive) return;

    const current = value ?? 0;
    let next: number | null = null;

    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = Math.min(5, current + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = Math.max(0, current - 1);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = 5;
        break;
      default:
        return;
    }

    // Only now, once we know the key was ours — otherwise Tab and Shift+Tab
    // would be swallowed and the form would become a trap.
    event.preventDefault();
    select(next);
  }

  return (
    <div className="space-y-2">
      {/* §6.1: anchors sit OUTSIDE the group, in ink-faint, label token. */}
      <div className="flex items-end justify-between gap-4">
        <span className="type-label text-ink-muted">{SCALE_ANCHORS.low}</span>
        <span className="type-label text-ink-muted">{SCALE_ANCHORS.high}</span>
      </div>

      <div
        role="radiogroup"
        aria-label={label ?? "Rating from 0 to 5"}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onKeyDown={onKeyDown}
        className={cn(
          // One row on desktop; 3x2 at 375px so no cell drops below a usable
          // width and nothing overflows (§6.1). `compact` holds the 3x2 layout
          // whatever the viewport says, for callers in a narrow container.
          "grid gap-2",
          compact ? "grid-cols-3" : "grid-cols-3 sm:grid-cols-6",
          // Never colour the whole card red — just the group (§6.1).
          error && "rounded-control border border-critical p-2",
        )}
      >
        {SCALE_0_5_LABELS.map((option) => {
          const isSelected = value === option.value;
          const isGhost = showGhost && !isSelected && ghostValue === option.value;

          return (
            <button
              key={option.value}
              ref={(el) => {
                cellRefs.current[option.value] = el;
              }}
              type="button"
              role="radio"
              aria-checked={isSelected}
              // Roving tabindex: exactly one cell is tabbable at a time.
              tabIndex={isSelected || (value === null && option.value === 0) ? 0 : -1}
              disabled={!isInteractive}
              onClick={() => select(option.value)}
              onMouseEnter={() => setFocusedValue(option.value)}
              onMouseLeave={() => setFocusedValue(null)}
              onFocus={() => setFocusedValue(option.value)}
              onBlur={() => setFocusedValue(null)}
              className={cn(
                // 48px preferred over the 44px minimum (§6.1, §9).
                "relative flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-control border px-1 py-2",
                // min-w-0 is load-bearing: a grid item defaults to
                // `min-width: auto`, so without it the cell refuses to shrink
                // below its longest word and the text renders straight through
                // the border instead.
                "min-w-0",
                "transition-colors duration-hover ease-out",
                "focus-visible:outline-none",
                isSelected
                  ? // Tier tint fill plus a tier border. The 1.5px of §6.1 is
                    // rendered as a ring so it does not shift the cell by half
                    // a pixel relative to its unselected neighbours.
                    cn(tierClasses.selected, "ring-[0.5px]", tierClasses.ring)
                  : "border-rule bg-surface text-ink-muted",
                isInteractive && !isSelected && "hover:border-rule hover:bg-surface-mute",
                !isInteractive && "cursor-default",
              )}
            >
              {/* §3: every numeral is mono and tabular. */}
              <span
                className={cn(
                  "tabular text-body-lg leading-none",
                  isSelected ? tierClasses.numeral : "text-ink",
                  // The ghost: the lead's score showing through until the MD
                  // picks their own (§6.4).
                  isGhost && "opacity-40",
                )}
              >
                {option.value}
              </span>

              <span
                className={cn(
                  // w-full + break-words: the last line of defence. Even in a
                  // cell narrower than the word, it wraps inside the border
                  // rather than spilling over it.
                  "w-full break-words text-center font-sans text-[11px] leading-tight",
                  isSelected ? tierClasses.numeral : "text-ink-muted",
                )}
              >
                {option.word}
              </span>

              {isGhost ? <span className="sr-only">Manager&rsquo;s rating</span> : null}
            </button>
          );
        })}
      </div>

      {name ? <input type="hidden" name={name} value={value ?? ""} /> : null}

      {/* Desktop: the full label for whatever is selected, hovered or focused.
          `compact` suppresses it for the same reason it collapses the grid — a
          narrow COLUMN on a wide screen was getting the desktop treatment,
          which is a one-line readout and no legend at all. */}
      <p
        className={cn(
          "min-h-5 font-sans text-body-sm text-ink-muted",
          compact ? "hidden" : "hidden sm:block",
        )}
      >
        {shown ? shown.full : "Not yet rated"}
      </p>

      {/* -- THE PER-QUESTION LEGEND IS GONE, and nothing here replaces it.
            It used to print §6's six sentences under every rating question,
            which is 198 lines of the same six sentences on a 33-question form.
            `ScaleLegend` now prints them once at the top, and every cell still
            carries its own number and short label.

            It survived behind `compact` on the reasoning that a preview pane
            has "no form around it to carry a legend" — which stopped being true
            the moment the previews started rendering one. The consequence was
            visible and was reported: the builder preview did not look like the
            form it was previewing. `compact` now means one thing only — render
            as if the viewport were narrow — and WHERE the wording goes is the
            caller's decision, made the same way on every screen. -- */}

      {error ? (
        <p id={errorId} role="alert" className="font-sans text-body-sm text-critical">
          {error}
        </p>
      ) : null}

      {showGhost && ghostValue !== null && value === null ? (
        <p className="font-sans text-body-sm text-ink-muted">
          Showing the lead&rsquo;s rating of {ghostValue}. Choose a value to override it.
        </p>
      ) : null}
    </div>
  );
}


/* ---------- The scale, explained once ---------- */

/**
 * §6's six labels, printed once at the top of a form rather than under every
 * question.
 *
 * The wording is taken from `SCALE_0_5_LABELS`, never retyped — §6 says "fixed
 * wording, do not paraphrase", and P7-4 asserts that constant against the
 * constitution itself so the two cannot drift.
 *
 * A `<details>` so it collapses on a phone and can still be opened by anybody
 * who wants it. Native, so it is keyboard reachable and needs no state — and
 * `open` on `sm` and up would need JavaScript, which is not worth it for a
 * block a laptop has room for anyway.
 */
export function ScaleLegend({
  form,
  className,
}: {
  /* -- The legend takes the FORM and decides for itself whether it is needed.
        Five screens render this now, and "remember to check whether there is a
        0-5 question first" is a rule four of them would eventually get wrong in
        different directions. One rule, in the component that owns it. -- */
  form: { questions: ReadonlyArray<{ responseType: string }> };
  className?: string;
}) {
  if (!form.questions.some((q) => q.responseType === "SCALE_0_5")) return null;

  return (
    <details className={cn("card-surface px-4 py-3", className)}>
      <summary className="cursor-pointer list-none text-body-sm font-medium text-ink marker:hidden">
        What the numbers mean
        <span className="ml-2 text-body-sm font-normal text-ink-muted">0 to 5</span>
      </summary>
      <dl className="mt-3 grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {SCALE_0_5_LABELS.map((option) => (
          <div key={option.value} className="flex gap-2">
            <dt className="tabular w-3 shrink-0 text-body-sm text-ink-muted">{option.value}</dt>
            <dd className="text-body-sm text-ink-muted">{option.full}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
