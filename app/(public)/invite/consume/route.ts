/** /invite/consume — burns the link once a session exists, then lands the person. */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { INVITE_COOKIE } from "@/lib/auth/invite-cookie";
import { consumeInviteToken } from "@/lib/auth/invites";
import { getCurrentProfile } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * A Route Handler for the same reason `[token]` is one: this step DELETES the
 * hand-off cookie, and a Server Component cannot write cookies at all — set or
 * delete. It was the second 500 waiting immediately behind the first.
 */
export async function GET(request: Request) {
  const cookieStore = await cookies();
  const inviteId = cookieStore.get(INVITE_COOKIE)?.value;

  const to = (path: string) => NextResponse.redirect(new URL(path, request.url));

  // The cookie is the only thing tying this route to an invite. Reached without
  // one, there is nothing to consume — and taking an invite id from the request
  // would let anyone supply one.
  if (!inviteId) return to("/invite/invalid");

  const profile = await getCurrentProfile();
  if (!profile) {
    return to(`/login?next=${encodeURIComponent("/invite/consume")}`);
  }

  // consume_invite_token re-checks the session against the invite's profile, so
  // signing in as somebody else cannot burn this link (§10).
  const consumed = await consumeInviteToken(inviteId);

  const landing =
    consumed.status === "OK"
      ? // §10: the link grants this one evaluation and nothing else — and
        // it must open the form THAT PERSON fills. A LEAD token landed on
        // the employee's self-evaluation, where the manager is not the
        // evaluatee: the guard bounced them, and the token was already
        // spent. One tap, a dead end, and a link that cannot be retried.
        consumed.layer === "LEAD" || consumed.layer === "LEAD_2"
        ? `/team/${consumed.evaluationId}`
        : `/my-evaluation/${consumed.evaluationId}`
      : consumed.status === "WRONG_RECIPIENT"
        ? "/invite/wrong-recipient"
        : consumed.status === "EXPIRED"
          ? "/invite/expired"
          : consumed.status === "REVOKED"
            ? "/invite/revoked"
            : "/invite/invalid";

  /* -- Cleared on EVERY outcome, not only success.
        A cookie left behind after a wrong-recipient or expired result would be
        re-consumed on the next visit to this route and produce the same failure
        again, which reads as the link being permanently broken rather than
        spent. -- */
  const response = to(landing);
  response.cookies.delete(INVITE_COOKIE);
  return response;
}
