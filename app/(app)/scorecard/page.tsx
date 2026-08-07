/** /scorecard — your own scorecard, or anybody's if you administer the system. */

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PersonPicker } from "@/app/(app)/scorecard/person-picker";
import { ScorecardClient } from "@/app/(app)/people/[profileId]/scorecard/scorecard-client";
import { requireAuth } from "@/lib/auth/guards";
import { ADMIN_ROLES } from "@/lib/auth/roles";
import { getScorecard } from "@/lib/analytics/queries";
import { createClient } from "@/lib/supabase/server";

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
  const isSelf = subjectId === profile.id;

  const card = await getScorecard(subjectId, profile.id);
  if (!card.ok) notFound();

  // The picker is the whole reason this route exists alongside the roster: an
  // administrator who wants to compare two people should not have to go back to
  // a list between them.
  const { data: people } = privileged
    ? await createClient()
        .then((supabase) =>
          supabase
            .from("profiles")
            .select("id, full_name")
            .eq("is_active", true)
            .eq("track", "STAFF")
            .order("full_name"),
        )
    : { data: null };

  return (
    <div className="mx-auto w-full max-w-content space-y-4">
      {privileged && people ? (
        <PersonPicker
          people={people.map((p) => ({ id: p.id, name: p.full_name }))}
          selectedId={subjectId}
          ownId={profile.id}
        />
      ) : null}

      <ScorecardClient card={card.data} isSelf={isSelf} />
    </div>
  );
}
