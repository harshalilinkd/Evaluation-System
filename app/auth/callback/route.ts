/** Where Google lands. Exchanges the code for a session, or explains why not. */

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

  if (!profile) {
    await supabase.auth.signOut();
    return back("no_profile");
  }

  if (!profile.is_active) {
    await supabase.auth.signOut();
    return back("account_inactive");
  }

  return NextResponse.redirect(new URL(next ?? landingPathFor(roles), url.origin));
}
