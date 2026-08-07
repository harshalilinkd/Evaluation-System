-- 0022_cycle_type.sql
-- P10-REV: a cycle has a type and a shape, evaluations carry their own due
-- dates, questions carry a cycle scope, and an invite token names its layer.
--
-- NUMBERING. The brief names this `_cycle_type.sql` with no number. §0.8 makes
-- it sequential and 0021 is taken, so it is 0022.
--
-- WHAT THIS UNBLOCKS. AMEND-2 §6 defined `cycle_scope` on questions and no
-- migration ever added it; AMEND-2 §1 defined the cycle type and no migration
-- ever added that either. Both are prerequisites for the launch fix below, and
-- this phase is the explicit instruction §0.4 requires before adding a column.
--
-- SAFE TO RE-RUN.

begin;

/* ============================================================================
   1. Cycle type and shape
   ========================================================================== */
--
-- Text with a CHECK rather than enums. An enum value cannot be dropped once a
-- row carries it (AMEND-3 learned that the hard way), and these two lists are
-- young enough that getting them wrong is likely. A CHECK can be replaced.

alter table public.evaluation_cycles
  add column if not exists cycle_type text not null default 'EVALUATION',
  add column if not exists cycle_kind text not null default 'BATCH',
  -- ROLLING cycles have no fixed dates: each evaluation's deadlines are
  -- computed from the day that person is added. These are the day counts.
  add column if not exists default_self_days int not null default 14,
  add column if not exists default_lead_days int not null default 21;

update public.evaluation_cycles set cycle_type = 'EVALUATION' where cycle_type is null;
update public.evaluation_cycles set cycle_kind = 'BATCH' where cycle_kind is null;

alter table public.evaluation_cycles drop constraint if exists evaluation_cycles_type_valid;
alter table public.evaluation_cycles add constraint evaluation_cycles_type_valid
  check (cycle_type in ('EVALUATION', 'INCREMENT'));

alter table public.evaluation_cycles drop constraint if exists evaluation_cycles_kind_valid;
alter table public.evaluation_cycles add constraint evaluation_cycles_kind_valid
  check (cycle_kind in ('BATCH', 'ROLLING'));

alter table public.evaluation_cycles drop constraint if exists evaluation_cycles_rolling_days;
alter table public.evaluation_cycles add constraint evaluation_cycles_rolling_days
  check (default_self_days between 1 and 365 and default_lead_days between 1 and 365);

-- A rolling cycle's own dates are meaningless — every evaluation carries its
-- own. Rather than a constraint about dates "in the past relative to created
-- rows", which cannot be expressed on this table without a subquery, the rule
-- is stated where it is enforceable: the LEAD window must not close before the
-- self window on a rolling cycle, or a lead would be late the day they are
-- asked.
alter table public.evaluation_cycles drop constraint if exists evaluation_cycles_rolling_order;
alter table public.evaluation_cycles add constraint evaluation_cycles_rolling_order
  check (cycle_kind <> 'ROLLING' or default_lead_days >= default_self_days);

comment on column public.evaluation_cycles.cycle_type is
  'EVALUATION ends when the MD has read the report. INCREMENT continues into salary, approval and the interview (§1).';
comment on column public.evaluation_cycles.cycle_kind is
  'BATCH: everybody is chosen now and launched together. ROLLING: the cycle stays open and people are added as their date arrives.';

/* ---------- Disclosure: FULL is retired for new cycles ---------- */
--
-- §5's blindness invariant: no policy, view, action, export or report may show
-- the LEAD layer to the evaluatee. FULL did exactly that, and 0021 already
-- removed the RLS branch honouring it. The enum value STAYS — historical rows
-- carry it and AMEND-3 forbids dropping one — but no new or updated row may
-- select it.

update public.evaluation_cycles set disclosure = 'SCORE_AND_DECISION' where disclosure = 'FULL';

alter table public.evaluation_cycles drop constraint if exists evaluation_cycles_disclosure_current;
alter table public.evaluation_cycles add constraint evaluation_cycles_disclosure_current
  check (disclosure in ('NONE', 'SCORE_ONLY', 'SCORE_AND_DECISION'));

comment on constraint evaluation_cycles_disclosure_current on public.evaluation_cycles is
  'FULL is retired (§5 blindness). The enum value remains for historical rows; no new row may use it.';

/* ============================================================================
   2. Per-evaluation due dates
   ========================================================================== */
--
-- The cycle's dates stopped being the answer the moment ROLLING existed: two
-- people in the same rolling cycle are due on different days. Every screen that
-- shows somebody a deadline must read the EVALUATION's date.

alter table public.evaluations
  add column if not exists due_self_on date,
  add column if not exists due_lead_on date;

-- Backfill from the cycle, which is exactly what a BATCH cycle would have set.
update public.evaluations e
   set due_self_on = c.self_due_on,
       due_lead_on = c.lead_due_on
  from public.evaluation_cycles c
 where c.id = e.cycle_id
   and (e.due_self_on is null or e.due_lead_on is null);

comment on column public.evaluations.due_self_on is
  'This person''s own self deadline. BATCH copies the cycle at launch; ROLLING computes it from the day they were added.';

/* ============================================================================
   3. cycle_scope on questions
   ========================================================================== */
--
-- AMEND-2 §6. This is how the salary-expectation question exists without
-- appearing on a plain evaluation form. Assembly filters on it alongside track
-- and department.

alter table public.questions
  add column if not exists cycle_scope text not null default 'BOTH';

alter table public.questions drop constraint if exists questions_cycle_scope_valid;
alter table public.questions add constraint questions_cycle_scope_valid
  check (cycle_scope in ('BOTH', 'EVALUATION_ONLY', 'INCREMENT_ONLY'));

comment on column public.questions.cycle_scope is
  'BOTH (default), EVALUATION_ONLY or INCREMENT_ONLY. An INCREMENT_ONLY question appears only on an increment cycle''s form (§6).';

/* ---------- The salary expectation question ---------- */
--
-- §1 as amended: "Employees will also be asked what salary they consider fair."
-- INCREMENT_ONLY and EMPLOYEE_ONLY — the employee answers it, the HOD never
-- sees it, and §5's salary confinement keeps the figure to HR and the MD.
-- Deterministic id, the device P2 and 0017 both use.

insert into public.questions
  (id, text, help_text, section, response_type, category, track, answered_by,
   is_required, sort_order, cycle_scope, is_active)
values (
  md5('linkd.q.salary_expectation')::uuid,
  'What monthly salary would you consider fair for the coming year?',
  'Your answer goes only to HR and the MD. Your HOD does not see it.',
  'NARRATIVE', 'NUMBER', 'CORE', 'STAFF', 'EMPLOYEE_ONLY',
  false, 900, 'INCREMENT_ONLY', true
)
on conflict (id) do update set
  cycle_scope = 'INCREMENT_ONLY',
  answered_by = 'EMPLOYEE_ONLY',
  is_active   = true;

/* ============================================================================
   4. An invite token names its layer
   ========================================================================== */
--
-- P10-REV item 14e: "Each token grants access to its own layer only, never the
-- other. A lead's token must not open the employee's form and vice versa."
--
-- Without this column a token is scoped to an EVALUATION, and both people's
-- links would open the same screen. The layer is what makes the two tokens
-- different things rather than two copies of one thing.

alter table public.invite_tokens
  add column if not exists layer public.rating_layer not null default 'SELF';

alter table public.invite_tokens drop constraint if exists invite_tokens_layer_valid;
alter table public.invite_tokens add constraint invite_tokens_layer_valid
  check (layer in ('SELF', 'LEAD'));

comment on column public.invite_tokens.layer is
  'Which layer this link opens. A SELF token lands on /my-evaluation, a LEAD token on /team. Neither opens the other.';

-- One live token per (evaluation, layer, channel), not per (evaluation,
-- channel): the employee's link and their lead's link must coexist.
drop index if exists invite_tokens_one_live_per_channel;
create unique index if not exists invite_tokens_one_live_per_layer_channel
  on public.invite_tokens (evaluation_id, layer, channel)
  where used_at is null and revoked_at is null;

/* ============================================================================
   5. issue_invite_token gains a layer
   ========================================================================== */
--
-- The recipient is now derived from the LAYER, not assumed to be the evaluatee.
-- A LEAD token belongs to the lead, and `consume_invite_token` re-checks the
-- session against `profile_id` (P6-5) — so a lead's link cannot be burned by
-- the employee, and neither can open the other's form.
--
-- The expiry rule is unchanged: §10 ties it to the cycle. On a ROLLING cycle
-- the cycle has no fixed date, so the EVALUATION's own due date is used, which
-- is the same date the person is actually being held to.

-- Dropped rather than replaced: the signature and the return table both change,
-- and `create or replace` refuses either. The 3-argument overload goes too, so
-- there is exactly one way to issue a token and it always names a layer.
drop function if exists public.issue_invite_token(uuid, text, text);
drop function if exists public.issue_invite_token(uuid, text, text, public.rating_layer);

create function public.issue_invite_token(
  p_evaluation_id uuid,
  p_channel       text,
  p_token_hash    text,
  p_layer         public.rating_layer default 'SELF'
)
returns table (id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_caller     uuid := (select auth.uid());
  v_is_system  boolean := v_caller is null;
  v_profile    uuid;
  v_due        date;
  v_expires    timestamptz;
  v_id         uuid;
begin
  if not (v_is_system or public.is_hr()) then
    raise exception 'Only HR can issue invite links.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_layer not in ('SELF', 'LEAD') then
    raise exception 'An invite link can only be scoped to the SELF or LEAD layer.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- WHOSE link this is. The layer decides, and a LEAD token on an evaluation
  -- with no lead is refused rather than silently handed to the evaluatee.
  select case when p_layer = 'LEAD' then e.lead_id else e.evaluatee_id end,
         case when p_layer = 'LEAD'
              then coalesce(e.due_lead_on, c.lead_due_on, e.due_self_on, c.self_due_on)
              else coalesce(e.due_self_on, c.self_due_on) end
    into v_profile, v_due
  from public.evaluations e
  join public.evaluation_cycles c on c.id = e.cycle_id
  where e.id = p_evaluation_id;

  if not found then
    raise exception 'No evaluation with id %.', p_evaluation_id
      using errcode = 'no_data_found';
  end if;

  if v_profile is null then
    raise exception 'This evaluation has no % to send a link to.',
      case when p_layer = 'LEAD' then 'HOD assigned' else 'employee' end
      using errcode = 'invalid_parameter_value';
  end if;

  if v_due is null then
    raise exception
      'This evaluation has no deadline, so an invite expiry cannot be derived.'
      using errcode = 'invalid_parameter_value';
  end if;

  v_expires := (v_due + interval '7 days')::timestamptz;

  -- §10: one active token per (evaluation, LAYER, channel). Resending revokes
  -- the old one for THAT layer only — resending the employee's link must not
  -- silently kill their lead's.
  update public.invite_tokens t
  set revoked_at = now()
  where t.evaluation_id = p_evaluation_id
    and t.channel = p_channel
    and t.layer = p_layer
    and t.used_at is null
    and t.revoked_at is null;

  insert into public.invite_tokens (
    evaluation_id, profile_id, token_hash, channel, expires_at, created_by, layer
  )
  values (
    p_evaluation_id, v_profile, p_token_hash, p_channel, v_expires, v_caller, p_layer
  )
  returning invite_tokens.id into v_id;

  -- §12: every token issue is logged. The hash is recorded, never the token.
  insert into public.audit_log (actor_id, entity, entity_id, action, diff)
  values (v_caller, 'invite_token', v_id, 'invite.issued',
          jsonb_build_object('after', jsonb_build_object(
            'evaluation_id', p_evaluation_id, 'channel', p_channel,
            'layer', p_layer, 'expires_at', v_expires)));

  return query select v_id, v_expires;
end;
$fn$;

grant execute on function public.issue_invite_token(uuid, text, text, public.rating_layer)
  to authenticated;

/* ---------- verify_invite_token returns the layer ---------- */
--
-- The landing route depends on it: a SELF token goes to /my-evaluation, a LEAD
-- token to /team. Without this the consume path would have to guess from who
-- the holder is, which is the same thing by a longer route and wrong the moment
-- somebody is both.

drop function if exists public.verify_invite_token(text);

create function public.verify_invite_token(p_token_hash text)
returns table (
  status        text,
  invite_id     uuid,
  evaluation_id uuid,
  profile_id    uuid,
  email         text,
  layer         public.rating_layer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  t        public.invite_tokens%rowtype;
  v_recent integer;
  v_email  text;
begin
  select * into t from public.invite_tokens where token_hash = p_token_hash;

  if not found then
    return query select 'INVALID'::text, null::uuid, null::uuid, null::uuid, null::text,
                        null::public.rating_layer;
    return;
  end if;

  -- §10's rolling hour, derived from audit_log rather than a second column
  -- (P6-4): "every token issue/use" is already logged, so the timestamps for a
  -- genuinely rolling window exist for free.
  select count(*) into v_recent
    from public.audit_log a
   where a.entity = 'invite_token'
     and a.entity_id = t.id
     and a.action = 'invite.attempt'
     and a.created_at > now() - interval '1 hour';

  if v_recent >= 10 then
    return query select 'LOCKED'::text, t.id, null::uuid, null::uuid, null::text,
                        null::public.rating_layer;
    return;
  end if;

  insert into public.audit_log (actor_id, entity, entity_id, action)
  values (null, 'invite_token', t.id, 'invite.attempt');

  update public.invite_tokens set attempt_count = attempt_count + 1 where id = t.id;

  if t.revoked_at is not null then
    return query select 'REVOKED'::text, t.id, null::uuid, null::uuid, null::text,
                        null::public.rating_layer;
    return;
  end if;
  if t.used_at is not null then
    return query select 'USED'::text, t.id, null::uuid, null::uuid, null::text,
                        null::public.rating_layer;
    return;
  end if;
  if t.expires_at <= now() then
    return query select 'EXPIRED'::text, t.id, null::uuid, null::uuid, null::text,
                        null::public.rating_layer;
    return;
  end if;

  select p.email into v_email from public.profiles p where p.id = t.profile_id;

  return query select 'VALID'::text, t.id, t.evaluation_id, t.profile_id, v_email, t.layer;
end;
$fn$;

grant execute on function public.verify_invite_token(text) to anon, authenticated;

/* ---------- consume_invite_token returns the layer too ---------- */

drop function if exists public.consume_invite_token(uuid);

create function public.consume_invite_token(p_invite_id uuid)
returns table (status text, evaluation_id uuid, layer public.rating_layer)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  t        public.invite_tokens%rowtype;
  v_caller uuid := (select auth.uid());
begin
  select * into t from public.invite_tokens where id = p_invite_id;

  if not found then
    return query select 'INVALID'::text, null::uuid, null::public.rating_layer;
    return;
  end if;
  if v_caller is null then
    return query select 'NO_SESSION'::text, null::uuid, null::public.rating_layer;
    return;
  end if;

  -- P6-5: the session must BE the recipient. Otherwise anybody signed in could
  -- burn somebody else's link by opening it — and under AMEND-3 that includes
  -- an employee burning their own lead's link, or the reverse.
  if t.profile_id is distinct from v_caller then
    insert into public.audit_log (actor_id, entity, entity_id, action)
    values (v_caller, 'invite_token', t.id, 'invite.wrong_recipient');
    return query select 'WRONG_RECIPIENT'::text, null::uuid, null::public.rating_layer;
    return;
  end if;

  if t.revoked_at is not null then
    return query select 'REVOKED'::text, null::uuid, null::public.rating_layer;
    return;
  end if;
  if t.used_at is not null then
    return query select 'USED'::text, null::uuid, null::public.rating_layer;
    return;
  end if;
  if t.expires_at <= now() then
    return query select 'EXPIRED'::text, null::uuid, null::public.rating_layer;
    return;
  end if;

  update public.invite_tokens set used_at = now() where id = t.id;

  insert into public.audit_log (actor_id, entity, entity_id, action, diff)
  values (v_caller, 'invite_token', t.id, 'invite.used',
          jsonb_build_object('after', jsonb_build_object('layer', t.layer)));

  return query select 'OK'::text, t.evaluation_id, t.layer;
end;
$fn$;

grant execute on function public.consume_invite_token(uuid) to authenticated;

/* ============================================================================
   6. launch_cycle — dual layers, dual tokens, per-evaluation dates
   ========================================================================== */
--
-- P10-REV item 14. The old body created ONE response row (SELF) and no tokens
-- at all — tokens came later from the distribution screen. Under blind rating
-- both people are recipients from the moment of launch, so both rows and both
-- links are part of the same all-or-nothing transaction.
--
-- WHY THE TOKEN HASHES COME IN ON THE PAYLOAD
--
-- A token is 32 bytes of cryptographic randomness (§10) and Postgres is not
-- where that should be generated — `gen_random_bytes` exists, but the plaintext
-- would then have to be RETURNED from this function to be sent, which puts a
-- live secret in a result set and, from there, in any log that records one.
-- TypeScript generates the pair, sends only the SHA-256 here, and keeps the
-- plaintext in memory for the dispatch that follows the commit. Same split as
-- P10-2: TypeScript decides, SQL commits.
--
-- The function is unchanged in every other respect: still SECURITY DEFINER with
-- an internal is_hr() gate (P10-4), still all-or-nothing, still routing the
-- status change through §8's transition function.

create or replace function public.launch_cycle(p_cycle_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_caller       uuid := (select auth.uid());
  v_cycle        public.evaluation_cycles%rowtype;
  v_item         jsonb;
  v_question     jsonb;
  v_evaluation   public.evaluations%rowtype;
  v_expected     integer;
  v_evaluations  integer := 0;
  v_questions    integer := 0;
  v_tokens       integer := 0;
  v_name         text;
  v_dept_missing text;
  v_due_self     date;
  v_due_lead     date;
  v_launcher     text;
begin
  if not public.is_hr() then
    raise exception 'Only HR can launch a cycle.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_cycle from public.evaluation_cycles where id = p_cycle_id for update;

  if not found then
    raise exception 'No cycle with id %.', p_cycle_id using errcode = 'no_data_found';
  end if;
  if v_cycle.status <> 'DRAFT' then
    -- WHO launched it, from the audit row — the only place it survives.
    -- "Somebody else" is not actionable; a name is somebody HR can go and ask.
    select coalesce(p.full_name, 'another administrator') into v_launcher
      from public.audit_log a
      left join public.profiles p on p.id = a.actor_id
     where a.entity = 'cycle' and a.entity_id = p_cycle_id and a.action = 'cycle.launched'
     order by a.created_at desc
     limit 1;

    raise exception 'This cycle was already launched by %.',
      coalesce(v_launcher, 'another administrator')
      using errcode = 'unique_violation';
  end if;

  /* -- The payload must cover every live participant (P10-5). Trusting the
        caller's list is how somebody gets permanently excluded with no record.
        A ROLLING cycle is the one exception: it may open with nobody in it, and
        people are added as their dates arrive. -- */
  select count(*) into v_expected
    from public.evaluations e
   where e.cycle_id = p_cycle_id and e.excluded_at is null;

  if v_cycle.cycle_kind = 'BATCH' and v_expected = 0 then
    raise exception 'This cycle has no participants. Add people before launching.'
      using errcode = 'invalid_parameter_value';
  end if;

  if jsonb_array_length(coalesce(p_payload, '[]'::jsonb)) <> v_expected then
    raise exception
      'The launch list does not match the cycle: % participants on the cycle, % in the payload. Reload and try again.',
      v_expected, jsonb_array_length(coalesce(p_payload, '[]'::jsonb))
      using errcode = 'invalid_parameter_value';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload, '[]'::jsonb))
  loop
    select * into v_evaluation
      from public.evaluations
     where id = (v_item ->> 'evaluation_id')::uuid
       and cycle_id = p_cycle_id
     for update;

    if not found then
      raise exception 'Participant % is not on this cycle.', v_item ->> 'evaluation_id'
        using errcode = 'no_data_found';
    end if;

    select full_name into v_name from public.profiles where id = v_evaluation.evaluatee_id;

    /* -- 1. Blocking checks -- */
    if v_evaluation.lead_id is null then
      raise exception '% has no HOD assigned, so their form has nobody to go to.', v_name
        using errcode = 'invalid_parameter_value';
    end if;

    -- P10-REV item 10. Under blind rating a person who is their own HOD would
    -- fill both sides and see both, which breaks §5's blindness invariant
    -- outright. P10-7 dropped the old constraint so the wizard could REACH this
    -- case and flag it; this is where it is refused.
    if v_evaluation.lead_id = v_evaluation.evaluatee_id then
      raise exception
        '% is recorded as their own HOD. Under blind rating nobody can rate themselves — assign a different rater.',
        v_name
        using errcode = 'invalid_parameter_value';
    end if;

    if v_evaluation.track <> 'STAFF' then
      raise exception '% is not on the staff track. This cycle is staff only (§5).', v_name
        using errcode = 'invalid_parameter_value';
    end if;

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

    /* -- 2. This person's own deadlines (item 3).
          BATCH copies the cycle. ROLLING counts from today, because on a rolling
          cycle "today" is the day this person became due. -- */
    if v_cycle.cycle_kind = 'ROLLING' then
      v_due_self := (current_date + (v_cycle.default_self_days || ' days')::interval)::date;
      v_due_lead := (current_date + (v_cycle.default_lead_days || ' days')::interval)::date;
    else
      v_due_self := v_cycle.self_due_on;
      v_due_lead := v_cycle.lead_due_on;
    end if;

    update public.evaluations
       set due_self_on = v_due_self,
           due_lead_on = v_due_lead
     where id = v_evaluation.id;

    /* -- 3. Freeze the snapshot (§5).
          The payload is already filtered by cycle_scope — assembly happens in
          TypeScript, where the one merge algorithm lives (P10-2). A second
          filter here would be a second algorithm to keep in step. -- */
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

    /* -- 4. BOTH empty response rows (item 14c).
          The lead's row is new in this phase: they are a recipient from launch
          now, not from the employee's submission, so their form must exist to
          open. -- */
    insert into public.evaluation_responses (evaluation_id, layer, answers, comments)
    values (v_evaluation.id, 'SELF', '{}'::jsonb, '{}'::jsonb),
           (v_evaluation.id, 'LEAD', '{}'::jsonb, '{}'::jsonb)
    on conflict (evaluation_id, layer) do nothing;

    /* -- 5. DRAFT -> OPEN through §8's function. Never a direct UPDATE. -- */
    perform public.apply_evaluation_transition(
      p_evaluation_id => v_evaluation.id,
      p_from_status   => 'DRAFT',
      p_to_status     => 'OPEN',
      p_actor_id      => v_caller,
      p_action        => 'evaluation.launched',
      p_reason        => null,
      p_diff          => jsonb_build_object(
                           'cycle_id', p_cycle_id,
                           'lead_id', v_evaluation.lead_id,
                           'due_self_on', v_due_self,
                           'due_lead_on', v_due_lead,
                           'question_count', jsonb_array_length(v_item -> 'questions')
                         )
    );

    /* -- 6. TWO invite tokens, one per layer (item 14e).
          Each is scoped to its own layer and its own recipient, so a lead's
          link cannot open the employee's form: `consume_invite_token` refuses a
          session that is not the token's `profile_id`, and the layer decides
          where the holder lands. -- */
    if v_item ? 'self_token_hash' then
      perform public.issue_invite_token(
        v_evaluation.id, v_item ->> 'channel', v_item ->> 'self_token_hash', 'SELF');
      v_tokens := v_tokens + 1;
    end if;

    if v_item ? 'lead_token_hash' then
      perform public.issue_invite_token(
        v_evaluation.id, v_item ->> 'channel', v_item ->> 'lead_token_hash', 'LEAD');
      v_tokens := v_tokens + 1;
    end if;

    v_evaluations := v_evaluations + 1;
  end loop;

  /* -- 7. The cycle itself. -- */
  update public.evaluation_cycles
  set status = 'ACTIVE', launched_at = now()
  where id = p_cycle_id and status = 'DRAFT';

  if not found then
    raise exception 'This cycle changed while it was being launched. Reload and try again.'
      using errcode = 'serialization_failure';
  end if;

  insert into public.audit_log (actor_id, entity, entity_id, action, from_status, to_status, diff)
  values (
    v_caller, 'cycle', p_cycle_id, 'cycle.launched', 'DRAFT', 'ACTIVE',
    jsonb_build_object('evaluations', v_evaluations, 'questions', v_questions,
                       'tokens', v_tokens, 'cycle_type', v_cycle.cycle_type,
                       'cycle_kind', v_cycle.cycle_kind)
  );

  return jsonb_build_object(
    'cycle_id', p_cycle_id,
    'evaluations', v_evaluations,
    'questions', v_questions,
    'tokens', v_tokens
  );
end;
$fn$;

commit;
