/** The centred paper card every unauthenticated page sits on. DESIGN.md §1, §7. */

import type { ReactNode } from "react";

import { AuthBackdrop } from "@/components/appraise/auth-backdrop";
import { cn } from "@/lib/utils";

export function AuthShell({
  eyebrow,
  title,
  /**
   * The animated 3D field, and the lifted card that sits on it.
   *
   * OPT-IN, NOT THE DEFAULT, because this shell is also every invite page's
   * shell — expired, already used, wrong recipient, locked. Those are moments
   * where somebody has hit a wall and needs a sentence they can act on, and
   * putting a slow cinematic field behind an apology is the product performing
   * at somebody who is stuck. DESIGN.md §5: motion confirms, it never performs.
   *
   * So sign-in gets it and the six failure states do not, which is a judgement
   * about what each page is FOR rather than an inconsistency.
   */
  backdrop = false,
  children,
}: {
  eyebrow?: string;
  title: string;
  backdrop?: boolean;
  children: ReactNode;
}) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center px-4 py-12">
      {backdrop ? <AuthBackdrop /> : null}

      {/* `relative` so the card is above the fixed field behind it, which is at
          -z-10 and would otherwise take the whole stacking context with it. */}
      <div className="relative w-full max-w-[420px]">
        {/* -- THE HEADING SITS ON THE CANVAS, NOT ON A CARD, so on the backdrop
              it cannot use the app's ink tokens: `--ink` is near-black, and the
              scene behind it is deliberately deep. Light type, fixed to the
              scene rather than to the theme, for the same reason the scene
              itself is fixed. -- */}
        <div className={cn("mb-6 space-y-1", backdrop && "auth-rise")}>
          <p className={cn("type-label", backdrop ? "text-white/55" : "text-ink-muted")}>
            {eyebrow ?? "LinkD Prints"}
          </p>
          {/* Display face, not the UI face — this is the one editorial moment
              on an otherwise purely functional screen. */}
          <h1 className={cn("font-sans text-display-lg", backdrop ? "text-white" : "text-ink")}>
            {title}
          </h1>
        </div>

        {/* SectionCard (DESIGN.md §6.7): white surface, 1px rule, 10px radius,
            24px padding. Borders over shadows.

            On the backdrop the card has to hold its own against a lit field, so
            it gains a hairline and a deeper shadow — it is the brightest, most
            solid object on screen, which is what makes it read as the thing to
            use rather than as another floating panel. It stays opaque: a
            translucent card would put moving geometry behind a password field. */}
        <div
          className={cn(
            "card-surface p-6",
            /* A deep drop and a lit top edge: on a dark scene the card has to
               read as ABOVE the field, and a shadow alone cannot do that —
               the inset highlight is what catches the light coming from
               behind it. */
            backdrop &&
              "auth-rise border-white/10 shadow-[0_50px_100px_-30px_rgb(2_4_16/0.75),inset_0_1px_0_0_rgb(255_255_255/0.9)] [--rise-delay:90ms]",
          )}
        >
          {children}
        </div>
      </div>
    </main>
  );
}

/**
 * The message block used by every invite-problem page.
 *
 * DESIGN.md §8: say what happened and what to do next. No "Oops!", no emoji,
 * and never a raw status enum — the person reading this did nothing wrong.
 */
export function Explanation({
  heading,
  body,
  action,
}: {
  heading: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h2 className="font-sans text-body-lg font-medium text-ink">{heading}</h2>
        <p className="font-sans text-body text-ink-muted">{body}</p>
      </div>
      {action}
    </div>
  );
}
