/** /login — email OTP sign-in. */

import type { Metadata } from "next";

import { AuthShell } from "@/components/appraise/auth-shell";
import { SetupRequired } from "@/components/appraise/setup-required";
import { SignInForm } from "@/app/(public)/login/sign-in-form";
import { getCurrentProfile } from "@/lib/auth/roles";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Sign in" };

// Copy tone per DESIGN.md §8: plain, warm, adult. Say what happened and what to
// do next. Never a raw status enum.
const ERRORS: Record<string, string> = {
  account_inactive: "This account has been deactivated. Ask HR to reactivate it.",
  session_expired: "You were signed out. Sign in again to carry on.",
  // Reached when the password was right but no profile row exists — almost
  // always an account created before the migrations were applied. Naming the
  // cause is the difference between a five-minute fix and an afternoon.
  /* -- Google returned somebody we do not know, or the exchange failed. The
        same sentence either way, on purpose: P6-7 forbids a login page that
        tells you whether an address has an account.

        REWORDED to cover the dual-email case (P8, AMEND-4): an account is
        registered under ONE email, and Google sign-in only recognises THAT
        one automatically — a second address (most often the official one)
        has to be linked once from /profile before Google works for it too.
        Reported as "not able to login" for exactly this shape: a real
        account, a real password, Google tried with the OTHER address.

        Still says nothing about whether the SPECIFIC address tried has an
        account — it states the general rule (§9's dual-email design), not a
        fact about this one address, so it does not become the staff
        directory P6-7 forbids. -- */
  google_unavailable:
    "Google sign-in is not switched on yet. Use your email and password, or ask HR.",
  no_account:
    "That Google account is not recognised here. If you already have an account under a different email, sign in below with your password, then link this Google account from your profile — after that both will work. Otherwise, ask HR to add you.",
  no_profile:
    "Your sign-in worked, but this account has no profile record yet. Ask HR to add you, or — if you are setting the system up — apply the database migrations and create the account again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  // Checked before anything touches the Supabase client, so an unconfigured
  // project gets an explanation rather than a thrown error from three frames in.
  if (!isSupabaseConfigured()) return <SetupRequired />;

  const { next, error } = await searchParams;

  /* -- Who is signed in RIGHT NOW, if anybody.
        Reaching this page with a session used to be impossible — middleware
        bounced every signed-in visitor to the dashboard, which is what stopped
        people switching accounts on a shared device. It is possible now, and
        arriving at a blank sign-in form while quietly still signed in as
        somebody else is disorienting: the form looks like it did nothing if you
        type the same credentials back in.

        So the page says whose session is live and that signing in will replace
        it. Only the name — an email here would turn the login page into a way
        of reading the last user's address off a shared phone. -- */
  const current = await getCurrentProfile();

  return (
    <AuthShell title="Sign in">
      {current ? (
        <p className="mb-4 rounded-card bg-surface-mute px-4 py-3 text-body-sm text-ink-muted">
          You are signed in as{" "}
          <span className="font-medium text-ink">{current.full_name}</span>. Signing in below
          replaces that session on this device.
        </p>
      ) : null}

      <SignInForm next={next} initialError={error ? ERRORS[error] : undefined} />
    </AuthShell>
  );
}
