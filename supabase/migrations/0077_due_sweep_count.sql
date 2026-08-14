-- 0077 — the sweep reports what it actually created, and runs once on apply.
--
-- ⚠ THIS FILE FAILS ON ITS OWN. Its sweep is refused by a SECOND milestone
--   constraint that 0076 never widened (0042's `due_items_milestone_type_check`)
--   — "new row for relation due_items violates check constraint". 0078 removes
--   that constraint and carries everything below, so **apply 0078 instead**.
--   Left unedited rather than corrected in place: it was attempted against a
--   real database and §0.8 does not treat a file that has been run as a draft.
--
-- TWO FAULTS, both found by tracing 0076's own function over the real staff
-- data on 14-08-2026: it produced 20 evaluation milestones and reported 7, and
-- nothing had recomputed the list since the rule changed.
--
-- 1. THE COUNT WAS THE FIRST INSERT'S.
--    `get diagnostics v_created = row_count` sat after the joiner branch only,
--    so the two branches beneath it — the repeating 3-and-9-month loop, which
--    is most of the company, and the increment branch — were never counted.
--
--    That is not an off-by-some. HR presses "Check again" and the screen says
--    either "N new items added" or "Nothing new is due" from this number. In a
--    company where everybody has had an increment the joiner branch inserts
--    NOTHING, so a sweep that created a dozen rows reports zero and the button
--    states the opposite of what it just did. §0.7: fail loudly, and a success
--    that misreports itself is worse than an error.
--
-- 2. CHANGING THE RULE DID NOT RECOMPUTE THE LIST.
--    0076 replaced the schedule and rewrote the function, and left `due_items`
--    holding whatever the previous rule had produced. `save_evaluation_schedule`
--    recalculates everyone when the setting is edited; APPLYING the migration
--    did not, so Evaluation Due stayed as it was until the nightly job ran.
--    Reported as "nothing is showing as due — seriously, nobody is eligible?"
--    They were: twenty people, five of them overdue since April.
--
-- Requires 0076.

-- ============================================================ 1. the count ==

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

  get diagnostics v_batch = row_count;
  v_created := v_created + v_batch;

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

  get diagnostics v_batch = row_count;
  v_created := v_created + v_batch;

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

  get diagnostics v_batch = row_count;
  v_created := v_created + v_batch;

  return v_created;
end;
$$;

-- ============================================== 2. run it once, on apply ====

/* Idempotent by construction: the unique index on (profile_id, milestone_type,
   due_on) means a second run over the same window creates nothing, and the
   function writes PENDING items and nothing else — no evaluation, no message
   (P22-1). Pressing "Check again" afterwards is the same operation.

   Stale items are NOT withdrawn here. `save_evaluation_schedule` does that when
   HR edits the setting, where the previous values are known; a migration cannot
   say which rule produced a row it finds, and deleting a PENDING item on a
   guess is worse than leaving one HR can skip. */
do $$
declare
  v_found integer;
begin
  v_found := public.compute_due_items();
  raise notice '0077: swept — % milestone(s) now pending. The count is the whole '
               'sweep now, not just the new-joiner half.', v_found;
end;
$$;
