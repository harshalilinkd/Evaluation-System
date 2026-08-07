"use server";

/** Sign-in and sign-out. Email + password. */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getRoles } from "@/lib/auth/roles";
import { landingPathFor, ROUTES } from "@/lib/auth/landing";
import { signInSchema } from "@/lib/auth/schemas";
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
