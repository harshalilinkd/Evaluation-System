"use client";

/** The phone's fixed footer on a rating form: where you are, and the two actions. */

import { Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/utils/date";
import { cn } from "@/lib/utils";

export type FormSaveState = "idle" | "saving" | "saved" | "error";

/**
 * On a phone, everything that tells you HOW YOU ARE DOING lives at the top of
 * the form — the count, the progress bar, the "saved 15:58". One swipe and it
 * is gone, and a rating form is twenty swipes long. So somewhere around
 * question 22 the two questions a person actually has are "how many are left"
 * and "has this saved", and the screen answers neither.
 *
 * This is the answer, in the one strip that is always on screen. It replaces
 * two hand-built bars that had drifted apart in their spacing and their
 * disabled rules; one component means the employee's form and the manager's
 * cannot start behaving differently.
 *
 * §13.2 — the phone is the first case, not the fallback.
 *
 * OFFSET BY THE NAV'S OWN HEIGHT, never raised above it. `BottomNav` is fixed
 * at `bottom-0` with `z-40`; this bar was `bottom-0 z-20` and sat underneath
 * it, so an employee could answer every question and had no way to submit
 * (FIX-15). Raising this to `z-50` would fix the button by burying the
 * navigation, and somebody who cannot leave a form is no better off than
 * somebody who cannot submit one.
 */
export function FormActionBar({
  answered,
  total,
  saveState,
  savedAt,
  onSave,
  onSubmit,
  submitLabel = "Submit",
  busy,
  tier,
}: {
  answered: number;
  total: number;
  saveState: FormSaveState;
  savedAt: Date | null;
  onSave: () => void;
  onSubmit: () => void;
  submitLabel?: string;
  busy?: boolean;
  /** Whose progress this is. §13.1 reserves the hue for exactly that. */
  tier: "self" | "lead";
}) {
  const pct = total > 0 ? Math.round((answered / total) * 100) : 0;
  const left = Math.max(0, total - answered);

  return (
    <div className="glass fixed inset-x-0 bottom-[var(--bottom-nav-h)] z-20 border-t border-rule lg:hidden">
      {/* -- The progress rail is the FULL WIDTH OF THE BAR and 3px tall.
            A labelled bar inside the strip would cost a row of height on the
            screen with least of it. As the bar's own top edge it costs nothing
            and is still readable at a glance — and it sits above the buttons,
            so a thumb resting on Submit does not cover it. -- */}
      <div
        aria-hidden
        className="h-[3px] w-full bg-rule"
      >
        <span
          className={cn(
            "block h-full transition-all duration-panel",
            tier === "self" ? "bg-self" : "bg-lead",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex h-16 items-center gap-3 px-4">
        {/* -- Two lines, and they answer the two questions somebody has here.
              The count first because it is the one they came back for; the
              save state under it because it only matters when it is wrong.

              `aria-live` is deliberately NOT set: this re-renders on every
              keystroke's autosave, and a live region announcing "saved 15:58"
              over somebody reading question 22 is worse than silence. The
              failure case is announced by the error banner above, which is a
              real alert. -- */}
        <div className="min-w-0 shrink-0">
          <p className="tabular text-body font-semibold leading-none text-ink">
            {answered}
            <span className="text-ink-muted">/{total}</span>
          </p>
          <p
            className={cn(
              "mt-1 truncate text-[11px] leading-none",
              saveState === "error" ? "text-critical" : "text-ink-muted",
            )}
          >
            {saveState === "saving"
              ? "saving…"
              : saveState === "error"
                ? "not saved"
                : savedAt
                  ? `saved ${formatTime(savedAt)}`
                  : left === 0
                    ? "all answered"
                    : `${left} to go`}
          </p>
        </div>

        {/* -- Save keeps its own target and its own label rather than becoming
              an icon. It is the control somebody presses when they are about to
              be interrupted, and a bare disk glyph is not something to trust
              twenty minutes of work to. -- */}
        <Button
          variant="ghost"
          className="min-h-11 flex-1"
          onClick={onSave}
          disabled={saveState === "saving"}
        >
          {saveState === "saving" ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
          Save
        </Button>
        <Button className="min-h-11 flex-1" onClick={onSubmit} disabled={busy}>
          <Send aria-hidden className="size-4" />
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
