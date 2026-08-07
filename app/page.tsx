/** Root route: sends each person to the home their roles imply. */

import { redirect } from "next/navigation";

import { getCurrentProfile, getRoles } from "@/lib/auth/roles";
import { landingPathFor, ROUTES } from "@/lib/auth/landing";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  // Without credentials there is no session to read; /login explains the fix.
  if (!isSupabaseConfigured()) redirect(ROUTES.login);

  const profile = await getCurrentProfile();

  if (!profile) redirect(ROUTES.login);

  // HR to cycles, MD to the review queue, everyone else to their own appraisal.
  // A lead is NOT sent to /team — see the note on landingPathFor.
  redirect(landingPathFor(await getRoles()));
}
