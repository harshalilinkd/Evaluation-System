-- 0076 · The evaluation schedule becomes a setting.
--
-- AT THE OWNER'S EXPLICIT INSTRUCTION: "Add a tab in Settings to manage these
-- schedules … so HR can configure how many evaluations per year and the month
-- intervals between them (and the increment interval), rather than having them
-- hard-coded."
--
-- THE SCHEDULE, AS THE OWNER DESCRIBED IT. Two anchors, and the second repeats:
--
--   A NEW JOINER is anchored to their JOINING DATE:
--     +1 month    evaluation
--     +6 months   evaluation
--     +12 months  increment
--
--   AFTER THAT everybody is anchored to their LAST INCREMENT, and the loop
--   starts again at every increment:
--     +3 months   evaluation
--     +9 months   evaluation      ("after 6 months of first evaluation")
--     +12 months  increment       ("after that no evaluation cycle — it will be
--                                   the increment cycle")
--
-- So an established employee gets two evaluations and one increment a year, and
-- the clock re-anchors each time they are given a rise — which is what makes it
-- a loop rather than a list of dates counted from a joining date years ago.
--
-- WHY MONTHS IN AN ARRAY RATHER THAN COLUMNS. "How many evaluations per year"
-- is the thing being configured, so the COUNT has to be data. Three columns
-- would fix it at three; an array lets HR run one review a year or four without
-- a migration, which is the whole point of the request. Same device
-- `increment_settings.hike_bands` already uses (P21-16).
--
-- ONE ROW, enforced by a CHECK on a boolean primary key — the P17-6 idiom. It
-- must outlive a request and be readable by cron, which has no session, so it
-- is not a cookie, not a module variable and not an env var needing a redeploy.

/* ---------- The setting ---------- */

create table if not exists public.evaluation_schedule (
  id boolean primary key default true,

  /* Months after JOINING at which a new joiner is evaluated. */
  joiner_evaluation_months int[] not null default '{1,6}',
  /* Months after joining at which their first increment falls. */
  joiner_increment_months  int   not null default 12,

  /* Months after the LAST INCREMENT at which an established employee is
     evaluated. The loop re-anchors at every increment. */
  cycle_evaluation_months  int[] not null default '{3,9}',
  /* And how long that loop is. This is the DEFAULT: a person whose employment
     record names a different `increment_frequency_months` keeps theirs, because
     a contract can differ from the company norm. */
  cycle_increment_months   int   not null default 12,

  /* How far ahead HR is warned. Kept here rather than in code so the whole
     schedule is configured in one place. */
  notice_days              int   not null default 30,

  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),

  constraint evaluation_schedule_single_row check (id)
);

comment on table public.evaluation_schedule is
  'How employee evaluation and increment dates are calculated. One row. Changing it recalculates every pending due item (0076).';

/* -- The simple bounds as a CHECK. -- */
alter table public.evaluation_schedule drop constraint if exists evaluation_schedule_sane;
alter table public.evaluation_schedule add constraint evaluation_schedule_sane
  check (
    joiner_increment_months between 1 and 120
    and cycle_increment_months between 1 and 120
    and notice_days between 0 and 180
  );

/* -- THE ARRAY RULE AS A TRIGGER, because a CHECK cannot hold a subquery and
      "every month is inside the cycle" needs one to be expressed honestly.

      A function marked IMMUTABLE would let the CHECK compile, and it would be a
      lie: the answer depends on another column and Postgres would not
      re-validate it if the function changed. A trigger is evaluated every time,
      which is what this actually needs.

      AN EVALUATION ON OR AFTER THE INCREMENT IT PRECEDES belongs to the NEXT
      cycle, not this one — at 12 months of a 12-month loop it would be created
      twice and read as a duplicate nobody can explain.

      Empty is allowed. "No evaluations, only the pay review" is a real choice
      and refusing it would make the setting less configurable than the thing it
      replaced. -- */
create or replace function public.evaluation_schedule_months_valid()
returns trigger
language plpgsql
as $$
declare
  v_bad int;
begin
  select m into v_bad
    from unnest(coalesce(new.joiner_evaluation_months, '{}')) as m
   where m < 1 or m >= new.joiner_increment_months
   limit 1;
  if v_bad is not null then
    raise exception 'A new joiner''s evaluation at month % falls on or after their first increment at month %. It has to come before it.',
      v_bad, new.joiner_increment_months
      using errcode = 'check_violation';
  end if;

  select m into v_bad
    from unnest(coalesce(new.cycle_evaluation_months, '{}')) as m
   where m < 1 or m >= new.cycle_increment_months
   limit 1;
  if v_bad is not null then
    raise exception 'An evaluation at month % falls on or after the next increment at month %. It has to come before it.',
      v_bad, new.cycle_increment_months
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists evaluation_schedule_months_valid on public.evaluation_schedule;
create trigger evaluation_schedule_months_valid
  before insert or update on public.evaluation_schedule
  for each row execute function public.evaluation_schedule_months_valid();

insert into public.evaluation_schedule (id) values (true) on conflict (id) do nothing;

alter table public.evaluation_schedule enable row level security;

/* -- READABLE BY ANY SIGNED-IN USER. It is not confidential — it is when their
      own review falls — and the scorecard and the due screen both read it under
      the caller's own session. Cron uses the service client and bypasses RLS. -- */
drop policy if exists "schedule: read" on public.evaluation_schedule;
create policy "schedule: read"
  on public.evaluation_schedule for select
  to authenticated
  using (true);

/* -- NO WRITE POLICY FOR ANYONE. `save_evaluation_schedule` is the write path:
      SECURITY DEFINER, HR-gated, audited, and it recalculates in the same
      transaction. Absence is the enforcement (P5-9). -- */

grant select on public.evaluation_schedule to authenticated;

/* ---------- The sweep, driven by the setting ---------- */

create or replace function public.compute_due_items(p_on date default current_date)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_created  integer := 0;
  v_ahead    interval;
  v_schedule public.evaluation_schedule;
begin
  select * into v_schedule from public.evaluation_schedule where id;
  if not found then
    raise exception '0076: the evaluation schedule row is missing.';
  end if;

  /* -- HOW FAR AHEAD, from the setting rather than a hard-coded 45 days.
        Floored at the notice period plus a fortnight: an item that appears the
        day HR is due to be warned about it leaves no time to act, which is the
        thing the notice period exists to prevent. -- */
  v_ahead := make_interval(days => greatest(v_schedule.notice_days + 14, 45));

  /* -- A NEW JOINER'S EVALUATIONS, anchored to the ONE joining date (0024).

        Only while they are still ON that anchor. Once somebody has had an
        increment their schedule has left the joining anniversary behind and the
        loop below owns them — otherwise a five-year employee would be offered a
        "one month after joining" evaluation for ever. -- */
  insert into public.due_items (profile_id, milestone_type, due_on)
  select p.id,
         'MONTH_' || m.months,
         (p.date_of_joining + make_interval(months => m.months))::date
    from public.profiles p
    left join public.employment_records e on e.profile_id = p.id
    cross join lateral unnest(v_schedule.joiner_evaluation_months) as m(months)
   where p.is_active
     and p.track = 'STAFF'
     and p.date_of_joining is not null
     and e.last_increment_date is null
     and (p.date_of_joining + make_interval(months => m.months))::date <= p_on + v_ahead
     -- A milestone that fell before the person was in the system is history,
     -- not a task. Six months' grace, so a recent joiner entered late is still
     -- picked up.
     and (p.date_of_joining + make_interval(months => m.months))::date >= p_on - interval '180 days'
  on conflict (profile_id, milestone_type, due_on) do nothing;

  get diagnostics v_created = row_count;

  /* -- THE REPEATING LOOP, anchored to the LAST INCREMENT.
        "After increment cycle again after 3 months evaluation cycle." Each
        increment re-anchors it, which is why this reads `last_increment_date`
        and not the joining date. -- */
  insert into public.due_items (profile_id, milestone_type, due_on)
  select e.profile_id,
         'MONTH_' || m.months,
         (e.last_increment_date + make_interval(months => m.months))::date
    from public.employment_records e
    join public.profiles p on p.id = e.profile_id
    cross join lateral unnest(v_schedule.cycle_evaluation_months) as m(months)
   where p.is_active
     and p.track = 'STAFF'
     and e.last_increment_date is not null
     and (e.last_increment_date + make_interval(months => m.months))::date <= p_on + v_ahead
     and (e.last_increment_date + make_interval(months => m.months))::date >= p_on - interval '180 days'
  on conflict (profile_id, milestone_type, due_on) do nothing;

  /* -- THE INCREMENT, from the date 0023's trigger already maintains.
        Not recomputed here: `next_increment_date` is derived from the person's
        OWN frequency, which may differ from the company default, and 0068 keeps
        it in step with the pay ledger. One implementation. -- */
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

/* -- THE MILESTONE VOCABULARY IS NOW OPEN, and that is deliberate.

      It was a CHECK listing five names. With the intervals configurable, the
      names are `MONTH_1`, `MONTH_3`, `MONTH_9` … whatever HR sets — so a fixed
      list would make the setting a lie: changing an interval to a month the
      constraint had never heard of would fail the nightly sweep at 10pm with
      nothing on screen to show for it.

      The shape is still constrained: MONTH_<n>, or one of the two named kinds.
      PRE_INCREMENT is kept although nothing creates one any more — 0042 rows
      exist and §17 does not delete history. -- */
alter table public.due_items drop constraint if exists due_items_milestone_valid;
alter table public.due_items add constraint due_items_milestone_valid
  check (milestone_type ~ '^MONTH_[0-9]{1,3}$'
         or milestone_type in ('ANNUAL', 'INCREMENT', 'PRE_INCREMENT'));

do $$
begin
  execute 'alter table public.evaluations drop constraint if exists evaluations_milestone_valid';
  execute 'alter table public.evaluations add constraint evaluations_milestone_valid '
       || 'check (milestone_type is null '
       || 'or milestone_type ~ ''^MONTH_[0-9]{1,3}$'' '
       || 'or milestone_type in (''ANNUAL'', ''INCREMENT'', ''PRE_INCREMENT''))';
end;
$$;

/* ---------- Changing it ---------- */

create or replace function public.save_evaluation_schedule(
  p_joiner_evaluation_months int[],
  p_joiner_increment_months  int,
  p_cycle_evaluation_months  int[],
  p_cycle_increment_months   int,
  p_notice_days              int
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before jsonb;
  v_swept  integer;
begin
  -- §9 as amended: configuration is HR's write. The MD reads it.
  if not public.is_hr() then
    raise exception 'Only HR can change the evaluation schedule.'
      using errcode = 'insufficient_privilege';
  end if;

  select to_jsonb(s) - 'updated_by' - 'updated_at' into v_before
    from public.evaluation_schedule s where s.id;

  update public.evaluation_schedule
     set joiner_evaluation_months = coalesce(p_joiner_evaluation_months, '{}'),
         joiner_increment_months  = p_joiner_increment_months,
         cycle_evaluation_months  = coalesce(p_cycle_evaluation_months, '{}'),
         cycle_increment_months   = p_cycle_increment_months,
         notice_days              = p_notice_days,
         updated_by               = auth.uid(),
         updated_at               = now()
   where id;

  /* -- RECALCULATE EVERYONE, at the owner's instruction ("Recalculate
        everyone"). Two halves, and the order matters.

        FIRST, pending items that the new schedule no longer produces are
        removed. Without this, changing 9 months to 8 would leave the old date
        standing beside the new one and HR would chase the same review twice.

        ONLY `PENDING`. A CREATED item became an evaluation somebody may already
        have filled in, and a SKIPPED one records a decision — neither is a
        prediction that can be withdrawn. -- */
  delete from public.due_items d
   where d.status = 'PENDING'
     and d.milestone_type ~ '^MONTH_[0-9]{1,3}$'
     and not exists (
       select 1
         from public.profiles p
         left join public.employment_records e on e.profile_id = p.id
         cross join lateral unnest(
           case when e.last_increment_date is null
                then (select joiner_evaluation_months from public.evaluation_schedule where id)
                else (select cycle_evaluation_months  from public.evaluation_schedule where id)
           end
         ) as m(months)
        where p.id = d.profile_id
          and d.due_on = (coalesce(e.last_increment_date, p.date_of_joining)
                          + make_interval(months => m.months))::date
     );

  -- SECOND, create what the new schedule does produce.
  v_swept := public.compute_due_items();

  /* §12. The whole schedule, both ways — it is a company-wide rule about when
     everybody is reviewed, and "why did my date move" is asked afterwards. No
     personal data is in it, so there is nothing §5 confines. */
  insert into public.audit_log (actor_id, entity, entity_id, action, diff)
  select auth.uid(),
         'evaluation_schedule',
         md5('evaluation_schedule')::uuid,
         'schedule.changed',
         jsonb_build_object('before', v_before,
                            'after', to_jsonb(s) - 'updated_by' - 'updated_at')
    from public.evaluation_schedule s where s.id;

  return v_swept;
end;
$$;

revoke all on function public.save_evaluation_schedule(int[], int, int[], int, int) from public;
grant execute on function public.save_evaluation_schedule(int[], int, int[], int, int) to authenticated;

do $$
begin
  raise notice '0076: the evaluation schedule is a setting now. New joiner 1 and 6 '
               'months from joining; everybody else 3 and 9 months from their last '
               'increment, re-anchored at each one. Change it at Settings > Evaluation periods.';
end;
$$;
