/** Date and number formatting. CLAUDE.md §0.10 — Indian conventions throughout. */

/** §0.10: Asia/Kolkata everywhere, not the viewer's local zone. */
export const APP_TIME_ZONE = "Asia/Kolkata";

/** §0.10: DD-MM-YYYY. Never the US order, never a locale guess. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}-${get("month")}-${get("year")}`;
}

/** HH:MM, 24-hour, Asia/Kolkata. Used by the autosave indicator. */
export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return `${formatDate(value)} ${formatTime(value)}`;
}

/**
 * §0.10: INR with the ₹ symbol and Indian digit grouping — 1,00,000, not
 * 100,000. `en-IN` produces the lakh/crore grouping natively.
 */
export function formatInr(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);
}

/** A score to two decimals (§11), or an em dash when there is nothing to show. */
export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}
