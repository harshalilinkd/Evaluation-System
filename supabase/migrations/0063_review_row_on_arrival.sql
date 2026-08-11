-- 0063: the increment review row exists by the time HR opens the record.
--
-- Phase 3 of the overhaul: HR stops proposing a salary. The proposal is
-- computed from the manager's recommended percentage (0062) and HR forwards it.
--
-- ============================================================================
-- THE BLOCKER THIS EXISTS TO REMOVE
--
-- `increment_reviews` is created today by exactly two things:
--
--   · `record_salary_expectation`, which returns false and writes nothing
--     unless the person already has `employment_records.current_ctc > 0` — and
--     which only fires at all if the employee answered an OPTIONAL question;
--   · HR typing a proposal, which upserts the row on save.
--
-- Take away HR's typing — which is the whole point of phase 3 — and for anybody
-- who skipped the expectation question the row is never created. `saveApproval`
-- returns NO_PROPOSAL when there is no row, and `approveAndClose` calls it
-- first. So the MD would be refused the first time they pressed Approve, on a
-- record that looked complete, with an error naming something they cannot
-- create.
--
-- The row must therefore be created when the record REACHES HR, not when
-- somebody types into it.
--
-- WHY A TRIGGER AND NOT AN ACTION. §8's transition function is the only path a
-- status takes, and it is already patched six times over CRLF text — 0056 is
-- the standing lesson about a regex patch reporting success having matched the
-- wrong thing. A trigger on the status change cannot miss a path, cannot be
-- forgotten by a future caller, and needs no patch to a function whose body is
-- now hard to edit safely.
--
-- WHAT IT DOES NOT DO: it does not propose anything. `proposed_ctc` is left
-- null. The row exists so the MD has something to approve; the FIGURE is
-- computed on the screen from the manager's percentage and written when HR
-- forwards. A trigger that guessed a salary would be a pay decision made by a
-- database trigger, which is nobody's decision.
-- ============================================================================

begin;

/* ---------- current_ctc is NOT NULL, so a row needs a salary ---------- */

-- Somebody with no employment record cannot have a review row at all. That is
-- correct — there is no salary to raise — but it must be VISIBLE rather than a
-- silent absence, which is what it is today. The screen already says "Not on
-- record"; this makes sure the trigger does not fail trying to insert a null.

create or replace function public.ensure_increment_review()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type    text;
  v_current numeric;
begin
  -- Only an INCREMENT cycle has a salary step. An EVALUATION cycle ends at
  -- the MD's read (§1), and creating a pay row for one would put people in the
  -- increment queue who are not having their pay reviewed.
  select c.cycle_type into v_type
    from public.evaluation_cycles c
   where c.id = new.cycle_id;

  if v_type is distinct from 'INCREMENT' then
    return null;
  end if;

  select e.current_ctc into v_current
    from public.employment_records e
   where e.profile_id = new.evaluatee_id;

  -- No salary on record: nothing to raise, and `current_ctc` is NOT NULL on
  -- the review table. HR adds the salary and the row appears on the next
  -- transition, or at their first save.
  if v_current is null or v_current <= 0 then
    return null;
  end if;

  insert into public.increment_reviews (evaluation_id, current_ctc)
  values (new.id, v_current)
  -- Already there — created by the employee's expectation, or by an earlier
  -- run of this trigger. Not an error, and `current_ctc` is deliberately NOT
  -- refreshed: the review is a record of the figure the decision was made
  -- against, and moving it under a decision in progress would rewrite the
  -- question after it was answered.
  on conflict (evaluation_id) do nothing;

  return null;
end;
$$;

-- AFTER, and only on the arrival at HR. `when` keeps it off every other
-- status change rather than firing and returning on each one.
drop trigger if exists evaluations_ensure_increment_review on public.evaluations;
create trigger evaluations_ensure_increment_review
  after update of status on public.evaluations
  for each row
  when (new.status = 'PENDING_HR_REVIEW' and old.status is distinct from new.status)
  execute function public.ensure_increment_review();

/* ---------- The records already sitting there ---------- */

-- Anything that reached HR before this trigger existed has the same hole. A
-- migration that fixes the mechanism and leaves the cohort that motivated it
-- stranded is half a fix (F11-6).
do $$
declare
  v_made int := 0;
begin
  insert into public.increment_reviews (evaluation_id, current_ctc)
  select ev.id, er.current_ctc
    from public.evaluations ev
    join public.evaluation_cycles c on c.id = ev.cycle_id
    join public.employment_records er on er.profile_id = ev.evaluatee_id
   where c.cycle_type = 'INCREMENT'
     and ev.status in ('PENDING_HR_REVIEW', 'HR_APPROVED', 'MD_REVIEWED', 'INTERVIEW_DONE')
     and ev.excluded_at is null
     and er.current_ctc is not null
     and er.current_ctc > 0
  on conflict (evaluation_id) do nothing;

  get diagnostics v_made = row_count;
  raise notice '0063: % review row(s) created for records already with HR or beyond.', v_made;
end;
$$;

commit;

/* ============================================================================
   Confirm
   ==========================================================================
   `stranded` must be 0: an INCREMENT evaluation at or past HR, with a salary on
   record, and no review row for the MD to approve. */

select
  (select count(*) from public.increment_reviews)                     as review_rows,
  (select count(*)
     from public.evaluations ev
     join public.evaluation_cycles c on c.id = ev.cycle_id
     join public.employment_records er on er.profile_id = ev.evaluatee_id
     left join public.increment_reviews ir on ir.evaluation_id = ev.id
    where c.cycle_type = 'INCREMENT'
      and ev.status in ('PENDING_HR_REVIEW','HR_APPROVED','MD_REVIEWED','INTERVIEW_DONE')
      and ev.excluded_at is null
      and er.current_ctc > 0
      and ir.evaluation_id is null)                                   as stranded,
  (select count(*) from pg_trigger
    where tgname = 'evaluations_ensure_increment_review')             as trigger_present;
