-- DELETE-SALARY-HISTORY-ARMED.sql
--
-- The same delete as DELETE-SALARY-HISTORY.sql, ALREADY ARMED. Paste it, run it
-- once, done.
--
-- The two-pass file ships with STEP 2 commented out, which is right for a
-- destructive script nobody has read yet — and is also why "rows not deleted"
-- is the usual first outcome. This is the version for when the list has been
-- checked and the answer is yes.
--
-- ============================================================================
-- IT DELETES IMMEDIATELY. THERE IS NO PREVIEW STEP.
--
-- `salary_history` is append-only by trigger (P19-3) so that no caller can
-- remove a record of what somebody was paid. This switches that off, deletes,
-- and switches it back on — inside ONE transaction, so a failure anywhere
-- leaves both the rows and the guard exactly as they were.
--
-- TAKE A BACKUP FIRST: Supabase dashboard → Database → Backups.
-- ============================================================================
--
-- CHANGE THE NAME IN ALL FOUR PLACES if it is not Test Employee. They are
-- separate statements and do not share a variable.

begin;

  /* -- Before. Printed so the output shows what was actually there rather than
        leaving "0 rows deleted" ambiguous between "it worked" and "the name
        never matched anything". -- */
  do $$
  declare v_rows int; v_name text := 'Test Employee';   -- ◀ THE NAME (1 of 4)
  begin
    select count(*) into v_rows
      from public.salary_history h
      join public.profiles p on p.id = h.profile_id
     where p.full_name = v_name;
    raise notice 'salary history rows for %: % — deleting now', v_name, v_rows;
    if v_rows = 0 then
      raise notice 'NOTHING MATCHED. Check the spelling against profiles.full_name.';
    end if;
  end;
  $$;

  alter table public.salary_history disable trigger salary_history_no_update;

  delete from public.salary_history h
   using public.profiles p
   where p.id = h.profile_id
     and p.full_name = 'Test Employee';               -- ◀ THE NAME (2 of 4)

  alter table public.salary_history enable trigger salary_history_no_update;

  /* -- The record follows the history (P19D-5).
        A `current_ctc` with no history behind it is a number nobody can account
        for, sitting on the increment calendar and the employment tab with
        nothing to explain it. A blank honestly says "not recorded"; a figure is
        a claim. `joining_ctc` goes for the same reason.

        `next_increment_date` STAYS — it comes from the joining date and the
        increment frequency (0023), not from pay. -- */
  update public.employment_records e
     set current_ctc = null,
         joining_ctc = null,
         salary_effective_from = null
    from public.profiles p
   where p.id = e.profile_id
     and p.full_name = 'Test Employee';               -- ◀ THE NAME (3 of 4)

commit;


/* ============================================================================
   Confirm
   ==========================================================================
   `rows_left` must be 0.
   `guard` must say ON — if it says DISABLED, salary history is editable by
   anybody and the ALTER must be re-run.
*/

select
  (select count(*)
     from public.salary_history h
     join public.profiles p on p.id = h.profile_id
    where p.full_name = 'Test Employee')              as rows_left,  -- ◀ (4 of 4)
  (select case tgenabled when 'O' then 'ON — append-only, correct'
                         else 'DISABLED — RE-ENABLE IT' end
     from pg_trigger
    where tgrelid = 'public.salary_history'::regclass
      and tgname = 'salary_history_no_update')        as guard;
