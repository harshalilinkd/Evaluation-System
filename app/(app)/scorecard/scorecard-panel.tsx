/** The actual scorecard content — shared by /scorecard and Reports' own tab. */

import { notFound } from "next/navigation";

import { PersonPicker } from "@/app/(app)/scorecard/person-picker";
import { WorkerScorecardCard } from "@/app/(app)/scorecard/worker-card";
import { ScorecardClient } from "@/app/(app)/people/[profileId]/scorecard/scorecard-client";
import { getScorecard } from "@/lib/analytics/queries";
import { getWorkerScorecard } from "@/lib/worker/scorecard";
import { createClient } from "@/lib/supabase/server";

/**
 * Extracted out of /scorecard/page.tsx so Reports can show the same thing as
 * its own tab, at the owner's instruction, without a second implementation of
 * the worker/staff branch and the picker. Two copies of "which card to draw"
 * is how they drift — a card that looks right on one screen and wrong on the
 * other is worse than the extra import.
 *
 * `viewerId` is who is LOOKING (whose own card `isSelf` and the scoring
 * queries compare against); `subjectId` is whose card it is. `privileged`
 * decides whether the picker renders — Reports always passes true, since its
 * own guard already restricts the whole page to HR_ADMIN/MD.
 */
export async function ScorecardPanel({
  viewerId,
  subjectId,
  privileged,
  basePath,
  extraParams,
}: {
  viewerId: string;
  subjectId: string;
  privileged: boolean;
  /** Forwarded to the picker, so Reports' embedded copy stays on /reports
   *  rather than bouncing to the standalone route (person-picker.tsx). */
  basePath?: string;
  extraParams?: Record<string, string>;
}) {
  const isSelf = subjectId === viewerId;
  const supabase = await createClient();

  /* -- WHICH MODULE THIS PERSON IS IN.
        Every one of P16's six views filters `track = 'STAFF'` (P16-6), so a
        production worker read through the staff query got a page of em dashes
        — which reads as broken rather than as "you are on the other form".
        §7 forbids refactoring a staff function to serve the worker module, so
        the two cards are two cards; this picks between them.

        Read through the authenticated client, so RLS decides whether the
        track is legible at all — an administrator sees anybody's, a worker
        their own. -- */
  const { data: subject } = await supabase
    .from("profiles")
    .select("track, full_name")
    .eq("id", subjectId)
    .maybeSingle();

  if (subject?.track === "WORKER") {
    const workerCard = await getWorkerScorecard(subjectId);
    return (
      <WorkerScorecardCard card={workerCard} isSelf={isSelf} name={subject.full_name ?? "This worker"} />
    );
  }

  const card = await getScorecard(subjectId, viewerId);
  if (!card.ok) notFound();

  // The picker is the whole reason this route exists alongside the roster: an
  // administrator who wants to compare two people should not have to go back
  // to a list between them.
  const { data: people } = privileged
    ? await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("is_active", true)
        .eq("track", "STAFF")
        .order("full_name")
    : { data: null };

  return (
    <>
      {privileged && people ? (
        <PersonPicker
          people={people.map((p) => ({ id: p.id, name: p.full_name }))}
          selectedId={subjectId}
          ownId={viewerId}
          basePath={basePath}
          extraParams={extraParams}
        />
      ) : null}

      <ScorecardClient card={card.data} isSelf={isSelf} />
    </>
  );
}
