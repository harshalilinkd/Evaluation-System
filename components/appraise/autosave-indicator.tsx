"use client";

/** AutosaveIndicator. DESIGN.md §13.6 — never lose a half-filled form. */

import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/utils/date";

export type AutosaveState = "idle" | "saving" | "saved" | "error";

/**
 * §13.6: "Autosave drafts every 20 seconds and on blur, with a visible
 * 'Saved HH:MM' indicator."
 *
 * The visible timestamp is the whole feature. An employee filling in a long
 * appraisal on a phone needs evidence their work is safe before they will trust
 * the form enough to keep going — a spinner that vanishes proves nothing an
 * hour later.
 *
 * Deliberately understated: no icon, no colour, no motion beyond a pulse while
 * saving. It is a reassurance, not an event (§5 — motion confirms, it never
 * entertains).
 */
export function AutosaveIndicator({
  state,
  savedAt,
  className,
}: {
  state: AutosaveState;
  /** When the last successful save landed. Rendered as HH:MM, Asia/Kolkata. */
  savedAt?: string | Date | null;
  className?: string;
}) {
  const text = (() => {
    switch (state) {
      case "saving":
        return "Saving…";
      case "saved":
        return savedAt ? `Saved ${formatTime(savedAt)}` : "Saved";
      case "error":
        return "Not saved — retrying";
      case "idle":
      default:
        // An empty form has nothing to report; saying "Idle" would be noise.
        return savedAt ? `Saved ${formatTime(savedAt)}` : "";
    }
  })();

  if (!text) return <span className={cn("font-sans text-body-sm", className)} aria-hidden />;

  return (
    <span
      // polite, not assertive: a save must never interrupt someone mid-sentence.
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1.5 font-sans text-body-sm",
        state === "error" ? "text-critical" : "text-ink-faint",
        className,
      )}
    >
      {state === "saving" ? (
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-pill bg-ink-faint motion-safe:animate-pulse"
        />
      ) : null}
      {/* The time is a number, so it is mono like every other number (§3). */}
      {state === "saved" || (state === "idle" && savedAt) ? (
        <>
          Saved <span className="tabular text-body-sm">{formatTime(savedAt)}</span>
        </>
      ) : (
        text
      )}
    </span>
  );
}
