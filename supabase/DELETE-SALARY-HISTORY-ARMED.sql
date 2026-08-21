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
-- THE NAME IS TYPED ONCE, and that is the whole of the change from the earlier
-- version of this file. It used to carry the person in FOUR separate literals
-- with its own header warning that they "do not share a variable" — so getting
-- one of the four wrong deleted somebody else's pay record, on the one
-- operation that cannot be taken back. Asking a person to keep four copies of a
-- name in step is not a safeguard, it is the hazard.
--
-- Everything below runs inside one transaction, so the target can be set once
-- as a transaction-local setting and read by every statement. It is cleared
-- when the transaction ends.
--
-- IT ALSO ACCEPTS AN EMPLOYEE CODE. The roster shows both, and being strict
-- about which one goes in here is friction with no safety behind it — the
-- person is named back to you before anything is destroyed.


begin;

  /* ▼▼▼▼▼▼▼▼▼▼ THE ONLY PLACE THE PERSON IS NAMED ▼▼▼▼▼▼▼▼▼▼
     Their full name exactly as the roster shows it, or their employee code. */
  select set_config('app.delete_salary_for', 'Manav Khandale', true);


  /* -- REFUSES UNLESS EXACTLY ONE PERSON MATCHES.

        Zero is a typo, and the old file's answer to that was a notice saying
        "NOTHING MATCHED" while the transaction carried on and committed — which
        reads as a successful run that deleted nothing, and is indistinguishable
        from a person who genuinely had no history.

        More than one is the dangerous case: `profiles.full_name` is not unique,
        so two people sharing a name would BOTH lose their pay record from one
        paste. Raising aborts the transaction, so nothing is touched and the
        guard never comes off. -- */
  do $$
  declare
    v_who   text := current_setting('app.delete_salary_for');
    v_n     int;
    v_id    uuid;
    v_name  text;
    v_code  text;
    v_rows  int;
  begin
    select count(*) into v_n
      from public.profiles
     where full_name = v_who or employee_code = v_who;

    if v_n = 0 then
      raise exception
        'Nobody is called % and nobody has that employee code. Check it against the roster — nothing was deleted.', v_who;
    elsif v_n > 1 then
      raise exception
        '% people match "%". Use their employee code instead — nothing was deleted.', v_n, v_who;
    end if;

    select id, full_name, employee_code into v_id, v_name, v_code
      from public.profiles
     where full_name = v_who or employee_code = v_who;

    select count(*) into v_rows
      from public.salary_history where profile_id = v_id;

    -- Named back before anything is destroyed, so the output is a record of
    -- WHO this ran against rather than of what was typed.
    raise notice 'Deleting % pay row(s) for % (%).', v_rows, v_name, coalesce(v_code, 'no employee code');
  end;
  $$;


  alter table public.salary_history disable trigger salary_history_no_update;

  delete from public.salary_history h
   using public.profiles p
   where p.id = h.profile_id
     and (p.full_name = current_setting('app.delete_salary_for')
       or p.employee_code = current_setting('app.delete_salary_for'));

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
     and (p.full_name = current_setting('app.delete_salary_for')
       or p.employee_code = current_setting('app.delete_salary_for'));

  /* -- §12. The rows are gone, so this is the only remaining evidence they
        existed. `audit_log.entity_id` carries no foreign key (P3-2), so the row
        outlives what it describes. No amount reaches the diff (§5, P19-10). -- */
  insert into public.audit_log (actor_id, entity, entity_id, action, diff)
  select auth.uid(), 'employment', p.id, 'salary_history.deleted',
         jsonb_build_object('by', 'DELETE-SALARY-HISTORY-ARMED.sql')
    from public.profiles p
   where p.full_name = current_setting('app.delete_salary_for')
      or p.employee_code = current_setting('app.delete_salary_for');

commit;


/* ============================================================================
   Confirm
   ==========================================================================
   `rows_left` must be 0.
   `guard` must say ON — if it says DISABLED, salary history is editable by
   anybody and the ALTER must be re-run.

   The setting is transaction-local, so it is gone by now — this repeats the
   name deliberately, because a confirmation that reads its own input from the
   run it is confirming is not a confirmation.
*/

select
  (select count(*)
     from public.salary_history h
     join public.profiles p on p.id = h.profile_id
    where p.full_name = 'Manav Khandale'
       or p.employee_code = 'Manav Khandale')         as rows_left,
  (select case tgenabled when 'O' then 'ON — append-only, correct'
                         else 'DISABLED — RE-ENABLE IT' end
     from pg_trigger
    where tgrelid = 'public.salary_history'::regclass
      and tgname = 'salary_history_no_update')        as guard;
