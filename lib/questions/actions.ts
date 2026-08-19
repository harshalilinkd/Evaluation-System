"use server";

/** Question-bank server actions. Every one is HR-guarded and audited (§9, §12). */

import { revalidatePath } from "next/cache";

import { checkRole } from "@/lib/auth/guards";
import { ADMIN_ROLES } from "@/lib/auth/roles";
import { questionFormSchema, reorderSchema } from "@/lib/questions/schema";
import { createClient } from "@/lib/supabase/server";
import type { Enums, Json, TablesInsert } from "@/types/database";

export type QuestionActionState = {
  ok?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  /**
   * The row that was written. The drawer never needed it — it closes on save and
   * the page refetches. The form builder does: it creates a question and must
   * then select it, and without the id back it would have to guess which of the
   * refetched rows is the new one.
   */
  id?: string;
};

function fieldErrorsFrom(issues: { path: PropertyKey[]; message: string }[]) {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

/** Parses the drawer's form payload. Options and the condition ride as JSON. */
function readForm(formData: FormData) {
  const rawOptions = String(formData.get("options") ?? "[]");
  let options: { label: string; value: string }[] = [];
  try {
    const parsed: unknown = JSON.parse(rawOptions);
    if (Array.isArray(parsed)) options = parsed as { label: string; value: string }[];
  } catch {
    options = [];
  }

  const dependsOn = String(formData.get("depends_on") ?? "");
  const dependsValue = String(formData.get("depends_value") ?? "");

  // Which departments are asked this. Only meaningful for Job Specific Skills;
  // authoring and mapping happen in one action so HR never has to remember a
  // second screen (P8-PATCH.9).
  const departmentIds = formData
    .getAll("department_ids")
    .map(String)
    .filter((id) => id.length > 0);

  return {
    department_ids: departmentIds,
    id: formData.get("id") ? String(formData.get("id")) : undefined,
    text: String(formData.get("text") ?? ""),
    help_text: String(formData.get("help_text") ?? ""),
    section: String(formData.get("section") ?? ""),
    response_type: String(formData.get("response_type") ?? ""),
    answered_by: String(formData.get("answered_by") ?? ""),
    track: String(formData.get("track") ?? ""),
    category: String(formData.get("category") ?? "CORE"),
    // Defaults to BOTH, which is the column's own default (0022) and what every
    // question written before this control existed already carries.
    cycle_scope: String(formData.get("cycle_scope") ?? "BOTH"),
    is_required: formData.get("is_required") === "on" || formData.get("is_required") === "true",
    options,
    depends_on: dependsOn === "" ? null : dependsOn,
    depends_value: dependsOn === "" ? null : dependsValue || "true",
  };
}

/* ---------- Create / update ---------- */

/**
 * Saving a question changes what FUTURE forms ask. It cannot change a launched
 * evaluation: those read from evaluation_questions, which is frozen at launch
 * (§5) and has no update policy for anyone, HR included. The banner on the
 * screen says so, and P8's test proves it.
 */
export async function saveQuestion(
  _prev: QuestionActionState,
  formData: FormData,
): Promise<QuestionActionState> {
  const auth = await checkRole(ADMIN_ROLES);
  if (!auth.ok) return { error: auth.error.message };

  const parsed = questionFormSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  }

  const input = parsed.data;
  const supabase = await createClient();

  const row: TablesInsert<"questions"> = {
    text: input.text,
    help_text: input.help_text ? input.help_text : null,
    section: input.section as Enums<"question_section">,
    response_type: input.response_type as Enums<"response_type">,
    answered_by: input.answered_by as Enums<"answered_by">,
    track: input.track as Enums<"track_type">,
    category: input.category as Enums<"question_category">,
    cycle_scope: input.cycle_scope,
    is_required: input.is_required,
    depends_on: input.depends_on,
    depends_value: input.depends_value,
    created_by: auth.session.profile.id,
  };

  let questionId = input.id;
  let before: unknown = null;

  if (questionId) {
    const { data: existing } = await supabase
      .from("questions")
      .select("text, help_text, section, response_type, answered_by, track, cycle_scope, is_required, depends_on, depends_value")
      .eq("id", questionId)
      .maybeSingle();
    before = existing ?? null;

    const { error } = await supabase.from("questions").update(row).eq("id", questionId);
    if (error) return { error: "Could not save that question. Try again." };
  } else {
    // New questions go to the end of their section, so adding one never
    // reshuffles a form HR has already ordered.
    const { data: last } = await supabase
      .from("questions")
      .select("sort_order")
      .eq("section", row.section)
      .eq("track", input.track as Enums<"track_type">)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: created, error } = await supabase
      .from("questions")
      .insert({ ...row, sort_order: (last?.sort_order ?? 0) + 10 })
      .select("id")
      .single();

    if (error || !created) return { error: "Could not create that question. Try again." };
    questionId = created.id;
  }

  /* -- Options -- */
  if (["SINGLE_SELECT", "MULTI_SELECT"].includes(input.response_type)) {
    // Replace wholesale. The value is derived from the label so HR never has to
    // think about a stored code — and existing answers keep working because a
    // relabelled option is a new option, not a silently redefined one.
    await supabase.from("question_options").delete().eq("question_id", questionId);
    await supabase.from("question_options").insert(
      input.options.map((option, index) => ({
        question_id: questionId as string,
        label: option.label,
        value: option.value || option.label.toUpperCase().replace(/[^A-Z0-9]+/g, "_"),
        sort_order: (index + 1) * 10,
      })),
    );
  } else {
    await supabase.from("question_options").delete().eq("question_id", questionId);
  }

  /* -- Department mapping -- */
  // Authored and mapped in one action (P8-PATCH.9). Replaced wholesale so
  // unticking a department actually removes it — a diff-based update would
  // leave stale mappings that keep asking a department a question HR thinks
  // they have taken away.
  await supabase.from("department_questions").delete().eq("question_id", questionId);

  if (input.category === "DEPARTMENT" && input.department_ids.length > 0) {
    const { error: mapError } = await supabase.from("department_questions").insert(
      input.department_ids.map((departmentId, index) => ({
        department_id: departmentId,
        question_id: questionId as string,
        sort_order: (index + 1) * 10,
      })),
    );
    if (mapError) {
      return { error: "The question was saved but the departments were not. Open it and try again." };
    }
  }

  await supabase.rpc("log_admin_action", {
    p_entity: "question",
    p_entity_id: questionId,
    p_action: input.id ? "question.updated" : "question.created",
    p_diff: { before, after: { ...row, department_ids: input.department_ids } } as Json,
  });

  revalidatePath("/admin/questions");
  revalidatePath("/admin/form-builder");
  return {
    ok: true,
    id: questionId,
    message: input.id ? "Question saved." : "Question added.",
  };
}

/* ---------- Deactivate / reactivate ---------- */

/**
 * §17 and §5: a question is deactivated, never deleted. Historic responses key off
 * the question id, and launched evaluations hold their own frozen copy — a hard
 * delete would orphan the first and confuse nobody about the second, because
 * the snapshot would carry on working while the bank quietly lost its history.
 */
export async function setQuestionActive(
  _prev: QuestionActionState,
  formData: FormData,
): Promise<QuestionActionState> {
  const auth = await checkRole(ADMIN_ROLES);
  if (!auth.ok) return { error: auth.error.message };

  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("is_active") ?? "") === "true";
  if (!id) return { error: "No question was selected." };

  const supabase = await createClient();
  const { error } = await supabase.from("questions").update({ is_active: active }).eq("id", id);
  if (error) return { error: "Could not update that question." };

  await supabase.rpc("log_admin_action", {
    p_entity: "question",
    p_entity_id: id,
    p_action: active ? "question.reactivated" : "question.deactivated",
  });

  revalidatePath("/admin/questions");
  revalidatePath("/admin/form-builder");
  return {
    ok: true,
    id,
    message: active
      ? "Question reactivated."
      : "Question deactivated. It will be left off new forms.",
  };
}

/* ---------- Bulk retire / reactivate ---------- */

/** Ids arrive as JSON on the form payload, the same way `reorderQuestions` takes them. */
function readIds(formData: FormData): string[] {
  try {
    const parsed: unknown = JSON.parse(String(formData.get("ids") ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(String).filter((id) => id.length > 0) : [];
  } catch {
    return [];
  }
}

/**
 * Retire or restore several questions at once.
 *
 * This is what "delete" means for a question that has been asked of anybody:
 * §17 and PC-3. The row stays, so historic answers keep the question they were
 * answers to, and every launched evaluation keeps its frozen copy (§5). What
 * changes is that future forms stop asking it.
 */
export async function setQuestionsActive(
  _prev: QuestionActionState,
  formData: FormData,
): Promise<QuestionActionState> {
  const auth = await checkRole(ADMIN_ROLES);
  if (!auth.ok) return { error: auth.error.message };

  const ids = readIds(formData);
  const active = String(formData.get("is_active") ?? "") === "true";
  if (ids.length === 0) return { error: "No questions were selected." };

  const supabase = await createClient();
  const { error } = await supabase.from("questions").update({ is_active: active }).in("id", ids);
  if (error) return { error: "Could not update those questions." };

  // One row per question, not one carrying an array: a retirement is a decision
  // about a question, and somebody asking why this one is off a form should
  // find a row about it rather than unpack a blob (P14-5).
  for (const id of ids) {
    await supabase.rpc("log_admin_action", {
      p_entity: "question",
      p_entity_id: id,
      p_action: active ? "question.reactivated" : "question.deactivated",
    });
  }

  revalidatePath("/admin/questions");
  revalidatePath("/admin/form-builder");
  revalidatePath("/admin/form-builder/questions");
  return {
    ok: true,
    message: active
      ? `${ids.length} ${ids.length === 1 ? "question" : "questions"} reactivated.`
      : `${ids.length} ${ids.length === 1 ? "question" : "questions"} removed from future forms.`,
  };
}

/* ---------- Delete for good ---------- */

export type DeleteQuestionsState = {
  ok?: boolean;
  error?: string;
  /** How many rows were actually destroyed. */
  deleted?: number;
  /** Those that were refused, and the reason each was refused. */
  kept?: { id: string; text: string; reason: string }[];
  message?: string;
};

/**
 * Destroy questions that have never been asked of anybody.
 *
 * The one irreversible action on this screen, and it is deliberately narrow.
 * A question that has been frozen into ANY evaluation cannot be destroyed: §5
 * makes that snapshot the honest record of what somebody was asked, and PC-3
 * spells out why the bank row has to outlive it. Those are retired instead.
 *
 * What is left is the case HR actually needs a delete for — a question typed by
 * mistake, or a draft that never reached a cycle. `deleteCycleForever` and
 * `deleteDepartment` draw the same line for the same reason: refuse while
 * anything references it, and say so rather than failing on a constraint.
 */
export async function deleteQuestionsForever(
  _prev: DeleteQuestionsState,
  formData: FormData,
): Promise<DeleteQuestionsState> {
  const auth = await checkRole(ADMIN_ROLES);
  if (!auth.ok) return { error: auth.error.message };

  const ids = readIds(formData);
  if (ids.length === 0) return { error: "No questions were selected." };

  const supabase = await createClient();

  // The text is read BEFORE anything is destroyed. Once the row is gone the
  // audit diff is the only record that the question ever existed, so it has to
  // carry what it said (§12).
  const { data: rows, error: readError } = await supabase
    .from("questions")
    .select("id, text")
    .in("id", ids);
  if (readError || !rows) return { error: "Could not read those questions." };

  const textOf = new Map(rows.map((r) => [r.id, r.text]));

  /* -- Refusal 1: it is in somebody's frozen form. -- */
  const { data: snapshots, error: snapError } = await supabase
    .from("evaluation_questions")
    .select("question_id")
    .in("question_id", ids);
  if (snapError) return { error: "Could not check where those questions have been used." };
  const launched = new Set((snapshots ?? []).map((r) => r.question_id));

  /* -- Refusal 2: another question is conditional on it.
        `depends_on` has no cascade, so this would otherwise surface as a raw
        foreign-key violation — and the fix (edit the child first) is not
        something a constraint message tells anybody. -- */
  const { data: children, error: childError } = await supabase
    .from("questions")
    .select("id, text, depends_on")
    .in("depends_on", ids);
  if (childError) return { error: "Could not check for follow-up questions." };

  const dependants = new Map<string, string>();
  for (const child of children ?? []) {
    if (child.depends_on && !dependants.has(child.depends_on)) {
      dependants.set(child.depends_on, child.text);
    }
  }

  const kept: { id: string; text: string; reason: string }[] = [];
  const removable: string[] = [];

  for (const id of ids) {
    const text = textOf.get(id) ?? "This question";
    if (launched.has(id)) {
      kept.push({
        id,
        text,
        reason: "It has been asked in a launched evaluation, so it was removed from future forms instead.",
      });
    } else if (dependants.has(id)) {
      kept.push({
        id,
        text,
        reason: `"${dependants.get(id) ?? ""}" only appears depending on this answer. Delete or detach that one first.`,
      });
    } else {
      removable.push(id);
    }
  }

  /* -- Anything refused is RETIRED rather than left active. HR asked for it to
        go; the honest outcome is that it stops being asked, not that the click
        did nothing. -- */
  if (kept.length > 0) {
    const { error } = await supabase
      .from("questions")
      .update({ is_active: false })
      .in("id", kept.map((k) => k.id));
    if (error) return { error: "Could not remove those questions from future forms." };
    for (const k of kept) {
      await supabase.rpc("log_admin_action", {
        p_entity: "question",
        p_entity_id: k.id,
        p_action: "question.deactivated",
        p_diff: { after: { reason: "delete refused; retired instead" } } as Json,
      });
    }
  }

  if (removable.length > 0) {
    // Audited BEFORE the delete: audit_log.entity_id is a plain uuid and not a
    // foreign key (P3-2), but the text has to be captured while the row is
    // still there to read.
    for (const id of removable) {
      await supabase.rpc("log_admin_action", {
        p_entity: "question",
        p_entity_id: id,
        p_action: "question.deleted",
        p_diff: { before: { text: textOf.get(id) ?? null } } as Json,
      });
    }

    // Options and department mappings cascade (0002). Nothing else points here:
    // that is exactly what the two refusals above established.
    const { error } = await supabase.from("questions").delete().in("id", removable);
    if (error) return { error: "Could not delete those questions." };
  }

  revalidatePath("/admin/questions");
  revalidatePath("/admin/form-builder");
  revalidatePath("/admin/form-builder/questions");

  const parts: string[] = [];
  if (removable.length > 0) {
    parts.push(`${removable.length} ${removable.length === 1 ? "question" : "questions"} deleted`);
  }
  if (kept.length > 0) {
    parts.push(`${kept.length} kept and removed from future forms`);
  }

  return {
    ok: true,
    deleted: removable.length,
    kept,
    message: parts.join(", ") + ".",
  };
}

/* ---------- Reorder ---------- */

export async function reorderQuestions(
  _prev: QuestionActionState,
  formData: FormData,
): Promise<QuestionActionState> {
  const auth = await checkRole(ADMIN_ROLES);
  if (!auth.ok) return { error: auth.error.message };

  let ids: string[] = [];
  try {
    const parsed: unknown = JSON.parse(String(formData.get("ids") ?? "[]"));
    if (Array.isArray(parsed)) ids = parsed.map(String);
  } catch {
    ids = [];
  }

  const parsed = reorderSchema.safeParse({
    section: String(formData.get("section") ?? ""),
    track: String(formData.get("track") ?? ""),
    ids,
  });
  if (!parsed.success) return { error: "Could not read the new order." };

  const supabase = await createClient();

  // Steps of 10 leave room to splice a question in later without renumbering
  // the whole section.
  for (const [index, id] of parsed.data.ids.entries()) {
    const { error } = await supabase
      .from("questions")
      .update({ sort_order: (index + 1) * 10 })
      .eq("id", id);
    if (error) return { error: "Could not save the new order." };
  }

  await supabase.rpc("log_admin_action", {
    p_entity: "question_section",
    // The section is the thing that changed, so it is what the audit row is
    // about; a uuid per question would bury the actual event.
    p_entity_id: parsed.data.ids[0] as string,
    p_action: "question.reordered",
    p_diff: { after: { section: parsed.data.section, track: parsed.data.track, order: parsed.data.ids } } as Json,
  });

  revalidatePath("/admin/questions");
  return { ok: true, message: "Order saved." };
}
