/** Authenticated area. requireAuth is the first statement — nothing renders without it. */

import { Suspense, type ReactNode } from "react";

import { AccessNotice } from "@/app/(app)/access-notice";
import { PausedBanner } from "@/app/(app)/paused-banner";
import { AppShell } from "@/components/appraise/app-shell";
import { requireAuth } from "@/lib/auth/guards";

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

  /* -- The cycle query that fed the topbar selector is GONE with it.
        The selector had no handler and nothing read its value, so this was
        twelve rows fetched on every authenticated page load to populate a
        control that did nothing. When cycle-scoping is real, the query comes
        back with the screens that honour it. -- */

  return (
    <AppShell profile={profile} roles={roles}>
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
    </AppShell>
  );
}
