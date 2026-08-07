/** /team — the lead's queue. P13 screen 1. */

import type { Metadata } from "next";

import { TeamClient } from "@/app/(app)/team/team-client";
import { requireRole } from "@/lib/auth/guards";
import { getTeamQueue } from "@/lib/evaluations/team-queue";

export const metadata: Metadata = { title: "Reports to review" };

export default async function Page() {
  // §9: the guard is the first statement. A user without the role is
  // redirected before any markup is produced, never shown and then hidden.
  const { profile } = await requireRole(["HOD", "SUPERVISOR", "HR_ADMIN", "MD"]);

  const queue = await getTeamQueue(profile.id);

  return <TeamClient queue={queue} firstName={profile.full_name.split(" ")[0] ?? profile.full_name} />;
}
