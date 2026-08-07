/** Typed role helpers for server components and server actions. CLAUDE.md §9. */

import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { Enums, Tables } from "@/types/database";

export type AppRole = Enums<"app_role">;

/**
 * The two interchangeable administrative roles.
 *
 * §9 originally separated them: HR configured the system, the MD decided pay,
 * and neither could do the other's job. That was a separation of duties. It was
 * merged at the owner's explicit instruction (0012), and this constant is the
 * single place the merge is expressed in TypeScript — a route or action that
 * gates on one role alone is now a bug, and grepping for ADMIN_ROLES finds
 * every place the decision reaches.
 */
export const ADMIN_ROLES = ["HR_ADMIN", "MD"] as const satisfies readonly AppRole[];
export type Profile = Tables<"profiles">;

/* ---------- Authorisation error ---------- */

/**
 * Thrown by requireRole().
 *
 * CLAUDE.md §14 forbids throwing raw to the client, so a Server Action must
 * catch this and translate it into `{ ok: false, error: { code, message } }`.
 * In a Server Component, letting it propagate to the nearest error boundary is
 * the intended behaviour — the code is machine-readable so the boundary can
 * tell "signed out" apart from "signed in but not permitted".
 */
export class AuthorizationError extends Error {
  readonly code: "NOT_AUTHENTICATED" | "FORBIDDEN";
  readonly required: readonly AppRole[];

  constructor(code: "NOT_AUTHENTICATED" | "FORBIDDEN", required: readonly AppRole[], message: string) {
    super(message);
    this.name = "AuthorizationError";
    this.code = code;
    this.required = required;
  }
}

/* ---------- Reads ---------- */

/**
 * The signed-in user's profile row, or null when there is no session.
 *
 * Wrapped in React's `cache()` so a layout, a nested layout and the page can
 * each call it while only one query reaches the database per request.
 *
 * Uses getUser(), never getSession(): getSession() trusts the cookie as it
 * stands, getUser() revalidates the JWT with the auth server. Only the latter
 * is safe to authorise on.
 */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return null;

  const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).single();

  // A session with no profile row means the on_auth_user_created trigger did not
  // run, or the profile was deleted. Treat as unauthenticated rather than
  // crashing the render — but do not silently invent a profile.
  if (error || !data) return null;

  return data;
});

/**
 * Every role the signed-in user holds. Returns [] when signed out.
 *
 * The array is the point: one person is commonly both EMPLOYEE and HOD, and
 * callers are expected to check for the capability they need rather than
 * switching on a single "primary" role.
 */
export const getRoles = cache(async (): Promise<AppRole[]> => {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return [];

  const { data, error } = await supabase.from("user_roles").select("role").eq("profile_id", user.id);

  if (error || !data) return [];

  return data.map((row) => row.role);
});

/* ---------- Checks ---------- */

/**
 * Whether the signed-in user holds any one of `roles`.
 *
 * Accepts a single role or a list; a list means OR, never AND. Callers needing
 * AND should compose two calls, which makes the intent visible at the call site.
 */
export async function hasRole(roles: AppRole | readonly AppRole[]): Promise<boolean> {
  const required = Array.isArray(roles) ? roles : [roles as AppRole];
  if (required.length === 0) return false;

  const held = await getRoles();
  return required.some((role) => held.includes(role));
}

// requireRole lives in lib/auth/guards.ts as of P6, alongside requireAuth and
// requireEvaluationAccess. It redirects rather than throwing, which is what a
// page needs; two implementations of "may they" is how the two drift apart.

/* ---------- Convenience predicates ---------- */
// Mirror the SQL helpers in 0001_core.sql so the same question is phrased the
// same way on both sides of the wire.

export async function isHr(): Promise<boolean> {
  return hasRole("HR_ADMIN");
}

export async function isMd(): Promise<boolean> {
  return hasRole("MD");
}
