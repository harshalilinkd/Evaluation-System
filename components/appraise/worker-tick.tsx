/** One production rating, read back — the same on every screen that shows it. */

import { cn } from "@/lib/utils";

/* §17 keeps the source form's wording; these are the three cells it prints. */
export const TICK_WORD: Record<string, string> = {
  EXCELLENT: "Excellent",
  SATISFACTORY: "Satisfactory",
  NEEDS_IMPROVEMENT: "Needs improvement",
};

/*
 * AN ORDINAL RAMP IN INK, plus one status accent.
 *
 * Moved here from HR's review screen, where it was written, so the supervisor
 * reading the same eight ratings sees them the same way. They were eight tall
 * cards on the supervisor's screen, each redrawing the whole three-cell scale in
 * read-only mode, before the part the supervisor actually fills in — about two
 * screenfuls of a phone to read eight words. A second copy of this map would be
 * how the two screens drift into two colours for "Needs improvement".
 *
 * Excellent is the strongest weight, Satisfactory the quiet middle, and Needs
 * improvement takes `critical` because it IS the attention case and the only
 * one anybody acts on. No tier hue: §13.1 reserves those for whose layer a
 * figure is, and this is a rating, not a layer. §13.8 — the word is the signal;
 * the treatment only makes it findable. §6.2 — no numeral, ever: the 5/3/1
 * analytics mapping stays off a worker's sheet.
 */
const TICK_STYLE: Record<string, string> = {
  EXCELLENT: "bg-surface-mute font-medium text-ink",
  SATISFACTORY: "bg-surface-mute text-ink-muted",
  NEEDS_IMPROVEMENT: "bg-critical-tint font-medium text-critical",
};

export function Tick({ value }: { value: string | null }) {
  if (!value) return <span className="font-sans text-body-sm text-ink-faint">Not answered</span>;
  return (
    <span
      className={cn(
        "inline-flex rounded-pill px-2.5 py-1 font-sans text-body-sm",
        TICK_STYLE[value] ?? "bg-surface-mute text-ink",
      )}
    >
      {TICK_WORD[value] ?? value}
    </span>
  );
}

/**
 * The eight ratings as a two-column table: the quality, and what was ticked.
 *
 * The overall row is set apart, because §11 makes it the worker's score on this
 * track — never a mean of the others — and it is the one a reader looks for.
 */
export function TickTable({
  rows,
  heading,
}: {
  rows: ReadonlyArray<{ questionId: string; text: string; isOverall: boolean; tick: string | null }>;
  heading: string;
}) {
  return (
    <div className="card-surface overflow-x-auto">
      <table className="w-full min-w-[20rem]">
        <thead>
          <tr className="border-b border-rule">
            <th scope="col" className="type-label px-4 py-3 text-left text-ink-muted sm:px-5">
              Quality
            </th>
            <th scope="col" className="type-label px-4 py-3 text-right text-ink-muted sm:px-5">
              {heading}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.questionId}
              className={cn(
                "border-b border-rule last:border-b-0",
                row.isOverall && "bg-surface-mute/60",
              )}
            >
              <td
                className={cn(
                  "px-4 py-3 font-sans text-body-sm text-ink sm:px-5",
                  row.isOverall && "font-medium",
                )}
              >
                {row.text}
              </td>
              <td className="px-4 py-3 text-right sm:px-5">
                <Tick value={row.tick} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
