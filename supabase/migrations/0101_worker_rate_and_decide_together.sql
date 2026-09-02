-- 0101: where the team leader IS the supervisor, they rate and decide on ONE
-- form, in one press.
--
-- ============================================================================
-- AT THE OWNER'S EXPLICIT INSTRUCTION, GIVEN TWICE.
--
--   "this both steps should work at one go in same form if the condition is
--    this — Rated by [Nandkishor Desai] · Review & Salary decision
--    [Nandkishor Desai · also rates them]"
--
-- 0100 made them two steps for everybody, and WORKER-2's addendum defended that
-- for this case on a CONCRETE defect rather than on tidiness: the three fields
-- filled on the rating sheet are stored where 0064 lets a supervisor WRITE and
-- not READ, so the percentage would vanish from the box the moment they
-- reopened the page. That objection was put to the owner and they chose one
-- form. It is answered here rather than accepted: the combined path stores the
-- three fields in `worker_evaluation_decisions` — the SAME place a separate
-- supervisor stores them — and reads them back through `worker_review_decision`,
-- which is a definer function and carries no amount. Nothing is written to a
-- column its author cannot read.
--
-- WHAT IS NOT CHANGED, and was checked rather than assumed:
--   * §5. No function here takes or returns a rupee amount. The combined path
--     records Same/New and a percentage, exactly as the separate one does.
--   * The two-step path. A DIFFERENT supervisor still reviews separately, and
--     `submit_worker_layer` still routes to them — untouched by this migration.
--   * The completeness rules. The training tick and "a recommended rise needs a
--     percentage" are enforced here in the same words 0100 uses, because this
--     is now a second way to reach HR and a second way must not be a laxer one.
--   * A round with no reviewer at all. Still the pre-0100 behaviour, still
--     straight to HR, still using the legacy columns.
-- ============================================================================

begin;

/* ============================================================================
   1 · The rater who is also the reviewer may record their decision while the
       sheet is still open
   ========================================================================== */
--
-- 0100 gated `save_worker_review` on PENDING_SUPERVISOR, which is right when
-- the appraisal has been handed over: before that moment it is not theirs. When
-- the reviewer IS the rater there is no hand-over — the whole point of this
-- migration — so the record is OPEN for the entire time they are filling it in,
-- and the gate has to admit that case or the fields cannot be saved at all.
--
-- Narrow deliberately: OPEN is admitted ONLY when the caller is also the person
-- rating it. A separate supervisor still cannot touch the row until it reaches
-- them, which is what keeps the two-step flow a genuine hand-over.

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

  /* -- Two ways in, and only two.
        PENDING_SUPERVISOR — it has been handed to them (0100).
        OPEN and they are also the rater — they are filling one form (0101). -- */
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
    (p_evaluation_id, coalesce(p_salary_changed, false),
     -- "Same" means no figure, not a zero. A stored 0 would read as a rise of
     -- nothing rather than as a decision not to give one.
     case when coalesce(p_salary_changed, false) then p_increment_pct else null end,
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

/* ============================================================================
   2 · One press: lock the ticks, record the decision, send it to HR
   ========================================================================== */
--
-- ONE FUNCTION RATHER THAN TWO CALLS FROM TYPESCRIPT, and the reason is the one
-- P14-1 and P10-2 give: this moves a status, locks a layer, stamps two
-- timestamps and files a pay recommendation, and a half-applied version of that
-- is a record nobody can explain. Two RPCs behind one button would leave the
-- ticks locked at PENDING_SUPERVISOR if the second failed — recoverable, but
-- only by somebody who knew to go and look.
--
-- The completeness rules are 0100's, restated word for word rather than
-- referenced: this is a second route to HR, and a second route that is laxer
-- than the first is a hole rather than a convenience.

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

  /* -- BOTH roles, on the same person. This function exists only for that
        case; anybody else takes the two-step path and its own guards. -- */
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

  /* ---------- 0100's completeness rules, in 0100's words ---------- */

  if p_training is null then
    raise exception 'Say whether training is required before sending this to HR.'
      using errcode = 'check_violation';
  end if;

  if coalesce(p_salary_changed, false)
     and (p_increment_pct is null or p_increment_pct <= 0) then
    raise exception 'You have recommended a new salary but no percentage. HR has nothing to price without one.'
      using errcode = 'check_violation';
  end if;

  if p_increment_pct is not null and (p_increment_pct <= 0 or p_increment_pct > 100) then
    raise exception 'A rise is between 0 and 100 per cent.' using errcode = 'check_violation';
  end if;

  /* ---------- The decision ---------- */

  insert into public.worker_evaluation_decisions
    (evaluation_id, salary_changed, increment_pct, supervisor_comment, training_required)
  values
    (p_evaluation_id, coalesce(p_salary_changed, false),
     case when coalesce(p_salary_changed, false) then p_increment_pct else null end,
     nullif(btrim(coalesce(p_comment, '')), ''), p_training)
  on conflict (evaluation_id) do update
     set salary_changed     = excluded.salary_changed,
         increment_pct      = excluded.increment_pct,
         supervisor_comment = excluded.supervisor_comment,
         training_required  = excluded.training_required;

  /* ---------- The ticks ---------- */

  update public.worker_evaluation_responses
     set submitted_at = now(),
         submitted_by = v_caller
   where evaluation_id = p_evaluation_id
     and layer = 'SUPERVISOR'
   returning answers into v_answers;

  /* -- §11: a worker's overall is the tick sheet's "Overall Performance" row,
        never a mean. From the FROZEN sheet, stored now rather than recomputed
        on read (§5) — the same three lines `submit_worker_layer` runs. -- */
  select question_id into v_overall
    from public.worker_evaluation_questions
   where evaluation_id = p_evaluation_id and is_overall
   limit 1;

  if v_overall is not null then
    v_tick := v_answers ->> v_overall::text;
  end if;

  /* ---------- Both stamps, and straight to HR ----------
     `reviewer_submitted_at` is set here as well, so the record does not later
     look like a review that never happened — and so the two-step path's own
     guard (`reviewer_submitted_at is null`) can never re-open it. */
  update public.worker_evaluations
     set supervisor_submitted_at = now(),
         reviewer_submitted_at   = now(),
         overall_tick            = v_tick,
         status                  = 'PENDING_REVIEW'
   where id = p_evaluation_id;

  /* ---------- §12 ----------
     TWO rows, not one. Rating and deciding are two acts, and they stay two in
     the record even when one press performed both — a single row would make
     the trail say less than what happened. No amount in either diff: 0013 lets
     a lead read `audit_log` for their own reports, so a figure there walks
     straight past §5 (P19-10). */
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
      'salary_changed',    coalesce(p_salary_changed, false),
      'increment_pct',     p_increment_pct,
      'combined',          true
    )
  );
end;
$fn$;

revoke all on function public.submit_worker_combined(uuid, boolean, numeric, text, boolean) from public;
grant execute on function public.submit_worker_combined(uuid, boolean, numeric, text, boolean) to authenticated;

commit;

/* ============================================================================
   3 · Verification
   ========================================================================== */

do $chk$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'submit_worker_combined'
  ) then
    raise exception '0101: submit_worker_combined is missing.';
  end if;

  -- No parameter and no column here can carry a rupee amount (§5).
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('submit_worker_combined', 'save_worker_review')
       and pg_get_function_arguments(p.oid) ~* '(old_ctc|new_ctc|ctc|salary_amount)'
  ) then
    raise exception '0101: a function here takes a salary amount. Section 5.';
  end if;

  -- The separate hand-over is untouched: submit_worker_layer still routes to a
  -- reviewer, and nothing above rewrote it.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'submit_worker_layer'
       and pg_get_functiondef(p.oid) like '%PENDING_SUPERVISOR%'
  ) then
    raise exception '0101: the two-step hand-over has been lost.';
  end if;

  raise notice '0101 applied. One rater who is also the supervisor fills one form.';
end;
$chk$;
