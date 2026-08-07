/** Sends both invite links after a launch commits. Never inside the transaction. */

import "server-only";

import type { LaunchPlan } from "@/lib/cycles/launch";
import { sendNotification } from "@/lib/notify/dispatch";
import { leadReviewInvite, selfEvaluationInvite } from "@/lib/notify/templates";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/date";

/**
 * P10-REV item 16: one message per report, not a digest, because each carries
 * its own link. Capped so a HOD with thirty reports does not receive thirty
 * WhatsApp messages in one minute — the remainder is left for the cron sweep,
 * which chases against each evaluation's own due date.
 */
const MAX_PER_LEAD_PER_LAUNCH = 10;

export type LaunchDispatch = { sent: number; failed: number; queued: number };

export async function dispatchLaunchInvites(
  cycleId: string,
  plan: LaunchPlan,
): Promise<LaunchDispatch> {
  const out: LaunchDispatch = { sent: 0, failed: 0, queued: 0 };
  if (plan.links.length === 0) return out;

  const supabase = await createClient();

  const [{ data: cycle }, { data: evaluations }] = await Promise.all([
    supabase
      .from("evaluation_cycles")
      .select("name, period_label")
      .eq("id", cycleId)
      .maybeSingle(),
    supabase
      .from("evaluations")
      .select("id, evaluatee_id, lead_id, department_id, due_self_on, due_lead_on")
      .eq("cycle_id", cycleId),
  ]);

  const byEvaluation = new Map((evaluations ?? []).map((e) => [e.id, e]));
  const personIds = [
    ...new Set(
      (evaluations ?? []).flatMap((e) => [e.evaluatee_id, e.lead_id]).filter((v): v is string => Boolean(v)),
    ),
  ];

  const [{ data: people }, { data: departments }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, phone_e164").in("id", personIds),
    supabase.from("departments").select("id, name"),
  ]);

  const person = new Map((people ?? []).map((p) => [p.id, p]));
  const departmentName = new Map((departments ?? []).map((d) => [d.id, d.name]));
  const period = cycle?.period_label ?? "";

  /* -- The per-HOD cap. Counted as we go, so the first ten of a large team go
        out now and the rest are left for cron — which is why nothing is
        silently dropped. -- */
  const perLead = new Map<string, number>();

  for (const link of plan.links) {
    const evaluation = byEvaluation.get(link.evaluationId);
    if (!evaluation) continue;

    /* -- The employee -- */
    const employee = person.get(evaluation.evaluatee_id);
    if (employee) {
      const message = selfEvaluationInvite({
          name: employee.full_name,
          period,
          // The EVALUATION's date, not the cycle's — a rolling cycle gives each
          // person their own (item 3).
          dueDate: formatDate(evaluation.due_self_on),
          link: inviteLink(link.selfToken),
      });
      // WhatsApp is the primary channel (§10); email follows from the
      // distribution screen. One call per channel, each logged separately.
      const result = await sendNotification({
        channel: "WHATSAPP",
        recipient: employee.phone_e164,
        template: "selfEvaluationInvite",
        message,
        evaluationId: link.evaluationId,
        profileId: employee.id,
        context: { cycle: cycle?.name ?? "" },
      });
      if (result.ok) out.sent += 1;
      else out.failed += 1;
    }

    /* -- The HOD -- */
    const lead = evaluation.lead_id ? person.get(evaluation.lead_id) : undefined;
    if (lead && link.leadToken) {
      const already = perLead.get(lead.id) ?? 0;
      if (already >= MAX_PER_LEAD_PER_LAUNCH) {
        out.queued += 1;
        continue;
      }
      perLead.set(lead.id, already + 1);

      const message = leadReviewInvite({
          leadName: lead.full_name,
          employeeName: person.get(evaluation.evaluatee_id)?.full_name ?? "your report",
          department: evaluation.department_id
            ? (departmentName.get(evaluation.department_id) ?? "their team")
            : "their team",
          period,
          dueDate: formatDate(evaluation.due_lead_on),
          link: inviteLink(link.leadToken),
      });
      const result = await sendNotification({
        channel: "WHATSAPP",
        recipient: lead.phone_e164,
        template: "leadReviewInvite",
        message,
        evaluationId: link.evaluationId,
        profileId: lead.id,
        // No `employee_submitted` or anything like it: §5's blindness applies
        // to the notification log as much as to a screen.
        context: { cycle: cycle?.name ?? "" },
      });
      if (result.ok) out.sent += 1;
      else out.failed += 1;
    }
  }

  return out;
}

/** §10: the token appears in exactly one URL and is never re-shown. */
function inviteLink(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return `${base}/invite/${token}`;
}
