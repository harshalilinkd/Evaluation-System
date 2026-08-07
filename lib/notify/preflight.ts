/** Will the link we are about to send actually work? Pure — no I/O, no server imports. */

/*
 * §10 puts a personal link in every invite, and the whole flow is worthless if
 * that link cannot be opened. Two things silently break it, and neither shows
 * up as an error anywhere: the message sends, the log says SENT, and nobody
 * can do anything with it.
 *
 *   1. A localhost APP_URL. WhatsApp only turns text into a tappable link when
 *      it sees a recognisable domain, so "http://localhost:3000/invite/..." is
 *      plain text — and even copied by hand, a phone cannot reach a laptop.
 *
 *   2. Resend's shared `onboarding@resend.dev` sender, which delivers ONLY to
 *      the address that owns the Resend account. Every other recipient is
 *      rejected by the provider, which is why "email does not send" while the
 *      API key is perfectly valid.
 *
 * §0.7: fail loudly, not silently. HR should be told before they send forty-
 * seven dead links, not after somebody phones to say the link does nothing.
 */

export type Preflight =
  | { ok: true }
  | { ok: false; code: string; title: string; detail: string; fix: string };

/** Hosts that exist only on the machine running the app. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "[::1]"]);

/** RFC 1918 and friends — reachable on the office LAN, never from a phone on mobile data. */
function isPrivateHost(host: string): boolean {
  if (LOOPBACK.has(host)) return true;
  if (host.endsWith(".local") || host.endsWith(".localhost")) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return false;
}

/**
 * Judges the base URL every invite link is built from.
 *
 * Takes the value rather than reading `process.env` so it stays pure and can be
 * exercised against every shape a person might type.
 */
export function checkAppUrl(raw: string | undefined): Preflight {
  const value = (raw ?? "").trim();

  if (value === "") {
    return {
      ok: false,
      code: "APP_URL_MISSING",
      title: "There is no address to send people to",
      detail: "NEXT_PUBLIC_APP_URL is empty, so every invite link would be a path with no site in front of it.",
      fix: "Set NEXT_PUBLIC_APP_URL to the address where this app is running, then restart it.",
    };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return {
      ok: false,
      code: "APP_URL_INVALID",
      title: "The app address is not a valid URL",
      detail: `NEXT_PUBLIC_APP_URL is "${value}", which cannot be read as a web address.`,
      fix: "It should look like https://appraise.linkdprints.com — scheme included, no trailing path.",
    };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      code: "APP_URL_SCHEME",
      title: "The app address is not http or https",
      detail: `NEXT_PUBLIC_APP_URL uses "${url.protocol}", which no messaging app will open.`,
      fix: "Use https://…",
    };
  }

  if (isPrivateHost(url.hostname)) {
    return {
      ok: false,
      code: "APP_URL_LOCAL",
      title: "Invite links would point at this computer",
      detail:
        `NEXT_PUBLIC_APP_URL is "${value}". A phone cannot reach that address, and WhatsApp will not ` +
        "even make it tappable — it only turns text into a link when it sees a real domain name. " +
        "The messages would send, the log would say Sent, and nobody could open the form.",
      fix:
        "Deploy the app and set NEXT_PUBLIC_APP_URL to its public address, or run a tunnel " +
        "(cloudflared / ngrok) and use the address it gives you. Restart the app after changing it.",
    };
  }

  /* -- A host with no dot is a machine name on the local network. WhatsApp will
        not linkify it either, for the same reason: nothing marks it as a
        domain. -- */
  if (!url.hostname.includes(".")) {
    return {
      ok: false,
      code: "APP_URL_NO_DOMAIN",
      title: "The app address has no domain name",
      detail: `"${url.hostname}" is a machine name, not a domain, so WhatsApp will send it as plain text rather than a tappable link.`,
      fix: "Use a public address with a domain, such as https://appraise.linkdprints.com",
    };
  }

  return { ok: true };
}

/**
 * Judges the From address.
 *
 * A warning rather than a refusal: the send genuinely works for the one person
 * who owns the Resend account, which is exactly the case somebody is in while
 * testing. Refusing would block the only path that currently succeeds.
 */
export function checkMailFrom(raw: string | undefined, smtpUser?: string): Preflight {
  const value = (raw ?? "").trim();
  const user = (smtpUser ?? "").trim();

  /* -- SMTP is the transport (AMEND-4). Different rules entirely.
        The resend.dev sandbox warning below is about Resend and would be
        nonsense here; what matters on SMTP is that the From address IS the
        account being signed in as, because Gmail rewrites anything else and the
        message then arrives from somebody other than the app believes. -- */
  if (user !== "") {
    if (value === "") {
      return {
        ok: false,
        code: "MAIL_FROM_MISSING",
        title: "There is no From address for email",
        detail: "MAIL_FROM is empty, so no email can be sent.",
        fix: `Set MAIL_FROM="Appraise <${user}>".`,
      };
    }
    if (!value.toLowerCase().includes(user.toLowerCase())) {
      return {
        ok: false,
        code: "MAIL_FROM_NOT_THE_ACCOUNT",
        title: "Email would arrive from a different address",
        detail:
          `MAIL_FROM is "${value}" but you are signed in to SMTP as ${user}. ` +
          "Gmail rewrites a From address it does not own, so the message would " +
          "arrive from somebody other than the one recorded here.",
        fix: `Set MAIL_FROM="Appraise <${user}>".`,
      };
    }
    return { ok: true };
  }

  if (value === "") {
    return {
      ok: false,
      code: "MAIL_FROM_MISSING",
      title: "There is no From address for email",
      detail: "MAIL_FROM is empty, so no email can be sent.",
      fix: 'Set MAIL_FROM, for example: MAIL_FROM="Appraise <noreply@linkdprints.com>"',
    };
  }

  if (/@resend\.dev>?\s*$/i.test(value)) {
    return {
      ok: false,
      code: "MAIL_FROM_SANDBOX",
      title: "Email will only reach your own inbox",
      detail:
        `MAIL_FROM is "${value}". onboarding@resend.dev is Resend's shared testing sender, and it ` +
        "delivers ONLY to the address that owns the Resend account. Every other employee's email is " +
        "rejected by the provider — which is why WhatsApp arrives and email does not.",
      fix:
        "Verify your domain at resend.com/domains, then set MAIL_FROM to an address on it, " +
        'for example MAIL_FROM="Appraise <noreply@linkdprints.com>". Restart the app after changing it.',
    };
  }

  return { ok: true };
}

/**
 * The ONE place a link to this app is built.
 *
 * Every call site used to do `process.env.NEXT_PUBLIC_APP_URL ?? ""` and
 * concatenate — four of them, in four files. When the variable is unset that
 * produces `/invite/C3rpy9…`: a bare path with no site in front of it. It sends
 * perfectly, logs as Sent, and arrives as plain grey text that no messaging app
 * will linkify, because there is nothing there to link TO.
 *
 * Throwing is deliberate, and better than the alternatives. Returning the path
 * anyway is what has been happening. Returning null would push the decision to
 * four callers who would each have to remember to check. A throw stops the
 * message being built at all — and every sending path already catches
 * (PW-2: the notify hook must never turn a submitted form into a reported
 * failure), so the outcome is an honest "we could not reach them" rather than
 * a message nobody can use.
 */
export function absoluteUrl(path: string): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL;
  const health = checkAppUrl(raw);
  if (!health.ok) {
    throw new Error(
      `Cannot build a link: ${health.title}. ${health.detail} ${health.fix}`,
    );
  }
  const base = (raw ?? "").trim().replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Both, for a screen that wants to show everything wrong at once. */
export function preflightAll(env: {
  appUrl: string | undefined;
  mailFrom: string | undefined;
  /** Present when SMTP is the transport — it changes what a valid From is. */
  smtpUser?: string | undefined;
}): { appUrl: Preflight; mailFrom: Preflight } {
  return {
    appUrl: checkAppUrl(env.appUrl),
    mailFrom: checkMailFrom(env.mailFrom, env.smtpUser),
  };
}
