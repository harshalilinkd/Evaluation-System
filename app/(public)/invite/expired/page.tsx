/** /invite/expired */

import type { Metadata } from "next";

import { INVITE_STATES, InviteStatePage } from "@/app/(public)/invite/_states";

export const metadata: Metadata = {
  title: INVITE_STATES["expired"].title,
  robots: { index: false },
};

export default function Page() {
  return <InviteStatePage state="expired" />;
}
