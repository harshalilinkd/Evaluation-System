"use server";

/** Sign-in and sign-out. Email + password, and Google (0074). */

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getRoles } from "@/lib/auth/roles";
import { landingPathFor, ROUTES } from "@/lib/auth/landing";
import { signInSchema } from "@/lib/auth/schemas";
import { resolveAppUrl } from "@/lib/notify/preflight";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// Schemas live in ./schemas — a "use server" module may only export async
// functions, so a Zod object exported from here fails the build.

/* ---------- State ---------- */

export type AuthState = { error?: string; email?: string };

/**
 * Only relative paths survive. Without this, `?next=https://evil.example` turns
 * the login screen into an open redirect that borrows this app's credibility.
 */
function safeNext(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

/**
 * Everybody's account is registered under one email — the personal one HR
 * typed when the account was created (§9, 0074: HR creates accounts, nobody
 * self-signs-up). 0081 added a SECOND, official address for notifications,
 * and that is all it has ever been: something to send a message TO, never
 * something to sign in WITH.
 *
 * This is what makes "sign in with either" true without touching that: if
 * what was typed matches somebody's official email, resolve it to their real
 * registered one before Supabase ever sees it. Type the personal email and
 * this does one query that finds nothing and changes nothing — the ordinary
 * case costs a lookup, not a rewrite.
 *
 * SILENT either way, on purpose. Which email resolved, or whether it resolved
 * at all, is never revealed on its own — the eventual sign-in failure below is
 * worded identically regardless, because a login form that says which
 * addresses are known is a staff directory (P6-7).
 *
 * The service client is the only way to ask this question: nobody is
 * authenticated yet, so RLS would refuse an anonymous read of `profiles`, and
 * the account's real email lives in `auth.users`, which the ordinary client
 * cannot query at all — only the Admin API can look it up by id.
 */
async function resolveSignInEmail(typed: string): Promise<string> {
  const service = createServiceClient();
  const { data: byWorkEmail } = await service
    .from("profiles")
    .select("id")
    .ilike("work_email", typed)
    .maybeSingle();

  if (!byWorkEmail) return typed;

  const { data } = await service.auth.admin.getUserById(byWorkEmail.id);
  return data.user?.email ?? typed;
}

/* ---------- Sign in ---------- */

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const raw = formData.get("email");
  const parsed = signInSchema.safeParse({
    email: raw,
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Check your email and password.",
      email: typeof raw === "string" ? raw : undefined,
    };
  }

  const supabase = await createClient();
  const signInEmail = await resolveSignInEmail(parsed.data.email);
  const { error } = await supabase.auth.signInWithPassword({
    email: signInEmail,
    password: parsed.data.password,
  });

  if (error) {
    // One message for both "no such account" and "wrong password". Telling them
    // apart would turn this form into a staff directory.
    return { error: "That email and password do not match.", email: parsed.data.email };
  }

  revalidatePath("/", "layout");

  const next = safeNext(formData.get("next"));
  redirect(next ?? landingPathFor(await getRoles()));
}

/* ---------- Sign out ---------- */

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();

  revalidatePath("/", "layout");
  redirect(ROUTES.login);
}


/* ---------- Google ---------- */

/**
 * Starts the Google flow. It signs somebody IN; it never signs them UP.
 *
 * §9 keeps account creation with HR and 0074 enforces it in the database: an
 * identity whose provider is not `email` is refused at the trigger, so a Google
 * account with no HR-created counterpart cannot become a profile. A member of
 * staff signing in with Google is LINKED to their existing account instead,
 * because `provisionPerson` confirms the address when HR types it and Supabase
 * links a social identity to a verified email it already knows.
 *
 * The consent screen is deliberately EXTERNAL (staff addresses are a mix of
 * @linkdprints.com and personal Gmail), so Google filters nobody and 0074 is
 * the only wall. That is stated here because it is the reason this function is
 * three lines and the migration is a hundred.
 */
export async function signInWithGoogle(formData: FormData): Promise<void> {
  const next = safeNext(formData.get("next"));
  const supabase = await createClient();

  /* -- The address Google returns to is OURS, not Supabase's. Google redirects
        to Supabase (`/auth/v1/callback`, the one URI in the console) and
        Supabase then redirects here with a code to exchange. This must be in
        Supabase's Redirect URLs allow-list or it silently falls back to the
        Site URL and the `next` is lost.

        Built from the request's own origin rather than a configured URL, so
        localhost, a preview deployment and production each come back to
        themselves with nothing to set (P10-B). -- */
  const origin = (await headers()).get("origin") ?? resolveAppUrl() ?? "";
  const callback = new URL("/auth/callback", origin);
  if (next) callback.searchParams.set("next", next);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callback.toString() },
  });

  /* -- §0.7: fail loudly. A button that does nothing reads as broken, and the
        commonest cause by far is the provider not yet being enabled in
        Supabase. Redirected rather than returned, because a `<form action>`
        must resolve to void — and the message has to survive the round trip to
        Google's domain and back anyway, which a returned value would not. -- */
  if (error || !data?.url) {
    redirect(`${ROUTES.login}?error=google_unavailable${next ? `&next=${encodeURIComponent(next)}` : ""}`);
  }

  redirect(data.url);
}

/* ---------- Link a second Google account ---------- */

/**
 * Attaches ANOTHER Google account to your existing profile — the official
 * one, most often, when the personal address is what the account was created
 * under. This is the supported, safe way to make "sign in with either email"
 * true for Google, and it is a different question from `signInWithGoogle`
 * above, not a variant of it.
 *
 * That function answers "does a Google account we don't yet recognise belong
 * to somebody", and 0074 refuses it on purpose — that refusal is the entire
 * wall stopping a stranger's Google account from becoming a profile nobody at
 * HR created (§9). Linking asks the opposite question, from someone who is
 * ALREADY signed in: "attach this Google account to me". It can only ever
 * extend the session that is already open — there is no path from here to a
 * new profile, so 0074's protection is untouched by adding this.
 *
 * Supabase's own `linkIdentity`, not a hand-rolled version of it: it is a real
 * OAuth round trip (through Google, back through Supabase's callback) so the
 * Google account is genuinely verified rather than merely typed in, and it
 * lands on the SAME `/auth/callback` route the sign-in flow uses — GoTrue
 * tells the two apart internally from the original request, so no second
 * route was needed.
 */
export async function linkGoogleIdentity(): Promise<void> {
  const supabase = await createClient();

  const origin = (await headers()).get("origin") ?? resolveAppUrl() ?? "";
  const callback = new URL("/auth/callback", origin);
  callback.searchParams.set("next", "/profile");

  const { data, error } = await supabase.auth.linkIdentity({
    provider: "google",
    options: { redirectTo: callback.toString() },
  });

  if (error || !data?.url) {
    /* -- The provider's own reason survives the round trip as a query param,
          the same way `signInWithGoogle`'s failure does — a person told only
          "something went wrong" has no way to know whether to try again or to
          ask HR, and §0.7 asks for the actionable version. Most often this is
          "Identity is already linked to another user", which means that
          Google account is already someone else's sign-in method, and no
          amount of retrying changes that. -- */
    redirect(`/profile?error=${encodeURIComponent(error?.message ?? "Could not link that account.")}`);
  }

  redirect(data.url);
}
