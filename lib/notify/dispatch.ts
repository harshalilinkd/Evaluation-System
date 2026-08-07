/** sendNotification — the only way a message leaves this system. CLAUDE.md §10. */

import "server-only";

import { sendEmail } from "@/lib/notify/email";
import { sendWhatsApp } from "@/lib/notify/maytapi";
import { normaliseToE164, type PhoneFailure } from "@/lib/notify/phone";
import type { RenderedMessage, TemplateKey } from "@/lib/notify/templates";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

export type Channel = "WHATSAPP" | "EMAIL";

export type DispatchInput = {
  channel: Channel;
  /** Raw, straight off the profile. Normalised here, not by the caller. */
  recipient: string | null | undefined;
  template: TemplateKey;
  message: RenderedMessage;
  evaluationId?: string | null;
  profileId?: string | null;
  /**
   * Non-secret display context for the log — a name, a period, a due date.
   *
   * NEVER the link, the token, or the rendered body. The database has a CHECK
   * that refuses anything token-shaped, but the rule is enforced here first
   * because a rejected insert would lose the record of the attempt entirely.
   */
  context?: Record<string, string | number | null>;
};

export type DispatchResult =
  | { ok: true; notificationId: string; providerMessageId: string | null }
  | { ok: false; notificationId: string | null; code: string; message: string };

/**
 * Send one message and log it, whatever happens.
 *
 * NOTHING IN THE PRODUCT CALLS maytapi.ts OR email.ts DIRECTLY. Both are
 * reachable only from here, so there is exactly one place that can produce an
 * unlogged send — and it does not.
 *
 * The order matters: normalise, write QUEUED, send, settle. Writing the row
 * before the provider call is what makes a crash mid-send visible afterwards. A
 * row written after would lose precisely the sends most worth knowing about.
 *
 * Never throws. Every failure — bad number, missing credentials, provider down,
 * rate limit — comes back as a value the distribution screen can render on the
 * row it belongs to.
 */
export async function sendNotification(
  input: DispatchInput,
  /**
   * The client to log through. Defaults to the authenticated one, so an HR
   * send is subject to RLS and the per-user rate limit like everything else.
   *
   * Cron passes the service client — §0.5 permits the service-role key in
   * "server-side notification/cron code", and it is unavoidable here: a
   * scheduled job has no session, so `auth.uid()` is null and RLS would hide
   * every row it needs to read. `queue_notification` treats a null caller as
   * the system actor, which is also why cron is not rate-limited: the 200/hour
   * cap is there to stop a person fat-fingering a bulk send, not to throttle a
   * nightly sweep.
   */
  client?: Awaited<ReturnType<typeof createClient>>,
): Promise<DispatchResult> {
  const supabase = client ?? (await createClient());

  /* -- 1. Resolve the recipient -- */
  let recipient: string;

  if (input.channel === "WHATSAPP") {
    const phone = normaliseToE164(input.recipient, process.env.DEFAULT_COUNTRY_CODE ?? "+91");
    if (!phone.ok) {
      // Not logged: nothing was attempted, and a notifications_log row implies
      // an attempt. The screen already knows the number is bad — it renders the
      // same reason on the contact column before anybody presses send.
      return {
        ok: false,
        notificationId: null,
        code: `PHONE_${phone.reason satisfies PhoneFailure}`,
        message: phone.message,
      };
    }
    recipient = phone.e164;
  } else {
    const email = (input.recipient ?? "").trim();
    if (!email || !email.includes("@")) {
      return {
        ok: false,
        notificationId: null,
        code: "EMAIL_INVALID",
        message: email ? "That is not a valid email address." : "No email address on record.",
      };
    }
    recipient = email;
  }

  /* -- 1b. Is this channel even switched on?
        A provider with no credentials is not a failed send — it is a channel
        the company has chosen not to use, and nothing is attempted. P11-11
        made exactly this call for a bad phone number: a `notifications_log`
        row means somebody tried, so writing one here would fill the log with
        red rows no retry can ever fix and inflate the failure count on HR's
        screen.

        This is what makes "we only use WhatsApp" a clean configuration rather
        than a permanent column of errors: clear RESEND_API_KEY and the email
        channel simply stops being attempted. The distribution screen still
        states it once, up front, so nobody wonders where the emails went. -- */
  const configured =
    input.channel === "WHATSAPP"
      ? Boolean(
          process.env.MAYTAPI_PRODUCT_ID &&
            process.env.MAYTAPI_PHONE_ID &&
            process.env.MAYTAPI_API_TOKEN,
        )
      : Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);

  if (!configured) {
    return {
      ok: false,
      notificationId: null,
      code: "NOT_CONFIGURED",
      message:
        input.channel === "WHATSAPP"
          ? "WhatsApp is not set up, so nothing was sent on it."
          : "Email is not set up, so nothing was sent on it.",
    };
  }

  /* -- 2. QUEUED, before anything is attempted -- */
  const { data: queuedId, error: queueError } = await supabase.rpc("queue_notification", {
    p_channel: input.channel,
    p_recipient: recipient,
    p_template: input.template,
    p_evaluation_id: input.evaluationId ?? undefined,
    p_profile_id: input.profileId ?? undefined,
    p_payload: (input.context ?? {}) as Json,
  });

  if (queueError || !queuedId) {
    // The rate limiter lives in that function, so this is also how "200 an hour"
    // surfaces. Its message is already written for HR.
    return {
      ok: false,
      notificationId: null,
      code: queueError?.code ?? "QUEUE_FAILED",
      message: queueError?.message ?? "Could not record this send.",
    };
  }

  const notificationId = queuedId as unknown as string;

  /* -- 2b. The pause switch (P17) -- */
  //
  // Checked AFTER the row is written, deliberately. A paused send is still an
  // attempt somebody made, and the row is the evidence — leaving QUEUED with no
  // provider behind it is exactly the state "paused" should look like, and it
  // is what "Retry all failed" will pick up when the pause is lifted.
  //
  // Read per send rather than cached: an admin pausing mid-bulk-run expects the
  // next message to stop, not the next deploy.
  const { data: settings } = await supabase
    .from("notification_settings")
    .select("outbound_paused")
    .maybeSingle();

  if (settings?.outbound_paused) {
    return {
      ok: false,
      notificationId,
      code: "PAUSED",
      message: "Outbound messages are paused. This one is queued and was not sent.",
    };
  }

  /* -- 3. Send -- */
  const result =
    input.channel === "WHATSAPP"
      ? await sendWhatsApp(recipient, input.message.body)
      : await sendEmail(
          recipient,
          input.message.subject ?? "Your performance evaluation",
          input.message.body,
          input.message.html ?? `<pre>${input.message.body}</pre>`,
        );

  /* -- 4. Settle -- */
  await supabase.rpc("settle_notification", {
    p_id: notificationId,
    p_status: result.ok ? "SENT" : "FAILED",
    p_provider_message_id: result.ok ? (result.providerMessageId ?? undefined) : undefined,
    p_error: result.ok ? undefined : `${result.code}: ${result.message}`,
  });

  return result.ok
    ? { ok: true, notificationId, providerMessageId: result.providerMessageId }
    : { ok: false, notificationId, code: result.code, message: result.message };
}
