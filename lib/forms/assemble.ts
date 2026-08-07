/** assembleQuestions — merges CORE and department questions into one ordered list. */

import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  compareAssembledQuestions,
  formsError,
  type AssembledQuestion,
  type FormsResult,
  type SnapshotOption,
} from "@/lib/forms/types";
import type { Enums } from "@/types/database";

/* ---------- Shared select ---------- */

// Written out in full at each call site rather than hoisted into a constant:
// supabase-js parses the select string at the type level, and a concatenated or
// interpolated string degrades every row to GenericStringError. The duplication
// buys full inference on the result, which is worth more than the brevity.

type QuestionRow = {
  id: string;
  text: string;
  help_text: string | null;
  section: AssembledQuestion["section"];
  response_type: AssembledQuestion["responseType"];
  answered_by: AssembledQuestion["answeredBy"];
  is_required: boolean;
  min_value: number | null;
  max_value: number | null;
  depends_on: string | null;
  depends_value: string | null;
  sort_order: number;
  created_at: string;
};

function toAssembled(row: QuestionRow, sortOrder: number): AssembledQuestion {
  return {
    questionId: row.id,
    text: row.text,
    helpText: row.help_text,
    section: row.section,
    responseType: row.response_type,
    answeredBy: row.answered_by,
    isRequired: row.is_required,
    minValue: row.min_value === null ? null : Number(row.min_value),
    maxValue: row.max_value === null ? null : Number(row.max_value),
    dependsOn: row.depends_on,
    dependsValue: row.depends_value,
    options: null, // attached below, only for the select types
    sortOrder,
    createdAt: row.created_at,
  };
}

/**
 * The merged, ordered question list for one person in one cycle.
 *
 * What gets included:
 *   • every active CORE question whose track is the person's track or BOTH
 *   • every DEPARTMENT question mapped to the person's department, same track rule
 *
 * Ordering: section (in the enum order from 0002), then sort_order, then
 * created_at. The last key matters — two questions added to the same section
 * with the same sort_order must still come out in a stable, reproducible order,
 * or two people's forms could differ for no reason.
 *
 * Runs as two queries and merges in TypeScript. A single PostgREST call cannot
 * express "CORE **or** mapped to this department" without an embedded !inner
 * join, which would silently drop every CORE question.
 */
export async function assembleQuestions(
  profileId: string,
  cycleId: string,
): Promise<FormsResult<AssembledQuestion[]>> {
  const supabase = await createClient();

  /* -- The person -- */
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, track, department_id")
    .eq("id", profileId)
    .maybeSingle();

  if (profileError) {
    return formsError("QUERY_FAILED", `Could not read profile: ${profileError.message}`);
  }
  if (!profile) {
    return formsError("PROFILE_NOT_FOUND", `No profile with id ${profileId}.`);
  }

  /* -- The cycle -- */
  const { data: cycle, error: cycleError } = await supabase
    .from("evaluation_cycles")
    .select("id, track_scope")
    .eq("id", cycleId)
    .maybeSingle();

  if (cycleError) {
    return formsError("QUERY_FAILED", `Could not read cycle: ${cycleError.message}`);
  }
  if (!cycle) {
    return formsError("CYCLE_NOT_FOUND", `No evaluation cycle with id ${cycleId}.`);
  }

  // A cycle scoped to one track must not quietly produce an empty form for
  // somebody on the other track — that reads as "HR forgot to add questions"
  // when the real problem is that this person does not belong in this cycle.
  if (cycle.track_scope !== "BOTH" && cycle.track_scope !== profile.track) {
    return formsError(
      "TRACK_OUT_OF_SCOPE",
      `This cycle covers the ${cycle.track_scope} track only, and this person is on the ${profile.track} track.`,
    );
  }

  return assembleForDepartment(profile.department_id, profile.track);
}

/**
 * The merge itself, from a department and a track rather than a person.
 *
 * Split out so the department mapping preview (P9) and the real form (P12) run
 * the *same* code. A preview that assembles differently from the real thing is
 * worse than no preview — it teaches HR to expect something the employee will
 * not see, and the divergence only surfaces once a cycle is live.
 *
 * `departmentId` may be null: a person with no department simply gets no Job
 * Specific Skills questions, rather than another team's.
 */
export async function assembleForDepartment(
  departmentId: string | null,
  track: Enums<"track_type">,
  /**
   * §6's `cycle_scope`. An INCREMENT cycle asks the INCREMENT_ONLY questions —
   * the salary expectation among them — and an evaluation cycle does not.
   *
   * Defaulted to EVALUATION rather than made required: every existing caller is
   * a preview or a plain evaluation, and a default of BOTH would silently put
   * the salary question on a preview of an ordinary form.
   */
  cycleType: "EVALUATION" | "INCREMENT" = "EVALUATION",
): Promise<FormsResult<AssembledQuestion[]>> {
  const supabase = await createClient();

  // §7: a question tagged BOTH applies to either track.
  const tracks = [track, "BOTH"] as const;
  // §6: BOTH applies to either cycle type, exactly as BOTH does for track.
  const scopes =
    cycleType === "INCREMENT" ? (["BOTH", "INCREMENT_ONLY"] as const) : (["BOTH", "EVALUATION_ONLY"] as const);
  const profile = { department_id: departmentId };

  /* -- CORE questions -- */
  const { data: coreRows, error: coreError } = await supabase
    .from("questions")
    .select(
      "id, text, help_text, section, response_type, answered_by, is_required, min_value, max_value, depends_on, depends_value, sort_order, created_at",
    )
    .eq("is_active", true)
    .eq("category", "CORE")
    .in("track", tracks)
    .in("cycle_scope", scopes);

  if (coreError) {
    return formsError("QUERY_FAILED", `Could not read core questions: ${coreError.message}`);
  }

  const assembled: AssembledQuestion[] = (coreRows ?? []).map((row) =>
    toAssembled(row, row.sort_order),
  );

  /* -- DEPARTMENT questions -- */
  // Skipped entirely when the person has no department: there is nothing to map
  // against, and inventing a default would put another team's questions on their
  // form.
  if (profile.department_id) {
    const { data: mappedRows, error: mappedError } = await supabase
      .from("department_questions")
      .select(
        "sort_order, questions!inner(id, text, help_text, section, response_type, answered_by, is_required, min_value, max_value, depends_on, depends_value, sort_order, created_at)",
      )
      .eq("department_id", profile.department_id)
      .eq("questions.is_active", true)
      .in("questions.track", tracks)
      .in("questions.cycle_scope", scopes);

    if (mappedError) {
      return formsError(
        "QUERY_FAILED",
        `Could not read department questions: ${mappedError.message}`,
      );
    }

    for (const mapping of mappedRows ?? []) {
      // The embedded row comes back as an object for a to-one relationship;
      // normalise defensively so a PostgREST shape change cannot crash assembly.
      const embedded = mapping.questions as unknown;
      const question = (Array.isArray(embedded) ? embedded[0] : embedded) as
        | QuestionRow
        | undefined;
      if (!question) continue;

      // department_questions.sort_order wins for mapped questions — that column
      // exists so the same question can sit at a different position for each
      // department. Department questions all live in DEPARTMENT_SPECIFIC, so
      // they never interleave with the bank-ordered CORE ones.
      assembled.push(toAssembled(question, mapping.sort_order));
    }
  }

  /* -- Options for the select types -- */
  const selectIds = assembled
    .filter((q) => q.responseType === "SINGLE_SELECT" || q.responseType === "MULTI_SELECT")
    .map((q) => q.questionId);

  if (selectIds.length > 0) {
    const { data: optionRows, error: optionError } = await supabase
      .from("question_options")
      .select("question_id, label, value, sort_order")
      .in("question_id", selectIds)
      .order("sort_order", { ascending: true });

    if (optionError) {
      return formsError("QUERY_FAILED", `Could not read question options: ${optionError.message}`);
    }

    const byQuestion = new Map<string, SnapshotOption[]>();
    for (const option of optionRows ?? []) {
      const list = byQuestion.get(option.question_id) ?? [];
      list.push({ label: option.label, value: option.value, sort_order: option.sort_order });
      byQuestion.set(option.question_id, list);
    }

    for (const question of assembled) {
      if (question.responseType === "SINGLE_SELECT" || question.responseType === "MULTI_SELECT") {
        question.options = byQuestion.get(question.questionId) ?? [];
      }
    }
  }

  /* -- Order -- */
  assembled.sort(compareAssembledQuestions);

  return { ok: true, data: assembled };
}
