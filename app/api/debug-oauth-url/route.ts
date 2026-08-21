/** TEMPORARY — shows exactly what redirect address the Google sign-in button
    computes, without needing to click through Google. Delete once the
    team-apps redirect issue is confirmed fixed. */

import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { resolveAppUrl } from "@/lib/notify/preflight";

export async function GET() {
  const h = await headers();
  const resolved = resolveAppUrl();
  const origin = h.get("origin");
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto");

  const finalOrigin = resolved ?? origin ?? "";
  const callback = finalOrigin ? new URL("/auth/callback", finalOrigin).toString() : "(empty)";

  return NextResponse.json({
    THIS_IS_THE_EXACT_STRING_SENT_TO_SUPABASE: callback,
    resolveAppUrl_result: resolved ?? null,
    origin_header: origin ?? null,
    host_header: host ?? null,
    x_forwarded_proto_header: proto ?? null,
    env_NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? null,
    env_VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL ?? null,
    env_VERCEL_URL: process.env.VERCEL_URL ?? null,
  });
}
