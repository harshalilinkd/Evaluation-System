/** Is somebody's next increment due? One rule, for every screen that asks. */

/** `2026-08` — the key the increment calendar's own counts are bucketed by. */
export function incrementMonthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Is their next increment due now, this month, or next month?
 *
 * Anything in the PAST counts too — somebody whose increment was due last month
 * and has not had it is the most important person on the list, and a filter
 * that only looked forward would hide exactly them.
 *
 * CALENDAR MONTHS, not a rolling window. This was `days <= 31` in the staff
 * wizard while `getIncrementCalendar` bucketed by
 * `startsWith(thisMonth) || startsWith(nextMonth)` — so on the 14th of a month
 * the button counted all of next month and the roster ticked only its first
 * fortnight. "Start an increment round (8)" then selected 3, and the people it
 * missed were invisible, because the same predicate also filters the list.
 *
 * SHARED, and deliberately so. §7 forbids refactoring a staff evaluation
 * function to serve the worker module, and this is not one: `employment_records`
 * is track-agnostic (FIX-49) and both teams' rounds are started from the same
 * calendar. What §7 is protecting against is one module's rules quietly
 * governing the other — the opposite risk applies here, where two copies of one
 * date rule is what produced the bug above.
 */
export function isIncrementDue(nextOn: string | null, today = new Date()): boolean {
  if (!nextOn) return false;
  const due = new Date(`${nextOn}T00:00:00`);
  if (Number.isNaN(due.getTime())) return false;

  // Midnight, so an increment due TODAY is due rather than a few hours overdue.
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (due.getTime() < startOfToday.getTime()) return true;

  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const key = incrementMonthKey(due);
  return key === incrementMonthKey(today) || key === incrementMonthKey(nextMonth);
}
