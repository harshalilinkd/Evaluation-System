/** Conditional-question visibility. Pure — no database, no request context. */

// Deliberately free of runtime imports so this can be exercised directly, and
// reused by P4's validator, which must skip hidden questions for exactly the
// same reasons the renderer must not draw them (§6: hidden questions are
// neither validated nor stored).

export type ConditionRow = {
  question_id: string;
  depends_on: string | null;
  depends_value: string | null;
};

/**
 * Does `answer` satisfy `dependsValue`?
 *
 * depends_value is text because one column serves a BOOLEAN, a SINGLE_SELECT
 * and a SCALE_0_5 parent (§6). Comparison is therefore string-based, trimmed and
 * case-insensitive, so a BOOLEAN stored as `true` matches a condition authored
 * as "true", "True" or "TRUE".
 *
 * A MULTI_SELECT parent matches when the value appears anywhere in its array.
 *
 * SEVERAL ACCEPTABLE VALUES, separated by `|`.
 *
 * The column held exactly one value, and that made "show this when Promotion is
 * Yes OR Can be considered" — the manager's hike percent — inexpressible as
 * data. The alternatives were worse: a second column to keep in step with the
 * first, or a bespoke branch in the renderer, which is the one component P9-1
 * keeps single because every form in the product draws through it.
 *
 * `|` rather than a comma, because an option label may legitimately contain a
 * comma ("Yes, with training") and none of them contains a pipe. A value with
 * no pipe behaves exactly as before, so every existing condition — including
 * the ones already frozen into launched snapshots (§5) — is untouched.
 */
export function matchesDependency(answer: unknown, dependsValue: string): boolean {
  if (answer === null || answer === undefined) return false;

  const targets = dependsValue
    .split("|")
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length > 0);

  if (targets.length === 0) return false;

  if (Array.isArray(answer)) {
    return answer.some((entry) => targets.includes(String(entry).trim().toLowerCase()));
  }

  // An object answer has no sensible scalar comparison; treat as unmatched
  // rather than stringifying it into "[object Object]" and pretending.
  if (typeof answer === "object") return false;

  // An empty string is a real answer to a text question but can never satisfy a
  // condition, and String(false) === "false" matches a "false" condition, which
  // is intended.
  return targets.includes(String(answer).trim().toLowerCase());
}

/**
 * Visibility of every row, resolved against the answers given so far.
 *
 * Two rules beyond the obvious one:
 *
 *   • A hidden parent hides its children, transitively. Otherwise "If yes,
 *     please specify" could surface under a question the evaluatee was never
 *     shown — which is how a required-but-invisible field appears and blocks a
 *     submit with no visible cause.
 *
 *   • A dependency cycle resolves to hidden rather than recursing forever. The
 *     database already forbids self-reference (questions_depends_not_self), and
 *     nothing in the UI can build a longer loop, but a request must not hang if
 *     one ever reaches the data.
 */
export function resolveVisibility(
  rows: readonly ConditionRow[],
  answers: Readonly<Record<string, unknown>>,
): Map<string, boolean> {
  const byQuestionId = new Map(rows.map((row) => [row.question_id, row]));
  const resolved = new Map<string, boolean>();

  function visit(questionId: string, seen: Set<string>): boolean {
    const cached = resolved.get(questionId);
    if (cached !== undefined) return cached;

    if (seen.has(questionId)) return false;
    seen.add(questionId);

    const row = byQuestionId.get(questionId);
    // A parent outside this row set cannot be evaluated. Unconditional rows are
    // visible; a dependant whose parent is missing is not.
    if (!row) return false;

    let visible: boolean;
    if (row.depends_on === null || row.depends_value === null) {
      visible = true;
    } else if (!visit(row.depends_on, seen)) {
      visible = false;
    } else {
      visible = matchesDependency(answers[row.depends_on], row.depends_value);
    }

    resolved.set(questionId, visible);
    return visible;
  }

  for (const row of rows) visit(row.question_id, new Set());

  return resolved;
}
