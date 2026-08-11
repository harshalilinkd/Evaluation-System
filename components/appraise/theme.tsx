"use client";

/** Theme and rail state. No dependency — CLAUDE.md §17 forbids one outside §2. */

import * as React from "react";
import { Moon, PanelLeftClose, PanelLeftOpen, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * DESIGN.md §2 shipped light-only for v1 and P0-5 removed `next-themes` to stay
 * inside §17's dependency list. Both themes are now wanted, and the dependency
 * rule has not changed — so this is ~40 lines instead of a package.
 *
 * The state lives in one place: two attributes on <html>.
 *
 *   data-theme="light" | "dark"      the palette
 *   data-rail="open"   | "collapsed" the sidebar width
 *
 * CSS keys off both, so nothing re-renders to apply them and no component has
 * to be told which theme it is in.
 */

export const THEME_STORAGE_KEY = "appraise.theme";
export const RAIL_STORAGE_KEY = "appraise.rail";

export type ThemeChoice = "light" | "dark";

/**
 * Runs before first paint, from a <script> in the document head.
 *
 * WITHOUT THIS THE PAGE FLASHES WHITE. React cannot help: the markup is
 * streamed and hydrated after the browser has already painted, so a theme
 * applied in an effect arrives one frame too late — and a dark-theme user gets
 * a full-brightness flash on every navigation. Same for the rail: applying the
 * collapsed width after hydration makes the whole layout jump.
 *
 * It is a string because it must be inlined verbatim, and it is deliberately
 * tiny and dependency-free — it runs render-blocking on every page load.
 */
/* -- THE PRE-PAINT SCRIPT IS GONE, and nothing replaced it.
      It existed to read localStorage before first paint, and it was the only
      script this project injected. React 19 warns about it on every page load,
      and the warning is legitimate — a script rendered inside a component is a
      script that will not run on a client navigation.

      Its job is now done without JavaScript: the choice is a cookie, read on
      the server, so <html> arrives carrying the right `data-theme` and
      `data-rail`. Nothing has to run before the paint because the markup is
      already correct — and with no cookie the server writes "light", which is
      the default this product opens on.

      No flash either way, which is what the script was defending — and it is a
      stronger guarantee than the script gave, because it also holds with
      JavaScript disabled. localStorage is still written alongside, so the
      toggles keep reading the value they always did. -- */

/** How long a remembered theme lasts. A year — it is a preference, not a session. */
const PREF_MAX_AGE = 60 * 60 * 24 * 365;

function writeCookie(name: string, value: string) {
  try {
    document.cookie = `${name}=${value}; path=/; max-age=${PREF_MAX_AGE}; samesite=lax`;
  } catch {
    /* Cookies disabled. The attribute is already set for this page. */
  }
}


function applyTheme(choice: ThemeChoice) {
  const dark = choice === "dark";

  const root = document.documentElement;
  root.setAttribute("data-theme", dark ? "dark" : "light");
  root.classList.toggle("dark", dark);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Nothing to do — the choice still applies for this page.
  }
  /* -- The cookie is what the SERVER reads on the next request, so the next
        page arrives already correct instead of being corrected after paint.
        Always written now: with only two choices there is no state that has to
        be expressed as an absence. -- */
  writeCookie(THEME_STORAGE_KEY, dark ? "dark" : "light");
}

/* ---------- Theme toggle ---------- */

/* -- SYSTEM IS GONE, and that follows from light being the default.
      "System" was written as an ABSENCE — choosing it cleared the cookie so the
      `prefers-color-scheme` media query decided. That worked precisely because
      the server also omitted `data-theme` and let the media query win.

      Now that the server writes "light" when no choice is stored, the two
      disagree: the document would arrive light and the client would flip it to
      dark a frame later on every navigation, for anybody whose machine is dark.
      A visible flash on every page is worse than not offering the option.

      So the choice is Light or Dark, and one of them is always stored. Somebody
      whose laptop switches at sunset no longer takes the app with it — that is
      the cost of the instruction, and it is a real one. -- */
const CHOICES: ReadonlyArray<{ value: ThemeChoice; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

/**
 * The theme and rail choices live outside React — in localStorage and on the
 * <html> element — so they are read with useSyncExternalStore rather than
 * copied into state by a mount effect.
 *
 * That is not a lint workaround. A mount effect that calls setState is the
 * cascading-render pattern the React compiler rejects, and here it would also
 * be wrong: two toggles mounted at once (rail in the topbar, theme beside it)
 * would each hold their own stale copy of a value that one source owns.
 */
const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  // Another tab changing the theme should move this one too.
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

function emit() {
  for (const listener of listeners) listener();
}

/* -- No stored choice reads as LIGHT, matching what the server rendered.
      Returning "system" here would make the toggle show one thing while the
      document shows another. -- */
function readTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
    // A "system" left over from before the option was removed reads as light,
    // which is what the server rendered for it.
  } catch {
    /* private mode */
  }
  return "light";
}

function readRail(): boolean {
  return document.documentElement.getAttribute("data-rail") === "collapsed";
}

// The server has no localStorage and no DOM. These match the defaults on <html>
// in app/layout.tsx, so the first client render agrees with the server HTML.
const serverTheme = (): ThemeChoice => "light";
const serverRail = () => false;

export function ThemeToggle({ className }: { className?: string }) {
  const choice = React.useSyncExternalStore(subscribe, readTheme, serverTheme);

  /* -- The OS-following effect is gone with the option it existed for. It
        listened for `prefers-color-scheme` changes while the choice was
        "system"; nothing sets that any more. -- */
  const Active = CHOICES.find((c) => c.value === choice)?.icon ?? Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-11 rounded-control text-ink-muted hover:text-ink", className)}
          aria-label={`Theme: ${choice}. Change theme`}
        >
          <Active className="size-[18px]" aria-hidden />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-40">
        {CHOICES.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => {
              applyTheme(option.value);
              emit();
            }}
            className={cn(choice === option.value && "text-primary")}
          >
            <option.icon className="size-4" aria-hidden />
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ---------- Rail toggle ---------- */

export function RailToggle({ className }: { className?: string }) {
  const collapsed = React.useSyncExternalStore(subscribe, readRail, serverRail);

  const toggle = () => {
    const next = !collapsed;
    document.documentElement.setAttribute("data-rail", next ? "collapsed" : "open");
    try {
      localStorage.setItem(RAIL_STORAGE_KEY, next ? "collapsed" : "open");
    } catch {
      /* the toggle still works for this page */
    }
    writeCookie(RAIL_STORAGE_KEY, next ? "collapsed" : "open");
    emit();
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      // aria-expanded rather than a label that changes: screen readers announce
      // the state change without the button's name shifting under the user.
      aria-expanded={!collapsed}
      aria-label="Toggle sidebar"
      className={cn("size-11 rounded-control text-ink-muted hover:text-ink", className)}
    >
      {collapsed ? (
        <PanelLeftOpen className="size-[18px]" aria-hidden />
      ) : (
        <PanelLeftClose className="size-[18px]" aria-hidden />
      )}
    </Button>
  );
}
