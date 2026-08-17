/** Session refresh and the coarse gate on the authenticated area. */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { isProtectedPath, ROUTES } from "@/lib/auth/landing";
import type { Database } from "@/types/database";

/* -- A REDIRECT THAT KEEPS THE REFRESHED SESSION.

      `supabase.auth.getUser()` above may ROTATE the refresh token, and the
      Supabase client writes the new pair onto `response` through the `setAll`
      handler. Returning a brand-new `NextResponse.redirect(...)` throws that
      response away — so the rotated token is never sent to the browser, the old
      one is already spent, and the next request arrives with a token the auth
      server has retired. The person is signed out at what looks like random.

      This is the failure the file's own comment warns about ("people get signed
      out at random") from a direction it did not cover: not logic BEFORE the
      call, but a response discarded AFTER it.

      So the cookies are copied onto the redirect. -- */
function redirectKeepingSession(to: URL, from: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(to);
  for (const cookie of from.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  return redirect;
}

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
  //
  /* -- WRAPPED, because an unhandled throw here is a 500 and a 500 is an HTML
        page. That matters far more than it looks.

        This is a network call to Supabase Auth on EVERY request, including
        every autosave POST. On a phone on 4G it is the single most likely
        thing in the chain to fail — and when it threw, Next returned an error
        page, the Server Action POST received `text/html` instead of
        `text/x-component`, and the client threw Next's internal transport
        error E394: "An unexpected response was received from the server."
        That string was then printed verbatim into the employee's save banner.

        Failing open is safe here and is not a hole: §9 requires every page and
        every server action to re-check the role and the state-machine guard
        itself, and they all do — `requireAuth()` redirects, `getCurrentProfile()`
        returns null and the action answers with a typed NOT_AUTHENTICATED.
        Middleware is the first of three layers, never the only one, so a
        network blip degrades to "the guards downstream decide" rather than to
        a 500 nobody can read. -- */
  let user = null;
  try {
    ({
      data: { user },
    } = await supabase.auth.getUser());
  } catch {
    // Leave `user` null and fall through. A genuinely signed-out visitor is
    // still stopped by the guard on the page they asked for.
    return response;
  }

  const { pathname } = request.nextUrl;

  /* -- A SERVER ACTION IS NEVER REDIRECTED FROM HERE.

        A 307 to /login answers a Server Action POST with an HTML page, which
        the client cannot parse — E394 again, and the second way a phone
        produced that banner: filling in thirty-one questions takes long enough
        that a session can lapse midway, and the autosave that discovers it got
        a redirect rather than an answer.

        Let it through instead. The action's own `getCurrentProfile()` returns
        null and it replies with the typed failure it already carries — "Please
        sign in again." — which reaches the banner as a sentence somebody can
        act on. §0.7: fail loudly, not incomprehensibly. -- */
  const isServerAction = request.headers.has("next-action");

  if (!user && isProtectedPath(pathname) && !isServerAction) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = ROUTES.login;
    redirectUrl.search = "";
    // Where they were headed, so sign-in can return them there. Relative only.
    redirectUrl.searchParams.set("next", pathname);
    return redirectKeepingSession(redirectUrl, response);
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
  /* -- 3. THE APP ITSELF SENT THEM HERE, and bouncing them back is a loop.
        `requireAuth` redirects to `/login?error=no_profile` when a session is
        valid but its profile row cannot be read, and to
        `/login?error=account_inactive` when HR has switched somebody off. In
        both cases the browser still holds a working session — so this rule saw
        a user, redirected to the dashboard, the layout guard rejected them
        again, and round it went until the browser gave up with
        ERR_TOO_MANY_REDIRECTS. The whole site, for that person, with no way out
        but clearing cookies.

        An `error` parameter means a guard has already decided this person may
        not be in the app. The login screen is where that decision is explained;
        overruling it is how a rejection becomes an infinite loop rather than a
        message. Same shape as the two exceptions above — the redirect is for
        somebody who WANDERED here, never for somebody who was sent. -- */
  const wasRejected = request.nextUrl.searchParams.has("error");

  if (user && pathname === ROUTES.login && !wantsToSwitch && !midHandOff && !wasRejected) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = ROUTES.dashboard;
    redirectUrl.search = "";
    return redirectKeepingSession(redirectUrl, response);
  }

  return response;
}
