/** Whose scorecard to show. Administrators only — everyone else sees their own. */

"use client";

import { useRouter } from "next/navigation";
import { UserRound } from "lucide-react";

export function PersonPicker({
  people,
  selectedId,
  ownId,
  basePath = "/scorecard",
  extraParams,
}: {
  people: Array<{ id: string; name: string }>;
  selectedId: string;
  ownId: string;
  /** Reports embeds this same picker as its own tab (owner's instruction) and
   *  must stay on /reports, not bounce out to the standalone route. Defaults
   *  to /scorecard so the original caller is unchanged. */
  basePath?: string;
  /** Carried along on every navigation this picker makes — Reports passes
   *  `{ tab: "scorecard" }` so picking a person does not drop back to the
   *  queue tab. */
  extraParams?: Record<string, string>;
}) {
  const router = useRouter();

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-card bg-surface px-4 py-3">
      <label
        htmlFor="scorecard-person"
        className="flex items-center gap-1.5 text-body-sm font-medium text-ink"
      >
        <UserRound aria-hidden className="size-4 text-ink-muted" />
        Whose scorecard
      </label>

      <select
        id="scorecard-person"
        value={selectedId}
        onChange={(e) => {
          // Own card drops the `person` parameter entirely, so the plain
          // basePath stays the canonical URL for "mine" and the sidebar link
          // matches it exactly.
          const next = e.target.value;
          const params = new URLSearchParams(extraParams);
          if (next !== ownId) params.set("person", next);
          const qs = params.toString();
          router.push(qs ? `${basePath}?${qs}` : basePath);
        }}
        className="h-10 min-w-[220px] rounded-control border border-border bg-canvas px-3 text-body-sm text-ink"
      >
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
            {person.id === ownId ? " (you)" : ""}
          </option>
        ))}
      </select>

      <p className="text-body-xs text-ink-muted">
        Everyone on staff. The full roster with stages and scores is under Team review.
      </p>
    </div>
  );
}
