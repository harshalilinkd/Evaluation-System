/** How each HOD rated their team — the dashboard's roster panel. */

import { cn } from "@/lib/utils";
import type { LeadVariance } from "@/lib/analytics/queries";

/**
 * One row per HOD: how many reports they scored, and how their ratings sat
 * against those people's own.
 *
 * NOT A LEAGUE TABLE, and the wording works to prevent it being read as one.
 * §11 makes the gap "a reporting figure only" and P16-5 is explicit that a lead
 * at +2 is not "good" — they are rating higher than their team rates itself,
 * which is a conversation, not a score. So there is no ranking column, no
 * best-to-worst sort by default, and no green/red on the delta.
 *
 * TWO NUMBERS, BECAUSE ONE HIDES THE INTERESTING CASE (P16-5). A lead who is
 * +2 on half their team and −2 on the other half averages zero and is
 * INCONSISTENT, not neutral. The signed mean says which way they lean; the
 * absolute mean says how far they are from their team in either direction. The
 * count travels too, because +2.0 across three people is noise.
 */
export function LeadPerformanceTable({ rows }: { rows: LeadVariance[] }) {
  if (rows.length === 0) {
    return (
      <p className="font-sans text-body-sm text-ink-muted">
        No Manager has rated anybody in this cycle yet.
      </p>
    );
  }

  /* -- Sorted by how far from their team they sit, largest first — the rows
        worth a conversation at the top. Absolute, so a lead rating two points
        BELOW their team surfaces exactly as readily as one rating two above;
        a signed sort would bury half of them (P20-8). -- */
  const ordered = [...rows].sort(
    (a, b) => Math.abs(Number(b.mean_abs_delta ?? 0)) - Math.abs(Number(a.mean_abs_delta ?? 0)),
  );

  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse">
        <caption className="sr-only">
          Each head of department, the number of reports they have rated, and how their ratings
          compare with those reports&rsquo; own.
        </caption>
        <thead>
          <tr className="border-b border-rule">
            <Th className="text-left">Head of department</Th>
            <Th className="text-right">Rated</Th>
            <Th className="text-right">Leans</Th>
            <Th className="text-right">Distance</Th>
            <Th className="w-[26%] text-left">Where they sit</Th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((row) => {
            const signed = row.mean_delta === null ? null : Number(row.mean_delta);
            const distance = row.mean_abs_delta === null ? null : Number(row.mean_abs_delta);

            return (
              <tr key={row.lead_id ?? row.lead_name} className="border-b border-rule/60 last:border-0">
                <td className="px-2 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 font-sans text-body-sm font-medium text-primary"
                      aria-hidden
                    >
                      {initials(row.lead_name)}
                    </span>
                    <span className="truncate font-sans text-body text-ink">{row.lead_name}</span>
                  </div>
                </td>
                <td className="tabular px-2 py-2.5 text-right font-sans text-body text-ink">
                  {row.reports_scored}
                </td>
                <td className="tabular px-2 py-2.5 text-right font-sans text-body text-ink">
                  {signedScore(signed)}
                </td>
                <td className="tabular px-2 py-2.5 text-right font-sans text-body text-ink">
                  {distance === null ? "—" : distance.toFixed(2)}
                </td>
                <td className="px-2 py-2.5">
                  <DeltaTrack value={signed} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="mt-3 px-2 font-sans text-body-sm text-ink-muted">
        <span className="font-medium text-ink">Leans</span> is the average of lead minus self —
        positive means the Manager rated above the person&rsquo;s own view.{" "}
        <span className="font-medium text-ink">Distance</span> ignores direction, so a Manager who is
        far from their team both ways still shows as far. Neither is a verdict.
      </p>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th scope="col" className={cn("px-2 pb-2 type-label font-bold text-ink", className)}>
      {children}
    </th>
  );
}

/**
 * A diverging track with the zero line in the middle.
 *
 * The poles are the two TIER hues, and legitimately so: this bar IS the
 * distance between the lead layer and the self layer, so pink to the right
 * means "the lead said more" and cyan to the left means "the employee said
 * more" — the hue carries exactly the meaning §13.1 assigns it. P30 validated
 * the pair (ΔE 8.9 deuteranopic, 31.2 normal), and direction plus the printed
 * number mean colour is never the only encoding.
 */
function DeltaTrack({ value }: { value: number | null }) {
  if (value === null) return <span className="font-sans text-body-sm text-ink-muted">—</span>;

  // ±2 is §11's flag threshold, so it is the end of the track rather than an
  // arbitrary maximum — a bar that reaches the end means "this is the level the
  // product already calls notable".
  const capped = Math.max(-2, Math.min(2, value));
  const width = (Math.abs(capped) / 2) * 50;

  return (
    <div className="relative h-2 w-full rounded-full bg-surface-mute" role="img" aria-label={`${signedScore(value)} against their team`}>
      <span className="absolute inset-y-[-2px] left-1/2 w-px -translate-x-1/2 bg-rule" aria-hidden />
      <span
        className={cn(
          "absolute inset-y-0 rounded-full",
          capped >= 0 ? "left-1/2 bg-lead" : "right-1/2 bg-self",
        )}
        style={{ width: `${width}%` }}
        aria-hidden
      />
    </div>
  );
}

function signedScore(v: number | null): string {
  if (v === null) return "—";
  if (v === 0) return "0.00";
  return `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
