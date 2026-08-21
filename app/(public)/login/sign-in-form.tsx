"use client";

/** Email + password sign-in, and Continue with Google (0074). */

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { signIn, signInWithGoogle, type AuthState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GoogleMark } from "@/components/appraise/google-mark";
import { PasswordInput } from "@/components/appraise/password-input";
import { Label } from "@/components/ui/label";

function GoogleButton({ next }: { next?: string }) {
  const { pending } = useFormStatus();
  return (
    <form action={signInWithGoogle}>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Button type="submit" variant="outline" className="min-h-11 w-full gap-2.5" disabled={pending}>
        <GoogleMark />
        Continue with Google
      </Button>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="min-h-11 w-full" disabled={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}

export function SignInForm({ next, initialError }: { next?: string; initialError?: string }) {
  const [state, action] = useActionState<AuthState, FormData>(signIn, { error: initialError });

  return (
    <div className="space-y-4">
      {/* -- Google FIRST, then the password form. --
             It is the shorter path for anybody who has it, and putting it under
             a form somebody has already started filling in is asking them to
             abandon work they just did. §13.3 wants one primary action: the
             password button is `default`, this one is `outline`, so the
             hierarchy is intact. -- */}
      <GoogleButton next={next} />

      <div className="flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-rule" />
        <span className="text-body-sm text-ink-muted">or</span>
        <span className="h-px flex-1 bg-rule" />
      </div>

    <form action={action} className="space-y-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {state.error ? (
        <p
          role="alert"
          className="rounded-control border border-critical/40 bg-critical-tint px-3 py-2 font-sans text-body-sm text-critical"
        >
          {state.error}
        </p>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="email" className="type-label text-ink-muted">
          Work email
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoFocus
          required
          className="min-h-11"
          placeholder="you@linkdprints.com"
          defaultValue={state.email}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password" className="type-label text-ink-muted">
          Password
        </Label>
        {/* Show/hide, because somebody is typing a password HR gave them —
            often on a phone — and had no way to check what they entered. */}
        <PasswordInput id="password" name="password" autoComplete="current-password" required />
      </div>

      <SubmitButton />

      <p className="font-sans text-body-sm text-ink-muted">
        Accounts are created by HR. If you cannot get in, ask them to reset your password.
      </p>
    </form>
    </div>
  );
}
