"use client";

/** The form builder. P9B — structure, editor and the REAL renderer, side by side. */

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, Loader2, TriangleAlert, Undo2 } from "lucide-react";

import { BuilderTabs } from "@/app/(app)/admin/form-builder/builder-tabs";
import { EditorPane } from "@/app/(app)/admin/form-builder/editor-pane";
import { PreviewPane } from "@/app/(app)/admin/form-builder/preview-pane";
import { StructurePane } from "@/app/(app)/admin/form-builder/structure-pane";
import {
  useBuilder,
  type BuilderOption,
  type BuilderQuestion,
} from "@/app/(app)/admin/form-builder/use-builder";
import { ResizablePanes, usePaneLayout } from "@/components/appraise/resizable-panes";
import { DEPARTMENT_SECTION, SECTION_ORDER } from "@/lib/forms/labels";
import type { QuestionSection } from "@/lib/forms/types";
import type { FormDefinition, FormQuestion } from "@/lib/forms/types";
import { estimateFill } from "@/lib/questions/estimate";
import { formatTime } from "@/lib/utils/date";

export type { BuilderQuestion };

const PANE_LABELS = ["Form structure", "Question editor", "Live preview"] as const;
const DEFAULT_LAYOUT = [0.22, 0.31, 0.47] as const;

export function BuilderClient({
  questions,
  departments,
  mappings,
  options,
  headcount,
}: {
  questions: BuilderQuestion[];
  departments: Array<{ id: string; name: string; code: string }>;
  mappings: Array<{ departmentId: string; questionId: string; sortOrder: number }>;
  options: BuilderOption[];
  headcount: Record<string, number>;
}) {
  const [departmentId, setDepartmentId] = React.useState(departments[0]?.id ?? "");
  const [audience, setAudience] = React.useState<"SELF" | "LEAD">("SELF");
  const [phone, setPhone] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);
  const [undo, setUndo] = React.useState<BuilderQuestion | null>(null);
  // Lifted out of StructurePane: the preview scrolls to whichever section is
  // open, so both panes must read the same value rather than each holding one.
  const [openSection, setOpenSection] = React.useState<QuestionSection | null>("CORE_PERFORMANCE");
  const reduced = useReducedMotion();

  const builder = useBuilder({
    initialQuestions: questions,
    initialOptions: options,
    initialMappings: mappings,
    departmentId,
  });

  const { layout, setLayout } = usePaneLayout("appraise.form-builder.panes", DEFAULT_LAYOUT);

  const mappedIds = React.useMemo(
    () =>
      new Set(
        builder.mappings.filter((m) => m.departmentId === departmentId).map((m) => m.questionId),
      ),
    [builder.mappings, departmentId],
  );

  /* -- The questions this department actually asks. Every other section is
        drawn from the same CORE list regardless of department, which is what
        makes §1's "identical company-wide" true by construction (P9B-3). -- */
  const forDepartment = React.useMemo(
    () =>
      builder.draft.filter((q) =>
        q.section === DEPARTMENT_SECTION ? mappedIds.has(q.id) : q.category === "CORE",
      ),
    [builder.draft, mappedIds],
  );

  const estimate = React.useMemo(() => estimateFill(forDepartment), [forDepartment]);

  /* -- The preview form. A real FormDefinition for the real renderer. -- */
  const previewForm: FormDefinition = React.useMemo(() => {
    const allowed =
      audience === "LEAD"
        ? ["EMPLOYEE_AND_LEAD", "LEAD_ONLY"]
        : ["EMPLOYEE_AND_LEAD", "EMPLOYEE_ONLY"];

    const visible = forDepartment
      .filter((q) => allowed.includes(q.answeredBy))
      .sort(
        (a, b) =>
          SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section) ||
          a.sortOrder - b.sortOrder,
      );

    const toFormQuestion = (q: BuilderQuestion): FormQuestion => ({
      questionId: q.id,
      text: q.text,
      helpText: q.helpText,
      section: q.section,
      responseType: q.responseType,
      answeredBy: q.answeredBy as FormQuestion["answeredBy"],
      isRequired: q.isRequired,
      minValue: null,
      maxValue: null,
      dependsOn: q.dependsOn,
      dependsValue: q.dependsValue,
      options: builder.options
        .filter((o) => o.questionId === q.id)
        .map((o) => ({ label: o.label, value: o.value, sort_order: o.sortOrder })),
      sortOrder: q.sortOrder,
    });

    return {
      evaluationId: "preview",
      layer: audience,
      evaluationStatus: "CYCLE_ACTIVE",
      track: "STAFF",
      sections: SECTION_ORDER.map((section) => ({
        section,
        questions: visible.filter((q) => q.section === section).map(toFormQuestion),
      })).filter((s) => s.questions.length > 0),
      questions: visible.map(toFormQuestion),
      answers: {},
      comments: {},
      isSubmitted: false,
      submittedAt: null,
      // A conditional child is SHOWN in the preview: HR is reviewing a question
      // set, and the question that would never appear until somebody answers its
      // parent is the one they most need to see (P9-4).
      hiddenQuestionIds: [],
    };
  }, [forDepartment, builder.options, audience]);

  const selected = builder.draft.find((q) => q.id === builder.selectedId) ?? null;
  const departmentName = departments.find((d) => d.id === departmentId)?.name ?? "";

  async function handleRemove(id: string) {
    const removed = await builder.removeQuestion(id);
    if (removed) setUndo(removed);
  }

  return (
    <div
      data-full-bleed
      className="flex h-[calc(100dvh-var(--topbar,64px))] flex-col gap-3 p-3.5"
    >
      {/* ---------- Form Builder / Question Bank ---------- */}
      <div className="shrink-0">
        <BuilderTabs />
      </div>

      {/* ---------- The standing banner ---------- */}
      {/* §5 is the thing HR most often misunderstands, so it returns every
          visit rather than being dismissible for good (P9B-6). */}
      <AnimatePresence initial={false}>
        {!dismissed ? (
          <motion.div
            initial={reduced ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="shrink-0 overflow-hidden"
          >
            <p className="flex items-center justify-between gap-4 rounded-card border border-warning/40 bg-warning-tint px-4 py-2.5 text-body-sm text-ink">
              <span>
                Changes here apply to future cycles. Evaluations already launched keep the questions
                they were launched with.
              </span>
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="shrink-0 text-body-sm font-medium underline underline-offset-2"
              >
                Dismiss
              </button>
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* ---------- Three resizable panes ---------- */}
      {/* Below 1150px the three-column layout stops being three columns —
          the editor and preview stack under the structure list instead of
          two of them being hidden. */}
      <div className="hidden min-h-0 flex-1 xl:flex">
        <ResizablePanes
          layout={layout}
          onLayoutChange={setLayout}
          labels={PANE_LABELS}
          className="flex-1"
        >
          <StructurePane
            draft={builder.draft}
            mappedIds={mappedIds}
            departments={departments}
            departmentId={departmentId}
            onDepartmentChange={setDepartmentId}
            selectedId={builder.selectedId}
            onSelect={builder.setSelectedId}
            openSection={openSection}
            onOpenSectionChange={setOpenSection}
            onAdd={builder.addQuestion}
            onRemove={handleRemove}
            onReorder={builder.reorderSection}
            estimate={estimate}
            headcount={headcount}
          />

          <EditorPane
            question={selected}
            options={builder.options}
            allQuestions={builder.draft}
            departments={departments}
            mappedDepartmentIds={
              selected
                ? builder.mappings
                    .filter((m) => m.questionId === selected.id)
                    .map((m) => m.departmentId)
                : []
            }
            onPatch={(changes) => selected && builder.patch(selected.id, changes)}
            onRemove={() => selected && void handleRemove(selected.id)}
            onOptionsChange={(next) => selected && builder.setQuestionOptions(selected.id, next)}
            onDepartmentsChange={(ids) => selected && builder.setDepartments(selected.id, ids)}
          />

          <PreviewPane
            form={previewForm}
            audience={audience}
            onAudienceChange={setAudience}
            phone={phone}
            onPhoneChange={setPhone}
            departmentName={departmentName}
            questionCount={previewForm.questions.length}
            focusQuestionId={builder.selectedId}
            focusSection={openSection}
          />
        </ResizablePanes>
      </div>

      {/* ---------- Below 1150px: stacked, nothing hidden ---------- */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto xl:hidden">
        <StructurePane
          draft={builder.draft}
          mappedIds={mappedIds}
          departments={departments}
          departmentId={departmentId}
          onDepartmentChange={setDepartmentId}
          selectedId={builder.selectedId}
          onSelect={builder.setSelectedId}
          openSection={openSection}
          onOpenSectionChange={setOpenSection}
          onAdd={builder.addQuestion}
          onRemove={handleRemove}
          onReorder={builder.reorderSection}
          estimate={estimate}
          headcount={headcount}
        />
        <EditorPane
          question={selected}
          options={builder.options}
          allQuestions={builder.draft}
          departments={departments}
          mappedDepartmentIds={
            selected
              ? builder.mappings
                  .filter((m) => m.questionId === selected.id)
                  .map((m) => m.departmentId)
              : []
          }
          onPatch={(changes) => selected && builder.patch(selected.id, changes)}
          onRemove={() => selected && void handleRemove(selected.id)}
          onOptionsChange={(next) => selected && builder.setQuestionOptions(selected.id, next)}
          onDepartmentsChange={(ids) => selected && builder.setDepartments(selected.id, ids)}
        />
        <PreviewPane
          form={previewForm}
          audience={audience}
          onAudienceChange={setAudience}
          phone={phone}
          onPhoneChange={setPhone}
          departmentName={departmentName}
          questionCount={previewForm.questions.length}
          focusQuestionId={builder.selectedId}
          focusSection={openSection}
        />
      </div>

      <SaveBar
        state={builder.save}
        undo={undo}
        onUndo={() => {
          if (undo) void builder.restoreQuestion(undo);
          setUndo(null);
        }}
        onDismissUndo={() => setUndo(null)}
      />
    </div>
  );
}

/* ---------- The save indicator ---------- */
//
// §13.6 wants a visible "Saved HH:MM" and never a lost form. The builder writes
// on a debounce, so the only way somebody can tell the difference between "saved"
// and "about to be lost" is if the screen says which.
function SaveBar({
  state,
  undo,
  onUndo,
  onDismissUndo,
}: {
  state: ReturnType<typeof useBuilder>["save"];
  undo: BuilderQuestion | null;
  onUndo: () => void;
  onDismissUndo: () => void;
}) {
  const reduced = useReducedMotion();

  // The undo offer outranks the save chip: removing a question is the one
  // action here somebody might want back, and §17 keeps the row alive so it
  // genuinely can come back.
  React.useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(onDismissUndo, 9000);
    return () => clearTimeout(timer);
  }, [undo, onDismissUndo]);

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2">
      <AnimatePresence mode="popLayout">
        {undo ? (
          <motion.div
            key="undo"
            initial={reduced ? false : { opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? undefined : { opacity: 0, y: 12, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            className="pointer-events-auto flex items-center gap-3 rounded-full bg-ink py-2 pl-4 pr-2 shadow-dashboard"
          >
            <span className="max-w-[36ch] truncate text-body-sm text-ink-invert">
              Removed “{undo.text}”
            </span>
            <button
              type="button"
              onClick={onUndo}
              className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-body-sm font-semibold text-ink-invert transition-colors hover:bg-white/25"
            >
              <Undo2 aria-hidden className="size-3.5" />
              Undo
            </button>
          </motion.div>
        ) : null}

        {state.kind !== "idle" && !undo ? (
          <motion.div
            key={state.kind}
            initial={reduced ? false : { opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? undefined : { opacity: 0, y: 12, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            role="status"
            aria-live="polite"
            className={
              state.kind === "error"
                ? "pointer-events-auto flex items-center gap-2 rounded-full bg-critical px-4 py-2 text-body-sm font-medium text-white shadow-dashboard"
                : "pointer-events-auto flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-body-sm font-medium text-ink-invert shadow-dashboard"
            }
          >
            {state.kind === "saving" ? (
              <>
                <Loader2 aria-hidden className="size-3.5 animate-spin" />
                Saving…
              </>
            ) : state.kind === "saved" ? (
              <>
                <Check aria-hidden className="size-3.5 text-success" />
                Saved {formatTime(state.at)}
              </>
            ) : (
              <>
                <TriangleAlert aria-hidden className="size-3.5" />
                {state.message}
              </>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
