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

  /* -- Which pane is on screen below `lg`. Ignored above it — both show.
        Defaults to the qualities: this screen is opened to EDIT the form, and
        the preview is what tells you whether the edit worked. -- */
  const [pane, setPane] = React.useState<"qualities" | "preview">("qualities");

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
      {/* ---------- What this form is ----------
            FOUR LINES OF DENSE TINTED TEXT became two. It listed everything the
            worker form does NOT share with the staff one — no 0-5 ratings, no
            Job Specific Skills, no department mapping — which is three ways of
            saying the one thing that matters: editing this changes nothing over
            there. The rest is visible in the preview beside it, where the three
            ticks are drawn rather than described.

            A banner that has to be read is a banner that gets skipped, and this
            one sat above every visit (P9B-6 keeps it returning, which is right
            — it is the thing most often misunderstood — but returning is
            exactly why it has to be short). */}
      <div className="flex items-start gap-2.5 rounded-card border-l-2 border-l-accent bg-accent-tint/40 px-4 py-3 text-ink">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
        <div className="min-w-0">
          <p className="text-body-sm font-medium">
            This is the Production Team&rsquo;s sheet — their supervisor fills it in.
          </p>
          <p className="mt-0.5 text-body-sm text-ink-muted">
            Separate from the Backend Team form. Editing one never changes the other.
          </p>
        </div>
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

      {/* ---------- Two panes, one at a time on a phone ----------
            Stacked, this is eight qualities followed by the whole supervisor's
            sheet — one long scroll where the second half is a preview of the
            first. Somebody editing quality six has to scroll past everything
            twice to see the effect.

            Tabs rather than hiding the preview: it is the point of the screen,
            and P31-1 settled the same question for the staff builder. Above
            `lg` both panes show and the switcher is gone, so nothing changes
            for a laptop. */}
      <div role="tablist" aria-label="Worker form panes" className="grid grid-cols-2 gap-1 rounded-card bg-surface-mute p-1 lg:hidden">
        {(
          [
            { value: "qualities" as const, label: "Qualities", hint: `${active.length} on the form` },
            { value: "preview" as const, label: "Preview", hint: "What the supervisor sees" },
          ]
        ).map((tab) => {
          const isOn = pane === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={isOn}
              onClick={() => setPane(tab.value)}
              className={cn(
                "flex min-h-11 flex-col items-center justify-center rounded-control px-2 py-1.5 transition-colors",
                isOn ? "bg-surface shadow-dashboard" : "hover:bg-surface/60",
              )}
            >
              <span
                className={cn(
                  "text-body-sm font-semibold",
                  isOn ? "text-ink" : "text-ink-muted",
                )}
              >
                {tab.label}
              </span>
              <span className="text-[11px] text-ink-muted">{tab.hint}</span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ---------- The qualities ---------- */}
        <section className={cn("card-surface p-5", pane === "preview" && "hidden lg:block")}>
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
                setPane("qualities");
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
                  <span className="tabular mt-0.5 w-5 shrink-0 text-body-sm text-ink-muted">
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
                    {/* -- ONLY WHEN IT IS NOT THE NORM.
                          Every row carried "THREE TICKS · MUST BE ANSWERED" in
                          letterspaced caps — eight rows, eight lines, one fact,
                          and it is the fact this whole form is built on. §6
                          fixes the three cells and every quality is required,
                          so restating it per row is the loudest repeated thing
                          on the screen saying the least.

                          A marker earns its place by being true of THIS row and
                          not the others (P31-11's rule, applied here). So a
                          Yes/No quality is named and an optional one is named;
                          the eight that follow the form's own rule say nothing
                          at all, and the sheet beside them shows the three
                          ticks being drawn. -- */}
                    {q.responseType !== "TICK_3" || !q.isRequired ? (
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] font-medium text-ink-muted">
                        {q.responseType !== "TICK_3" ? <span>Yes / No</span> : null}
                        {!q.isRequired ? <span>Optional</span> : null}
                      </p>
                    ) : null}
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
                            className="size-11 lg:size-8"
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
                        setPane("qualities");
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
                        className="flex items-center gap-1 px-2 text-body-sm text-ink-muted"
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
              <p className="type-label text-ink-muted">Removed from the form</p>
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
        <section className={cn("card-surface p-5", pane === "qualities" && "hidden lg:block")}>
          <div className="flex items-center gap-2">
            <Users aria-hidden className="size-4 text-ink-muted" />
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
            <p className="type-label text-ink-muted">Also on the form, and not questions</p>
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
