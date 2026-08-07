/** /reports — the combined-report queue. HR and the MD only (§5, §9). */

import type { Metadata } from "next";

import { ReportsQueueClient } from "@/app/(app)/reports/queue-client";
import { ErrorState } from "@/components/appraise/states";
import { requireRole } from "@/lib/auth/guards";
import { getReportQueue } from "@/lib/reports/queries";

export const metadata: Metadata = { title: "Reports" };

export default async function Page() {
  /* -- §5's blindness invariant makes this the ONLY screen where both sides of
        an evaluation appear together, and §9 gives that to HR and the MD alone.
        The guard is the first statement so a HOD is redirected before any markup
        exists to be hidden — and 0005's policies are the real protection, since
        every query below runs through the authenticated client. -- */
  const session = await requireRole(["HR_ADMIN", "MD"]);

  const queue = await getReportQueue();
  if (!queue.ok) {
    return <ErrorState title="Could not load the report queue" body={queue.error.message} />;
  }

  return (
    <ReportsQueueClient
      queue={queue.data}
      isHr={session.roles.includes("HR_ADMIN")}
    />
  );
}
