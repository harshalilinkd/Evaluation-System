/** The company mark on a form somebody is filling in. One implementation, four callers. */

import { cn } from "@/lib/utils";

/**
 * The mark at the head of an evaluation form.
 *
 * P27 put it on the printed pack; a form filled in on a phone at home is the
 * same document before it is signed, and it should say whose it is. Written
 * once rather than pasted into each screen — four spellings of one header is
 * exactly what P27's addendum had to go back and fix on the print routes.
 *
 * `tone="dark"` sets it on a white tile. The artwork is multi-coloured on a
 * transparent ground, so a dark header would swallow the strokes that give the
 * wordmark its shape (P27-8) — the tile is the plate it needs.
 *
 * `alt` is empty on purpose. It is decorative here: the heading beside it names
 * the document, and a browser renders *nothing* for a broken decorative image,
 * so a deployment missing `public/logo.png` shows a clean gap rather than a
 * broken-image glyph on somebody's appraisal.
 */
export function FormLetterhead({
  tone = "light",
  caption,
  className,
}: {
  tone?: "light" | "dark";
  /** The line under the mark. Omitted on compact headers where a title follows. */
  caption?: string;
  className?: string;
}) {
  return (
    /* -- Centred, and the plate is gone.
          The white tile existed because the original artwork was multi-coloured
          on an opaque ground and a dark header swallowed its strokes (P27-8).
          The mark is transparent now, so it sits directly on whatever is behind
          it — and a white rectangle floating on a dark card was the thing that
          made the header look pasted on rather than printed.

          Centred because a letterhead is centred. Left-aligned it read as an
          icon beside a heading; on its own axis it reads as the top of a
          document, which is what the form is. -- */
    <div className={cn("flex flex-col items-center gap-1.5 text-center", className)}>
      <span className="flex h-11 w-[112px] shrink-0 items-center justify-center overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element -- a fixed-size mark at the top of the page; next/image would defer the one element that should paint first, and the optimiser has nothing to add to it. */}
        <img src="/logo.png" alt="" className="h-full w-full object-contain" />
      </span>

      {caption ? (
        <span
          className={cn(
            "text-body-sm font-medium",
            tone === "dark" ? "text-ink-invert-muted" : "text-ink-muted",
          )}
        >
          {caption}
        </span>
      ) : null}
    </div>
  );
}
