/** Pane 2 — the question being edited. Plain language only; no enum reaches the screen. */

"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { GripVertical, Plus, Trash2 } from "lucide-react";

import type { BuilderOption, BuilderQuestion } from "@/app/(app)/admin/form-builder/use-builder";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DEPARTMENT_SECTION, SECTION_LABELS } from "@/lib/forms/labels";
import type { ResponseType } from "@/lib/forms/types";
import { cn } from "@/lib/utils";

/**
 * The answer types, in plain language.
 *
 * P9B: "No enum value, table name or JSON appears anywhere in the interface."
 * HR is not a developer, and `SCALE_0_5` on screen is a question they cannot
 * answer. The enum is never renamed (§0.2) — only ever displayed through this.
 */
const TYPE_CARDS: ReadonlyArray<{ value: ResponseType; name: string; hint: string }> = [
  { value: "SCALE_0_5", name: "Rating 0–5", hint: "Very dissatisfied to Outstanding" },
  { value: "TICK_3", name: "Tick 3", hint: "Excellent / Satisfactory / Needs improvement" },
  { value: "BOOLEAN", name: "Yes / No", hint: "Can reveal a follow-up" },
  { value: "NUMBER", name: "Number", hint: "Days, meters, jobs" },
  { value: "TEXT_LONG", name: "Long text", hint: "Up to 1000 characters" },
  { value: "SINGLE_SELECT", name: "Pick one", hint: "From a list you write" },
];

const WHO = [
  { value: "EMPLOYEE_AND_LEAD", label: "Both" },
  { value: "EMPLOYEE_ONLY", label: "Employee" },
  { value: "LEAD_ONLY", label: "Lead" },
] as const;

export function EditorPane({
  question,
  options,
  allQuestions,
  departments,
  mappedDepartmentIds,
  onPatch,
  onRemove,
  onOptionsChange,
  onDepartmentsChange,
}: {
  question: BuilderQuestion | null;
  options: BuilderOption[];
  allQuestions: BuilderQuestion[];
  departments: Array<{ id: string; name: string; code: string }>;
  mappedDepartmentIds: string[];
  onPatch: (changes: Partial<BuilderQuestion>) => void;
  onRemove: () => void;
  onOptionsChange: (next: Array<{ label: string; value: string }>) => void;
  onDepartmentsChange: (ids: string[]) => void;
}) {
  const reduced = useReducedMotion();

  if (!question) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-card-lg bg-surface p-8">
        <p className="max-w-[24ch] text-center text-body-sm leading-relaxed text-ink-muted">
          Pick a question on the left to edit it, or add a new one.
        </p>
      </div>
    );
  }

  const isDept = question.section === DEPARTMENT_SECTION;
  const isSelect = question.responseType === "SINGLE_SELECT";
  const mine = options.filter((o) => o.questionId === question.id);

  /* -- Only a Yes/No question above this one can act as a parent. A cycle would
        hang the renderer, and 0002's CHECK refuses a self-dependency. -- */
  const parents = allQuestions.filter(
    (q) =>
      q.id !== question.id &&
      q.responseType === "BOOLEAN" &&
      q.section === question.section &&
      q.sortOrder < question.sortOrder,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card-lg bg-surface">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-body font-semibold text-ink">Edit question</h2>
          <p className="mt-0.5 truncate text-[11px] text-ink-muted">
            {SECTION_LABELS[question.section]}
          </p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="flex shrink-0 items-center gap-1.5 rounded-control px-2.5 py-1.5 text-body-sm font-medium text-critical transition-colors hover:bg-critical-tint"
        >
          <Trash2 aria-hidden className="size-3.5" />
          Remove
        </button>
      </header>

      {/* The whole editor remounts on question.id, so switching questions gives
          correct initial state with no effect syncing props into state — the
          cascading-render pattern the React compiler rejects (P8-9, P10-11). */}
      <div key={question.id} className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        <Field label="Question">
          <Input
            value={question.text}
            onChange={(e) => onPatch({ text: e.target.value })}
            placeholder="Write it the way a supervisor would say it on the floor"
          />
        </Field>

        <Field label="Helper text shown below it" hint="Optional. One line of plain guidance.">
          <Textarea
            rows={2}
            value={question.helpText ?? ""}
            onChange={(e) => onPatch({ helpText: e.target.value || null })}
          />
        </Field>

        {/* ---------- Answer type ---------- */}
        <div>
          <Label className="mb-2 block text-body-sm font-medium text-ink">How is it answered?</Label>
          <div className="grid grid-cols-2 gap-2">
            {TYPE_CARDS.map((card) => {
              const active = question.responseType === card.value;
              return (
                <motion.button
                  key={card.value}
                  type="button"
                  onClick={() => onPatch({ responseType: card.value })}
                  whileHover={reduced ? undefined : { y: -2 }}
                  whileTap={reduced ? undefined : { scale: 0.98 }}
                  transition={{ type: "spring", stiffness: 500, damping: 32 }}
                  aria-pressed={active}
                  className={cn(
                    "rounded-control border p-3 text-left transition-colors",
                    active
                      ? "border-primary bg-primary/[0.07]"
                      : "border-border bg-canvas hover:border-primary/40",
                  )}
                >
                  <span
                    className={cn(
                      "block text-body-sm font-semibold",
                      active ? "text-primary" : "text-ink",
                    )}
                  >
                    {card.name}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-ink-muted">
                    {card.hint}
                  </span>
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* ---------- Options, for Pick one ---------- */}
        <AnimatePresence initial={false}>
          {isSelect ? (
            <motion.div
              initial={reduced ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={reduced ? undefined : { opacity: 0, height: 0 }}
              transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
              className="overflow-hidden"
            >
              <OptionEditor
                options={mine.map((o) => ({ label: o.label, value: o.value }))}
                onChange={onOptionsChange}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* ---------- Who answers ---------- */}
        <div>
          <Label className="mb-2 block text-body-sm font-medium text-ink">Who answers this?</Label>
          <div className="grid grid-cols-3 gap-1.5">
            {WHO.map((w) => {
              const active = question.answeredBy === w.value;
              return (
                <button
                  key={w.value}
                  type="button"
                  onClick={() => onPatch({ answeredBy: w.value })}
                  aria-pressed={active}
                  className={cn(
                    "rounded-control border py-2.5 text-body-sm font-medium transition-colors",
                    active
                      ? "border-ink bg-ink text-ink-invert"
                      : "border-border bg-canvas text-ink hover:border-ink/30",
                  )}
                >
                  {w.label}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-ink-muted">
            Both means the employee rates themselves and the lead rates them, side by side.
          </p>
        </div>

        {/* ---------- Departments, for Job Specific Skills ---------- */}
        {isDept ? (
          <div>
            <Label className="mb-2 block text-body-sm font-medium text-ink">
              Which teams are asked this?
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {departments.map((d) => {
                const on = mappedDepartmentIds.includes(d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() =>
                      onDepartmentsChange(
                        on
                          ? mappedDepartmentIds.filter((id) => id !== d.id)
                          : [...mappedDepartmentIds, d.id],
                      )
                    }
                    aria-pressed={on}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-body-sm font-medium transition-colors",
                      on
                        ? "border-primary bg-primary text-white"
                        : "border-border bg-canvas text-ink-muted hover:border-primary/40 hover:text-ink",
                    )}
                  >
                    {d.name}
                  </button>
                );
              })}
            </div>
            {mappedDepartmentIds.length === 0 ? (
              <p className="mt-1.5 text-[11px] font-medium text-critical">
                A question here with no team is asked of nobody. Pick at least one.
              </p>
            ) : null}
          </div>
        ) : null}

        {/* ---------- Conditional ---------- */}
        <div className="rounded-control border border-border bg-canvas p-3.5">
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={question.dependsOn !== null}
              onChange={(e) =>
                onPatch(
                  e.target.checked
                    ? { dependsOn: parents[0]?.id ?? null, dependsValue: "true" }
                    : { dependsOn: null, dependsValue: null },
                )
              }
              disabled={parents.length === 0}
              className="mt-0.5 size-4 shrink-0 accent-primary"
            />
            <span>
              <span className="block text-body-sm font-medium text-ink">Only show sometimes</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-ink-muted">
                {parents.length === 0
                  ? "Needs a Yes / No question above this one in the same section."
                  : "Show this only when an earlier Yes / No was answered a certain way."}
              </span>
            </span>
          </label>

          <AnimatePresence initial={false}>
            {question.dependsOn !== null ? (
              <motion.div
                initial={reduced ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={reduced ? undefined : { opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-3 space-y-2 border-t border-border pt-3">
                  <select
                    value={question.dependsOn}
                    onChange={(e) => onPatch({ dependsOn: e.target.value })}
                    aria-label="Question this depends on"
                    className="h-9 w-full rounded-control border border-border bg-surface px-2 text-body-sm text-ink"
                  >
                    {parents.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.text}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-1.5">
                    {(["true", "false"] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => onPatch({ dependsValue: v })}
                        aria-pressed={question.dependsValue === v}
                        className={cn(
                          "flex-1 rounded-control border py-2 text-body-sm font-medium transition-colors",
                          question.dependsValue === v
                            ? "border-primary bg-primary text-white"
                            : "border-border bg-surface text-ink hover:border-primary/40",
                        )}
                      >
                        {v === "true" ? "Yes" : "No"}
                      </button>
                    ))}
                  </div>
                  {/* The rule read back as a sentence, so HR can check it
                      without reconstructing it from two controls. */}
                  <p className="rounded-control bg-primary/[0.07] px-2.5 py-2 text-[11px] leading-snug text-ink">
                    Shown only when{" "}
                    <strong className="font-semibold">
                      “{parents.find((p) => p.id === question.dependsOn)?.text ?? "…"}”
                    </strong>{" "}
                    is answered{" "}
                    <strong className="font-semibold">
                      {question.dependsValue === "false" ? "No" : "Yes"}
                    </strong>
                    .
                  </p>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        {/* ---------- Required ---------- */}
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-control border border-border bg-canvas p-3.5">
          <span>
            <span className="block text-body-sm font-medium text-ink">Must be answered</span>
            <span className="mt-0.5 block text-[11px] text-ink-muted">
              Blocks submit until filled
            </span>
          </span>
          <span className="relative inline-flex shrink-0">
            <input
              type="checkbox"
              checked={question.isRequired}
              onChange={(e) => onPatch({ isRequired: e.target.checked })}
              className="peer sr-only"
            />
            <span className="h-6 w-11 rounded-full bg-border transition-colors peer-checked:bg-success peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2" />
            <span className="pointer-events-none absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
          </span>
        </label>
      </div>
    </div>
  );
}

/* ---------- Small parts ---------- */

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="mb-1.5 block text-body-sm font-medium text-ink">{label}</Label>
      {children}
      {hint ? <p className="mt-1 text-[11px] text-ink-muted">{hint}</p> : null}
    </div>
  );
}

/** Inline option editor for Pick one. Reorder by drag, remove by button. */
function OptionEditor({
  options,
  onChange,
}: {
  options: Array<{ label: string; value: string }>;
  onChange: (next: Array<{ label: string; value: string }>) => void;
}) {
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);

  return (
    <div className="pt-1">
      <Label className="mb-2 block text-body-sm font-medium text-ink">The choices</Label>
      <div className="space-y-1.5">
        {options.map((option, i) => (
          <div
            key={i}
            draggable
            onDragStart={() => setDragIndex(i)}
            onDragEnd={() => setDragIndex(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex === null || dragIndex === i) return;
              const next = [...options];
              const [moved] = next.splice(dragIndex, 1);
              if (moved) next.splice(i, 0, moved);
              onChange(next);
              setDragIndex(null);
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-control",
              dragIndex === i && "opacity-40",
            )}
          >
            <span aria-hidden className="cursor-grab text-ink-muted/50 active:cursor-grabbing">
              <GripVertical className="size-3.5" />
            </span>
            <Input
              value={option.label}
              onChange={(e) => {
                const next = [...options];
                // The stored value is derived once, on create, and never
                // re-derived: a relabelled option must not silently redefine
                // what an existing answer meant.
                next[i] = { label: e.target.value, value: option.value };
                onChange(next);
              }}
              placeholder="What the person picks"
              className="h-9"
            />
            <button
              type="button"
              onClick={() => onChange(options.filter((_, j) => j !== i))}
              aria-label={`Remove choice ${option.label || i + 1}`}
              className="grid size-8 shrink-0 place-items-center rounded-control text-ink-muted transition-colors hover:bg-critical-tint hover:text-critical"
            >
              <Trash2 aria-hidden className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...options, { label: "", value: "" }])}
        className="mt-2 flex items-center gap-1.5 rounded-control px-2 py-1.5 text-body-sm font-medium text-primary transition-colors hover:bg-primary/[0.07]"
      >
        <Plus aria-hidden className="size-3.5" />
        Add a choice
      </button>
      {options.length === 0 ? (
        <p className="mt-1 text-[11px] font-medium text-critical">
          A Pick one question needs at least one choice.
        </p>
      ) : null}
    </div>
  );
}
