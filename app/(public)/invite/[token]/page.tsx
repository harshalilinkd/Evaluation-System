/** /invite/[token] — consume a link and get the person to their evaluation. */

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { verifyInviteToken } from "@/lib/auth/invites";
import { getCurrentProfile } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Opening your evaluation", robots: { index: false } };

// Single-use and state-dependent: never cached, never prerendered.
export const dynamic = "force-dynamic";

/**
 * The invite reference travels in an httpOnly cookie, never in a URL.
 *
 * §10 allows the token in the path of THIS request and nowhere else. Every
 * onward step — the login hand-off, the six outcome pages, the evaluation
 * itself — is reached by redirect, so the token never lands in a Referer
 * header, in history beyond this hop, or in an analytics query string.
 *
 * The cookie holds the invite id, not the token: once verified there is no
 * reason to keep the secret alive any longer than the request that used it.
 */
export const INVITE_COOKIE = "appraise_invite";
const INVITE_COOKIE_MAX_AGE = 60 * 30; // 30 minutes: long enough to sign in.

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const result = await verifyInviteToken(token);

  // Each outcome has a page of its own, reached by redirect so the token leaves
  // the URL immediately (§10).
  if (result.status !== "OK") {
    switch (result.status) {
      case "EXPIRED":
        redirect("/invite/expired");
      case "USED":
        redirect("/invite/used");
      case "REVOKED":
        redirect("/invite/revoked");
      case "RATE_LIMITED":
        redirect("/invite/locked");
      default:
        redirect("/invite/invalid");
    }
  }

  const cookieStore = await cookies();
  cookieStore.set(INVITE_COOKIE, result.inviteId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: INVITE_COOKIE_MAX_AGE,
  });

  const profile = await getCurrentProfile();

  // Already signed in as the right person: nothing to prove.
  if (profile && profile.id === result.profileId) {
    redirect("/invite/consume");
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
  redirect(`/login?next=${encodeURIComponent("/invite/consume")}`);
}
