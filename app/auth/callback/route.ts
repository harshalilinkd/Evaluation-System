/** Where Google lands. Exchanges the code for a session, or explains why not. */

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { landingPathFor, ROUTES } from "@/lib/auth/landing";
import { getRoles } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

/* -- OUTSIDE THE (app) GROUP, deliberately.
      That layout is a guarded, authenticated shell; this route runs for
      somebody who is mid-way through becoming authenticated and may end up not
      being. Same reasoning P15-1 gives the print routes: placement is what
      makes the guarantee structural rather than a rule to remember. -- */

export const dynamic = "force-dynamic";

/** Only relative paths survive — see `safeNext` in lib/auth/actions.ts. */
function safeNext(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));

  const back = (error: string) => {
    const to = new URL(ROUTES.login, url.origin);
    to.searchParams.set("error", error);
    if (next) to.searchParams.set("next", next);
    return NextResponse.redirect(to);
  };

  /* -- 0074 refuses a self-signup at the database, which aborts GoTrue's
        insert, and GoTrue reports that here as an error rather than a code.
        There is no way to distinguish it from any other provider failure at
        this point, and that is fine: both answers to the person are the same
        sentence, and P6-7 requires it to be — a login page that tells you
        whether an address is known is a staff directory. -- */
  if (url.searchParams.has("error") || !code) return back("no_account");

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return back("no_account");

  /* -- Belt and braces. 0074 is what actually stops an unknown Google account
        becoming a profile; this catches the case where a session exists but no
        profile does — an account created before the migrations were applied,
        which the password path already has a message for. Signed out rather
        than left half-in: a session belonging to nobody is a state every guard
        downstream would have to be taught about. -- */
  const roles = await getRoles();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return back("no_account");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, is_active")
    .eq("id", user.id)
    .maybeSingle();

  /* -- THE SIGN-OUT HAS TO REACH THE BROWSER, and it did not.

        `signOut()` revokes the session at GoTrue and asks the cookie store to
        clear the pair — but `back()` returns a BRAND-NEW `NextResponse`, and a
        response constructed from scratch does not carry cookie work done
        before it. Exactly the failure `redirectKeepingSession` documents in
        lib/supabase/middleware.ts, from the other direction.

        So the browser kept a cookie whose access token is still
        cryptographically valid for the rest of its hour. The next request's
        `getUser()` in middleware therefore SAW A USER on
        `/login?error=no_profile`, and sent them into the app — where the
        layout guard found no profile and sent them back. ERR_TOO_MANY_REDIRECTS
        on the bare domain, with no way out but clearing cookies by hand.

        Clearing them on the response itself is what makes the sign-out real.
        Matching on the `sb-` prefix rather than naming the cookie because
        supabase-ssr CHUNKS a large token across `…auth-token.0`, `.1`, … and
        leaving one chunk behind is the same bug with a subtler symptom. -- */
  const signOutInto = async (response: NextResponse) => {
    await supabase.auth.signOut();
    for (const cookie of (await cookies()).getAll()) {
      if (cookie.name.startsWith("sb-")) response.cookies.delete(cookie.name);
    }
    return response;
  };

  if (!profile) return signOutInto(back("no_profile"));

  if (!profile.is_active) return signOutInto(back("account_inactive"));

  return NextResponse.redirect(new URL(next ?? landingPathFor(roles), url.origin));
}
