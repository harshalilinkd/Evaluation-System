"use client";

/** Your own account: what we hold, and the one thing you can change. */

import { useActionState } from "react";
import { KeyRound, Loader2 } from "lucide-react";

import { changeMyPassword, type PasswordState } from "@/lib/auth/password-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type ProfileView = {
  fullName: string;
  email: string | null;
  employeeCode: string | null;
  designation: string | null;
  departmentName: string | null;
  roleLabels: string[];
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-baseline gap-3 border-b border-rule py-2.5 last:border-b-0">
      <dt className="type-label text-ink-muted">{label}</dt>
      <dd className="min-w-0 font-sans text-body text-ink">{value}</dd>
    </div>
  );
}

export function ProfileClient({ view }: { view: ProfileView }) {
  const [state, action, pending] = useActionState<PasswordState, FormData>(changeMyPassword, {});

  /* -- The form is KEYED on a successful change, so it remounts empty.
        Three password boxes still holding what somebody typed, under a message
        saying it worked, invites a second submission of a password that is now
        the old one. A remount states the intent better than clearing three
        fields by hand, and needs no effect (P8-9, P10-11). -- */
  const formKey = state.message ?? "new";

  return (
    <div className="mx-auto w-full max-w-form space-y-4 pb-10">
      {/* ---------- What we hold ----------
          Read-only, and it says why. These come from the profile HR maintains;
          an editable field here would let somebody type a name that disagrees
          with the record every appraisal is filed against (P12-14). */}
      <section className="card-surface p-5">
        <h2 className="font-sans text-display-sm text-ink">Your details</h2>
        <p className="mt-0.5 font-sans text-body-sm text-ink-muted">
          Kept by HR. Ask them if anything here is wrong.
        </p>
        <dl className="mt-3">
          <Row label="Name" value={view.fullName} />
          <Row label="Email" value={view.email ?? "—"} />
          <Row label="Employee ID" value={view.employeeCode ?? "—"} />
          <Row label="Designation" value={view.designation ?? "—"} />
          <Row label="Department" value={view.departmentName ?? "—"} />
          <Row
            label="Access"
            value={view.roleLabels.length > 0 ? view.roleLabels.join(" · ") : "Employee"}
          />
        </dl>
      </section>

      {/* ---------- The one thing they can change ---------- */}
      <section className="card-surface p-5">
        <h2 className="flex items-center gap-2 font-sans text-display-sm text-ink">
          <KeyRound aria-hidden className="size-4 text-ink-muted" />
          Change your password
        </h2>
        <p className="mt-0.5 max-w-prose font-sans text-body-sm text-ink-muted">
          HR sets everybody a simple one to begin with. Change it here whenever you like —
          nobody else can see what you choose, not even HR.
        </p>

        <form key={formKey} action={action} className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="current_password" className="type-label text-ink-muted">
              Current password
            </Label>
            <Input
              id="current_password"
              name="current_password"
              type="password"
              autoComplete="current-password"
              required
              className="min-h-11"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="new_password" className="type-label text-ink-muted">
                New password
              </Label>
              <Input
                id="new_password"
                name="new_password"
                type="password"
                autoComplete="new-password"
                required
                className="min-h-11"
              />
              <p className="font-sans text-body-sm text-ink-muted">At least 6 characters.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm_password" className="type-label text-ink-muted">
                Repeat it
              </Label>
              <Input
                id="confirm_password"
                name="confirm_password"
                type="password"
                autoComplete="new-password"
                required
                className="min-h-11"
              />
              {/* -- Said HERE rather than only after a failed submit: somebody
                    who mistypes both boxes the same way is locked out of their
                    own account, and the repeat is the only thing that catches
                    it. Worth explaining before the press, not after. -- */}
              <p className="font-sans text-body-sm text-ink-muted">
                So a typo cannot lock you out.
              </p>
            </div>
          </div>

          {state.error || state.message ? (
            <p
              role={state.error ? "alert" : "status"}
              className={cn(
                "rounded-control border px-3 py-2 font-sans text-body-sm",
                state.error
                  ? "border-critical/40 bg-critical-tint text-critical"
                  : "border-rule bg-surface-mute text-ink",
              )}
            >
              {state.error ?? state.message}
            </p>
          ) : null}

          <Button type="submit" className="min-h-11" disabled={pending}>
            {pending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
            Change password
          </Button>
        </form>
      </section>
    </div>
  );
}
