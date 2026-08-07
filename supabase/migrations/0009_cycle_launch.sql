-- =============================================================================
-- 0009_cycle_launch.sql — The all-or-nothing cycle launch, plus the post-launch
-- edits HR needs. Phase P10. CLAUDE.md §5 (snapshot rule), §8 (state machine),
-- §12 (audit).
-- =============================================================================
--
-- WHY THE LAUNCH IS ONE DATABASE FUNCTION
--
-- P10: "If any single participant fails, roll the whole thing back... A partial
-- launch is worse than no launch." A TypeScript loop issuing 47 × 3 PostgREST
-- calls cannot do that. Each call is its own transaction, so a failure at
-- person 31 leaves 30 people launched, 30 snapshots frozen, and a cycle that is
-- neither DRAFT nor ACTIVE. There is no way to unwind it afterwards, because
-- the snapshot rule (§5) forbids deleting a frozen question set.
--
-- So the write side is one function body = one transaction. Everything commits
-- or nothing does.
--
-- WHY THE QUESTIONS ARE PASSED IN RATHER THAN ASSEMBLED HERE
--
-- The obvious alternative — reimplement assembleForDepartment() in PL/pgSQL —
-- would give us two assembly algorithms that must agree forever. P9 was
-- explicit that the preview and the real form must run the same code, and the
-- reason applies with more force here: a snapshot is frozen for years, so an
-- SQL/TS divergence would be discovered long after it could be fixed.
--
-- Instead the split mirrors P4's: TypeScript DECIDES, SQL COMMITS.
--
--   1. lib/cycles/launch.ts calls assembleForDepartment() — the one and only
--      assembly path — once per participant. All reads, no writes.
--   2. It hands the finished rows to this function as JSONB.
--   3. This function validates them, writes everything, and transitions each
--      evaluation through apply_evaluation_transition().
--
-- Step 1 producing a wrong answer is caught by the guards in step 3. Step 3
-- failing anywhere rolls step 2 back entirely.
--
-- WHY SECURITY DEFINER
--
-- Same reasoning as log_admin_action in 0007. The launch writes
-- evaluation_responses rows for other people, which no RLS policy admits and
-- none should: "HR may insert an empty SELF row for anybody" is a policy that
-- would also let HR pre-fill somebody's self-assessment. The capability is
-- therefore granted to this one narrow, HR-gated function instead of to a
-- policy. Being able to call it is not the same as being able to use it — the
-- is_hr() re-check below is the actual gate.
-- =============================================================================


/* ---------- Excluding somebody mid-cycle ---------- */
--
-- P10: "An employee leaves mid-cycle: HR can exclude them, which archives the
-- evaluation rather than deleting it, with a reason."
--
-- Deliberately NOT a new evaluation_status value. §8's table is the backbone
-- and adding an eighth state would mean re-deriving every guard, every policy
-- and every board column from it. Deliberately not a transition to CLOSED
-- either: §8 reaches CLOSED only from MD_FINALIZED, and routing an abandoned
-- evaluation through that door would put it in the "finalised" cohort of every
-- report for ever.
--
-- An exclusion is not a state of the evaluation. It is a statement about
-- whether the organisation is still asking for it. Two nullable columns say
-- exactly that and leave §8 untouched.
alter table public.evaluations
  add column if not exists excluded_at     timestamptz,
  add column if not exists excluded_reason text;

comment on column public.evaluations.excluded_at is
  'Non-null means HR withdrew this person from the cycle (P10). The row and its frozen snapshot are kept — §5 forbids deleting evaluation history. Every board, count and launch query filters on excluded_at is null.';

-- The board and the launch both scan "the live participants of one cycle".
-- Partial index so the 500-evaluation acceptance criterion does not degrade as
-- excluded rows accumulate.
create index if not exists evaluations_cycle_live_idx
  on public.evaluations (cycle_id, status)
  where excluded_at is null;


/* ---------- A participant may be their own lead ---------- */
--
-- 0003 carried `evaluations_lead_not_evaluatee`, on the reasoning that nobody
-- reviews their own appraisal.
--
-- P10 warning 7 requires the opposite: "A participant is their own lead
-- (allowed for a department head, but flag it)." A department head has nobody
-- above them inside this module, and the honest options are to leave their lead
-- empty — which is blocking issue 1, so they could never be launched — or to
-- let them stand as their own lead and show HR a warning.
--
-- The constraint is dropped rather than worked around, because leaving it in
-- place would make warning 7 unreachable: setCycleParticipants would fail with
-- a raw constraint violation and the warning would be dead code.
--
-- What still protects the case: the MD layer. A self-led evaluation is
-- finalised by the MD like any other, so the second opinion moves up a level
-- rather than disappearing. HR sees the flag before launch and can assign
-- somebody else.
alter table public.evaluations
  drop constraint if exists evaluations_lead_not_evaluatee;


/* ---------- A launched cycle cannot be deleted ---------- */
--
-- P10: "Do not... allow deletion of a launched cycle." Enforced here rather
-- than in the action, because evaluation_cycles cascades to evaluations, which
-- cascades to evaluation_questions — a single stray DELETE would take the
-- frozen snapshots of everyone in the cycle with it. That is the one thing §5
-- exists to prevent, so the guard belongs in the database.
create or replace function public.guard_cycle_delete()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'DRAFT' then
    raise exception
      'Cycle "%" has been launched and cannot be deleted. Archive it instead.', old.name
      using errcode = 'restrict_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists evaluation_cycles_guard_delete on public.evaluation_cycles;
create trigger evaluation_cycles_guard_delete
  before delete on public.evaluation_cycles
  for each row execute function public.guard_cycle_delete();


/* ---------- launch_cycle — THE TRANSACTION ---------- */
--
-- p_payload is
--   [ { "evaluation_id": uuid,
--       "questions": [ { "question_id": uuid, "text": text, "help_text": text,
--                        "section": text, "response_type": text,
--                        "answered_by": text, "is_required": bool,
--                        "min_value": num, "max_value": num,
--                        "depends_on": uuid, "depends_value": text,
--                        "options": jsonb, "sort_order": int }, ... ] }, ... ]
--
-- Returns { "evaluations": n, "questions": n, "cycle_id": uuid }.

create or replace function public.launch_cycle(
  p_cycle_id uuid,
  p_payload  jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller       uuid := (select auth.uid());
  v_is_system    boolean := v_caller is null;
  v_cycle        public.evaluation_cycles%rowtype;
  v_launcher     text;
  v_item         jsonb;
  v_question     jsonb;
  v_evaluation   public.evaluations%rowtype;
  v_name         text;
  v_expected     integer;
  v_supplied     integer;
  v_questions    integer := 0;
  v_evaluations  integer := 0;
  v_dept_missing text;
begin
  /* -- Gate. Callable by any authenticated user, usable only by HR. -- */
  if not v_is_system and not public.is_hr() then
    raise exception 'Only HR can launch an evaluation cycle.'
      using errcode = 'insufficient_privilege';
  end if;

  /* -- 1. Row lock. -- */
  --
  -- P10: "Two HR users launching at once: the launch action takes a row lock on
  -- the cycle and the second attempt gets 'This cycle was already launched
  -- by {name}.'"
  --
  -- FOR UPDATE, not a status check alone. Both sessions can read status =
  -- 'DRAFT' at the same instant and both proceed; the lock is what serialises
  -- them, so the second session blocks here, then re-reads status as 'ACTIVE'
  -- once the first commits. Without it the unique constraint on
  -- evaluation_questions would catch the duplicate, but with a raw constraint
  -- error rather than a sentence naming who beat them to it.
  select * into v_cycle
  from public.evaluation_cycles
  where id = p_cycle_id
  for update;

  if not found then
    raise exception 'No evaluation cycle with id %.', p_cycle_id
      using errcode = 'no_data_found';
  end if;

  if v_cycle.status <> 'DRAFT' then
    select coalesce(p.full_name, 'another administrator') into v_launcher
    from public.audit_log a
    left join public.profiles p on p.id = a.actor_id
    where a.entity = 'cycle' and a.entity_id = p_cycle_id and a.action = 'cycle.launched'
    order by a.created_at desc
    limit 1;

    raise exception 'This cycle was already launched by %.', coalesce(v_launcher, 'another administrator')
      using errcode = 'unique_violation';
  end if;

  /* -- 2. The payload must cover every live participant, and nothing else. -- */
  --
  -- Re-derived here rather than trusted: P10 step 1 is "Never trust the
  -- client's readiness." A caller that omitted somebody would otherwise launch
  -- a cycle that permanently excludes them with no record of the decision.
  select count(*) into v_expected
  from public.evaluations
  where cycle_id = p_cycle_id and excluded_at is null and status = 'DRAFT';

  select count(*) into v_supplied from jsonb_array_elements(p_payload);

  if v_expected = 0 then
    raise exception 'This cycle has no participants. Add people before launching.'
      using errcode = 'invalid_parameter_value';
  end if;

  if v_supplied <> v_expected then
    raise exception
      'Launch covers % of % participants. Reload the cycle and try again.', v_supplied, v_expected
      using errcode = 'invalid_parameter_value';
  end if;

  /* -- 3–5. Per participant, in one transaction. -- */
  for v_item in select * from jsonb_array_elements(p_payload)
  loop
    select * into v_evaluation
    from public.evaluations
    where id = (v_item ->> 'evaluation_id')::uuid
    for update;

    if not found then
      raise exception 'Participant row % is no longer in this cycle. Reload and try again.',
        v_item ->> 'evaluation_id'
        using errcode = 'no_data_found';
    end if;

    -- Everything below re-checks a blocking guard from validateCycleForLaunch.
    -- The names come from profiles so a failure says who, not just which uuid —
    -- P10: "report which person failed and why".
    select coalesce(full_name, 'This person') into v_name
    from public.profiles where id = v_evaluation.evaluatee_id;

    if v_evaluation.cycle_id <> p_cycle_id then
      raise exception '% belongs to a different cycle.', v_name
        using errcode = 'invalid_parameter_value';
    end if;

    if v_evaluation.excluded_at is not null then
      raise exception '% was excluded from this cycle while it was being launched.', v_name
        using errcode = 'invalid_parameter_value';
    end if;

    if v_evaluation.status <> 'DRAFT' then
      raise exception '% is already at status %. This cycle may have been launched already.',
        v_name, v_evaluation.status
        using errcode = 'unique_violation';
    end if;

    -- Blocking guard 1.
    if v_evaluation.lead_id is null then
      raise exception '% has no lead assigned.', v_name
        using errcode = 'invalid_parameter_value';
    end if;

    -- Blocking guard 5, and §5's module boundary: "Never write a WORKER row
    -- into a core evaluation table."
    if v_evaluation.track <> 'STAFF' then
      raise exception '% is on the % track. This module covers staff only.', v_name, v_evaluation.track
        using errcode = 'invalid_parameter_value';
    end if;

    if not exists (
      select 1 from public.profiles
      where id = v_evaluation.evaluatee_id and is_active
    ) then
      raise exception '% is not an active employee.', v_name
        using errcode = 'invalid_parameter_value';
    end if;

    -- An empty snapshot would produce a form nobody can fill in, which reads on
    -- every screen as a bug in the renderer rather than as a missing mapping.
    if jsonb_array_length(coalesce(v_item -> 'questions', '[]'::jsonb)) = 0 then
      raise exception 'No questions could be assembled for %. Check their department mapping.', v_name
        using errcode = 'invalid_parameter_value';
    end if;

    -- Blocking guard 2, re-checked per person rather than per department: this
    -- is the last point at which the snapshot can still be prevented, and the
    -- §5 rule is that what freezes here is frozen for years.
    if v_evaluation.department_id is not null then
      if not exists (
        select 1
        from public.department_questions dq
        join public.questions q on q.id = dq.question_id
        where dq.department_id = v_evaluation.department_id
          and q.is_active
          and q.section = 'DEPARTMENT_SPECIFIC'
      ) then
        select name into v_dept_missing from public.departments where id = v_evaluation.department_id;
        raise exception
          '% has no Job Specific Skills questions mapped, so % cannot be launched.',
          coalesce(v_dept_missing, 'That department'), v_name
          using errcode = 'invalid_parameter_value';
      end if;
    end if;

    /* -- 3. Freeze the snapshot (§5). -- */
    --
    -- A plain INSERT, no ON CONFLICT. The unique constraint on
    -- (evaluation_id, question_id) is load-bearing: if a concurrent launch
    -- somehow got past the row lock, this raises and the whole transaction
    -- unwinds. An upsert here would silently rewrite a frozen question set,
    -- which is the exact failure §5 forbids.
    for v_question in select * from jsonb_array_elements(v_item -> 'questions')
    loop
      insert into public.evaluation_questions (
        evaluation_id, question_id, text, help_text, section, response_type,
        answered_by, is_required, min_value, max_value, depends_on, depends_value,
        options, sort_order
      )
      values (
        v_evaluation.id,
        (v_question ->> 'question_id')::uuid,
        v_question ->> 'text',
        v_question ->> 'help_text',
        (v_question ->> 'section')::public.question_section,
        (v_question ->> 'response_type')::public.response_type,
        (v_question ->> 'answered_by')::public.answered_by,
        coalesce((v_question ->> 'is_required')::boolean, true),
        (v_question ->> 'min_value')::numeric,
        (v_question ->> 'max_value')::numeric,
        (v_question ->> 'depends_on')::uuid,
        v_question ->> 'depends_value',
        case when v_question -> 'options' = 'null'::jsonb then null else v_question -> 'options' end,
        coalesce((v_question ->> 'sort_order')::integer, 0)
      );
      v_questions := v_questions + 1;
    end loop;

    /* -- 4. The empty SELF row, so the employee opens a form rather than a 404. -- */
    insert into public.evaluation_responses (evaluation_id, layer, answers, comments)
    values (v_evaluation.id, 'SELF', '{}'::jsonb, '{}'::jsonb)
    on conflict (evaluation_id, layer) do nothing;

    /* -- 5. DRAFT -> CYCLE_ACTIVE through §8's function. Never a direct UPDATE. -- */
    --
    -- This is also where audit row #2..n+1 come from: the function writes one
    -- per transition, so 47 people produce 47 evaluation audit rows plus the
    -- one cycle row written below.
    perform public.apply_evaluation_transition(
      p_evaluation_id => v_evaluation.id,
      p_from_status   => 'DRAFT',
      p_to_status     => 'CYCLE_ACTIVE',
      p_actor_id      => v_caller,
      p_action        => 'evaluation.launched',
      p_reason        => null,
      p_diff          => jsonb_build_object(
                           'cycle_id', p_cycle_id,
                           'lead_id', v_evaluation.lead_id,
                           'question_count',
                           jsonb_array_length(v_item -> 'questions')
                         )
    );

    v_evaluations := v_evaluations + 1;
  end loop;

  /* -- 6. The cycle itself. -- */
  update public.evaluation_cycles
  set status = 'ACTIVE', launched_at = now()
  where id = p_cycle_id and status = 'DRAFT';

  if not found then
    -- Unreachable while the row lock above is held, and left in deliberately:
    -- if a future change drops the lock this fails loudly instead of launching
    -- a cycle twice.
    raise exception 'This cycle changed while it was being launched. Reload and try again.'
      using errcode = 'serialization_failure';
  end if;

  /* -- 7. The cycle audit row. -- */
  insert into public.audit_log (actor_id, entity, entity_id, action, from_status, to_status, diff)
  values (
    v_caller, 'cycle', p_cycle_id, 'cycle.launched', 'DRAFT', 'ACTIVE',
    jsonb_build_object('evaluations', v_evaluations, 'questions', v_questions)
  );

  return jsonb_build_object(
    'cycle_id', p_cycle_id,
    'evaluations', v_evaluations,
    'questions', v_questions
  );
end;
$$;

revoke all on function public.launch_cycle(uuid, jsonb) from public;
grant execute on function public.launch_cycle(uuid, jsonb) to authenticated;

comment on function public.launch_cycle is
  'All-or-nothing cycle launch (P10). Freezes each participant''s snapshot (§5) and transitions DRAFT -> CYCLE_ACTIVE through apply_evaluation_transition (§8). Questions are assembled in TypeScript and passed in, so there is exactly one assembly algorithm.';


/* ---------- reassign_evaluation_lead ---------- */
--
-- P10: "allowed while status is CYCLE_ACTIVE or SELF_SUBMITTED, blocked
-- afterwards, always audit-logged".
--
-- The cut-off is not arbitrary. Once the lead has submitted (LEAD_REVIEWED) the
-- LEAD layer is locked and carries their name in submitted_by; swapping the
-- lead_id afterwards would attribute one person's written review to another.

create or replace function public.reassign_evaluation_lead(
  p_evaluation_id uuid,
  p_new_lead_id   uuid,
  p_reason        text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller  uuid := (select auth.uid());
  v_eval    public.evaluations%rowtype;
  v_old     uuid;
  v_ok      boolean;
begin
  if v_caller is not null and not public.is_hr() then
    raise exception 'Only HR can reassign a lead.' using errcode = 'insufficient_privilege';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required when reassigning a lead.'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_eval from public.evaluations where id = p_evaluation_id for update;
  if not found then
    raise exception 'No evaluation with id %.', p_evaluation_id using errcode = 'no_data_found';
  end if;

  if v_eval.status not in ('CYCLE_ACTIVE', 'SELF_SUBMITTED') then
    raise exception
      'The lead can only be changed before the review is written. This evaluation is at %.', v_eval.status
      using errcode = 'invalid_parameter_value';
  end if;

  select is_active into v_ok from public.profiles where id = p_new_lead_id;
  if v_ok is distinct from true then
    raise exception 'The new lead must be an active employee.'
      using errcode = 'invalid_parameter_value';
  end if;

  v_old := v_eval.lead_id;

  update public.evaluations set lead_id = p_new_lead_id where id = p_evaluation_id;

  insert into public.audit_log (actor_id, entity, entity_id, action, diff, reason)
  values (
    v_caller, 'evaluation', p_evaluation_id, 'evaluation.lead_reassigned',
    jsonb_build_object('from', v_old, 'to', p_new_lead_id),
    p_reason
  );

  -- Returned rather than notified from here: §10 keeps every outbound message
  -- server-side and logged to notifications_log, and a database function is the
  -- wrong place to make an HTTP call. The action layer sends to both names.
  return jsonb_build_object('old_lead_id', v_old, 'new_lead_id', p_new_lead_id);
end;
$$;

revoke all on function public.reassign_evaluation_lead(uuid, uuid, text) from public;
grant execute on function public.reassign_evaluation_lead(uuid, uuid, text) to authenticated;


/* ---------- exclude_evaluation ---------- */
--
-- Archives rather than deletes. See the excluded_at comment above for why this
-- is not a status value.

create or replace function public.exclude_evaluation(
  p_evaluation_id uuid,
  p_reason        text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := (select auth.uid());
  v_eval   public.evaluations%rowtype;
begin
  if v_caller is not null and not public.is_hr() then
    raise exception 'Only HR can withdraw somebody from a cycle.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required when withdrawing somebody from a cycle.'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_eval from public.evaluations where id = p_evaluation_id for update;
  if not found then
    raise exception 'No evaluation with id %.', p_evaluation_id using errcode = 'no_data_found';
  end if;

  if v_eval.excluded_at is not null then
    raise exception 'This person has already been withdrawn from the cycle.'
      using errcode = 'unique_violation';
  end if;

  update public.evaluations
  set excluded_at = now(), excluded_reason = p_reason
  where id = p_evaluation_id;

  insert into public.audit_log (actor_id, entity, entity_id, action, diff, reason)
  values (
    v_caller, 'evaluation', p_evaluation_id, 'evaluation.excluded',
    jsonb_build_object('status_at_exclusion', v_eval.status::text), p_reason
  );

  return jsonb_build_object('evaluation_id', p_evaluation_id);
end;
$$;

revoke all on function public.exclude_evaluation(uuid, text) from public;
grant execute on function public.exclude_evaluation(uuid, text) to authenticated;


/* ---------- RLS: HR builds the participant list before launch ---------- */
--
-- 0005 gave evaluations an HR read policy and an update policy gated on
-- in_transition(). Neither covers the pre-launch phase, where HR assembles the
-- roster as DRAFT rows — so setCycleParticipants had no way to write.
--
-- Both policies below are confined to DRAFT. Once a cycle is launched its
-- evaluations leave DRAFT permanently (§8 has no transition back), so this
-- cannot be used to edit, re-point or delete a live evaluation: the only writes
-- it admits are to rows that carry no answers and no frozen snapshot yet.

drop policy if exists evaluations_hr_draft_insert on public.evaluations;
create policy evaluations_hr_draft_insert on public.evaluations
  for insert to authenticated
  with check (public.is_hr() and status = 'DRAFT');

drop policy if exists evaluations_hr_draft_update on public.evaluations;
create policy evaluations_hr_draft_update on public.evaluations
  for update to authenticated
  using (public.is_hr() and status = 'DRAFT')
  with check (public.is_hr() and status = 'DRAFT');

-- Removing somebody from a cycle that has not launched is a plain delete: there
-- is no snapshot and no answer to preserve, so there is nothing to archive.
-- After launch, exclude_evaluation() is the only route, and the DRAFT clause
-- here is what forces that.
drop policy if exists evaluations_hr_draft_delete on public.evaluations;
create policy evaluations_hr_draft_delete on public.evaluations
  for delete to authenticated
  using (public.is_hr() and status = 'DRAFT');
