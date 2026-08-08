/** Stand-in for a screen whose feature has not been built yet. */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * These exist so route protection is real rather than theoretical: a guard that
 * redirects away from a page that does not exist proves nothing. Each one is
 * replaced by its feature in a later phase.
 */
export function Placeholder({
  title,
  description,
  guardedBy,
}: {
  title: string;
  description: string;
  guardedBy: string;
}) {
  return (
    <div className="max-w-form space-y-6">
      <div className="space-y-2">
        <h2 className="section-header">{title}</h2>
        <p className="font-sans text-body-lg text-ink-muted">{description}</p>
      </div>

      <Card className="card-surface">
        <CardHeader>
          <CardTitle className="font-sans text-body-lg font-medium">Not built yet</CardTitle>
          <CardDescription className="font-sans text-body text-ink-muted">
            Routing, the session and the access guard are live. The feature itself comes next.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="type-label text-ink-muted">Reachable by</p>
          <p className="font-sans text-body text-ink">{guardedBy}</p>
        </CardContent>
      </Card>
    </div>
  );
}
