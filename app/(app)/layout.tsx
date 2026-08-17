/** Authenticated area. requireAuth is the first statement — nothing renders without it. */

import { Suspense, type ReactNode } from "react";

import { AccessNotice } from "@/app/(app)/access-notice";
import { PausedBanner } from "@/app/(app)/paused-banner";
import { AppShell } from "@/components/appraise/app-shell";
import { SectionLabelProvider } from "@/components/appraise/section-labels";
import { requireAuth } from "@/lib/auth/guards";
import { getSectionConfig } from "@/lib/forms/section-config";
import { leadsAnyEvaluation } from "@/lib/evaluations/team-queue";

/**
 * Nothing under /(app) may ever be prerendered or cached. Every page here is
 * per-person data behind a guard, and a statically generated one would be built
 * with no session — at best an error, at worst one user's page served to
 * another from the cache.
 *
 * It also keeps the build honest: `next build` must not need real Supabase
 * credentials to succeed.
 */
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  // Layer 2 of §9's three. Middleware has established that a session exists;
  // this establishes it belongs to an active profile, and hands the roles to
  // the shell so the nav matches what the guards will allow.
  const { profile, roles } = await requireAuth();

  /* -- HR's own section names, read once and provided to every client screen.
        P25 made them editable and every rendered FORM picked that up, because a
        form carries its labels. Screens that name a section in their own chrome
        did not — they import the shipped defaults, so a rename changed the
        forms and left the question bank, the departments screens, the cycle
        wizard and the scorecard still using the old name.
        `getSectionConfig` is cached per request (P25-6), so this is one read for
        the whole page however many components consume it. It falls back to the
        shipped defaults on its own, which is the behaviour every screen had
        before this existed. -- */
  const sections = await getSectionConfig();

  /* -- The cycle query that fed the topbar selector is GONE with it.
        The selector had no handler and nothing read its value, so this was
        twelve rows fetched on every authenticated page load to populate a
        control that did nothing. When cycle-scoping is real, the query comes
        back with the screens that honour it. -- */

  /* -- IS THIS PERSON SOMEBODY'S MANAGER, whatever their roles say.
        A role is a tick HR sets on the Users screen; being a manager is
        `evaluations.lead_id`, copied at launch. Nothing about being assigned as
        a manager grants HOD — so somebody named on three launched evaluations,
        sent all three invite links, had no My Team in their sidebar and no way
        to reach the queue that already held their work.

        One indexed lookup per authenticated page load, and it returns after the
        first row. Cheap enough to be honest with, and the alternative — granting
        HOD when a cycle launches — would write a permission HR did not ask for
        and could not easily see. -- */
  const leadsTeam = await leadsAnyEvaluation(profile.id);

  return (
    <AppShell profile={profile} roles={roles} leadsTeam={leadsTeam}>
      <SectionLabelProvider labels={sections.labels}>
      {/* A pause is easy to set and easy to forget, and the failure it creates
          is silence. RLS decides who sees it — an employee gets nothing. */}
      <PausedBanner />
      {/* Why a guard sent somebody here. Suspense because it reads the query
          string, which opts the subtree out of static rendering — and this
          layout wraps every authenticated page. */}
      <Suspense fallback={null}>
        <AccessNotice />
      </Suspense>
        {children}
      </SectionLabelProvider>
    </AppShell>
  );
}
