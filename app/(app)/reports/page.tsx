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
    <Tabs defaultValue={activeTab} className="flex h-full flex-col">
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
              Restated here at .app-main's own px-4 py-8 lg:px-8 (globals.css)
              so this tab still looks like the ordinary centred page it is. -- */}
        <div className="mx-auto w-full max-w-content space-y-4 px-4 py-8 lg:px-8">
          <ScorecardPanel
            viewerId={session.profile.id}
            subjectId={params.person ?? session.profile.id}
            privileged
            basePath="/reports"
            extraParams={{ tab: "scorecard" }}
          />
        </div>
      </TabsContent>
    </Tabs>
  );
}
