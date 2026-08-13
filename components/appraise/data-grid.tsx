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

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
    /**
     * What to call this column in an accessible name, when `header` is a render
     * function rather than a string. Optional — `columnLabel` derives a decent
     * one from the column id without it.
     */
    label?: string;
  }
}

/**
 * A readable name for a column, for the resize handle's accessible name.
 *
 * IT MUST NEVER STRINGIFY `header`, and that is the whole point of this
 * function. `header` is `string | ((ctx) => ReactNode)`, and for the tier
 * columns it is the second — so `String(header)` returned the FUNCTION SOURCE,
 * which under Turbopack carries mangled module paths that differ between the
 * server bundle and the client one. React compared the two and reported a
 * hydration mismatch on every grid with a rendered header, with an aria-label
 * reading `Resize the ()=>(0, __TURBOPACK__imported__module__$5b$proj… column`
 * — unusable to a screen reader, and a genuine mismatch rather than a warning
 * to suppress.
 *
 * The order is: an explicit `meta.label`, else the header when it is genuinely
 * a string, else the column id turned into words. Every existing caller is
 * covered by the last two, so none had to change.
 */
export function columnLabel(column: {
  id: string;
  columnDef: { header?: unknown; meta?: { label?: string } };
}): string {
  const explicit = column.columnDef.meta?.label;
  if (explicit) return explicit;

  const header = column.columnDef.header;
  if (typeof header === "string" && header.trim()) return header.trim();

  // `selfOverall` / `self_overall` → "Self overall". Not perfect prose, but it
  // is stable across builds, which is the property that was actually missing.
  return column.id
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
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
/* -- Wide enough for the HEADING, which is what sets it — not the values.
      Every heading is `type-label`: 12px, uppercase, 0.05em tracking, bold. At
      that treatment "EMPLOYEE ID" runs to about 97px, and the cell has 24px of
      horizontal padding — so 104px clipped it to "EMPLOYEE I…" and the column
      was, accurately, unreadable. The codes themselves need barely half this.
      Headings are `truncate`, so a label longer than a caller's column does not
      wrap or overflow: it silently disappears, which is why this is sized for
      the text rather than left to be noticed. -- */
const ROW_LABEL_WIDTH = 132;

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
  /**
   * What the details dialog calls a row. "person", "cycle", "report".
   *
   * Only ever used in the dialog's title and its accessible label, so a grid
   * that says nothing still works — it just says "Details".
   */
  rowNoun?: string;
  /**
   * A title for the open row, taken from the row itself.
   *
   * Defaults to the first column's value, which is the name column on every
   * grid in this product. Override when the first column is not the label —
   * a grid whose leading column is a date, say.
   */
  rowTitle?: (row: TData) => string;
  /**
   * Put a real identifier in the gutter instead of a row number.
   *
   * The gutter is not only decoration: it is the one focusable control per row
   * and therefore the keyboard path to opening one. So "remove the # column"
   * cannot be granted literally — what it means is "stop showing a counter
   * beside a column that already numbers these people". This replaces the
   * counter and keeps the control.
   */
  rowLabel?: {
    header: string;
    value: (row: TData) => string;
    /**
     * Render the gutter cell yourself — an editable field, in practice.
     *
     * The button is dropped when this is given, and that is safe for the reason
     * `onRowClick` is documented as an enhancement: the row's ⋯ menu carries
     * the same action and is the route a keyboard or screen-reader user takes
     * anyway. A grid with no such menu must not pass this.
     */
    cell?: (row: TData) => React.ReactNode;
  };
  /**
   * Actions for the open row, rendered in the dialog footer.
   *
   * The dialog SHOWS; it does not decide what can be done. A screen that wants
   * "Open scorecard" or "Send links" there passes it, and the grid stays
   * ignorant of what its rows mean.
   */
  rowActions?: (row: TData) => React.ReactNode;
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
  rowNoun,
  rowTitle,
  rowLabel,
  rowActions,
}: DataGridProps<TData>) {
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  /* -- The open row, by index rather than by value.
        An index survives the data being refetched under it; a captured object
        would go on showing a stale copy after a `router.refresh()`, which on a
        screen whose actions change the row is exactly wrong. -- */
  const [openRowIndex, setOpenRowIndex] = useState<number | null>(null);

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
    /* -- OR A REAL IDENTIFIER, where the list has one.
          A row number beside an employee code is two counters saying the same
          thing, and the code is the one people use out loud. `rowLabel` lets a
          caller put it here instead of adding a column and asking for the
          gutter to be removed — which could not simply be granted, because the
          gutter is also the KEYBOARD PATH to opening a row (see below) and
          every grid in the product depends on it. -- */
    header: rowLabel?.header ?? "#",
    size: rowLabel ? ROW_LABEL_WIDTH : GUTTER_WIDTH,
    enableResizing: false,
    meta: { align: "right", frozen: true },
    /* -- THE KEYBOARD PATH TO OPENING A ROW.
          A clickable `<tr>` cannot be focused, cannot be reached by Tab and is
          not announced — which is why `onRowClick` has always been documented
          as an enhancement and never the only way in. Now that EVERY row opens,
          that warning would apply to every grid in the product at once.

          So the row number is the control: one focusable button per row, in a
          column that already exists, with a real accessible name. It costs no
          width and adds no column. -- */
    cell: ({ row }) =>
      rowLabel?.cell ? (
        rowLabel.cell(row.original)
      ) : (
      <button
        type="button"
        onClick={() => {
          if (onRowClick) onRowClick(row.original);
          else setOpenRowIndex(row.index);
        }}
        aria-label={`Open ${rowTitle ? rowTitle(row.original) : `row ${row.index + 1}`}`}
        className={cn(
          "tabular w-full rounded-control text-body-sm text-ink-muted hover:text-ink",
          rowLabel ? "text-left" : "text-right",
        )}
      >
        {rowLabel ? rowLabel.value(row.original) : row.index + 1}
      </button>
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

  /* Resolved from the CURRENT row model, so a refetch behind an open dialog
     shows the new values rather than a snapshot taken when it was clicked.
     `?? null` because a row can disappear — a filter typed underneath, a
     deletion — and a dialog about a row that no longer exists should close
     rather than render a stale one. */
  const openRow =
    openRowIndex === null
      ? null
      : (table.getRowModel().rows.find((r) => r.index === openRowIndex) ?? null);

  return (
    <>
      <div className="min-h-0 flex-1 overflow-auto bg-surface">
        {!hasRows && empty ? (
          <div className="p-6">{empty}</div>
        ) : (
          <table
            /*
              WIDTH: at least its own columns, at least `minWidth`, and at least
              the full width of the container.

              Both halves are inline and neither is a class. This started as
              `minWidth` inline beside a `min-w-full` class — an inline
              min-width beats a class, so the class never applied and the table
              sat at exactly its column total, leaving everything to the right
              of the last column as bare page. Folding the pixel minimum into
              `width` should have freed the class to work, and it did not, so
              the guessing stops here: `min-width: 100%` is stated where nothing
              can override it, purge it, or lose to specificity.

              The sized columns still never absorb the slack — the trailing
              `<col />` in the colgroup above has no width, so under
              `table-layout: fixed` every spare pixel goes there. That is what
              keeps each column's rendered width equal to `getSize()`, which the
              frozen-pane offsets depend on.
            */
            style={{
              width: Math.max(table.getTotalSize(), minWidth),
              minWidth: "100%",
            }}
            className={cn(
              "table-fixed border-separate border-spacing-0",
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
                            aria-label={`Resize the ${columnLabel(header.column)} column`}
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
                /* -- EVERY ROW OPENS.
                      `onRowClick` when the screen supplies one — Settings ›
                      Users opens its edit dialog, the roster navigates to a
                      scorecard — and otherwise the built-in details dialog
                      below. A grid with neither used to be inert, and "why does
                      clicking work on that table and not this one" is the kind
                      of inconsistency nobody reports and everybody notices. -- */
                <tr
                  key={row.id}
                  className="group h-11 cursor-pointer"
                  onClick={(event) => {
                    // A click that landed on a control inside the row belongs
                    // to that control. Without this, opening the ⋯ menu or
                    // following a link would also open the row behind it.
                    if (
                      (event.target as HTMLElement).closest(
                        "button, a, input, select, textarea, [role='menuitem']",
                      )
                    ) {
                      return;
                    }
                    if (onRowClick) onRowClick(row.original);
                    else setOpenRowIndex(row.index);
                  }}
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

      {/* ---------- The row details dialog ----------

          BUILT FROM THE COLUMN DEFINITIONS, which is the whole reason this
          lives in the grid rather than being written once per screen. Every
          table already declares a header and a cell renderer for each field;
          a details view is those same two things stacked instead of laid out
          in a row. Adding a column to any grid adds it here for free, and the
          two can never disagree about what a row contains.

          A wide table is the case it exists for: at fourteen columns the tail
          is off-screen, and the row a person clicked is exactly the row whose
          hidden columns they want. */}
      <Dialog
        open={openRow !== null}
        onOpenChange={(next) => {
          if (!next) setOpenRowIndex(null);
        }}
      >
        <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto border-rule bg-surface">
          <DialogHeader>
            <DialogTitle className="font-sans text-display-sm text-ink">
              {openRow ? (rowTitle ? rowTitle(openRow.original) : firstCellText(openRow)) : ""}
            </DialogTitle>
            <DialogDescription className="font-sans text-body-sm text-ink-muted">
              {rowNoun ? `Everything on this ${rowNoun}.` : "Everything on this row."}
            </DialogDescription>
          </DialogHeader>

          {openRow ? (
            <dl className="divide-y divide-rule">
              {openRow
                .getVisibleCells()
                /* The gutter is the row number, and a column with no heading is
                   an actions column — neither is a FIELD, and listing them
                   would put a ⋯ menu in a list of values under a blank label. */
                .filter((cell) => cell.column.id !== GUTTER_ID && hasHeading(cell.column.columnDef))
                .map((cell) => (
                  <div
                    key={cell.id}
                    className="grid grid-cols-[9rem_1fr] items-baseline gap-3 py-2.5"
                  >
                    <dt className="type-label font-bold text-ink">
                      {/* Rendered from the real HEADER, not a synthesised
                          context: a function header (the tier-dot ones) needs
                          the header object `flexRender` expects, and the table
                          already has it. Matched by column id. */}
                      {(() => {
                        const header = table
                          .getFlatHeaders()
                          .find((h) => h.column.id === cell.column.id);
                        return header
                          ? flexRender(header.column.columnDef.header, header.getContext())
                          : cell.column.id;
                      })()}
                    </dt>
                    <dd className="min-w-0 font-sans text-body text-ink">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </dd>
                  </div>
                ))}
            </dl>
          ) : null}

          {openRow && rowActions ? (
            <DialogFooter className="gap-2">{rowActions(openRow.original)}</DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* A spreadsheet's status bar. */}
      <div className="flex shrink-0 items-center gap-3 border-t border-rule bg-surface-mute px-3 py-1.5">
        {status}

        {/* §13.4: dragging a column to 64px must not be a one-way door. */}
        {Object.keys(columnSizing).length > 0 ? (
          <button
            type="button"
            className="ml-auto rounded-control px-2 py-1 text-body-sm text-ink-muted hover:text-ink"
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

/* ---------- Details-dialog helpers ---------- */

/**
 * Does this column have a heading worth showing as a field label?
 *
 * An actions column declares `header: ""` — it holds a ⋯ menu, not a value, and
 * listing it would put a control in a definition list under a blank term.
 */
function hasHeading(columnDef: { header?: unknown }): boolean {
  const header = columnDef.header;
  if (typeof header === "string") return header.trim().length > 0;
  // A function header is a rendered element — the tier-dot headings do this —
  // and those are real labels.
  return typeof header === "function";
}

/** The dialog's fallback title: whatever the first real column says. */
function firstCellText(row: { getVisibleCells: () => Array<{ column: { id: string }; getValue: () => unknown }> }): string {
  const first = row.getVisibleCells().find((cell) => cell.column.id !== GUTTER_ID);
  const value = first?.getValue();
  return typeof value === "string" || typeof value === "number" ? String(value) : "Details";
}

/** Every data cell is one truncated line, with the full value on hover. */
export function GridCell({ value, className }: { value: string; className?: string }) {
  return (
    <span title={value} className={cn("block truncate text-body-sm text-ink", className)}>
      {value}
    </span>
  );
}
