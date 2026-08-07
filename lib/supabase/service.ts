/** Service-role Supabase client. Bypasses RLS — server-only, cron/notify use only. */

// Build-time guard: importing this from a Client Component is a hard error, so
// the service key cannot reach the browser bundle by accident.
import "server-only";

import { createServerClient } from "@supabase/ssr";

import type { Database } from "@/types/database";

/* ---------- Import-time guards ---------- */

// Runtime belt to `server-only`'s braces. `server-only` fails the build; this
// fails immediately if the module is ever reached in a browser context through
// a path the bundler did not classify (a stray dynamic import, a test harness).
// P0 step 7 requires the throw to happen at import time, not at call time.
if (typeof window !== "undefined") {
  throw new Error(
    "lib/supabase/service.ts was loaded in the browser. The service-role key must never leave the server.",
  );
}

/**
 * CLAUDE.md §0.5: this key bypasses Row Level Security entirely and is
 * permitted **only** in server-side notification and cron code. Every other
 * read and write in the product goes through the authenticated client so the
 * database stays the security boundary.
 *
 * Anything calling this must do its own authorisation check first, because
 * Postgres will no longer do it.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase service client: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.",
    );
  }

  // No-op cookie handlers on purpose. A service client must never pick up the
  // caller's session — if it did, it would silently downgrade to that user's
  // permissions in some paths and stay service-role in others, which is far
  // more dangerous than either behaviour on its own.
  return createServerClient<Database>(url, serviceRoleKey, {
    cookies: {
      getAll: () => [],
      setAll: () => {},
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
