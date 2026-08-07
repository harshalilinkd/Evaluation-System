-- 0023_employment.sql
-- P19: employment and compensation master data.
--
-- NUMBERING. The brief names this `0015_employment.sql`. 0015 is
-- `0015_views.sql` and is applied. §0.8: sequential, and an applied migration is
-- never edited. The same call as 0010, 0017, 0021 and 0022.
--
-- THIS MIGRATION HOLDS THE MOST SENSITIVE DATA IN THE SYSTEM.
--
-- §5's salary confinement invariant: "Salary figures are readable by HR_ADMIN
-- and MD only. They never appear in a HOD-facing screen, a lead export, an
-- employee-facing report, or a notification body."
--
-- Three consequences are designed in rather than left to discipline:
--
--   1. No salary column goes on `profiles`. Every existing screen selects from
--      profiles, several with `select *`-shaped strings, and one column there
--      would leak into a dozen places nobody would think to check.
--   2. An employee's own joining and confirmation dates come from a dedicated
--      VIEW that has no salary column at all — not from a filtered read of the
--      table. A policy that admits a row admits every column in it; RLS cannot
--      mask a column, which is exactly the trap P5-4 hit.
--   3. `salary_history` has no UPDATE and no DELETE policy for anyone,
--      including HR. Absence of a policy is the enforcement (P5-9). A mistake is
--      corrected by a new row with reason CORRECTION. Pay history that can be
--      rewritten is not evidence.
--
-- SAFE TO RE-RUN.

begin;

/* ============================================================================
   1. employment_records — one row per person, the current state
   ========================================================================== */

create table if not exists public.employment_records (
  profile_id                 uuid primary key
                               references public.profiles(id) on delete cascade,
  date_of_joining            date not null,
  confirmation_date          date,
  last_increment_date        date,
  -- Derived, never typed. The trigger below owns it; a UI that writes it would
  -- be a second implementation of the rule (§0 — one place per decision).
  next_increment_date        date,
  increment_frequency_months int not null default 12,
  current_ctc                numeric(12, 2),
  joining_ctc                numeric(12, 2),
  salary_effective_from      date,
  employment_type            text not null default 'PERMANENT',
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

alter table public.employment_records
  drop constraint if exists employment_records_type_valid;
alter table public.employment_records
  add constraint employment_records_type_valid
  check (employment_type in ('PERMANENT', 'PROBATION', 'CONTRACT', 'TRAINEE'));

alter table public.employment_records
  drop constraint if exists employment_records_frequency_valid;
alter table public.employment_records
  add constraint employment_records_frequency_valid
  check (increment_frequency_months between 1 and 60);

-- A negative CTC is a typo, and a zero one is a person being paid nothing.
alter table public.employment_records
  drop constraint if exists employment_records_ctc_positive;
alter table public.employment_records
  add constraint employment_records_ctc_positive
  check ((current_ctc is null or current_ctc > 0)
     and (joining_ctc is null or joining_ctc > 0));

drop trigger if exists employment_records_set_updated_at on public.employment_records;
create trigger employment_records_set_updated_at
  before update on public.employment_records
  for each row execute function public.set_updated_at();

/* ============================================================================
   2. salary_history — append-only
   ========================================================================== */

create table if not exists public.salary_history (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references public.profiles(id),
  effective_from date not null,
  previous_ctc   numeric(12, 2),
  new_ctc        numeric(12, 2) not null,
  hike_amount    numeric(12, 2),
  hike_pct       numeric(6, 2),
  reason         text not null,
  -- Nullable and NOT cascading: a joining salary belongs to no evaluation, and
  -- a pay record must outlive the appraisal that produced it.
  evaluation_id  uuid references public.evaluations(id),
  recorded_by    uuid references public.profiles(id),
  recorded_at    timestamptz not null default now(),
  note           text
);

alter table public.salary_history drop constraint if exists salary_history_reason_valid;
alter table public.salary_history add constraint salary_history_reason_valid
  check (reason in ('JOINING', 'ANNUAL_INCREMENT', 'PROMOTION', 'CORRECTION', 'MARKET_ADJUSTMENT'));

alter table public.salary_history drop constraint if exists salary_history_new_ctc_positive;
alter table public.salary_history add constraint salary_history_new_ctc_positive
  check (new_ctc > 0);

create index if not exists salary_history_profile_idx
  on public.salary_history (profile_id, effective_from desc);

/* ---------- Append-only by TRIGGER as well as by policy ---------- */
--
-- P4-4's reasoning, applied to pay. RLS alone would not deliver "no update or
-- delete for anyone": the service-role client used by cron and notification
-- code bypasses RLS entirely, and so does any future migration. A trigger holds
-- for every caller.

create or replace function public.salary_history_is_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'Salary history is append-only. Record a correction with reason CORRECTION instead of editing % .',
    tg_op
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists salary_history_no_update on public.salary_history;
create trigger salary_history_no_update
  before update or delete on public.salary_history
  for each row execute function public.salary_history_is_append_only();

/* ============================================================================
   3. increment_reminders
   ========================================================================== */

create table if not exists public.increment_reminders (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  due_date      date not null,
  remind_on     date not null,
  status        text not null default 'PENDING',
  sent_at       timestamptz,
  evaluation_id uuid references public.evaluations(id),
  created_at    timestamptz not null default now(),
  unique (profile_id, due_date)
);

alter table public.increment_reminders drop constraint if exists increment_reminders_status_valid;
alter table public.increment_reminders add constraint increment_reminders_status_valid
  check (status in ('PENDING', 'SENT', 'ACTIONED', 'SKIPPED'));

create index if not exists increment_reminders_due_idx
  on public.increment_reminders (remind_on) where status = 'PENDING';

/* ============================================================================
   4. The derived rules, in SQL so they cannot drift
   ========================================================================== */

/**
 * next_increment_date = last_increment_date + frequency, or, for somebody who
 * has never had one, date_of_joining + 12 months.
 *
 * IMMUTABLE and pure: the same three inputs always give the same answer, which
 * is what lets it be called from a trigger, a view and a query without three
 * implementations appearing.
 */
create or replace function public.compute_next_increment(
  p_joining   date,
  p_last      date,
  p_frequency int
)
returns date
language sql
immutable
as $$
  select case
    when p_last is not null
      then (p_last + (coalesce(p_frequency, 12) || ' months')::interval)::date
    when p_joining is not null
      then (p_joining + interval '12 months')::date
    else null
  end;
$$;

/** §: "remind_on is next_increment_date minus one month." */
create or replace function public.compute_remind_on(p_next date)
returns date
language sql
immutable
as $$
  select case when p_next is null then null else (p_next - interval '1 month')::date end;
$$;

/**
 * Recalculates the derived date and the PENDING reminder whenever anything it
 * depends on moves.
 *
 * Only a PENDING reminder is touched. One already SENT is a record that HR was
 * told, and one ACTIONED is a record that they did something — rewriting either
 * because a date changed afterwards would erase what actually happened.
 */
create or replace function public.employment_sync_increment()
returns trigger
language plpgsql
as $$
declare
  v_next date;
begin
  v_next := public.compute_next_increment(
    new.date_of_joining, new.last_increment_date, new.increment_frequency_months);

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
  before insert or update of date_of_joining, last_increment_date, increment_frequency_months
  on public.employment_records
  for each row execute function public.employment_sync_increment();

/* ============================================================================
   5. RLS — the part that matters
   ========================================================================== */

alter table public.employment_records  enable row level security;
alter table public.salary_history      enable row level security;
alter table public.increment_reminders enable row level security;

/* ---------- employment_records ---------- */
--
-- §9 as amended by AMEND-2: HR writes, the MD reads. `is_admin()` is NOT used —
-- AMEND-2 retired it for every evaluation, report, decision and salary gate, and
-- this is the most salary-shaped gate in the system.

drop policy if exists "employment: hr and md read" on public.employment_records;
create policy "employment: hr and md read" on public.employment_records
  for select to authenticated
  using (public.is_hr() or public.is_md());

drop policy if exists "employment: hr writes" on public.employment_records;
create policy "employment: hr writes" on public.employment_records
  for insert to authenticated with check (public.is_hr());

drop policy if exists "employment: hr updates" on public.employment_records;
create policy "employment: hr updates" on public.employment_records
  for update to authenticated using (public.is_hr()) with check (public.is_hr());

-- No DELETE policy for anyone. Somebody leaving is `profiles.is_active = false`
-- (P4-5); erasing their employment record would erase the salary history's
-- subject while the history itself remains.

/* ---------- salary_history ---------- */

drop policy if exists "salary: hr and md read" on public.salary_history;
create policy "salary: hr and md read" on public.salary_history
  for select to authenticated
  using (public.is_hr() or public.is_md());

-- §9 gives HR the salary block and the MD the final amount, so both may append.
drop policy if exists "salary: hr and md append" on public.salary_history;
create policy "salary: hr and md append" on public.salary_history
  for insert to authenticated
  with check (public.is_hr() or public.is_md());

-- NO UPDATE POLICY. NO DELETE POLICY. For anyone, including HR.
-- The trigger above enforces the same thing against callers that bypass RLS.

/* ---------- increment_reminders ---------- */

drop policy if exists "reminders: hr and md read" on public.increment_reminders;
create policy "reminders: hr and md read" on public.increment_reminders
  for select to authenticated
  using (public.is_hr() or public.is_md());

drop policy if exists "reminders: hr and md write" on public.increment_reminders;
create policy "reminders: hr and md write" on public.increment_reminders
  for insert to authenticated with check (public.is_hr() or public.is_md());

drop policy if exists "reminders: hr and md update" on public.increment_reminders;
create policy "reminders: hr and md update" on public.increment_reminders
  for update to authenticated
  using (public.is_hr() or public.is_md())
  with check (public.is_hr() or public.is_md());

/* ============================================================================
   6. The employee's own dates — a view with NO salary column
   ========================================================================== */
--
-- RLS is row-level. Admitting somebody's own row from `employment_records` would
-- hand them every column in it, including `current_ctc` — RLS cannot mask a
-- column, and P5-4 made exactly this call for the MD response row.
--
-- So the employee's dates come from a view that CANNOT carry a salary, because
-- it does not select one. `security_invoker` is off here on purpose: the view is
-- the grant, and it is scoped to `auth.uid()` in its own WHERE clause.

drop view if exists public.v_my_employment;
create view public.v_my_employment as
select
  e.profile_id,
  e.date_of_joining,
  e.confirmation_date,
  e.employment_type
from public.employment_records e
where e.profile_id = (select auth.uid());

comment on view public.v_my_employment is
  'A person''s own joining and confirmation dates. Deliberately selects NO salary column (§5 salary confinement) — RLS cannot mask a column, so the absence is the guarantee.';

grant select on public.v_my_employment to authenticated;

/* ---------- Grants ---------- */
--
-- Explicit, because the tables are new and the default grants Supabase applies
-- to `public` would otherwise decide this.

grant select, insert, update on public.employment_records  to authenticated;
grant select, insert          on public.salary_history      to authenticated;
grant select, insert, update on public.increment_reminders to authenticated;

grant execute on function public.compute_next_increment(date, date, int) to authenticated;
grant execute on function public.compute_remind_on(date)                 to authenticated;

commit;
