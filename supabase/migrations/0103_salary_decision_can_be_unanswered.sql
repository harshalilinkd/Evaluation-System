-- 0103: "Same or New" can be UNANSWERED, so the screen stops preselecting Same.
--
-- ============================================================================
-- AT THE OWNER'S INSTRUCTION: "should not previously selected as same or new
-- anything".
--
-- The control looked pre-answered because the column could not say otherwise.
-- `salary_changed boolean not null default false` has exactly two states, and
-- the screen drew the false one as a chosen "Same" — so every supervisor opened
-- a form that had already made the cheaper of the two decisions for them, and
-- sending it on without touching it recorded a real answer nobody gave.
--
-- The same distinction the training tick has had since 0050, and for the same
-- reason: null is "not answered yet", which is a different fact from No and
-- must not default to it. §11's missing-is-not-zero, applied to a decision
-- rather than a score.
--
-- NOTHING CHANGES FOR AN EXISTING ROW. Every one of them holds `false`, and on
-- an appraisal already filed that IS the answer somebody gave — the control was
-- drawn as chosen and they sent it on. Backfilling those to null would erase a
-- decision rather than correct one.
--
-- The two writers stop coalescing, so an unanswered decision stays unanswered
-- rather than being recorded as Same on the way past. `submit_worker_review`
-- then refuses to send an unanswered one to HR, in the shape FIX-41 gives:
-- HR must not receive a recommendation with nothing in it.
-- ============================================================================

begin;

alter table public.worker_evaluation_decisions
  alter column salary_changed drop not null;

comment on column public.worker_evaluation_decisions.salary_changed is
  'Same (false) or New salary (true), and NULL where the supervisor has not answered yet — the same three states the training tick has, so the screen need not preselect one (0103).';

/* ---------- The supervisor's save stops answering for them ---------- */

create or replace function public.save_worker_review(
  p_evaluation_id   uuid,
  p_salary_changed  boolean,
  p_increment_pct   numeric,
  p_comment         text,
  p_training        boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_caller uuid := (select auth.uid());
  v_row    public.worker_evaluations%rowtype;
begin
  if not public.is_worker_reviewer_of(p_evaluation_id) then
    raise exception 'That appraisal is not yours to review.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from public.worker_evaluations where id = p_evaluation_id;

  if not found then
    raise exception 'That appraisal no longer exists.' using errcode = 'no_data_found';
  end if;

  -- PENDING_SUPERVISOR: it has been handed to them (0100).
  -- OPEN and they are also the rater: they are filling one form (0101).
  if not (
    v_row.status = 'PENDING_SUPERVISOR'
    or (v_row.status = 'OPEN' and v_row.supervisor_id = v_caller)
  ) then
    raise exception 'This appraisal is not with you - it is at %.', v_row.status
      using errcode = 'invalid_parameter_value';
  end if;

  if p_increment_pct is not null and (p_increment_pct <= 0 or p_increment_pct > 100) then
    raise exception 'A rise is between 0 and 100 per cent.' using errcode = 'check_violation';
  end if;

  insert into public.worker_evaluation_decisions
    (evaluation_id, salary_changed, increment_pct, supervisor_comment, training_required)
  values
    (p_evaluation_id,
     -- No coalesce: an unanswered decision stays unanswered rather than being
     -- recorded as "Same" on the way past (0103).
     p_salary_changed,
     -- "Same" means no figure, not a zero. A stored 0 would read as a rise of
     -- nothing rather than as a decision not to give one.
     case when p_salary_changed is true then p_increment_pct else null end,
     nullif(btrim(coalesce(p_comment, '')), ''), p_training)
  on conflict (evaluation_id) do update
     set salary_changed     = excluded.salary_changed,
         increment_pct      = excluded.increment_pct,
         supervisor_comment = excluded.supervisor_comment,
         training_required  = excluded.training_required;
end;
$fn$;

revoke all on function public.save_worker_review(uuid, boolean, numeric, text, boolean) from public;
grant execute on function public.save_worker_review(uuid, boolean, numeric, text, boolean) to authenticated;

/* ---------- And an unanswered one cannot be sent to HR ---------- */

create or replace function public.submit_worker_review(p_evaluation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_caller uuid := (select auth.uid());
  v_row    public.worker_evaluations%rowtype;
  v_dec    public.worker_evaluation_decisions%rowtype;
begin
  if v_caller is null then
    raise exception 'Sign in first.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from public.worker_evaluations
   where id = p_evaluation_id for update;

  if not found then
    raise exception 'That appraisal no longer exists.' using errcode = 'no_data_found';
  end if;

  if v_row.reviewer_id is distinct from v_caller then
    raise exception 'That appraisal is not yours to review.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_row.status <> 'PENDING_SUPERVISOR' then
    raise exception 'This appraisal is not with you - it is at %.', v_row.status
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_dec from public.worker_evaluation_decisions
   where evaluation_id = p_evaluation_id;

  if v_dec.training_required is null then
    raise exception 'Say whether training is required before sending this to HR.'
      using errcode = 'check_violation';
  end if;

  -- New at 0103. HR receives a recommendation, and "nothing was chosen" is not
  -- one — the same refusal FIX-41 put in front of an unpriced rise.
  if v_dec.salary_changed is null then
    raise exception 'Say whether the salary stays the same or changes before sending this to HR.'
      using errcode = 'check_violation';
  end if;

  if v_dec.salary_changed
     and (v_dec.increment_pct is null or v_dec.increment_pct <= 0) then
    raise exception 'You have recommended a new salary but no percentage. HR has nothing to price without one.'
      using errcode = 'check_violation';
  end if;

  update public.worker_evaluations
     set reviewer_submitted_at = now(),
         status = 'PENDING_REVIEW'
   where id = p_evaluation_id;

  insert into public.audit_log
    (actor_id, entity, entity_id, action, from_status, to_status, diff)
  values (
    v_caller, 'worker_evaluation', p_evaluation_id,
    'worker.supervisor_review_submitted', 'PENDING_SUPERVISOR', 'PENDING_REVIEW',
    jsonb_build_object(
      'training_required', v_dec.training_required,
      'salary_changed',    v_dec.salary_changed,
      'increment_pct',     v_dec.increment_pct
    )
  );
end;
$fn$;

revoke all on function public.submit_worker_review(uuid) from public;
grant execute on function public.submit_worker_review(uuid) to authenticated;

commit;

do $chk$
begin
  if (select is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = 'worker_evaluation_decisions'
         and column_name = 'salary_changed') <> 'YES' then
    raise exception '0103: salary_changed is still NOT NULL, so the screen must still preselect.';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'submit_worker_review'
       and pg_get_functiondef(p.oid) like '%salary_changed is null%'
  ) then
    raise exception '0103: an unanswered salary decision can still be sent to HR.';
  end if;

  raise notice '0103 applied. Same and New both start unchosen.';
end;
$chk$;
