/** Form-builder state and CRUD. Owns the draft, the autosave and the ordering. */

"use client";

import * as React from "react";

import { DEPARTMENT_SECTION } from "@/lib/forms/labels";
import type { QuestionSection, ResponseType } from "@/lib/forms/types";
import { reorderQuestions, saveQuestion, setQuestionActive } from "@/lib/questions/actions";

export type BuilderQuestion = {
  id: string;
  text: string;
  helpText: string | null;
  section: QuestionSection;
  responseType: ResponseType;
  category: string;
  answeredBy: string;
  isRequired: boolean;
  dependsOn: string | null;
  dependsValue: string | null;
  sortOrder: number;
};

export type BuilderOption = {
  questionId: string;
  label: string;
  value: string;
  sortOrder: number;
};

export type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: Date }
  | { kind: "error"; message: string };

/**
 * A brand-new question has to be valid the instant it is created, because it is
 * written to the database immediately rather than held in a modal until it is
 * complete. `questionFormSchema` demands five characters, so the placeholder is
 * a real sentence — and one that reads as obviously unfinished, so nobody ships
 * a cycle with it still in place.
 */
const NEW_QUESTION_TEXT = "New question — write it here";

/** The autosave debounce. Long enough to coalesce a sentence being typed. */
const SAVE_DEBOUNCE_MS = 900;

function buildFormData(
  q: BuilderQuestion,
  extras: { departmentIds: string[]; options: BuilderOption[] },
): FormData {
  const fd = new FormData();
  if (q.id && !q.id.startsWith("draft:")) fd.set("id", q.id);
  fd.set("text", q.text);
  fd.set("help_text", q.helpText ?? "");
  fd.set("section", q.section);
  fd.set("response_type", q.responseType);
  fd.set("answered_by", q.answeredBy);
  // The core module is STAFF-only (§5's module boundary), and 0008's CHECK
  // refuses anything else. Never read from the client.
  fd.set("track", "STAFF");
  fd.set("category", q.category);
  fd.set("is_required", q.isRequired ? "true" : "false");
  fd.set("options", JSON.stringify(extras.options.map((o) => ({ label: o.label, value: o.value }))));
  if (q.dependsOn) {
    fd.set("depends_on", q.dependsOn);
    fd.set("depends_value", q.dependsValue ?? "true");
  }
  for (const id of extras.departmentIds) fd.append("department_ids", id);
  return fd;
}

export function useBuilder({
  initialQuestions,
  initialOptions,
  initialMappings,
  departmentId,
}: {
  initialQuestions: BuilderQuestion[];
  initialOptions: BuilderOption[];
  initialMappings: Array<{ departmentId: string; questionId: string; sortOrder: number }>;
  departmentId: string;
}) {
  const [draft, setDraft] = React.useState<BuilderQuestion[]>(initialQuestions);
  const [options, setOptions] = React.useState<BuilderOption[]>(initialOptions);
  const [mappings, setMappings] = React.useState(initialMappings);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [save, setSave] = React.useState<SaveState>({ kind: "idle" });
  const [pendingIds, setPendingIds] = React.useState<ReadonlySet<string>>(new Set());

  /* -- The server is the source of truth for rows, not for keystrokes.
        A refetch (revalidatePath fires after every save) must not overwrite a
        field the person is still typing into, so incoming rows are MERGED rather
        than assigned: anything currently queued for save keeps its local value.

        Adjusted during render against the previous props, which is React's
        documented way to react to a prop change. The obvious alternative — an
        effect calling setState — is the cascading-render pattern the React
        compiler rejects, and it also renders once with the stale value first,
        which here means a character visibly disappearing and coming back. -- */
  // State, not a ref: the merge below reads it DURING render, and a ref read at
  // render time is exactly the thing that fails to re-render when it changes.
  const [dirty, setDirty] = React.useState<ReadonlySet<string>>(new Set());
  const [seen, setSeen] = React.useState({
    questions: initialQuestions,
    options: initialOptions,
    mappings: initialMappings,
  });

  if (
    seen.questions !== initialQuestions ||
    seen.options !== initialOptions ||
    seen.mappings !== initialMappings
  ) {
    setSeen({
      questions: initialQuestions,
      options: initialOptions,
      mappings: initialMappings,
    });

    if (seen.questions !== initialQuestions) {
      const local = new Map(draft.map((q) => [q.id, q]));
      const merged = initialQuestions.map((q) =>
        dirty.has(q.id) ? (local.get(q.id) ?? q) : q,
      );
      // A question created locally is not in the server list until it is saved.
      const known = new Set(merged.map((q) => q.id));
      setDraft([...merged, ...draft.filter((q) => !known.has(q.id) && q.id.startsWith("draft:"))]);
    }
    if (seen.options !== initialOptions) setOptions(initialOptions);
    if (seen.mappings !== initialMappings) setMappings(initialMappings);
  }

  const timers = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const departmentIdsFor = React.useCallback(
    (questionId: string) =>
      mappings.filter((m) => m.questionId === questionId).map((m) => m.departmentId),
    [mappings],
  );

  /* ---------- The write ---------- */

  const commit = React.useCallback(
    async (question: BuilderQuestion) => {
      setSave({ kind: "saving" });
      setPendingIds((s) => new Set(s).add(question.id));

      const isDept = question.section === DEPARTMENT_SECTION;
      const fd = buildFormData(question, {
        // A Job Specific Skills question with no department is asked of nobody
        // and the schema refuses it. A newly added one is mapped to whichever
        // department is on screen, which is the only one HR can have meant.
        departmentIds: isDept
          ? (departmentIdsFor(question.id).length > 0
              ? departmentIdsFor(question.id)
              : [departmentId])
          : [],
        options: options.filter((o) => o.questionId === question.id),
      });

      const result = await saveQuestion({}, fd);

      setPendingIds((s) => {
        const next = new Set(s);
        next.delete(question.id);
        return next;
      });

      if (result.error) {
        setSave({ kind: "error", message: result.error });
        return null;
      }

      setDirty((prev) => {
        const next = new Set(prev);
        next.delete(question.id);
        return next;
      });
      setSave({ kind: "saved", at: new Date() });

      // A locally created row swaps its placeholder id for the real one, so the
      // next keystroke updates that row instead of inserting a second question.
      if (result.id && question.id.startsWith("draft:")) {
        const realId = result.id;
        setDraft((prev) =>
          prev.map((q) => (q.id === question.id ? { ...q, id: realId } : q)),
        );
        setOptions((prev) =>
          prev.map((o) => (o.questionId === question.id ? { ...o, questionId: realId } : o)),
        );
        setMappings((prev) =>
          prev.map((m) => (m.questionId === question.id ? { ...m, questionId: realId } : m)),
        );
        setSelectedId((id) => (id === question.id ? realId : id));
        return realId;
      }
      return result.id ?? question.id;
    },
    [departmentId, departmentIdsFor, options],
  );

  /** Queues a save for one question, coalescing a burst of keystrokes. */
  const queueSave = React.useCallback(
    (question: BuilderQuestion) => {
      setDirty((prev) => new Set(prev).add(question.id));
      const existing = timers.current.get(question.id);
      if (existing) clearTimeout(existing);
      timers.current.set(
        question.id,
        setTimeout(() => {
          timers.current.delete(question.id);
          void commit(question);
        }, SAVE_DEBOUNCE_MS),
      );
    },
    [commit],
  );

  /* ---------- Edit ---------- */

  const patch = React.useCallback(
    (id: string, changes: Partial<BuilderQuestion>) => {
      setDraft((prev) => {
        const next = prev.map((q) => (q.id === id ? { ...q, ...changes } : q));
        const updated = next.find((q) => q.id === id);
        if (updated) queueSave(updated);
        return next;
      });
    },
    [queueSave],
  );

  /* ---------- Create ---------- */

  const addQuestion = React.useCallback(
    (section: QuestionSection) => {
      const isDept = section === DEPARTMENT_SECTION;
      const localId = `draft:${globalThis.crypto.randomUUID()}`;
      const last = Math.max(
        0,
        ...draft.filter((q) => q.section === section).map((q) => q.sortOrder),
      );
      const created: BuilderQuestion = {
        id: localId,
        text: NEW_QUESTION_TEXT,
        helpText: null,
        section,
        // §1 makes the section and the category one decision: Job Specific
        // Skills IS the department-varying section (P8P-5). Two controls that
        // must agree are two controls that eventually disagree.
        category: isDept ? "DEPARTMENT" : "CORE",
        responseType: "SCALE_0_5",
        answeredBy: "EMPLOYEE_AND_LEAD",
        isRequired: true,
        dependsOn: null,
        dependsValue: null,
        sortOrder: last + 10,
      };
      setDraft((prev) => [...prev, created]);
      setSelectedId(localId);
      if (isDept) {
        setMappings((prev) => [
          ...prev,
          { departmentId, questionId: localId, sortOrder: last + 10 },
        ]);
      }
      // Written immediately rather than on first edit, so a half-made question
      // survives a refresh instead of vanishing with no explanation.
      void commit(created);
      return localId;
    },
    [commit, departmentId, draft],
  );

  /* ---------- Remove ---------- */

  /**
   * §17: a question is retired, never deleted. Historic responses key off its id
   * and launched evaluations hold their own frozen copy — the word on the button
   * is "Remove", because that is what it does to the FORM, but nothing is lost.
   */
  const removeQuestion = React.useCallback(
    async (id: string) => {
      const gone = draft.find((q) => q.id === id) ?? null;

      setDraft((prev) => prev.filter((q) => q.id !== id));
      setSelectedId((current) => (current === id ? null : current));

      if (id.startsWith("draft:")) return gone; // never reached the database

      setSave({ kind: "saving" });
      const fd = new FormData();
      fd.set("id", id);
      fd.set("is_active", "false");
      const result = await setQuestionActive({}, fd);

      if (result.error) {
        // Put it back. A row that disappeared from the screen but not from the
        // database is the worst of both, and the next refetch would resurrect it
        // anyway with no explanation of why.
        if (gone) setDraft((prev) => [...prev, gone]);
        setSave({ kind: "error", message: result.error });
        return null;
      }
      setSave({ kind: "saved", at: new Date() });
      return gone;
    },
    [draft],
  );

  /** Undo for the action above — the same audited path, in reverse. */
  const restoreQuestion = React.useCallback(async (question: BuilderQuestion) => {
    setDraft((prev) => (prev.some((q) => q.id === question.id) ? prev : [...prev, question]));
    if (question.id.startsWith("draft:")) return;
    const fd = new FormData();
    fd.set("id", question.id);
    fd.set("is_active", "true");
    const result = await setQuestionActive({}, fd);
    setSave(
      result.error
        ? { kind: "error", message: result.error }
        : { kind: "saved", at: new Date() },
    );
  }, []);

  /* ---------- Reorder ---------- */

  /**
   * The one write path for ordering. Both the buttons and the drag end here, so
   * the optimistic renumbering and the stored numbers cannot disagree.
   */
  const persistOrder = React.useCallback(
    async (section: QuestionSection, ordered: BuilderQuestion[]) => {
      // Steps of 10, matching the action, so a refetch does not visibly re-sort.
      const renumbered = new Map(ordered.map((q, i) => [q.id, (i + 1) * 10]));
      setDraft((prev) =>
        prev.map((q) => {
          const next = renumbered.get(q.id);
          return next === undefined ? q : { ...q, sortOrder: next };
        }),
      );

      const saved = ordered.filter((q) => !q.id.startsWith("draft:"));
      if (saved.length === 0) return;

      setSave({ kind: "saving" });
      const fd = new FormData();
      fd.set("section", section);
      fd.set("track", "STAFF");
      fd.set("ids", JSON.stringify(saved.map((q) => q.id)));
      const result = await reorderQuestions({}, fd);
      setSave(
        result.error
          ? { kind: "error", message: result.error }
          : { kind: "saved", at: new Date() },
      );
    },
    [],
  );

  /**
   * Moves one question within its section. Up/down rather than pointer-drag
   * alone: buttons work by keyboard and on a phone (P8-6, P9-5). The pane also
   * supports dragging, and both end here so there is one write path.
   */
  const moveQuestion = React.useCallback(
    async (id: string, direction: -1 | 1) => {
      const question = draft.find((q) => q.id === id);
      if (!question) return;

      const siblings = draft
        .filter((q) => q.section === question.section)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      const index = siblings.findIndex((q) => q.id === id);
      const target = index + direction;
      if (target < 0 || target >= siblings.length) return;

      const reordered = [...siblings];
      const [moved] = reordered.splice(index, 1);
      if (!moved) return;
      reordered.splice(target, 0, moved);

      await persistOrder(question.section, reordered);
    },
    [draft, persistOrder],
  );

  /** Drops a dragged question at an index within its section. */
  const reorderSection = React.useCallback(
    async (section: QuestionSection, orderedIds: string[]) => {
      const bySection = draft.filter((q) => q.section === section);
      const ordered = orderedIds
        .map((id) => bySection.find((q) => q.id === id))
        .filter((q): q is BuilderQuestion => q !== undefined);
      if (ordered.length !== bySection.length) return;
      await persistOrder(section, ordered);
    },
    [draft, persistOrder],
  );

  /* ---------- Options (Pick one) ---------- */

  const setQuestionOptions = React.useCallback(
    (questionId: string, next: Array<{ label: string; value: string }>) => {
      setOptions((prev) => [
        ...prev.filter((o) => o.questionId !== questionId),
        ...next.map((o, i) => ({
          questionId,
          label: o.label,
          value: o.value || o.label.toUpperCase().replace(/[^A-Z0-9]+/g, "_"),
          sortOrder: (i + 1) * 10,
        })),
      ]);
      const question = draft.find((q) => q.id === questionId);
      if (question) queueSave(question);
    },
    [draft, queueSave],
  );

  /* ---------- Which teams are asked a Job Specific Skills question ---------- */

  /**
   * Replaced wholesale rather than diffed, matching the action: unticking a
   * department has to actually remove it, and a diff-based update leaves stale
   * mappings that keep asking a team a question HR believes they took away
   * (P8P-6).
   */
  const setDepartments = React.useCallback(
    (questionId: string, ids: string[]) => {
      setMappings((prev) => [
        ...prev.filter((m) => m.questionId !== questionId),
        ...ids.map((departmentId, i) => ({
          departmentId,
          questionId,
          sortOrder: (i + 1) * 10,
        })),
      ]);
      const question = draft.find((q) => q.id === questionId);
      if (question) queueSave(question);
    },
    [draft, queueSave],
  );

  /* -- Flush anything still queued when the tab goes away. iOS Safari does not
        reliably fire unload when an app is backgrounded, which is exactly when
        somebody leaves a half-typed question (P12-11). -- */
  React.useEffect(() => {
    const flush = () => {
      for (const [id, timer] of timers.current) {
        clearTimeout(timer);
        timers.current.delete(id);
        const question = draft.find((q) => q.id === id);
        if (question) void commit(question);
      }
    };
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, [commit, draft]);

  return {
    draft,
    options,
    mappings,
    selectedId,
    setSelectedId,
    save,
    pendingIds,
    patch,
    addQuestion,
    removeQuestion,
    restoreQuestion,
    moveQuestion,
    reorderSection,
    setQuestionOptions,
    setDepartments,
    NEW_QUESTION_TEXT,
  };
}
