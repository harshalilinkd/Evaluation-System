/** Pane 1 — the form's shape: sections, their questions, add / remove / reorder. */

"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ChevronRight,
  Clock,
  GripVertical,
  Lock,
  Plus,
  Search,
  Settings2,
  Trash2,
  UserCog,
  Users,
  X,
} from "lucide-react";

import type { BuilderQuestion } from "@/app/(app)/admin/form-builder/use-builder";
import { DEPARTMENT_SECTION, SECTION_LABELS, SECTION_ORDER } from "@/lib/forms/labels";
import type { QuestionSection } from "@/lib/forms/types";
import type { FillEstimate } from "@/lib/questions/estimate";
import { SectionsDialog, type SectionRow } from "@/app/(app)/admin/form-builder/sections-dialog";
import { cn } from "@/lib/utils";

/** The plain-language tag on a row. Never the enum (P9B: no `SCALE_0_5` on screen). */
const TYPE_TAG: Record<string, string> = {
  SCALE_0_5: "Rating",
  TICK_3: "Tick 3",
  BOOLEAN: "Yes / No",
  NUMBER: "Number",
  TEXT_LONG: "Long text",
  TEXT_SHORT: "Short text",
  SINGLE_SELECT: "Pick one",
  MULTI_SELECT: "Pick many",
  DATE: "Date",
};

/**
 * Who fills a question in.
 *
 * Only shown when it is NOT the default. Most questions are answered by both
 * sides, so tagging every one of them would put a badge on thirty rows and
 * teach people to stop reading badges.
 */
const WHO_TAG: Record<string, { short: string; title: string } | undefined> = {
  EMPLOYEE_ONLY: { short: "Employee", title: "Only the employee answers this" },
  LEAD_ONLY: { short: "Lead", title: "Only the lead answers this" },
};

export function StructurePane({
  draft,
  mappedIds,
  departments,
  departmentId,
  onDepartmentChange,
  selectedId,
  onSelect,
  openSection,
  onOpenSectionChange,
  onAdd,
  onRemove,
  onReorder,
  estimate,
  headcount,
  sections,
}: {
  /** Names and order as HR has them (0036). Falls back to the shipped list. */
  sections?: SectionRow[];
  draft: BuilderQuestion[];
  mappedIds: ReadonlySet<string>;
  departments: Array<{ id: string; name: string; code: string }>;
  departmentId: string;
  onDepartmentChange: (id: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Lifted to the builder: the preview scrolls to whichever section is open. */
  openSection: QuestionSection | null;
  onOpenSectionChange: (section: QuestionSection | null) => void;
  onAdd: (section: QuestionSection) => void;
  onRemove: (id: string) => void;
  onReorder: (section: QuestionSection, orderedIds: string[]) => void;
  estimate: FillEstimate;
  headcount: Record<string, number>;
}) {
  const [sectionsOpen, setSectionsOpen] = React.useState(false);

  /* -- HR's names and order if they have been loaded, the shipped ones if not.
        Falling back rather than waiting keeps the builder rendering before
        0036 is applied, and a section with no name is a blank heading. -- */
  const rows: SectionRow[] = React.useMemo(
    () =>
      sections && sections.length > 0
        ? sections
        : SECTION_ORDER.map((section) => ({
            section,
            label: SECTION_LABELS[section],
            isActive: true,
            // `draft` only ever holds live questions — the builder never loads
            // retired ones — so this is already the count HR cares about.
            questionCount: draft.filter((q) => q.section === section).length,
          })),
    [sections, draft],
  );

  const order = React.useMemo(() => rows.filter((r) => r.isActive).map((r) => r.section), [rows]);
  const labelFor = React.useCallback(
    (section: QuestionSection) =>
      rows.find((r) => r.section === section)?.label ?? SECTION_LABELS[section],
    [rows],
  );

  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overId, setOverId] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const reduced = useReducedMotion();

  const searching = query.trim().length > 0;
  const needle = query.trim().toLowerCase();

  /* -- The section's REAL contents, in form order.
        Deliberately unfiltered: reordering computes positions from this list,
        so handing it a filtered one would move a question to the index it held
        among the matches rather than among its actual neighbours. Search is a
        view; the order is the form. -- */
  const rowsIn = React.useCallback(
    (section: QuestionSection) =>
      draft
        .filter((q) => q.section === section)
        .filter((q) => (section === DEPARTMENT_SECTION ? mappedIds.has(q.id) : true))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [draft, mappedIds],
  );

  /** What the list draws. Identical to `rowsIn` unless somebody is searching. */
  const visibleIn = React.useCallback(
    (section: QuestionSection) =>
      searching
        ? rowsIn(section).filter(
            (q) =>
              q.text.toLowerCase().includes(needle) ||
              (q.helpText ?? "").toLowerCase().includes(needle),
          )
        : rowsIn(section),
    [rowsIn, searching, needle],
  );

  const matchCount = React.useMemo(
    () => (searching ? order.reduce((n, s) => n + visibleIn(s).length, 0) : 0),
    [searching, order, visibleIn],
  );

  /** Drops the dragged row where the pointer left it. */
  function handleDrop(section: QuestionSection, targetId: string) {
    if (!dragId || dragId === targetId) return;
    const ids = rowsIn(section).map((q) => q.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    onReorder(section, next);
  }

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-card-lg bg-ink">
      <header className="shrink-0 space-y-2.5 px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-body font-semibold text-ink-invert">Form structure</h2>
          {/* The way in to renaming and reordering. Beside the heading it
              describes, rather than in a settings menu two screens away —
              this is where somebody is looking when they decide a section is
              called the wrong thing. */}
          <button
            type="button"
            onClick={() => setSectionsOpen(true)}
            className="min-h-11 rounded-control px-2 py-1 text-body-sm font-medium text-ink-invert underline underline-offset-2 hover:text-ink-invert sm:min-h-0"
          >
            Edit sections
          </button>
        </div>
        <p className="text-body-sm leading-snug text-ink-invert/80">
          Every employee answers the same form. Only {labelFor(DEPARTMENT_SECTION)} changes
          by department.
        </p>

        {/* -- Find a question.
              The bank runs to hundreds of rows across eight sections, so
              "where is the one about wastage" was a scroll through all of
              them with the sections opened one at a time. Typing opens every
              section that matches and hides the rest, which is the difference
              between a list and something you can navigate. -- */}
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-invert/60"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a question…"
            aria-label="Find a question"
            className="h-11 w-full rounded-control bg-black/30 pl-8 pr-8 text-body-sm text-ink-invert placeholder:text-ink-invert/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear the search"
              className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-control text-ink-invert/70 hover:bg-white/10 hover:text-ink-invert"
            >
              <X aria-hidden className="size-4" />
            </button>
          ) : null}
        </div>

        {searching ? (
          <p aria-live="polite" className="text-body-sm text-ink-invert/80">
            {matchCount === 0
              ? "Nothing matches that."
              : `${matchCount} ${matchCount === 1 ? "question" : "questions"} match`}
          </p>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2.5 pb-2">
        {/* Section EXISTENCE is not editable — the enum is fixed (§0.2) and the
            renderer depends on it. There is deliberately no way to add or
            remove one; only order and contents move. */}
        {order.map((section, i) => {
          const isDept = section === DEPARTMENT_SECTION;
          const allRows = rowsIn(section);
          const rows = visibleIn(section);
          // METADATA comes from the profile and the evaluation record, never
          // authored — an editable field here would let somebody type a name
          // that disagrees with the record it was drawn from (P12-14).
          const isAuto = section === "METADATA";

          // A search drops sections with no hit and opens the ones that have
          // them. A collapsed section holding the answer is the same as no
          // answer, and leaving the empties in place buries the matches.
          if (searching && (isAuto || rows.length === 0)) return null;
          const isOpen = searching ? true : openSection === section;
          const isEmpty = !isAuto && allRows.length === 0;

          return (
            <section
              key={section}
              className={cn(
                "overflow-hidden rounded-card transition-colors",
                // A darker well rather than a lighter one: an open section used
                // to lift AWAY from the panel, which washed the whole pane out.
                // Recessing it keeps the ground dark and the type on top of it.
                isOpen ? "bg-black/25" : "bg-transparent",
              )}
            >
              <button
                type="button"
                onClick={() => onOpenSectionChange(isOpen ? null : section)}
                aria-expanded={isOpen}
                className={cn(
                  "group flex min-h-11 w-full items-center gap-2.5 px-2.5 py-2.5 text-left transition-colors",
                  isOpen ? "text-ink-invert" : "text-ink-invert/85 hover:bg-white/[0.06]",
                )}
              >
                <span
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-[8px] text-[11px] font-bold transition-colors",
                    isOpen
                      ? "bg-ink-invert text-ink"
                      : isDept
                        ? "bg-gradient-to-br from-primary to-accent-cyan text-white"
                        : "bg-white/10 text-ink-invert/70",
                  )}
                >
                  {i + 1}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-body-sm font-medium">
                      {labelFor(section)}
                    </span>
                    {isDept ? (
                      <span className="shrink-0 rounded-pill bg-primary px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
                        By team
                      </span>
                    ) : null}
                  </span>
                  {/* The count in words, not a bare numeral. An "8" beside a
                      section name reads as an index as easily as a total. */}
                  <span className="mt-0.5 block truncate text-body-sm text-ink-invert/70">
                    {isAuto
                      ? "Filled in from the person's record"
                      : isEmpty
                        ? "No questions yet"
                        : searching
                          ? `${rows.length} of ${allRows.length} match`
                          : `${allRows.length} ${allRows.length === 1 ? "question" : "questions"}`}
                  </span>
                </span>

                {isAuto ? (
                  <Lock aria-hidden className="size-4 shrink-0 text-ink-invert/60" />
                ) : (
                  <motion.span
                    animate={{ rotate: isOpen ? 90 : 0 }}
                    transition={
                      reduced ? { duration: 0 } : { type: "spring", stiffness: 400, damping: 30 }
                    }
                    className="shrink-0"
                  >
                    <ChevronRight aria-hidden className="size-4 text-ink-invert/70" />
                  </motion.span>
                )}
              </button>

              <AnimatePresence initial={false}>
                {isOpen && !isAuto ? (
                  <motion.div
                    initial={reduced ? false : { height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={reduced ? undefined : { height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-0.5 px-2 pb-2">
                      {isDept ? (
                        <DepartmentPicker
                          departments={departments}
                          value={departmentId}
                          onChange={onDepartmentChange}
                          headcount={headcount}
                        />
                      ) : null}

                      {isEmpty ? (
                        <p className="rounded-control bg-white/[0.06] px-2.5 py-2.5 text-body-sm leading-snug text-ink-invert/80">
                          {isDept
                            ? "This team has no questions of its own yet. It cannot be launched until it has at least one."
                            : "Nothing here yet. Add the first question below."}
                        </p>
                      ) : null}

                      <AnimatePresence initial={false}>
                        {rows.map((q, index) => {
                          const who = WHO_TAG[q.answeredBy];
                          const isSelected = selectedId === q.id;
                          return (
                            <motion.div
                              key={q.id}
                              layout={!reduced}
                              initial={reduced ? false : { opacity: 0, x: -8 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={reduced ? undefined : { opacity: 0, height: 0, marginBottom: 0 }}
                              transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
                              // Reordering a filtered list would move a row to
                              // its position among the MATCHES, not among its
                              // neighbours. Off while searching.
                              draggable={!searching}
                              onDragStart={() => setDragId(q.id)}
                              onDragEnd={() => {
                                setDragId(null);
                                setOverId(null);
                              }}
                              onDragOver={(e) => {
                                e.preventDefault();
                                setOverId(q.id);
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                handleDrop(section, q.id);
                                setDragId(null);
                                setOverId(null);
                              }}
                              className={cn(
                                "group/row relative flex items-start gap-1.5 rounded-control transition-colors",
                                dragId === q.id && "opacity-40",
                                overId === q.id && dragId && dragId !== q.id && "ring-1 ring-primary",
                                isSelected ? "bg-primary/25" : "hover:bg-white/[0.07]",
                              )}
                            >
                              {/* A bar rather than only a fill, so the selected
                                  row stays findable down a list of thirty. */}
                              {isSelected ? (
                                <motion.span
                                  layoutId="structure-selected"
                                  aria-hidden
                                  className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-white"
                                />
                              ) : null}

                              {/* Drag is a pointer affordance, so it hides on a
                                  touch screen where it cannot be used and the
                                  space is better spent on the question. */}
                              <span
                                aria-hidden
                                className="hidden cursor-grab pl-2 pt-2.5 text-ink-invert/60 opacity-0 transition-opacity active:cursor-grabbing group-hover/row:opacity-100 lg:block"
                              >
                                <GripVertical className="size-4" />
                              </span>

                              <button
                                type="button"
                                onClick={() => onSelect(q.id)}
                                aria-current={isSelected ? "true" : undefined}
                                className={cn(
                                  "min-w-0 flex-1 py-2 pl-2 pr-1 text-left lg:pl-0",
                                  isSelected
                                    ? "text-ink-invert"
                                    : "text-ink-invert/85 group-hover/row:text-ink-invert",
                                )}
                              >
                                <span className="flex items-baseline gap-1.5">
                                  <span className="tabular shrink-0 text-[11px] text-ink-invert/55">
                                    {index + 1}
                                  </span>
                                  {/* Two lines, not one truncated one. A
                                      question truncated at four words is not
                                      identifiable, which is the whole job of
                                      this list. */}
                                  <span className="line-clamp-2 text-body-sm leading-snug">
                                    {q.text}
                                  </span>
                                </span>
                                <span className="mt-1 flex flex-wrap items-center gap-1">
                                  <Tag>{TYPE_TAG[q.responseType] ?? "Text"}</Tag>
                                  {who ? <Tag title={who.title}>{who.short}</Tag> : null}
                                  {q.dependsOn ? (
                                    <Tag title="Only shown when an earlier answer matches">If…</Tag>
                                  ) : null}
                                  {!q.isRequired ? <Tag>Optional</Tag> : null}
                                </span>
                              </button>

                              <button
                                type="button"
                                onClick={() => onRemove(q.id)}
                                aria-label={`Remove "${q.text}"`}
                                title="Remove from the form"
                                // Always reachable on a touch screen: there is
                                // no hover there, and a control that only
                                // appears on hover simply does not exist.
                                className="mr-1 mt-1.5 grid size-9 shrink-0 place-items-center rounded-control text-ink-invert/55 transition-all hover:bg-critical/25 hover:text-critical focus-visible:opacity-100 lg:size-8 lg:opacity-0 lg:group-hover/row:opacity-100"
                              >
                                <Trash2 aria-hidden className="size-4" />
                              </button>
                            </motion.div>
                          );
                        })}
                      </AnimatePresence>

                      {/* Adding while a search is narrowing the list would drop
                          the new question straight out of view. */}
                      {searching ? null : (
                        <button
                          type="button"
                          onClick={() => onAdd(section)}
                          className="mt-1 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-control border border-dashed border-white/30 py-2 text-body-sm font-medium text-ink-invert/80 transition-colors hover:border-white/50 hover:bg-white/[0.06] hover:text-ink-invert"
                        >
                          <Plus aria-hidden className="size-4" />
                          Add question
                        </button>
                      )}
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </section>
          );
        })}
      </div>

      {/* ---------- The cost of the form ---------- */}
      <motion.footer
        layout={!reduced}
        className={cn(
          "m-2.5 shrink-0 rounded-card p-3.5 transition-colors",
          estimate.tooLong ? "bg-critical/25" : "bg-black/25",
        )}
      >
        <div className="grid grid-cols-2 gap-2">
          <Stat icon={Users} label="Employee answers" value={estimate.employeeQuestions} />
          <Stat icon={UserCog} label="Lead answers" value={estimate.leadQuestions} />
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-white/20 pt-2">
          <span className="flex items-center gap-1.5 text-body-sm text-ink-invert/80">
            <Clock aria-hidden className="size-4" />
            Est. time to fill
          </span>
          <motion.span
            key={estimate.employeeMinutes}
            initial={reduced ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="tabular text-body font-semibold text-ink-invert"
          >
            {estimate.employeeMinutes} min
          </motion.span>
        </div>
        {estimate.tooLong ? (
          <p className="mt-2 text-body-sm font-medium leading-snug text-critical">
            This is a long form. People rush the end of a long form.
          </p>
        ) : null}
      </motion.footer>

      <SectionsDialog open={sectionsOpen} onOpenChange={setSectionsOpen} sections={rows} />
    </aside>
  );
}

/* ---------- Small parts ---------- */

function Tag({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="rounded-[5px] bg-white/20 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-ink-invert/90"
    >
      {children}
    </span>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 text-body-sm text-ink-invert/80">
        <Icon aria-hidden className="size-3.5 shrink-0" />
        {label}
      </div>
      <div className="tabular text-body-lg font-semibold text-ink-invert">{value}</div>
    </div>
  );
}

function DepartmentPicker({
  departments,
  value,
  onChange,
  headcount,
}: {
  departments: Array<{ id: string; name: string; code: string }>;
  value: string;
  onChange: (id: string) => void;
  headcount: Record<string, number>;
}) {
  const people = headcount[value] ?? 0;
  return (
    <div className="mb-1.5 rounded-control bg-white/[0.08] p-2">
      <label
        htmlFor="builder-department"
        className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-invert/75"
      >
        Showing
      </label>
      <select
        id="builder-department"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-control border border-white/25 bg-white/10 px-2 text-body-sm text-ink-invert"
      >
        {departments.map((d) => (
          <option key={d.id} value={d.id} className="text-ink">
            {d.name}
          </option>
        ))}
      </select>
      <p className="mt-1.5 flex items-center gap-1 text-body-sm text-ink-invert/75">
        <Users aria-hidden className="size-3.5 shrink-0" />
        {people === 0
          ? "Nobody is in this team right now"
          : `${people} ${people === 1 ? "person is" : "people are"} in this team`}
      </p>
      {/* The teams themselves are data, not code. Linked from here because this
          picker is where somebody first notices a team is missing, wrongly named
          or no longer run — and hunting the admin menu at that moment is how a
          stale department survives another cycle. */}
      <Link
        href="/admin/settings?tab=departments"
        className="mt-1 flex min-h-11 items-center gap-1 text-body-sm font-medium text-ink-invert/80 underline-offset-2 transition-colors hover:text-ink-invert hover:underline sm:min-h-0"
      >
        <Settings2 aria-hidden className="size-3.5 shrink-0" />
        Add, rename or retire a team
      </Link>
    </div>
  );
}
