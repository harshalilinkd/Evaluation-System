/** The single navigation config. Menu labels are fixed — §0.2 forbids renaming them. */

import { ROUTES } from "@/lib/auth/landing";
import type { Enums } from "@/types/database";

export type AppRole = Enums<"app_role">;

/**
 * §6: "Nav items feature prominent icons."
 *
 * Held as a name rather than a component so this file stays a plain config with
 * no React import — the sidebar resolves it. Adding a nav item means adding a
 * name here and nothing else.
 */
export type NavIcon =
  | "dashboard"
  | "myEvaluation"
  | "team"
  | "review"
  | "scorecard"
  | "questions"
  | "departments"
  | "cycles"
  | "increments"
  | "people"
  | "settings";

export type NavItem = {
  href: string;
  /** Exact wording. Do not "improve" these (§0.2, §17). */
  label: string;
  icon: NavIcon;
  /** The visitor needs at least ONE of these. Empty means any signed-in user. */
  roles: readonly AppRole[];
};

export type NavGroup = {
  /** Rendered in the label token (§7). Null for the ungrouped top items. */
  heading: string | null;
  items: readonly NavItem[];
};

/**
 * One config, consumed by the desktop rail, the mobile sheet and the active-item
 * logic. Nav and route guards agreeing is not a nicety: a link that renders but
 * redirects is worse than no link, because it reads as a permissions bug.
 *
 * Note "My Evaluation" is open to everyone, HR and MD included. They are
 * employees too and have their own appraisals — §9's simultaneous-roles case.
 */
export const NAV: readonly NavGroup[] = [
  {
    heading: null,
    items: [
      { href: ROUTES.dashboard, label: "Dashboard", icon: "dashboard", roles: [] },
      // Second, at the owner's instruction: the dashboard says how the company
      // is doing and this says how you are, so they read as a pair.
      { href: ROUTES.scorecard, label: "Scorecard", icon: "scorecard", roles: [] },
      { href: ROUTES.myEvaluation, label: "My Evaluation", icon: "myEvaluation", roles: [] },
      {
        href: ROUTES.team,
        label: "My Team",
        icon: "team",
        roles: ["HOD", "SUPERVISOR", "HR_ADMIN", "MD"],
      },
      // AMEND-3 item 9 retired the collision view and left this slot empty,
      // noting its replacement would be P20's. This is it.
      //
      // §5's blindness invariant makes /reports the ONLY screen in the product
      // where both sides of an evaluation appear together, and §9 gives that to
      // HR and the MD alone — so a HOD must not see the entry, any more than
      // they see Increments.
      {
        href: "/reports",
        label: "Reports",
        icon: "review",
        roles: ["HR_ADMIN", "MD"],
      },
    ],
  },
  {
    heading: "Admin",
    // AMENDED at the owner's explicit instruction. §0.2 fixes a menu label once
    // created, so the three changes here are recorded rather than absorbed:
    //
    //   "Question Bank"               → removed. It is now a TAB inside Form
    //                                   Builder, which is where somebody editing
    //                                   the form already is. Two sidebar entries
    //                                   for one job read as two jobs.
    //   "Departments & Form Builder"  → removed. The name promised a builder it
    //                                   did not contain, and the builder exists
    //                                   separately. Departments are now a tab in
    //                                   Settings, beside Users — both are "who
    //                                   and what the company is made of".
    //   "People"                      → "Team review". It was an empty
    //                                   placeholder; it is now the staff roster
    //                                   and the way into anybody's scorecard.
    //
    // Both retired routes still resolve — they redirect to their new home rather
    // than 404, because a bookmark going nowhere reads as a broken product.
    items: [
      { href: "/admin/form-builder", label: "Form Builder", icon: "questions", roles: ["HR_ADMIN", "MD"] },
      { href: ROUTES.adminCycles, label: "Evaluation Cycles", icon: "cycles", roles: ["HR_ADMIN", "MD"] },
      // §5's salary confinement: HR and the MD only. A HOD must not even see
      // that this screen exists, because its name says what it holds.
      // P22: "This screen is how HR runs the year." First in Admin, and above
      // Increments — an increment is one of the things it lists.
      { href: "/admin/due", label: "What is due", icon: "cycles", roles: ["HR_ADMIN", "MD"] },
      { href: "/admin/increments", label: "Increments", icon: "increments", roles: ["HR_ADMIN", "MD"] },
      { href: ROUTES.adminPeople, label: "Team review", icon: "people", roles: ["HR_ADMIN", "MD"] },
      { href: ROUTES.adminSettings, label: "Settings", icon: "settings", roles: ["HR_ADMIN", "MD"] },
    ],
  },
];

/** The groups this person can actually reach. Empty groups are dropped. */
export function navFor(roles: readonly AppRole[]): NavGroup[] {
  return NAV.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => item.roles.length === 0 || item.roles.some((role) => roles.includes(role)),
    ),
  })).filter((group) => group.items.length > 0);
}

/**
 * Longest match wins, so /admin/cycles highlights "Evaluation Cycles" rather
 * than every /admin entry at once.
 */
export function activeHref(pathname: string, roles: readonly AppRole[]): string | null {
  const candidates = navFor(roles)
    .flatMap((group) => group.items)
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length);

  return candidates[0]?.href ?? null;
}

/** The page title for the topbar (§7), from the same config. */
export function titleFor(pathname: string, roles: readonly AppRole[]): string {
  const href = activeHref(pathname, roles);
  const item = NAV.flatMap((g) => g.items).find((i) => i.href === href);
  return item?.label ?? "Appraise";
}

/**
 * §7: show a role indicator "only if the user genuinely holds more than one
 * role". EMPLOYEE is excluded from the count — everyone holds it, so it carries
 * no information, and counting it would put a badge on every screen in the
 * product.
 */
export function meaningfulRoles(roles: readonly AppRole[]): AppRole[] {
  return roles.filter((role) => role !== "EMPLOYEE");
}

export const ROLE_LABELS: Record<AppRole, string> = {
  HR_ADMIN: "HR Admin",
  MD: "MD",
  HOD: "HOD",
  SUPERVISOR: "Supervisor",
  EMPLOYEE: "Employee",
};
