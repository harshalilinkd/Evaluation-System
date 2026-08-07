"use client";

/** Theme and rail state. No dependency — CLAUDE.md §17 forbids one outside §2. */

import * as React from "react";
import { Monitor, Moon, PanelLeftClose, PanelLeftOpen, Sun } from "lucide-react";

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

export type ThemeChoice = "light" | "dark" | "system";

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
export const THEME_SCRIPT = `
(function(){
  try {
    var t = localStorage.getItem('${THEME_STORAGE_KEY}') || 'system';
    var dark = t === 'dark' || (t === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
    var r = document.documentElement;
    r.setAttribute('data-theme', dark ? 'dark' : 'light');
    r.classList.toggle('dark', dark);
    r.setAttribute('data-rail', localStorage.getItem('${RAIL_STORAGE_KEY}') === 'collapsed' ? 'collapsed' : 'open');
  } catch (e) {
    /* Private mode blocks localStorage. Light and open are the defaults the
       markup already assumes, so doing nothing is the correct fallback. */
  }
})();
`;

function applyTheme(choice: ThemeChoice) {
  const dark =
    choice === "dark" ||
    (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  const root = document.documentElement;
  root.setAttribute("data-theme", dark ? "dark" : "light");
  root.classList.toggle("dark", dark);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Nothing to do — the choice still applies for this page.
  }
}

/* ---------- Theme toggle ---------- */

const CHOICES: ReadonlyArray<{ value: ThemeChoice; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  // Not a nicety: somebody whose laptop switches at sunset expects this to
  // follow, and a product that ignores the OS reads as unfinished.
  { value: "system", label: "System", icon: Monitor },
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

function readTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    /* private mode */
  }
  return "system";
}

function readRail(): boolean {
  return document.documentElement.getAttribute("data-rail") === "collapsed";
}

// The server has no localStorage and no DOM. These match the defaults on <html>
// in app/layout.tsx, so the first client render agrees with the server HTML.
const serverTheme = (): ThemeChoice => "system";
const serverRail = () => false;

export function ThemeToggle({ className }: { className?: string }) {
  const choice = React.useSyncExternalStore(subscribe, readTheme, serverTheme);

  // Follow the OS while the choice is "system" — a laptop that switches at
  // sunset should take the app with it, without a reload. setState is never
  // called here; applyTheme writes to the DOM, which is the external system
  // this effect exists to synchronise.
  React.useEffect(() => {
    if (choice !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [choice]);

  const Active = CHOICES.find((c) => c.value === choice)?.icon ?? Monitor;

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
