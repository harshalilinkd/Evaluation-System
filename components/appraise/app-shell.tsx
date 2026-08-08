/** The authenticated chrome. DESIGN.md §7. */

import type { ReactNode } from "react";

import { signOut } from "@/lib/auth/actions";
import { BottomNav } from "@/components/appraise/bottom-nav";
import { Sidebar } from "@/components/appraise/sidebar";
import { Topbar } from "@/components/appraise/topbar";
import type { AppRole } from "@/components/appraise/nav-config";
import type { Profile } from "@/lib/auth/roles";

/**
 * A Server Component. It receives the already-fetched profile and roles rather
 * than fetching them, so the layout's guard and the shell share one query.
 */
export function AppShell({
  profile,
  roles,
  children,
}: {
  profile: Profile;
  roles: readonly AppRole[];
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh">
      <Sidebar roles={roles} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          roles={roles}
          userName={profile.full_name}
          userEmail={profile.email}
          onSignOut={signOut}
        />

        {/* §4: capped at 1180px with 32px gutters by default.
            A page opts out by putting `data-full-bleed` on its root element —
            see the :has() rule in globals.css. Driven from CSS rather than a
            prop because this layout is shared by every authenticated route and
            cannot read the pathname; threading a flag through would mean every
            page passing something it does not care about. */}
        <main className="app-main">
          <div className="app-container">{children}</div>
        </main>
      </div>

      {/* Outside the column, because it is `fixed` to the viewport rather than
          placed in the flow. The space it occupies is reserved by
          `--bottom-nav-h` in globals.css, which both `.app-main` and the
          full-height table screens subtract — a fixed bar with nothing
          reserving its space hides the last row of every list. */}
      <BottomNav roles={roles} />
    </div>
  );
}
