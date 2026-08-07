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

  // Signed-in users have no business on the login page.
  if (user && pathname === ROUTES.login) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = ROUTES.dashboard;
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
