/** What a screen shows while its data is still on the way. */

import { cn } from "@/lib/utils";

/**
 * THE PRODUCT HAD NO LOADING STATE ANYWHERE. Not one `loading.tsx`.
 *
 * §13.4 asks for one on every async screen and §16 lists it in the Definition of
 * Done, and every authenticated page is `force-dynamic` with several server
 * queries behind it — FIX-8 counted eleven on `/my-evaluation` before they were
 * parallelised. With no boundary, Next holds the OLD page on screen until the
 * server answers, so a navigation on a slow connection looks like a click that
 * did nothing. The reader presses it again.
 *
 * A SKELETON, NOT A SPINNER. A spinner says "wait"; a skeleton says "wait, and
 * here is the shape of what is coming", so the page does not jump when it
 * arrives. It also costs nothing to be honest with: these mirror the real
 * layouts rather than being generic grey boxes.
 *
 * `aria-busy` and a polite live region, so this is announced rather than being a
 * silent flicker — and `aria-hidden` on the bars themselves, because their
 * shapes mean nothing read aloud.
 */
export function Shimmer({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      /* -- `animate-pulse` is Tailwind's own, and `motion-reduce:animate-none`
            is what makes it safe: DESIGN.md §5 keeps motion to confirmation, and
            somebody who has asked their system for less of it should not get a
            pulsing page. -- */
      className={cn(
        "animate-pulse rounded-control bg-surface-mute motion-reduce:animate-none",
        className,
      )}
    />
  );
}

/** A card-shaped placeholder, at the same radius and padding as a real card. */
export function CardSkeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("card-surface space-y-3 p-6", className)}>
      <Shimmer className="h-3 w-24" />
      <Shimmer className="h-7 w-32" />
      {Array.from({ length: Math.max(0, lines - 2) }).map((_, i) => (
        <Shimmer key={i} className={cn("h-3", i % 2 === 0 ? "w-full" : "w-3/4")} />
      ))}
    </div>
  );
}

/**
 * A whole screen's worth, in the rhythm the real pages use: 32px between
 * groups, 16px within. Matching it means the page does not reflow when the
 * data lands, which is the difference between a skeleton and a flash.
 */
export function PageSkeleton({
  cards = 4,
  columns = 3,
  label = "Loading",
}: {
  cards?: number;
  /** How many across at `lg`. Kept to the counts the grids actually use. */
  columns?: 2 | 3 | 4;
  /** What is being fetched, for anybody listening rather than looking. */
  label?: string;
}) {
  const grid =
    columns === 2 ? "lg:grid-cols-2" : columns === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4";

  return (
    <div className="space-y-8 px-4 py-6 lg:px-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>

      {/* The header line every screen opens with. */}
      <div className="space-y-2">
        <Shimmer className="h-6 w-48" />
        <Shimmer className="h-3 w-72" />
      </div>

      <div className={cn("grid gap-4", grid)}>
        {Array.from({ length: cards }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
