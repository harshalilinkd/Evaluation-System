/** Reminder scheduling rules. Pure — the cron route decides, this decides how. */

/**
 * QUIET HOURS ARE A CLOCK WINDOW, NOT A COOLDOWN.
 *
 * P11-WIRE had a 20-hour "do not chase twice" period, which is a different
 * thing and is kept — it makes the job safe to retry. This is P17's rule:
 * nothing sends between 21:00 and 08:00 Asia/Kolkata, whatever else is true.
 *
 * §0.10 fixes the timezone for the whole product, so this is computed in
 * Asia/Kolkata rather than the server's zone. A Vercel function runs in UTC; a
 * naive `getHours()` would put quiet hours five and a half hours out and send
 * at 02:30 local.
 */
export const QUIET_START_HOUR = 21;
export const QUIET_END_HOUR = 8;

/** The hour in Asia/Kolkata, whatever the server's own zone is. */
export function hourInKolkata(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0");
}

/** The calendar day in Asia/Kolkata, for "one message per person per day". */
export function dayInKolkata(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isQuietHour(now: Date): boolean {
  const hour = hourInKolkata(now);
  // The window crosses midnight, so it is a union rather than a range.
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

/* ---------- Which reminder, if any ---------- */

export type ReminderKind = "ahead" | "due_today" | "overdue" | null;

/** Overdue nudges stop after this many consecutive days (P17). */
export const OVERDUE_STOP_AFTER_DAYS = 7;

/** A reminder this many days before a deadline. */
export const AHEAD_DAYS = 3;

/**
 * What to send about one record today, or nothing.
 *
 * Returning null is the common case and the important one: a system that finds
 * a reason to message every day is a system people mute, and a muted channel is
 * worse than no channel — it fails silently on the one message that mattered.
 */
export function reminderFor(daysUntilDue: number): ReminderKind {
  if (daysUntilDue === AHEAD_DAYS) return "ahead";
  if (daysUntilDue === 0) return "due_today";
  if (daysUntilDue < 0) {
    // Day 1 through 7 past the deadline. After that the system stops asking and
    // it becomes a conversation for a human to have.
    return Math.abs(daysUntilDue) <= OVERDUE_STOP_AFTER_DAYS ? "overdue" : null;
  }
  return null;
}

/** Whole days from `from` to `to`, both ISO dates. Negative when `to` has passed. */
export function daysUntil(fromIso: string, toIso: string): number {
  return Math.round(
    (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000,
  );
}

/* ---------- Timing-safe secret comparison ---------- */

/**
 * P17: "comparing a bearer header against CRON_SECRET with a timing-safe
 * comparison."
 *
 * `a !== b` short-circuits on the first differing byte, so the time it takes to
 * fail leaks how much of the prefix was right. An attacker who can measure that
 * recovers the secret one character at a time. This compares every byte
 * regardless, and length is folded in rather than checked first — an early
 * return on length would leak the length.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);

  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }

  return diff === 0;
}
