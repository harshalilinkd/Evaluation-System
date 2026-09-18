"use client";

/** The spreadsheet grid. One implementation, shared by every table-first screen. */

import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type Cell,
  type ColumnDef,
  type ColumnSizingState,
  type Row,
  type RowData,
} from "@tanstack/react-table";

import { Checkbox } from "@/components/ui/checkbox";
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
    /**
     * A stronger divider on this column's TRAILING edge — the last leaf of a
     * grouped block ("Increment 2"'s Amount column, say), so the boundary
     * between one group and the next reads as a partition rather than the
     * same hairline every ordinary column pair shares.
     */
    partition?: boolean;
    /**
     * WHICH repeat of a generated column pair this is — "Increment 2"'s date
     * and its amount both carry `slot: 2`.
     *
     * Here rather than captured in a closure, so ONE cell component can serve
     * every repeat. A closure per column is a new component type per column,
     * and a new type is a remount — which is what took focus out of an input
     * after a single keystroke (see salary-history-tab's `GridEditing`).
     */
    slot?: number;
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

/* -- The tick column, when a screen turns selection on. Leading and frozen, so
      it stays put while the grid scrolls sideways, and never resizable for the
      same reason as the gutter: the frozen offsets are measured from it. -- */
const SELECT_ID = "__select__";
const SELECT_WIDTH = 44;

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
   * Ticking rows, for a screen with something to do to several at once.
   *
   * OFF UNLESS A SCREEN ASKS FOR IT. A grid carrying checkboxes nobody
   * requested is a grid that reads as a form; the ordinary job of reading the
   * table should not be cluttered by a mode somebody is not in (FIX-5).
   *
   * The grid owns the CONTROL and nothing else — which rows are ticked, and
   * what ticking one means, belong to the screen. It renders on the table and
   * on the phone cards from this one declaration, so a bulk action is not
   * quietly desktop-only (§13.2).
   */
  selection?: {
    isSelected: (row: TData) => boolean;
    onToggle: (row: TData) => void;
    /**
     * A row that cannot be ticked, and the sentence saying why.
     *
     * A tick that silently does nothing is the dead end §13.4 forbids, and the
     * row this exists for — your own account on the people screen — is one the
     * server refuses anyway. Better to say so before the press than to report
     * it afterwards among fifty results.
     */
    disabled?: (row: TData) => { reason: string } | null;
    /** Ticks or clears everything CURRENTLY SHOWN — never rows behind a filter. */
    onToggleAll: () => void;
    allSelected: boolean;
    someSelected: boolean;
    /** The accessible name of one row's tick. "Select Priya Sharma". */
    label: (row: TData) => string;
    /** The accessible name of the header tick. Says how many, and that it is what is shown. */
    allLabel: string;
  };
  /**
   * Actions for the open row, rendered in the dialog footer.
   *
   * The dialog SHOWS; it does not decide what can be done. A screen that wants
   * "Open scorecard" or "Send links" there passes it, and the grid stays
   * ignorant of what its rows mean.
   */
  /**
   * Per-row controls, in the details dialog's footer and on the phone card.
   *
   * `close` dismisses the details dialog. An action that takes the reader back
   * to the TABLE — putting one row into edit, say — has to, or it leaves the
   * dialog covering the row it just changed. An action that opens its own
   * confirmation ignores it, which is why it is a second argument rather than
   * something every caller must handle.
   */
  rowActions?: (row: TData, close: () => void) => React.ReactNode;
  /**
   * Extra detail beneath the field list, for anything a COLUMN cannot hold.
   *
   * A column shows one value per row. A list of names — who is in this cycle,
   * and who has submitted — is not that shape, and squeezing it into a cell
   * would be unreadable at any width. Rendered after the fields because it
   * elaborates them rather than replacing them.
   */
  rowDetail?: (row: TData) => React.ReactNode;
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
  rowDetail,
  selection,
}: DataGridProps<TData>) {
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  /* -- The open row, by index rather than by value.
        An index survives the data being refetched under it; a captured object
        would go on showing a stale copy after a `router.refresh()`, which on a
        screen whose actions change the row is exactly wrong. -- */
  const [openRowIndex, setOpenRowIndex] = useState<number | null>(null);

  /* -- WHICH PHONE CARDS ARE OPEN.
        By row id rather than index, so a refetch that reorders the list does
        not leave a different person expanded — the same reasoning that made
        `openRowIndex` an index for the dialog is inverted here, because a card
        is identified by WHO it is rather than by where it sits.

        A Set rather than one id: HR comparing two people should not have to
        keep closing one to see the other. -- */
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const toggleRow = (id: string) =>
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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

  /* -- MEMOISED, BECAUSE A COLUMN'S `cell` IS ITS COMPONENT TYPE.
        `flexRender` calls `React.createElement(cell, …)`, so rebuilding this
        object on every render gave the gutter a new `cell` function, a new type and
        therefore a full unmount on every render of the grid. Harmless while
        it drew a button; not harmless once `rowLabel.cell` can be a text
        input, which loses focus the moment its subtree is replaced.

        A caller passing an inline `rowLabel` or `onRowClick` still defeats
        this — the deps change every render — so the two that matter memoise
        theirs. See `users-tab.tsx`. -- */
  const gutter = useMemo<ColumnDef<TData>>(() => ({
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
  }), [rowLabel, onRowClick, rowTitle]);

  /* -- The tick column sits BEFORE the gutter, where a spreadsheet's selector
        lives, and carries no heading text of its own — its header IS the
        select-all control. It is excluded from the card and dialog field lists
        below by id rather than by that absence, because a checkbox is a
        control, not a value with a name. -- */
  const selectColumn: ColumnDef<TData> = {
    id: SELECT_ID,
    header: () =>
      selection ? (
        <Checkbox
          checked={selection.allSelected ? true : selection.someSelected ? "indeterminate" : false}
          onCheckedChange={selection.onToggleAll}
          aria-label={selection.allLabel}
        />
      ) : null,
    size: SELECT_WIDTH,
    enableResizing: false,
    meta: { align: "center", frozen: true },
    cell: ({ row }) =>
      selection ? (
        <Checkbox
          checked={selection.isSelected(row.original)}
          onCheckedChange={() => selection.onToggle(row.original)}
          aria-label={selection.label(row.original)}
          disabled={Boolean(selection.disabled?.(row.original))}
          title={selection.disabled?.(row.original)?.reason}
        />
      ) : null,
  };

  /* -- NORMALISED TO A UNIFORM DEPTH, and ONLY when a caller's OWN columns mix
        grouped and plain ones — the shape a spanning pair (an "Increment 2"
        heading over its own Date/Amount columns) needs.

        TanStack's automatic placeholder/depth handling for a MIXED top-level
        array — some entries carrying their own nested `columns`, some not —
        did not put every column's real content on the row this code expected:
        tried directly, group headers slid left into the slots plain columns
        should have occupied, verified against a real render rather than
        assumed. Rather than getting that depth math right by more careful
        reading of undocumented behaviour, every PLAIN column is wrapped in
        its own single-child, blank-headed group instead — so every top-level
        entry is structurally identical (a group), and there is no depth
        ambiguity left to get wrong: row 0 is always every top-level header
        (blank for a wrapped single, a real name for a real group), row 1 is
        always every leaf.

        Flat-only callers — the overwhelming majority of this component's
        callers — take none of this: `hasGrouping` is false for them and the
        column array passes through completely unchanged. -- */
  const hasGrouping = columns.some(
    (c) => "columns" in c && Array.isArray((c as { columns?: unknown }).columns),
  );
  const normalise = (col: ColumnDef<TData>): ColumnDef<TData> => {
    if (!hasGrouping) return col;
    if ("columns" in col && Array.isArray((col as { columns?: unknown }).columns)) return col;
    const childId = col.id ?? (col as { accessorKey?: string }).accessorKey ?? "";
    return { id: `${childId}__wrap`, header: "", columns: [col] };
  };

  const table = useReactTable({
    data,
    columns: (selection ? [selectColumn, gutter, ...columns] : [gutter, ...columns]).map(normalise),
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

  /* -- WHICH COLUMNS ARE FIELDS.
        The gutter is a row handle and a column with no heading is an actions
        column — neither is a value with a name. The details dialog has drawn
        this distinction since it was written; the cards below use the SAME
        rule, because a card and that dialog are the same information and two
        rules would eventually disagree about what a field is. -- */
  const fieldCells = (row: Row<TData>): Cell<TData, unknown>[] =>
    row
      .getVisibleCells()
      .filter(
        (c) =>
          c.column.id !== GUTTER_ID && c.column.id !== SELECT_ID && hasHeading(c.column.columnDef),
      );

  const headingFor = (columnId: string) => {
    const header = table.getFlatHeaders().find((h) => h.column.id === columnId);
    if (!header) return columnId;
    /* -- `meta.label` FIRST, same precedence `columnLabel()` uses (line 68).
          A leaf under a GROUP column renders its own short header on the
          desktop table — "Date", "Amount" — because the group name above it
          already says which one. A phone card has no group row to borrow
          that context from, so a leaf that needs disambiguating supplies its
          full name through `meta.label` instead; every column that does not
          set one falls through to its plain header exactly as before. -- */
    const label = header.column.columnDef.meta?.label;
    return label ?? flexRender(header.column.columnDef.header, header.getContext());
  };

  return (
    <>
      {/* -- ONE CARD PER ROW ON A PHONE, instead of a table you pan sideways.
            A fourteen-column grid inside `overflow-x` is a desktop table with a
            scrollbar, not a mobile screen: the columns that matter are off the
            right-hand edge, and reading one person means dragging back and
            forth with no header to anchor to.

            Built from the SAME columns — no second set of definitions, no
            per-screen mobile markup. Every grid in the product gets this at
            once, and a column added anywhere appears here without being
            mentioned twice.

            Below `lg` only. Above it the table is the right shape and the
            frozen panes, resizing and gridlines all still apply. -- */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-canvas p-3 lg:hidden">
        {!hasRows && empty ? (
          <div className="p-3">{empty}</div>
        ) : (
          <ul className="space-y-3">
            {table.getRowModel().rows.map((row) => {
              const fields = fieldCells(row);
              const [lead, second, ...rest] = fields;
              const open = expandedRows.has(row.id);
              const bodyId = `card-${row.id}`;

              return (
                <li key={row.id} className="card-surface overflow-hidden">
                  <div className="flex items-start">
                    {selection ? (
                      <span className="shrink-0 py-4 pl-4">
                        <Checkbox
                          checked={selection.isSelected(row.original)}
                          onCheckedChange={() => selection.onToggle(row.original)}
                          aria-label={selection.label(row.original)}
                          disabled={Boolean(selection.disabled?.(row.original))}
                          title={selection.disabled?.(row.original)?.reason}
                        />
                      </span>
                    ) : null}
                  {/* -- COLLAPSED BY DEFAULT, at the owner's instruction: "make
                        each card collapsible — it shows basic info, the user
                        taps to expand and see all details."

                        Every field was on every card, so a fourteen-column grid
                        became a fourteen-line card and a list of twenty was a
                        very long scroll. The name and one more fact identify
                        somebody; the rest is what you open a person FOR.

                        Tapping toggles rather than navigating. The screens that
                        navigate keep their route in the expanded actions below,
                        because a tap that sometimes expands and sometimes leaves
                        the page is a tap nobody trusts. -- */}
                  {/* -- THE SUMMARY IS NOT INSIDE THE TOGGLE, and it cannot be.
                        The two summary cells render whatever the column
                        renders, and on an editable grid that is a control — the
                        salary history's first column is a date picker, which is
                        itself a `<button>`. Nesting one button in another is
                        invalid HTML and React refuses to hydrate it, so the
                        whole tab died with a hydration error rather than
                        misbehaving quietly.

                        It was wrong on its own terms too, before the markup:
                        with the summary inside the toggle, tapping the date
                        field to change it would ALSO collapse the card.

                        So the toggle is now a SIBLING — the row's code and the
                        chevron, which is where the eye already goes and where
                        the affordance was drawn anyway. The summary beside it
                        is plain markup, so an editable cell in it is reachable.
                        `min-h-11` keeps it a full-size target (§13.8). -- */}
                  <div className="flex min-w-0 flex-1 items-start gap-3 py-3 pl-4 text-left">
                    <span className="min-w-0 flex-1">
                      <span className="block font-sans text-body font-medium text-ink">
                        {lead ? flexRender(lead.column.columnDef.cell, lead.getContext()) : null}
                      </span>
                      {/* The second field as a subtitle — a designation, a
                          department, a status. A name on its own identifies
                          nobody in a company with two Kumars. */}
                      {second ? (
                        <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 font-sans text-body-sm text-ink-muted">
                          <span className="type-label shrink-0">
                            {headingFor(second.column.id)}
                          </span>
                          <span className="min-w-0">
                            {flexRender(second.column.columnDef.cell, second.getContext())}
                          </span>
                        </span>
                      ) : null}
                    </span>
                  </div>

                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={bodyId}
                    onClick={() => toggleRow(row.id)}
                    className="flex min-h-11 shrink-0 items-center gap-2 py-3 pl-1 pr-4"
                  >
                    {/* The chevron is `aria-hidden`, and the row code is not a
                        name for an action — without this the button announces
                        as "NA-01" or as nothing at all. */}
                    <span className="sr-only">{open ? "Hide details" : "Show details"}</span>
                    {/* The row's own identifier — an employee code where the
                        screen supplies one. A row NUMBER is not worth a line
                        on a card, so the plain gutter is dropped. */}
                    {rowLabel ? (
                      <span className="tabular font-sans text-body-sm text-ink-muted">
                        {rowLabel.value(row.original)}
                      </span>
                    ) : null}
                    {/* §13.8: the state is a shape, not only a position. The
                        `aria-expanded` above carries it to assistive tech. */}
                    <ChevronDown
                      aria-hidden
                      className={cn(
                        "size-4 text-ink-muted transition-transform duration-hover",
                        open && "rotate-180",
                      )}
                    />
                  </button>
                  </div>

                  {/* Unmounted rather than hidden: twenty collapsed cards each
                      rendering fourteen cells is the cost this change exists to
                      remove. */}
                  {open ? (
                    <div id={bodyId}>
                      <dl className="px-4 pb-3">
                        {rest.map((cell) => (
                          <div
                            key={cell.id}
                            className="flex items-baseline justify-between gap-3 border-t border-rule py-2 first:border-t-0"
                          >
                            <dt className="type-label shrink-0 text-ink-muted">
                              {headingFor(cell.column.id)}
                            </dt>
                            <dd className="min-w-0 flex-1 text-right font-sans text-body-sm text-ink">
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </dd>
                          </div>
                        ))}
                      </dl>

                      {/* -- The row's actions, at the bottom where a thumb is.
                            `rowActions` is what the details dialog puts in its
                            footer; the headingless action COLUMNS are dropped,
                            because a screen that has both would show the same
                            buttons twice.

                            `onRowClick` gets a button of its own: the card tap
                            is the toggle now, so the screens that navigate — the
                            roster to a scorecard, Settings › Users to its edit
                            dialog — would otherwise have lost their only way
                            in on a phone. -- */}
                      {rowActions || onRowClick ? (
                        <div className="flex flex-wrap items-center gap-2 border-t border-rule bg-surface-mute px-4 py-3">
                          {rowActions ? rowActions(row.original, () => setOpenRowIndex(null)) : null}
                          {onRowClick ? (
                            <button
                              type="button"
                              onClick={() => onRowClick(row.original)}
                              className="inline-flex min-h-11 items-center rounded-control border border-rule bg-surface px-3 font-sans text-body-sm font-medium text-ink"
                            >
                              Open{rowNoun ? ` ${rowNoun}` : ""}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="hidden min-h-0 flex-1 overflow-auto bg-surface lg:block">
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
              {/* -- HEADER ROW HEIGHT is fixed at `h-9` (36px) below, so a
                    second row's sticky offset is `groupIndex * 36`. Every
                    caller until now has had exactly one header row — a flat
                    ColumnDef list — so `groupIndex` was always 0 and this was
                    a no-op; grouped columns (a ColumnDef with its own nested
                    `columns`) are what makes a second row exist at all. -- */}
              {table.getHeaderGroups().map((headerGroup, groupIndex) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    /* -- TanStack fills the rows BELOW a leaf column that
                          starts at a shallow depth with placeholder header
                          objects, so every row has an entry for every leaf.
                          Rendering those as empty `<th>`s would draw a second,
                          blank cell under a leaf that has no group above it —
                          the correct HTML shape is for the leaf's OWN cell to
                          rowSpan down through them instead, so the placeholder
                          is skipped entirely rather than drawn. -- */
                    if (header.isPlaceholder) return null;

                    // No `meta` here on purpose: alignment is a property of the
                    // VALUES, and the heading no longer follows it.
                    const left = frozenLeft.get(header.column.id);
                    const isLeaf = header.subHeaders.length === 0;
                    // A leaf sitting above sibling GROUP columns has to span
                    // down through every row below it — for a flat grid every
                    // leaf is already on the LAST row, so this is always 1.
                    const rowSpan = isLeaf ? table.getHeaderGroups().length - header.depth : 1;
                    /* -- A GENUINE GROUP, spanning more than one leaf — never
                          just "not a leaf". `normalise` above wraps every
                          PLAIN column (Name, Joined, the gutter…) in its own
                          one-child synthetic group so depth stays uniform
                          (see the long comment there); `isLeaf` alone cannot
                          tell that wrapper apart from a real "Increment 2"
                          spanning two columns, and treating them the same
                          darkened the WHOLE header row instead of the three
                          cells this was actually asked for. colSpan is what
                          the wrapper and a real group do NOT share. -- */
                    const isRealGroup = header.colSpan > 1;
                    /* -- THE PARTITION, checked on THIS header's own trailing
                          leaf — a leaf checks its own meta; a group looks at
                          the LAST of its children, since a group's right edge
                          sits at exactly the same x-coordinate as that leaf's
                          and the two rows have to agree or the line breaks in
                          the middle of the header. -- */
                    const partitionRight = isLeaf
                      ? Boolean(header.column.columnDef.meta?.partition)
                      : Boolean(header.subHeaders.at(-1)?.column.columnDef.meta?.partition);
                    return (
                      <th
                        key={header.id}
                        scope="col"
                        colSpan={header.colSpan}
                        rowSpan={rowSpan}
                        // border-separate, not border-collapse: a collapsed
                        // border belongs to the table rather than the cell, so
                        // it does not travel with a sticky header or a frozen
                        // column — the grid loses its lines exactly when it is
                        // scrolled, which is when they matter most.
                        style={{
                          top: groupIndex * 36,
                          ...(left === undefined ? {} : { "--frozen-left": `${left}px` }),
                        } as React.CSSProperties}
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
                          "sticky z-20 h-9 border-b border-r border-rule px-3 text-left align-middle",
                          // `twMerge` (inside `cn`) lets this WIN over the
                          // plain `border-r` above — a real divider between
                          // one "Increment" block and the next, not the same
                          // hairline an ordinary column pair shares.
                          partitionRight && "border-r-2 border-r-ink/25",
                          // A GROUP heading ("Increment 2") gets its OWN
                          // slightly darker ground than an ordinary leaf
                          // heading, and centres over the pair it spans — a
                          // group name read against a single left edge shared
                          // with an unrelated leaf column beside it does not
                          // read as belonging to anything.
                          //
                          // `color-mix` rather than a second named token: the
                          // header background is already the darker of two
                          // surface tokens in light mode and the LIGHTER of
                          // the two in dark mode (the whole ramp inverts), so
                          // no single hex reads as "a bit darker" in both —
                          // mixing a little black in always does, whatever
                          // the base colour's own lightness is.
                          isRealGroup
                            ? "bg-[color-mix(in_srgb,rgb(var(--surface-mute)),black_8%)] text-center"
                            : "bg-surface-mute",
                          left !== undefined && "grid-frozen z-30",
                        )}
                      >
                        {/* font-bold, not semibold: a header row that reads as
                            a header at a glance is what tells a wide grid where
                            its columns are. `text-ink` is #111827 — the
                            darkest text token there is. */}
                        <span className="type-label block truncate font-bold text-ink">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </span>

                        {/* Resizing a GROUP would resize a column that has no
                            width of its own — TanStack sizes leaves, and a
                            group's width is only ever the sum of its
                            children's. */}
                        {isLeaf && header.column.getCanResize() ? (
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
                      never have to, and carries the header ground to the
                      edge — one per row, since the trailing slack column runs
                      the table's full height, not just its last row. */}
                  <th
                    aria-hidden
                    style={{ top: groupIndex * 36 }}
                    className="sticky z-20 border-b border-rule bg-surface-mute"
                  />
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
                          // The SAME partition as the header above, so the
                          // divider between one "Increment" block and the
                          // next runs the full height of the table rather
                          // than stopping at the header row.
                          meta?.partition && "border-r-2 border-r-ink/25",
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
              {/* -- WALKING THE TOP-LEVEL HEADER ROW, not the flat cell list
                    the field-by-field version used. A GROUP's children — an
                    "Increment 2" heading's own Date and Amount — now render
                    as ONE row instead of two separate ones the eye has to
                    re-pair by hand, matching what was asked for directly.

                    For a screen with no grouping at all (Team review, Users,
                    every OTHER caller) `getHeaderGroups()[0]` already holds
                    exactly the leaf columns in order, `colSpan` is 1 for
                    every one of them, and this is a complete no-op — the
                    single-field branch below is byte-for-byte what the old
                    code did. -- */}
              {(table.getHeaderGroups()[0]?.headers ?? [])
                .filter(
                  (h) => !h.isPlaceholder && h.column.id !== GUTTER_ID && h.column.id !== SELECT_ID,
                )
                .map((header) => {
                  if (header.colSpan > 1) {
                    // A REAL GROUP — its children, side by side in one row,
                    // each still carrying its own short label ("Date" /
                    // "Amount") so the pair is not ambiguous on its own.
                    const values = header.subHeaders
                      .map((sub) => ({
                        sub,
                        cell: openRow.getVisibleCells().find((c) => c.column.id === sub.column.id),
                      }))
                      .filter((v) => v.cell);
                    return (
                      <div key={header.id} className="grid grid-cols-[9rem_1fr] items-baseline gap-3 py-2.5">
                        <dt className="type-label font-bold text-ink">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </dt>
                        <dd className="flex min-w-0 flex-wrap items-baseline gap-x-5 gap-y-1 font-sans text-body text-ink">
                          {values.map(({ sub, cell }) => (
                            <span key={sub.id} className="inline-flex items-baseline gap-1.5">
                              <span className="type-label text-ink-muted">
                                {flexRender(sub.column.columnDef.header, sub.getContext())}
                              </span>
                              {flexRender(cell!.column.columnDef.cell, cell!.getContext())}
                            </span>
                          ))}
                        </dd>
                      </div>
                    );
                  }

                  /* -- THE SINGLE-FIELD CASE — but `header` here might be
                        `normalise`'s SYNTHETIC one-child wrapper (Name,
                        Joined, Joining salary…), not the real field: its OWN
                        columnDef carries a BLANK header ("") so the group row
                        above has nothing to show for it, and its id is
                        `${childId}__wrap`, which matches no cell at all —
                        `openRow.getVisibleCells()` only ever has entries for
                        real LEAF columns. Checking `hasHeading`/looking up a
                        cell against the WRAPPER rather than the leaf it hides
                        is what made every wrapped field disappear from this
                        dialog outright. Unwrapped here: a header with exactly
                        one child drills into that child; a genuine flat leaf
                        (`subHeaders.length === 0`, every OTHER screen using
                        this dialog) is unchanged, since `leafHeader` is then
                        just `header` itself. -- */
                  const leafHeader = header.subHeaders.length === 1 ? header.subHeaders[0]! : header;
                  // A column with no heading is an actions column, not a
                  // FIELD, and listing it would put a ⋯ menu in a list of
                  // values under a blank label.
                  if (!hasHeading(leafHeader.column.columnDef)) return null;
                  const cell = openRow.getVisibleCells().find((c) => c.column.id === leafHeader.column.id);
                  if (!cell) return null;
                  return (
                    <div key={header.id} className="grid grid-cols-[9rem_1fr] items-baseline gap-3 py-2.5">
                      <dt className="type-label font-bold text-ink">{headingFor(leafHeader.column.id)}</dt>
                      <dd className="min-w-0 font-sans text-body text-ink">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </dd>
                    </div>
                  );
                })}
            </dl>
          ) : null}

          {/* -- ANYTHING THAT IS NOT A COLUMN.
                The field list above can only ever show what the table shows,
                one value per column — which is right for the row's own facts
                and cannot express a LIST. A cycle's detail needs to name the
                employees and the managers in it and say who has submitted, and
                three names in a table cell would be unreadable at any width.

                So the dialog gets a slot beneath the fields rather than the
                columns getting longer. Optional, so every existing caller is
                unchanged, and rendered after them because it elaborates the
                summary rather than replacing it. -- */}
          {openRow && rowDetail ? (
            <div className="mt-2 border-t border-rule pt-4">{rowDetail(openRow.original)}</div>
          ) : null}

          {openRow && rowActions ? (
            <DialogFooter className="gap-2">
              {rowActions(openRow.original, () => setOpenRowIndex(null))}
            </DialogFooter>
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
