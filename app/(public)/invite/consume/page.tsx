/** /invite/consume — burns the link once a session exists, then lands the person. */

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { INVITE_COOKIE } from "@/app/(public)/invite/[token]/page";
import { consumeInviteToken } from "@/lib/auth/invites";
import { getCurrentProfile } from "@/lib/auth/roles";

export const metadata: Metadata = { title: "Opening your evaluation", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function InviteConsumePage() {
  const cookieStore = await cookies();
  const inviteId = cookieStore.get(INVITE_COOKIE)?.value;

  // The cookie is the only thing tying this route to an invite. Reached without
  // one, there is nothing to consume — and taking an invite id from the request
  // would let anyone supply one.
  if (!inviteId) redirect("/invite/invalid");

  const profile = await getCurrentProfile();
  if (!profile) {
    redirect(`/login?next=${encodeURIComponent("/invite/consume")}`);
  }

  // consume_invite_token re-checks the session against the invite's profile, so
  // signing in as somebody else cannot burn this link (§10).
  const consumed = await consumeInviteToken(inviteId);
  cookieStore.delete(INVITE_COOKIE);

  if (consumed.status === "WRONG_RECIPIENT") redirect("/invite/wrong-recipient");
  if (consumed.status === "EXPIRED") redirect("/invite/expired");
  if (consumed.status === "REVOKED") redirect("/invite/revoked");
  if (consumed.status !== "OK") redirect("/invite/invalid");

  // §10: the link grants this one evaluation and nothing else.
  redirect(`/my-evaluation/${consumed.evaluationId}`);
}
