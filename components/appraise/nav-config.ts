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
 * Who may open My Team.
 *
 * Declared here rather than inline so the nav item and the route guard read the
 * SAME list. Two copies of "who may open this" is how a menu comes to offer a
 * link that redirects, which reads as a permissions bug rather than as a menu.
 */
export const TEAM_ROLES: readonly AppRole[] = ["HOD", "SUPERVISOR", "HR_ADMIN", "MD"];

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
        /* -- SUPERVISOR removed. A supervisor's reports are shop-floor workers,
              and `/team` is the STAFF queue — it reads `evaluations`, which §5
              keeps to the staff module entirely. So a supervisor opening it saw
              "Nobody on your team has submitted yet" for ever, which is true of
              a list they will never have a row in and reads as a broken screen.

              Their queue is Production Team, below. A supervisor who is ALSO a HOD
              still sees this one, on the HOD role. -- */
        /* -- OR THE RELATIONSHIP, which the item cannot express on its own.
              A role is a configuration tick HR sets on the Users screen. Being
              somebody's manager is `evaluations.lead_id`, copied at launch —
              and nothing about being assigned as a manager grants HOD. So a
              person named as the manager on three launched evaluations, sent
              all three invite links, had no My Team in their sidebar.

              `navFor` takes `leadsTeam` and admits this item on it. The list is
              still the same one the /team guard uses, so the two cannot
              disagree about who may open it (P4-7: actors are roles AND
              relationships). -- */
        roles: TEAM_ROLES,
      },
      /* -- SHOP FLOOR. It did not exist, and the worker board's own standing
            note told supervisors to use it — "both from Production Team in their own
            menu" — so the instruction pointed at a menu item nobody had. A
            supervisor had no route to the worker module at all; they landed on
            the staff team screen and found it empty.

            `/worker-team` is where they hand a worker the sheet and where they
            rate them afterwards. HR and the MD are deliberately NOT here: their
            way in is Production Appraisals under Administration, which is the whole
            round rather than one supervisor's people. -- */
      {
        href: "/worker-team",
        // Renamed from "Shop floor" at the owner's explicit instruction, along
        // with the track itself. The ROUTE and the `worker_` schema keep their
        // names — they are stored values and code, not something anybody reads.
        label: "Production Team",
        icon: "team",
        roles: ["SUPERVISOR"],
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
    // created, so the changes here are recorded rather than absorbed:
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
    //   "People"                      → "Team review", then REMOVED from here
    //                                   entirely — it is a tab in Settings now,
    //                                   beside Recycle bin. Reasoning below.
    //   "Evaluation Due"              → removed. It is a sub-screen reached from
    //                                   Evaluation Cycles now. Reasoning below.
    //   "Increments"                  → removed. Same move, same reasoning.
    //
    // Every retired route still resolves — Team review and the two retired
    // question/department paths REDIRECT to their new home rather than 404,
    // because a bookmark going nowhere reads as a broken product. Evaluation
    // Due and Increments are NOT redirects: they stay real, independent routes
    // (`/admin/due`, `/admin/increments`) — only their SIDEBAR entry is gone.
    // Both pages now render `CycleSectionNav` at their own top, so the three
    // screens (the cycle list, what is due, the increment calendar) read as one
    // section reachable from any of them, exactly the way the department
    // mapping screen is reached from the Departments tab rather than listed
    // beside it.
    //
    // The reasoning for pulling all three out: eight destinations under one
    // heading asked HR to learn eight icons before finding anything, and three
    // of the eight — Team review, Evaluation Due, Increments — are not jobs of
    // their own so much as VIEWS onto people and cycles the other five already
    // manage. Team review reads today's roster the same way Departments and
    // Users already do, which is why it belongs beside them in Settings. Due and
    // Increments are both about WHEN a cycle should happen, which is Evaluation
    // Cycles' own question — so they are answered there, one click deeper.
    items: [
      { href: "/admin/form-builder", label: "Form Builder", icon: "questions", roles: ["HR_ADMIN", "MD"] },
      { href: ROUTES.adminCycles, label: "Evaluation Cycles", icon: "cycles", roles: ["HR_ADMIN", "MD"] },
      // §5's salary confinement: HR and the MD only. A HOD must not even see
      // that this screen exists, because its name says what it holds.
      /* -- Its own entry, directly under the staff one.
            §7 keeps the two modules apart, and the menu is where somebody first
            decides which they are in. Folding worker appraisals into "Evaluation
            Cycles" as a filter would make the shop-floor sheet look like a view
            of the staff form, which it is not — different questions, a different
            scale and different people. -- */
      {
        href: "/admin/worker-appraisals",
        // "Worker Appraisals" → "Production Appraisals". Deliberately NOT
        // "Production Team": that is the supervisor's own queue above, and two
        // sidebar entries reading the same words is worse than either alone.
        label: "Production Appraisals",
        icon: "cycles",
        roles: ["HR_ADMIN", "MD"],
      },
      { href: ROUTES.adminSettings, label: "Settings", icon: "settings", roles: ["HR_ADMIN", "MD"] },
    ],
  },
];

/**
 * The groups this person can actually reach. Empty groups are dropped.
 *
 * `leadsTeam` is the RELATIONSHIP half of the answer: somebody named as the
 * manager on a launched evaluation may open My Team whether or not HR has
 * ticked HOD on their account. Optional, defaulting to false, so every existing
 * caller behaves exactly as it did.
 */
export function navFor(roles: readonly AppRole[], leadsTeam = false): NavGroup[] {
  return NAV.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        item.roles.length === 0 ||
        item.roles.some((role) => roles.includes(role)) ||
        // The one item a relationship can unlock. Named explicitly rather than
        // flagged on the item: it is the only route in the product whose access
        // is decided by anything other than a role, and a general mechanism for
        // one case invites the next person to use it for something else.
        (leadsTeam && item.href === ROUTES.team),
    ),
  })).filter((group) => group.items.length > 0);
}

/**
 * Longest match wins, so /admin/cycles highlights "Evaluation Cycles" rather
 * than every /admin entry at once.
 */
export function activeHref(
  pathname: string,
  roles: readonly AppRole[],
  leadsTeam = false,
): string | null {
  const candidates = navFor(roles, leadsTeam)
    .flatMap((group) => group.items)
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length);

  return candidates[0]?.href ?? null;
}

/**
 * Titles for pages that are reachable and real, but carry no sidebar entry of
 * their own — Evaluation Due and Increments are sub-screens of Evaluation
 * Cycles now (see the Admin group's own comment above), so `activeHref` finds
 * nothing for them and the topbar would otherwise fall back to the generic
 * "Appraisal" on two screens that plainly are not that.
 */
const EXTRA_TITLES: ReadonlyArray<{ prefix: string; label: string }> = [
  { prefix: "/admin/due", label: "Evaluation Due" },
  { prefix: "/admin/increments", label: "Increments" },
];

/** The page title for the topbar (§7), from the same config. */
export function titleFor(pathname: string, roles: readonly AppRole[]): string {
  const href = activeHref(pathname, roles);
  const item = NAV.flatMap((g) => g.items).find((i) => i.href === href);
  if (item) return item.label;

  const extra = EXTRA_TITLES.find((e) => pathname === e.prefix || pathname.startsWith(`${e.prefix}/`));
  return extra?.label ?? "Appraisal";
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
  // "HOD" and "Lead" were the same person under two names, and the product used
  // both. One word now. The ROLE VALUE stays HOD — it is in `user_roles`, in
  // every RLS policy and in `is_lead_of_evaluation`.
  HOD: "Manager",
  SUPERVISOR: "Supervisor",
  EMPLOYEE: "Employee",
};
