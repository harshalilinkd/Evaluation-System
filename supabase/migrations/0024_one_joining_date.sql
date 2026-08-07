-- 0024_one_joining_date.sql
-- One joining date, on `profiles`. Removes the duplicate 0023 introduced.
--
-- WHAT WENT WRONG
--
-- 0001 gave `profiles` a `date_of_joining`. 0023 gave `employment_records` a
-- second one and made it NOT NULL. Two copies, written and read by different
-- code:
--
--   profiles.date_of_joining            written by NOTHING (no form collects it)
--                                       read by the scorecard and the print pack
--   employment_records.date_of_joining  written by the Employment tab
--                                       read by the increment calendar
--
-- So the scorecard and every printed evaluation showed a joining date that no
-- screen ever set — permanently blank — while the Employment tab filled a
-- different copy those screens never looked at.
--
-- WHY `profiles` WINS
--
-- A joining date is ordinary personnel data, not salary. The scorecard shows it
-- to the person themselves and the print pack puts it on a signature-ready
-- sheet, both of which are legitimate. `employment_records` is HR/MD-only by
-- design (§5), so keeping the date there locked it away from screens that have
-- always displayed it — which is precisely what broke them.
--
-- The split now reads cleanly: **profiles = who they are, employment_records =
-- what they are paid and when it changes.**
--
-- SAFE TO RE-RUN.

begin;

/* ---------- 1. Backfill, newest information wins ---------- */
--
-- `employment_records` is the copy somebody actually typed, so it is the one
-- worth keeping where the two disagree or where profiles is blank.

-- Guarded, because section 5 drops the column this reads: on a second run it
-- would reference something that no longer exists. Dynamic SQL so the planner
-- does not resolve the name until the branch is actually taken.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'employment_records'
       and column_name = 'date_of_joining'
  ) then
    execute $q$
      update public.profiles p
         set date_of_joining = e.date_of_joining
        from public.employment_records e
       where e.profile_id = p.id
         and e.date_of_joining is not null
         and (p.date_of_joining is null or p.date_of_joining <> e.date_of_joining)
    $q$;
  end if;
end $$;

/* ---------- 2. The derived-date rule reads profiles now ---------- */
--
-- Rewritten before the column is dropped, or the trigger would reference a
-- column that no longer exists the moment the DROP lands.

create or replace function public.employment_sync_increment()
returns trigger
language plpgsql
as $$
declare
  v_next    date;
  v_joining date;
begin
  -- The single source. `employment_records` no longer carries one.
  select p.date_of_joining into v_joining
    from public.profiles p
   where p.id = new.profile_id;

  v_next := public.compute_next_increment(
    v_joining, new.last_increment_date, new.increment_frequency_months);

  new.next_increment_date := v_next;

  if tg_op = 'UPDATE' then
    delete from public.increment_reminders
     where profile_id = new.profile_id
       and status = 'PENDING'
       and due_date is distinct from v_next;
  end if;

  if v_next is not null then
    insert into public.increment_reminders (profile_id, due_date, remind_on, status)
    values (new.profile_id, v_next, public.compute_remind_on(v_next), 'PENDING')
    on conflict (profile_id, due_date) do update
      set remind_on = excluded.remind_on
      where public.increment_reminders.status = 'PENDING';
  end if;

  return new;
end;
$$;

drop trigger if exists employment_records_sync_increment on public.employment_records;
create trigger employment_records_sync_increment
  before insert or update of last_increment_date, increment_frequency_months
  on public.employment_records
  for each row execute function public.employment_sync_increment();

/* ---------- 3. Changing the joining date must still recalculate ---------- */
--
-- It used to be a column on the same row, so the trigger above caught it. Now
-- it lives on another table, and moving somebody's joining date has to reach
-- across — otherwise a correction to a new joiner's start date would leave
-- their first increment permanently on the old schedule.

create or replace function public.profiles_sync_increment()
returns trigger
language plpgsql
as $$
begin
  if new.date_of_joining is distinct from old.date_of_joining then
    -- A no-op UPDATE that fires `employment_sync_increment`, so the rule stays
    -- in exactly one function rather than being restated here.
    update public.employment_records
       set last_increment_date = last_increment_date
     where profile_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_sync_increment on public.profiles;
create trigger profiles_sync_increment
  after update of date_of_joining on public.profiles
  for each row execute function public.profiles_sync_increment();

/* ---------- 4. The self-service view reads profiles now ---------- */
--
-- It selected `employment_records.date_of_joining`, which is what made the
-- column undroppable. Rebuilt against the surviving copy, and STILL carrying no
-- salary column — that absence is the §5 guarantee (P19-2), not an oversight.

drop view if exists public.v_my_employment;
create view public.v_my_employment as
select
  p.id as profile_id,
  p.date_of_joining,
  e.confirmation_date,
  e.employment_type
from public.profiles p
left join public.employment_records e on e.profile_id = p.id
where p.id = (select auth.uid());

comment on view public.v_my_employment is
  'A person''s own joining and confirmation dates. Deliberately selects NO salary column (§5 salary confinement) — RLS cannot mask a column, so the absence is the guarantee.';

grant select on public.v_my_employment to authenticated;

/* ---------- 5. Drop the duplicate ---------- */

alter table public.employment_records drop column if exists date_of_joining;

comment on column public.profiles.date_of_joining is
  'The ONE joining date (0024). employment_records used to carry a second copy; the two were written and read by different code and disagreed.';

commit;
