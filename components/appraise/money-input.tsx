"use client";

/** A salary field. Reads and writes MONTHLY; the value it carries is ANNUAL. */

import * as React from "react";

import { Input } from "@/components/ui/input";
import { annualFromMonthly, monthlyFromAnnual } from "@/lib/increment/calc";
import { formatInr } from "@/lib/utils/date";
import { cn } from "@/lib/utils";

/**
 * THE ONE PLACE A TYPED SALARY CROSSES THE UNIT BOUNDARY.
 *
 * Every salary is stored annual and, at the owner's instruction, typed and read
 * monthly. Doing that conversion at each call site would be a dozen chances to
 * multiply twice, or not at all — and a salary that is out by a factor of
 * twelve is precise, plausible and wrong, with nothing on the screen to flag it
 * (the 733% incident, from the other direction).
 *
 * So the component takes and returns ANNUAL. Every caller keeps passing the
 * figure it already had and storing the figure it already stored; none of them
 * knows a conversion happened. The unit lives here and nowhere else.
 *
 * THE MONTHLY FIGURE IS THE SOURCE OF TRUTH WHILE TYPING, and that matters.
 * Re-deriving the displayed value from the annual one on every keystroke would
 * mean ₹8,333 → ₹99,996 → ₹8,333 and a field that fights the person filling it,
 * because annual → monthly → annual does not round-trip. What they typed stays
 * exactly as typed until they leave the field.
 */
export function MoneyInput({
  id,
  /** The stored ANNUAL figure, or null. */
  value,
  /** Receives the ANNUAL figure to store, or null when the field is cleared. */
  onValueChange,
  disabled,
  required,
  placeholder,
  className,
  "aria-describedby": describedBy,
}: {
  id?: string;
  value: number | null;
  onValueChange: (annual: number | null) => void;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  className?: string;
  "aria-describedby"?: string;
}) {
  /* -- What is in the box. Seeded from the stored figure and then owned by the
        keystrokes, so the field never rewrites itself under somebody's cursor.
        Keyed on the incoming value so a form that loads a different record
        re-seeds, which is the remount idiom P10-11 settled on rather than an
        effect that syncs props into state. -- */
  const [text, setText] = React.useState(() => {
    const monthly = monthlyFromAnnual(value);
    return monthly === null ? "" : String(monthly);
  });

  // ₹ and commas are fine — people paste from a payslip. Refusing what somebody
  // reasonably types is a validation message where none was needed.
  const parse = (raw: string): number | null => {
    const cleaned = raw.replace(/[₹,\s]/g, "");
    if (cleaned === "") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const monthly = parse(text);

  return (
    <div className="space-y-1">
      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-sans text-body text-ink-muted"
        >
          ₹
        </span>
        <Input
          id={id}
          inputMode="numeric"
          disabled={disabled}
          required={required}
          placeholder={placeholder ?? "50,000"}
          aria-describedby={describedBy}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onValueChange(annualFromMonthly(parse(e.target.value)));
          }}
          className={cn("min-h-11 tabular pl-7", className)}
        />
      </div>

      {/* -- The annual figure, stated. It is what the letter says and what the
            database holds, so leaving it implicit would make two documents look
            like they disagree. It is a readout, never an input: one number, one
            place to type it. -- */}
      <p className="font-sans text-body-sm text-ink-muted">
        {monthly === null
          ? "A monthly figure."
          : `${formatInr(monthly)} a month · ${formatInr(annualFromMonthly(monthly))} a year`}
      </p>
    </div>
  );
}

/**
 * A salary READOUT, monthly with the annual beside it.
 *
 * Paired with the input deliberately: a figure that is typed in one unit and
 * displayed in another is the whole bug this change exists to remove.
 */
export function moneyMonthly(annual: number | null): string {
  const monthly = monthlyFromAnnual(annual);
  if (monthly === null) return "—";
  return `${formatInr(monthly)} a month`;
}
