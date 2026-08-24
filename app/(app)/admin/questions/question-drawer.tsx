"use client";

/** Create / edit drawer. Plain language only — no enum names on screen (§13.5). */

import { useActionState, useEffect, useId, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { GripVertical, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useSectionLabel } from "@/components/appraise/section-labels";
import { QuestionPreview } from "@/app/(app)/admin/questions/question-preview";
import { saveQuestion, type QuestionActionState } from "@/lib/questions/actions";
import {
  ANSWERED_BY,
  DEPARTMENT_SECTION,
  RESPONSE_TYPES,
  SECTIONS,
  TRACKS,
  dependencySentence,
  needsOptions,
  type ResponseType,
} from "@/lib/questions/labels";
import { cn } from "@/lib/utils";
import { SHEET_ON_MOBILE } from "@/components/appraise/sheet-dialog";

export type DepartmentOption = { id: string; name: string };

export type QuestionRecord = {
  id: string;
  text: string;
  help_text: string | null;
  section: string;
  response_type: ResponseType;
  answered_by: string;
  track: string;
  category: string;
  is_required: boolean;
  is_active: boolean;
  sort_order: number;
  depends_on: string | null;
  depends_value: string | null;
  options: { label: string; value: string }[];
  departmentIds: string[];
  departmentCount: number;
};

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="min-h-11" disabled={pending}>
      {pending ? "Saving…" : "Save question"}
    </Button>
  );
}

/**
 * One labelled field.
 *
 * `htmlFor` is not optional decoration: §13.8 requires labels tied to inputs,
 * and the previous version rendered a bare <Label> next to a control with no
 * association at all — so a screen reader announced "edit text, blank" on every
 * row of this form. Every caller passes an id, including the Radix selects,
 * whose trigger accepts one.
 */
function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="type-label text-ink-muted">
        {label}
      </Label>
      {children}
      {hint ? <p className="text-body-sm text-ink-muted">{hint}</p> : null}
      {error ? <p className="text-body-sm font-medium text-critical">{error}</p> : null}
    </div>
  );
}

/**
 * A titled group of related fields.
 *
 * The form asks eight questions about one question, and as a flat column they
 * read as an undifferentiated list — which is what made it feel like a wall.
 * Four named groups give it a shape somebody can hold: what it says, where it
 * lives, how it is answered, when it shows.
 */
function FieldGroup({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h3 className="shrink-0 text-body font-medium text-ink">{title}</h3>
        <span aria-hidden className="h-px flex-1 bg-rule" />
      </div>
      {description ? <p className="-mt-2 text-body-sm text-ink-muted">{description}</p> : null}
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export function QuestionDrawer({
  open,
  onOpenChange,
  question,
  parentCandidates,
  departments,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null when adding. */
  question: QuestionRecord | null;
  /** Yes/No questions that could reveal this one. */
  parentCandidates: { id: string; text: string }[];
  departments: DepartmentOption[];
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // A centred modal rather than the right-hand drawer this used to be.
        // The drawer was chosen (P8-2) so the preview had room and the list
        // stayed in view; in practice 560px gave the preview nowhere to go, so
        // it sat below eight fields where nobody scrolled to it. Centred and
        // wide, the form and the live preview fit side by side — which is what
        // the drawer was trying to buy in the first place.
        //
        // NOTHING here closes on an outside click. This form holds up to a
        // dozen unsaved fields, and a stray click on the backdrop throwing them
        // away is the kind of loss people do not report, they just stop
        // trusting the screen. The X, Cancel and Escape are the ways out, and
        // all three are deliberate acts.
        onInteractOutside={(event) => event.preventDefault()}
        className={cn(
          "flex flex-col gap-0 overflow-hidden border-rule bg-background p-0",
          SHEET_ON_MOBILE,
          "sm:w-[min(96vw,1040px)]",
        )}
      >
        {/* pr-14 leaves the built-in close X its corner. */}
        <DialogHeader className="shrink-0 space-y-1 border-b border-rule bg-surface px-6 py-4 pr-14 text-left">
          <DialogTitle className="text-display-sm text-ink">
            {question ? "Edit question" : "Add a question"}
          </DialogTitle>
          <DialogDescription className="text-body-sm text-ink-muted">
            Changes apply to future cycles. Evaluations already launched keep the questions they
            were launched with.
          </DialogDescription>
        </DialogHeader>

        {/* Keyed so opening a different question remounts the form with fresh
            initial state. Syncing props into state through an effect would
            cascade a render for every field and go stale the moment two opens
            raced. */}
        {open ? (
          <QuestionForm
            key={question?.id ?? "new"}
            question={question}
            parentCandidates={parentCandidates}
            departments={departments}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function QuestionForm({
  question,
  parentCandidates,
  departments,
  onClose,
  onSaved,
}: {
  question: QuestionRecord | null;
  parentCandidates: { id: string; text: string }[];
  departments: DepartmentOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // HR's own name for it, not the shipped default (P25).
  const departmentSection = useSectionLabel("DEPARTMENT_SPECIFIC");
  const [state, action] = useActionState<QuestionActionState, FormData>(saveQuestion, {});
  // One prefix per mount, so every label points at its own control even when
  // two of these forms exist (the builder renders one beside the list).
  const uid = useId();

  const [text, setText] = useState(question?.text ?? "");
  const [helpText, setHelpText] = useState(question?.help_text ?? "");
  const [section, setSection] = useState(question?.section ?? "CORE_PERFORMANCE");
  const [responseType, setResponseType] = useState<ResponseType>(
    question?.response_type ?? "SCALE_0_5",
  );
  const [answeredBy, setAnsweredBy] = useState(question?.answered_by ?? "EMPLOYEE_AND_LEAD");
  const [track, setTrack] = useState(question?.track ?? "BOTH");
  const [category, setCategory] = useState(question?.category ?? "CORE");
  const [required, setRequired] = useState(question?.is_required ?? true);
  const [options, setOptions] = useState<{ label: string; value: string }[]>(
    question?.options ?? [],
  );
  const [dependsOn, setDependsOn] = useState<string>(question?.depends_on ?? "");
  const [dependsValue, setDependsValue] = useState<string>(question?.depends_value ?? "true");
  const [departmentIds, setDepartmentIds] = useState<string[]>(question?.departmentIds ?? []);

  // Closing on success is a side effect of the action completing, not of
  // rendering — so it belongs in an effect, and it sets no state of its own.
  useEffect(() => {
    if (!state.ok) return;
    onSaved();
    onClose();
  }, [state.ok, onSaved, onClose]);

  const parentText = useMemo(
    () => parentCandidates.find((p) => p.id === dependsOn)?.text ?? null,
    [parentCandidates, dependsOn],
  );

  const showOptions = needsOptions(responseType);

  // Job Specific Skills is the one section that varies by department (§1), so
  // the section and the category are really the same choice. Picking the
  // section sets the category, and the department picker appears inline — HR
  // authors and maps in one action instead of two screens.
  const isJobSpecific = section === DEPARTMENT_SECTION || category === "DEPARTMENT";

  function chooseSection(next: string) {
    setSection(next);
    setCategory(next === DEPARTMENT_SECTION ? "DEPARTMENT" : "CORE");
    if (next !== DEPARTMENT_SECTION) setDepartmentIds([]);
  }

  function toggleDepartment(id: string, on: boolean) {
    setDepartmentIds((prev) => (on ? [...new Set([...prev, id])] : prev.filter((d) => d !== id)));
  }

  function moveOption(from: number, to: number) {
    if (to < 0 || to >= options.length) return;
    const next = [...options];
    const [moved] = next.splice(from, 1);
    if (moved) next.splice(to, 0, moved);
    setOptions(next);
  }

  return (
    <form action={action} className="flex min-h-0 flex-1 flex-col">
      {question ? <input type="hidden" name="id" value={question.id} /> : null}
      <input type="hidden" name="section" value={section} />
      <input type="hidden" name="response_type" value={responseType} />
      <input type="hidden" name="answered_by" value={answeredBy} />
      <input type="hidden" name="track" value={track} />
      <input type="hidden" name="category" value={category} />
      <input type="hidden" name="is_required" value={required ? "true" : "false"} />
      <input type="hidden" name="options" value={JSON.stringify(showOptions ? options : [])} />
      <input type="hidden" name="depends_on" value={dependsOn} />
      <input type="hidden" name="depends_value" value={dependsOn ? dependsValue : ""} />
      {isJobSpecific
        ? departmentIds.map((id) => (
            <input key={id} type="hidden" name="department_ids" value={id} />
          ))
        : null}

      {/*
        Two panes above lg: the fields on the left, the live preview on the
        right where it can be watched while the fields change. Below lg the
        grid collapses and the preview follows the form, so nothing is hidden
        on a narrow screen — it just stops being side by side.
      */}
      <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_400px] lg:overflow-hidden">
        <div className="min-w-0 space-y-7 px-6 py-6 lg:min-h-0 lg:overflow-y-auto">
          {state.error ? (
            <p
              role="alert"
              className="rounded-control border border-critical/40 bg-critical-tint px-3 py-2 text-body-sm font-medium text-critical"
            >
              {state.error}
            </p>
          ) : null}

          {/* ---------- 1. What it asks ---------- */}
          <FieldGroup title="The question">
            <Field label="Question text" htmlFor={`${uid}-text`} error={state.fieldErrors?.text}>
              <Textarea
                id={`${uid}-text`}
                name="text"
                rows={2}
                required
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Delivery Efficiency"
                className="text-body"
              />
            </Field>

            <Field
              label="Helper text"
              htmlFor={`${uid}-help`}
              hint="Optional. A sentence explaining what you are looking for. The person answering sees it under the question."
            >
              <Textarea
                id={`${uid}-help`}
                name="help_text"
                rows={2}
                value={helpText}
                onChange={(e) => setHelpText(e.target.value)}
                placeholder="Ability to complete assignments within timelines without compromising quality"
              />
            </Field>
          </FieldGroup>

          {/* ---------- 2. Where it lives ---------- */}
          <FieldGroup title="Where it belongs">
            <Field
              label="Section"
              htmlFor={`${uid}-section`}
              hint={
                isJobSpecific
                  ? `${departmentSection} is the only section that changes by department. Everything else is identical company-wide.`
                  : undefined
              }
            >
              <Select value={section} onValueChange={chooseSection}>
                <SelectTrigger id={`${uid}-section`} className="min-h-11 border-rule bg-surface">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SECTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {/* P8-PATCH.9: author and map in one action. */}
            {isJobSpecific ? (
              <Field
                label="Departments asked this"
                htmlFor={`${uid}-departments`}
                error={state.fieldErrors?.department_ids}
              >
                {departments.length === 0 ? (
                  <p className="text-body-sm text-ink-muted">No departments yet. Add one first.</p>
                ) : (
                  // A wrapped grid rather than a tall column: ten departments as
                  // ten full-width rows pushed every field below them off screen.
                  <div id={`${uid}-departments`} className="grid gap-2 sm:grid-cols-2">
                    {departments.map((d) => {
                      const checked = departmentIds.includes(d.id);
                      return (
                        <label
                          key={d.id}
                          className={cn(
                            "flex min-h-11 cursor-pointer items-center gap-3 rounded-control border px-3 transition-colors duration-hover",
                            checked
                              ? "border-primary/40 bg-accent"
                              : "border-rule bg-surface hover:border-primary/30",
                          )}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => toggleDepartment(d.id, v === true)}
                          />
                          <span className="truncate text-body text-ink">{d.name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </Field>
            ) : null}
          </FieldGroup>

          {/* ---------- 3. How it is answered ---------- */}
          <FieldGroup title="How it is answered">
            <Field
              label="Answer type"
              htmlFor={`${uid}-type`}
              hint={RESPONSE_TYPES.find((t) => t.value === responseType)?.hint}
            >
              <Select value={responseType} onValueChange={(v) => setResponseType(v as ResponseType)}>
                <SelectTrigger id={`${uid}-type`} className="min-h-11 border-rule bg-surface">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RESPONSE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {/* The option editor appears only for Pick one / Pick many (§P8.3). */}
            {showOptions ? (
              <Field label="Choices" htmlFor={`${uid}-choices`} error={state.fieldErrors?.options}>
                <div id={`${uid}-choices`} className="space-y-2">
                  {options.map((option, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-1 rounded-control border border-rule bg-surface p-1.5"
                    >
                      <span className="px-1 text-ink-muted" aria-hidden>
                        <GripVertical className="size-4" />
                      </span>
                      <Input
                        value={option.label}
                        onChange={(e) => {
                          const next = [...options];
                          next[index] = { label: e.target.value, value: option.value };
                          setOptions(next);
                        }}
                        className="min-h-10 border-0 bg-transparent shadow-none focus-visible:ring-0"
                        placeholder="Private Placement"
                        aria-label={`Choice ${index + 1}`}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-11 shrink-0 lg:size-9"
                        aria-label={`Move "${option.label}" up`}
                        disabled={index === 0}
                        onClick={() => moveOption(index, index - 1)}
                      >
                        ↑
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-11 shrink-0 lg:size-9"
                        aria-label={`Move "${option.label}" down`}
                        disabled={index === options.length - 1}
                        onClick={() => moveOption(index, index + 1)}
                      >
                        ↓
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-11 shrink-0 hover:text-critical lg:size-9"
                        aria-label={`Remove "${option.label}"`}
                        onClick={() => setOptions(options.filter((_, i) => i !== index))}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  ))}

                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 w-full border-dashed"
                    onClick={() => setOptions([...options, { label: "", value: "" }])}
                  >
                    <Plus className="size-4" />
                    Add a choice
                  </Button>
                </div>
              </Field>
            ) : null}

            {/* Paired because they are one decision seen from two sides: who
                fills it in, and which of the two workforces gets asked. Side by
                side they also stop the form running to twice the height. */}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Who answers it"
                htmlFor={`${uid}-answered-by`}
                hint={ANSWERED_BY.find((a) => a.value === answeredBy)?.hint}
              >
                <Select value={answeredBy} onValueChange={setAnsweredBy}>
                  <SelectTrigger
                    id={`${uid}-answered-by`}
                    className="min-h-11 border-rule bg-surface"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ANSWERED_BY.map((a) => (
                      <SelectItem key={a.value} value={a.value}>
                        {a.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field
                label="Applies to"
                htmlFor={`${uid}-track`}
                hint={TRACKS.find((t) => t.value === track)?.hint}
              >
                <Select value={track} onValueChange={setTrack}>
                  <SelectTrigger id={`${uid}-track`} className="min-h-11 border-rule bg-surface">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRACKS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            {/* No separate "who is asked" picker: §1 makes the section and the
                category the same decision, and two controls that must agree is
                two controls that will eventually disagree. `chooseSection` sets
                the category, and it rides along in the hidden field above. */}

            <label
              className={cn(
                "flex min-h-11 cursor-pointer items-start gap-3 rounded-control border p-3 transition-colors duration-hover",
                required ? "border-primary/40 bg-accent" : "border-rule bg-surface",
              )}
            >
              <Checkbox
                checked={required}
                onCheckedChange={(v) => setRequired(v === true)}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block text-body text-ink">Required</span>
                <span className="block text-body-sm text-ink-muted">
                  They cannot submit the form until this is answered.
                </span>
              </span>
            </label>
          </FieldGroup>

          {/* ---------- 4. When it appears ---------- */}
          {/* §P8.4: the conditional control, in plain language. */}
          <FieldGroup
            title="When it appears"
            description="By default every question shows. Pick a Yes/No question that comes earlier to reveal this one only when it is relevant — this is how “If yes, please specify” works."
          >
            <Field
              label="Only show this question if…"
              htmlFor={`${uid}-depends`}
              error={state.fieldErrors?.depends_value}
            >
              <div className="space-y-2">
                <Select
                  value={dependsOn || "none"}
                  onValueChange={(v) => setDependsOn(v === "none" ? "" : v)}
                >
                  <SelectTrigger id={`${uid}-depends`} className="min-h-11 border-rule bg-surface">
                    <SelectValue placeholder="Always show it" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Always show it</SelectItem>
                    {parentCandidates.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.text}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {dependsOn ? (
                  <Select value={dependsValue} onValueChange={setDependsValue}>
                    <SelectTrigger
                      className="min-h-11 border-rule bg-surface"
                      aria-label="And they answer"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">…they answer Yes</SelectItem>
                      <SelectItem value="false">…they answer No</SelectItem>
                    </SelectContent>
                  </Select>
                ) : null}

                {dependsOn && parentText ? (
                  <p className="rounded-control border border-rule bg-surface-mute px-3 py-2 text-body-sm text-ink-muted">
                    {dependencySentence(parentText, dependsValue)}
                  </p>
                ) : null}
              </div>
            </Field>
          </FieldGroup>
        </div>

        {/* ---------- Live preview ---------- */}
        {/* §P8.5: the real renderer, not a mock-up. Promoted out of the bottom
            of the field list, where it was eight scrolls away from the fields
            it was previewing. */}
        <aside className="min-w-0 border-t border-rule bg-surface-mute px-6 py-6 lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0">
          <div className="lg:sticky lg:top-0">
            <p className="type-label mb-3 text-ink-muted">Live preview</p>
            {/* hideHeading: the component labels itself "Preview", and stacked
                under this one it read as two headings for one thing.
                compact: this pane is 400px on a screen that may be 1600px, so
                the scale cannot work its own width out from the viewport. */}
            <QuestionPreview
              hideHeading
              compact
              text={text}
              helpText={helpText}
              section={section as never}
              responseType={responseType}
              required={required}
              options={options}
              parentText={parentText}
              dependsValue={dependsOn ? dependsValue : null}
            />
          </div>
        </aside>
      </div>

      {/* Pinned, so Save is reachable without scrolling to the bottom of a form
          whose length changes with the answer type. */}
      <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-rule bg-surface px-6 py-4">
        <Button type="button" variant="ghost" className="min-h-11" onClick={onClose}>
          Cancel
        </Button>
        <SaveButton />
      </footer>
    </form>
  );
}
