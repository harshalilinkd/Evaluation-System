/** How a round is named on screen: its name, and its period only if that adds anything. */

/**
 * "Appraisal · September 2026", not "Appraisal · September 2026 · September 2026".
 *
 * A round carries a `name` and a `period_label`, and the name that both wizards
 * generate ALREADY CONTAINS the period — `Appraisal · September 2026` beside
 * `September 2026`. Every screen that printed the two joined therefore said the
 * month twice, which reads as a bug in the data rather than a bug in the label.
 *
 * The two fields are not redundant in general: HR can rename a round to
 * anything, and then the period is the only thing that dates it. So this drops
 * the period only when the name already contains it, rather than dropping the
 * field outright.
 *
 * Case- and space-insensitive, because "September 2026" and "september  2026"
 * are the same month to a reader and the comparison should agree with them.
 */
export function roundLabel(name: string | null | undefined, period: string | null | undefined): string {
  const cleanName = (name ?? "").trim();
  const cleanPeriod = (period ?? "").trim();

  if (!cleanName) return cleanPeriod;
  if (!cleanPeriod) return cleanName;

  const flatten = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
  if (flatten(cleanName).includes(flatten(cleanPeriod))) return cleanName;

  return `${cleanName} · ${cleanPeriod}`;
}
