-- =============================================================================
-- 0012_merge_hr_md.sql — HR_ADMIN and MD become interchangeable.
-- CLAUDE.md §9 (access matrix) and §8 (transition table), both amended.
-- =============================================================================
--
-- CONSTITUTION AMENDMENT, at the owner's explicit instruction.
--
-- §9 gave HR and the MD deliberately different powers:
--
--     HR could configure (questions, departments, cycles, people), launch a
--     cycle and close one. It could NOT write the MD layer or record a pay
--     decision.
--
--     The MD could write the MD layer, record increment and promotion
--     decisions and finalise. It could NOT configure anything.
--
-- That split was a separation of duties: the person who decides what is asked
-- was not the person who decides what it is worth. P5-8 asserted it explicitly,
-- on the reasoning that "HR is the admin so HR can do everything" is the
-- obvious wrong assumption.
--
-- The owner has chosen a full merge. Both roles now hold both sets of powers,
-- and the consequence is stated plainly rather than buried: **there is no
-- longer a second pair of eyes on a pay decision.** Anyone holding either role
-- can author the questions, launch the cycle, write the final scores and set
-- the increment. If that ever needs reversing, this migration is the single
-- place it happened.
--
-- HOW: one helper, is_admin(), replacing every is_hr()-only and is_md()-only
-- gate. The two functions are left in place — they are still the truthful
-- answer to "does this person hold that role", and a future split needs them.
-- =============================================================================


/* ---------- The merged predicate ---------- */

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_hr() or public.is_md();
$$;

grant execute on function public.is_admin() to authenticated;

comment on function public.is_admin() is
  'HR_ADMIN or MD. §9 was amended to make the two interchangeable (0012); this is the single predicate every policy and function now gates on.';


/* ---------- Config tables: the MD gains write ---------- */
--
-- These were HR-only. Recreated rather than altered because a policy's
-- expression cannot be edited in place.

drop policy if exists departments_hr_all on public.departments;
create policy departments_hr_all on public.departments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists questions_hr_all on public.questions;
create policy questions_hr_all on public.questions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists question_options_hr_all on public.question_options;
create policy question_options_hr_all on public.question_options
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists department_questions_hr_all on public.department_questions;
create policy department_questions_hr_all on public.department_questions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists evaluation_cycles_hr_all on public.evaluation_cycles;
create policy evaluation_cycles_hr_all on public.evaluation_cycles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists user_roles_hr_all on public.user_roles;
create policy user_roles_hr_all on public.user_roles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists profiles_hr_update on public.profiles;
create policy profiles_hr_update on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists profiles_hr_insert on public.profiles;
create policy profiles_hr_insert on public.profiles
  for insert to authenticated with check (public.is_admin());

drop policy if exists evaluation_questions_hr_insert on public.evaluation_questions;
create policy evaluation_questions_hr_insert on public.evaluation_questions
  for insert to authenticated with check (public.is_admin());

-- The pre-launch roster (0009). Still confined to DRAFT: once a cycle launches
-- its evaluations leave DRAFT permanently, so this cannot touch a live one.
drop policy if exists evaluations_hr_draft_insert on public.evaluations;
create policy evaluations_hr_draft_insert on public.evaluations
  for insert to authenticated
  with check (public.is_admin() and status = 'DRAFT');

drop policy if exists evaluations_hr_draft_update on public.evaluations;
create policy evaluations_hr_draft_update on public.evaluations
  for update to authenticated
  using (public.is_admin() and status = 'DRAFT')
  with check (public.is_admin() and status = 'DRAFT');

drop policy if exists evaluations_hr_draft_delete on public.evaluations;
create policy evaluations_hr_draft_delete on public.evaluations
  for delete to authenticated
  using (public.is_admin() and status = 'DRAFT');

-- Invite tokens: HR-only read, now admin. Still no UPDATE or DELETE for anyone,
-- so a token cannot be un-revoked or its rate-limit counter reset (P6-6).
drop policy if exists invite_tokens_hr_select on public.invite_tokens;
create policy invite_tokens_hr_select on public.invite_tokens
  for select to authenticated using (public.is_admin());


/* ---------- Decisions: HR gains write ---------- */
--
-- This is the half that removes the second pair of eyes. Recorded loudly.

drop policy if exists evaluation_decisions_md_insert on public.evaluation_decisions;
create policy evaluation_decisions_md_insert on public.evaluation_decisions
  for insert to authenticated with check (public.is_admin());

drop policy if exists evaluation_decisions_md_update on public.evaluation_decisions;
create policy evaluation_decisions_md_update on public.evaluation_decisions
  for update to authenticated using (public.is_admin()) with check (public.is_admin());


/* ---------- §8's transition table, amended ---------- */
--
-- The whole function is replaced because its CASE is the database's copy of
-- §8's "Who" column. Only that CASE changes; everything else is 0005's body,
-- unchanged — the row lock, the optimistic from-status check, the layer lock,
-- the audit insert.

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
as $$
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

  -- §8's table as amended by 0012. The four administrative rows now admit
  -- either role; the two that belong to the people doing the work — the
  -- employee submitting and their lead reviewing — are untouched, because
  -- merging HR and MD says nothing about who fills in a form.
  v_allowed := case
    when p_from_status = 'DRAFT'          and p_to_status = 'CYCLE_ACTIVE'   then public.is_admin() or v_is_system
    when p_from_status = 'CYCLE_ACTIVE'   and p_to_status = 'SELF_SUBMITTED' then v_caller = v_evaluatee
    when p_from_status = 'SELF_SUBMITTED' and p_to_status = 'CYCLE_ACTIVE'   then v_caller = v_lead
    when p_from_status = 'SELF_SUBMITTED' and p_to_status = 'LEAD_REVIEWED'  then v_caller = v_lead
    when p_from_status = 'LEAD_REVIEWED'  and p_to_status = 'SELF_SUBMITTED' then public.is_admin()
    when p_from_status = 'LEAD_REVIEWED'  and p_to_status = 'MD_FINALIZED'   then public.is_admin()
    when p_from_status = 'MD_FINALIZED'   and p_to_status = 'CLOSED'         then public.is_admin() or v_is_system
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
        then (p_evaluation_patch ->> 'final_overall')::numeric else e.final_overall end
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
$$;


/* ---------- Gated functions ---------- */
--
-- Each of these re-checked is_hr() internally, which is what made "callable by
-- anyone, usable by HR" true. They now say is_admin() instead. The gate itself
-- is unchanged in kind — only who satisfies it.

create or replace function public.log_admin_action(
  p_entity text, p_entity_id uuid, p_action text, p_diff jsonb default null
)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_caller uuid := (select auth.uid());
  v_id     uuid;
begin
  if v_caller is not null and not public.is_admin() then
    raise exception 'Only an administrator can record an administrative action.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_entity is null or p_entity_id is null or p_action is null then
    raise exception 'entity, entity_id and action are required on an audit row.'
      using errcode = 'invalid_parameter_value';
  end if;
  insert into public.audit_log (actor_id, entity, entity_id, action, diff)
  values (v_caller, p_entity, p_entity_id, p_action, p_diff)
  returning id into v_id;
  return v_id;
end;
$$;

-- The remaining functions differ from their originals only in the predicate, so
-- they are patched rather than restated in full.
create or replace function public.merge_evaluation_answers(
  p_evaluation_id uuid,
  p_layer         public.rating_layer,
  p_answers_patch jsonb,
  p_comments_patch jsonb default '{}'::jsonb,
  p_remove_keys   text[] default '{}'::text[]
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_caller   uuid := (select auth.uid());
  v_eval     public.evaluations%rowtype;
  v_row      public.evaluation_responses%rowtype;
  v_answers  jsonb;
  v_comments jsonb;
  v_key      text;
begin
  if v_caller is null then
    raise exception 'You must be signed in to save answers.' using errcode = 'insufficient_privilege';
  end if;

  if jsonb_typeof(coalesce(p_answers_patch, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_comments_patch, '{}'::jsonb)) <> 'object' then
    raise exception 'Answers must be a flat object keyed by question id.'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_eval from public.evaluations where id = p_evaluation_id;
  if not found then
    raise exception 'No evaluation with id %.', p_evaluation_id using errcode = 'no_data_found';
  end if;

  if p_layer = 'SELF' then
    if v_caller <> v_eval.evaluatee_id then
      raise exception 'Only the employee can write their own self-evaluation.'
        using errcode = 'insufficient_privilege';
    end if;
    if v_eval.status <> 'CYCLE_ACTIVE' then
      raise exception 'This evaluation is no longer open for editing.'
        using errcode = 'invalid_parameter_value';
    end if;

  elsif p_layer = 'LEAD' then
    if v_caller is distinct from v_eval.lead_id then
      raise exception 'Only the assigned lead can write this review.'
        using errcode = 'insufficient_privilege';
    end if;
    if v_eval.status <> 'SELF_SUBMITTED' then
      raise exception 'This evaluation is not ready for a lead review.'
        using errcode = 'invalid_parameter_value';
    end if;

  else
    -- The MD layer, now writable by either administrative role.
    if not public.is_admin() then
      raise exception 'Only an administrator can write the final layer.'
        using errcode = 'insufficient_privilege';
    end if;
    if v_eval.status <> 'LEAD_REVIEWED' then
      raise exception 'This evaluation is not ready for a final decision.'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  if v_eval.excluded_at is not null then
    raise exception 'This person has been withdrawn from the cycle.'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_row from public.evaluation_responses
  where evaluation_id = p_evaluation_id and layer = p_layer for update;

  if not found then
    insert into public.evaluation_responses (evaluation_id, layer, answers, comments)
    values (p_evaluation_id, p_layer, '{}'::jsonb, '{}'::jsonb)
    returning * into v_row;
  end if;

  if v_row.submitted_at is not null then
    raise exception 'This layer has been submitted and can no longer be edited.'
      using errcode = 'invalid_parameter_value';
  end if;

  v_answers  := coalesce(v_row.answers, '{}'::jsonb)  || coalesce(p_answers_patch, '{}'::jsonb);
  v_comments := coalesce(v_row.comments, '{}'::jsonb) || coalesce(p_comments_patch, '{}'::jsonb);

  if p_remove_keys is not null then
    foreach v_key in array p_remove_keys loop
      v_answers  := v_answers  - v_key;
      v_comments := v_comments - v_key;
    end loop;
  end if;

  update public.evaluation_responses
  set answers = v_answers, comments = v_comments
  where id = v_row.id;

  return jsonb_build_object('answers', v_answers, 'comments', v_comments);
end;
$$;


/* ---------- The remaining is_hr() gates ---------- */
--
-- launch_cycle, reassign_evaluation_lead, exclude_evaluation,
-- queue_notification and settle_notification each open with the same shape:
--
--     if v_caller is not null and not public.is_hr() then raise ...
--
-- Rewriting five long function bodies to change one word invites a
-- transcription error in code that is already tested. Instead the definitions
-- are patched in place, which is exact by construction.
do $$
declare
  v_name text;
  v_args text;
  v_src  text;
begin
  for v_name, v_args, v_src in
    select p.proname,
           pg_get_function_identity_arguments(p.oid),
           pg_get_functiondef(p.oid)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('launch_cycle', 'reassign_evaluation_lead', 'exclude_evaluation',
                        'queue_notification', 'settle_notification')
  loop
    if v_src like '%public.is_hr()%' then
      execute replace(v_src, 'public.is_hr()', 'public.is_admin()');
    end if;
  end loop;
end;
$$;

comment on function public.apply_evaluation_transition is
  '§8 as amended by 0012: the four administrative transitions admit HR_ADMIN or MD. The employee''s submit and the lead''s review are unchanged.';
