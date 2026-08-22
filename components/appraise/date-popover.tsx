"use client";

/**
 * A DATE FIELD THAT DOES NOT DEPEND ON THE BROWSER'S OWN POPUP.
 *
 * Reported from Salary history: the native `<input type="date">` calendar
 * closed itself when clicking its own month-navigation arrows, inside a
 * table that scrolls with a sticky header and re-renders on every keystroke.
 * That is a genuine, well-known Chromium quirk — a native date-input popup
 * can dismiss itself on a page reflow that has nothing to do with it, and a
 * busy data grid produces exactly that kind of reflow constantly. There is no
 * page-level fix for a bug inside a browser's own widget.
 *
 * So this owns the whole interaction instead: a plain button that shows the
 * date, and a small calendar this component renders, positions and closes
 * itself — nothing native, nothing for an unrelated repaint to dismiss by
 * accident. It closes on scroll DELIBERATELY, which is not the same bug: a
 * predictable close on a page-level event is ordinary popover behaviour
 * (every portal-based dropdown does this); the native bug was closing on
 * a reflow the person interacting with it never caused.
 *
 * NO NEW DEPENDENCY — built from a portal, a rect and plain `Date` math,
 * which is everything a one-month grid needs. §17 keeps the dependency list
 * pinned, and this needed nothing on it.
 */

import * as React from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { formatDate } from "@/lib/utils/date";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** `YYYY-MM-DD` → a local `Date`, never through the UTC-parsing string
 *  constructor — `new Date("2026-08-01")` is midnight UTC, which a browser
 *  west of Greenwich renders as 31 July. Built from the three numbers
 *  instead, which is not affected by the reader's own timezone. */
function parseIso(iso: string): Date | null {
  if (!iso) return null;
  const parts = iso.split("-").map(Number);
  const [y, m, d] = parts;
  if (!y || !m || !d || parts.length !== 3) return null;
  return new Date(y, m - 1, d);
}

/** The inverse — LOCAL fields, never `.toISOString()`, which converts
 *  through UTC and can shift the date by one depending on the timezone. */
function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Six weeks, Monday first, including the leading/trailing days from the
 *  neighbouring months so the grid is always a full 6×7 rectangle. */
function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Sun=0 → Sun=6, Mon=1 → Mon=0
  const start = new Date(year, month, 1 - offset);
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

const PANEL_WIDTH = 280;
const PANEL_HEIGHT_ESTIMATE = 320;

export function DatePopoverInput({
  value,
  onChange,
  label,
  dirty,
  className,
}: {
  /** ISO `YYYY-MM-DD`, or "" for none — same contract `DateCell` always had. */
  value: string;
  onChange: (next: string) => void;
  label: string;
  dirty?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [coords, setCoords] = React.useState<{ top: number; left: number; openUp: boolean } | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const selected = parseIso(value);
  const today = new Date();
  const [viewYear, setViewYear] = React.useState(() => (selected ?? today).getFullYear());
  const [viewMonth, setViewMonth] = React.useState(() => (selected ?? today).getMonth());

  function openPopover() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const openUp =
        rect.bottom + PANEL_HEIGHT_ESTIMATE > window.innerHeight && rect.top > PANEL_HEIGHT_ESTIMATE;
      // Kept clear of the right edge on a narrow phone, same reasoning every
      // other floating panel in this product follows.
      const left = Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 8);
      setCoords({ top: openUp ? rect.top - 4 : rect.bottom + 4, left: Math.max(8, left), openUp });
    }
    const base = selected ?? today;
    setViewYear(base.getFullYear());
    setViewMonth(base.getMonth());
    setOpen(true);
  }

  function shiftMonth(delta: number) {
    setViewMonth((m) => {
      const next = m + delta;
      if (next < 0) {
        setViewYear((y) => y - 1);
        return 11;
      }
      if (next > 11) {
        setViewYear((y) => y + 1);
        return 0;
      }
      return next;
    });
  }

  function pick(d: Date) {
    onChange(toIso(d));
    setOpen(false);
  }

  /* -- CLOSE ON OUTSIDE CLICK, ESCAPE, OR SCROLL — DELIBERATELY on the last
        one. This is a controlled panel with a known position; scrolling the
        page invalidates that position, so closing rather than trying to
        re-track it is the same choice every portal-based dropdown in the
        ecosystem makes. Capture phase, so a scroll inside a NESTED scrolling
        ancestor (the table's own overflow-x, in particular) is caught too. -- */
  React.useEffect(() => {
    if (!open) return;
    function onDocPointer(e: MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    function onScroll() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const days = monthGrid(viewYear, viewMonth);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPopover())}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "min-h-11 w-full rounded-input border border-transparent bg-warning-tint/40 px-2 text-left font-sans text-body-sm tabular text-ink",
          "focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30",
          dirty && "border-primary bg-primary/10",
          !value && "text-ink-muted",
          className,
        )}
      >
        {value ? formatDate(value) : "dd-mm-yyyy"}
      </button>

      {open && coords
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label={`Choose a date — ${label}`}
              style={{
                position: "fixed",
                top: coords.top,
                left: coords.left,
                transform: coords.openUp ? "translateY(-100%)" : undefined,
                width: PANEL_WIDTH,
              }}
              className="z-50 rounded-card border border-rule bg-surface p-3 shadow-lg"
            >
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => shiftMonth(-1)}
                  aria-label="Previous month"
                  className="grid size-8 place-items-center rounded-control text-ink-muted hover:bg-surface-mute hover:text-ink"
                >
                  <ChevronLeft aria-hidden className="size-4" />
                </button>
                <p className="font-sans text-body-sm font-medium text-ink">
                  {MONTH_NAMES[viewMonth]} {viewYear}
                </p>
                <button
                  type="button"
                  onClick={() => shiftMonth(1)}
                  aria-label="Next month"
                  className="grid size-8 place-items-center rounded-control text-ink-muted hover:bg-surface-mute hover:text-ink"
                >
                  <ChevronRight aria-hidden className="size-4" />
                </button>
              </div>

              <div className="mt-2 grid grid-cols-7 gap-0.5">
                {WEEKDAYS.map((w) => (
                  <span key={w} className="py-1 text-center text-body-xs font-medium text-ink-muted">
                    {w}
                  </span>
                ))}
                {days.map((d) => {
                  const inMonth = d.getMonth() === viewMonth;
                  const isSelected = selected !== null && sameDay(d, selected);
                  const isToday = sameDay(d, today);
                  return (
                    <button
                      key={toIso(d)}
                      type="button"
                      onClick={() => pick(d)}
                      aria-current={isToday ? "date" : undefined}
                      className={cn(
                        "min-h-8 rounded-control py-1 text-center text-body-sm tabular",
                        !inMonth && "text-ink-faint",
                        inMonth && !isSelected && "text-ink hover:bg-surface-mute",
                        isSelected && "bg-primary font-semibold text-white",
                        isToday && !isSelected && "font-semibold text-primary",
                      )}
                    >
                      {d.getDate()}
                    </button>
                  );
                })}
              </div>

              <div className="mt-2 flex items-center justify-between border-t border-rule pt-2">
                <button
                  type="button"
                  onClick={() => {
                    onChange("");
                    setOpen(false);
                  }}
                  className="min-h-8 px-1 text-body-sm text-primary"
                >
                  Clear
                </button>
                <button type="button" onClick={() => pick(today)} className="min-h-8 px-1 text-body-sm text-primary">
                  Today
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
