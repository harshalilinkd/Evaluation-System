"use client";

/** Department list, with the zero-questions flag and a create/edit drawer. */

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/appraise/states";
import { useSectionLabel } from "@/components/appraise/section-labels";
import {
  deleteDepartment,
  saveDepartment,
  type DepartmentActionState,
} from "@/lib/departments/actions";
import { cn } from "@/lib/utils";

export type DepartmentRow = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  is_active: boolean;
  headcount: number;
  questionCount: number;
};

/**
 * A department with no Job Specific Skills questions cannot be launched — every
 * employee in it would get a form with an empty section. Flagged everywhere the
 * department appears, not just on its own page, because HR will be looking at
 * the list when they decide the cycle is ready.
 */
export function NeedsQuestionsFlag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        // A dot and a word, not a bordered red capsule. The old treatment put a
        // filled critical block on every affected card, and three of them across
        // a grid read as an alarm rather than a to-do list. The meaning is
        // unchanged — it is still critical, still says what is wrong — it just
        // stops shouting it. DESIGN.md: saturated fills are for small marks,
        // never large blocks.
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-body-sm font-medium text-critical",
        className,
      )}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-pill bg-critical" />
      No questions
    </span>
  );
}

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="min-h-11" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function DepartmentsClient({ departments }: { departments: DepartmentRow[] }) {
  // HR's own name for it, not the shipped default (P25).
  const departmentSection = useSectionLabel("DEPARTMENT_SPECIFIC");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DepartmentRow | null>(null);
  const [deleting, setDeleting] = useState<DepartmentRow | null>(null);

  const missing = departments.filter((d) => d.is_active && d.questionCount === 0);
  const active = departments.filter((d) => d.is_active).length;

  return (
    <div className="space-y-5">
      {/*
        One header line instead of a tinted banner, a red slab and a stranded
        button on three separate rows. The sentence still leads — it is the
        thing HR most often misunderstands (§1) — but as a caption under a
        heading rather than a coloured block competing with the content.
      */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-display-sm text-ink">Departments</h2>
          <p className="mt-1 max-w-[62ch] text-body-sm text-ink-muted">
            Every employee answers the same evaluation form. Departments only decide the{" "}
            {departmentSection} section.
          </p>
        </div>

        {/* §13.3: the one primary action on this screen. Everything on a card
            is secondary to it, which is why none of them is filled any more. */}
        <Button
          className="min-h-11 shrink-0"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus className="size-4" aria-hidden />
          Add a department
        </Button>
      </div>

      {missing.length > 0 ? (
        <div
          role="status"
          // A left accent bar over a soft tint, not a fully bordered critical
          // box across the whole width. Same urgency, a fraction of the ink.
          className="flex items-start gap-3 rounded-card border-l-2 border-l-critical bg-critical-tint/40 py-3 pl-4 pr-4"
        >
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-critical" />
          <p className="text-body-sm text-ink">
            <span className="font-medium">
              {missing.length === 1
                ? `${missing[0]?.name} has no ${departmentSection} questions.`
                : `${missing.length} departments have no ${departmentSection} questions.`}
            </span>{" "}
            A cycle cannot be launched for them until they do
            {/* Named, not counted. P8-7: "Used in 3 departments" makes HR go and
                look; naming them lets them decide on the spot. */}
            {missing.length > 1 ? ` — ${missing.map((d) => d.name).join(", ")}` : ""}.
          </p>
        </div>
      ) : null}

      <p className="tabular text-body-sm text-ink-muted">
        {active} active{departments.length > active ? ` · ${departments.length - active} inactive` : ""}
      </p>

      {departments.length === 0 ? (
        <EmptyState
          title="No departments yet"
          body="Add the first one. Every employee belongs to a department, and it decides which Job Specific Skills questions they are asked."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {departments.map((d) => (
            <div
              key={d.id}
              className={cn(
                "card-surface group flex flex-col p-5",
                // The whole card lifts on hover rather than one button glowing.
                // It reads as an object you can pick up, which is what a card
                // is, and it costs no colour at all.
                "transition-shadow duration-hover hover:shadow-dashboard-hover",
                !d.is_active && "opacity-60",
              )}
            >
              {/* ---------- Identity ---------- */}
              <div className="flex items-start gap-3">
                {/* A monogram gives each card something to recognise it by
                    without spending a colour on it — the same device the
                    dashboard's readiness table uses, so they read as one family. */}
                <span
                  aria-hidden
                  className="flex size-9 shrink-0 items-center justify-center rounded-input bg-accent text-body-sm font-medium text-primary"
                >
                  {d.name.slice(0, 2).toUpperCase()}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-body-lg font-medium text-ink">{d.name}</p>
                  <p className="tabular truncate text-body-sm text-ink-muted">{d.code}</p>
                </div>

                {d.questionCount === 0 && d.is_active ? <NeedsQuestionsFlag /> : null}
                {!d.is_active ? (
                  <span className="shrink-0 whitespace-nowrap text-body-sm text-ink-muted">
                    Inactive
                  </span>
                ) : null}
              </div>

              {/* ---------- Figures ---------- */}
              {/* gap-px over a rule-coloured ground draws the hairline between
                  the two cells, so they read as one aligned block instead of
                  two loose stacks at an arbitrary gap. */}
              <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-control bg-rule">
                <div className="bg-surface px-3 py-2.5">
                  <dt className="type-label text-ink-muted">People</dt>
                  <dd className="tabular mt-0.5 text-display-sm text-ink">{d.headcount}</dd>
                </div>
                <div className="bg-surface px-3 py-2.5">
                  <dt className="type-label text-ink-muted">Questions</dt>
                  <dd
                    className={cn(
                      "tabular mt-0.5 text-display-sm",
                      d.questionCount === 0 ? "text-critical" : "text-ink",
                    )}
                  >
                    {d.questionCount}
                  </dd>
                </div>
              </dl>

              {/* ---------- Actions ---------- */}
              <div className="mt-4 flex items-center gap-1 border-t border-rule pt-3">
                {/*
                  A link, not a filled button. Nine solid indigo blocks in a grid
                  was the loudest thing on this screen and it broke §13.3 nine
                  times over — the page's one primary action is "Add a
                  department", and every card was competing with it. As a text
                  link with an arrow it is still the obvious thing to click, and
                  the card's own hover carries the affordance.
                */}
                <Link
                  href={`/admin/departments/${d.id}`}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-1 text-body font-medium text-primary transition-colors duration-hover hover:text-primary/80"
                >
                  Manage questions
                  <ArrowRight
                    aria-hidden
                    className="size-4 transition-transform duration-hover group-hover:translate-x-0.5"
                  />
                </Link>

                {/* Icon-only and pushed right: both are rare next to the one
                    above, and a row of three equal-weight labels would make the
                    card look like a toolbar. */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto size-11 text-ink-muted hover:text-ink lg:size-9"
                  aria-label={`Edit ${d.name}`}
                  onClick={() => {
                    setEditing(d);
                    setOpen(true);
                  }}
                >
                  <Pencil className="size-4" aria-hidden />
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 text-ink-muted hover:text-critical lg:size-9"
                  aria-label={`Delete ${d.name}`}
                  onClick={() => setDeleting(d)}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <DepartmentDrawer open={open} onOpenChange={setOpen} department={editing} />

      {/* Keyed on the id, so opening a second department starts with a clean
          action state rather than inheriting the previous one's error (P10-11:
          a remount states the intent better than a reset effect). */}
      <DeleteDialog
        key={deleting?.id ?? "none"}
        department={deleting}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

/**
 * The confirmation.
 *
 * It states what will actually happen rather than asking "are you sure": the
 * question-mapping count is the one consequence that is not obvious from the
 * card, because those rows cascade away with the department (0002) while the
 * questions themselves stay in the bank.
 *
 * Where the department cannot be deleted at all, the server says why and the
 * dialog stays open holding that sentence. The button is not pre-disabled from
 * the card's counts — those are a page-load snapshot, and a stale zero would
 * offer a delete that then fails.
 */
function DeleteDialog({
  department,
  onClose,
}: {
  department: DepartmentRow | null;
  onClose: () => void;
}) {
  // HR's own name for it, not the shipped default (P25).
  const departmentSection = useSectionLabel("DEPARTMENT_SPECIFIC");
  const [state, action] = useActionState<DepartmentActionState, FormData>(deleteDepartment, {});

  // Closing is a side effect of the action completing, not of rendering — the
  // same shape DepartmentForm below uses. It calls a prop rather than setting
  // state here, so it cannot cascade a render in this component.
  //
  // Only on success: a refusal — somebody is still in the department — has to
  // stay on screen next to the name it is about, or the click reads as having
  // done nothing.
  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  const blocked = department ? department.headcount > 0 : false;

  return (
    <Dialog open={Boolean(department)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {department?.name}?</DialogTitle>
          <DialogDescription>
            This cannot be undone. The department is removed from the list and from every
            export.
          </DialogDescription>
        </DialogHeader>

        {department ? (
          <div className="space-y-3">
            {blocked ? (
              // Said before they press it, not after. The server checks this
              // again — it is the authority — but making somebody click to
              // discover a refusal is what makes a screen feel hostile.
              <p className="rounded-control border border-warning/40 bg-warning-tint p-3 text-body-sm text-ink">
                {department.headcount} {department.headcount === 1 ? "person is" : "people are"} in{" "}
                {department.name}. Move them to another department first, or mark this one
                inactive instead.
              </p>
            ) : null}

            {department.questionCount > 0 ? (
              <p className="text-body-sm text-ink-muted">
                Its {department.questionCount} {departmentSection} mapping
                {department.questionCount === 1 ? "" : "s"} will be removed. The questions
                themselves stay in the question bank — other departments that ask them are
                unaffected.
              </p>
            ) : null}

            <p className="text-body-sm text-ink-muted">
              Evaluations already launched keep the department name they were launched with.
            </p>
          </div>
        ) : null}

        {state.error ? (
          <p
            role="alert"
            className="rounded-control border border-critical/40 bg-critical-tint px-3 py-2 text-body-sm text-critical"
          >
            {state.error}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={onClose}>
            Keep it
          </Button>
          <form action={action}>
            <input type="hidden" name="id" value={department?.id ?? ""} />
            <DeleteSubmit disabled={blocked} />
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteSubmit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" className="min-h-11" disabled={disabled || pending}>
      {pending ? "Deleting…" : "Delete department"}
    </Button>
  );
}

function DepartmentDrawer({
  open,
  onOpenChange,
  department,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  department: DepartmentRow | null;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto bg-background p-0 sm:max-w-[480px]">
        <SheetHeader className="border-b border-rule bg-surface px-6 py-4">
          <SheetTitle className="text-display-md text-ink">
            {department ? "Edit department" : "Add a department"}
          </SheetTitle>
        </SheetHeader>
        {/* Keyed so opening a different department remounts with fresh state. */}
        {open ? (
          <DepartmentForm
            key={department?.id ?? "new"}
            department={department}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function DepartmentForm({
  department,
  onDone,
}: {
  department: DepartmentRow | null;
  onDone: () => void;
}) {
  const [state, action] = useActionState<DepartmentActionState, FormData>(saveDepartment, {});
  const [isActive, setIsActive] = useState(department?.is_active ?? true);

  // Closing is a side effect of the action completing, not of rendering — doing
  // it inline would fire on every re-render and set state during another
  // component's render pass.
  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  return (
    <form action={action} className="space-y-5 p-6">
      {department ? <input type="hidden" name="id" value={department.id} /> : null}
      <input type="hidden" name="is_active" value={isActive ? "true" : "false"} />

      {state.error ? (
        <p
          role="alert"
          className="rounded-control border border-critical/40 bg-critical-tint px-3 py-2 text-body-sm text-critical"
        >
          {state.error}
        </p>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="name" className="type-label text-ink-muted">
          Name
        </Label>
        <Input
          id="name"
          name="name"
          required
          defaultValue={department?.name ?? ""}
          className="min-h-11"
          placeholder="Sales"
        />
        {state.fieldErrors?.name ? (
          <p className="text-body-sm text-critical">{state.fieldErrors.name}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="code" className="type-label text-ink-muted">
          Short code
        </Label>
        <Input
          id="code"
          name="code"
          required
          defaultValue={department?.code ?? ""}
          className="tabular min-h-11 uppercase"
          placeholder="SALES"
        />
        <p className="text-body-sm text-ink-muted">
          Used in exports and imports. Letters and numbers only.
        </p>
        {state.fieldErrors?.code ? (
          <p className="text-body-sm text-critical">{state.fieldErrors.code}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="description" className="type-label text-ink-muted">
          Description
        </Label>
        <Textarea
          id="description"
          name="description"
          rows={2}
          defaultValue={department?.description ?? ""}
        />
      </div>

      <label className="flex min-h-11 cursor-pointer items-center gap-3">
        <Checkbox checked={isActive} onCheckedChange={(v) => setIsActive(v === true)} />
        <span className="text-body text-ink">In use</span>
      </label>

      <div className="flex items-center gap-3 border-t border-rule pt-4">
        <Submit label="Save department" pendingLabel="Saving…" />
        <Button type="button" variant="ghost" className="min-h-11" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
