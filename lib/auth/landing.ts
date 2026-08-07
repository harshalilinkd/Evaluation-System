/** Where each role lands after sign-in. Pure — no database. */

import type { Enums } from "@/types/database";

export type AppRole = Enums<"app_role">;

/** §3's route map. Kept here so nav, redirects and guards agree on one spelling. */
export const ROUTES = {
  login: "/login",
  dashboard: "/dashboard",
  myEvaluation: "/my-evaluation",
  team: "/team",
  review: "/review",
  scorecard: "/scorecard",
  adminCycles: "/admin/cycles",
  adminQuestions: "/admin/questions",
  adminDepartments: "/admin/departments",
  adminPeople: "/admin/people",
  adminSettings: "/admin/settings",
} as const;

/**
 * Where to send someone after they sign in.
 *
 * Deliberately does NOT branch on whether they lead a team. A HOD is also an
 * employee (§9), and sending them to /team would quietly make "your own
 * appraisal" the thing they have to go looking for — the one task the system
 * exists to get done. Leads reach /team from the sidebar instead, which
 * `showsTeamLink` decides.
 */
export function landingPathFor(roles: readonly AppRole[]): string {
  if (roles.includes("HR_ADMIN")) return ROUTES.adminCycles;
  if (roles.includes("MD")) return ROUTES.review;
  return ROUTES.myEvaluation;
}

/** A nav entry, not a landing page. See landingPathFor. */
export function showsTeamLink(roles: readonly AppRole[]): boolean {
  return roles.includes("HOD") || roles.includes("SUPERVISOR");
}

/* ---------- Route → required roles ---------- */

/**
 * Prefix rules for the authenticated area. Longest match wins, so a specific
 * rule can tighten a broader one.
 *
 * `null` means any signed-in user. Note /my-evaluation is open to everyone
 * including HR and the MD: they are employees too and have their own appraisals.
 */
const ROUTE_RULES: ReadonlyArray<{ prefix: string; roles: readonly AppRole[] | null }> = [
  { prefix: "/admin", roles: ["HR_ADMIN"] },
  { prefix: "/review", roles: ["MD", "HR_ADMIN"] },
  { prefix: "/team", roles: ["HOD", "SUPERVISOR", "HR_ADMIN", "MD"] },
  { prefix: "/my-evaluation", roles: null },
  { prefix: "/dashboard", roles: null },
];

export function requiredRolesFor(pathname: string): readonly AppRole[] | null {
  const match = ROUTE_RULES.filter(
    (rule) => pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`),
  ).sort((a, b) => b.prefix.length - a.prefix.length)[0];

  return match?.roles ?? null;
}

/** Every path the middleware should treat as part of the authenticated area. */
export const PROTECTED_PREFIXES = [
  "/dashboard",
  "/my-evaluation",
  "/team",
  "/review",
  "/admin",
] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
