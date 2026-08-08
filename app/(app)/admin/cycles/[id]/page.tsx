/** /admin/cycles/[id] — the status board. P10 screen 3, HR's daily screen. */

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BoardClient } from "@/app/(app)/admin/cycles/[id]/board-client";
import { ErrorState } from "@/components/appraise/states";
import { requireRole } from "@/lib/auth/guards";
import { ADMIN_ROLES } from "@/lib/auth/roles";
import { getCycleActivity } from "@/lib/cycles/activity";
import { getCycleBoard, listStaffProfiles } from "@/lib/cycles/queries";

export const metadata: Metadata = { title: "Cycle" };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    launched?: string;
    sent?: string;
    queued?: string;
    failed?: string;
  }>;
}) {
  // §9: the guard is the first statement.
  await requireRole(ADMIN_ROLES);

  const { id } = await params;
  const { launched, sent, queued, failed } = await searchParams;

  /* -- A missing or junk count is ZERO, never NaN.
        These arrive from a query string, so they are whatever somebody typed.
        `Number("")` is 0 and `Number("abc")` is NaN, and a banner reading "NaN
        links sent" after a successful launch is worse than one that
        under-reports. Landing on the old `?launched=1` URL — a bookmark, or the
        blocked-send path in the wizard — therefore reads as "nothing went out",
        which is the safe direction to be wrong in: it sends HR to look. -- */
  const count = (value: string | undefined): number => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };

  // Issued together — none of the three depends on another's result.
  const [board, people, activity] = await Promise.all([
    getCycleBoard(id),
    listStaffProfiles(),
    getCycleActivity(id),
  ]);

  if (!board.ok) {
    if (board.error.code === "CYCLE_NOT_FOUND") notFound();
    return <ErrorState title="Could not load this cycle" body={board.error.message} />;
  }

  return (
    <BoardClient
      board={board.data}
      candidates={people.ok ? people.data : []}
      justLaunched={launched === "1"}
      launchDispatch={{
        sent: count(sent),
        queued: count(queued),
        failed: count(failed),
      }}
      /* An unreadable log is an empty one, never a broken page: RLS decides
         what this caller may see, and a failure here must not take down the
         board they came for. */
      activity={activity.ok ? activity.data : []}
    />
  );
}
