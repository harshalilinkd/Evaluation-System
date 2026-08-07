/** Resend email client. CLAUDE.md §2 (Resend), §15 (credentials from env). */

import "server-only";

import { redact, type SendResult } from "@/lib/notify/maytapi";
import { sendEmailViaSmtp, smtpConfigured } from "@/lib/notify/smtp";

/**
 * Resend over `fetch` rather than the `resend` npm package.
 *
 * §2 pins Resend as the email provider and §17 forbids dependencies outside it —
 * the SDK would be permitted. It is not used because the timeout and single-retry
 * semantics §10 wants for Maytapi apply just as much here, and the SDK hides the
 * response behind its own error shape. One retry policy, written once, applied
 * to both channels, is worth more than the few lines the SDK saves.
 */
function credentials(): { ok: true; apiKey: string; from: string } | { ok: false; missing: string[] } {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;

  const missing = [!apiKey && "RESEND_API_KEY", !from && "MAIL_FROM"].filter(
    (v): v is string => Boolean(v),
  );

  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, apiKey: apiKey!, from: from! };
}

const TIMEOUT_MS = 10_000;
const BACKOFF_MS = 2_000;

/**
 * Send one email.
 *
 * BOTH BODIES, ALWAYS. A message with only HTML lands in spam more often, is
 * unreadable in a text-only client, and is what a screen reader gets when the
 * HTML is stripped. The plain-text body is the same message, not a stub telling
 * people to enable HTML.
 *
 * Same contract as sendWhatsApp: never throws, retries once on a network
 * failure, a timeout or a 5xx, never on a 4xx.
 */
export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  html: string,
): Promise<SendResult> {
  /* -- SMTP first, if it is configured (AMEND-4).
        Chosen by which credentials are present rather than by a flag, so there
        is no third setting that can disagree with the other two. Resend stays
        the path when its key is the one set, which makes moving to a verified
        domain later a settings change rather than another code change. -- */
  if (smtpConfigured()) {
    return sendEmailViaSmtp(to, subject, text, html);
  }

  const creds = credentials();
  if (!creds.ok) {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      message: `Email is not configured. Missing ${creds.missing.join(", ")} in the environment.`,
    };
  }

  const attempt = async (): Promise<{ retryable: boolean; result: SendResult }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${creds.apiKey}`,
        },
        body: JSON.stringify({ from: creds.from, to: [to], subject, text, html }),
        signal: controller.signal,
      });

      if (response.status >= 500) {
        return {
          retryable: true,
          result: { ok: false, code: `HTTP_${response.status}`, message: "Email provider is unavailable." },
        };
      }

      const raw: unknown = await response.json().catch(() => null);
      const body = (raw ?? {}) as { id?: string; message?: string; name?: string };

      if (!response.ok) {
        return {
          retryable: false,
          result: {
            ok: false,
            code: body.name ?? `HTTP_${response.status}`,
            message: redact(body.message ?? `Email provider returned ${response.status}.`),
          },
        };
      }

      return { retryable: false, result: { ok: true, providerMessageId: body.id ?? null } };
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      return {
        retryable: true,
        result: {
          ok: false,
          code: aborted ? "TIMEOUT" : "NETWORK",
          message: aborted
            ? "Email provider did not respond within 10 seconds."
            : "Could not reach the email provider.",
        },
      };
    } finally {
      clearTimeout(timer);
    }
  };

  const first = await attempt();
  if (first.result.ok || !first.retryable) return first.result;

  await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS));
  return (await attempt()).result;
}

export type { SendResult };
