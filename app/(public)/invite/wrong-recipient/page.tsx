/** /invite/wrong-recipient */

import type { Metadata } from "next";
import Link from "next/link";

import { INVITE_STATES, InviteStatePage } from "@/app/(public)/invite/_states";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";
import { ROUTES } from "@/lib/auth/landing";
import { getCurrentProfile } from "@/lib/auth/roles";

export const metadata: Metadata = {
  title: INVITE_STATES["wrong-recipient"].title,
  robots: { index: false },
};

// There is a session read below, so this cannot be prerendered.
export const dynamic = "force-dynamic";

/**
 * THE ONE INVITE STATE YOU REACH WHILE SIGNED IN, which is why it needs its own
 * page rather than the shared one.
 *
 * It offered a single control — "Sign in with your work email" — on a page you
 * can only see BECAUSE you are already signed in. Following it hit a login form
 * that saw the existing session and bounced straight back here. The advice in
 * the body ("sign out, then open the link again") named the fix and the page
 * could not perform it. That loop is indistinguishable from the link being
 * permanently broken, and it is what people mean when they say every user lands
 * on this page.
 *
 * Both real situations now have a control:
 *
 *   · You are yourself, and somebody forwarded you a link that is not yours.
 *     You do not want to sign out — you want your own form. That is the primary
 *     action, and it costs nothing to offer: it goes to `/my-evaluation`, which
 *     is guarded and scoped to the reader, so it can only ever show them theirs.
 *
 *   · You are on somebody else's device, or the wrong account. Sign out, then
 *     open the link again from your own message.
 *
 * WHAT DID NOT CHANGE, deliberately: `consume_invite_token` still refuses to
 * burn a link for anybody but its recipient (P6-5), and no route here will open
 * another person's evaluation. §5's blindness invariant is the reason that
 * check exists — an employee must never reach their HOD's form, or the reverse.
 * Making the wrong link openable would have been the fastest way to satisfy
 * "let anybody in from any device" and the wrong one; the right answer is that
 * anybody with an email and a password can sign in and reach THEIR OWN work,
 * which is what this page now leads them to.
 */
export default async function Page() {
  const profile = await getCurrentProfile();

  return (
    <InviteStatePage
      state="wrong-recipient"
      action={
        <div className="w-full space-y-2">
          {profile ? (
            <Button asChild className="min-h-11 w-full">
              <Link href={ROUTES.myEvaluation}>Go to my own evaluation</Link>
            </Button>
          ) : null}

          <form action={signOut}>
            <Button
              type="submit"
              variant={profile ? "outline" : "default"}
              className="min-h-11 w-full"
            >
              {/* Named for what it achieves, not for the mechanism. Somebody
                  reading this is trying to open a link, not to manage a
                  session. */}
              Sign out and use a different account
            </Button>
          </form>
        </div>
      }
    />
  );
}
