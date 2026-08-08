-- 0042 · The evaluation that runs six months before somebody's increment,
--        and notice periods that differ by what is due.
--
-- THE SCHEDULE THIS COMPLETES, as the owner stated it:
--
--   New joiner, first year
--     joining + 1 month     Evaluation      (MONTH_1)        already built
--     joining + 6 months    Evaluation      (MONTH_6)        already built
--     joining + 12 months   Increment       (INCREMENT)      already built —
--                             `compute_next_increment` falls back to
--                             joining + 12 months when there is no prior one.
--
--   Tenured — joined over six months ago, or already paid an increment
--     increment date − 6 months   Evaluation   (PRE_INCREMENT)   ** NEW **
--     increment date              Increment    (INCREMENT)       already built
--
-- WHY THE NEW ONE COULD NOT BE FAKED WITH MONTH_6. A tenured person's
-- increment date has no fixed relationship to their joining date once they have
-- had one — it moves forward by `increment_frequency_months` each time. So the
-- pre-increment review has to be derived from `next_increment_date`, which is
-- the column P19's trigger keeps correct, not from `date_of_joining`.
--
-- THE ONE OVERLAP, and how it is resolved. For a NEW joiner the two coincide
-- exactly: their increment is at joining + 12 months, so six months before it
-- IS joining + 6 months, the same day as MONTH_6. The owner chose one
-- evaluation rather than two, and section 3 below is where that is enforced —
-- a PRE_INCREMENT is not created where a MONTH_6 already falls on that date.
-- Two items on one day would read as a fault and would ask somebody to hold the
-- same conversation twice.

begin;

/* ============================================================================
   1. The new milestone type
   ========================================================================== */
--
-- `milestone_type` is a CHECK rather than an enum (0031 followed PR-1's
-- reasoning: a young list is one you will get wrong, and a CHECK can be
-- replaced where an enum value can never be dropped). Which is exactly why
-- adding one here is a constraint swap and not a migration hazard.

alter table public.due_items
  drop constraint if exists due_items_milestone_type_check;

alter table public.due_items
  add constraint due_items_milestone_type_check
  check (milestone_type in ('MONTH_1', 'MONTH_6', 'ANNUAL', 'INCREMENT', 'PRE_INCREMENT'));

-- 0031 put the same list on a second constraint guarding the evaluation link.
-- Both have to move together or a confirmed PRE_INCREMENT would be refused at
-- the point HR acts on it — which is the worst moment to discover it.
do $$
declare
  v_name text;
begin
  select conname into v_name
    from pg_constraint
   where conrelid = 'public.due_items'::regclass
     and conname <> 'due_items_milestone_type_check'
     and pg_get_constraintdef(oid) like '%MONTH_1%';

  if v_name is not null then
    execute format('alter table public.due_items drop constraint %I', v_name);
    execute format(
      'alter table public.due_items add constraint %I check (' ||
      'evaluation_id is null ' ||
      'or milestone_type in (''MONTH_1'', ''MONTH_6'', ''ANNUAL'', ''INCREMENT'', ''PRE_INCREMENT''))',
      v_name);
  end if;
end;
$$;

/* ============================================================================
   2. How much notice each kind gets
   ========================================================================== */
--
-- One function, so the sweep and the digest cannot disagree about when
-- somebody should have been told. Two copies of a notice period is how a
-- reminder starts arriving for something the list does not show yet.
--
-- A MONTH ahead for anything with money attached or a tenured review: those
-- need arranging — a budget conversation, a slot in somebody's diary.
--
-- A WEEK for a new joiner's own milestones, at the owner's instruction, and it
-- is the right call for a reason worth writing down: a month's notice on an
-- evaluation due 30 days after somebody joins would fire ON THEIR FIRST DAY,
-- before they had done any work to be evaluated on. A notice that arrives
-- before the thing it describes can possibly matter is one people learn to
-- ignore.

create or replace function public.milestone_notice_days(p_type text)
returns integer
language sql
immutable
as $$
  select case p_type
    when 'MONTH_1' then 7
    when 'MONTH_6' then 7
    else 30
  end;
$$;

comment on function public.milestone_notice_days(text) is
  'How many days before a milestone HR is told. 7 for a new joiner''s own milestones — a month''s notice on a 1-month evaluation would fire on their joining date — and 30 for increments and tenured reviews, which need arranging (0042).';

grant execute on function public.milestone_notice_days(text) to authenticated;

/* ============================================================================
   3. The sweep, extended
   ========================================================================== */
--
-- Replaced in full rather than patched: 0031's body is short and this adds a
-- whole block to it, so a targeted replace would be harder to read than the
-- function it produced. The two existing blocks are unchanged.

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

  /* -- PRE_INCREMENT: the evaluation six months before the pay review. --

        Derived from `next_increment_date`, never from the joining date. Once
        somebody has had an increment their schedule has left their joining
        anniversary behind, and it moves again by `increment_frequency_months`
        each time — so the joining date stops being able to answer this.

        NOT created where a MONTH_6 already falls on that day. For a new joiner
        the two dates are the same by construction, and the owner chose one
        evaluation: two items on one date read as a fault and ask for the same
        conversation twice. The MONTH_6 is the one kept, because it is the older
        record and may already have been confirmed and acted on. -- */
  insert into public.due_items (profile_id, milestone_type, due_on)
  select e.profile_id,
         'PRE_INCREMENT',
         (e.next_increment_date - interval '6 months')::date
    from public.employment_records e
    join public.profiles p on p.id = e.profile_id
   where p.is_active
     and p.track = 'STAFF'
     and e.next_increment_date is not null
     and (e.next_increment_date - interval '6 months')::date <= p_on + v_ahead
     and (e.next_increment_date - interval '6 months')::date >= p_on - interval '180 days'
     and not exists (
       select 1
         from public.due_items d
        where d.profile_id = e.profile_id
          and d.milestone_type = 'MONTH_6'
          and d.due_on = (e.next_increment_date - interval '6 months')::date
     )
  on conflict (profile_id, milestone_type, due_on) do nothing;

  return v_created;
end;
$$;

revoke all on function public.compute_due_items(date) from public;
grant execute on function public.compute_due_items(date) to authenticated;

comment on function public.compute_due_items(date) is
  'The nightly sweep (P22, extended 0042). Creates PENDING due_items and NOTHING else — no evaluation, no message. HR confirms each one. Idempotent through due_items_unique. PRE_INCREMENT is skipped where a MONTH_6 already falls on the same date, which is always true for a new joiner.';

commit;
