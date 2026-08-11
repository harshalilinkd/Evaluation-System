/**
 * Increment arithmetic (P21). Pure, and the ONLY place any of it is done.
 *
 * Every number in this file ends up in somebody's pay packet. Two rules follow:
 *
 *   - **No component computes a hike.** A percent worked out in a text input's
 *     onChange is a percent nobody can reproduce, and it will not match the one
 *     the database stored. Screens call these functions and display what comes
 *     back.
 *   - **Rounding happens once, here.** A figure rounded in the UI and again on
 *     the server is a figure that can disagree with itself by a rupee — which is
 *     small, wrong, and impossible to explain to the person it belongs to.
 */

/** Two decimals, the precision `numeric(6,2)` stores a percent at. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The hike, as a percentage of what they are on now.
 *
 * Returns null rather than Infinity when the current salary is zero or missing.
 * A screen can render "—" for null; it cannot render Infinity as anything a
 * person should read, and `numeric` will not store it.
 */
export function hikePct(currentCtc: number | null, newCtc: number | null): number | null {
  if (currentCtc === null || newCtc === null) return null;
  if (!Number.isFinite(currentCtc) || !Number.isFinite(newCtc)) return null;
  if (currentCtc <= 0) return null;
  return round2(((newCtc - currentCtc) / currentCtc) * 100);
}

/**
 * The new salary implied by a percentage.
 *
 * Rounded to the nearest rupee: a CTC is a figure that appears on a letter, and
 * paise on an annual salary is noise that makes the number look computed rather
 * than decided.
 */
export function newCtcFromPct(currentCtc: number | null, pct: number | null): number | null {
  if (currentCtc === null || pct === null) return null;
  if (!Number.isFinite(currentCtc) || !Number.isFinite(pct)) return null;
  if (currentCtc <= 0) return null;
  return Math.round(currentCtc * (1 + pct / 100));
}

/** The amount, in rupees. Kept here so no screen subtracts for itself. */
export function hikeAmount(currentCtc: number | null, newCtc: number | null): number | null {
  if (currentCtc === null || newCtc === null) return null;
  if (!Number.isFinite(currentCtc) || !Number.isFinite(newCtc)) return null;
  return Math.round(newCtc - currentCtc);
}

/**
 * Whole months between two dates.
 *
 * Whole, not fractional: an increment cycle is discussed in months, and "17.4
 * months since the last one" is a precision nobody asked for. The day of the
 * month counts — 1 April to 30 April is not yet a month.
 */
export function monthsSince(lastIncrementDate: string | null, asOf: Date): number | null {
  if (!lastIncrementDate) return null;
  const then = new Date(`${lastIncrementDate}T00:00:00`);
  if (Number.isNaN(then.getTime())) return null;

  let months =
    (asOf.getFullYear() - then.getFullYear()) * 12 + (asOf.getMonth() - then.getMonth());
  if (asOf.getDate() < then.getDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * The hike expressed as if the gap had been twelve months.
 *
 * CONTEXT ONLY, and the screen says so. A 15% rise after 18 months is a
 * different decision from 15% after 12, and this is what makes the two
 * comparable — but it is never the figure that gets approved, because the money
 * actually paid is the real percent, not the annualised one.
 */
export function annualisedPct(pct: number | null, months: number | null): number | null {
  if (pct === null || months === null) return null;
  if (!Number.isFinite(pct) || !Number.isFinite(months)) return null;
  if (months <= 0) return null;
  return round2((pct * 12) / months);
}

/** What the employee asked for, against what HR proposes. */
export function expectationGap(
  expectation: number | null,
  proposed: number | null,
): { amount: number | null; pct: number | null } {
  if (expectation === null || proposed === null) return { amount: null, pct: null };
  if (!Number.isFinite(expectation) || !Number.isFinite(proposed)) {
    return { amount: null, pct: null };
  }
  return {
    // Proposed minus expected: negative means HR is offering less than asked,
    // which is the common case and should read as a shortfall rather than
    // needing the sign flipped in the head.
    amount: Math.round(proposed - expectation),
    pct: expectation > 0 ? round2(((proposed - expectation) / expectation) * 100) : null,
  };
}

/**
 * THE TWO SIDES OF THE UNIT BOUNDARY.
 *
 * Every salary in this system is STORED annual and, at the owner's instruction,
 * READ AND TYPED monthly. These are the only two functions that cross that
 * line, and nothing else in the codebase may divide or multiply by twelve.
 *
 * Why storage stays annual is in 0061's header, and it is not a preference:
 * `salary_history_is_append_only()` refuses UPDATE and DELETE for every caller
 * including a migration, so the stored rows CANNOT be rescaled — the guard the
 * pay record's evidentiary value rests on would have to be dropped first.
 *
 * The pair must round in a way that survives a round trip. `annualFromMonthly`
 * multiplies exactly; `monthlyFromAnnual` rounds. So monthly → annual → monthly
 * returns the original for every whole-rupee monthly figure, which is what
 * somebody typing 50,000 and reopening the form has every right to expect.
 * Annual → monthly → annual does NOT, and must not be relied on: ₹100,000 a
 * year is ₹8,333 a month is ₹99,996 a year. That asymmetry is why an input
 * takes the monthly figure as the source of truth and never re-derives it.
 */

/** A monthly figure from an annual CTC, for display. */
export function monthlyFromAnnual(ctc: number | null): number | null {
  if (ctc === null || !Number.isFinite(ctc)) return null;
  return Math.round(ctc / 12);
}

/** The annual figure to STORE, from the monthly figure somebody typed. */
export function annualFromMonthly(monthly: number | null): number | null {
  if (monthly === null || !Number.isFinite(monthly)) return null;
  return Math.round(monthly * 12);
}

/**
 * The first of the month after this one — the default effective-from date.
 *
 * Payroll runs monthly, so an increment almost always takes effect at a month
 * boundary. Defaulting to it saves HR a date-picker interaction on every single
 * person, and it is only a default.
 */
export function firstOfNextMonth(asOf: Date): string {
  const year = asOf.getMonth() === 11 ? asOf.getFullYear() + 1 : asOf.getFullYear();
  const month = asOf.getMonth() === 11 ? 0 : asOf.getMonth() + 1;
  return `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

/** The median of a list of percentages, for the department context table. */
export function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? round2(sorted[middle]!)
    : round2((sorted[middle - 1]! + sorted[middle]!) / 2);
}
