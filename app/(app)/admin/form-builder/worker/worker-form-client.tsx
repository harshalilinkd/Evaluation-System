"use client";

/** The Worker Performance Appraisal form: the list, the editor and a live preview. */

import * as React from "react";
import { useActionState } from "react";
import { ChevronDown, ChevronUp, Info, Lock, Plus, Users } from "lucide-react";

import { FormRenderer } from "@/components/appraise/form-renderer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  reorderWorkerQuestions,
  saveWorkerQuestion,
  setWorkerQuestionActive,
  type WorkerActionState,
} from "@/lib/worker/actions";
import type { FormDefinition } from "@/lib/forms/types";
import type { WorkerQuestion } from "@/lib/worker/questions";
import { cn } from "@/lib/utils";

const FIXED_BLOCKS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "Supervisor comment",
    body: "A free-text note from the supervisor. Part of the record, not a question in the bank.",
  },
  { title: "Training required", body: "Yes or No, ticked by the supervisor." },
  {
    title: "Salary",
    body: "Same or New, with old salary, increment % and new salary. These figures reach HR and the MD only — never a supervisor's copy.",
  },
  {
    title: "Signatures",
    body: "Supervisor, HR and MD, with the company stamp. These belong to the printed pack.",
  },
];

export function WorkerFormClient({
  questions,
  preview,
}: {
  questions: WorkerQuestion[];
  preview: FormDefinition;
}) {
  const [saveState, saveAction] = useActionState<WorkerActionState, FormData>(
    saveWorkerQuestion,
    {},
  );
  const [activeState, activeAction] = useActionState<WorkerActionState, FormData>(
    setWorkerQuestionActive,
    {},
  );
  const [, reorderAction] = useActionState<WorkerActionState, FormData>(
    reorderWorkerQuestions,
    {},
  );

  const [editing, setEditing] = React.useState<WorkerQuestion | null>(null);
  const [adding, setAdding] = React.useState(false);

  const active = questions.filter((q) => q.isActive);
  const retired = questions.filter((q) => !q.isActive);

  // The order the buttons send. Computed from what is on screen so a reorder
  // cannot reference a row somebody has since retired.
  const orderWith = (index: number, direction: -1 | 1) => {
    const ids = active.map((q) => q.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return null;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    return JSON.stringify(ids);
  };

  const message = saveState.error ?? saveState.message ?? activeState.error ?? activeState.message;
  const isError = Boolean(saveState.error ?? activeState.error);

  return (
    <div className="space-y-4">
      {/* ---------- What this form is ---------- */}
      <div className="flex items-start gap-2 rounded-card border-l-2 border-l-accent bg-accent-tint/40 px-4 py-3 text-body-sm text-ink">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          <span className="font-medium">This is the shop-floor form, and it is not the staff one.</span>{" "}
          Workers are appraised on a three-tick sheet — Excellent, Satisfactory, Needs Improvement —
          filled in by their supervisor. It shares nothing with the staff form: no 0-5 ratings, no
          Job Specific Skills, no department mapping. Changing one never changes the other.
        </span>
      </div>

      {message ? (
        <p
          role="status"
          className={cn(
            "rounded-card border px-4 py-2 text-body-sm",
            isError
              ? "border-critical/40 bg-critical-tint text-critical"
              : "border-rule bg-surface-mute text-ink",
          )}
        >
          {message}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ---------- The qualities ---------- */}
        <section className="card-surface p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-display-sm text-ink">Qualities</h2>
              <p className="text-body-sm text-ink-muted">
                {active.length} on the form
                {retired.length > 0 ? ` · ${retired.length} removed` : ""}
              </p>
            </div>
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => {
                setEditing(null);
                setAdding(true);
              }}
            >
              <Plus className="size-4" aria-hidden />
              Add a quality
            </Button>
          </div>

          <ul className="mt-4 space-y-2">
            {active.map((q, index) => (
              <li
                key={q.id}
                className={cn(
                  "rounded-control border border-rule p-3",
                  editing?.id === q.id && "border-accent",
                )}
              >
                <div className="flex items-start gap-3">
                  <span className="tabular mt-0.5 w-5 shrink-0 text-body-sm text-ink-faint">
                    {index + 1}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="text-body text-ink">
                      {q.text}
                      {q.isOverall ? (
                        <span className="ml-2 rounded-pill bg-surface-mute px-2 py-0.5 text-body-sm text-ink-muted">
                          the worker&apos;s score
                        </span>
                      ) : null}
                    </p>
                    {q.helpText ? (
                      <p className="text-body-sm text-ink-muted">{q.helpText}</p>
                    ) : null}
                    <p className="type-label mt-1 text-ink-faint">
                      {q.responseType === "TICK_3" ? "Three ticks" : "Yes / No"}
                      {q.isRequired ? " · must be answered" : " · optional"}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-0.5">
                    {[-1, 1].map((direction) => {
                      const ids = orderWith(index, direction as -1 | 1);
                      return (
                        <form key={direction} action={reorderAction}>
                          <input type="hidden" name="ids" value={ids ?? ""} />
                          <Button
                            type="submit"
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            disabled={!ids}
                            aria-label={`Move ${q.text} ${direction === -1 ? "up" : "down"}`}
                          >
                            {direction === -1 ? (
                              <ChevronUp className="size-4" aria-hidden />
                            ) : (
                              <ChevronDown className="size-4" aria-hidden />
                            )}
                          </Button>
                        </form>
                      );
                    })}

                    <Button
                      variant="ghost"
                      size="sm"
                      className="px-2"
                      onClick={() => {
                        setAdding(false);
                        setEditing(q);
                      }}
                    >
                      Edit
                    </Button>

                    {/* §11 makes the overall tick the worker's score, so a form
                        without it would have none. Shown as locked rather than
                        hidden: a control that silently is not there reads as a
                        bug, one that says why reads as deliberate (§13.4). */}
                    {q.isOverall ? (
                      <span
                        className="flex items-center gap-1 px-2 text-body-sm text-ink-faint"
                        title="Overall Performance is the worker's score for the period"
                      >
                        <Lock className="size-3.5" aria-hidden />
                        Kept
                      </span>
                    ) : (
                      <form action={activeAction}>
                        <input type="hidden" name="id" value={q.id} />
                        <input type="hidden" name="is_active" value="false" />
                        <Button type="submit" variant="ghost" size="sm" className="px-2">
                          Remove
                        </Button>
                      </form>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {retired.length > 0 ? (
            <div className="mt-4 border-t border-rule pt-3">
              <p className="type-label text-ink-faint">Removed from the form</p>
              <ul className="mt-2 space-y-1">
                {retired.map((q) => (
                  <li key={q.id} className="flex items-center justify-between gap-3">
                    <span className="truncate text-body-sm text-ink-muted">{q.text}</span>
                    <form action={activeAction}>
                      <input type="hidden" name="id" value={q.id} />
                      <input type="hidden" name="is_active" value="true" />
                      <Button type="submit" variant="ghost" size="sm" className="px-2">
                        Put back
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* ---------- The editor ---------- */}
          {adding || editing ? (
            <form
              // Keyed, not effect-synced: remounting on the row gives correct
              // initial state with no cascade and no staleness when two opens
              // race (P8-9).
              key={editing?.id ?? "new"}
              action={saveAction}
              onSubmit={() => {
                setAdding(false);
                setEditing(null);
              }}
              className="mt-4 space-y-3 rounded-control border border-rule bg-surface-mute p-4"
            >
              <h3 className="text-body font-medium text-ink">
                {editing ? "Edit this quality" : "Add a quality"}
              </h3>

              {editing ? <input type="hidden" name="id" value={editing.id} /> : null}

              <div className="space-y-1">
                <label htmlFor="worker-text" className="type-label text-ink-muted">
                  What is being rated
                </label>
                <Input
                  id="worker-text"
                  name="text"
                  defaultValue={editing?.text ?? ""}
                  placeholder="Work Quality"
                  className="min-h-11 border-rule bg-surface"
                  required
                />
                {saveState.fieldErrors?.text ? (
                  <p className="text-body-sm text-critical">{saveState.fieldErrors.text}</p>
                ) : null}
              </div>

              <div className="space-y-1">
                <label htmlFor="worker-help" className="type-label text-ink-muted">
                  A line of explanation (optional)
                </label>
                <Input
                  id="worker-help"
                  name="help_text"
                  defaultValue={editing?.helpText ?? ""}
                  placeholder="The standard of the work produced"
                  className="min-h-11 border-rule bg-surface"
                />
              </div>

              <input
                type="hidden"
                name="response_type"
                value={editing?.responseType ?? "TICK_3"}
              />
              <input
                type="hidden"
                name="is_required"
                value={String(editing?.isRequired ?? true)}
              />

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11"
                  onClick={() => {
                    setAdding(false);
                    setEditing(null);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" className="min-h-11">
                  Save
                </Button>
              </div>
            </form>
          ) : null}
        </section>

        {/* ---------- Preview ---------- */}
        <section className="card-surface p-5">
          <div className="flex items-center gap-2">
            <Users aria-hidden className="size-4 text-ink-faint" />
            <h2 className="text-display-sm text-ink">The supervisor&apos;s sheet</h2>
          </div>
          <p className="mt-1 text-body-sm text-ink-muted">
            Exactly what the supervisor will see. Nothing ticked here is saved.
          </p>

          <div className="mt-4">
            {/* The SAME renderer the staff form uses. A tick sheet is a form
                with one section of TICK_3 questions in it — building a second
                renderer for it is what P9-1 forbids. */}
            <FormRenderer form={preview} values={{}} readOnly onChange={() => {}} />
          </div>

          <div className="mt-5 border-t border-rule pt-4">
            <p className="type-label text-ink-faint">Also on the form, and not questions</p>
            <ul className="mt-2 space-y-2">
              {FIXED_BLOCKS.map((block) => (
                <li key={block.title} className="text-body-sm">
                  <span className="text-ink">{block.title}</span>
                  <span className="text-ink-muted"> — {block.body}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
