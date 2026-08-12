"use server";

/** Distribution server actions. HR-guarded (§9), every send logged (§10). */

import { revalidatePath } from "next/cache";

import { checkRole } from "@/lib/auth/guards";
import { checkAppUrl, resolveAppUrl } from "@/lib/notify/preflight";
import { ADMIN_ROLES } from "@/lib/auth/roles";
import { inviteUrl, issueInviteToken } from "@/lib/auth/invites";
import { cycleError, type CycleResult } from "@/lib/cycles/schema";
import { sendNotification, type Channel } from "@/lib/notify/dispatch";
import { leadReviewInvite, selfEvaluationInvite } from "@/lib/notify/templates";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/date";

/** P11: bulk sends pause between messages "to stay polite to the provider". */
const BULK_GAP_MS = 300;

export type SendOutcome = {
  evaluationId: string;
  name: string;
  channel: Channel;
  ok: boolean;
  message: string;
};

async function guard() {
  return checkRole(ADMIN_ROLES);
}

/**
 * Everything one send needs, read fresh from the database.
 *
 * Re-read per send rather than trusted from the client: a bulk run of 40 takes
 * about fifteen seconds, and somebody can submit their form in the middle of it.
 * §9 — "Every server action re-checks the role and the state machine guard
 * before writing."
 */
/**
 * The evaluation, the RECIPIENT and the cycle.
 *
 * `layer` decides who the recipient is. It was hardcoded to the evaluatee, and
 * so was everything downstream of it — the token, the template and the due
 * date. P10-REV made the HOD a recipient from launch (PR-7: both tokens, both
 * messages), but the DISTRIBUTION screen was built in P11, before that, and
 * still knew about one person. So the only time a HOD ever received their link
 * was the launch dispatch — and if that failed, as it did here on a localhost
 * app URL, there was no way to send it at all.
 */
async function loadTarget(evaluationId: string, layer: "SELF" | "LEAD" = "SELF") {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("evaluations")
    .select("id, status, evaluatee_id, lead_id, cycle_id, excluded_at, due_self_on, due_lead_on")
    .eq("id", evaluationId)
    .maybeSingle();

  if (error || !data) return null;

  const recipientId = layer === "LEAD" ? data.lead_id : data.evaluatee_id;
  if (!recipientId) return null;

  /* The evaluatee is loaded whichever layer this is: the HOD's message names
     the person they are rating, so both are needed to render it. */
  const { data: people } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone_e164")
    .in("id", [...new Set([recipientId, data.evaluatee_id])]);

  const byId = new Map((people ?? []).map((p) => [p.id, p]));
  const person = byId.get(recipientId);
  const evaluatee = byId.get(data.evaluatee_id);

  const { data: cycle } = await supabase
    .from("evaluation_cycles")
    .select("id, name, period_label, self_due_on, lead_due_on")
    .eq("id", data.cycle_id)
    .maybeSingle();

  if (!person || !evaluatee || !cycle) return null;

  const { data: department } = data.evaluatee_id
    ? await supabase
        .from("profiles")
        .select("department_id, departments(name)")
        .eq("id", data.evaluatee_id)
        .maybeSingle()
    : { data: null };

  return {
    evaluation: data,
    /** Who the message goes TO. */
    person,
    /** Who it is ABOUT. The same row on a SELF send. */
    evaluatee,
    cycle,
    departmentName:
      (department?.departments as { name?: string } | null)?.name ?? "their department",
  };
}

/* ---------- sendEvaluationLink ---------- */

/**
 * Issue a fresh link and send it on one channel.
 *
 * The token is minted here, handed to the template, and dropped. It is never
 * returned to the client, never logged, and never written to notifications_log —
 * §10 stores only the SHA-256 hash, and a copy anywhere else would undo that.
 * What gets logged is the fact of the send: channel, recipient, template,
 * outcome.
 *
 * Note issuing revokes the previous token for that (evaluation, channel), so a
 * resend silently invalidates whatever went out before. That is §10's rule and
 * it is why "Copy link" warns before doing the same thing.
 */
export async function sendEvaluationLink(
  evaluationId: string,
  channel: Channel,
  /** Whose link. Defaults to the employee, which is every existing caller. */
  layer: "SELF" | "LEAD" = "SELF",
): Promise<CycleResult<SendOutcome>> {
  const auth = await guard();
  if (!auth.ok) return auth;

  /* -- Before anything else: will the link work at all?
        A localhost APP_URL produces a message that sends cleanly, logs as Sent,
        and cannot be opened by anybody — which is far worse than a refusal,
        because nothing tells HR until an employee phones to say the link does
        nothing (§0.7). Checked here rather than only on the screen, because the
        screen is not the only caller: launch and the nightly chase send too. -- */
  const linkHealth = checkAppUrl(resolveAppUrl());
  if (!linkHealth.ok) return cycleError(linkHealth.code, `${linkHealth.title}. ${linkHealth.fix}`);

  const target = await loadTarget(evaluationId, layer);
  if (!target) {
    return cycleError(
      "NOT_FOUND",
      layer === "LEAD"
        ? "That evaluation has no Manager assigned, so there is nobody to send a rating link to."
        : "That evaluation no longer exists.",
    );
  }

  const { evaluation, person, evaluatee, cycle, departmentName } = target;

  if (evaluation.excluded_at) {
    return cycleError(
      "WITHDRAWN",
      `${person.full_name} has been withdrawn from this cycle, so there is no form to send.`,
    );
  }

  /* -- §8: a link is only meaningful while the form can still be filled in.
        AMEND-3 renamed this status to OPEN, and this guard was never updated —
        so it refused EVERY evaluation and HR could not send or resend a single
        invite link. The distribution screen was dead. -- */
  if (evaluation.status !== "OPEN") {
    return cycleError(
      "WRONG_STATUS",
      `${person.full_name}'s evaluation is at "${readableStatus(evaluation.status)}", so a form link would not open anything they can edit.`,
    );
  }

  const recipient = channel === "WHATSAPP" ? person.phone_e164 : person.email;
  if (!recipient) {
    return cycleError(
      "NO_CONTACT",
      channel === "WHATSAPP"
        ? `No phone number on record for ${person.full_name}.`
        : `No email address on record for ${person.full_name}.`,
    );
  }

  /* -- Mint the link, for THIS layer.
        0022 keys a token on (evaluation, layer, channel), so minting the HOD's
        does not revoke the employee's and resending either leaves the other
        alone (PR-5). -- */
  const issued = await issueInviteToken(
    evaluationId,
    channel === "WHATSAPP" ? "whatsapp" : "email",
    layer,
  );
  if (!issued.ok) {
    return cycleError("TOKEN_FAILED", `Could not create a link for ${person.full_name}.`);
  }

  const link = inviteUrl(issued.data.token);

  /* -- Two different messages, and that is not cosmetic.
        `leadReviewInvite` states only that the form is open and when it is due.
        The employee's template names their own deadline. Sending the employee's
        wording to a HOD would tell them about somebody else's form — and PR-10
        replaced the older lead template precisely because it leaked the
        employee's progress ("{employee} has submitted"), which blind rating
        withholds (§5). -- */
  const message =
    layer === "LEAD"
      ? leadReviewInvite({
          leadName: person.full_name,
          employeeName: evaluatee.full_name,
          department: departmentName,
          period: cycle.period_label,
          dueDate: formatDate(evaluation.due_lead_on ?? cycle.lead_due_on),
          link,
        })
      : selfEvaluationInvite({
          name: person.full_name,
          period: cycle.period_label,
          dueDate: formatDate(evaluation.due_self_on ?? cycle.self_due_on),
          link,
        });

  const result = await sendNotification({
    channel,
    recipient,
    template: layer === "LEAD" ? "leadReviewInvite" : "selfEvaluationInvite",
    message,
    evaluationId,
    profileId: person.id,
    // Display context only. No link, no token — the CHECK on notifications_log
    // refuses those, and dispatch never offers them.
    context: { name: person.full_name, period: cycle.period_label, cycle: cycle.name },
  });

  revalidatePath(`/admin/cycles/${cycle.id}/distribute`);

  return {
    ok: true,
    data: {
      evaluationId,
      name: person.full_name,
      channel,
      ok: result.ok,
      message: result.ok
        ? `Sent to ${person.full_name}.`
        : `${person.full_name}: ${result.message}`,
    },
  };
}

/* ---------- sendBulk ---------- */

/**
 * Send to many people, one at a time.
 *
 * Sequential with a 300ms gap, per the brief. Firing 40 requests at once would
 * very likely trip the provider's own rate limiting, and the failures would look
 * like bad numbers rather than our own impatience.
 *
 * ONE FAILURE NEVER STOPS THE RUN. Every person is attempted and every outcome
 * comes back, so a bulk send of 40 with 3 bad numbers sends 37 and reports 3 with
 * reasons — rather than sending 12 and stopping at the first problem.
 */
export async function sendBulk(
  evaluationIds: string[],
  channels: Channel[],
  /**
   * Whose links to send.
   *
   * Both by default is NOT the default: a bulk send has to be a deliberate
   * choice about who is being messaged, because the two audiences are told
   * different things and a HOD receiving forty employee invites would be a
   * mess nobody could undo. The screen asks.
   */
  layers: ReadonlyArray<"SELF" | "LEAD"> = ["SELF"],
): Promise<CycleResult<{ outcomes: SendOutcome[]; sent: number; failed: number }>> {
  const auth = await guard();
  if (!auth.ok) return auth;

  if (evaluationIds.length === 0) return cycleError("NOTHING_SELECTED", "Nobody is selected.");
  if (channels.length === 0) return cycleError("NO_CHANNEL", "Choose WhatsApp, email, or both.");
  if (layers.length === 0) {
    return cycleError("NO_RECIPIENT", "Choose whether to send to the employee, the Manager, or both.");
  }

  const outcomes: SendOutcome[] = [];

  for (const evaluationId of evaluationIds) {
    for (const layer of layers) {
      for (const channel of channels) {
        const result = await sendEvaluationLink(evaluationId, channel, layer);

        outcomes.push(
          result.ok
            ? result.data
            : {
                evaluationId,
                name: "",
                channel,
                ok: false,
                // The action's message already names the person.
                message: result.error.message,
              },
        );

        await new Promise((resolve) => setTimeout(resolve, BULK_GAP_MS));
      }
    }
  }

  return {
    ok: true,
    data: {
      outcomes,
      sent: outcomes.filter((o) => o.ok).length,
      failed: outcomes.filter((o) => !o.ok).length,
    },
  };
}

/* ---------- issueCopyableLink ---------- */

/**
 * A link HR can paste somewhere themselves.
 *
 * Issuing revokes the previous token for that channel (§10), which is why the
 * screen warns before calling this — a "copy" that silently broke the link
 * already sitting in somebody's WhatsApp would be the worst kind of surprise.
 *
 * The plaintext is returned to the caller and to nowhere else: it is not logged
 * and not written to notifications_log. A row IS written, so the act of minting
 * a link is on the record even though the link is not.
 */
export async function issueCopyableLink(
  evaluationId: string,
  /* -- WHOSE LINK THIS IS, and it was missing.
        Every other sender — the launch, the nightly chase, the per-row send —
        passes a layer, so the employee's link and the HOD's are separate tokens
        and `/invite/consume` lands each on their own screen. This one took the
        `'SELF'` default, so a link HR copied to hand to a MANAGER was an
        employee link: it opened `/my-evaluation/{id}` for an evaluation that is
        not theirs, and the guard bounced them.

        The default stays SELF so no existing caller changes behaviour — but the
        distribution screen now always says which, because "copy a link" on a
        row that has two people on it is ambiguous either way. -- */
  layer: "SELF" | "LEAD" = "SELF",
): Promise<CycleResult<{ link: string; name: string; layer: "SELF" | "LEAD" }>> {
  const auth = await guard();
  if (!auth.ok) return auth;

  const target = await loadTarget(evaluationId);
  if (!target) return cycleError("NOT_FOUND", "That evaluation no longer exists.");

  // Same rename, same consequence — see above.
  if (target.evaluation.status !== "OPEN") {
    return cycleError(
      "WRONG_STATUS",
      `${target.person.full_name}'s evaluation is at "${readableStatus(target.evaluation.status)}", so a form link would not open anything they can edit.`,
    );
  }

  const issued = await issueInviteToken(evaluationId, "email", layer);
  if (!issued.ok) return cycleError("TOKEN_FAILED", "Could not create a link.");

  const supabase = await createClient();
  // Recorded as an attempt with no provider behind it: HR is the delivery
  // channel here, and a link that leaves the building unrecorded is exactly what
  // §12 exists to prevent. The link itself is not in the row.
  await supabase.rpc("queue_notification", {
    p_channel: "EMAIL",
    p_recipient: target.person.email ?? "copied-by-hr",
    p_template: "selfEvaluationInvite",
    p_evaluation_id: evaluationId,
    p_profile_id: target.person.id,
    p_payload: { method: "copied_by_hr", name: target.person.full_name },
  });

  revalidatePath(`/admin/cycles/${target.cycle.id}/distribute`);

  /* -- The layer travels BACK so the screen can name who the link is for.
        A copied link is pasted into a message somebody types by hand, and
        handing the HOD's link to the employee is not a wrong page — it is
        somebody opening a rating form about themselves. -- */
  return {
    ok: true,
    data: { link: inviteUrl(issued.data.token), name: target.person.full_name, layer },
  };
}

/* ---------- updatePhone ---------- */

/** The "Fix number" path on a row whose phone will not normalise. */
export async function updatePhone(
  profileId: string,
  phone: string,
): Promise<CycleResult<{ profileId: string }>> {
  const auth = await guard();
  if (!auth.ok) return auth;

  const supabase = await createClient();

  const { error } = await supabase
    .from("profiles")
    .update({ phone_e164: phone.trim() || null })
    .eq("id", profileId);

  if (error) return cycleError("QUERY_FAILED", error.message);

  await supabase.rpc("log_admin_action", {
    p_entity: "profile",
    p_entity_id: profileId,
    p_action: "profile.phone_updated",
    p_diff: { phone_set: phone.trim().length > 0 },
  });

  revalidatePath("/admin/cycles");
  return { ok: true, data: { profileId } };
}

function readableStatus(status: string): string {
  const map: Record<string, string> = {
    DRAFT: "Draft",
    CYCLE_ACTIVE: "Cycle active",
    SELF_SUBMITTED: "Self submitted",
    LEAD_REVIEWED: "Manager reviewed",
    MD_FINALIZED: "MD finalized",
    CLOSED: "Closed",
  };
  return map[status] ?? status;
}
