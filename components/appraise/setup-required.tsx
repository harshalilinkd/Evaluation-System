/** Shown when Supabase credentials are absent. DESIGN.md §8 copy tone. */

import { AuthShell } from "@/components/appraise/auth-shell";

/**
 * The one error whose audience is a developer rather than an employee, so it
 * says exactly which file and which keys — but it still follows §8: what
 * happened, then what to do next, and no stack trace.
 */
export function SetupRequired() {
  return (
    <AuthShell eyebrow="Setup" title="Not connected yet">
      <div className="space-y-4">
        <p className="font-sans text-body text-ink-muted">
          This app needs a Supabase project before anyone can sign in. Copy{" "}
          <code className="tabular text-body-sm text-ink">.env.example</code> to{" "}
          <code className="tabular text-body-sm text-ink">.env.local</code> and fill in these two
          values from your project&rsquo;s API settings, then restart the dev server.
        </p>

        <ul className="space-y-1 rounded-control border border-rule bg-surface-mute p-4">
          <li className="tabular text-body-sm text-ink">NEXT_PUBLIC_SUPABASE_URL</li>
          <li className="tabular text-body-sm text-ink">NEXT_PUBLIC_SUPABASE_ANON_KEY</li>
        </ul>

        <p className="font-sans text-body-sm text-ink-muted">
          The design system at <code className="tabular text-body-sm">/styleguide</code> works
          without a database, if you only want to look at the components.
        </p>
      </div>
    </AuthShell>
  );
}
