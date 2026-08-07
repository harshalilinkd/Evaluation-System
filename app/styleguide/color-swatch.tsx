"use client";

/** Colour swatch that reads its own computed value, so no hex is hardcoded here. */

import { useCallback, useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";
import type { ColorToken } from "@/app/styleguide/tokens";

/**
 * Formats an RGB channel triplet as a hex string for display.
 *
 * The variables hold RGB channel triplets so Tailwind can apply opacity
 * modifiers (see globals.css). Converting back here means the page can be read
 * straight against DESIGN.md §2 without a hex literal existing in any source
 * file. Returns the raw value unchanged if it is not a triplet, so a malformed
 * token shows itself rather than silently rendering as black.
 */
function tripletToHex(value: string): string {
  const channels = value.split(/[\s,]+/).filter(Boolean);
  if (channels.length !== 3) return value;

  const hex = channels.map((channel) => {
    const n = Number(channel);
    if (!Number.isFinite(n) || n < 0 || n > 255) return null;
    return n.toString(16).padStart(2, "0");
  });

  return hex.includes(null) ? value : `#${hex.join("").toUpperCase()}`;
}

export function ColorSwatch({ token }: { token: ColorToken }) {
  // The stylesheet is an external store: the value has to come from
  // getComputedStyle, which needs a live document, and it never changes after
  // load. useSyncExternalStore is the sanctioned way to read one — an effect
  // plus setState here would trigger a cascading render on every swatch.
  //
  // Reading the real computed value (rather than restating the hex) means a
  // token missing from globals.css shows up blank on this page instead of
  // quietly rendering a literal that no longer matches the stylesheet.
  const subscribe = useCallback(() => {
    // Nothing to subscribe to: CSS custom properties are static for the session.
    return () => {};
  }, []);

  const getSnapshot = useCallback(() => {
    const computed = getComputedStyle(document.documentElement)
      .getPropertyValue(`--${token.variable}`)
      .trim();
    // Returns a primitive, so React's Object.is check stays stable across calls.
    return tripletToHex(computed);
  }, [token.variable]);

  // Server snapshot: nothing is computed during SSR, so render an empty slot.
  const getServerSnapshot = useCallback(() => "", []);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <div className="flex items-center gap-4">
      <div
        className={cn(
          "flex h-16 w-16 shrink-0 items-center justify-center rounded-control border border-rule",
          token.swatchClass,
        )}
        aria-hidden
      >
        <span
          className={cn(
            "tabular text-body-sm",
            token.invertLabel ? "text-ink-invert" : "text-ink-faint",
          )}
        >
          Aa
        </span>
      </div>

      <div className="min-w-0">
        <p className="tabular text-body-sm text-ink">--{token.variable}</p>
        {/* Non-breaking space holds the row height steady before hydration. */}
        <p className="tabular text-body-sm text-ink-muted">{value || " "}</p>
        <p className="font-sans text-body-sm text-ink-faint">{token.usage}</p>
      </div>
    </div>
  );
}
