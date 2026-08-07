/** /admin/due — what is due. HR's action list (P22). */

import type { Metadata } from "next";

import { DueClient } from "@/app/(app)/admin/due/due-client";
import { ErrorState } from "@/components/appraise/states";
import { requireRole } from "@/lib/auth/guards";
import { getDueList } from "@/lib/due/queries";

export const metadata: Metadata = { title: "What is due" };

export default async function Page() {
  /* -- An INCREMENT item says somebody's pay is under review, so this list is
        HR-and-MD-only under §5 — the same guard as the increment calendar. Only
        HR can act on an item; the MD can see what is coming. -- */
  const session = await requireRole(["HR_ADMIN", "MD"]);

  const list = await getDueList();
  if (!list.ok) {
    return <ErrorState title="Could not load what is due" body={list.error.message} />;
  }

  return <DueClient list={list.data} canAct={session.roles.includes("HR_ADMIN")} />;
}
