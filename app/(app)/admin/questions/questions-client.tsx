"use client";

/** The question bank: filters, table, drawer, reorder and retire. */

import { useActionState, useCallback, useEffect, useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnSizingState,
} from "@tanstack/react-table";
import { AlertTriangle, ChevronDown, ChevronUp, Plus, Trash2, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  QuestionDrawer,
  type DepartmentOption,
  type QuestionRecord,
} from "@/app/(app)/admin/questions/question-drawer";
import { EmptyState } from "@/components/appraise/states";
import { QuestionImportDialog } from "@/app/(app)/admin/questions/question-import-dialog";
import {
  deleteQuestionsForever,
  reorderQuestions,
  setQuestionActive,
  type DeleteQuestionsState,
  type QuestionActionState,
} from "@/lib/questions/actions";
import {
  ANSWERED_BY,
  CATEGORIES,
  RESPONSE_TYPES,
  SECTIONS,
  TRACKS,
  SECTION_LABELS,
  answeredByLabel,
  responseTypeLabel,
  sectionLabel,
  trackLabel,
} from "@/lib/questions/labels";
import { cn } from "@/lib/utils";

export type QuestionsClientProps = {
  questions: QuestionRecord[];
  /** Which departments each question is mapped to, for the retire warning. */
  departmentsByQuestion: Record<string, string[]>;
  departments: DepartmentOption[];
};

const ANY = "ANY";

/* ---------- Grid layout ----------
   A spreadsheet reads as a spreadsheet because every column is the same width on
   every row and every cell is one line. `table-fixed` plus a width per column is
   what enforces that. The widths themselves live on the column defs as `size`,
   so TanStack owns them and the drag handles can move them; this map carries
   only what a width cannot say — alignment and which columns are frozen. Keyed
   by column id rather than carried on the column def, because TanStack's `meta`
   would need a module augmentation to stay typed. */
const COLUMN_LAYOUT: Record<string, { align?: "center" | "right"; frozen?: boolean }> = {
  index: { align: "right", frozen: true },
  text: { frozen: true },
  is_required: { align: "center" },
  used_in: { align: "right" },
  status: { align: "center" },
  actions: { align: "right" },
};

const ALIGN_CLASS = { center: "text-center", right: "text-right" } as const;

/**
 * Frozen panes, from `lg` up. Left of the question column sits only the 44px
 * row-number gutter, hence `left-11` — which holds because the gutter is the one
 * column that cannot be resized. Below `lg` nothing is frozen: on a 375px screen
 * the two would eat the whole viewport and leave a sliver to scroll the other
 * eight columns through.
 */
const FROZEN_OFFSET: Record<string, string> = { index: "lg:left-0", text: "lg:left-11" };

/** A column can be dragged no narrower than this. Below it a header is unreadable. */
const MIN_COLUMN_WIDTH = 64;

/** Arrow keys nudge; shift-arrow jumps. The keyboard path for the drag handle. */
const KEY_STEP = 8;
const KEY_STEP_LARGE = 40;

const COLUMN_WIDTH_KEY = "appraise.question-bank.column-widths";

/* Widths are a personal preference, not data — they belong to the browser, not
   the database. localStorage is unavailable in some privacy modes and can hold
   stale JSON from an older column set; neither is worth a broken screen. */
function readStoredWidths(): ColumnSizingState | null {
  try {
    const raw = window.localStorage.getItem(COLUMN_WIDTH_KEY);
    return raw ? (JSON.parse(raw) as ColumnSizingState) : null;
  } catch {
    return null;
  }
}

function writeStoredWidths(sizing: ColumnSizingState): void {
  try {
    window.localStorage.setItem(COLUMN_WIDTH_KEY, JSON.stringify(sizing));
  } catch {
    return;
  }
}

function layoutFor(columnId: string) {
  return COLUMN_LAYOUT[columnId] ?? {};
}

/**
 * Every data cell is one truncated line, with the full value on hover.
 *
 * Primary ink, not muted. §2 gives `--ink-muted` to "secondary text, labels,
 * chart axes" — but in a grid the section, the type and who answers are the
 * data, not chrome around it. Setting a whole table in the secondary tone made
 * every value look like a caption for a value that was not there.
 */
function Cell({ value, className }: { value: string; className?: string }) {
  return (
    <span
      title={value}
      className={cn("block truncate font-sans text-body-sm text-ink", className)}
    >
      {value}
    </span>
  );
}

export function QuestionsClient({
  questions,
  departmentsByQuestion,
  departments,
}: QuestionsClientProps) {
  const [search, setSearch] = useState("");
  const [section, setSection] = useState(ANY);
  const [track, setTrack] = useState(ANY);
  const [category, setCategory] = useState(ANY);
  const [status, setStatus] = useState("ACTIVE");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<QuestionRecord | null>(null);
  const [retiring, setRetiring] = useState<QuestionRecord | null>(null);

  // Column widths. Read after mount rather than during render: the server has no
  // localStorage, so seeding state from it directly would render one width on
  // the server and another on the first client pass, and React would tear.
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});

  useEffect(() => {
    const stored = readStoredWidths();
    if (stored) setColumnSizing(stored);
  }, []);

  useEffect(() => {
    // The empty first render must not wipe a stored preference before the load
    // effect above has had a chance to apply it.
    if (Object.keys(columnSizing).length === 0) return;
    writeStoredWidths(columnSizing);
  }, [columnSizing]);

  /** The keyboard equivalent of dragging the handle (§13.8). */
  const resizeBy = (columnId: string, currentWidth: number, delta: number) => {
    setColumnSizing((old) => ({
      ...old,
      [columnId]: Math.max(MIN_COLUMN_WIDTH, currentWidth + delta),
    }));
  };

  const [activeState, activeAction] = useActionState<QuestionActionState, FormData>(
    setQuestionActive,
    {},
  );
  const [, reorderAction] = useActionState<QuestionActionState, FormData>(reorderQuestions, {});

  /* ---------- Deleting ---------- */
  /*
   * Two modes, because deleting one question and clearing out twenty are
   * different jobs. "One" keeps the table as it is and puts a bin on each row;
   * "several" turns the rows into a selection with a header toggle. Nothing is
   * selectable until one of them is chosen, so the ordinary job of reading the
   * bank is never cluttered with checkboxes nobody asked for.
   */
  const [importOpen, setImportOpen] = useState(false);
  const [deleteMode, setDeleteMode] = useState<null | "one" | "several">(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState<QuestionRecord[] | null>(null);
  const [deleteState, deleteAction] = useActionState<DeleteQuestionsState, FormData>(
    deleteQuestionsForever,
    {},
  );

  const exitDeleteMode = () => {
    setDeleteMode(null);
    setSelected(new Set());
  };

  // Stable, because the column definitions are memoised and close over it — an
  // arrow recreated each render would either be a stale capture or force the
  // whole column set to rebuild on every keystroke in the search box.
  const toggleRow = useCallback(
    (id: string) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );

  const rows = useMemo(
    () =>
      questions.filter((q) => {
        if (section !== ANY && q.section !== section) return false;
        if (track !== ANY && q.track !== track) return false;
        if (category !== ANY && q.category !== category) return false;
        if (status === "ACTIVE" && !q.is_active) return false;
        if (status === "INACTIVE" && q.is_active) return false;
        if (search.trim()) {
          const needle = search.trim().toLowerCase();
          return (
            q.text.toLowerCase().includes(needle) ||
            (q.help_text ?? "").toLowerCase().includes(needle)
          );
        }
        return true;
      }),
    [questions, section, track, category, status, search],
  );

  // Only Yes/No questions can drive a condition, and a question cannot depend on
  // itself — so the one being edited is excluded from its own candidate list.
  const parentCandidates = useMemo(
    () =>
      questions
        .filter((q) => q.response_type === "BOOLEAN" && q.is_active && q.id !== editing?.id)
        .map((q) => ({ id: q.id, text: q.text })),
    [questions, editing],
  );

  /* -- Select-all covers what is ON SCREEN, never the whole bank.
        The filters are how HR narrows to "the ones I mean", so a toggle that
        reached past them would select questions the person cannot see — which
        is the classic way a bulk action takes something nobody intended. The
        label says so. -- */
  const allVisibleSelected = rows.length > 0 && rows.every((q) => selected.has(q.id));
  const someVisibleSelected = rows.some((q) => selected.has(q.id));

  const toggleAllVisible = useCallback(
    () =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (allVisibleSelected) rows.forEach((q) => next.delete(q.id));
        else rows.forEach((q) => next.add(q.id));
        return next;
      }),
    [rows, allVisibleSelected],
  );

  const selectedRecords = useMemo(
    () => questions.filter((q) => selected.has(q.id)),
    [questions, selected],
  );

  const columns = useMemo<ColumnDef<QuestionRecord>[]>(
    () => [
      ...(deleteMode === "several"
        ? [
            {
              id: "select",
              size: 44,
              enableResizing: false,
              header: () => (
                <Checkbox
                  checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
                  onCheckedChange={toggleAllVisible}
                  aria-label={`Select all ${rows.length} questions shown`}
                />
              ),
              cell: ({ row }) => (
                <Checkbox
                  checked={selected.has(row.original.id)}
                  onCheckedChange={() => toggleRow(row.original.id)}
                  aria-label={`Select "${row.original.text}"`}
                />
              ),
            } satisfies ColumnDef<QuestionRecord>,
          ]
        : []),
      ...(deleteMode === "one"
        ? [
            {
              id: "delete-one",
              size: 44,
              enableResizing: false,
              header: "",
              cell: ({ row }) => (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-ink-faint hover:text-critical"
                  aria-label={`Delete "${row.original.text}"`}
                  onClick={() => setConfirming([row.original])}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              ),
            } satisfies ColumnDef<QuestionRecord>,
          ]
        : []),
      {
        id: "index",
        // A spreadsheet's row gutter: it gives every row a stable handle to
        // refer to out loud, and it is the thing that makes a long list feel
        // countable rather than endless. Not resizable — the frozen question
        // column is offset by exactly this width, and a gutter that moved would
        // drag the frozen pane out of alignment with it.
        header: "#",
        size: 44,
        enableResizing: false,
        cell: ({ row }) => (
          <span className="tabular text-body-sm text-ink-muted">{row.index + 1}</span>
        ),
      },
      {
        accessorKey: "text",
        header: "Question",
        size: 460,
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => {
              setEditing(row.original);
              setDrawerOpen(true);
            }}
            title={row.original.text}
            className="block w-full truncate text-left font-sans text-body text-ink hover:underline"
          >
            {row.original.text}
          </button>
        ),
      },
      {
        accessorKey: "section",
        header: "Section",
        size: 140,
        cell: ({ row }) => <Cell value={sectionLabel(row.original.section as never)} />,
      },
      {
        accessorKey: "response_type",
        header: "Type",
        size: 104,
        cell: ({ row }) => <Cell value={responseTypeLabel(row.original.response_type)} />,
      },
      {
        accessorKey: "track",
        header: "Applies to",
        size: 96,
        cell: ({ row }) => <Cell value={trackLabel(row.original.track as never)} />,
      },
      {
        accessorKey: "answered_by",
        header: "Answered by",
        size: 140,
        cell: ({ row }) => <Cell value={answeredByLabel(row.original.answered_by as never)} />,
      },
      {
        accessorKey: "is_required",
        header: "Required",
        size: 84,
        cell: ({ row }) => (
          <Cell value={row.original.is_required ? "Yes" : "No"} className="text-center" />
        ),
      },
      {
        id: "used_in",
        header: "Used in",
        size: 76,
        cell: ({ row }) => (
          // §3: every count is mono and tabular.
          <span className="tabular text-body-sm text-ink">
            {row.original.category === "DEPARTMENT" ? row.original.departmentCount : "All"}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        size: 96,
        cell: ({ row }) => (
          <span
            className={cn(
              "type-label inline-block whitespace-nowrap rounded-pill border px-2 py-0.5",
              row.original.is_active
                ? "border-final/40 bg-final-tint text-final"
                : "border-rule bg-surface-mute text-ink-faint",
            )}
          >
            {row.original.is_active ? "Active" : "Inactive"}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        // Fixed controls, so there is nothing a wider column would reveal — and
        // an unlabelled header has no name to announce on a resize handle.
        // Sized for "Reactivate", the longest label it ever holds.
        size: 176,
        enableResizing: false,
        cell: ({ row }) => {
          const q = row.original;
          const index = rows.findIndex((r) => r.id === q.id);
          const sameGroup = rows.filter((r) => r.section === q.section && r.track === q.track);
          const posInGroup = sameGroup.findIndex((r) => r.id === q.id);

          return (
            <div className="flex items-center justify-end gap-0.5">
              {/* §P8.6: reorder within a section. Buttons rather than pointer
                  drag so it works by keyboard and on a phone. */}
              <form action={reorderAction}>
                <input type="hidden" name="section" value={q.section} />
                <input type="hidden" name="track" value={q.track} />
                <input
                  type="hidden"
                  name="ids"
                  value={JSON.stringify(swap(sameGroup.map((r) => r.id), posInGroup, posInGroup - 1))}
                />
                <Button
                  type="submit"
                  variant="ghost"
                  size="icon"
                  aria-label={`Move "${q.text}" earlier`}
                  disabled={posInGroup <= 0}
                >
                  <ChevronUp className="size-4" />
                </Button>
              </form>
              <form action={reorderAction}>
                <input type="hidden" name="section" value={q.section} />
                <input type="hidden" name="track" value={q.track} />
                <input
                  type="hidden"
                  name="ids"
                  value={JSON.stringify(swap(sameGroup.map((r) => r.id), posInGroup, posInGroup + 1))}
                />
                <Button
                  type="submit"
                  variant="ghost"
                  size="icon"
                  aria-label={`Move "${q.text}" later`}
                  disabled={posInGroup === -1 || posInGroup >= sameGroup.length - 1 || index === -1}
                >
                  <ChevronDown className="size-4" />
                </Button>
              </form>

              {q.is_active ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="px-2"
                  onClick={() => setRetiring(q)}
                >
                  Deactivate
                </Button>
              ) : (
                <form action={activeAction}>
                  <input type="hidden" name="id" value={q.id} />
                  <input type="hidden" name="is_active" value="true" />
                  <Button type="submit" variant="ghost" size="sm" className="px-2">
                    Reactivate
                  </Button>
                </form>
              )}
            </div>
          );
        },
      },
    ],
    [
      rows,
      reorderAction,
      activeAction,
      deleteMode,
      selected,
      allVisibleSelected,
      someVisibleSelected,
      toggleRow,
      toggleAllVisible,
    ],
  );

  const table = useReactTable({
    data: rows,
    columns,
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

  const retiringDepartments = retiring ? (departmentsByQuestion[retiring.id] ?? []) : [];

  return (
    // data-full-bleed drops the shell's 1180px cap and its gutters (the :has()
    // rule in globals.css). On this screen the grid IS the layout, so it takes
    // the viewport: the notes and the toolbar are fixed bands, and the table
    // owns everything left over and scrolls inside itself.
    <div
      data-full-bleed
      className="flex h-[calc(100dvh-theme(spacing.topbar))] min-h-0 flex-col bg-surface"
    >
      {/* Two standing notes. The first is the single most important thing HR can
          misunderstand about this screen (§P8.8); the second is the shape of the
          form itself (§1, P8-PATCH.10). One band rather than two cards — on a
          screen whose point is the grid, they are a caption, not content. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-rule bg-accent px-3 py-2">
        <p className="font-sans text-body-sm text-accent-foreground">
          Every employee answers the same form. Only the{" "}
          {SECTION_LABELS.DEPARTMENT_SPECIFIC} section changes by department.
        </p>
        {/* Full opacity, not /70. The faded second half was the least legible
            text on the screen, and it carries the rule people most need to
            read: an edit here never reaches a launched evaluation. */}
        <p className="font-sans text-body-sm text-accent-foreground">
          Changes here apply to future cycles. Evaluations that are already launched keep the
          questions they were launched with.
        </p>
      </div>

      {activeState.error || activeState.message ? (
        <p
          role="status"
          className={cn(
            "border-b px-3 py-2 font-sans text-body-sm",
            activeState.error
              ? "border-critical/40 bg-critical-tint text-critical"
              : "border-final/40 bg-final-tint text-final",
          )}
        >
          {activeState.error ?? activeState.message}
        </p>
      ) : null}

      {/* The toolbar. Controls stay at 44px (§13.8) but sit on one line, so the
          band costs the grid as little height as it can. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule bg-surface-mute px-3 py-2">
        {/* Full width on a phone; a fixed 220px plus four filters overflowed a
            375px screen and pushed the Add button off the row. */}
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search questions"
          className="min-h-11 w-full border-rule bg-surface sm:w-[220px]"
          aria-label="Search questions"
        />

        <FilterSelect label="Section" value={section} onChange={setSection} options={SECTIONS} />
        <FilterSelect label="Applies to" value={track} onChange={setTrack} options={TRACKS} />
        <FilterSelect label="Who is asked" value={category} onChange={setCategory} options={CATEGORIES} />
        <FilterSelect
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "ACTIVE", label: "Active" },
            { value: "INACTIVE", label: "Inactive" },
          ]}
          includeAny
        />

        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          {/* Bulk import sits beside the single-question path rather than
              replacing it: adding one question and loading a hundred are
              different jobs, and hiding either inside the other costs whoever
              is doing the common one an extra click. */}
          <Button
            variant="outline"
            className="min-h-11 flex-1 sm:flex-none"
            onClick={() => setImportOpen(true)}
          >
            <Upload className="size-4" aria-hidden />
            Import
          </Button>

          {/* Secondary to "Add a question" (§13.3): one primary action, and
              on this screen authoring is it. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="min-h-11 flex-1 sm:flex-none">
                <Trash2 className="size-4" aria-hidden />
                Delete
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 border-rule">
              <DropdownMenuItem onSelect={() => { setSelected(new Set()); setDeleteMode("one"); }}>
                <div>
                  <p className="text-body">Delete a single question</p>
                  <p className="text-body-sm text-ink-muted">A bin appears on every row.</p>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { setSelected(new Set()); setDeleteMode("several"); }}>
                <div>
                  <p className="text-body">Delete several questions</p>
                  <p className="text-body-sm text-ink-muted">Tick the ones you want to remove.</p>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            className="min-h-11 flex-1 sm:flex-none"
            onClick={() => {
              setEditing(null);
              setDrawerOpen(true);
            }}
          >
            <Plus className="size-4" />
            Add a question
          </Button>
        </div>
      </div>

      {/* ---------- Selection bar ---------- */}
      {/* Only while a delete mode is on. It carries the count, the way out, and
          the action — so the mode can never be entered with no visible way to
          leave it (§13.4). */}
      {deleteMode ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-warning/40 bg-warning-tint px-3 py-2">
          <Button
            variant="ghost"
            size="icon"
            className="size-9 shrink-0"
            aria-label="Stop deleting"
            onClick={exitDeleteMode}
          >
            <X className="size-4" aria-hidden />
          </Button>

          {deleteMode === "one" ? (
            <p className="text-body-sm text-ink">
              Choose the question to delete using the bin on its row.
            </p>
          ) : (
            <>
              <p className="text-body-sm text-ink">
                <span className="font-medium tabular">{selected.size}</span> selected
                {selected.size > 0 && !allVisibleSelected ? (
                  <>
                    {" · "}
                    <button
                      type="button"
                      className="underline underline-offset-2"
                      onClick={toggleAllVisible}
                    >
                      select all {rows.length} shown
                    </button>
                  </>
                ) : null}
              </p>

              <Button
                variant="destructive"
                className="ml-auto min-h-11"
                disabled={selected.size === 0}
                onClick={() => setConfirming(selectedRecords)}
              >
                <Trash2 className="size-4" aria-hidden />
                Delete {selected.size > 0 ? selected.size : ""}
              </Button>
            </>
          )}
        </div>
      ) : null}

      {/* What came back from a delete: how many went, how many could not. */}
      {deleteState.error ?? deleteState.message ? (
        <div
          role="status"
          className={cn(
            "border-b px-3 py-2 text-body-sm",
            deleteState.error
              ? "border-critical/40 bg-critical-tint text-critical"
              : "border-rule bg-surface-mute text-ink",
          )}
        >
          <p>{deleteState.error ?? deleteState.message}</p>
          {deleteState.kept && deleteState.kept.length > 0 ? (
            <ul className="mt-1 space-y-0.5">
              {deleteState.kept.map((k) => (
                <li key={k.id} className="text-ink-muted">
                  <span className="text-ink">{k.text}</span> — {k.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto bg-surface">
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No questions match those filters"
              body="Widen the filters, or add a question to get started."
            />
          </div>
        ) : (
          <table
            // The table is exactly as wide as its columns, and `min-w-full`
            // only ever stretches the trailing filler. That distinction is what
            // keeps a dragged width honest: were the sized columns allowed to
            // absorb the slack, the rendered width would stop matching
            // getSize() and the frozen pane's offset would drift with it.
            style={{ width: table.getTotalSize() }}
            className={cn(
              "min-w-full table-fixed border-separate border-spacing-0",
              // A drag that selects the header text underneath it looks broken.
              resizingColumnId && "select-none",
            )}
          >
            <colgroup>
              {table.getAllLeafColumns().map((column) => (
                <col key={column.id} style={{ width: column.getSize() }} />
              ))}
              <col />
            </colgroup>

            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const layout = layoutFor(header.column.id);
                    return (
                      <th
                        key={header.id}
                        scope="col"
                        // border-separate, not border-collapse: a collapsed
                        // border belongs to the table rather than the cell, so
                        // it does not travel with a sticky header or a frozen
                        // column — the grid loses its lines exactly when it is
                        // scrolled, which is when they matter most.
                        //
                        // No `relative` needed for the handle: `sticky` is a
                        // positioned value, so the header is already the
                        // containing block.
                        className={cn(
                          "sticky top-0 z-20 h-9 border-b border-r border-rule bg-surface-mute px-3 text-left align-middle",
                          layout.align && ALIGN_CLASS[layout.align],
                          layout.frozen && cn("lg:z-30", FROZEN_OFFSET[header.column.id]),
                        )}
                      >
                        {/* Semibold and primary ink: a header that is lighter
                            than the rows under it stops reading as a header. */}
                        <span className="type-label block truncate font-semibold text-ink">
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
                              // The grab target is 8px wide; the line it paints
                              // is 2px. A handle you can hit is not the same
                              // thing as a handle you can see.
                              "after:absolute after:inset-y-0 after:right-0 after:w-0.5 after:bg-transparent",
                              "hover:after:bg-accent-primary focus-visible:after:bg-accent-primary",
                              resizingColumnId === header.column.id && "after:bg-accent-primary",
                            )}
                          />
                        ) : null}
                      </th>
                    );
                  })}
                  {/* The filler. It takes every spare pixel so the sized columns
                      never have to, and it carries the header's ground out to
                      the right edge. */}
                  <th aria-hidden className="sticky top-0 z-20 border-b border-rule bg-surface-mute" />
                </tr>
              ))}
            </thead>

            <tbody>
              {table.getRowModel().rows.map((row) => (
                // §4: 44px rows, compact density on an HR table.
                <tr
                  key={row.id}
                  /* -- OPENING A ROW OPENS THE QUESTION.
                        Every grid in the product opens its row now, and this
                        table is hand-rolled rather than a `DataGrid`, so it
                        needs wiring by hand. Its details view already exists
                        and is better than a generic dialog: the drawer shows
                        the question with its options, its condition and a live
                        preview, which is what somebody clicking a row wants.

                        Suppressed in delete mode — there the row's job is to be
                        ticked, and opening a drawer over a selection somebody
                        is building would lose it. -- */
                  className={cn("group h-11", !deleteMode && "cursor-pointer")}
                  onClick={
                    deleteMode
                      ? undefined
                      : (event) => {
                          // A click on a control inside the row belongs to that
                          // control, not to the row behind it.
                          if (
                            (event.target as HTMLElement).closest(
                              "button, a, input, select, textarea, [role='menuitem']",
                            )
                          ) {
                            return;
                          }
                          setEditing(row.original);
                          setDrawerOpen(true);
                        }
                  }
                >
                  {row.getVisibleCells().map((cell) => {
                    const layout = layoutFor(cell.column.id);
                    return (
                      <td
                        key={cell.id}
                        className={cn(
                          "h-11 border-b border-r border-rule bg-surface px-3 align-middle",
                          // The frozen cells carry their own ground, so the row
                          // highlight has to be driven from the row itself.
                          "group-hover:bg-surface-mute",
                          layout.align && ALIGN_CLASS[layout.align],
                          layout.frozen && cn("lg:sticky lg:z-10", FROZEN_OFFSET[cell.column.id]),
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                  {/* Same filler, so the row rules run to the right edge rather
                      than stopping at a ragged column boundary. */}
                  <td aria-hidden className="border-b border-rule bg-surface group-hover:bg-surface-mute" />
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* A spreadsheet's status bar: what is on screen against what exists. */}
      <div className="flex items-center gap-3 border-t border-rule bg-surface-mute px-3 py-1.5">
        <span className="tabular text-body-sm text-ink">
          {rows.length} of {questions.length} questions
        </span>

        {/* §13.4: dragging a column to 64px must not be a one-way door. */}
        {Object.keys(columnSizing).length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto px-2 text-ink-faint"
            onClick={() => {
              setColumnSizing({});
              writeStoredWidths({});
            }}
          >
            Reset column widths
          </Button>
        ) : null}
      </div>

      <QuestionDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        question={editing}
        parentCandidates={parentCandidates}
        departments={departments}
        onSaved={() => setEditing(null)}
      />

      {/* §P8.7: deactivating a mapped question shows which departments are
          affected before it is confirmed. */}
      <Dialog open={Boolean(retiring)} onOpenChange={(open) => !open && setRetiring(null)}>
        <DialogContent className="border-rule bg-surface">
          <DialogHeader>
            <DialogTitle className="font-sans text-display-md">
              Deactivate this question?
            </DialogTitle>
            <DialogDescription className="font-sans text-body text-ink-muted">
              It will stop appearing on new forms. Evaluations already launched keep it, and past
              answers are untouched.
            </DialogDescription>
          </DialogHeader>

          {retiring ? (
            <div className="space-y-3">
              <p className="font-sans text-body-lg text-ink">{retiring.text}</p>
              {retiringDepartments.length > 0 ? (
                <div className="space-y-1 rounded-control border border-warning/40 bg-warning-tint p-3">
                  <p className="type-label text-warning">
                    Asked of {retiringDepartments.length}{" "}
                    {retiringDepartments.length === 1 ? "department" : "departments"}
                  </p>
                  <p className="font-sans text-body-sm text-ink-muted">
                    {retiringDepartments.join(", ")}
                  </p>
                </div>
              ) : (
                <p className="font-sans text-body-sm text-ink-faint">
                  It is not mapped to any department.
                </p>
              )}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="ghost" className="min-h-11" onClick={() => setRetiring(null)}>
              Keep it
            </Button>
            <form action={activeAction} onSubmit={() => setRetiring(null)}>
              <input type="hidden" name="id" value={retiring?.id ?? ""} />
              <input type="hidden" name="is_active" value="false" />
              <Button type="submit" variant="destructive" className="min-h-11">
                Deactivate question
              </Button>
            </form>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <QuestionImportDialog open={importOpen} onOpenChange={setImportOpen} />

      {/* ---------- Delete confirmation ---------- */}
      {/*
        The one irreversible action on this screen, so it states the rule BEFORE
        the click rather than reporting it afterwards. The rule cannot be
        evaluated here — whether a question sits in somebody's frozen form is a
        server question — so the dialog explains what will happen to each kind
        and the result strip names exactly which were kept (§13.4).
      */}
      <Dialog open={Boolean(confirming)} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent className="border-rule bg-surface">
          <DialogHeader>
            <DialogTitle className="font-sans text-display-md">
              {confirming?.length === 1
                ? "Delete this question?"
                : `Delete ${confirming?.length ?? 0} questions?`}
            </DialogTitle>
            <DialogDescription className="font-sans text-body text-ink-muted">
              Questions that have never been asked of anybody are deleted outright. Any that have
              already gone out in an evaluation are kept and taken off future forms instead.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-control border-l-2 border-l-warning bg-warning-tint/40 py-3 pl-4 pr-4 text-body-sm text-ink">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>
                A question that somebody has answered can never be destroyed — the answers are
                filed against it, and every launched evaluation keeps its own frozen copy. That is
                what keeps last year&apos;s appraisals readable.
              </span>
            </div>

            {confirming && confirming.length > 0 ? (
              <ul className="max-h-48 space-y-1 overflow-y-auto rounded-control bg-surface-mute p-3 text-body-sm text-ink">
                {confirming.slice(0, 12).map((q) => (
                  <li key={q.id} className="truncate">
                    {q.text}
                  </li>
                ))}
                {confirming.length > 12 ? (
                  <li className="text-ink-muted">and {confirming.length - 12} more</li>
                ) : null}
              </ul>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="ghost" className="min-h-11" onClick={() => setConfirming(null)}>
              Keep them
            </Button>
            <form
              action={deleteAction}
              onSubmit={() => {
                // Closed optimistically, like the retire dialog above: the
                // outcome lands in the strip under the toolbar, which is where
                // it can actually be read and re-read.
                setConfirming(null);
                exitDeleteMode();
              }}
            >
              <input
                type="hidden"
                name="ids"
                value={JSON.stringify((confirming ?? []).map((q) => q.id))}
              />
              <Button type="submit" variant="destructive" className="min-h-11">
                {confirming?.length === 1 ? "Delete question" : `Delete ${confirming?.length ?? 0}`}
              </Button>
            </form>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function swap(ids: string[], from: number, to: number): string[] {
  if (from < 0 || to < 0 || from >= ids.length || to >= ids.length) return ids;
  const next = [...ids];
  const a = next[from];
  const b = next[to];
  if (a === undefined || b === undefined) return ids;
  next[from] = b;
  next[to] = a;
  return next;
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  includeAny = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  includeAny?: boolean;
}) {
  return (
    // Label beside the control rather than above it: it halves the toolbar's
    // height, and the height it gives back goes to the grid.
    <div className="flex items-center gap-1.5">
      <span className="type-label whitespace-nowrap text-ink-muted">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          aria-label={label}
          className="min-h-11 w-[132px] border-rule bg-surface font-sans text-body-sm"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {includeAny ? <SelectItem value={ANY}>All</SelectItem> : null}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// Re-exported so the page can reuse the same shape.
export { RESPONSE_TYPES, ANSWERED_BY };
