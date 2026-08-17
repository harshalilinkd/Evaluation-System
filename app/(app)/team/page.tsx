/** /team — the lead's queue. P13 screen 1. */

import type { Metadata } from "next";

import { TeamClient } from "@/app/(app)/team/team-client";
import { redirect } from "next/navigation";

import { requireAuth } from "@/lib/auth/guards";
import { landingPathFor } from "@/lib/auth/landing";
import { getTeamQueue, leadsAnyEvaluation } from "@/lib/evaluations/team-queue";
import { TEAM_ROLES } from "@/components/appraise/nav-config";

export const metadata: Metadata = { title: "Reports to review" };

export default async function Page() {
  /* -- §9: the guard is the first statement. A user without access is
        redirected before any markup is produced, never shown and then hidden.

        A ROLE **OR** THE RELATIONSHIP, and the second half is the fix.
        This required `HOD`, which is a configuration tick HR sets on the Users
        screen — and nothing about assigning somebody as a manager grants it. So
        a person could be named as the manager on three launched evaluations,
        be sent all three invite links, and be redirected away from the only
        screen that lists them. The queue would have found their work; nothing
        let them reach the queue.

        `leadsAnyEvaluation` reads `evaluations.lead_id`, which is what actually
        decides who rates whom — copied at launch (P3-6), filtered on by the
        queue, and enforced by `is_lead_of_evaluation` in RLS. P4-7 settled this
        for transitions ("actors are roles AND relationships"); the navigation
        never learned it.

        NOT A WIDENING. Somebody who leads nobody still gets nothing: the check
        goes through RLS, so an empty result means they genuinely lead nobody,
        and `/team/[id]` has always been gated on the relationship rather than
        the role. This makes the list agree with the page it links to. -- */
  const { profile, roles } = await requireAuth();
  const privileged = roles.some((r) => TEAM_ROLES.includes(r));

  if (!privileged && !(await leadsAnyEvaluation(profile.id))) {
    redirect(`${landingPathFor(roles)}?error=forbidden`);
  }

  const queue = await getTeamQueue(profile.id);

  return <TeamClient queue={queue} firstName={profile.full_name.split(" ")[0] ?? profile.full_name} />;
}
