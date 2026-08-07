/** Refreshes the Supabase session and gates the authenticated area. */

import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Everything except static assets and images. The negative lookahead keeps an
  // auth round-trip off the path for files that could never be protected anyway.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
