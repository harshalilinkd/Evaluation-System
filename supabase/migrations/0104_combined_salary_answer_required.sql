-- 0104: the one-press form must answer Same or New too.
--
-- 0103 gave `salary_changed` a third state and taught `submit_worker_review` to
-- refuse an unanswered one. `submit_worker_combined` — the path where the team
-- leader IS the supervisor and fills one form (0101) — still ran it through
-- `coalesce(…, false)`, so on that route an unanswered decision was quietly
-- recorded as "Same" on the way to HR.
--
-- Two routes reach HR and the second must not be the laxer one. Same rule,
-- same sentence.
--
-- Its own migration rather than an edit to 0103: that one is applied, and §0.8
-- says an applied migration is never edited.

begin;

create or replace function public.submit_worker_combined(
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
  v_caller  uuid := (select auth.uid());
  v_row     public.worker_evaluations%rowtype;
  v_answers jsonb;
  v_overall uuid;
  v_tick    text;
begin
  if v_caller is null then
    raise exception 'Sign in first.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from public.worker_evaluations
   where id = p_evaluation_id for update;

  if not found then
    raise exception 'That appraisal no longer exists.' using errcode = 'no_data_found';
  end if;

  -- Both roles, on the same person. This function exists only for that case.
  if v_row.supervisor_id is distinct from v_caller
     or v_row.reviewer_id is distinct from v_caller then
    raise exception 'This form is for somebody who both rates and decides on this appraisal.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_row.status <> 'OPEN' then
    raise exception 'This appraisal is no longer open.' using errcode = 'invalid_parameter_value';
  end if;

  if v_row.supervisor_submitted_at is not null or v_row.supervisor_skipped then
    raise exception 'This side has already been submitted.' using errcode = 'invalid_parameter_value';
  end if;

  /* ---------- The completeness rules, in the other route's words ---------- */

  if p_training is null then
    raise exception 'Say whether training is required before sending this to HR.'
      using errcode = 'check_violation';
  end if;

  -- New at 0104.
  if p_salary_changed is null then
    raise exception 'Say whether the salary stays the same or changes before sending this to HR.'
      using errcode = 'check_violation';
  end if;

  if p_salary_changed
     and (p_increment_pct is null or p_increment_pct <= 0) then
    raise exception 'You have recommended a new salary but no percentage. HR has nothing to price without one.'
      using errcode = 'check_violation';
  end if;

  if p_increment_pct is not null and (p_increment_pct <= 0 or p_increment_pct > 100) then
    raise exception 'A rise is between 0 and 100 per cent.' using errcode = 'check_violation';
  end if;

  insert into public.worker_evaluation_decisions
    (evaluation_id, salary_changed, increment_pct, supervisor_comment, training_required)
  values
    (p_evaluation_id, p_salary_changed,
     case when p_salary_changed then p_increment_pct else null end,
     nullif(btrim(coalesce(p_comment, '')), ''), p_training)
  on conflict (evaluation_id) do update
     set salary_changed     = excluded.salary_changed,
         increment_pct      = excluded.increment_pct,
         supervisor_comment = excluded.supervisor_comment,
         training_required  = excluded.training_required;

  update public.worker_evaluation_responses
     set submitted_at = now(),
         submitted_by = v_caller
   where evaluation_id = p_evaluation_id
     and layer = 'SUPERVISOR'
   returning answers into v_answers;

  /* §11: the overall is the tick sheet's own row, from the FROZEN sheet. */
  select question_id into v_overall
    from public.worker_evaluation_questions
   where evaluation_id = p_evaluation_id and is_overall
   limit 1;

  if v_overall is not null then
    v_tick := v_answers ->> v_overall::text;
  end if;

  update public.worker_evaluations
     set supervisor_submitted_at = now(),
         reviewer_submitted_at   = now(),
         overall_tick            = v_tick,
         status                  = 'PENDING_REVIEW'
   where id = p_evaluation_id;

  /* §12: two acts, two rows, even from one press. No amount in either diff. */
  insert into public.audit_log (actor_id, entity, entity_id, action, diff)
  values (v_caller, 'worker_evaluation', p_evaluation_id, 'worker.supervisor_submit',
          jsonb_build_object('layer', 'SUPERVISOR', 'combined', true));

  insert into public.audit_log
    (actor_id, entity, entity_id, action, from_status, to_status, diff)
  values (
    v_caller, 'worker_evaluation', p_evaluation_id,
    'worker.supervisor_review_submitted', 'OPEN', 'PENDING_REVIEW',
    jsonb_build_object(
      'training_required', p_training,
      'salary_changed',    p_salary_changed,
      'increment_pct',     p_increment_pct,
      'combined',          true
    )
  );
end;
$fn$;

revoke all on function public.submit_worker_combined(uuid, boolean, numeric, text, boolean) from public;
grant execute on function public.submit_worker_combined(uuid, boolean, numeric, text, boolean) to authenticated;

commit;

do $chk$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'submit_worker_combined'
       and pg_get_functiondef(p.oid) like '%p_salary_changed is null%'
  ) then
    raise exception '0104: the one-press route can still send an unanswered salary decision to HR.';
  end if;

  raise notice '0104 applied. Both routes to HR refuse an unanswered Same or New.';
end;
$chk$;
