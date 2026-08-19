-- 0083 · A second manager: the columns, the access, and the completion rule.
--
-- Requires 0082, which adds the enum value this file USES.
--
-- ============================================================================
-- IT IS NOT "DESIGNERS". IT IS "HAS A SECOND REVIEWER".
-- ============================================================================
-- The request is about Designers, who are rated by a Team Leader and a Design
-- Coordinator. Hardcoding that would put a department name into the schema and
-- into every query that reads it — and §0.2 then freezes it, so the first other
-- team that wants the same arrangement needs a migration rather than a setting.
--
-- The rule is data instead: a person may carry a SECOND REVIEWER, and anybody
-- who does gets three forms. Setting it on the designers produces exactly the
-- requested behaviour; leaving it null leaves everybody else on the two-form
-- flow, which is the default and stays the default.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'lead_open') then
    raise exception '0083 requires 0021 (lead_open / self_open). Apply it first.';
  end if;
end $$;

/* ---------- 1 · Who the second reviewer is ---------- */
-- On `profiles`, beside `reports_to`, because it is the same KIND of fact: who
-- rates this person. A self-FK for the same reason `reports_to` is one.
alter table public.profiles
  add column if not exists co_reviewer_id uuid references public.profiles(id);

comment on column public.profiles.co_reviewer_id is
  'A SECOND manager who rates this person independently of reports_to. Null for almost everybody. Set for Designers, whose Design Coordinator rates them alongside their Team Leader. Anybody with one gets a third form at launch.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_co_reviewer_not_self'
  ) then
    -- Rating yourself is not a second opinion, and it would hand one person
    -- both sides of a blind pair (§5).
    alter table public.profiles
      add constraint profiles_co_reviewer_not_self check (co_reviewer_id <> id);
  end if;
end $$;

/* ---------- 2 · The layer, on the evaluation ---------- */
-- COPIED AT LAUNCH, exactly as `lead_id` is (P3-6): a reorganisation mid-cycle
-- must not silently reassign a review that is already being written.
alter table public.evaluations
  add column if not exists co_lead_id uuid,
  add column if not exists co_lead_submitted_at timestamptz,
  add column if not exists co_lead_skipped boolean not null default false;

comment on column public.evaluations.co_lead_id is
  'The second manager for THIS evaluation, frozen at launch. Null on the ordinary two-form flow, and the presence of it is what makes an evaluation need three submissions rather than two.';

/* ---------- 3 · Who they are, and whether their layer is open ---------- */
create or replace function public.is_co_lead_of_evaluation(evaluation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.evaluations e
    where e.id = evaluation_id
      and e.co_lead_id = (select auth.uid())
  );
$$;

-- Mirrors `lead_open` exactly. A layer locks on ITS OWN submission (§8, A3-3),
-- independently of the other two — and `co_lead_skipped` closes it too, so HR
-- advancing past a missing second opinion does not leave it writable.
create or replace function public.co_lead_open(evaluation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.evaluations e
     where e.id = co_lead_open.evaluation_id
       and e.co_lead_submitted_at is null
       and not e.co_lead_skipped
  );
$$;

grant execute on function public.is_co_lead_of_evaluation(uuid) to authenticated;
grant execute on function public.co_lead_open(uuid) to authenticated;

/* ---------- 4 · Access, mirroring the lead's own policies ---------- */
-- BLIND TO EACH OTHER, and that is the point of two opinions. The request says
-- both evaluators submit independently; §5 already says no layer may read
-- another. So the co-lead reads LEAD_2 and nothing else, exactly as the lead
-- reads LEAD and nothing else — neither sees the employee's answers, and
-- neither sees the other manager's.
drop policy if exists "responses: read LEAD_2 layer" on public.evaluation_responses;
create policy "responses: read LEAD_2 layer" on public.evaluation_responses
  for select to authenticated
  using (
    layer = 'LEAD_2'
    and (
      public.is_co_lead_of_evaluation(evaluation_id)
      or public.is_hr()
      or public.is_md()
    )
  );

drop policy if exists "responses: co-lead drafts LEAD_2" on public.evaluation_responses;
create policy "responses: co-lead drafts LEAD_2" on public.evaluation_responses
  for insert to authenticated
  with check (
    layer = 'LEAD_2'
    and public.is_co_lead_of_evaluation(evaluation_id)
    and public.evaluation_status_of(evaluation_id) = 'OPEN'
    and public.co_lead_open(evaluation_id)
  );

drop policy if exists "responses: co-lead edits LEAD_2 while reviewing" on public.evaluation_responses;
create policy "responses: co-lead edits LEAD_2 while reviewing" on public.evaluation_responses
  for update to authenticated
  using (
    layer = 'LEAD_2'
    and public.is_co_lead_of_evaluation(evaluation_id)
    and public.evaluation_status_of(evaluation_id) = 'OPEN'
    and public.co_lead_open(evaluation_id)
  );

-- Seeing that the evaluation EXISTS. `can_see_evaluation` is left alone (A3-1);
-- this adds the co-lead to the same set the lead is already in.
drop policy if exists "evaluations: co-lead reads their own" on public.evaluations;
create policy "evaluations: co-lead reads their own" on public.evaluations
  for select to authenticated
  using (co_lead_id = (select auth.uid()));

-- The frozen question list, so their form can render.
drop policy if exists "questions: co-lead reads the snapshot" on public.evaluation_questions;
create policy "questions: co-lead reads the snapshot" on public.evaluation_questions
  for select to authenticated
  using (public.is_co_lead_of_evaluation(evaluation_id));

/* ---------- 5 · Completion counts all three ---------- */
-- 0038 raises OPEN -> PENDING_HR_REVIEW when both sides are in. With a second
-- manager there are three, and advancing on two would lock the third out — the
-- layer gates on status OPEN, so the coordinator's form would close before they
-- had opened it.
--
-- WRITTEN AS "no outstanding layer" rather than as a longer AND, so an
-- evaluation with no co-lead behaves exactly as it does today: the third clause
-- is vacuously true when `co_lead_id` is null.
create or replace function public.raise_pending_hr_review()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if new.status = 'OPEN'
     and (new.self_submitted_at is not null or new.self_skipped)
     and (new.lead_submitted_at is not null or new.lead_skipped)
     and (
       new.co_lead_id is null
       or new.co_lead_submitted_at is not null
       or new.co_lead_skipped
     )
  then
    update public.evaluations
       set status = 'PENDING_HR_REVIEW'
     where id = new.id
       and status = 'OPEN';

    -- §12. No actor: the system raised it, and naming whoever happened to
    -- submit last would attribute a move they did not make.
    insert into public.audit_log (actor_id, entity, entity_id, action, from_status, to_status)
    values (null, 'evaluation', new.id, 'evaluation.both_layers_in', 'OPEN', 'PENDING_HR_REVIEW');
  end if;

  return null;
end;
$fn$;

-- The trigger must also fire when the SECOND manager submits, or a designer's
-- third form would land and nothing would notice.
drop trigger if exists raise_pending_hr_review on public.evaluations;
create trigger raise_pending_hr_review
  after update of self_submitted_at, lead_submitted_at, self_skipped, lead_skipped,
                 co_lead_submitted_at, co_lead_skipped
  on public.evaluations
  for each row execute function public.raise_pending_hr_review();

/* ---------- 6 · Nothing already running is disturbed ---------- */
-- Every existing evaluation has `co_lead_id` null, so the new clause is true
-- for all of them and the completion rule is byte-for-byte what it was.
do $$
declare v_open integer;
begin
  select count(*) into v_open
  from public.evaluations
  where status = 'OPEN' and co_lead_id is null;

  raise notice '0083 applied. % open evaluation(s) carry no second reviewer and are unaffected.', v_open;
end $$;
