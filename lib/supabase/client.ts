/** Supabase client for Client Components. Runs as the signed-in user; RLS applies. */

import { createBrowserClient } from "@supabase/ssr";

import { SUPABASE_SCHEMA } from "@/lib/supabase/config";
import type { Database } from "@/types/database";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Fail loudly, not silently (CLAUDE.md §0.7). Without this the SDK throws a
  // generic "Invalid URL" from deep inside a fetch, which tells nobody that a
  // .env.local key is simply missing.
  if (!url || !anonKey) {
    throw new Error(
      "Supabase browser client: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set. Copy .env.example to .env.local.",
    );
  }

  // createBrowserClient memoises internally, so calling this per render is cheap
  // and every component shares one auth state.
  return createBrowserClient<Database>(url, anonKey, {
    db: { schema: SUPABASE_SCHEMA },
  });
}
