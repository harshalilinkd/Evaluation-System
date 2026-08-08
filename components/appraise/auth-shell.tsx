/** The centred paper card every unauthenticated page sits on. DESIGN.md §1, §7. */

import type { ReactNode } from "react";

export function AuthShell({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 space-y-1">
          <p className="type-label text-ink-muted">{eyebrow ?? "LinkD Prints"}</p>
          {/* Display face, not the UI face — this is the one editorial moment
              on an otherwise purely functional screen. */}
          <h1 className="font-sans text-display-lg text-ink">{title}</h1>
        </div>

        {/* SectionCard (DESIGN.md §6.7): white surface, 1px rule, 10px radius,
            24px padding. Borders over shadows. */}
        <div className="card-surface p-6">{children}</div>
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
