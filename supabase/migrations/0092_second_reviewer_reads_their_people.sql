-- 0092 · A second reviewer may read the profile of somebody they rate.
--
-- THE BUG, AS REPORTED. The Design Coordinator opens My Team and the person
-- they are there to rate is called "Unknown" — no name, no employee code, no
-- designation. Their reporting manager opens the same screen and sees "Manav
-- Khandale · MA-36 · Designer · Design".
--
-- WHY ONLY THE NAME WAS MISSING, which is the tell. The department rendered
-- correctly for both of them, because `getTeamQueue` takes it from
-- `evaluations.department_id` — a row the second reviewer may read. The name,
-- the employee code and the designation come from `profiles`, and
-- `team-queue.ts` falls back to the literal string "Unknown" when that row is
-- absent. So the evaluation was visible and the person was not.
--
-- THE CAUSE. The `profiles` read policy admits five things (0041, 0053):
--
--   id = auth.uid()                 yourself
--   is_hr() / is_md()               HR and the MD see everyone
--   reports_to = auth.uid()         the people who report to YOU
--   is_my_lead(id)                  your own manager (0041, FIX-18)
--   is_my_worker(id)                a worker assigned to you this round (0053)
--
-- 0083 added `co_reviewer_id` and the third rating layer, and every screen that
-- needed it — but nothing was ever added HERE. A second reviewer is not the
-- evaluatee's `reports_to`, so no clause matched them, and the read came back
-- empty rather than refused. RLS hides a row; it does not announce it.
--
-- WHY THIS IS SAFE, and it is the argument FIX-18 already made from the other
-- side (F18-3). §5's blindness is about the LEAD and SELF LAYERS — what each
-- side ANSWERED. A name is not an answer. The second reviewer is rating this
-- person on their own form and has to know who they are; withholding the name
-- discloses nothing and breaks the screen. No layer, no score and no salary is
-- reachable through this clause.
--
-- THE CLAUSE IS AS NARROW AS `reports_to`, deliberately: it matches the exact
-- rows where this caller is the recorded second reviewer, and nothing else. A
-- second reviewer still sees no other profile in the company.
--
-- ============================================================================
-- THE LIVE DATABASE ALREADY HAS THIS ARM. THIS FILE IS STILL REQUIRED.
--
-- Checked directly: the deployed policy on `profiles` already reads
-- `… OR (co_reviewer_id = (SELECT auth.uid()))`, so applying this changes
-- nothing there — it is idempotent and safe to run either way.
--
-- It belongs in the chain regardless. Without it, anybody rebuilding from
-- migrations gets 0053's version of the policy, which has no second-reviewer
-- clause — so the fix would silently disappear on the next rebuild and the
-- "Unknown" bug would come back. A repair that exists only in a running
-- database and not in the migration that creates the object is a repair with a
-- half-life.
--
-- ON THE SCHEMA. This says `public.`, as all 91 migrations before it do. The
-- deployment puts these tables in an `evaluation` schema (see
-- `lib/supabase/config.ts`), so the chain and the deployment differ — that is a
-- standing discrepancy across the whole set, not something this file
-- introduces, and it is recorded in §18 rather than being papered over here.
-- Whatever process applies the other 91 applies this one the same way.
-- ============================================================================

begin;

/* -- The whole policy is restated, not amended, because Postgres has no way to
      add a clause to one. Every existing arm is reproduced verbatim from 0053 —
      dropping one here would silently REMOVE access rather than fail, which is
      the class of mistake SR2-5 caught in a view. The verification block below
      counts the arms afterwards rather than trusting this. -- */
drop policy if exists "profiles: read self, reports, my lead, my workers, or all as HR/MD" on public.profiles;

create policy "profiles: read self, reports, my lead, my workers, or all as HR/MD"
  on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or public.is_hr()
    or public.is_md()
    or reports_to = (select auth.uid())
    or public.is_my_lead(id)
    or public.is_my_worker(id)
    -- New (0092): somebody this caller is the SECOND REVIEWER for. Exactly the
    -- shape of the `reports_to` arm above, and exactly as narrow.
    or co_reviewer_id = (select auth.uid())
  );

/* -- Prove it, rather than assume it. A policy that silently lost an arm looks
      identical to one that works, because the arm anybody would test is their
      own. -- */
do $$
declare
  v_using text;
begin
  select pg_get_expr(pol.polqual, pol.polrelid)
    into v_using
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
   where c.relname = 'profiles'
     and pol.polname = 'profiles: read self, reports, my lead, my workers, or all as HR/MD';

  if v_using is null then
    raise exception '0092: the profiles read policy is missing after the rewrite.';
  end if;

  if position('co_reviewer_id' in v_using) = 0 then
    raise exception '0092: the second-reviewer arm is not in the installed policy.';
  end if;

  -- Every arm that was there before must still be there.
  if position('reports_to' in v_using) = 0 then
    raise exception '0092: the reports_to arm was lost.';
  end if;
  if position('is_my_lead' in v_using) = 0 then
    raise exception '0092: the is_my_lead arm (0041) was lost.';
  end if;
  if position('is_my_worker' in v_using) = 0 then
    raise exception '0092: the is_my_worker arm (0053) was lost.';
  end if;
  if position('is_hr' in v_using) = 0 or position('is_md' in v_using) = 0 then
    raise exception '0092: the HR/MD arm was lost.';
  end if;

  raise notice '0092: a second reviewer can now read the profile of somebody they rate.';
  raise notice '0092: every earlier arm of the policy is intact.';
end;
$$;

commit;
