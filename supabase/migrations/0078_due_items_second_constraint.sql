-- 0078 — the OTHER milestone constraint, and the sweep 0077 could not finish.
--
-- THE BUG, and it is mine. 0076 opened the milestone vocabulary to MONTH_<n>
-- so the review schedule could be a setting. It widened ONE constraint. There
-- are two, and they are ANDed:
--
--   0031  due_items_milestone_valid       MONTH_1, MONTH_6, ANNUAL, INCREMENT
--   0042  due_items_milestone_type_check  … + PRE_INCREMENT      <-- untouched
--   0076  due_items_milestone_valid  ->  ~ '^MONTH_[0-9]{1,3}$'  <-- widened
--
-- So MONTH_3 satisfies the new constraint and is refused by the old one:
--
--   new row for relation "due_items" violates check constraint
--   "due_items_milestone_type_check"
--
-- 0076's line reads `drop constraint if exists due_items_milestone_valid` — the
-- `if exists` is what hid it. 0042 had renamed the guard it was aiming at, so
-- the drop matched nothing, said nothing, and the add created a THIRD
-- constraint beside the two already there.
--
-- WHY THE TESTS PASSED. My harness built `due_items` by hand with only the new
-- constraint on it — a database no migration would ever produce. FIX-1 recorded
-- exactly this: sixteen suites loading the seed in the wrong place, green while
-- three real bugs sat in the gap. The fixture below is assembled from 0031's
-- and 0042's own statements instead.
--
-- Fixed by DEFINITION rather than by name. These two names have drifted across
-- three migrations and a fourth guessing at either of them would be the same
-- mistake again: anything on this column still enumerating MONTH_1 is stale,
-- whatever it is called.
--
-- Requires 0076. Safe to run before or after 0077, and safe to re-run.

-- ================================================== 1. the stale constraints ==

do $$
declare
  v record;
  v_dropped int := 0;
begin
  for v in
    select c.conrelid::regclass::text as tbl, c.conname
      from pg_constraint c
     where c.contype = 'c'
       and c.conrelid in ('public.due_items'::regclass, 'public.evaluations'::regclass)
       -- The enumerated form. 0076's regex reads '^MONTH_[0-9]{1,3}$', which
       -- does not contain the literal MONTH_1 — so this cannot match the
       -- constraint we want to keep.
       and pg_get_constraintdef(c.oid) like '%''MONTH_1''%'
  loop
    execute format('alter table %s drop constraint %I', v.tbl, v.conname);
    v_dropped := v_dropped + 1;
    raise notice '0078: dropped stale % on %', v.conname, v.tbl;
  end loop;

  if v_dropped = 0 then
    raise notice '0078: no stale milestone constraint found — already clean.';
  end if;
end;
$$;

-- The canonical pair, re-asserted so this migration leaves a known state
-- whether or not 0076 reached them. Same definitions as 0076.
alter table public.due_items drop constraint if exists due_items_milestone_valid;
alter table public.due_items add constraint due_items_milestone_valid
  check (milestone_type ~ '^MONTH_[0-9]{1,3}$'
         or milestone_type in ('ANNUAL', 'INCREMENT', 'PRE_INCREMENT'));

alter table public.evaluations drop constraint if exists evaluations_milestone_valid;
alter table public.evaluations add constraint evaluations_milestone_valid
  check (milestone_type is null
         or milestone_type ~ '^MONTH_[0-9]{1,3}$'
         or milestone_type in ('ANNUAL', 'INCREMENT', 'PRE_INCREMENT'));

-- The check 0076 should have carried: prove a MONTH_3 is actually accepted,
-- rather than trusting that one `alter table` was the only guard. Rolled back,
-- so it leaves nothing behind.
do $$
declare
  v_profile uuid;
begin
  select id into v_profile from public.profiles limit 1;
  if v_profile is null then
    raise notice '0078: no profiles yet — the MONTH_3 probe is skipped.';
    return;
  end if;

  begin
    insert into public.due_items (profile_id, milestone_type, due_on)
    values (v_profile, 'MONTH_3', date '1900-01-01');
    raise exception 'probe_ok';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'probe_ok' then raise; end if;
      raise notice '0078: MONTH_3 is accepted.';
    when check_violation then
      raise exception '0078: MONTH_3 is STILL refused (%). Another constraint on '
                      'due_items.milestone_type is enumerating values.', sqlerrm;
  end;
end;
$$;

-- ======================================================= 2. the count again ==

/* 0077 replaces this function and then sweeps; the sweep is what failed above,
   so on a database where the whole file ran as one transaction the function was
   rolled back with it. Re-asserted here so 0078 is sufficient on its own and
   the order the two are applied in does not matter.

   The fault it fixes: `get diagnostics` sat after the FIRST insert only, so the
   repeating 3-and-9-month branch — most of the company — went uncounted. In a
   company where everybody has had an increment that reports ZERO, and HR is
   told "Nothing new is due" by a sweep that just created a dozen items. */

create or replace function public.compute_due_items(p_on date default current_date)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_created  integer := 0;
  v_batch    integer := 0;
  v_ahead    interval;
  v_schedule public.evaluation_schedule;
begin
  select * into v_schedule from public.evaluation_schedule where id;
  if not found then
    raise exception '0076: the evaluation schedule row is missing.';
  end if;

  v_ahead := make_interval(days => greatest(v_schedule.notice_days + 14, 45));

  /* A NEW JOINER'S EVALUATIONS, anchored to the ONE joining date (0024), and
     only while they are still on that anchor — once somebody has had an
     increment the loop below owns them, or a five-year employee would be
     offered a "one month after joining" review for ever. */
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
     and (p.date_of_joining + make_interval(months => m.months))::date >= p_on - interval '180 days'
  on conflict (profile_id, milestone_type, due_on) do nothing;

  get diagnostics v_batch = row_count;
  v_created := v_created + v_batch;

  /* THE REPEATING LOOP, anchored to the LAST INCREMENT and re-anchored at each
     one. This is the branch whose rows were never counted. */
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

  get diagnostics v_batch = row_count;
  v_created := v_created + v_batch;

  /* THE INCREMENT, from the date 0023's trigger already maintains. Not
     recomputed here: `next_increment_date` follows the person's OWN frequency
     and 0068 keeps it in step with the pay ledger. One implementation. */
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

  get diagnostics v_batch = row_count;
  v_created := v_created + v_batch;

  return v_created;
end;
$$;

-- ============================================================ 3. sweep once ==

do $$
declare
  v_found integer;
begin
  v_found := public.compute_due_items();
  raise notice '0078: swept — % milestone(s) created. Evaluation Due should now '
               'list them; press Check again at any time to re-run this.', v_found;
end;
$$;
