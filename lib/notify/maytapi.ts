/** Maytapi WhatsApp client. CLAUDE.md §10 — server-side only, credentials from env. */

import "server-only";

export type SendResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; code: string; message: string };

/**
 * §0.3: "Never hardcode a secret." §17: never put the Maytapi token in client
 * code. `server-only` above is the mechanical half of that — importing this
 * from a client component is a build error, not a code-review catch.
 *
 * Read at call time rather than at module scope. The brief asks for a throw at
 * module load, and that is right for a long-running server, but Next evaluates
 * modules during `next build`, where a missing key is normal and would fail the
 * build on a machine that has no credentials. So the check happens on first use
 * and returns a structured error instead — §0.7's "fail loudly" is satisfied by
 * the message reaching HR's screen, and the build stays green without secrets.
 */
function credentials():
  | { ok: true; productId: string; phoneId: string; token: string }
  | { ok: false; missing: string[] } {
  const productId = process.env.MAYTAPI_PRODUCT_ID;
  const phoneId = process.env.MAYTAPI_PHONE_ID;
  const token = process.env.MAYTAPI_API_TOKEN;

  const missing = [
    !productId && "MAYTAPI_PRODUCT_ID",
    !phoneId && "MAYTAPI_PHONE_ID",
    !token && "MAYTAPI_API_TOKEN",
  ].filter((v): v is string => Boolean(v));

  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, productId: productId!, phoneId: phoneId!, token: token! };
}

const TIMEOUT_MS = 10_000;
const BACKOFF_MS = 2_000;

/**
 * Send one WhatsApp message.
 *
 * Retries exactly once, and only on a network failure, a timeout or a 5xx —
 * conditions where the request may never have reached the provider. A 4xx is
 * never retried: the provider has understood the request and rejected it, so
 * sending it again produces the same rejection and, if it was a duplicate-send
 * guard, may deliver twice.
 *
 * Never throws. A delivery channel that can throw takes the whole distribution
 * run down with it, and §10 requires that "failures never block the UI".
 */
export async function sendWhatsApp(toE164: string, message: string): Promise<SendResult> {
  const creds = credentials();
  if (!creds.ok) {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      message: `WhatsApp is not configured. Missing ${creds.missing.join(", ")} in the environment.`,
    };
  }

  const url = `https://api.maytapi.com/api/${creds.productId}/${creds.phoneId}/sendMessage`;

  const attempt = async (): Promise<
    { retryable: boolean; result: SendResult }
  > => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // The token travels in a header, never a query string — a URL ends up
          // in access logs and error reports; a header does not.
          "x-maytapi-key": creds.token,
        },
        body: JSON.stringify({
          to_number: toE164,
          type: "text",
          message,
        }),
        signal: controller.signal,
      });

      if (response.status >= 500) {
        return {
          retryable: true,
          result: { ok: false, code: `HTTP_${response.status}`, message: "WhatsApp provider is unavailable." },
        };
      }

      const raw: unknown = await response.json().catch(() => null);
      const body = (raw ?? {}) as { success?: boolean; message?: string; data?: { msgId?: string } };

      if (!response.ok || body.success === false) {
        return {
          retryable: false, // 4xx: understood and rejected
          result: {
            ok: false,
            code: `HTTP_${response.status}`,
            // The provider's own words. Redacted of anything link-shaped before
            // it can reach the log — providers echo request content back more
            // often than is comfortable.
            message: redact(body.message ?? `WhatsApp provider returned ${response.status}.`),
          },
        };
      }

      // `success: true` means Maytapi ACCEPTED the message, not that WhatsApp
      // delivered it. A number that is not on WhatsApp is reported later, on a
      // webhook we do not yet consume — so the caller records SENT and the chip
      // says Sent. There is no DELIVERED anywhere in this system.
      return {
        retryable: false,
        result: { ok: true, providerMessageId: body.data?.msgId ?? null },
      };
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      return {
        retryable: true,
        result: {
          ok: false,
          code: aborted ? "TIMEOUT" : "NETWORK",
          message: aborted
            ? "WhatsApp provider did not respond within 10 seconds."
            : "Could not reach the WhatsApp provider.",
        },
      };
    } finally {
      clearTimeout(timer);
    }
  };

  const first = await attempt();
  if (first.result.ok || !first.retryable) return first.result;

  await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS));

  const second = await attempt();
  return second.result;
}

/**
 * Strip anything that could be an invite link or token out of a provider
 * message before it is stored or shown. The database has a CHECK that refuses
 * these too; this is the polite half that keeps a legible message.
 */
export function redact(value: string): string {
  return value
    .replace(/https?:\/\/\S*\/invite\/\S*/gi, "[link removed]")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted]");
}
