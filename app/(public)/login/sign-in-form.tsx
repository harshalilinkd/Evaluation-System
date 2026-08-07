"use client";

/** Email + password sign-in. */

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { signIn, type AuthState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="min-h-11"
        />
      </div>

      <SubmitButton />

      <p className="font-sans text-body-sm text-ink-faint">
        Accounts are created by HR. If you cannot get in, ask them to reset your password.
      </p>
    </form>
  );
}
