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
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

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
