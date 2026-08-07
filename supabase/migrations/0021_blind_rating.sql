-- 0021_blind_rating.sql
-- AMEND-3: revoke cross-layer reads. The lead and the employee rate blind.
--
-- THIS MIGRATION REMOVES CAPABILITY THAT WORKS TODAY. That is the intent.
-- Until now a lead could read their report's self answers — P13 built a whole
-- screen around it. §1 as amended makes that the thing we are measuring
-- against: "a HOD who can see a 5 has a strong pull toward not writing a 2".
--
-- TWO CORRECTIONS TO THE BRIEF, both flagged rather than absorbed:
--
--   1. The brief names this file `0014_blind_rating.sql`. 0014 is
--      `0014_md_finalise.sql` and has been applied. §0.8: numbering is
--      sequential and an applied migration is never edited. Renumbered, not
--      renamed — the same call as 0010, 0015 and 0017.
--
--   2. The brief says to drop "the RLS policy added in 0013 that lets a lead
--      read the SELF layer". **0013 does not touch `evaluation_responses` at
--      all** — it adds one SELECT policy on `audit_log` and nothing else. The
--      lead's SELF-layer read comes from 0005's `responses: read SELF layer`,
--      which gates on `can_see_evaluation()`, and that helper includes the
--      lead. That is what is revoked below. The intent is unchanged; the
--      target was misidentified.
--
-- SAFE TO RE-RUN.

begin;

/* ============================================================================
   0a. New columns
   ========================================================================== */
--
-- FIRST, because the helpers below read `self_skipped` and `lead_skipped`.

alter table public.evaluations
  add column if not exists self_skipped  boolean not null default false,
  add column if not exists lead_skipped  boolean not null default false,
  -- Which layers HR sent back, as 'SELF', 'LEAD' or 'BOTH'. Text rather than an
  -- enum: §8 names exactly three values and a fourth would be a state-machine
  -- change, not a data change, so it should require a migration to introduce.
  add column if not exists returned_to   text null;

alter table public.evaluations
  drop constraint if exists evaluations_returned_to_valid;
alter table public.evaluations
  add constraint evaluations_returned_to_valid
  check (returned_to is null or returned_to in ('SELF', 'LEAD', 'BOTH'));

comment on column public.evaluations.self_skipped is
  'HR advanced the record with no self submission. §8: the missing layer is marked skipped, never silently treated as complete.';
comment on column public.evaluations.lead_skipped is
  'HR advanced the record with no lead submission.';
comment on column public.evaluations.returned_to is
  'Which layers the last HR return unlocked: SELF, LEAD or BOTH.';

/* ============================================================================
   0b. Layer-open helpers
   ========================================================================== */
--
-- Defined FIRST: the policies below call them, and Postgres resolves a
-- function reference when the policy is created, not when it runs.
--
-- SECURITY DEFINER for the same reason as every other helper here (P5-7): a
-- policy on evaluation_responses that reads `evaluations` would otherwise be
-- filtered by the policies it is helping to evaluate.
--
-- A layer is open when it has not been submitted. `self_skipped` closes it too:
-- HR advancing past a missing layer must not leave it writable, or somebody
-- fills in a form for a record that has already gone to review.

create or replace function public.self_open(evaluation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.evaluations e
     where e.id = self_open.evaluation_id
       and e.self_submitted_at is null
       and not e.self_skipped
  );
$$;

create or replace function public.lead_open(evaluation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.evaluations e
     where e.id = lead_open.evaluation_id
       and e.lead_submitted_at is null
       and not e.lead_skipped
  );
$$;

grant execute on function public.self_open(uuid) to authenticated;
grant execute on function public.lead_open(uuid) to authenticated;


/* ============================================================================
   1. Blindness — the SELF layer
   ========================================================================== */
--
-- `can_see_evaluation()` is deliberately left alone: it is the truthful answer
-- to "may this person see that this evaluation exists", which the lead still
-- may. What changes is that seeing the record no longer implies reading both
-- sides of it. Narrowing the helper instead would have silently changed every
-- other policy that calls it.

drop policy if exists "responses: read SELF layer" on public.evaluation_responses;

create policy "responses: read SELF layer" on public.evaluation_responses
  for select to authenticated
  using (
    layer = 'SELF'
    and (
      public.is_evaluatee(evaluation_id)   -- their own answers, always
      or public.is_hr()
      or public.is_md()
    )
    -- The lead is ABSENT on purpose. §5's blindness invariant: no policy may
    -- expose the SELF layer to the lead at any status, including CLOSED.
  );

/* ---------- The evaluatee writes their own layer while it is open ---------- */
--
-- Rewritten for §8's new statuses. Both layers are now open at the same time
-- under one status, so the gate is the LAYER'S OWN timestamp rather than the
-- record's status — which is exactly what "a layer locks on its own
-- submission, independently of the other layer" means in SQL.

drop policy if exists "responses: evaluatee drafts SELF" on public.evaluation_responses;
drop policy if exists "responses: evaluatee edits SELF while open" on public.evaluation_responses;

create policy "responses: evaluatee drafts SELF" on public.evaluation_responses
  for insert to authenticated
  with check (
    layer = 'SELF'
    and public.is_evaluatee(evaluation_id)
    and public.evaluation_status_of(evaluation_id) = 'OPEN'
    and public.self_open(evaluation_id)
  );

create policy "responses: evaluatee edits SELF while open" on public.evaluation_responses
  for update to authenticated
  using (
    layer = 'SELF'
    and public.is_evaluatee(evaluation_id)
    and public.evaluation_status_of(evaluation_id) = 'OPEN'
    and public.self_open(evaluation_id)
  )
  with check (
    layer = 'SELF'
    and public.is_evaluatee(evaluation_id)
    and public.evaluation_status_of(evaluation_id) = 'OPEN'
    and public.self_open(evaluation_id)
  );

/* ============================================================================
   2. Blindness — the LEAD layer
   ========================================================================== */
--
-- The evaluatee branch is GONE. 0005 admitted the employee to their lead's raw
-- answers once the cycle was CLOSED under FULL disclosure; AMEND-3 item 3 is
-- explicit that no policy may grant that at any status. If lead narrative ever
-- needs to reach an employee it goes through a curated report field, which is
-- a deliberate act of authoring — not a raw layer leaking on a status change.

drop policy if exists "responses: read LEAD layer" on public.evaluation_responses;

create policy "responses: read LEAD layer" on public.evaluation_responses
  for select to authenticated
  using (
    layer = 'LEAD'
    and (
      public.is_lead_of_evaluation(evaluation_id)   -- their own answers
      or public.is_hr()
      or public.is_md()
    )
  );

drop policy if exists "responses: lead drafts LEAD" on public.evaluation_responses;
drop policy if exists "responses: lead edits LEAD while reviewing" on public.evaluation_responses;

create policy "responses: lead drafts LEAD" on public.evaluation_responses
  for insert to authenticated
  with check (
    layer = 'LEAD'
    and public.is_lead_of_evaluation(evaluation_id)
    and public.evaluation_status_of(evaluation_id) = 'OPEN'
    and public.lead_open(evaluation_id)
  );

create policy "responses: lead edits LEAD while reviewing" on public.evaluation_responses
  for update to authenticated
  using (
    layer = 'LEAD'
    and public.is_lead_of_evaluation(evaluation_id)
    and public.evaluation_status_of(evaluation_id) = 'OPEN'
    and public.lead_open(evaluation_id)
  )
  with check (
    layer = 'LEAD'
    and public.is_lead_of_evaluation(evaluation_id)
    and public.evaluation_status_of(evaluation_id) = 'OPEN'
    and public.lead_open(evaluation_id)
  );

/* ============================================================================
   5. Status migration
   ========================================================================== */
--
-- Counted before and after, and the totals compared. A status migration that
-- loses a row is the kind of thing nobody notices until a cycle will not close.

do $$
declare
  v_before int;
  v_after  int;
  v_report text;
begin
  select count(*) into v_before from public.evaluations;

  select string_agg(status::text || '=' || n::text, ', ' order by status::text)
    into v_report
    from (select status, count(*) n from public.evaluations group by status) x;
  raise notice '0021 BEFORE: % rows — %', v_before, coalesce(v_report, '(none)');

  -- Both of the old in-flight statuses become OPEN: the two layers are now
  -- open together, so "the employee has submitted" is no longer a status at
  -- all — it is `self_submitted_at`, which is already set on those rows.
  update public.evaluations set status = 'OPEN'
   where status in ('CYCLE_ACTIVE', 'SELF_SUBMITTED');

  update public.evaluations set status = 'PENDING_HR_REVIEW'
   where status = 'LEAD_REVIEWED';

  update public.evaluations set status = 'MD_REVIEWED'
   where status = 'MD_FINALIZED';

  -- DRAFT and CLOSED are unchanged: both are still live in the new machine.

  select count(*) into v_after from public.evaluations;
  select string_agg(status::text || '=' || n::text, ', ' order by status::text)
    into v_report
    from (select status, count(*) n from public.evaluations group by status) x;
  raise notice '0021 AFTER:  % rows — %', v_after, coalesce(v_report, '(none)');

  if v_before <> v_after then
    raise exception '0021: row count changed during status migration (% -> %)', v_before, v_after;
  end if;

  if exists (
    select 1 from public.evaluations
     where status in ('CYCLE_ACTIVE', 'SELF_SUBMITTED', 'LEAD_REVIEWED', 'MD_FINALIZED')
  ) then
    raise exception '0021: rows still carry a retired status after migration.';
  end if;
end $$;

/* ---------- New rows may only use the new set ---------- */
--
-- The retired values stay in the enum — AMEND-3 forbids dropping one that
-- historical rows carry, and an audit_log diff quoting 'SELF_SUBMITTED' is
-- exactly such a row. The CHECK is what retires them: readable forever,
-- writable never.

alter table public.evaluations
  drop constraint if exists evaluations_status_current;
alter table public.evaluations
  add constraint evaluations_status_current
  check (status in ('DRAFT', 'OPEN', 'PENDING_HR_REVIEW', 'HR_APPROVED',
                    'MD_REVIEWED', 'INTERVIEW_DONE', 'CLOSED'));

comment on constraint evaluations_status_current on public.evaluations is
  'AMEND-3: the four pre-blind statuses remain in the enum for historical rows and audit diffs, but no new row may use one.';

/* ============================================================================
   6. The transition RPC — §8 as amended
   ========================================================================== */
--
-- P5-1: this function is granted to `authenticated`, so any signed-in user can
-- call it through PostgREST with arguments of their choosing. The CASE below is
-- §8's table re-checked in SQL, and it must change with the TypeScript half or
-- one of them is a hole. Both change here.
--
-- AMEND-2 reversed the HR/MD merge, so `is_admin()` is gone from every gate in
-- this function and each row names the specific role §9 gives it.
--
-- OPEN -> OPEN is two different transitions sharing a pair of statuses: a layer
-- submission no longer moves the record. `p_lock_layer` is what tells them
-- apart, which is also what makes "a layer locks on its own submission,
-- independently of the other" true in the database rather than in the UI.
--
-- NOT ENFORCED HERE: §8 scopes MD_REVIEWED -> CLOSED to EVALUATION cycles and
-- MD_REVIEWED -> INTERVIEW_DONE to INCREMENT cycles. `evaluation_cycles` has no
-- `cycle_type` column yet — AMEND-2 introduced the idea, no migration has added
-- the column, and §0.4 forbids inventing one. Both moves are therefore
-- permitted at this layer until the column exists. Recorded rather than faked.

create or replace function public.apply_evaluation_transition(
  p_evaluation_id    uuid,
  p_from_status      public.evaluation_status,
  p_to_status        public.evaluation_status,
  p_actor_id         uuid,
  p_action           text,
  p_reason           text default null,
  p_diff             jsonb default null,
  p_evaluation_patch jsonb default '{}'::jsonb,
  p_lock_layer       public.rating_layer default null,
  p_unlock_layer     public.rating_layer default null,
  p_answers          jsonb default null,
  p_section_scores   jsonb default null,
  p_overall_score    numeric default null
)
returns uuid
language plpgsql
as $fn$
declare
  v_audit_id   uuid;
  v_updated    integer;
  v_caller     uuid := (select auth.uid());
  v_evaluatee  uuid;
  v_lead       uuid;
  v_status     public.evaluation_status;
  v_is_system  boolean := v_caller is null;
  v_allowed    boolean;
begin
  select e.evaluatee_id, e.lead_id, e.status
    into v_evaluatee, v_lead, v_status
  from public.evaluations e
  where e.id = p_evaluation_id;

  if not found then
    raise exception 'No evaluation with id %.', p_evaluation_id
      using errcode = 'no_data_found';
  end if;

  if not v_is_system and p_actor_id is distinct from v_caller then
    raise exception 'You cannot record a transition on behalf of another user.'
      using errcode = 'insufficient_privilege';
  end if;

  v_allowed := case
    when p_from_status = 'DRAFT' and p_to_status = 'OPEN'
      then public.is_hr() or v_is_system

    -- A layer submission. The record does not move; the layer locks.
    when p_from_status = 'OPEN' and p_to_status = 'OPEN' and p_lock_layer = 'SELF'
      then v_caller = v_evaluatee
    when p_from_status = 'OPEN' and p_to_status = 'OPEN' and p_lock_layer = 'LEAD'
      then v_caller = v_lead

    -- Both layers in (system), or HR advancing past a missing one.
    when p_from_status = 'OPEN' and p_to_status = 'PENDING_HR_REVIEW'
      then public.is_hr() or v_is_system

    when p_from_status = 'PENDING_HR_REVIEW' and p_to_status = 'OPEN'
      then public.is_hr()
    when p_from_status = 'PENDING_HR_REVIEW' and p_to_status = 'HR_APPROVED'
      then public.is_hr()

    -- The MD's rows. §9 gives the MD the review and the approval; HR cannot
    -- stand in for them, which is the second pair of eyes AMEND-2 restored.
    when p_from_status = 'HR_APPROVED' and p_to_status = 'PENDING_HR_REVIEW'
      then public.is_md()
    when p_from_status = 'HR_APPROVED' and p_to_status = 'MD_REVIEWED'
      then public.is_md()
    when p_from_status = 'MD_REVIEWED' and p_to_status = 'HR_APPROVED'
      then public.is_md()

    when p_from_status = 'MD_REVIEWED' and p_to_status = 'CLOSED'
      then public.is_hr() or v_is_system
    when p_from_status = 'MD_REVIEWED' and p_to_status = 'INTERVIEW_DONE'
      then public.is_hr() or public.is_md()
    when p_from_status = 'INTERVIEW_DONE' and p_to_status = 'CLOSED'
      then public.is_hr() or v_is_system

    else false
  end;

  if not v_allowed then
    raise exception 'You are not permitted to move this evaluation from % to %.', p_from_status, p_to_status
      using errcode = 'insufficient_privilege';
  end if;

  perform set_config('app.transition_evaluation', p_evaluation_id::text, true);

  update public.evaluations e
  set status = p_to_status,
      self_submitted_at = case when p_evaluation_patch ? 'self_submitted_at'
        then (p_evaluation_patch ->> 'self_submitted_at')::timestamptz else e.self_submitted_at end,
      lead_submitted_at = case when p_evaluation_patch ? 'lead_submitted_at'
        then (p_evaluation_patch ->> 'lead_submitted_at')::timestamptz else e.lead_submitted_at end,
      md_finalized_at = case when p_evaluation_patch ? 'md_finalized_at'
        then (p_evaluation_patch ->> 'md_finalized_at')::timestamptz else e.md_finalized_at end,
      closed_at = case when p_evaluation_patch ? 'closed_at'
        then (p_evaluation_patch ->> 'closed_at')::timestamptz else e.closed_at end,
      self_overall = case when p_evaluation_patch ? 'self_overall'
        then (p_evaluation_patch ->> 'self_overall')::numeric else e.self_overall end,
      lead_overall = case when p_evaluation_patch ? 'lead_overall'
        then (p_evaluation_patch ->> 'lead_overall')::numeric else e.lead_overall end,
      final_overall = case when p_evaluation_patch ? 'final_overall'
        then (p_evaluation_patch ->> 'final_overall')::numeric else e.final_overall end,
      -- AMEND-3's three. `skipped` records that HR advanced past a layer, which
      -- §8 requires be marked rather than left looking complete.
      self_skipped = case when p_evaluation_patch ? 'self_skipped'
        then (p_evaluation_patch ->> 'self_skipped')::boolean else e.self_skipped end,
      lead_skipped = case when p_evaluation_patch ? 'lead_skipped'
        then (p_evaluation_patch ->> 'lead_skipped')::boolean else e.lead_skipped end,
      returned_to = case when p_evaluation_patch ? 'returned_to'
        then nullif(p_evaluation_patch ->> 'returned_to', '') else e.returned_to end
  where e.id = p_evaluation_id
    and e.status = p_from_status;

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    raise exception
      'Evaluation % is not in status % any more. Someone else may have moved it; reload and try again.',
      p_evaluation_id, p_from_status
      using errcode = 'serialization_failure';
  end if;

  if p_lock_layer is not null then
    insert into public.evaluation_responses (
      evaluation_id, layer, answers, submitted_at, submitted_by, section_scores, overall_score
    )
    values (
      p_evaluation_id, p_lock_layer, coalesce(p_answers, '{}'::jsonb),
      now(), p_actor_id, p_section_scores, p_overall_score
    )
    on conflict (evaluation_id, layer) do update set
      answers        = case when p_answers is null then public.evaluation_responses.answers else p_answers end,
      submitted_at   = now(),
      submitted_by   = p_actor_id,
      section_scores = excluded.section_scores,
      overall_score  = excluded.overall_score;
  end if;

  if p_unlock_layer is not null then
    update public.evaluation_responses
    set submitted_at = null, submitted_by = null, section_scores = null, overall_score = null
    where evaluation_id = p_evaluation_id and layer = p_unlock_layer;
  end if;

  insert into public.audit_log (
    actor_id, entity, entity_id, action, from_status, to_status, diff, reason
  )
  values (
    p_actor_id, 'evaluation', p_evaluation_id, p_action,
    p_from_status::text, p_to_status::text, p_diff, p_reason
  )
  returning id into v_audit_id;

  return v_audit_id;
end;
$fn$;

commit;
