-- 0031_due_items.sql
-- Automatic scheduling of what is due (P22).
--
-- `cycle_kind` is NOT added here: 0022 already added it, with the same BATCH /
-- ROLLING check the brief asks for. Only `milestone_type`, the pending-item
-- table and the two functions are new.
--
-- THE RULE THAT SHAPES THIS FILE: the nightly job computes who is due and
-- creates a PENDING ITEM. It does not create the evaluation. HR confirms.
-- An appraisal that appeared in somebody's WhatsApp because a clock ticked is
-- an appraisal nobody chose to run.
--
-- SAFE TO RE-RUN.

begin;

/* ============================================================================
   1. milestone_type
   ========================================================================== */

alter table public.evaluations
  add column if not exists milestone_type text;

alter table public.evaluations drop constraint if exists evaluations_milestone_valid;
alter table public.evaluations add constraint evaluations_milestone_valid
  check (milestone_type is null
         or milestone_type in ('MONTH_1', 'MONTH_6', 'ANNUAL', 'INCREMENT'));

comment on column public.evaluations.milestone_type is
  'Why this evaluation exists (P22). NULL on every row that predates it and on any evaluation created by a batch launch.';

/* ============================================================================
   2. due_items — what the nightly job finds, before HR acts on it
   ========================================================================== */

create table if not exists public.due_items (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references public.profiles(id) on delete cascade,
  milestone_type text not null,
  due_on         date not null,

  status         text not null default 'PENDING',
  skip_reason    text,

  -- Set once HR confirms. The item is the record that this was scheduled; the
  -- evaluation is the record that it happened.
  evaluation_id  uuid references public.evaluations(id) on delete set null,

  actioned_by    uuid references public.profiles(id),
  actioned_at    timestamptz,
  created_at     timestamptz not null default now()
);

alter table public.due_items drop constraint if exists due_items_milestone_valid;
alter table public.due_items add constraint due_items_milestone_valid
  check (milestone_type in ('MONTH_1', 'MONTH_6', 'ANNUAL', 'INCREMENT'));

alter table public.due_items drop constraint if exists due_items_status_valid;
alter table public.due_items add constraint due_items_status_valid
  check (status in ('PENDING', 'CREATED', 'SKIPPED'));

-- The idempotency the nightly job depends on: running twice cannot produce two
-- items for the same milestone.
create unique index if not exists due_items_unique
  on public.due_items (profile_id, milestone_type, due_on);

create index if not exists due_items_pending_idx
  on public.due_items (status, due_on) where status = 'PENDING';

alter table public.due_items enable row level security;

-- §5 again: a due item names a person and a date, and the INCREMENT ones say
-- somebody's pay is being reviewed. HR and the MD only.
drop policy if exists "due items: admins read" on public.due_items;
create policy "due items: admins read" on public.due_items
  for select to authenticated using (public.is_hr() or public.is_md());

drop policy if exists "due items: hr writes" on public.due_items;
create policy "due items: hr writes" on public.due_items
  for update to authenticated using (public.is_hr()) with check (public.is_hr());

-- No client INSERT and no DELETE for anyone: items are created by the nightly
-- function below, and an item that can be deleted is a milestone that can be
-- made to have never been due.

grant select, update on public.due_items to authenticated;

comment on table public.due_items is
  'What the nightly job found to be due (P22). PENDING until HR creates the evaluation or skips it with a reason. The job never creates an evaluation itself.';

/* ============================================================================
   3. The rolling cycle for a financial year
   ========================================================================== */
--
-- A rolling cycle is an ordinary cycle that never closes until the financial
-- year ends: same snapshot, same RLS, same statuses, same report. Individual
-- evaluations are added to it as people reach their dates, rather than a batch
-- being launched into it.
--
-- India's financial year runs April to March, which is why the name is
-- "FY 26-27" rather than a calendar year.

create or replace function public.financial_year_label(p_on date)
returns text
language sql
immutable
as $$
  select case
    when extract(month from p_on) >= 4
      then 'FY ' || to_char(p_on, 'YY') || '-' || to_char(p_on + interval '1 year', 'YY')
    else 'FY ' || to_char(p_on - interval '1 year', 'YY') || '-' || to_char(p_on, 'YY')
  end;
$$;

create or replace function public.ensure_rolling_cycle(p_on date default current_date)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_label text := public.financial_year_label(p_on);
  v_name  text := 'New joiner evaluations ' || v_label;
  v_id    uuid;
  v_start date;
begin
  select id into v_id from public.evaluation_cycles where name = v_name;
  if v_id is not null then
    return v_id;
  end if;

  v_start := case
    when extract(month from p_on) >= 4
      then make_date(extract(year from p_on)::int, 4, 1)
      else make_date(extract(year from p_on)::int - 1, 4, 1)
  end;

  insert into public.evaluation_cycles (
    name, period_label, track_scope, starts_on,
    self_due_on, lead_due_on, md_due_on,
    status, cycle_type, cycle_kind, created_by
  )
  values (
    v_name, v_label, 'STAFF', v_start,
    -- The cycle's own dates are the financial year's end. They are a backstop:
    -- a rolling evaluation carries its OWN due dates (0022's due_self_on /
    -- due_lead_on), set from the day it is created, because two people added
    -- three months apart do not share a deadline.
    v_start + interval '1 year' - interval '1 day',
    v_start + interval '1 year' - interval '1 day',
    v_start + interval '1 year' - interval '1 day',
    'ACTIVE', 'EVALUATION', 'ROLLING', null
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.ensure_rolling_cycle(date) from public;
grant execute on function public.ensure_rolling_cycle(date) to authenticated;

/* ============================================================================
   4. The nightly sweep — who is due
   ========================================================================== */
--
-- MONTH_1  at date_of_joining + 30 days
-- MONTH_6  at date_of_joining + 6 months
-- INCREMENT at employment_records.next_increment_date
-- ANNUAL   is NOT computed here. It comes from the yearly batch cycle, and
--          inventing an annual item per person would duplicate every batch
--          participant as a second thing HR has to dismiss.
--
-- Looks a window ahead rather than only at today: HR needs to see what is
-- coming, and an item that appears on the morning it is due leaves no time to
-- act. Items are created once and then live on their own — the unique index is
-- what makes a second run a no-op.

create or replace function public.compute_due_items(p_on date default current_date)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_created integer := 0;
  v_ahead   interval := interval '45 days';
begin
  /* -- MONTH_1 and MONTH_6, from the ONE joining date (0024). -- */
  insert into public.due_items (profile_id, milestone_type, due_on)
  select p.id, m.kind, m.due
    from public.profiles p
    cross join lateral (values
      ('MONTH_1', p.date_of_joining + 30),
      ('MONTH_6', (p.date_of_joining + interval '6 months')::date)
    ) as m(kind, due)
   where p.is_active
     and p.track = 'STAFF'
     and p.date_of_joining is not null
     and m.due <= p_on + v_ahead
     -- A milestone that fell before the person was in the system is history,
     -- not a task. Six months' grace, so a recent joiner entered late is still
     -- picked up.
     and m.due >= p_on - interval '180 days'
  on conflict (profile_id, milestone_type, due_on) do nothing;

  get diagnostics v_created = row_count;

  /* -- INCREMENT, from the derived date P19 maintains. -- */
  insert into public.due_items (profile_id, milestone_type, due_on)
  select e.profile_id, 'INCREMENT', e.next_increment_date
    from public.employment_records e
    join public.profiles p on p.id = e.profile_id
   where p.is_active
     and p.track = 'STAFF'
     and e.next_increment_date is not null
     and e.next_increment_date <= p_on + v_ahead
     and e.next_increment_date >= p_on - interval '180 days'
  on conflict (profile_id, milestone_type, due_on) do nothing;

  return v_created;
end;
$$;

revoke all on function public.compute_due_items(date) from public;
grant execute on function public.compute_due_items(date) to authenticated;

comment on function public.compute_due_items(date) is
  'The nightly sweep (P22). Creates PENDING due_items and NOTHING else — no evaluation, no message. HR confirms each one. Idempotent through due_items_unique.';

/* ============================================================================
   5. HR confirming one — create, snapshot, open
   ========================================================================== */
--
-- The single-person equivalent of `launch_cycle` (0009/0022), and it follows
-- the same split: TypeScript assembles the question list — the merge algorithm
-- lives in `assembleForDepartment` and reimplementing it in SQL would give two
-- that must agree forever — and this commits, all or nothing.
--
-- The invite tokens arrive as hashes for the same reason `launch_cycle` takes
-- them that way (PR-6): generating them here would mean RETURNING a live secret
-- in a result set, and from there into any log that records one.

create or replace function public.create_milestone_evaluation(
  p_due_item_id  uuid,
  p_questions    jsonb,
  p_lead_id      uuid,
  p_due_self_on  date,
  p_due_lead_on  date,
  p_self_token   text,
  p_lead_token   text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor    uuid := (select auth.uid());
  v_item     public.due_items%rowtype;
  v_profile  public.profiles%rowtype;
  v_cycle    uuid;
  v_eval     uuid;
  v_question jsonb;
  v_order    integer := 0;
begin
  if v_actor is not null and not public.is_hr() then
    raise exception 'Only HR can create a milestone evaluation.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_item from public.due_items where id = p_due_item_id for update;
  if not found then
    raise exception 'No such item.' using errcode = 'no_data_found';
  end if;
  if v_item.status <> 'PENDING' then
    raise exception 'That item has already been dealt with.'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_profile from public.profiles where id = v_item.profile_id;
  if v_profile.department_id is null then
    raise exception '% has no department, so there is no form to give them.', v_profile.full_name
      using errcode = 'invalid_parameter_value';
  end if;
  if p_lead_id is null then
    raise exception '% has nobody to rate them. Set who they report to first.', v_profile.full_name
      using errcode = 'invalid_parameter_value';
  end if;
  if p_lead_id = v_item.profile_id then
    -- PR-8: under blind rating this is not merely odd — that person would fill
    -- both sides and see both, which breaks §5 outright.
    raise exception 'Somebody cannot rate themselves.' using errcode = 'invalid_parameter_value';
  end if;

  v_cycle := public.ensure_rolling_cycle(v_item.due_on);

  insert into public.evaluations (
    cycle_id, evaluatee_id, lead_id, department_id, track, status,
    milestone_type, due_self_on, due_lead_on
  )
  values (
    v_cycle, v_item.profile_id, p_lead_id, v_profile.department_id, 'STAFF', 'DRAFT',
    v_item.milestone_type, p_due_self_on, p_due_lead_on
  )
  returning id into v_eval;

  /* -- The frozen snapshot (§5). Assembled in TypeScript, committed here. -- */
  for v_question in select * from jsonb_array_elements(p_questions) loop
    v_order := v_order + 10;
    insert into public.evaluation_questions (
      evaluation_id, question_id, text, help_text, section, response_type,
      answered_by, is_required, min_value, max_value, depends_on, depends_value,
      options, sort_order
    )
    values (
      v_eval,
      (v_question ->> 'question_id')::uuid,
      v_question ->> 'text',
      v_question ->> 'help_text',
      (v_question ->> 'section')::public.question_section,
      (v_question ->> 'response_type')::public.response_type,
      (v_question ->> 'answered_by')::public.answered_by,
      coalesce((v_question ->> 'is_required')::boolean, false),
      nullif(v_question ->> 'min_value', '')::numeric,
      nullif(v_question ->> 'max_value', '')::numeric,
      nullif(v_question ->> 'depends_on', '')::uuid,
      nullif(v_question ->> 'depends_value', ''),
      v_question -> 'options',
      v_order
    );
  end loop;

  if v_order = 0 then
    raise exception 'There are no questions for %''s department.', v_profile.full_name
      using errcode = 'invalid_parameter_value';
  end if;

  -- Both layers open at once (§8 as amended), so both rows exist from the start.
  insert into public.evaluation_responses (evaluation_id, layer, answers, comments)
  values (v_eval, 'SELF', '{}'::jsonb, '{}'::jsonb),
         (v_eval, 'LEAD', '{}'::jsonb, '{}'::jsonb);

  perform public.apply_evaluation_transition(
    p_evaluation_id := v_eval,
    p_from_status   := 'DRAFT'::public.evaluation_status,
    p_to_status     := 'OPEN'::public.evaluation_status,
    p_actor_id      := v_actor,
    p_action        := 'evaluation.milestone_opened',
    p_diff          := jsonb_build_object('milestone', v_item.milestone_type));

  /* -- One token per layer (PR-5), so the two links open different forms. -- */
  if p_self_token is not null then
    insert into public.invite_tokens (evaluation_id, profile_id, token_hash, expires_at, channel, layer)
    values (v_eval, v_item.profile_id, p_self_token, (p_due_self_on + 7)::timestamptz, 'whatsapp', 'SELF');
  end if;
  if p_lead_token is not null then
    insert into public.invite_tokens (evaluation_id, profile_id, token_hash, expires_at, channel, layer)
    values (v_eval, p_lead_id, p_lead_token, (p_due_lead_on + 7)::timestamptz, 'whatsapp', 'LEAD');
  end if;

  update public.due_items
     set status = 'CREATED', evaluation_id = v_eval,
         actioned_by = v_actor, actioned_at = now()
   where id = p_due_item_id;

  return jsonb_build_object('evaluation_id', v_eval, 'cycle_id', v_cycle, 'questions', v_order / 10);
end;
$$;

revoke all on function public.create_milestone_evaluation(uuid, jsonb, uuid, date, date, text, text) from public;
grant execute on function public.create_milestone_evaluation(uuid, jsonb, uuid, date, date, text, text) to authenticated;

comment on function public.create_milestone_evaluation(uuid, jsonb, uuid, date, date, text, text) is
  'HR confirming one due item: creates the evaluation in the financial year''s rolling cycle, freezes the snapshot, opens both layers and issues both tokens — in ONE transaction. Questions are assembled in TypeScript, so there is one merge algorithm (P10-2).';

commit;
