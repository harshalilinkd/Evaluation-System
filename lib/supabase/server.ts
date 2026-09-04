/** Supabase client for Server Components, Server Actions and Route Handlers. */

import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";
import { createServerClient } from "@supabase/ssr";

import { SUPABASE_SCHEMA } from "@/lib/supabase/config";
import type { Database } from "@/types/database";

/**
 * Must be created per request — never hoisted to a module-level singleton, or
 * one user's cookies would be shared with the next request.
 *
 * `cache()` is per REQUEST, not per process, which is the distinction that
 * makes it safe here: React clears it between requests, so the singleton
 * hazard above is unchanged. What it removes is the twenty rebuilds a single
 * page load was doing — every guard, every query module and every component
 * called this, and each one re-read the cookie store and constructed a fresh
 * GoTrue client that then had to revalidate the session from scratch.
 *
 * Runs as the signed-in user, so RLS applies here exactly as it does in the
 * browser (CLAUDE.md §0.5). That is deliberate: the policies are the security
 * boundary, and using the same rules on both sides means there is only one set
 * of rules to get right.
 */
export const createClient = cache(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase server client: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set. Copy .env.example to .env.local.",
    );
  }

  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    db: { schema: SUPABASE_SCHEMA },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // A Server Component cannot write cookies. Expected and harmless as
          // long as middleware refreshes the session on each request, which is
          // what keeps the token from going stale.
        }
      },
    },
  });
});
