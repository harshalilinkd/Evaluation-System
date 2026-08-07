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
  searchParams: Promise<{ launched?: string }>;
}) {
  // §9: the guard is the first statement.
  await requireRole(ADMIN_ROLES);

  const { id } = await params;
  const { launched } = await searchParams;

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
      /* An unreadable log is an empty one, never a broken page: RLS decides
         what this caller may see, and a failure here must not take down the
         board they came for. */
      activity={activity.ok ? activity.data : []}
    />
  );
}
