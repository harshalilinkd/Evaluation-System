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
    <div className={cn("flex items-center gap-3", className)}>
      <span
        className={cn(
          "flex h-9 w-[76px] shrink-0 items-center justify-center overflow-hidden rounded-input",
          // On a light card the artwork sits directly on the surface; on ink it
          // needs the plate.
          tone === "dark" ? "bg-white p-1" : "bg-transparent",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a fixed-size mark at the top of the page; next/image would defer the one element that should paint first, and the optimiser has nothing to add to it. */}
        <img src="/logo.png" alt="" className="h-full w-full object-contain" />
      </span>

      {caption ? (
        <span
          className={cn(
            "text-body-sm font-medium",
            tone === "dark" ? "text-ink-invert/80" : "text-ink-muted",
          )}
        >
          {caption}
        </span>
      ) : null}
    </div>
  );
}
