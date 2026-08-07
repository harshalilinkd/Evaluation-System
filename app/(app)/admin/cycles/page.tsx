/** /admin/cycles — the cycle list. P10 screen 1. */

import type { Metadata } from "next";

import { CyclesClient } from "@/app/(app)/admin/cycles/cycles-client";
import { ErrorState } from "@/components/appraise/states";
import { requireRole } from "@/lib/auth/guards";
import { ADMIN_ROLES } from "@/lib/auth/roles";
import { listCycles } from "@/lib/cycles/queries";

export const metadata: Metadata = { title: "Evaluation cycles" };

export default async function Page() {
  // §9: the guard is the first statement. A user without the role is
  // redirected before any markup is produced, never shown and then hidden.
  const { profile } = await requireRole(ADMIN_ROLES);

  const cycles = await listCycles();

  if (!cycles.ok) {
    return <ErrorState title="Could not load cycles" body={cycles.error.message} />;
  }

  return (
    <CyclesClient cycles={cycles.data} greetingName={profile.full_name.split(" ")[0] ?? ""} />
  );
}
