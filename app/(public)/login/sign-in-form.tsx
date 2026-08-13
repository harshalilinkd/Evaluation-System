"use client";

/** Email + password sign-in, and Continue with Google (0074). */

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { signIn, signInWithGoogle, type AuthState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/* -- The Google mark, inline.
      A remote image would be a request to another origin on the sign-in page,
      and §0.3 keeps the app self-contained. Four paths, Google's own brand
      colours — the one place in the product a literal hex is correct, for the
      same reason P11-14 gives the email palette: these are somebody else's
      colours and cannot be derived from our tokens. -- */
function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 18 18" className="size-[18px]">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.35 0-4.34-1.58-5.05-3.71H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.95 10.71a5.4 5.4 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l2.99-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l2.99 2.33C4.66 5.16 6.65 3.58 9 3.58Z"
      />
    </svg>
  );
}

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

      <p className="font-sans text-body-sm text-ink-muted">
        Accounts are created by HR. If you cannot get in, ask them to reset your password.
      </p>
    </form>
    </div>
  );
}
