/** The "messages are paused" banner. Rendered on every authenticated screen. */

import Link from "next/link";
import { BellOff } from "lucide-react";

import { createClient } from "@/lib/supabase/server";

/**
 * A pause is easy to set and easy to forget.
 *
 * The switch stops every WhatsApp and email in the product, and the failure it
 * creates is silence — nobody complains about a message they never knew was
 * coming. So the banner is on every screen an administrator sees, not just the
 * settings page where it was turned on.
 *
 * Read through the AUTHENTICATED client, so RLS decides: `notification_settings`
 * is readable by administrators only, and an employee simply gets nothing back
 * rather than a banner about machinery they cannot see.
 */
export async function PausedBanner() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notification_settings")
    .select("outbound_paused, paused_reason")
    .eq("id", true)
    .maybeSingle();

  if (!data?.outbound_paused) return null;

  return (
    <div
      role="status"
      className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control border border-critical/40 bg-critical-tint px-4 py-3"
    >
      <BellOff className="size-4 shrink-0 text-critical" aria-hidden />
      <p className="font-sans text-body-sm text-critical">
        <span className="font-medium">Messages are paused.</span> No invite, reminder or digest is
        being delivered.
        {data.paused_reason ? ` "${data.paused_reason}"` : ""}
      </p>
      <Link
        href="/admin/settings?tab=messages"
        className="font-sans text-body-sm text-critical underline underline-offset-4"
      >
        Resume sending
      </Link>
    </div>
  );
}
