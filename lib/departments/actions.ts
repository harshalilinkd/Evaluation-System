"use server";

/** Department and Job Specific Skills mapping actions. HR-guarded and audited (§9, §12). */

import { revalidatePath } from "next/cache";

import { checkRole } from "@/lib/auth/guards";
import { ADMIN_ROLES } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

export type DepartmentActionState = {
  ok?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
};

/* ---------- Create / edit a department ---------- */

export async function saveDepartment(
  _prev: DepartmentActionState,
  formData: FormData,
): Promise<DepartmentActionState> {
  const auth = await checkRole(ADMIN_ROLES);
  if (!auth.ok) return { error: auth.error.message };

  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  // Uppercased and stripped: `code` is a stable handle used by seeds, imports
  // and joins, so it must not depend on how somebody typed it.
  const code = String(formData.get("code") ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "");
  const description = String(formData.get("description") ?? "").trim();
  const isActive = String(formData.get("is_active") ?? "true") === "true";

  const fieldErrors: Record<string, string> = {};
  if (name.length < 2) fieldErrors.name = "Enter the department name";
  if (code.length < 2) fieldErrors.code = "Enter a short code, like SALES";
  if (Object.keys(fieldErrors).length > 0) {
    return { error: "Check the highlighted fields.", fieldErrors };
  }

  const supabase = await createClient();
  const row = { name, code, description: description || null, is_active: isActive };

  if (id) {
    const { data: before } = await supabase
      .from("departments")
      .select("name, code, description, is_active")
      .eq("id", id)
      .maybeSingle();

    const { error } = await supabase.from("departments").update(row).eq("id", id);
    if (error) {
      return {
        error: /duplicate|unique/i.test(error.message)
          ? "Another department already uses that name or code."
          : "Could not save that department.",
      };
    }

    await supabase.rpc("log_admin_action", {
      p_entity: "department",
      p_entity_id: id,
      p_action: "department.updated",
      p_diff: { before: before ?? null, after: row } as Json,
    });
  } else {
    const { data: created, error } = await supabase
      .from("departments")
      .insert(row)
      .select("id")
      .single();

    if (error || !created) {
      return {
        error: /duplicate|unique/i.test(error?.message ?? "")
          ? "Another department already uses that name or code."
          : "Could not create that department.",
      };
    }

    await supabase.rpc("log_admin_action", {
      p_entity: "department",
      p_entity_id: created.id,
      p_action: "department.created",
      p_diff: { after: row } as Json,
    });
  }

  revalidatePath("/admin/departments");
  return { ok: true, message: id ? "Department saved." : "Department added." };
}

/* ---------- Delete a department ---------- */

/**
 * Delete a department outright — but only one nothing depends on.
 *
 * WHAT THE DATABASE ALREADY REFUSES, AND WHY THAT IS NOT ENOUGH
 *
 * `profiles.department_id` (0001) and `evaluations.department_id` (0003) are
 * declared with no ON DELETE clause, so Postgres defaults to NO ACTION and
 * rejects the delete rather than cascading. That is the important half of the
 * safety: without it, removing a department would take its people with it, and
 * — through `evaluations` → `evaluation_questions` — every frozen snapshot in
 * every cycle they had ever been part of. §5 exists to prevent exactly that, and
 * P10-8 blocked the same cascade for cycles.
 *
 * What the FK gives you, though, is `violates foreign key constraint
 * "evaluations_department_id_fkey"`, which is not a sentence anybody in HR can
 * act on. So this counts the dependants first and names them. The FK stays the
 * thing that actually enforces it; this is the part that explains it.
 *
 * `department_questions` is the one relation that DOES cascade (0002), and that
 * is right: a mapping is a statement about a department that no longer exists.
 * The questions themselves are untouched — they live in the bank and are shared.
 *
 * Deactivating remains the normal move. Deleting is for a department created by
 * mistake, and the guard below is what keeps it to that.
 */
export async function deleteDepartment(
  _prev: DepartmentActionState,
  formData: FormData,
): Promise<DepartmentActionState> {
  const auth = await checkRole(ADMIN_ROLES);
  if (!auth.ok) return { error: auth.error.message };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "No department was selected." };

  const supabase = await createClient();

  const { data: department } = await supabase
    .from("departments")
    .select("id, name, code, description, is_active")
    .eq("id", id)
    .maybeSingle();

  if (!department) return { error: "That department no longer exists." };

  // head:true — the counts are the whole answer, and pulling the rows would mean
  // reading every profile in the company to decide one button.
  const [{ count: people }, { count: evaluations }, { count: mappings }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("department_id", id),
    supabase
      .from("evaluations")
      .select("id", { count: "exact", head: true })
      .eq("department_id", id),
    supabase
      .from("department_questions")
      .select("question_id", { count: "exact", head: true })
      .eq("department_id", id),
  ]);

  // Named separately rather than as one total: "3 people and 12 evaluations"
  // tells HR which thing to go and fix, where "15 references" does not.
  const blockers: string[] = [];
  if ((people ?? 0) > 0) {
    blockers.push(`${people} ${people === 1 ? "person is" : "people are"} in it`);
  }
  if ((evaluations ?? 0) > 0) {
    blockers.push(
      `${evaluations} ${evaluations === 1 ? "evaluation refers" : "evaluations refer"} to it`,
    );
  }

  if (blockers.length > 0) {
    return {
      error:
        `${department.name} cannot be deleted while ${blockers.join(" and ")}. ` +
        `Move them to another department first, or mark this one inactive to keep it out of new cycles.`,
    };
  }

  // Logged BEFORE the delete. `log_admin_action` takes the actor from the
  // session and the row is append-only (§12), but audit_log.entity_id carries no
  // foreign key, so the record survives the row it describes — which is the only
  // reason there is anything left to say a department ever existed.
  await supabase.rpc("log_admin_action", {
    p_entity: "department",
    p_entity_id: id,
    p_action: "department.deleted",
    p_diff: {
      before: department,
      // Kept explicitly: after the cascade there is no way to tell whether the
      // department had mappings or was genuinely empty.
      removed_question_mappings: mappings ?? 0,
    } as Json,
  });

  const { error } = await supabase.from("departments").delete().eq("id", id);

  if (error) {
    // The backstop. A row could be written between the count above and the
    // delete below, and the FK is what catches it — this only translates it.
    return {
      error: /foreign key|violates/i.test(error.message)
        ? `${department.name} is still in use somewhere and cannot be deleted. Reload the page to see what changed.`
        : "Could not delete that department.",
    };
  }

  revalidatePath("/admin/departments");
  revalidatePath("/admin/settings");
  return { ok: true, message: `${department.name} was deleted.` };
}

/* ---------- Map / unmap a question ---------- */

/**
 * Adding or removing a mapping changes what FUTURE forms ask.
 *
 * It cannot reach a launched evaluation: those render from
 * `evaluation_questions`, frozen at launch (§5) and with no update or delete
 * policy for anyone, HR included. The screen says so, and the P9 suite proves
 * it by removing a mapping and re-reading a live snapshot.
 */
export async function setQuestionMapping(
  _prev: DepartmentActionState,
  formData: FormData,
): Promise<DepartmentActionState> {
  const auth = await checkRole(ADMIN_ROLES);
  if (!auth.ok) return { error: auth.error.message };

  const departmentId = String(formData.get("department_id") ?? "");
  const questionId = String(formData.get("question_id") ?? "");
  const attach = String(formData.get("attach") ?? "true") === "true";

  if (!departmentId || !questionId) return { error: "Nothing was selected." };

  const supabase = await createClient();

  if (attach) {
    // New mappings go to the end, so adding one never reshuffles an order HR
    // has already arranged.
    const { data: last } = await supabase
      .from("department_questions")
      .select("sort_order")
      .eq("department_id", departmentId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { error } = await supabase.from("department_questions").insert({
      department_id: departmentId,
      question_id: questionId,
      sort_order: (last?.sort_order ?? 0) + 10,
    });
    if (error) return { error: "Could not add that question." };
  } else {
    const { error } = await supabase
      .from("department_questions")
      .delete()
      .eq("department_id", departmentId)
      .eq("question_id", questionId);
    if (error) return { error: "Could not remove that question." };
  }

  await supabase.rpc("log_admin_action", {
    p_entity: "department",
    p_entity_id: departmentId,
    p_action: attach ? "department.question_added" : "department.question_removed",
    p_diff: { after: { question_id: questionId } } as Json,
  });

  revalidatePath("/admin/departments");
  return {
    ok: true,
    message: attach ? "Question added to this team." : "Question removed from this team.",
  };
}

/* ---------- Reorder ---------- */

export async function reorderMapping(
  _prev: DepartmentActionState,
  formData: FormData,
): Promise<DepartmentActionState> {
  const auth = await checkRole(ADMIN_ROLES);
  if (!auth.ok) return { error: auth.error.message };

  const departmentId = String(formData.get("department_id") ?? "");
  let ids: string[] = [];
  try {
    const parsed: unknown = JSON.parse(String(formData.get("ids") ?? "[]"));
    if (Array.isArray(parsed)) ids = parsed.map(String);
  } catch {
    ids = [];
  }

  if (!departmentId || ids.length === 0) return { error: "Could not read the new order." };

  const supabase = await createClient();

  // Steps of 10 leave room to splice one in later without renumbering.
  for (const [index, questionId] of ids.entries()) {
    const { error } = await supabase
      .from("department_questions")
      .update({ sort_order: (index + 1) * 10 })
      .eq("department_id", departmentId)
      .eq("question_id", questionId);
    if (error) return { error: "Could not save the new order." };
  }

  await supabase.rpc("log_admin_action", {
    p_entity: "department",
    p_entity_id: departmentId,
    p_action: "department.questions_reordered",
    p_diff: { after: { order: ids } } as Json,
  });

  revalidatePath("/admin/departments");
  return { ok: true, message: "Order saved." };
}

/* ---------- Copy one department's set to another ---------- */

/**
 * Additive only. Questions the target already has are left where they are,
 * keeping their position — copying a set should never silently reorder or
 * remove what a department already asks.
 */
export async function copyMapping(
  _prev: DepartmentActionState,
  formData: FormData,
): Promise<DepartmentActionState> {
  const auth = await checkRole(ADMIN_ROLES);
  if (!auth.ok) return { error: auth.error.message };

  const fromId = String(formData.get("from_department_id") ?? "");
  const toId = String(formData.get("department_id") ?? "");

  if (!fromId || !toId) return { error: "Choose a department to copy from." };
  if (fromId === toId) return { error: "That is the same department." };

  const supabase = await createClient();

  const [{ data: source }, { data: target }] = await Promise.all([
    supabase.from("department_questions").select("question_id, sort_order").eq("department_id", fromId),
    supabase.from("department_questions").select("question_id").eq("department_id", toId),
  ]);

  const existing = new Set((target ?? []).map((r) => r.question_id));
  const toAdd = (source ?? [])
    .filter((r) => !existing.has(r.question_id))
    .sort((a, b) => a.sort_order - b.sort_order);

  if (toAdd.length === 0) {
    return { ok: true, message: "Nothing to copy — this team already asks all of them." };
  }

  const { data: last } = await supabase
    .from("department_questions")
    .select("sort_order")
    .eq("department_id", toId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const base = last?.sort_order ?? 0;

  const { error } = await supabase.from("department_questions").insert(
    toAdd.map((r, index) => ({
      department_id: toId,
      question_id: r.question_id,
      sort_order: base + (index + 1) * 10,
    })),
  );
  if (error) return { error: "Could not copy those questions." };

  await supabase.rpc("log_admin_action", {
    p_entity: "department",
    p_entity_id: toId,
    p_action: "department.questions_copied",
    p_diff: { after: { from: fromId, added: toAdd.map((r) => r.question_id) } } as Json,
  });

  revalidatePath("/admin/departments");
  return {
    ok: true,
    message: `Added ${toAdd.length} ${toAdd.length === 1 ? "question" : "questions"}.`,
  };
}
