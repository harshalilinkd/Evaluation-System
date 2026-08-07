/** /admin/cycles/[id] — the status board. P10 screen 3, HR's daily screen. */

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BoardClient } from "@/app/(app)/admin/cycles/[id]/board-client";
import { ErrorState } from "@/components/appraise/states";
import { requireRole } from "@/lib/auth/guards";
import { ADMIN_ROLES } from "@/lib/auth/roles";
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

  const [board, people] = await Promise.all([getCycleBoard(id), listStaffProfiles()]);

  if (!board.ok) {
    if (board.error.code === "CYCLE_NOT_FOUND") notFound();
    return <ErrorState title="Could not load this cycle" body={board.error.message} />;
  }

  return (
    <BoardClient
      board={board.data}
      candidates={people.ok ? people.data : []}
      justLaunched={launched === "1"}
    />
  );
}
