import "server-only";

/** Who may rate a shop-floor worker. One query, used by both entry points. */

import { createClient } from "@/lib/supabase/server";

export type RaterOption = {
  id: string;
  name: string;
  /** Their job title, so two people called Sharma are tellable apart. */
  designation: string | null;
};

/**
 * People holding the SUPERVISOR access level.
 *
 * FILTERED TO THE ROLE, not to everybody on staff. The first version offered
 * every staff member with their role printed beside them, on the reasoning that
 * a department head might genuinely supervise the floor — which is true and was
 * still the wrong call. A picker of fifty names, forty-eight of which are
 * wrong, does not help somebody choose; it just moves the mistake from a silent
 * default to a long list. §7 gives the worker module its own role for exactly
 * this question, and answering it with that role is what the role is for.
 *
 * WHEN NOBODY HOLDS IT the caller gets an empty list and says so, with the fix
 * named. An empty dropdown reading "Nobody chosen" and nothing else — which is
 * what shipped — is a dead end (§13.4): it states the problem in the one place
 * that cannot explain it.
 */
export async function listWorkerRaters(): Promise<RaterOption[]> {
  const supabase = await createClient();

  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("profile_id")
    .eq("role", "SUPERVISOR");

  const ids = [...new Set((roleRows ?? []).map((r) => r.profile_id))];
  if (ids.length === 0) return [];

  /* -- Active only. Somebody who has left still holds their role grants —
        `is_active` is how a departure is recorded (P4-5), not a deleted row —
        so without this the picker would offer people who cannot sign in. -- */
  const { data: people } = await supabase
    .from("profiles")
    .select("id, full_name, designation")
    .in("id", ids)
    .eq("is_active", true)
    .order("full_name");

  return (people ?? []).map((p) => ({
    id: p.id,
    name: p.full_name,
    designation: p.designation,
  }));
}
