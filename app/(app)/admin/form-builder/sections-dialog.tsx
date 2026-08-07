"use client";

/** Renaming, reordering and parking the form's sections. */

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Eye, EyeOff, Info, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
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
  renameSection,
  reorderSections,
  setSectionActive,
  type SectionActionState,
} from "@/lib/forms/section-actions";
import type { QuestionSection } from "@/lib/forms/labels";
import { cn } from "@/lib/utils";

export type SectionRow = {
  section: QuestionSection;
  label: string;
  isActive: boolean;
  /** How many live questions sit in it — the number that makes parking a decision. */
  questionCount: number;
};

export function SectionsDialog({
  open,
  onOpenChange,
  sections,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: SectionRow[];
}) {
  const router = useRouter();

  const [renameState, renameAction] = useActionState<SectionActionState, FormData>(
    renameSection,
    {},
  );
  const [orderState, orderAction] = useActionState<SectionActionState, FormData>(
    reorderSections,
    {},
  );
  const [activeState, activeAction] = useActionState<SectionActionState, FormData>(
    setSectionActive,
    {},
  );

  const [editing, setEditing] = React.useState<QuestionSection | null>(null);

  const message =
    renameState.error ??
    renameState.message ??
    orderState.error ??
    orderState.message ??
    activeState.error ??
    activeState.message;
  const isError = Boolean(renameState.error ?? orderState.error ?? activeState.error);

  // The order a move button sends. Built from what is on screen, so a reorder
  // can never reference a section that is not in the list.
  const orderWith = (index: number, direction: -1 | 1) => {
    const ids = sections.map((s) => s.section);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return null;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    return JSON.stringify(ids);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[88vh] w-[min(96vw,640px)] max-w-[96vw] overflow-hidden border-rule bg-surface"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="font-sans text-display-md">Form structure</DialogTitle>
          <DialogDescription className="font-sans text-body text-ink-muted">
            What each part of the form is called, and the order they appear in. Changes show up
            everywhere at once — the form, the builder, the reports and the printed pack.
          </DialogDescription>
        </DialogHeader>

        {/*
          The one thing this screen cannot do, said before somebody looks for it.
          §5 freezes the section onto every launched evaluation, so the SET of
          sections is fixed — but "park it" does what removing one is usually
          meant to achieve, and is reversible.
        */}
        <p className="flex items-start gap-2 rounded-control border-l-2 border-l-accent bg-accent-tint/40 py-2.5 pl-3 pr-3 text-body-sm text-ink">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            You can rename these and move them. You cannot add or delete one — every appraisal ever
            launched is filed against this list, and changing it would rewrite what people were
            asked. To take a section off the form, park it: its questions stay exactly where they
            are and you can bring it back at any time.
          </span>
        </p>

        {message ? (
          <p
            role="status"
            className={cn(
              "rounded-control border px-3 py-2 text-body-sm",
              isError
                ? "border-critical/40 bg-critical-tint text-critical"
                : "border-rule bg-surface-mute text-ink",
            )}
          >
            {message}
          </p>
        ) : null}

        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {sections.map((row, index) => (
            <li
              key={row.section}
              className={cn(
                "rounded-control border border-rule p-3",
                !row.isActive && "bg-surface-mute",
              )}
            >
              <div className="flex items-start gap-3">
                <span className="tabular mt-1.5 w-5 shrink-0 text-body-sm text-ink-faint">
                  {index + 1}
                </span>

                <div className="min-w-0 flex-1">
                  {editing === row.section ? (
                    <form
                      action={renameAction}
                      onSubmit={() => setEditing(null)}
                      className="flex items-center gap-2"
                    >
                      <input type="hidden" name="section" value={row.section} />
                      <Input
                        name="label"
                        defaultValue={row.label}
                        autoFocus
                        maxLength={80}
                        aria-label={`Name for ${row.label}`}
                        className="min-h-11 border-rule bg-surface"
                      />
                      <Button type="submit" size="sm" className="min-h-11 shrink-0">
                        Save
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="min-h-11 shrink-0"
                        onClick={() => setEditing(null)}
                      >
                        Cancel
                      </Button>
                    </form>
                  ) : (
                    <>
                      <p
                        className={cn(
                          "text-body",
                          row.isActive ? "text-ink" : "text-ink-muted line-through",
                        )}
                      >
                        {row.label}
                      </p>
                      <p className="type-label mt-0.5 text-ink-faint">
                        {row.questionCount}{" "}
                        {row.questionCount === 1 ? "question" : "questions"}
                        {row.isActive ? "" : " · parked"}
                      </p>
                    </>
                  )}
                </div>

                {editing === row.section ? null : (
                  <div className="flex shrink-0 items-center gap-0.5">
                    {[-1, 1].map((direction) => {
                      const next = orderWith(index, direction as -1 | 1);
                      return (
                        <form key={direction} action={orderAction}>
                          <input type="hidden" name="sections" value={next ?? ""} />
                          <Button
                            type="submit"
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            disabled={!next}
                            aria-label={`Move ${row.label} ${direction === -1 ? "up" : "down"}`}
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
                      onClick={() => setEditing(row.section)}
                    >
                      Rename
                    </Button>

                    <form action={activeAction}>
                      <input type="hidden" name="section" value={row.section} />
                      <input type="hidden" name="is_active" value={String(!row.isActive)} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="icon"
                        className="size-8 text-ink-faint"
                        aria-label={row.isActive ? `Park ${row.label}` : `Restore ${row.label}`}
                        title={row.isActive ? "Take off the form" : "Put back on the form"}
                      >
                        {row.isActive ? (
                          <EyeOff className="size-4" aria-hidden />
                        ) : (
                          <Eye className="size-4" aria-hidden />
                        )}
                      </Button>
                    </form>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>

        <DialogFooter>
          <Button
            className="min-h-11"
            onClick={() => {
              // Refreshed on close rather than after every action: the panes
              // behind this dialog read the labels, and re-fetching them on each
              // keystroke would make the list jump under the person editing it.
              router.refresh();
              onOpenChange(false);
            }}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Shown while a section list is loading. Kept here so the dialog owns its own states. */
export function SectionsDialogSkeleton() {
  return (
    <div className="flex items-center gap-2 p-6 text-body-sm text-ink-muted">
      <Loader2 aria-hidden className="size-4 animate-spin" />
      Loading the form structure…
    </div>
  );
}
