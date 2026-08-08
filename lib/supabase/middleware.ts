/** Session refresh and the coarse gate on the authenticated area. */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { isProtectedPath, ROUTES } from "@/lib/auth/landing";
import type { Database } from "@/types/database";

/**
 * Refreshes the Supabase session cookie on every request and answers the one
 * question worth answering this early: is anybody signed in?
 *
 * It deliberately does NOT check roles. Doing so would mean a database
 * round-trip in middleware on every navigation; the role check lives in the
 * page guards instead, where it shares a request-scoped cache with the page's
 * own queries.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without configuration there is no session to refresh and nothing to gate.
  // Failing open here would be wrong, but so would 500-ing every request — the
  // page guards still run and will send an unauthenticated visitor to /login.
  if (!url || !anonKey) return response;

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser(), never getSession(): getSession trusts the cookie as it stands,
  // getUser revalidates the JWT with the auth server. There must be no other
  // logic between createServerClient and this call, or the refresh can be
  // skipped and people get signed out at random.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && isProtectedPath(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = ROUTES.login;
    redirectUrl.search = "";
    // Where they were headed, so sign-in can return them there. Relative only.
    redirectUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  /* -- A signed-in visitor who WANDERS onto the login page is sent to the app.
        One who is trying to sign in as somebody else is not.

        THIS REDIRECT WAS UNCONDITIONAL, and it made two things impossible.

        1. Switching accounts on a shared device. A phone or a shop-floor
           terminal has one browser and several people, and every one of them
           has an email and a password. Bouncing them to a dashboard belonging
           to whoever logged in last, with no way to reach a login form, is not
           a session policy — it is a lockout, and the only escape was to find a
           sign-out control on a page they had no reason to visit.

        2. The invite hand-off. `/invite/[token]` signs a mismatched user out and
           redirects to `/login?next=/invite/consume`, carrying the invite in an
           httpOnly cookie. If the sign-out has not landed by the time that next
           request is read, this rule saw a session, redirected to the dashboard
           AND dropped the `next` — so the invite was silently abandoned and the
           person never reached the form the link was for.

        Both exceptions are narrow and neither weakens anything: reaching the
        login form does not sign anybody in, and `signInWithPassword` replaces
        the session rather than adding one. Nothing here decides what a person
        may READ — RLS and the page guards do that, and they answer to whoever
        the session ends up belonging to. -- */
  const wantsToSwitch = request.nextUrl.searchParams.has("switch");
  const midHandOff = request.nextUrl.searchParams.has("next");

  if (user && pathname === ROUTES.login && !wantsToSwitch && !midHandOff) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = ROUTES.dashboard;
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
