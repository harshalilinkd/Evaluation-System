/** /login — email OTP sign-in. */

import type { Metadata } from "next";

import { AuthShell } from "@/components/appraise/auth-shell";
import { SetupRequired } from "@/components/appraise/setup-required";
import { SignInForm } from "@/app/(public)/login/sign-in-form";
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

  return (
    <AuthShell title="Sign in">
      <SignInForm next={next} initialError={error ? ERRORS[error] : undefined} />
    </AuthShell>
  );
}
