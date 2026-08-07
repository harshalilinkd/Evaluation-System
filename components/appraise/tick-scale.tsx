"use client";

/** TickScale — the TICK_3 worker input. DESIGN.md §6.2. Never renders a number. */

import { useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { TICK_3_OPTIONS, TIER_CLASSES, type Tick3Value, type Tier } from "@/components/appraise/tier";

export type TickScaleProps = {
  value: Tick3Value | null;
  onChange?: (value: Tick3Value) => void;
  tier: Tier;
  readOnly?: boolean;
  error?: string | null;
  label?: string;
  name?: string;
  /**
   * Render for a narrow CONTAINER rather than a narrow viewport — same contract
   * as `RatingScale`'s. The `sm:` rule below asks the viewport, which cannot see
   * that a 340px preview column is sitting on a 1600px screen.
   */
  compact?: boolean;
};

/**
 * Three wide cells: Excellent, Satisfactory, Needs Improvement.
 *
 * CLAUDE.md §6 maps these to 5 / 3 / 1 for analytics — and DESIGN.md §6.2 is
 * emphatic that the number never appears here. The worker form is a tick sheet,
 * as it is on paper; showing "5" beside Excellent would turn a signature-ready
 * document into a score card and change what the form means to the person
 * signing it.
 *
 * Same radiogroup and roving-tabindex model as RatingScale, for the same reason.
 */
export function TickScale({
  value,
  onChange,
  tier,
  readOnly = false,
  error = null,
  label,
  name,
  compact = false,
}: TickScaleProps) {
  const groupId = useId();
  const errorId = `${groupId}-error`;
  const [, setFocused] = useState<string | null>(null);
  const cellRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const tierClasses = TIER_CLASSES[tier];
  const isInteractive = !readOnly && Boolean(onChange);
  const currentIndex = TICK_3_OPTIONS.findIndex((o) => o.value === value);

  function select(next: Tick3Value) {
    if (!isInteractive) return;
    onChange?.(next);
    cellRefs.current[next]?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!isInteractive) return;

    const from = currentIndex === -1 ? 0 : currentIndex;
    let nextIndex: number | null = null;

    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = Math.min(TICK_3_OPTIONS.length - 1, from + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = Math.max(0, from - 1);
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = TICK_3_OPTIONS.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const option = TICK_3_OPTIONS[nextIndex];
    if (option) select(option.value);
  }

  return (
    <div className="space-y-2">
      <div
        role="radiogroup"
        aria-label={label ?? "Performance"}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onKeyDown={onKeyDown}
        className={cn(
          // Stacked at 375px so each cell keeps a full-width, comfortable
          // target. `compact` holds that layout whatever the viewport says.
          "grid gap-2",
          compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-3",
          error && "rounded-control border border-critical p-2",
        )}
      >
        {TICK_3_OPTIONS.map((option, index) => {
          const isSelected = value === option.value;

          return (
            <button
              key={option.value}
              ref={(el) => {
                cellRefs.current[option.value] = el;
              }}
              type="button"
              role="radio"
              aria-checked={isSelected}
              tabIndex={isSelected || (value === null && index === 0) ? 0 : -1}
              disabled={!isInteractive}
              onClick={() => select(option.value)}
              onFocus={() => setFocused(option.value)}
              onBlur={() => setFocused(null)}
              className={cn(
                "flex min-h-12 items-center justify-center rounded-control border px-3 py-2",
                "font-sans text-body transition-colors duration-hover ease-out",
                "focus-visible:outline-none",
                isSelected
                  ? cn(tierClasses.selected, "ring-[0.5px]", tierClasses.ring, "font-medium")
                  : "border-rule bg-surface text-ink-muted",
                isInteractive && !isSelected && "hover:border-rule hover:bg-surface-mute",
                !isInteractive && "cursor-default",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {name ? <input type="hidden" name={name} value={value ?? ""} /> : null}

      {error ? (
        <p id={errorId} role="alert" className="font-sans text-body-sm text-critical">
          {error}
        </p>
      ) : null}
    </div>
  );
}
