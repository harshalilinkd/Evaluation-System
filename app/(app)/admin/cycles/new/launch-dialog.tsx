"use client";

/** The launch confirmation. P10 — "Launch is effectively irreversible." */

import * as React from "react";
import { Loader2, Rocket } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The stages the launch passes through, shown while the transaction runs.
 *
 * P10: "Show progress during the transaction — for 47 people this is not
 * instant." What is shown is honest about what it can know: the write is a
 * single database transaction, so there is no per-person progress to report
 * without breaking the atomicity that makes the launch safe. The stages are the
 * three real phases of the server action, and the last one is indeterminate on
 * purpose — a bar that pretends to know how far through 47 inserts it is would
 * be inventing the number.
 */
const STAGES = [
  "Re-checking readiness",
  "Assembling each person's questions",
  "Freezing snapshots and opening the cycle",
] as const;

export function LaunchDialog({
  open,
  onOpenChange,
  cycleName,
  participantCount,
  leadCount,
  cycleKind,
  pending,
  error,
  notice = null,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cycleName: string;
  participantCount: number;
  /** How many distinct HODs will receive a form. Item 12 names both counts. */
  leadCount: number;
  cycleKind: "BATCH" | "ROLLING";
  pending: boolean;
  error: string | null;
  /**
   * Set when the launch SUCCEEDED but no invite went out.
   *
   * Distinct from `error` on purpose — the cycle is live either way, and the
   * two need to look different or HR will relaunch something already launched.
   */
  notice?: string | null;
  onConfirm: () => void;
}) {
  // Both start empty for a given opening. The caller keys this component on
  // `open`, so a second attempt after a failure begins with the name box clear
  // rather than needing an effect to wipe it.
  const [typed, setTyped] = React.useState("");
  const [stage, setStage] = React.useState(0);

  // Walk the stage labels while the action is in flight. Deliberately not tied
  // to real progress — see the note on STAGES.
  React.useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 1200);
    return () => clearInterval(timer);
  }, [pending]);

  // Typing the name is the friction. It is compared case-insensitively and
  // trimmed: the point is to make somebody read which cycle they are launching,
  // not to test their typing.
  const confirmed = typed.trim().toLowerCase() === cycleName.trim().toLowerCase();

  return (
    <Dialog open={open} onOpenChange={pending ? () => {} : onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          {/* Items 12 and 13. The wording describes what ACTUALLY happens now:
              two people receive two links, they answer separately, and neither
              sees the other. The old copy described the sequential flow — the
              employee filling first and HR sending links afterwards — and both
              halves of that stopped being true. */}
          <DialogTitle>
            {cycleKind === "ROLLING" ? `Open ${cycleName}?` : `Launch ${cycleName}?`}
          </DialogTitle>
          <DialogDescription className="text-body text-ink-muted">
            {cycleKind === "ROLLING" ? (
              <>
                Nobody is added yet. People will appear in Due when their date arrives, and you
                confirm each one before their forms go out.
              </>
            ) : (
              <>
                This creates {participantCount} evaluations and freezes the current question set for
                each person, including their department&rsquo;s Job Specific Skills questions.{" "}
                {participantCount} employees and {leadCount} HODs will each receive their own form
                link right away. They fill the same questions separately and neither can see the
                other&rsquo;s answers. You will be able to open the combined report once both sides
                are in. Question changes made after this will not affect this cycle.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {pending ? (
          <div className="space-y-3 py-2">
            {STAGES.map((label, index) => (
              <div key={label} className="flex items-center gap-3">
                {index < stage ? (
                  <span aria-hidden className="size-4 rounded-pill bg-success" />
                ) : index === stage ? (
                  <Loader2 aria-hidden className="size-4 animate-spin text-primary" />
                ) : (
                  <span aria-hidden className="size-4 rounded-pill border border-rule" />
                )}
                <span
                  className={index <= stage ? "text-body text-ink" : "text-body text-ink-faint"}
                >
                  {label}
                </span>
              </div>
            ))}
            <p className="pt-1 text-body-sm text-ink-muted" aria-live="polite">
              Do not close this window. The whole cycle is written in one go — if anything fails,
              nothing is saved.
            </p>
          </div>
        ) : (
          <div className="space-y-2 py-2">
            <Label htmlFor="confirm-name">
              Type <span className="font-medium text-ink">{cycleName}</span> to confirm
            </Label>
            <Input
              id="confirm-name"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              placeholder={cycleName}
            />
          </div>
        )}

        {/* ---------- Launched, but nobody has been told ----------
            AMBER, not rose, and that distinction is the whole point: the cycle
            IS launched — the evaluations, the frozen snapshots and every token
            are written and audited. Only the messages did not go. Showing this
            as an error would have HR pressing Launch again on a cycle that is
            already live. */}
        {notice ? (
          <div
            role="status"
            className="space-y-2 rounded-control border border-warning/40 bg-warning-tint px-3 py-2"
          >
            <p className="text-body-sm font-medium text-ink">
              The cycle is launched, but no invite links were sent.
            </p>
            <p className="text-body-sm text-ink-muted">{notice}</p>
            <p className="text-body-sm text-ink-muted">
              Nothing is lost. Fix that, then send the links from the cycle&rsquo;s Send links
              screen.
            </p>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="rounded-control bg-critical-tint px-3 py-2 text-body-sm text-critical">
            {error}
          </p>
        ) : null}

        {/* Once launched there is nothing left to confirm and no way to undo
            it, so the footer stops offering both — one button, forward. */}
        <DialogFooter>
          {notice ? (
            <Button type="button" className="min-h-11" onClick={onConfirm}>
              Open the cycle
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={pending}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="min-h-11"
                disabled={!confirmed || pending}
                onClick={onConfirm}
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Rocket className="size-4" aria-hidden />
                )}
                {pending ? "Launching…" : `Launch ${participantCount} evaluations`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
