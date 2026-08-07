"use server";

/** HR acting on a due item (P22). Create and send, or skip with a reason. */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { checkRole } from "@/lib/auth/guards";
import { generateToken, hashToken, inviteUrl } from "@/lib/auth/invite-token";
import { cycleError, type CycleResult } from "@/lib/cycles/schema";
import { assembleForDepartment } from "@/lib/forms/assemble";
import { sendNotification } from "@/lib/notify/dispatch";
import { leadReviewInvite, selfEvaluationInvite } from "@/lib/notify/templates";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/date";
import type { Json } from "@/types/database";

async function requireHr() {
  const auth = await checkRole(["HR_ADMIN"]);
  if (!auth.ok) return cycleError("FORBIDDEN", auth.error.message);
  return { ok: true as const, session: auth.session };
}

/** How long a milestone evaluation is open for. */
const SELF_DAYS = 10;
const LEAD_DAYS = 14;

function inDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Create the evaluation and send both links — one action, as the brief asks.
 *
 * The split is P10-2's, unchanged: **TypeScript assembles, SQL commits.** The
 * question list is merged by `assembleForDepartment` — the same function a batch
 * launch uses, so a milestone evaluation and a batch one cannot ask different
 * questions of the same department — and `create_milestone_evaluation` writes
 * the row, the snapshot, both response rows, the transition and both tokens in
 * one transaction.
 *
 * Dispatch happens AFTER the commit (PW-2): a provider outage must not roll back
 * an evaluation that is already durable and audited.
 */
export async function createAndSend(dueItemId: string): Promise<
  CycleResult<{ evaluationId: string; sent: number; failed: number }>
> {
  const auth = await requireHr();
  if (!auth.ok) return auth;

  const parsed = z.string().uuid().safeParse(dueItemId);
  if (!parsed.success) return cycleError("INVALID", "No item was chosen.");

  const supabase = await createClient();

  const { data: item } = await supabase
    .from("due_items")
    .select("id, profile_id, milestone_type, status")
    .eq("id", dueItemId)
    .maybeSingle();

  if (!item) return cycleError("NOT_FOUND", "That item is not available.");
  if (item.status !== "PENDING") {
    return cycleError("ALREADY_DONE", "That item has already been dealt with.");
  }

  const { data: person } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone_e164, department_id, reports_to, track")
    .eq("id", item.profile_id)
    .maybeSingle();

  if (!person) return cycleError("NOT_FOUND", "That person is not available.");
  if (!person.reports_to) {
    return cycleError("NO_LEAD", `Nobody is set to rate ${person.full_name}. Set who they report to first.`);
  }

  /* -- The questions. A milestone evaluation is an EVALUATION cycle, so the
        INCREMENT_ONLY questions — the salary expectation among them — are not
        asked (§6's cycle_scope). -- */
  const assembled = await assembleForDepartment(person.department_id, person.track, "EVALUATION");
  if (!assembled.ok) return cycleError("ASSEMBLY_FAILED", "Could not build their form.");
  if (assembled.data.length === 0) {
    return cycleError(
      "NO_QUESTIONS",
      `There are no questions for ${person.full_name}'s department yet. Map some in the form builder first.`,
    );
  }

  /* -- One token per layer (PR-5), so the two links open different forms. Only
        the hash goes to SQL; the plaintext stays here for the dispatch below
        (§10, PR-6). -- */
  const selfToken = generateToken();
  const leadToken = generateToken();

  const dueSelfOn = inDays(SELF_DAYS);
  const dueLeadOn = inDays(LEAD_DAYS);

  const { data: created, error } = await supabase.rpc("create_milestone_evaluation", {
    p_due_item_id: dueItemId,
    p_questions: assembled.data as unknown as Json,
    p_lead_id: person.reports_to,
    p_due_self_on: dueSelfOn,
    p_due_lead_on: dueLeadOn,
    p_self_token: hashToken(selfToken),
    p_lead_token: hashToken(leadToken),
  });

  if (error) return cycleError("CREATE_FAILED", `Nothing was created: ${error.message}`);

  const result = (created ?? {}) as { evaluation_id?: string };
  const evaluationId = result.evaluation_id ?? "";

  /* ---------- Dispatch, after the commit ---------- */

  const { data: lead } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone_e164")
    .eq("id", person.reports_to)
    .maybeSingle();

  const { data: dept } = person.department_id
    ? await supabase.from("departments").select("name").eq("id", person.department_id).maybeSingle()
    : { data: null };

  let sent = 0;
  let failed = 0;

  /* -- The employee gets a token; the lead gets one too, because a HOD chasing
        one report should not have to find the queue. Each message describes only
        that person's own form (§5) — neither says anything about the other. -- */
  if (person.phone_e164 || person.email) {
    const message = selfEvaluationInvite({
      name: person.full_name,
      period: "your review",
      dueDate: formatDate(dueSelfOn),
      link: inviteUrl(selfToken),
    });
    for (const [channel, recipient] of [
      ["WHATSAPP", person.phone_e164],
      ["EMAIL", person.email],
    ] as const) {
      if (!recipient) continue;
      const r = await sendNotification({
        channel, recipient, template: "selfEvaluationInvite", message,
        evaluationId, profileId: person.id,
        context: { milestone: item.milestone_type },
      });
      r.ok ? (sent += 1) : (failed += 1);
    }
  }

  if (lead && (lead.phone_e164 || lead.email)) {
    const message = leadReviewInvite({
      leadName: lead.full_name,
      employeeName: person.full_name,
      department: dept?.name ?? "their department",
      period: "this review",
      dueDate: formatDate(dueLeadOn),
      link: inviteUrl(leadToken),
    });
    for (const [channel, recipient] of [
      ["WHATSAPP", lead.phone_e164],
      ["EMAIL", lead.email],
    ] as const) {
      if (!recipient) continue;
      const r = await sendNotification({
        channel, recipient, template: "leadReviewInvite", message,
        evaluationId, profileId: lead.id,
        context: { milestone: item.milestone_type },
      });
      r.ok ? (sent += 1) : (failed += 1);
    }
  }

  revalidatePath("/admin/due");
  revalidatePath("/admin/cycles");
  return { ok: true, data: { evaluationId, sent, failed } };
}

/** Skip an item. A reason is required — a silent dismissal explains nothing later. */
export async function skipDueItem(input: {
  dueItemId: string;
  reason: string;
}): Promise<CycleResult<{ skipped: true }>> {
  const auth = await requireHr();
  if (!auth.ok) return auth;

  const parsed = z
    .object({
      dueItemId: z.string().uuid(),
      reason: z.string().trim().min(5, "Say why this one is being skipped."),
    })
    .safeParse(input);
  if (!parsed.success) {
    return cycleError("INVALID", parsed.error.issues[0]?.message ?? "Give a reason.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("due_items")
    .update({
      status: "SKIPPED",
      skip_reason: parsed.data.reason,
      actioned_by: auth.session.profile.id,
      actioned_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.dueItemId)
    .eq("status", "PENDING");

  if (error) return cycleError("SAVE_FAILED", `Could not skip it: ${error.message}`);

  revalidatePath("/admin/due");
  return { ok: true, data: { skipped: true } };
}
