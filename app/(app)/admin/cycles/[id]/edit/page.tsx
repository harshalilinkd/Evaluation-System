/**
 * /admin/cycles/[id]/edit — the wizard, reopened on a draft.
 *
 * Every blocking issue in the readiness report links here, so this route is not
 * optional: an issue that says "3 people have no lead" and offers no way to fix
 * it is the dead end §13.4 forbids.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { WizardClient } from "@/app/(app)/admin/cycles/new/wizard-client";
import { ErrorState } from "@/components/appraise/states";
import { requireRole } from "@/lib/auth/guards";
import { ADMIN_ROLES } from "@/lib/auth/roles";
import { listStaffProfiles } from "@/lib/cycles/queries";
import { jobSkillCountsByDepartment, loadCycleParticipants } from "@/lib/cycles/validate";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Edit cycle" };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  await requireRole(ADMIN_ROLES);
  const { id } = await params;
  const { step } = await searchParams;

  const supabase = await createClient();
  const { data: cycle } = await supabase
    .from("evaluation_cycles")
    .select("id, name, period_label, status, starts_on, self_due_on, lead_due_on, md_due_on, disclosure, variance_threshold, cycle_type, cycle_kind, default_self_days, default_lead_days")
    .eq("id", id)
    .maybeSingle();

  if (!cycle) notFound();

  // A launched cycle's roster is frozen along with everything else. Editing it
  // here would mean re-pointing evaluations that already carry a snapshot, so
  // the board is where post-launch changes happen: withdraw somebody, or
  // reassign their lead, both of which are audited.
  if (cycle.status !== "DRAFT") redirect(`/admin/cycles/${id}`);

  const [people, counts, participants] = await Promise.all([
    listStaffProfiles(),
    jobSkillCountsByDepartment(),
    loadCycleParticipants(id),
  ]);

  if (!people.ok) return <ErrorState title="Could not load people" body={people.error.message} />;
  if (!counts.ok) return <ErrorState title="Could not load mappings" body={counts.error.message} />;
  if (!participants.ok) {
    return <ErrorState title="Could not load participants" body={participants.error.message} />;
  }

  return (
    <WizardClient
      /* `?step=4` is 1-based in the URL because that is how the wizard labels
         its steps on screen; the component counts from zero. */
      initialStep={step ? Number(step) - 1 : undefined}
      people={people.data}
      jobSkillCounts={Object.fromEntries(counts.data)}
      initial={{
        id: cycle.id,
        name: cycle.name,
        periodLabel: cycle.period_label,
        varianceThreshold: cycle.variance_threshold,
        disclosure: cycle.disclosure,
        startsOn: cycle.starts_on,
        selfDueOn: cycle.self_due_on,
        leadDueOn: cycle.lead_due_on,
        mdDueOn: cycle.md_due_on,
        cycleType: cycle.cycle_type === "INCREMENT" ? "INCREMENT" : "EVALUATION",
        cycleKind: cycle.cycle_kind === "ROLLING" ? "ROLLING" : "BATCH",
        defaultSelfDays: cycle.default_self_days,
        defaultLeadDays: cycle.default_lead_days,
        isLaunched: cycle.status !== "DRAFT",
        participants: participants.data.map((p) => ({ profileId: p.profileId, leadId: p.leadId })),
      }}
    />
  );
}
