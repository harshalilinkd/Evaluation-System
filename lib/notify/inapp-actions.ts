"use server";

/** Server actions for the notification bell: poll, and mark as read. */

import { getCurrentProfile } from "@/lib/auth/roles";
import { getMyNotifications, type NotificationFeed } from "@/lib/notify/inapp";
import { createClient } from "@/lib/supabase/server";

type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

/**
 * The bell's poll.
 *
 * No role guard, deliberately — every signed-in person has a bell, and RLS
 * scopes the read to their own rows (0059). The profile check is the clean exit
 * for a session that has expired mid-poll, not the protection: without it an
 * unauthenticated poll returns an empty feed, which is indistinguishable from
 * "no notifications" and would leave a signed-out tab quietly ticking.
 */
export async function fetchNotifications(): Promise<Result<NotificationFeed>> {
  const profile = await getCurrentProfile();
  if (!profile) {
    return { ok: false, error: { code: "NOT_SIGNED_IN", message: "Your session has ended." } };
  }

  return { ok: true, data: await getMyNotifications() };
}

/**
 * Mark specific notifications as read.
 *
 * The UPDATE policy admits only your own rows and 0059's trigger refuses every
 * column but `read_at`, so this cannot touch anybody else's bell or rewrite
 * what it says — the guard is the database's, not this function's.
 */
export async function markNotificationsRead(ids: string[]): Promise<Result<null>> {
  if (ids.length === 0) return { ok: true, data: null };

  const profile = await getCurrentProfile();
  if (!profile) {
    return { ok: false, error: { code: "NOT_SIGNED_IN", message: "Your session has ended." } };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("app_notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", ids)
    .is("read_at", null); // Not already-read: re-stamping would reorder nothing but rewrites history.

  if (error) {
    return { ok: false, error: { code: "MARK_FAILED", message: "Could not mark these as read." } };
  }

  return { ok: true, data: null };
}

/** Mark everything currently unread as read. */
export async function markAllNotificationsRead(): Promise<Result<null>> {
  const profile = await getCurrentProfile();
  if (!profile) {
    return { ok: false, error: { code: "NOT_SIGNED_IN", message: "Your session has ended." } };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("app_notifications")
    .update({ read_at: new Date().toISOString() })
    // `profile_id` is redundant against RLS and is stated anyway: a policy is
    // the protection, and an unqualified UPDATE that relies on one is a
    // statement whose blast radius depends on a file somewhere else.
    .eq("profile_id", profile.id)
    .is("read_at", null);

  if (error) {
    return { ok: false, error: { code: "MARK_FAILED", message: "Could not mark these as read." } };
  }

  return { ok: true, data: null };
}
