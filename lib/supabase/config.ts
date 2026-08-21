/** Is Supabase configured? Used to show a setup screen instead of a stack trace. */

/**
 * §0.7 says fail loudly, not silently — but a Next.js error overlay is not
 * "loudly", it is "incomprehensibly". Missing credentials is the one failure
 * every developer hits on first run, and it has a specific, actionable fix.
 *
 * Safe in both Client and Server Components: Next inlines NEXT_PUBLIC_* at build
 * time, so these reads survive bundling.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * The Postgres schema this app's tables live in, inside the shared team-apps
 * Supabase project. A LITERAL, not read from an env var: supabase-js needs a
 * compile-time string to pick which schema's Row/Insert/Update types apply to
 * `.from(...)` calls (types/database.ts describes exactly one schema, keyed
 * "evaluation") — a value computed at runtime can't narrow that, and every
 * `.from()` call in the app degrades to untyped `any` the moment it can't.
 */
export const SUPABASE_SCHEMA = "evaluation" as const;
