/** /invite/[token] — consume a link and get the person to their evaluation. */

import { NextResponse } from "next/server";

import { INVITE_COOKIE, INVITE_COOKIE_OPTIONS } from "@/lib/auth/invite-cookie";
import { verifyInviteToken } from "@/lib/auth/invites";
import { getCurrentProfile } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

// Single-use and state-dependent: never cached, never prerendered.
export const dynamic = "force-dynamic";

/**
 * A ROUTE HANDLER, not a page — and that is the bug this file exists to fix.
 *
 * It was a Server Component that called `cookies().set()`. Next forbids writing
 * a cookie outside a Server Action or a Route Handler, so the call THREW and
 * every invite link a person opened returned "This page couldn't load. A server
 * error occurred." The link was minted correctly, sent correctly and logged as
 * Sent; it simply could not be opened by anybody.
 *
 * Nothing hid it. `lib/supabase/server.ts` wraps its own cookie writes in a
 * try/catch with a comment explaining that a Server Component cannot write
 * cookies — the constraint was known and written down in this codebase. This
 * route just called `set` directly, unguarded, and swallowing it here would
 * have been worse: the hand-off cookie is the only thing carrying the invite
 * across the login step, so a silently dropped write lands the person on
 * "invalid link" instead.
 *
 * A Route Handler is where a redirect-with-cookie belongs. §10 is unchanged:
 * the token appears in this one URL and every onward hop is a redirect, so it
 * never reaches a Referer header or browser history beyond this request.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const result = await verifyInviteToken(token);

  const to = (path: string) => NextResponse.redirect(new URL(path, request.url));

  // Each outcome has a page of its own, reached by redirect so the token leaves
  // the URL immediately (§10).
  if (result.status !== "OK") {
    switch (result.status) {
      case "EXPIRED":
        return to("/invite/expired");
      case "USED":
        return to("/invite/used");
      case "REVOKED":
        return to("/invite/revoked");
      case "RATE_LIMITED":
        return to("/invite/locked");
      default:
        return to("/invite/invalid");
    }
  }

  const profile = await getCurrentProfile();

  // Already signed in as the right person: nothing to prove.
  if (profile && profile.id === result.profileId) {
    const response = to("/invite/consume");
    response.cookies.set(INVITE_COOKIE, result.inviteId, INVITE_COOKIE_OPTIONS);
    return response;
  }

  // Signed in as somebody else — a shared device or a forwarded link. Sign them
  // out rather than failing silently; the fix is to become the right person.
  if (profile && profile.id !== result.profileId) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }

  // No session. Hand off to the password login and come straight back. The
  // cookie is what carries the invite across, so nothing sensitive rides in the
  // `next` parameter.
  const response = to(`/login?next=${encodeURIComponent("/invite/consume")}`);
  response.cookies.set(INVITE_COOKIE, result.inviteId, INVITE_COOKIE_OPTIONS);
  return response;
}
