"use client";

/** Cells that can be typed into, for a grid in edit mode. */

import * as React from "react";

import { DatePopoverInput } from "@/components/appraise/date-popover";
import { cn } from "@/lib/utils";

/**
 * WHY THESE ARE PLAIN INPUTS AND NOT THE SHADCN ONES
 *
 * A grid cell in edit mode has to look like a cell, not like a form field: a
 * bordered control with its own padding inside a table cell puts a box inside a
 * box and doubles the row height, which on a twelve-column roster is the
 * difference between seeing six people and seeing three. These carry the edit
 * affordance on the CELL — a tinted background and a focus ring — rather than on
 * a control drawn inside it.
 *
 * Everything else is unchanged: 44px minimum height (§13.8), a real `<label>`
 * through `aria-label`, and a visible focus ring.
 */

const base =
  "min-h-11 w-full rounded-input border border-transparent bg-warning-tint/40 px-2 font-sans text-body-sm text-ink " +
  "focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30";

export function TextCell({
  value,
  onChange,
  label,
  dirty,
  numeric,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  dirty: boolean;
  numeric?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      inputMode={numeric ? "numeric" : undefined}
      className={cn(base, numeric && "tabular text-right", dirty && "border-primary bg-primary/10")}
    />
  );
}

export function SelectCell({
  value,
  onChange,
  label,
  dirty,
  options,
  blankLabel = "—",
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  dirty: boolean;
  options: Array<{ value: string; label: string }>;
  blankLabel?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      // A select's intrinsic minimum is its longest option, so without this it
      // refuses to shrink and widens the whole grid (F13-4).
      className={cn(base, "min-w-0", dirty && "border-primary bg-primary/10")}
    >
      <option value="">{blankLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * A salary cell. MONTHLY in, annual out.
 *
 * 0061 made monthly the unit at the edges and annual the unit in the core, and
 * this is an edge: HR thinks in the figure the employee is quoted. The
 * conversion happens once, here, so no caller has to remember which unit a cell
 * is carrying — which is precisely the confusion FIX-20 was reported for.
 */
export function MoneyCell({
  annual,
  onChangeAnnual,
  label,
  dirty,
}: {
  annual: number | null;
  onChangeAnnual: (next: number | null) => void;
  label: string;
  dirty: boolean;
}) {
  /* -- The typed TEXT is the source of truth while editing, not a number
        derived back out of the annual value. Round-tripping through
        annual÷12 on every keystroke fights the person typing: "15" becomes
        180000 becomes "15000" under their cursor. -- */
  const [text, setText] = React.useState(() =>
    annual === null ? "" : String(Math.round(annual / 12)),
  );

  return (
    <span className="flex items-center gap-1">
      <span aria-hidden className="shrink-0 font-sans text-body-sm text-ink-muted">
        ₹
      </span>
      <input
        value={text}
        onChange={(e) => {
          const next = e.target.value.replace(/[^\d]/g, "");
          setText(next);
          onChangeAnnual(next === "" ? null : Number(next) * 12);
        }}
        aria-label={`${label}, a monthly figure`}
        inputMode="numeric"
        className={cn(base, "tabular text-right", dirty && "border-primary bg-primary/10")}
      />
    </span>
  );
}

/**
 * A date. ISO IN AND OUT, because that is what the column stores.
 *
 * NOT the browser's own picker any more (0093's follow-up). Reported from a
 * grid that scrolls with a sticky header and re-renders on every keystroke: a
 * native `<input type="date">` popup can dismiss itself on a page reflow that
 * has nothing to do with it, which is a real, well-known Chromium quirk and
 * exactly the conditions a data grid produces constantly. `DatePopoverInput`
 * (components/appraise/date-popover.tsx) owns its own calendar instead, so
 * there is nothing native left for an unrelated repaint to close by accident.
 * §0.10's DD-MM-YYYY is what it shows; ISO is still what it reads and writes,
 * so no caller here changed.
 */
export function DateCell({
  value,
  onChange,
  label,
  dirty,
}: {
  /** ISO `YYYY-MM-DD`, or "" for none. */
  value: string;
  onChange: (next: string) => void;
  label: string;
  dirty: boolean;
}) {
  return <DatePopoverInput value={value} onChange={onChange} label={label} dirty={dirty} />;
}

/**
 * A small whole number — how often a salary is reviewed, in months.
 *
 * BLANK IS NOT ZERO. `Number("")` is 0, and a review frequency of zero months
 * is not a thing anybody means; it is "not recorded". The empty string is
 * carried through as `null` so the caller can leave the column alone rather
 * than write a figure nobody typed (P19C-5's rule, applied to a count).
 */
export function NumberCell({
  value,
  onChange,
  label,
  dirty,
  min,
  max,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
  label: string;
  dirty: boolean;
  min?: number;
  max?: number;
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={value === null ? "" : String(value)}
      onChange={(e) => {
        const raw = e.target.value.trim();
        onChange(raw === "" ? null : Number(raw));
      }}
      aria-label={label}
      className={cn(base, "tabular text-right", dirty && "border-primary bg-primary/10")}
    />
  );
}
