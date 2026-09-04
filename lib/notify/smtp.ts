/** SMTP email, for sending from a Gmail or Workspace account. AMEND-4. */

import "server-only";

import nodemailer from "nodemailer";

import { redact, type SendResult } from "@/lib/notify/maytapi";

/*
 * WHY THIS EXISTS, AND WHAT IT CHANGES.
 *
 * §2 pins Resend as the email provider. The owner asked to send from their own
 * Google account instead, which Resend cannot do — it will only send from a
 * domain you have verified with it. Gmail speaks SMTP and nothing else, so this
 * is a second transport, added at their explicit instruction and recorded as an
 * amendment in §18 rather than slipped in.
 *
 * RESEND IS NOT REMOVED. Which transport runs is decided by which credentials
 * are present (see `email.ts`), so moving to a verified domain later is a
 * settings change rather than another code change. The tested path stays
 * exactly as it was.
 *
 * WHAT GMAIL COSTS, stated where somebody will read it:
 *   · roughly 500 messages a day on a free account, 2,000 on Workspace. Google
 *     throttles or locks the account past that, and it locks the account rather
 *     than failing the message.
 *   · the From address must be the account itself or one of its verified
 *     aliases. Gmail rewrites anything else, so `MAIL_FROM` is checked against
 *     `SMTP_USER` below rather than being allowed to silently disagree.
 *   · it needs an App Password, not the account password, and App Passwords
 *     only exist once 2-Step Verification is on.
 */

const TIMEOUT_MS = 15_000;

function credentials():
  | { ok: true; host: string; port: number; user: string; pass: string; from: string }
  | { ok: false; missing: string[] } {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const from = process.env.MAIL_FROM;

  const missing = [
    !user && "SMTP_USER",
    !pass && "SMTP_PASSWORD",
    !from && "MAIL_FROM",
  ].filter((v): v is string => Boolean(v));

  if (missing.length > 0) return { ok: false, missing };

  return {
    ok: true,
    /* -- Gmail's defaults, overridable for Workspace relays or another provider.
          `||`, NOT `??`. A key written blank in .env — `SMTP_HOST=`, which is
          exactly how the template ships it — is PRESENT and empty, not absent,
          so `??` keeps the empty string. That gave host "" and, through
          Number(""), port 0: a connection to nowhere, reported as a timeout,
          with the settings looking perfectly correct on screen. -- */
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 465),
    // Trimmed: Google prints the App Password in four groups and it is usually
    // pasted with the spaces still in, which SMTP AUTH sends literally.
    user: user!.trim(),
    pass: pass!.replace(/\s+/g, ""),
    from: from!.trim(),
  };
}

/** Whether SMTP is the configured transport. Read by `email.ts` and the screens. */
export function smtpConfigured(): boolean {
  return credentials().ok;
}

/** The two failures that actually happen, told apart. Shared by send and verify. */
function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  // Gmail's own wording for a rejected App Password sends people to reset their
  // account password, which is the wrong fix and locks nothing in.
  if (/invalid login|username and password not accepted|535/i.test(message)) {
    return (
      "Gmail rejected the sign-in. Use a 16-character App Password, not your " +
      "account password — and 2-Step Verification has to be on for App " +
      "Passwords to exist at all."
    );
  }
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|greeting never received/i.test(message)) {
    return (
      "Could not reach the mail server. Check SMTP_HOST and SMTP_PORT — " +
      "Gmail is smtp.gmail.com on 465. Some networks block outbound SMTP."
    );
  }
  return redact(message);
}

/**
 * Open the connection and authenticate, WITHOUT sending anything.
 *
 * This exists because the only way to find out an App Password was mistyped
 * used to be launching a cycle and watching 47 invites fail. It is deliberately
 * not a send: `dispatch.ts` is the single path a message may leave by (§10),
 * and a "test send" bolted on beside it would be a second one — unlogged, and
 * needing a template key that is not a product message.
 *
 * What it proves: the host, the port and the credentials. What it does not:
 * that a given recipient will accept the mail. The From address is checked by
 * `checkMailFrom` in preflight.ts, which is where that rule already lives.
 */
/* ---------- The connection, reused ---------- */

/**
 * ONE authenticated connection, kept for the life of the process.
 *
 * Reported as "cycles taking too much time to launch", and this was most of
 * it. A launch sends every invite in turn, and each one was opening a NEW
 * connection: TCP, then a TLS handshake, then SMTP AUTH, for every single
 * message. Against Gmail that is a second or two of pure setup before a byte
 * of the message moves — so the cost was not the mail, it was reintroducing
 * ourselves to the server once per recipient.
 *
 * `pool: true` reuses the authenticated connection instead. `maxMessages`
 * exists because Gmail drops a session after a while whatever we do; letting
 * nodemailer retire a connection on its own terms is cheaper than discovering
 * it mid-send.
 *
 * Keyed on the credentials, so changing the account in Settings › Messages
 * builds a new transport rather than going on using the old login (P32 exists
 * precisely so a wrong login is found before a launch, and a cached one that
 * outlived the setting would defeat it).
 *
 * NOT shared with `verifySmtp`. That one is a connection test, and testing a
 * connection we are already holding open proves the pool is warm rather than
 * that the credentials work — which is the whole question it is asked.
 */
type Creds = Extract<ReturnType<typeof credentials>, { ok: true }>;

let pooled: { key: string; transport: nodemailer.Transporter } | null = null;

function transportFor(creds: Creds): nodemailer.Transporter {
  const key = `${creds.host}:${creds.port}:${creds.user}:${creds.pass}`;
  if (pooled?.key === key) return pooled.transport;

  // A credentials change orphans the old pool; close it rather than leaving
  // its sockets open for the rest of the process.
  pooled?.transport.close();

  const transport = nodemailer.createTransport({
    host: creds.host,
    port: creds.port,
    secure: creds.port === 465,
    auth: { user: creds.user, pass: creds.pass },
    pool: true,
    maxConnections: 3,
    maxMessages: 50,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });

  pooled = { key, transport };
  return transport;
}

/**
 * A failure that means "the connection we were holding is gone", not "this
 * message is wrong".
 *
 * A serverless function can be frozen between requests and its sockets closed
 * underneath it, so the first send after a pause can fail on a connection that
 * looked fine. Retried ONCE on a fresh pool — and only for these, because
 * retrying a rejected recipient or a bad password would send the same message
 * twice or lock the account faster.
 */
function isStaleConnection(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? "";
  return ["ECONNRESET", "EPIPE", "ETIMEDOUT", "ESOCKET", "ECONNECTION"].includes(code);
}

export async function verifySmtp(): Promise<SendResult> {
  const creds = credentials();
  if (!creds.ok) {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      message: `SMTP is not set up. Missing: ${creds.missing.join(", ")}.`,
    };
  }

  try {
    const transport = nodemailer.createTransport({
      host: creds.host,
      port: creds.port,
      secure: creds.port === 465,
      auth: { user: creds.user, pass: creds.pass },
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    });

    await transport.verify();
    return { ok: true, providerMessageId: null };
  } catch (error) {
    return { ok: false, code: "SMTP_VERIFY_FAILED", message: explain(error) };
  }
}

/**
 * Send one email over SMTP.
 *
 * Same contract as `sendEmail` and `sendWhatsApp`: it never throws, and it
 * returns a typed result. A caller that has to wrap every send in a try/catch
 * is a caller that will eventually forget.
 *
 * BOTH BODIES, ALWAYS — the same rule the Resend path follows. A message with
 * only HTML lands in spam more often and is unreadable in a text-only client.
 */
export async function sendEmailViaSmtp(
  to: string,
  subject: string,
  text: string,
  html: string,
): Promise<SendResult> {
  const creds = credentials();
  if (!creds.ok) {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      message: `SMTP is not set up. Missing: ${creds.missing.join(", ")}.`,
    };
  }

  /* -- The From address must be the authenticated account.
        Gmail silently rewrites a From it does not own, so the message arrives
        from somebody other than the person the app believes sent it. Refusing
        is better than a message whose sender quietly disagrees with the log. -- */
  if (!creds.from.toLowerCase().includes(creds.user.toLowerCase())) {
    return {
      ok: false,
      code: "FROM_MISMATCH",
      message:
        `MAIL_FROM must be the account you are sending from. It is "${creds.from}" ` +
        `but you are signed in as ${creds.user} — Gmail will rewrite it. ` +
        `Set MAIL_FROM="Appraisal <${creds.user}>".`,
    };
  }

  // 465 is implicit TLS; 587 upgrades with STARTTLS. Never plaintext — see
  // `transportFor`, which owns the connection now.
  const envelope = { from: creds.from, to, subject, text, html };

  try {
    const info = await transportFor(creds).sendMail(envelope);
    return { ok: true, providerMessageId: info.messageId ?? null };
  } catch (error) {
    if (isStaleConnection(error)) {
      pooled?.transport.close();
      pooled = null;
      try {
        const info = await transportFor(creds).sendMail(envelope);
        return { ok: true, providerMessageId: info.messageId ?? null };
      } catch (retryError) {
        return { ok: false, code: "SMTP_FAILED", message: explain(retryError) };
      }
    }
    /* -- `explain` redacts before anything reaches a log or a screen.
          An SMTP failure echoes the envelope back, and on a bad password Gmail
          replies with the username in the error string. §0.3 and §17 keep
          credentials out of logs, and P11-2's CHECK constraint would refuse the
          row anyway.

          Shared with `verifySmtp` on purpose: two copies of "what does this
          error mean" is how the check starts giving different advice from the
          send it is meant to be testing. -- */
    return { ok: false, code: "SMTP_FAILED", message: explain(error) };
  }
}
