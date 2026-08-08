-- DELETE-SALARY-HISTORY.sql
--
-- Removes salary history rows for ONE person, and clears the salary on their
-- employment record so nothing is left claiming a figure with no history behind
-- it.
--
-- FOR CLEARING UP TEST DATA. If the rows are real, do not use this — a mistaken
-- percentage is fixable with FIX-SALARY-HISTORY.sql, which recomputes the
-- derived columns and leaves the amounts alone. Deleting is for figures that
-- were never true in the first place.
--
-- ============================================================================
-- THIS CANNOT BE UNDONE, AND IT SWITCHES OFF A GUARD THAT EXISTS TO PREVENT IT.
--
-- P19-3 made `salary_history` append-only by trigger as well as by policy, so
-- that no caller — not the service role, not a migration, not the owner in this
-- editor — could quietly rewrite or remove the record of what somebody was
-- paid. There is no legitimate product path to deleting one, deliberately.
--
-- So this is not a feature, it is an operator action, and it is written to be
-- read before it is run: the guard goes off and back on inside one transaction,
-- and STEP 3 checks it came back.
--
-- TAKE A BACKUP FIRST: Supabase dashboard → Database → Backups.
-- ============================================================================
--
-- Two passes. STEP 1 only reports. Nothing is deleted until you uncomment
-- STEP 2 and run again.
--
-- SET THE NAME IN BOTH STEPS. They are separate statements and do not share a
-- variable — if you change one and not the other you will delete somebody
-- else's history, which is the one mistake this file cannot take back.


/* ============================================================================
   STEP 1 · What would go
   ========================================================================== */

select
  p.full_name,
  to_char(h.effective_from, 'DD-MM-YYYY') as effective,
  h.reason,
  h.new_ctc,
  h.previous_ctc,
  h.hike_pct,
  h.note
from public.salary_history h
join public.profiles p on p.id = h.profile_id
-- ▼▼▼ THE NAME ▼▼▼
where p.full_name = 'Test Employee'
order by h.effective_from;

-- And what the employment record currently says, which STEP 2 also clears.
select
  p.full_name,
  e.current_ctc,
  e.joining_ctc,
  to_char(e.salary_effective_from, 'DD-MM-YYYY') as salary_effective_from
from public.employment_records e
join public.profiles p on p.id = e.profile_id
-- ▼▼▼ THE SAME NAME ▼▼▼
where p.full_name = 'Test Employee';


/* ============================================================================
   STEP 2 · The delete
   ==========================================================================
   Remove the surrounding comment markers to arm it, then run again.

   One transaction. If any part fails nothing is deleted AND the guard is back
   on, because the ALTER is inside it too.
*/

/*
begin;

  alter table public.salary_history disable trigger salary_history_no_update;

  delete from public.salary_history h
   using public.profiles p
   where p.id = h.profile_id
     -- ▼▼▼ THE NAME ▼▼▼
     and p.full_name = 'Test Employee';

  alter table public.salary_history enable trigger salary_history_no_update;

  /* -- The record follows the history.
        P19D-5: a `current_ctc` with no history behind it is a number nobody can
        account for. Leaving it would put a salary on the increment calendar and
        the employment tab that no row explains — which is worse than a blank,
        because a blank is honestly "not recorded" and a figure is a claim.

        `joining_ctc` goes with it for the same reason — it is a third place a
        salary is stored, and clearing two of three would leave the employment
        tab showing a joining figure that no history row supports.

        `next_increment_date` is NOT cleared: it is derived from the joining
        date and the increment frequency (0023), not from pay, so it stays
        correct and P19's trigger keeps maintaining it. -- */
  update public.employment_records e
     set current_ctc = null,
         joining_ctc = null,
         salary_effective_from = null
    from public.profiles p
   where p.id = e.profile_id
     -- ▼▼▼ THE SAME NAME ▼▼▼
     and p.full_name = 'Test Employee';

commit;
*/


/* ============================================================================
   STEP 3 · Confirm it is gone and the guard is back on
   ==========================================================================
   `rows_left` must be 0. `guard` must say ON — if it says DISABLED, salary
   history is editable by anybody and the ALTER must be re-run.
*/

select
  (select count(*)
     from public.salary_history h
     join public.profiles p on p.id = h.profile_id
    -- ▼▼▼ THE SAME NAME ▼▼▼
    where p.full_name = 'Test Employee')          as rows_left,
  (select case tgenabled when 'O' then 'ON — append-only, correct'
                         else 'DISABLED — RE-ENABLE IT' end
     from pg_trigger
    where tgrelid = 'public.salary_history'::regclass
      and tgname = 'salary_history_no_update')    as guard;
