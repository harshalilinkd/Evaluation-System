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

/**
 * Where this app is reachable, WITHOUT anybody having to say so.
 *
 * `NEXT_PUBLIC_APP_URL` being unset was the single most likely thing to go
 * wrong on a deploy, and its failure is silent at exactly the wrong moment:
 * the messages send, the log says Sent, and nobody can open the form. Worse,
 * `NEXT_PUBLIC_*` is inlined at BUILD time, so setting it after the fact does
 * nothing until somebody remembers to redeploy.
 *
 * Vercel already knows the answer and publishes it, so ask it rather than
 * asking a person. The order matters:
 *
 *   1. NEXT_PUBLIC_APP_URL — an explicit setting always wins. This is how a
 *      custom domain gets used in preference to the *.vercel.app one, and how
 *      a tunnel is pointed at during local testing.
 *   2. VERCEL_PROJECT_PRODUCTION_URL — the project's STABLE production domain,
 *      set automatically. Not VERCEL_URL first: that is deployment-specific
 *      and changes on every push, so an invite link built from it would name a
 *      deployment that is three versions old by the time somebody opens it.
 *   3. VERCEL_URL — the per-deployment address, as a last resort. Better than
 *      nothing on a preview where no production domain exists yet.
 *
 * Server-side only, deliberately. These two are not `NEXT_PUBLIC_`, so they
 * never reach the browser — and every link this app builds is built on the
 * server, so none of them needs to.
 *
 * Localhost is NOT a fallback. There is no value that makes a link work from a
 * phone in development, so inventing one would only move the failure from a
 * clear refusal to a message nobody can open.
 */
export function resolveAppUrl(): string | undefined {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit;

  // Vercel publishes these without a scheme. Always https — every Vercel
  // domain is served over TLS, and WhatsApp will not linkify a bare host.
  const stable = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (stable) return `https://${stable.replace(/^https?:\/\//, "")}`;

  const deployment = process.env.VERCEL_URL?.trim();
  if (deployment) return `https://${deployment.replace(/^https?:\/\//, "")}`;

  return undefined;
}

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
      detail:
        "This app could not work out its own address, so every invite link would be a path with " +
        "no site in front of it. On Vercel the address is detected automatically, so seeing this " +
        "means the app is running somewhere else — most often a developer's own machine.",
      fix:
        "If you are running it locally, links cannot reach a phone from here at all — use a tunnel " +
        "(cloudflared / ngrok) and set NEXT_PUBLIC_APP_URL to the address it gives you. On a server, " +
        "set NEXT_PUBLIC_APP_URL to the public address and restart.",
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
        fix: `Set MAIL_FROM="Appraisal <${user}>".`,
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
        fix: `Set MAIL_FROM="Appraisal <${user}>".`,
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
      fix: 'Set MAIL_FROM, for example: MAIL_FROM="Appraisal <noreply@linkdprints.com>"',
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
        'for example MAIL_FROM="Appraisal <noreply@linkdprints.com>". Restart the app after changing it.',
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
  const raw = resolveAppUrl();
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
