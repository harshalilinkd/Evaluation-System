/** Route and action guards. CLAUDE.md §9 — the first statement of every protected path. */

import "server-only";

import { redirect } from "next/navigation";

import { getCurrentProfile, getRoles, type AppRole, type Profile } from "@/lib/auth/roles";
import { landingPathFor, ROUTES } from "@/lib/auth/landing";
import { createClient } from "@/lib/supabase/server";

/**
 * §9: "Client code must never be the only guard."
 *
 * These are the second of three layers, not the whole of it:
 *   1. middleware  — is there a session at all, for the whole /(app) area
 *   2. these       — does this person hold what this page or action needs
 *   3. RLS         — may they touch this specific row
 *
 * Layers 1 and 2 exist so a scoped user gets a clean redirect instead of an
 * empty screen. Layer 3 is what actually protects the data: if every guard here
 * were deleted the app would look broken, but it would not leak.
 */

export type GuardedSession = {
  profile: Profile;
  roles: AppRole[];
};

/* ---------- requireAuth ---------- */

/**
 * A signed-in, active profile, or a redirect to /login.
 *
 * `next` carries where they were headed so sign-in can return them there. Only
 * relative paths survive the round trip — see the sanitiser in the login action —
 * so this cannot be turned into an open redirect.
 */
export async function requireAuth(next?: string): Promise<GuardedSession> {
  const profile = await getCurrentProfile();

  if (!profile) {
    // Two very different failures land here, and telling them apart matters.
    //
    // No session at all is ordinary: send them to sign in. But a *valid*
    // session with no profile row means the on_auth_user_created trigger never
    // ran — usually because the account was created before the migrations were
    // applied. Redirecting that person to /login produces an endless loop:
    // they sign in successfully, bounce straight back, and reasonably conclude
    // that login is broken. §0.7 — fail loudly, not into a blank screen.
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      redirect(`${ROUTES.login}?error=no_profile`);
    }

    const target =
      next && next.startsWith("/") && !next.startsWith("//")
        ? `${ROUTES.login}?next=${encodeURIComponent(next)}`
        : ROUTES.login;
    redirect(target);
  }

  // A deactivated person keeps a valid JWT until it expires. Checking the flag
  // is what makes "HR switched them off" take effect immediately.
  if (!profile.is_active) {
    redirect(`${ROUTES.login}?error=account_inactive`);
  }

  return { profile, roles: await getRoles() };
}

/* ---------- requireRole ---------- */

/**
 * Requires at least one of `roles`.
 *
 * Redirects to the person's own landing page rather than to /login: they are
 * signed in, they are simply somewhere they are not entitled to be, and
 * bouncing them to a login form they have already passed is confusing.
 *
 * Called as the first statement of a page, so the browser never receives markup
 * it should not have — which is the difference between a redirect and rendering
 * something and then hiding it.
 */
export async function requireRole(roles: readonly AppRole[]): Promise<GuardedSession> {
  const session = await requireAuth();

  if (roles.length > 0 && !roles.some((role) => session.roles.includes(role))) {
    redirect(`${landingPathFor(session.roles)}?error=forbidden`);
  }

  return session;
}

/* ---------- requireEvaluationAccess ---------- */

export type EvaluationAction = "view" | "self" | "lead" | "md" | "decide";

export type EvaluationAccess = GuardedSession & {
  evaluation: {
    id: string;
    status: string;
    evaluatee_id: string;
    lead_id: string | null;
    cycle_id: string;
    track: string;
    // AMEND-3: a screen must be able to tell whether ITS OWN layer is locked
    // without consulting the status, because §8 stopped the status carrying
    // that. Both timestamps are here; only HR and the MD have screens that read
    // both, and RLS is what stops anybody else acting on the other one.
    self_submitted_at: string | null;
    lead_submitted_at: string | null;
  };
};

/**
 * Access to one specific evaluation, for one specific action.
 *
 * The read is made through the authenticated client, so RLS answers "may this
 * person see this row at all" before any logic here runs — a row they cannot
 * see comes back as not-found, and they get the same redirect as a row that
 * genuinely does not exist. That is intentional: distinguishing the two would
 * turn this into an oracle for who is being evaluated.
 *
 * The action check on top of that mirrors §8's actor rules, so a lead cannot
 * open the MD's override screen for a report they legitimately review.
 */
export async function requireEvaluationAccess(
  evaluationId: string,
  action: EvaluationAction,
): Promise<EvaluationAccess> {
  const session = await requireAuth();
  const supabase = await createClient();

  const { data: evaluation } = await supabase
    .from("evaluations")
    // AMEND-3: the two layer timestamps come back too. A screen must be able
    // to tell whether ITS OWN layer is locked without consulting the status,
    // because §8 stopped the status carrying that.
    .select("id, status, evaluatee_id, lead_id, cycle_id, track, self_submitted_at, lead_submitted_at")
    .eq("id", evaluationId)
    .maybeSingle();

  if (!evaluation) {
    redirect(`${landingPathFor(session.roles)}?error=not_found`);
  }

  const isHr = session.roles.includes("HR_ADMIN");
  const isMd = session.roles.includes("MD");
  const isEvaluatee = evaluation.evaluatee_id === session.profile.id;
  const isLead = evaluation.lead_id === session.profile.id;

  const permitted = (() => {
    switch (action) {
      case "view":
        return isEvaluatee || isLead || isHr || isMd;
      case "self":
        return isEvaluatee;
      case "lead":
        return isLead;
      case "md":
      case "decide":
        // AMEND-2 REVERSED the 0012 merge. The MD's review and the MD's layer
        // are the MD's: HR prepares and reviews, the MD approves, and that
        // separation IS the second pair of eyes on a pay decision. HR keeps a
        // read of the record through "view".
        return isMd;
      default:
        return false;
    }
  })();

  if (!permitted) {
    redirect(`${landingPathFor(session.roles)}?error=forbidden`);
  }

  return { ...session, evaluation };
}

/* ---------- For Server Actions ---------- */

/**
 * The same checks without the redirect, for Server Actions — §14 requires them
 * to return `{ ok: false, error }` rather than throw or navigate.
 */
export async function checkRole(
  roles: readonly AppRole[],
): Promise<{ ok: true; session: GuardedSession } | { ok: false; error: { code: string; message: string } }> {
  const profile = await getCurrentProfile();

  if (!profile) {
    return { ok: false, error: { code: "NOT_AUTHENTICATED", message: "Please sign in again." } };
  }
  if (!profile.is_active) {
    return { ok: false, error: { code: "ACCOUNT_INACTIVE", message: "This account is not active." } };
  }

  const held = await getRoles();
  if (roles.length > 0 && !roles.some((role) => held.includes(role))) {
    return {
      ok: false,
      error: { code: "FORBIDDEN", message: "You do not have permission to do that." },
    };
  }

  return { ok: true, session: { profile, roles: held } };
}
