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

/**
 * Does this person have any production appraisal to fill in or to review?
 *
 * The nav item for `/worker-team` is gated on the SUPERVISOR access level, and
 * that stopped being the whole answer twice over:
 *
 *   * a TEAM LEADER is whoever the worker reports to, and at the owner's
 *     instruction that is true "despite their access level" — so a team leader
 *     with no SUPERVISOR grant had the sheet assigned to them and no menu entry
 *     to reach it;
 *   * 0100 adds a reviewer, chosen from the Supervisor pool today but stored as
 *     a relationship rather than a role, and a role check would go wrong the
 *     first time that changes.
 *
 * The same shape as `leadsAnyEvaluation`, which exists because a Design
 * Coordinator hit exactly this: the queue found their work and nothing let them
 * reach it.
 */
export async function ratesAnyWorker(profileId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("worker_evaluations")
    .select("id")
    .or(`supervisor_id.eq.${profileId},reviewer_id.eq.${profileId}`)
    .is("excluded_at", null)
    .limit(1);
  return (data ?? []).length > 0;
}
