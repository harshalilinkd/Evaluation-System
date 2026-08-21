/** /reports — the combined-report queue, and (at the owner's instruction) a
 *  Scorecard tab beside it. HR and the MD only (§5, §9). */

import type { Metadata } from "next";

import { ReportsQueueClient } from "@/app/(app)/reports/queue-client";
import { ScorecardPanel } from "@/app/(app)/scorecard/scorecard-panel";
import { ErrorState } from "@/components/appraise/states";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireRole } from "@/lib/auth/guards";
import { getReportQueue } from "@/lib/reports/queries";

export const metadata: Metadata = { title: "Reports" };

const TABS = ["queue", "scorecard"] as const;

/* -- The queue's own TableScreen sits under this page's TabsList now, not
      straight below the topbar, so it has to give back the strip's height —
      the same reasoning Settings > Users already applies (users-tab.tsx) for
      the identical situation, at the same 5rem. -- */
const TAB_STRIP_REM = 5;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; person?: string }>;
}) {
  /* -- §5's blindness invariant makes this the ONLY screen where both sides of
        an evaluation appear together, and §9 gives that to HR and the MD alone.
        The guard is the first statement so a HOD is redirected before any markup
        exists to be hidden — and 0005's policies are the real protection, since
        every query below runs through the authenticated client.

        The guard covers BOTH tabs: Scorecard here is the exact same content as
        the standalone /scorecard route (ScorecardPanel, shared), just reached
        from here as well now, at the owner's instruction. It does not loosen
        who may see whose card — RLS and getScorecard's own read are unchanged,
        this only adds a second door into the same room. -- */
  const session = await requireRole(["HR_ADMIN", "MD"]);

  const params = await searchParams;
  const requested = params.tab;
  const activeTab = TABS.includes(requested as (typeof TABS)[number]) ? requested! : "queue";

  const queue = await getReportQueue();
  if (!queue.ok) {
    return <ErrorState title="Could not load the report queue" body={queue.error.message} />;
  }

  return (
    /* -- `data-full-bleed` HERE, not just on the queue tab's own TableScreen.
          `.app-main:has([data-full-bleed]) .app-container { max-width: none }`
          matches on DOM PRESENCE — which sounds like it should not care which
          tab is showing, and does not: Radix's TabsContent uses `Presence`
          with `present: forceMount || isSelected` (checked directly in
          @radix-ui/react-tabs's source), so an INACTIVE tab's children are
          not merely hidden, they are not in the DOM at all. So while looking
          at Scorecard, the queue's own marker plain does not exist, and the
          page-wide 1180px cap stayed on regardless of the `wide` prop below —
          which was the actual bug, once tested rather than assumed correct
          off the Settings precedent (there it happens to work, because the
          full-bleed tab there is only ever relevant while IT is the active,
          therefore mounted, one). Marking the whole page here is what makes
          it independent of which tab is selected. -- */
    <Tabs data-full-bleed defaultValue={activeTab} className="flex h-full flex-col">
      <TabsList className="mx-4 mt-3 w-fit bg-surface-mute lg:mx-6">
        <TabsTrigger value="queue" className="font-sans text-body">
          Queue
        </TabsTrigger>
        <TabsTrigger value="scorecard" className="font-sans text-body">
          Scorecard
        </TabsTrigger>
      </TabsList>

      <TabsContent value="queue" className="min-h-0 flex-1">
        <ReportsQueueClient
          queue={queue.data}
          isHr={session.roles.includes("HR_ADMIN")}
          extraChromeRem={TAB_STRIP_REM}
        />
      </TabsContent>

      {/* -- Reached from a person elsewhere (Team review's row menu, a report's
            own "past cycles" link) still lands on the standalone /scorecard
            route deliberately — this tab is the second door, not a redirect
            target, so those links are unaffected. -- */}
      <TabsContent value="scorecard" className="min-h-0 flex-1 overflow-y-auto">
        {/* -- The queue tab's own TableScreen carries `data-full-bleed`, and
              `.app-main:has([data-full-bleed])` matches on DOM PRESENCE, not
              visibility — so it strips .app-main's padding globally on this
              page even while THIS tab, not that one, is what's showing.
              Restated here at .app-main's own px-4 py-8 lg:px-8 (globals.css).

              NO max-w-content, at the owner's instruction: the centred single-
              subject column this shares with the standalone /scorecard route
              read as mostly empty canvas beside the queue's full-bleed grid.
              `wide` on ScorecardPanel drops ScorecardClient's own matching
              cap, which is otherwise hardcoded for every OTHER caller. -- */}
        <div className="w-full space-y-4 px-4 py-8 lg:px-8">
          <ScorecardPanel
            viewerId={session.profile.id}
            subjectId={params.person ?? session.profile.id}
            privileged
            basePath="/reports"
            extraParams={{ tab: "scorecard" }}
            wide
          />
        </div>
      </TabsContent>
    </Tabs>
  );
}
