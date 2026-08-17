"use server";

/** Changing your OWN password. Nobody else's — that is HR's screen. */

import { newPasswordSchema } from "@/lib/auth/schemas";
import { getCurrentProfile } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

export type PasswordState = { error?: string; message?: string };

/**
 * Change the signed-in person's password.
 *
 * THE CURRENT PASSWORD IS REQUIRED, and that is the whole security of this
 * screen. Supabase's `updateUser` changes the password of whoever holds the
 * session and asks for no proof — so without this check, an unattended signed-in
 * laptop is an account takeover rather than a nuisance. It is verified by
 * signing in with it, which is the only way to test a password the application
 * never stores.
 *
 * NO SERVICE-ROLE KEY. §0.5 permits it for notification and cron code and for
 * the single Admin API call that creates an account; changing your own password
 * is neither, and `updateUser` on the authenticated client is exactly the right
 * tool — it can only ever act on the caller's own user.
 *
 * `newPasswordSchema` is the SAME rule HR's screen applies, so the two cannot
 * disagree about what is acceptable. At the owner's instruction that is now six
 * characters, matching Supabase's own floor.
 */
export async function changeMyPassword(
  _prev: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Please sign in again." };

  /* -- A worker has no address on their profile (0071) and never signs in, so
        there is nothing here for them to change. They cannot reach this screen
        anyway; this is the honest failure rather than a confusing one. -- */
  if (!profile.email) {
    return { error: "This account has no email address, so it has no password to change." };
  }

  const current = String(formData.get("current_password") ?? "");
  const next = String(formData.get("new_password") ?? "");
  const confirm = String(formData.get("confirm_password") ?? "");

  if (!current) return { error: "Enter your current password." };

  const parsed = newPasswordSchema.safeParse(next);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "That new password is not usable." };
  }

  /* -- Checked here rather than left to the two fields looking different on
        screen: a typo repeated in both boxes is the case this catches, and it
        is the one that locks somebody out of their own account. -- */
  if (next !== confirm) return { error: "The two new passwords do not match." };

  if (next === current) {
    return { error: "That is the password you already have. Choose a different one." };
  }

  const supabase = await createClient();

  /* -- PROVE THEY KNOW THE CURRENT ONE.
        `signInWithPassword` is the only way to verify a password the
        application does not store. It re-issues the session for the SAME
        person, so a correct answer leaves them signed in exactly as they
        were — and a wrong one changes nothing at all. -- */
  const { error: wrong } = await supabase.auth.signInWithPassword({
    email: profile.email,
    password: current,
  });
  if (wrong) {
    // Deliberately not "that password is wrong for harshali@…": they are already
    // signed in as themselves, so there is nothing to disclose, but a message
    // that names the account teaches the habit of reading one.
    return { error: "That is not your current password." };
  }

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) {
    /* -- The provider's own words, because it knows things this form does not:
          a password on its breach list, or a minimum raised in the Supabase
          dashboard above the one this schema enforces. Paraphrasing it would
          send somebody to change the wrong thing (§0.7). -- */
    return { error: error.message };
  }

  /* -- NOT AUDITED, and that is deliberate rather than an omission.
        §12 lists what `audit_log` records — status transitions, decisions,
        question-bank edits, token issue and use, role changes. A person
        changing their own password is none of those: it grants nothing, moves
        nothing and decides nothing. `audit_log` also has no insert path outside
        the transition window and the two gated admin functions, so recording it
        would mean widening one of them for an event §12 does not ask for. -- */
  return { message: "Password changed. It works from your next sign-in." };
}
