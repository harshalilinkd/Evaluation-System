/** Copy for every way an invite link can fail. DESIGN.md §8. */

import Link from "next/link";

import { AuthShell, Explanation } from "@/components/appraise/auth-shell";
import { Button } from "@/components/ui/button";

/**
 * Every message here follows DESIGN.md §8: plain, warm, adult; short sentences;
 * no exclamation marks, no emoji, no "Oops!". Say what happened and what to do
 * next. The employee did nothing wrong in any of these cases, and the copy
 * should not imply otherwise.
 *
 * None of them names a status enum, a token or an email — the person reading
 * this may be standing on a shop floor with a forwarded WhatsApp message.
 */
export const INVITE_STATES = {
  expired: {
    title: "This link has expired",
    heading: "Your evaluation link is no longer valid",
    // Wording taken from DESIGN.md §8's worked example.
    body: "Links stop working a week after the self-evaluation deadline. Ask HR to send you a fresh one.",
  },
  used: {
    title: "This link has been used",
    heading: "You have already opened this link",
    body: "Each link works once. If you are signed in, your evaluation is on your dashboard. If not, sign in with your work email.",
  },
  revoked: {
    title: "This link has been replaced",
    heading: "A newer link was sent",
    body: "HR sent you a more recent link, which replaced this one. Check your most recent message, or ask HR to resend.",
  },
  locked: {
    title: "Too many attempts",
    heading: "This link is locked for an hour",
    body: "It has been opened too many times in a short period. Wait an hour and try again, or ask HR for a fresh link.",
  },
  invalid: {
    title: "This link is not valid",
    heading: "We could not open this link",
    body: "It may have been copied incompletely. Try opening it again from the original message, or ask HR to resend.",
  },
  "wrong-recipient": {
    title: "This link belongs to someone else",
    heading: "This evaluation is not yours",
    body: "You are signed in as a different person. Sign out, then open the link again from your own message.",
  },
} as const;

export type InviteStateKey = keyof typeof INVITE_STATES;

export function InviteStatePage({ state }: { state: InviteStateKey }) {
  const copy = INVITE_STATES[state];

  return (
    <AuthShell eyebrow="Performance evaluation" title={copy.title}>
      <Explanation
        heading={copy.heading}
        body={copy.body}
        action={
          // §13.4: no dead ends. Every one of these pages offers a way onward.
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">Sign in with your work email</Link>
          </Button>
        }
      />
    </AuthShell>
  );
}
