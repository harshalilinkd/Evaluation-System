/** The invite hand-off cookie. Shared, so no route imports a constant from another route. */

/**
 * The invite reference travels in an httpOnly cookie, never in a URL.
 *
 * §10 allows the token in the path of ONE request and nowhere else. Every
 * onward step — the login hand-off, the six outcome pages, the evaluation
 * itself — is reached by redirect, so the token never lands in a Referer
 * header, in history beyond that hop, or in an analytics query string.
 *
 * The cookie holds the INVITE ID, not the token: once verified there is no
 * reason to keep the secret alive any longer than the request that used it
 * (P6-2).
 *
 * It lives here rather than in a route file because two routes need it and a
 * `route.ts` is not a module other code should be importing values from.
 */
export const INVITE_COOKIE = "appraise_invite";

/** Thirty minutes: long enough to sign in, short enough not to linger. */
export const INVITE_COOKIE_MAX_AGE = 60 * 30;

export const INVITE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: INVITE_COOKIE_MAX_AGE,
} as const;
