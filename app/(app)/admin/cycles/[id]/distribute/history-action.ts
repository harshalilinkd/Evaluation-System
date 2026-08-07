"use server";

/** The history drawer's read, as a server action so the client can call it on open. */

import { checkRole } from "@/lib/auth/guards";
import { ADMIN_ROLES } from "@/lib/auth/roles";
import type { CycleResult } from "@/lib/cycles/schema";
import { getNotificationHistory, type HistoryRow } from "@/lib/notify/queries";

/**
 * A read behind the same HR guard as the screen it opens from.
 *
 * RLS on notifications_log already restricts SELECT to HR and the MD (0010), so
 * this is the second of the three layers rather than the only one — but §9 says
 * client code must never be the only guard, and a drawer that fetched on demand
 * without a role check would be exactly that.
 */
export async function getHistory(evaluationId: string): Promise<CycleResult<HistoryRow[]>> {
  const auth = await checkRole(ADMIN_ROLES);
  if (!auth.ok) return auth;

  return getNotificationHistory(evaluationId);
}
