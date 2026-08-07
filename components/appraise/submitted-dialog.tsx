"use client";

/** The thank-you shown once a rating form is in. One component, both forms. */

import { motion, useReducedMotion } from "framer-motion";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/*
 * Filling in an appraisal is twenty minutes of somebody's careful attention,
 * and until now the only acknowledgement was a banner appearing at the top of
 * a page they had already scrolled past. This is the moment to say thank you
 * properly, and to answer the question everybody has at that moment: is that
 * it, and what happens now.
 *
 * ONE component for both forms rather than two nearly identical ones. What
 * differs is the tier tint and three sentences, which are props — and a second
 * copy is how the employee's version ends up saying something the lead's does
 * not, in a product where the difference between those two audiences is the
 * whole design (§5).
 */

const TIER_RING: Record<"self" | "lead", string> = {
  // §13.1: the reserved tier colours, used here to say WHOSE form has landed.
  // Never green — green is the trend colour and never a tier (UI2-2). The green
  // is on the tick alone, where it means "done", not "who".
  self: "bg-self-tint text-self",
  lead: "bg-lead-tint text-lead",
};

export function SubmittedDialog({
  open,
  onOpenChange,
  tier,
  title,
  body,
  actionLabel,
  onAction,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tier: "self" | "lead";
  title: string;
  /** What happens next. Kept short — this is a full stop, not a briefing. */
  body: string;
  actionLabel: string;
  onAction: () => void;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[min(94vw,440px)] max-w-[94vw] border-rule bg-surface text-center"
        // The one dialog in the product with nothing to lose by being dismissed
        // — the work is already saved and locked — so clicking away is allowed
        // and the X is enough of an escape.
      >
        <div className="flex flex-col items-center gap-4 px-2 pb-2 pt-4">
          <motion.span
            aria-hidden
            className={cn(
              "flex size-14 items-center justify-center rounded-pill",
              TIER_RING[tier],
            )}
            // Restrained (DESIGN.md §5): motion confirms, it never performs.
            // A gentle settle, not a bounce — this is a thank-you, not applause.
            initial={reduceMotion ? false : { scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <Check className="size-7 text-success" strokeWidth={2.5} />
          </motion.span>

          <div className="space-y-1.5">
            {/* The accessible name of the dialog, and the thank-you itself. */}
            <DialogTitle className="font-sans text-display-sm text-ink">{title}</DialogTitle>
            <p className="text-body text-ink-muted">{body}</p>
          </div>

          {/* §13.3: one action, and it is the way out. */}
          <Button className="mt-1 min-h-11 w-full" onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
