/** /admin/cycles/[id]/distribute — sending evaluation links. P11. */

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DistributeClient } from "@/app/(app)/admin/cycles/[id]/distribute/distribute-client";
import { ErrorState } from "@/components/appraise/states";
import { requireRole } from "@/lib/auth/guards";
import { ADMIN_ROLES } from "@/lib/auth/roles";
import { getDistributionBoard } from "@/lib/notify/queries";
import { preflightAll } from "@/lib/notify/preflight";

export const metadata: Metadata = { title: "Send links" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  // §9: the guard is the first statement.
  await requireRole(ADMIN_ROLES);

  const { id } = await params;
  const board = await getDistributionBoard(id);

  if (!board.ok) {
    if (board.error.code === "CYCLE_NOT_FOUND") notFound();
    return <ErrorState title="Could not load distribution" body={board.error.message} />;
  }

  // Whether the providers are configured at all. Read on the server — the keys
  // themselves never cross to the client (§17), only whether they are present,
  // so the screen can say "WhatsApp is not set up" instead of failing 47 times.
  const configured = {
    whatsapp: Boolean(
      process.env.MAYTAPI_PRODUCT_ID && process.env.MAYTAPI_PHONE_ID && process.env.MAYTAPI_API_TOKEN,
    ),
    email: Boolean(
      process.env.MAIL_FROM &&
        (process.env.RESEND_API_KEY || (process.env.SMTP_USER && process.env.SMTP_PASSWORD)),
    ),
  };

  /* -- Whether a link sent from here would actually WORK.
        A key being present is not the same as a message being usable: a
        localhost APP_URL sends cleanly and produces a link nobody can open,
        and Resend's shared sender only reaches the account owner. Both are
        invisible until somebody complains, so they are stated before the send
        button rather than after (§0.7). Only the verdicts cross to the client
        — never the values. -- */
  const preflight = preflightAll({
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    mailFrom: process.env.MAIL_FROM,
    smtpUser: process.env.SMTP_USER,
  });

  return <DistributeClient board={board.data} configured={configured} preflight={preflight} />;
}
