/** /admin/cycles/new — the four-step wizard. P10 screen 2. */

import type { Metadata } from "next";

import { WizardClient } from "@/app/(app)/admin/cycles/new/wizard-client";
import { ErrorState } from "@/components/appraise/states";
import { requireRole } from "@/lib/auth/guards";
import { ADMIN_ROLES } from "@/lib/auth/roles";
import { listStaffProfiles } from "@/lib/cycles/queries";
import { jobSkillCountsByDepartment } from "@/lib/cycles/validate";

export const metadata: Metadata = { title: "New cycle" };

export default async function Page() {
  // §9: the guard is the first statement.
  await requireRole(ADMIN_ROLES);

  const [people, counts] = await Promise.all([listStaffProfiles(), jobSkillCountsByDepartment()]);

  if (!people.ok) return <ErrorState title="Could not load people" body={people.error.message} />;
  if (!counts.ok) return <ErrorState title="Could not load mappings" body={counts.error.message} />;

  return (
    <WizardClient
      people={people.data}
      jobSkillCounts={Object.fromEntries(counts.data)}
      initial={null}
    />
  );
}
