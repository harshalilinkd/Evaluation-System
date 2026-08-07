"use client";

/** A chart and the same numbers as a table, one toggle between them. */

import * as React from "react";
import { BarChart3, Table2 } from "lucide-react";

import { cn } from "@/lib/utils";

/*
 * WHY EVERY CHART NEEDS THIS.
 *
 * The palette validator reports the series hues below 3:1 against a white
 * surface. That is not a colour to swap — it is an obligation: a chart whose
 * marks do not clear 3:1 must carry relief, and relief is either a visible
 * label on every mark or the numbers available as text. Direct labels cover the
 * bar charts; a donut cannot label every slice without becoming a mess, so it
 * needs the table.
 *
 * It is also the honest answer to a reader who cannot use the chart at all:
 * colour-blind, screen-reader, or simply wanting the exact figure rather than a
 * length. P16 asked for "view as table on every chart" and only the scorecard
 * trend ever got it.
 *
 * The toggle is a real control, not a hover affordance — §13.8, and there is no
 * hover on a phone.
 */

export type FigureColumn<T> = {
  header: string;
  /** Returned as text, so the table is readable by anything that reads text. */
  cell: (row: T) => string;
  align?: "right";
};

export function ChartFigure<T>({
  rows,
  columns,
  caption,
  children,
  className,
}: {
  rows: readonly T[];
  columns: ReadonlyArray<FigureColumn<T>>;
  /** Names what the table is, for anyone arriving in it without the chart. */
  caption: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [asTable, setAsTable] = React.useState(false);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex justify-end">
        <div
          role="group"
          aria-label={`${caption} — chart or table`}
          className="inline-flex items-center gap-0.5 rounded-control bg-surface-mute p-0.5"
        >
          {[
            { key: false, label: "Chart", Icon: BarChart3 },
            { key: true, label: "Table", Icon: Table2 },
          ].map(({ key, label, Icon }) => (
            <button
              key={label}
              type="button"
              onClick={() => setAsTable(key)}
              aria-pressed={asTable === key}
              className={cn(
                "flex min-h-8 items-center gap-1.5 rounded-[6px] px-2.5 text-body-sm transition-colors",
                asTable === key
                  ? "bg-surface text-ink shadow-sm"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              <Icon aria-hidden className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {asTable ? (
        <div className="max-h-[280px] overflow-auto rounded-control border border-rule">
          <table className="w-full border-collapse text-body-sm">
            <caption className="sr-only">{caption}</caption>
            <thead className="sticky top-0 bg-surface-mute">
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.header}
                    scope="col"
                    className={cn(
                      "border-b border-rule px-3 py-2 text-left font-medium text-ink",
                      c.align === "right" && "text-right",
                    )}
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td
                      key={c.header}
                      className={cn(
                        "border-b border-rule px-3 py-2 text-ink",
                        // §3: every number is tabular, so a column of them lines up.
                        c.align === "right" && "tabular text-right",
                      )}
                    >
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
