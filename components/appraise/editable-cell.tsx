"use client";

/** Cells that can be typed into, for a grid in edit mode. */

import * as React from "react";

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
