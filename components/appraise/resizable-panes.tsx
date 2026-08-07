/** Drag-resizable columns with a keyboard-operable splitter. */

"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Widths are held as FRACTIONS of the track, not pixels.
 *
 * A pixel layout looks right on the monitor it was dragged on and wrong on every
 * other one — and this screen is explicitly three panes that must stay usable
 * from 1150px to an ultrawide. Fractions re-flow; pixels do not.
 *
 * The splitter is a real `separator` with `aria-valuenow`, and arrow keys move
 * it. §13.8 makes keyboard reach non-negotiable, and a pointer-only splitter
 * would put the entire layout out of reach of anybody not using a mouse.
 */

const MIN_FRACTION = 0.14;
const KEYBOARD_STEP = 0.02;

export type PaneLayout = readonly number[];

/**
 * A tiny localStorage-backed store, read through `useSyncExternalStore`.
 *
 * The obvious version — `useState(initial)` plus an effect that reads
 * localStorage — trips the React compiler's cascading-render rule, and it is
 * also wrong on the merits: the value lives in localStorage, and copying it into
 * state means two panes could each hold their own stale version of something one
 * source owns (UI2-11). The server snapshot is the default, so SSR and the first
 * client paint agree and there is no hydration mismatch.
 */
const listeners = new Set<() => void>();
const cache = new Map<string, PaneLayout>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readLayout(key: string, initial: PaneLayout): PaneLayout {
  const hit = cache.get(key);
  // The reference must be STABLE between reads or useSyncExternalStore loops
  // forever, which is why the parsed value is cached rather than re-parsed.
  if (hit) return hit;
  let value = initial;
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (
      Array.isArray(parsed) &&
      parsed.length === initial.length &&
      parsed.every((n) => typeof n === "number" && n >= MIN_FRACTION)
    ) {
      value = parsed as PaneLayout;
    }
  } catch {
    // A corrupt entry is not worth a broken screen; the default stands.
  }
  cache.set(key, value);
  return value;
}

function writeLayout(key: string, next: PaneLayout) {
  cache.set(key, next);
  try {
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Private mode. The drag still works for this session.
  }
  for (const listener of listeners) listener();
}

export function usePaneLayout(storageKey: string, initial: PaneLayout) {
  const layout = React.useSyncExternalStore(
    subscribe,
    () => readLayout(storageKey, initial),
    () => initial,
  );

  const setLayout = React.useCallback(
    (next: PaneLayout) => writeLayout(storageKey, next),
    [storageKey],
  );

  const reset = React.useCallback(
    () => writeLayout(storageKey, initial),
    [storageKey, initial],
  );

  return { layout, setLayout, reset };
}

export function ResizablePanes({
  layout,
  onLayoutChange,
  labels,
  children,
  className,
}: {
  layout: PaneLayout;
  onLayoutChange: (next: PaneLayout) => void;
  /** One per pane. Read out by the splitter, so they must say what moves. */
  labels: readonly string[];
  children: React.ReactNode;
  className?: string;
}) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const panes = React.Children.toArray(children);
  const [dragging, setDragging] = React.useState<number | null>(null);

  /** Moves the boundary between pane `i` and `i + 1`, keeping the rest fixed. */
  const move = React.useCallback(
    (i: number, deltaFraction: number) => {
      const next = [...layout];
      const left = next[i] ?? 0;
      const right = next[i + 1] ?? 0;
      // Clamped as a PAIR. Clamping each side independently lets the total drift
      // away from 1 and the track slowly stops filling its container.
      const delta = Math.max(
        Math.min(deltaFraction, right - MIN_FRACTION),
        MIN_FRACTION - left,
      );
      next[i] = left + delta;
      next[i + 1] = right - delta;
      onLayoutChange(next);
    },
    [layout, onLayoutChange],
  );

  React.useEffect(() => {
    if (dragging === null) return;

    const onMove = (event: PointerEvent) => {
      const track = trackRef.current;
      if (!track) return;
      const width = track.getBoundingClientRect().width;
      if (width <= 0) return;
      move(dragging, event.movementX / width);
    };
    const stop = () => setDragging(null);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    // Without this the browser selects text across the whole screen while
    // dragging, which looks like a bug even though the resize is working.
    const previous = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.style.userSelect = previous;
      document.body.style.cursor = "";
    };
  }, [dragging, move]);

  return (
    <div ref={trackRef} className={cn("flex min-h-0 w-full items-stretch", className)}>
      {panes.map((pane, i) => (
        <React.Fragment key={i}>
          <div
            className="flex min-w-0 flex-col"
            style={{ flexBasis: `${(layout[i] ?? 0) * 100}%`, flexGrow: 0, flexShrink: 1 }}
          >
            {pane}
          </div>

          {i < panes.length - 1 ? (
            <div
              role="separator"
              aria-orientation="vertical"
              tabIndex={0}
              aria-label={`Resize ${labels[i] ?? "pane"} and ${labels[i + 1] ?? "pane"}`}
              aria-valuenow={Math.round((layout[i] ?? 0) * 100)}
              aria-valuemin={Math.round(MIN_FRACTION * 100)}
              aria-valuemax={100 - Math.round(MIN_FRACTION * 100)}
              onPointerDown={(e) => {
                e.preventDefault();
                setDragging(i);
              }}
              onDoubleClick={() => {
                // Even split of the pair — the cheapest way back from a drag
                // that went too far, without hunting for a reset control.
                const total = (layout[i] ?? 0) + (layout[i + 1] ?? 0);
                const next = [...layout];
                next[i] = total / 2;
                next[i + 1] = total / 2;
                onLayoutChange(next);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  move(i, -KEYBOARD_STEP);
                } else if (e.key === "ArrowRight") {
                  e.preventDefault();
                  move(i, KEYBOARD_STEP);
                }
              }}
              className={cn(
                "group relative w-3 shrink-0 cursor-col-resize touch-none",
                "focus-visible:outline-none",
              )}
            >
              {/* The hit area is 12px so it is reachable; the visible line is
                  2px so it reads as a seam rather than a column. */}
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute inset-y-2 left-1/2 w-0.5 -translate-x-1/2 rounded-full transition-all duration-200",
                  dragging === i
                    ? "bg-primary"
                    : "bg-border group-hover:bg-primary/60 group-focus-visible:bg-primary",
                )}
              />
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute left-1/2 top-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full transition-opacity duration-200",
                  dragging === i
                    ? "bg-primary opacity-100"
                    : "bg-ink-muted/40 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
                )}
              />
            </div>
          ) : null}
        </React.Fragment>
      ))}
    </div>
  );
}
