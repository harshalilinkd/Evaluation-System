"use client";

/** A password field with a show/hide toggle. */

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Asked for on the sign-in page: somebody typing a password they were given by
 * HR, on a phone, with no way to check what they typed.
 *
 * Shared rather than inline because there are FOUR password fields in the
 * product — one here, three on the change-password form — and three different
 * toggles would be worse than none: the control that reveals a password is
 * exactly the one that has to behave identically everywhere it appears.
 *
 * `type` is deliberately not accepted from the caller. A `PasswordInput` that
 * could be handed `type="text"` is not a password input, and the toggle would
 * then be lying about what it controls.
 */
export function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "type">) {
  const [visible, setVisible] = React.useState(false);
  const Icon = visible ? EyeOff : Eye;

  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        /* -- pr-12 keeps the value clear of the button. Without it a long
              password runs underneath the icon and the last characters \u2014 the
              ones somebody is checking \u2014 are the ones hidden. -- */
        className={cn("min-h-11 pr-12", className)}
      />

      {/* -- `type="button"` is load-bearing: a bare <button> inside a form
             defaults to submit, so revealing the password would ALSO try to
             sign in, on a form that may be half-filled.

             The accessible NAME changes rather than carrying `aria-pressed`.
             Both are valid ARIA patterns and mixing them reads badly \u2014 a
             pressed "Hide password" is a puzzle \u2014 so the name states the
             action the press will perform, which is what a screen reader
             announces on activation.

             44px square per \u00a713.8, with an 18px glyph inside it. The target is
             the button, not the icon; a 16px hit area on a phone is the failure
             mode this rule exists for. -- */}
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        className={cn(
          "absolute right-0 top-0 flex h-full w-11 items-center justify-center",
          "rounded-r-control text-ink-muted transition-colors duration-hover",
          "hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
      >
        <Icon aria-hidden className="size-[18px]" />
      </button>
    </div>
  );
}
