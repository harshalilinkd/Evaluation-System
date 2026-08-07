"use client";

/** The spreadsheet grid. One implementation, shared by every table-first screen. */

import { useEffect, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnSizingState,
  type RowData,
} from "@tanstack/react-table";

import { cn } from "@/lib/utils";

/**
 * Alignment and freezing travel on the column definition rather than in a map
 * beside it, so a column carries everything about itself in one place. This is
 * the augmentation that keeps `meta` typed.
 */
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: "center" | "right";
    /** Frozen from `lg` up. Only leading columns can freeze. */
    frozen?: boolean;
  }
}

const ALIGN_CLASS = { center: "text-center", right: "text-right" } as const;

/** A column can be dragged no narrower than this. Below it a header is unreadable. */
const MIN_COLUMN_WIDTH = 64;

/** Arrow keys nudge; shift-arrow jumps. The keyboard path for the drag handle. */
const KEY_STEP = 8;
const KEY_STEP_LARGE = 40;

/** The row-number gutter. Fixed, and never resizable — frozen offsets are measured from it. */
const GUTTER_ID = "__row__";
const GUTTER_WIDTH = 44;

/* Widths are a personal preference, not data — they belong to the browser, not
   the database. localStorage is unavailable in some privacy modes and can hold
   stale JSON from an older column set; neither is worth a broken screen. */
function readStoredWidths(key: string): ColumnSizingState | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as ColumnSizingState) : null;
  } catch {
    return null;
  }
}

function writeStoredWidths(key: string, sizing: ColumnSizingState): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(sizing));
  } catch {
    return;
  }
}

export type DataGridProps<TData> = {
  data: TData[];
  columns: ColumnDef<TData>[];
  /** Where remembered column widths live. Unique per screen. */
  storageKey: string;
  /** Below this the grid scrolls horizontally rather than crushing its columns. */
  minWidth?: number;
  /** Rendered in place of the table when there is nothing to show. */
  empty?: React.ReactNode;
  /** The left half of the status bar. The reset-widths button owns the right. */
  status?: React.ReactNode;
  /**
   * Opening a row.
   *
   * AN ENHANCEMENT, NEVER THE ONLY WAY IN. A clickable `<tr>` cannot be reached
   * by keyboard or announced by a screen reader, so every grid that uses this
   * must also carry the same action somewhere focusable — in practice the row's
   * own ⋯ menu. Making the row the sole route would put the screen's main
   * action out of reach of anybody not using a mouse (§13.8).
   */
  onRowClick?: (row: TData) => void;
};

/**
 * A grid that reads as a spreadsheet: one line per cell, a fixed width per
 * column on every row, gridlines both ways, a frozen header and frozen leading
 * columns, drag-to-resize, and a status bar.
 *
 * It exists as one component because the alternative is two: the question bank
 * had this chrome inline, and the moment a second screen wanted the same look
 * the two copies would start drifting — and the drift would show up as "why
 * does this table behave differently from that one", which is the hardest kind
 * of bug to justify fixing later.
 *
 * The caller supplies data and columns. Everything else — the row gutter, the
 * resize handles, the width memory, the filler column — belongs to the grid.
 */
export function DataGrid<TData>({
  data,
  columns,
  storageKey,
  minWidth = 1100,
  empty,
  status,
  onRowClick,
}: DataGridProps<TData>) {
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});

  // Read after mount rather than during render: the server has no localStorage,
  // so seeding state from it directly would render one width on the server and
  // another on the first client pass, and React would tear.
  useEffect(() => {
    const stored = readStoredWidths(storageKey);
    if (stored) setColumnSizing(stored);
  }, [storageKey]);

  useEffect(() => {
    // The empty first render must not wipe a stored preference before the load
    // effect above has had a chance to apply it.
    if (Object.keys(columnSizing).length === 0) return;
    writeStoredWidths(storageKey, columnSizing);
  }, [storageKey, columnSizing]);

  /** The keyboard equivalent of dragging the handle (§13.8). */
  const resizeBy = (columnId: string, currentWidth: number, delta: number) => {
    setColumnSizing((old) => ({
      ...old,
      [columnId]: Math.max(MIN_COLUMN_WIDTH, currentWidth + delta),
    }));
  };

  const gutter: ColumnDef<TData> = {
    id: GUTTER_ID,
    // A spreadsheet's row gutter: it gives every row a stable handle to refer to
    // out loud, and it is what makes a long list feel countable. Not resizable —
    // the frozen columns are offset from its width.
    header: "#",
    size: GUTTER_WIDTH,
    enableResizing: false,
    meta: { align: "right", frozen: true },
    cell: ({ row }) => (
      <span className="tabular text-body-sm text-ink-muted">{row.index + 1}</span>
    ),
  };

  const table = useReactTable({
    data,
    columns: [gutter, ...columns],
    state: { columnSizing },
    onColumnSizingChange: setColumnSizing,
    // `onChange` tracks the pointer live, which is what makes a drag feel like a
    // spreadsheet rather than a form submission.
    columnResizeMode: "onChange",
    enableColumnResizing: true,
    defaultColumn: { minSize: MIN_COLUMN_WIDTH },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const resizingColumnId = table.getState().columnSizingInfo.isResizingColumn;
  const leaf = table.getAllLeafColumns();

  /* The left offset of each frozen column: the running total of the widths
     before it. Only leading columns freeze — the first non-frozen column ends
     the run, because a frozen column with a scrolling one to its left would
     slide over its own neighbour. */
  const frozenLeft = new Map<string, number>();
  let runningLeft = 0;
  for (const column of leaf) {
    if (!column.columnDef.meta?.frozen) break;
    frozenLeft.set(column.id, runningLeft);
    runningLeft += column.getSize();
  }

  const hasRows = table.getRowModel().rows.length > 0;

  return (
    <>
      <div className="min-h-0 flex-1 overflow-auto bg-surface">
        {!hasRows && empty ? (
          <div className="p-6">{empty}</div>
        ) : (
          <table
            // Exactly as wide as its columns; `min-w-full` only ever stretches
            // the trailing filler. Were the sized columns allowed to absorb the
            // slack, their rendered width would stop matching getSize() and the
            // frozen offsets above would drift with it.
            style={{ width: table.getTotalSize(), minWidth }}
            className={cn(
              "min-w-full table-fixed border-separate border-spacing-0",
              // A drag that selects the header text underneath it looks broken.
              resizingColumnId && "select-none",
            )}
          >
            <colgroup>
              {leaf.map((column) => (
                <col key={column.id} style={{ width: column.getSize() }} />
              ))}
              <col />
            </colgroup>

            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    // No `meta` here on purpose: alignment is a property of the
                    // VALUES, and the heading no longer follows it.
                    const left = frozenLeft.get(header.column.id);
                    return (
                      <th
                        key={header.id}
                        scope="col"
                        // border-separate, not border-collapse: a collapsed
                        // border belongs to the table rather than the cell, so
                        // it does not travel with a sticky header or a frozen
                        // column — the grid loses its lines exactly when it is
                        // scrolled, which is when they matter most.
                        style={left === undefined ? undefined : { "--frozen-left": `${left}px` } as React.CSSProperties}
                        className={cn(
                          // EVERY HEADING IS LEFT-ALIGNED, whatever its column
                          // holds.
                          //
                          // The convention of mirroring the data — right over
                          // numbers, centre over flags — is defensible, but it
                          // gives a header row with three different edges, and
                          // at fourteen columns that reads as misalignment
                          // rather than as meaning. A single left edge lets the
                          // eye run along the row and find a column by its
                          // name; the values still align by type underneath.
                          "sticky top-0 z-20 h-9 border-b border-r border-rule bg-surface-mute px-3 text-left align-middle",
                          left !== undefined && "grid-frozen z-30",
                        )}
                      >
                        {/* font-bold, not semibold: a header row that reads as
                            a header at a glance is what tells a wide grid where
                            its columns are. `text-ink` is #111827 — the
                            darkest text token there is. */}
                        <span className="type-label block truncate font-bold text-ink">
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                        </span>

                        {header.column.getCanResize() ? (
                          <button
                            type="button"
                            aria-label={`Resize the ${String(header.column.columnDef.header)} column`}
                            onMouseDown={header.getResizeHandler()}
                            onTouchStart={header.getResizeHandler()}
                            // Double-click resets, as it does in a spreadsheet.
                            onDoubleClick={() => header.column.resetSize()}
                            onKeyDown={(event) => {
                              const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
                              if (event.key === "ArrowLeft") {
                                event.preventDefault();
                                resizeBy(header.column.id, header.getSize(), -step);
                              } else if (event.key === "ArrowRight") {
                                event.preventDefault();
                                resizeBy(header.column.id, header.getSize(), step);
                              } else if (event.key === "Home") {
                                event.preventDefault();
                                header.column.resetSize();
                              }
                            }}
                            className={cn(
                              "absolute inset-y-0 right-0 w-2 cursor-col-resize touch-none",
                              // The grab target is 8px; the line it paints is
                              // 2px. A handle you can hit is not the same thing
                              // as a handle you can see.
                              "after:absolute after:inset-y-0 after:right-0 after:w-0.5 after:bg-transparent",
                              "hover:after:bg-accent-primary focus-visible:after:bg-accent-primary",
                              resizingColumnId === header.column.id && "after:bg-accent-primary",
                            )}
                          />
                        ) : null}
                      </th>
                    );
                  })}
                  {/* The filler takes every spare pixel so the sized columns
                      never have to, and carries the header ground to the edge. */}
                  <th aria-hidden className="sticky top-0 z-20 border-b border-rule bg-surface-mute" />
                </tr>
              ))}
            </thead>

            <tbody>
              {table.getRowModel().rows.map((row) => (
                // §4: 44px rows, compact density on an admin table.
                <tr
                  key={row.id}
                  className={cn("group h-11", onRowClick && "cursor-pointer")}
                  onClick={
                    onRowClick
                      ? (event) => {
                          // A click that landed on a control inside the row
                          // belongs to that control. Without this, opening the
                          // ⋯ menu would also open the row behind it.
                          if (
                            (event.target as HTMLElement).closest(
                              "button, a, input, select, textarea, [role='menuitem']",
                            )
                          ) {
                            return;
                          }
                          onRowClick(row.original);
                        }
                      : undefined
                  }
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta;
                    const left = frozenLeft.get(cell.column.id);
                    return (
                      <td
                        key={cell.id}
                        style={left === undefined ? undefined : { "--frozen-left": `${left}px` } as React.CSSProperties}
                        className={cn(
                          "h-11 border-b border-r border-rule bg-surface px-3 align-middle",
                          // Frozen cells carry their own ground, so the row
                          // highlight has to be driven from the row itself.
                          "group-hover:bg-surface-mute",
                          // Same ternary as the header above, and deliberately
                          // the same expression: a column's values and its
                          // heading are aligned by one rule, so they cannot end
                          // up disagreeing about which edge they sit against.
                          meta?.align ? ALIGN_CLASS[meta.align] : "text-left",
                          left !== undefined && "grid-frozen z-10",
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                  <td aria-hidden className="border-b border-rule bg-surface group-hover:bg-surface-mute" />
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* A spreadsheet's status bar. */}
      <div className="flex shrink-0 items-center gap-3 border-t border-rule bg-surface-mute px-3 py-1.5">
        {status}

        {/* §13.4: dragging a column to 64px must not be a one-way door. */}
        {Object.keys(columnSizing).length > 0 ? (
          <button
            type="button"
            className="ml-auto rounded-control px-2 py-1 text-body-sm text-ink-faint hover:text-ink"
            onClick={() => {
              setColumnSizing({});
              writeStoredWidths(storageKey, {});
            }}
          >
            Reset column widths
          </button>
        ) : null}
      </div>
    </>
  );
}

/** Every data cell is one truncated line, with the full value on hover. */
export function GridCell({ value, className }: { value: string; className?: string }) {
  return (
    <span title={value} className={cn("block truncate text-body-sm text-ink", className)}>
      {value}
    </span>
  );
}
