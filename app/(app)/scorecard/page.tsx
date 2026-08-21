/** /scorecard — your own scorecard, or anybody's if you administer the system. */

import type { Metadata } from "next";

import { ScorecardPanel } from "@/app/(app)/scorecard/scorecard-panel";
import { requireAuth } from "@/lib/auth/guards";
import { ADMIN_ROLES } from "@/lib/auth/roles";

export const metadata: Metadata = { title: "Scorecard" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ person?: string }>;
}) {
  const { profile, roles } = await requireAuth();
  const requested = (await searchParams).person;

  const privileged = roles.some((role) => (ADMIN_ROLES as readonly string[]).includes(role));

  /* -- Whose card this is.
        An administrator may ask for anybody; everybody else gets their own, and
        a `?person=` they are not entitled to is ignored rather than refused —
        answering "you may not see that person" would turn the query string into
        a way to find out who exists. RLS is what actually decides what the page
        can read (P16-9); this only picks the subject. -- */
  const subjectId = privileged && requested ? requested : profile.id;

  return (
    <div className="mx-auto w-full max-w-content space-y-4">
      <ScorecardPanel viewerId={profile.id} subjectId={subjectId} privileged={privileged} />
    </div>
  );
}
