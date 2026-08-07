/** A tab-local mirror of a half-filled rating form, so a reload cannot lose it. */

/*
 * §13.6: "Never lose a half-filled form." Autosave is how that is normally
 * kept, but autosave is a network call, and until it lands the ONLY copy of
 * somebody's answers is React state — which a refresh destroys. That is the
 * whole failure: the form is full, the tab reloads, and it comes back empty
 * because the server was never given anything to hand back.
 *
 * So the draft is mirrored locally on every keystroke and merged back on load.
 *
 * WHY sessionStorage AND NOT localStorage.
 * These are appraisal ratings — a HOD rating twelve reports, or somebody's own
 * self-assessment. §5 keeps each layer away from the other side, and a shared
 * office machine is exactly where that gets tested. sessionStorage is scoped to
 * the tab and is dropped when the tab closes, so the data is gone the moment
 * the person walks away; localStorage would leave every draft they have ever
 * typed sitting in the browser for the next user to open devtools on.
 *
 * It still survives a reload — including a hard reload — which is the case this
 * exists for. The trade is deliberate: it protects against the accident, not
 * against closing the tab, and closing a tab is not an accident in the way that
 * hitting refresh is.
 *
 * This is a SAFETY NET, never a source of truth. The server's copy is what is
 * scored and what §5 freezes; this only fills in what has not reached it yet.
 */

export type CachedDraft = {
  answers: Record<string, unknown>;
  comments: Record<string, string>;
  /** Epoch ms, for the "restored" line. Not used to resolve conflicts. */
  at: number;
};

type Layer = "SELF" | "LEAD";

/** Keyed by evaluation AND layer: a HOD who is also an employee has both. */
export function draftKey(evaluationId: string, layer: Layer): string {
  return `appraise.draft.${layer}.${evaluationId}`;
}

/*
 * Every access is wrapped. Storage throws rather than returning null in more
 * cases than is comfortable — Safari private browsing, a full quota, an
 * embedded webview with storage disabled — and a form that will not render
 * because its safety net could not be read is worse than no safety net.
 */

export function readDraft(key: string): CachedDraft | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const draft = parsed as Partial<CachedDraft>;
    if (typeof draft.answers !== "object" || draft.answers === null) return null;
    return {
      answers: draft.answers as Record<string, unknown>,
      comments:
        typeof draft.comments === "object" && draft.comments !== null
          ? (draft.comments as Record<string, string>)
          : {},
      at: typeof draft.at === "number" ? draft.at : 0,
    };
  } catch {
    return null;
  }
}

export function writeDraft(
  key: string,
  answers: Record<string, unknown>,
  comments: Record<string, string>,
): void {
  try {
    sessionStorage.setItem(key, JSON.stringify({ answers, comments, at: Date.now() }));
  } catch {
    // Out of quota, or storage refused. The network copy is still being
    // attempted; losing the mirror is not worth interrupting somebody for.
  }
}

export function clearDraft(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* nothing to do, and nothing worth saying */
  }
}

/* ---------- Reading it once, the way this codebase reads browser state ---------- */
/*
 * sessionStorage does not exist while the page is server-rendered, so the draft
 * cannot seed `useState` — the two renders would disagree and hydration would
 * mismatch on the very fields being restored. `useSyncExternalStore` with a
 * server snapshot is the sanctioned answer here (color-swatch.tsx,
 * resizable-panes.tsx, theme.tsx all do this), and it keeps the restore out of
 * an effect, which the React compiler rejects for cascading renders.
 *
 * The snapshot is FROZEN per key. The mirror is rewritten on every keystroke,
 * but the only version that matters is the one that was in the tab when the
 * page loaded — and `getSnapshot` must return a stable reference or
 * `useSyncExternalStore` re-renders forever (the trap resizable-panes.tsx
 * records).
 */

const mountSnapshots = new Map<string, CachedDraft | null>();

export function mountDraftSnapshot(key: string): CachedDraft | null {
  if (!mountSnapshots.has(key)) mountSnapshots.set(key, readDraft(key));
  return mountSnapshots.get(key) ?? null;
}

/** Dropped on unmount, so returning to a form re-reads rather than replaying a stale load. */
export function forgetMountDraft(key: string): void {
  mountSnapshots.delete(key);
}

/** The value never changes after mount, so there is nothing to subscribe to. */
export const subscribeToNothing = (): (() => void) => () => {};

/** No storage on the server, and the same answer every time it is asked. */
export const noDraftOnServer = (): CachedDraft | null => null;

/**
 * What the cached draft holds that the server's copy does not.
 *
 * Only the difference matters. The mirror is written on every keystroke, so it
 * is nearly always a duplicate of what the server already has — announcing a
 * restore every time somebody reloads a saved form would teach them to ignore
 * the one message that means something.
 *
 * Local wins where the two disagree, and that is safe by construction:
 * sessionStorage belongs to this tab, so its contents were typed here and are
 * at least as new as anything this tab has managed to send.
 */
export function unsavedFrom(
  draft: CachedDraft | null,
  serverAnswers: Record<string, unknown>,
  serverComments: Record<string, string>,
): { answers: Record<string, unknown>; comments: Record<string, string>; count: number } | null {
  if (!draft) return null;

  const answers: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(draft.answers)) {
    // JSON comparison: answers are scalars or arrays of option ids (§5's flat
    // shape), so a structural compare is exact here and avoids treating a
    // re-serialised array as a change.
    if (JSON.stringify(serverAnswers[id]) !== JSON.stringify(value)) answers[id] = value;
  }

  const comments: Record<string, string> = {};
  for (const [id, text] of Object.entries(draft.comments)) {
    if ((serverComments[id] ?? "") !== text) comments[id] = text;
  }

  const count = Object.keys(answers).length + Object.keys(comments).length;
  return count === 0 ? null : { answers, comments, count };
}
