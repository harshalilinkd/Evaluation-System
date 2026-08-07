"use client";

/** The two-pane Job Specific Skills mapping for one department. */

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown, ChevronUp, Copy, Eye, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SectionCard } from "@/components/appraise/section-card";
import { EmptyState } from "@/components/appraise/states";
import { NeedsQuestionsFlag } from "@/app/(app)/admin/departments/departments-client";
import { PreviewDrawer } from "@/app/(app)/admin/departments/[id]/preview-drawer";
import {
  copyMapping,
  reorderMapping,
  setQuestionMapping,
  type DepartmentActionState,
} from "@/lib/departments/actions";
import { SECTION_LABELS } from "@/lib/forms/labels";
import { cn } from "@/lib/utils";

export type MappableQuestion = {
  id: string;
  text: string;
  helpText: string | null;
  /** Other departments already asking this — reuse is normal, so show it. */
  usedBy: string[];
};

export type MappedQuestion = MappableQuestion & { sortOrder: number };

export type MappingClientProps = {
  department: { id: string; name: string };
  mapped: MappedQuestion[];
  available: MappableQuestion[];
  otherDepartments: { id: string; name: string; count: number }[];
};

function Notice({ state }: { state: DepartmentActionState }) {
  if (!state.error && !state.message) return null;
  const isError = Boolean(state.error);
  return (
    <p
      role={isError ? "alert" : "status"}
      className={cn(
        "rounded-control border px-3 py-2 text-body-sm",
        isError
          ? "border-critical/40 bg-critical-tint text-critical"
          : "border-success/40 bg-success-tint text-success",
      )}
    >
      {state.error ?? state.message}
    </p>
  );
}

export function MappingClient({
  department,
  mapped,
  available,
  otherDepartments,
}: MappingClientProps) {
  const [search, setSearch] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [copyFrom, setCopyFrom] = useState<string>("");

  const [mapState, mapAction] = useActionState<DepartmentActionState, FormData>(
    setQuestionMapping,
    {},
  );
  const [orderState, orderAction] = useActionState<DepartmentActionState, FormData>(
    reorderMapping,
    {},
  );
  const [copyState, copyAction] = useActionState<DepartmentActionState, FormData>(copyMapping, {});

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return available;
    return available.filter(
      (q) =>
        q.text.toLowerCase().includes(needle) || (q.helpText ?? "").toLowerCase().includes(needle),
    );
  }, [available, search]);

  const mappedIds = mapped.map((q) => q.id);
  const source = otherDepartments.find((d) => d.id === copyFrom) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm" className="min-h-11">
          <Link href="/admin/departments">
            <ArrowLeft className="size-4" />
            All departments
          </Link>
        </Button>
        {mapped.length === 0 ? <NeedsQuestionsFlag /> : null}
      </div>

      {/* The explanatory header. This screen is the one place HR could
          reasonably believe they are editing the whole form. */}
      <div className="card-surface space-y-2 p-5">
        <h2 className="text-display-sm text-ink">
          {SECTION_LABELS.DEPARTMENT_SPECIFIC} · {department.name}
        </h2>
        <p className="max-w-form text-body text-ink-muted">
          Every employee answers the same evaluation form. This screen sets the questions in the{" "}
          {SECTION_LABELS.DEPARTMENT_SPECIFIC} section for the {department.name} team — that is the
          only part of the form that changes by department.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="outline" className="min-h-11" onClick={() => setPreviewOpen(true)}>
            <Eye className="size-4" />
            Preview the full form
          </Button>
          <Button asChild variant="ghost" className="min-h-11">
            <Link href="/admin/questions">
              <Plus className="size-4" />
              Add a new question
            </Link>
          </Button>
        </div>
      </div>

      <Notice state={mapState} />
      <Notice state={orderState} />
      <Notice state={copyState} />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ---------- Left: available ---------- */}
        <SectionCard
          title="Available questions"
          description={`${SECTION_LABELS.DEPARTMENT_SPECIFIC} questions not yet asked of this team.`}
        >
          <div className="space-y-3">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search questions"
              aria-label="Search available questions"
              className="min-h-11"
            />

            {filtered.length === 0 ? (
              <p className="py-6 text-center text-body-sm text-ink-faint">
                {available.length === 0
                  ? "Every question in the bank is already asked of this team."
                  : "Nothing matches that search."}
              </p>
            ) : (
              <ul className="space-y-2">
                {filtered.map((q) => (
                  <li
                    key={q.id}
                    className="flex items-start justify-between gap-3 rounded-control border border-rule p-3"
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="text-body text-ink">{q.text}</p>
                      {/* Reuse is normal and should be encouraged visually — a
                          question already trusted by three teams is a safer
                          choice than a brand new one. */}
                      {q.usedBy.length > 0 ? (
                        <p className="text-body-sm text-ink-faint">
                          Also asked of {q.usedBy.join(", ")}
                        </p>
                      ) : (
                        <p className="text-body-sm text-ink-faint">Not used anywhere yet</p>
                      )}
                    </div>
                    <form action={mapAction}>
                      <input type="hidden" name="department_id" value={department.id} />
                      <input type="hidden" name="question_id" value={q.id} />
                      <input type="hidden" name="attach" value="true" />
                      <Button type="submit" size="sm" className="min-h-11 shrink-0">
                        Add
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SectionCard>

        {/* ---------- Right: mapped ---------- */}
        <SectionCard
          title={`Asked to the ${department.name} team`}
          description={
            mapped.length === 0
              ? "Nothing yet. A cycle cannot be launched until there is at least one."
              : `${mapped.length} ${mapped.length === 1 ? "question" : "questions"}, in this order.`
          }
        >
          {mapped.length === 0 ? (
            <EmptyState
              title="No questions yet"
              body="Add one from the left, or copy the set from another department."
            />
          ) : (
            <ol className="space-y-2">
              {mapped.map((q, index) => (
                <li
                  key={q.id}
                  className="flex items-start gap-2 rounded-control border border-rule p-3"
                >
                  <span className="tabular pt-1 text-body-sm text-ink-faint">{index + 1}</span>

                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-body text-ink">{q.text}</p>
                    {q.usedBy.length > 0 ? (
                      <p className="text-body-sm text-ink-faint">
                        Also asked of {q.usedBy.join(", ")}
                      </p>
                    ) : null}
                  </div>

                  {/* Keyboard alternative to drag. These are the primary
                      controls, not a fallback: a pointer-only reorder fails
                      §13.8's keyboard requirement outright. */}
                  <div className="flex shrink-0 items-center gap-1">
                    <form action={orderAction}>
                      <input type="hidden" name="department_id" value={department.id} />
                      <input
                        type="hidden"
                        name="ids"
                        value={JSON.stringify(swap(mappedIds, index, index - 1))}
                      />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="icon"
                        className="min-h-11"
                        aria-label={`Move "${q.text}" up`}
                        disabled={index === 0}
                      >
                        <ChevronUp className="size-4" />
                      </Button>
                    </form>
                    <form action={orderAction}>
                      <input type="hidden" name="department_id" value={department.id} />
                      <input
                        type="hidden"
                        name="ids"
                        value={JSON.stringify(swap(mappedIds, index, index + 1))}
                      />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="icon"
                        className="min-h-11"
                        aria-label={`Move "${q.text}" down`}
                        disabled={index === mapped.length - 1}
                      >
                        <ChevronDown className="size-4" />
                      </Button>
                    </form>
                    <form action={mapAction}>
                      <input type="hidden" name="department_id" value={department.id} />
                      <input type="hidden" name="question_id" value={q.id} />
                      <input type="hidden" name="attach" value="false" />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="icon"
                        className="min-h-11"
                        aria-label={`Remove "${q.text}" from ${department.name}`}
                      >
                        <X className="size-4" />
                      </Button>
                    </form>
                  </div>
                </li>
              ))}
            </ol>
          )}

          <p className="pt-4 text-body-sm text-ink-faint">
            Changes apply to future cycles. Evaluations already launched keep the questions they
            were launched with.
          </p>
        </SectionCard>
      </div>

      {/* ---------- Copy from another department ---------- */}
      {otherDepartments.length > 0 ? (
        <SectionCard
          title="Copy from another department"
          description="Adds anything this team does not already ask. Nothing is removed or reordered."
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] space-y-1">
              <span className="type-label block text-ink-faint">Copy from</span>
              <Select value={copyFrom} onValueChange={setCopyFrom}>
                <SelectTrigger className="min-h-11 border-rule bg-surface">
                  <SelectValue placeholder="Choose a department" />
                </SelectTrigger>
                <SelectContent>
                  {otherDepartments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name} ({d.count})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <CopyConfirm
              department={department}
              source={source}
              alreadyHave={mapped.length}
              action={copyAction}
            />
          </div>
        </SectionCard>
      ) : null}

      <PreviewDrawer
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        departmentId={department.id}
        departmentName={department.name}
      />
    </div>
  );
}

function CopyConfirm({
  department,
  source,
  alreadyHave,
  action,
}: {
  department: { id: string; name: string };
  source: { id: string; name: string; count: number } | null;
  alreadyHave: number;
  action: (formData: FormData) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        className="min-h-11"
        disabled={!source}
        onClick={() => setOpen(true)}
      >
        <Copy className="size-4" />
        Copy questions
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-surface">
          <DialogHeader>
            <DialogTitle className="text-display-md">
              Copy from {source?.name} to {department.name}?
            </DialogTitle>
            <DialogDescription className="text-body text-ink-muted">
              This only adds. Nothing {department.name} already asks is removed or reordered.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <p className="text-body text-ink">
              <span className="tabular font-semibold">{source?.count ?? 0}</span> questions in{" "}
              {source?.name}.
            </p>
            <p className="text-body text-ink-muted">
              {department.name} currently asks{" "}
              <span className="tabular">{alreadyHave}</span>. Anything already shared between the two
              is left exactly where it is.
            </p>
          </div>

          <DialogFooter>
            <Button variant="ghost" className="min-h-11" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <form action={action} onSubmit={() => setOpen(false)}>
              <input type="hidden" name="department_id" value={department.id} />
              <input type="hidden" name="from_department_id" value={source?.id ?? ""} />
              <Button type="submit" className="min-h-11" disabled={(source?.count ?? 0) === 0}>
                Copy questions
              </Button>
            </form>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
