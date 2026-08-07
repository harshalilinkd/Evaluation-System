"use server";

/** Worker appraisal form actions. HR-guarded and audited (§9, §12). */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { checkRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

export type WorkerActionState = {
  ok?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  id?: string;
};

/*
 * §9 as amended by AMEND-2: HR writes configuration and the MD reads it.
 * `ADMIN_ROLES` would hand the MD a write, which is the merge AMEND-2
 * deliberately took back — so every write here names HR_ADMIN alone.
 */
const HR = ["HR_ADMIN"] as const;

const workerQuestionSchema = z.object({
  id: z.string().uuid().optional(),
  text: z.string().trim().min(3, "Give the quality a name.").max(300, "That is too long."),
  helpText: z.string().trim().max(300, "That is too long.").optional(),
  // The sheet is a tick sheet. A Yes/No row is permitted because the source form
  // has one ("Training Required"); anything richer would stop it being the
  // simple form §1 describes.
  responseType: z.enum(["TICK_3", "BOOLEAN"]),
  isRequired: z.boolean(),
});

export async function saveWorkerQuestion(
  _prev: WorkerActionState,
  formData: FormData,
): Promise<WorkerActionState> {
  const auth = await checkRole(HR);
  if (!auth.ok) return { error: auth.error.message };

  const parsed = workerQuestionSchema.safeParse({
    id: formData.get("id") ? String(formData.get("id")) : undefined,
    text: String(formData.get("text") ?? ""),
    helpText: String(formData.get("help_text") ?? ""),
    responseType: String(formData.get("response_type") ?? "TICK_3"),
    isRequired: formData.get("is_required") !== "false",
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return { error: "Check the highlighted fields.", fieldErrors };
  }

  const supabase = await createClient();
  const values = {
    text: parsed.data.text,
    help_text: parsed.data.helpText || null,
    response_type: parsed.data.responseType,
    is_required: parsed.data.isRequired,
  };

  if (parsed.data.id) {
    const { error } = await supabase
      .from("worker_questions")
      .update(values)
      .eq("id", parsed.data.id);
    if (error) return { error: "Could not save that question." };

    await supabase.rpc("log_admin_action", {
      p_entity: "worker_question",
      p_entity_id: parsed.data.id,
      p_action: "worker_question.updated",
      p_diff: { after: values } as Json,
    });

    revalidatePath("/admin/form-builder/worker");
    return { ok: true, id: parsed.data.id, message: "Saved." };
  }

  // Appended, never interleaved: the eight qualities came off a printed form in
  // a fixed order (§17), and a new row should land after them rather than
  // renumbering something HR did not touch.
  const { data: last } = await supabase
    .from("worker_questions")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("worker_questions")
    .insert({ ...values, sort_order: (last?.sort_order ?? 0) + 10 })
    .select("id")
    .single();

  if (error || !data) return { error: "Could not add that question." };

  await supabase.rpc("log_admin_action", {
    p_entity: "worker_question",
    p_entity_id: data.id,
    p_action: "worker_question.created",
    p_diff: { after: values } as Json,
  });

  revalidatePath("/admin/form-builder/worker");
  return { ok: true, id: data.id, message: "Added." };
}

/**
 * Retire or restore.
 *
 * Never a delete, for the reason PC-3 gives for the staff bank: once a worker
 * appraisal has been filed against a question, the row is what the answer means.
 * The overall row cannot be retired at all — §11 defines the worker's score AS
 * that tick, so a form without it would have no score.
 */
export async function setWorkerQuestionActive(
  _prev: WorkerActionState,
  formData: FormData,
): Promise<WorkerActionState> {
  const auth = await checkRole(HR);
  if (!auth.ok) return { error: auth.error.message };

  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("is_active") ?? "") === "true";
  if (!id) return { error: "No question was selected." };

  const supabase = await createClient();

  const { data: row } = await supabase
    .from("worker_questions")
    .select("is_overall")
    .eq("id", id)
    .maybeSingle();

  if (row?.is_overall && !active) {
    return {
      error:
        "Overall Performance cannot be removed — it is the worker's score for the period, not one quality among others.",
    };
  }

  const { error } = await supabase
    .from("worker_questions")
    .update({ is_active: active })
    .eq("id", id);
  if (error) return { error: "Could not update that question." };

  await supabase.rpc("log_admin_action", {
    p_entity: "worker_question",
    p_entity_id: id,
    p_action: active ? "worker_question.reactivated" : "worker_question.deactivated",
  });

  revalidatePath("/admin/form-builder/worker");
  return { ok: true, message: active ? "Back on the form." : "Removed from the form." };
}

/** Up/down, not drag: keyboard-operable and works on a phone (P8-6, P9-5, PC-6). */
export async function reorderWorkerQuestions(
  _prev: WorkerActionState,
  formData: FormData,
): Promise<WorkerActionState> {
  const auth = await checkRole(HR);
  if (!auth.ok) return { error: auth.error.message };

  let ids: string[] = [];
  try {
    const parsed: unknown = JSON.parse(String(formData.get("ids") ?? "[]"));
    if (Array.isArray(parsed)) ids = parsed.map(String).filter((id) => id.length > 0);
  } catch {
    ids = [];
  }
  if (ids.length === 0) return { error: "Could not read the new order." };

  const supabase = await createClient();
  for (const [index, id] of ids.entries()) {
    const { error } = await supabase
      .from("worker_questions")
      .update({ sort_order: (index + 1) * 10 })
      .eq("id", id);
    if (error) return { error: "Could not save the new order." };
  }

  await supabase.rpc("log_admin_action", {
    p_entity: "worker_form",
    p_entity_id: ids[0] as string,
    p_action: "worker_question.reordered",
    p_diff: { after: { order: ids } } as Json,
  });

  revalidatePath("/admin/form-builder/worker");
  return { ok: true, message: "Order saved." };
}
