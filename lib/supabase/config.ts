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
