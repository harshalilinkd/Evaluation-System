-- 0053 — a supervisor can read the name of anybody they were assigned to rate.
--
-- THE BUG. The shop-floor list showed five rows reading "Worker" with an em
-- dash for the code — every name blank.
--
-- `profiles` admits a read when `reports_to = auth.uid()` (0041). That is the
-- STAFF relationship, and it is not the one this module uses: a worker's rater
-- is chosen PER ROUND and stored on `worker_evaluations.supervisor_id`, and the
-- Start-a-round dialog deliberately lets HR change it away from the worker's
-- Reports-to — the whole point being that a field set once on a profile, for a
-- different purpose, should not silently decide who appraises somebody.
--
-- So the moment HR picks a rater who is not the worker's `reports_to`, that
-- supervisor is assigned an appraisal for a person whose name they cannot read.
-- The query returns the evaluation and the profile lookup returns nothing, and
-- the screen falls back to the word "Worker" — which reads as broken data
-- rather than as a permission boundary.
--
-- THE GRANT IS AS NARROW AS THE RELATIONSHIP. Not "supervisors may read
-- profiles": one row, for as long as they are the assigned rater on a live
-- appraisal of that person. It carries no salary — §5's figures live in
-- `employment_records` and `worker_evaluation_decisions`, neither of which this
-- touches — and it ends when the assignment does.

begin;

/* -- SECURITY DEFINER for the reason P5-7 gives: a policy on `profiles` that
      queried `profiles` would recurse. This reads `worker_evaluations` only, so
      it cannot — but it is a definer function anyway, because the policy must
      not depend on the caller's own visibility of the appraisal row. -- */
create or replace function public.is_my_worker(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.worker_evaluations we
     where we.worker_id = p_profile_id
       and we.supervisor_id = (select auth.uid())
       and we.excluded_at is null
  );
$$;

revoke all on function public.is_my_worker(uuid) from public;
grant execute on function public.is_my_worker(uuid) to authenticated;

drop policy if exists "profiles: read self, reports, my lead, or all as HR/MD" on public.profiles;
/* -- And the name this file itself creates.
      Dropping only the OLD name meant a second run failed with "policy already
      exists" — which is what a half-finished apply chain produces every time
      somebody re-runs it. A migration that cannot be run twice is a migration
      that punishes recovering from an error. -- */
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
    -- New: the worker module's per-round assignment.
    or public.is_my_worker(id)
  );

commit;
