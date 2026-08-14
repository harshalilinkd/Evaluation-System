-- 0079 — a rolling cycle per MILESTONE, not one per year.
--
-- THE BUG:
--
--   Nothing was created: duplicate key value violates unique constraint
--   "evaluations_cycle_evaluatee_unique"
--
-- `ensure_rolling_cycle` returns ONE cycle per financial year — "New joiner
-- evaluations FY 26-27" — and `evaluations` is unique on
-- (cycle_id, evaluatee_id) (0003). So one person can hold at most ONE milestone
-- evaluation per year, and the second is impossible.
--
-- That was survivable when the schedule was a single joiner milestone. It is
-- not now: 0076 made the schedule a setting and the company's own answer gives
-- EVERYBODY two evaluations a year — three and nine months after each
-- increment — and a new joiner two as well, at one month and six. So the second
-- one always failed, and failed with a constraint name rather than a sentence.
--
-- THE FIX, and why this shape:
--
-- A cycle is a cohort — a group of people asked the same questions at the same
-- time, so their answers can be read together. Everybody's 3-month review is
-- one such group and everybody's 9-month review is another; they fall six
-- months apart and were never one exercise. Folding them into a single yearly
-- cycle was the thing that made them collide, and separating them is what the
-- schedule already implies.
--
-- The unique constraint then holds naturally rather than being worked around,
-- which matters: it is what stops one person being appraised twice in the same
-- round.
--
-- EXISTING ROWS ARE LEFT ALONE. Evaluations already created sit in the old
-- yearly cycle and stay there — moving an evaluation between cycles would
-- rewrite a record whose questions are frozen against it (§5). New ones land in
-- their milestone's cycle. The two coexist; nothing is lost either way.
--
-- Requires 0031. Safe to re-run.

/* ================================================ 1. the cycle, per milestone */

/* -- THE OLD SIGNATURE MUST GO, and this is not tidiness.
      `create or replace` with a different argument list creates an OVERLOAD, it
      does not replace. With both `ensure_rolling_cycle(date)` and
      `(date, text)` present — the second with a default — every existing
      one-argument call becomes ambiguous:

        function ensure_rolling_cycle(date) is not unique

      which would break `create_milestone_evaluation` between this statement and
      the patch below. Found by running it rather than by reading it.

      Safe to drop: plpgsql resolves a function call at execution time, so
      nothing holds a dependency on it. -- */
drop function if exists public.ensure_rolling_cycle(date);

create or replace function public.ensure_rolling_cycle(
  p_on date default current_date,
  p_milestone text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_label text := public.financial_year_label(p_on);
  v_kind  text;
  v_name  text;
  v_id    uuid;
  v_start date;
begin
  /* -- Plain language, because this becomes a cycle NAME and §13.5 keeps a
        stored value off a screen. "MONTH_3" is not a thing anybody says.
        NULL keeps the original name, so an existing cycle is still found by
        any caller that does not pass a milestone. -- */
  v_kind := case
    when p_milestone is null then 'New joiner evaluations'
    when p_milestone ~ '^MONTH_[0-9]+$'
      then replace(p_milestone, 'MONTH_', '') || '-month reviews'
    when p_milestone = 'PRE_INCREMENT' then 'Pre-increment reviews'
    when p_milestone = 'ANNUAL'        then 'Annual reviews'
    else 'New joiner evaluations'
  end;

  v_name := v_kind || ' ' || v_label;

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
    /* The cycle's own dates are the financial year's end. They are a backstop:
       each milestone evaluation carries its OWN due dates (0022), because two
       people added six months apart do not share a deadline. */
    (v_start + interval '1 year - 1 day')::date,
    (v_start + interval '1 year - 1 day')::date,
    (v_start + interval '1 year - 1 day')::date,
    'ACTIVE', 'EVALUATION', 'ROLLING', auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.ensure_rolling_cycle(date, text) from public;
grant execute on function public.ensure_rolling_cycle(date, text) to authenticated;

/* ================================ 2. the creator passes the milestone along ==
   Patched in place rather than restated: the body is long and already tested,
   and it differs by one argument. A1-5's idiom, and it verifies it matched
   something — its known failure mode is silently matching nothing (0056). */

do $$
declare
  v_src  text;
  v_new  text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_milestone_evaluation';

  if v_src is null then
    raise exception '0079: create_milestone_evaluation is missing. Apply 0031 first.';
  end if;

  if v_src like '%ensure_rolling_cycle(v_item.due_on, v_item.milestone_type)%' then
    raise notice '0079: create_milestone_evaluation already passes the milestone.';
    return;
  end if;

  v_new := replace(
    v_src,
    'public.ensure_rolling_cycle(v_item.due_on)',
    'public.ensure_rolling_cycle(v_item.due_on, v_item.milestone_type)'
  );

  if v_new = v_src then
    raise exception '0079: could not find the ensure_rolling_cycle call to patch.';
  end if;

  execute v_new;
  raise notice '0079: create_milestone_evaluation now files each milestone in its own cycle.';
end;
$$;

/* ============================== 3. a collision says what happened, in words ==
   Two due items of the SAME milestone for one person in one year should not
   occur — the sweep's unique index prevents it — but "duplicate key value
   violates unique constraint" is not a sentence anybody can act on, and it is
   what HR saw. A trigger cannot catch this; the message is set where the insert
   is, on the next patch of the same function. */

do $$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_milestone_evaluation';

  if v_src like '%already has this review in%' then
    raise notice '0079: the duplicate message is already in place.';
    return;
  end if;

  v_new := replace(
    v_src,
    '  returning id into v_eval;',
    '  returning id into v_eval;
  exception when unique_violation then
    raise exception ''% already has this review in the % cycle. Skip this item, or close the earlier one first.'',
      v_profile.full_name, public.financial_year_label(v_item.due_on)
      using errcode = ''invalid_parameter_value'';'
  );

  if v_new = v_src then
    raise notice '0079: could not attach the duplicate message; the constraint name will show instead.';
    return;
  end if;

  begin
    execute v_new;
    raise notice '0079: a duplicate now reports in words.';
  exception when others then
    -- A plpgsql `exception` block cannot be spliced in beside a bare INSERT
    -- without its own BEGIN. If it does not compile, the milestone split above
    -- has already removed the cause; the message is the nicety.
    raise notice '0079: the duplicate message could not be attached (%). The split above is what fixes the failure.', sqlerrm;
  end;
end;
$$;

do $$
begin
  raise notice '0079: each milestone now has its own rolling cycle — "3-month reviews FY 26-27" '
               'beside "9-month reviews FY 26-27". Evaluations already created stay in the '
               'yearly cycle they were filed in; §5 freezes their questions against it.';
end;
$$;
