-- RESET-CYCLE-DATA.sql
--
-- Deletes every cycle and everything that hangs off one, so the system is ready
-- for real use after testing.
--
--   KEEPS  people and their logins · roles · departments · the question bank ·
--          the worker form · section names · employment and salary records ·
--          the audit trail
--
--   DELETES  cycles · evaluations · everyone's answers · the frozen question
--            sets · reports · increment reviews · invite links · the sent-message
--            log · due items
--
-- ============================================================================
-- THIS CANNOT BE UNDONE. Take a backup first:
--   Supabase dashboard → Database → Backups → the current point-in-time
-- ============================================================================
--
-- Run it in two passes. STEP 1 only counts and reports; nothing changes until
-- you uncomment STEP 2 and run again.
--
-- IF THE COUNTS CAME BACK UNCHANGED, that is this file working as designed —
-- STEP 2 is still commented out and no delete was attempted. Either uncomment
-- it below, or run RESET-CYCLE-DATA-ARMED.sql, which is the same delete already
-- armed and in one transaction.

/* ============================================================================
   STEP 1 · What is there, and is anything in the way?
   ========================================================================== */

do $$
declare
  v_cycles int; v_evals int; v_answers int; v_snapshots int;
  v_tokens int; v_messages int; v_due int; v_reports int; v_increments int;
  v_salary_linked int; v_reminders_linked int;
begin
  select count(*) into v_cycles     from public.evaluation_cycles;
  select count(*) into v_evals      from public.evaluations;
  select count(*) into v_answers    from public.evaluation_responses;
  select count(*) into v_snapshots  from public.evaluation_questions;
  select count(*) into v_tokens     from public.invite_tokens;
  select count(*) into v_messages   from public.notifications_log;

  -- These four arrived in later migrations; a database without them is fine.
  begin select count(*) into v_due from public.due_items; exception when undefined_table then v_due := -1; end;
  begin select count(*) into v_reports from public.evaluation_reviews; exception when undefined_table then v_reports := -1; end;
  begin select count(*) into v_increments from public.increment_reviews; exception when undefined_table then v_increments := -1; end;

  raise notice '--- WILL BE DELETED ---';
  raise notice 'cycles                %', v_cycles;
  raise notice 'evaluations           %', v_evals;
  raise notice 'answers               %', v_answers;
  raise notice 'frozen questions      %', v_snapshots;
  raise notice 'invite links          %', v_tokens;
  raise notice 'sent messages         %', v_messages;
  raise notice 'due items             %', v_due;
  raise notice 'reports               %', v_reports;
  raise notice 'increment reviews     %', v_increments;

  /* -- THE ONE THING THAT CAN BLOCK THIS.
        `salary_history.evaluation_id` and `increment_reminders.evaluation_id`
        point at evaluations with no cascade and no "set null" — and BOTH tables
        refuse UPDATE and DELETE by trigger (P19-3, §5), for every caller
        including the owner of this database.

        So if an increment was ever confirmed against an evaluation, that
        evaluation genuinely cannot be deleted without first switching off a
        guarantee the system is built on. Counted here rather than discovered
        halfway through the delete. -- */
  begin
    select count(*) into v_salary_linked from public.salary_history where evaluation_id is not null;
  exception when undefined_table then v_salary_linked := 0; end;
  begin
    select count(*) into v_reminders_linked from public.increment_reminders where evaluation_id is not null;
  exception when undefined_table then v_reminders_linked := 0; end;

  raise notice '--- BLOCKERS ---';
  if v_salary_linked = 0 and v_reminders_linked = 0 then
    raise notice 'none. Uncomment STEP 2 and run again.';
  else
    raise notice 'pay rows tied to an evaluation: %', v_salary_linked;
    raise notice 'reminders tied to an evaluation: %', v_reminders_linked;
    raise notice 'STOP. A confirmed increment is attached to an evaluation you are about to delete.';
    raise notice 'Deleting it means dropping the append-only guard on salary_history, which is';
    raise notice 'the record of what somebody was actually paid. Ask before going further.';
  end if;
end;
$$;


/* ============================================================================
   STEP 2 · The delete
   ==========================================================================
   Remove the surrounding comment markers to arm it, then run again.

   Everything is inside ONE transaction. If any part fails, nothing is deleted —
   there is no half-reset state to reason about afterwards.
*/

/*
begin;

  -- Most of it goes by cascade from `evaluations` (0003, 0006, 0029, 0030):
  -- answers, frozen question sets, decisions, reports, increment reviews and
  -- invite links all have ON DELETE CASCADE. They are listed explicitly anyway
  -- so the counts below are honest about what went, and so a table that ever
  -- loses its cascade does not quietly survive a reset.
  delete from public.invite_tokens;
  delete from public.evaluation_responses;
  delete from public.evaluation_questions;
  delete from public.evaluation_decisions;

  -- Later tables. Wrapped so a database that has not had 0029/0030/0031 applied
  -- still runs this file.
  do $$ begin delete from public.evaluation_reviews; exception when undefined_table then null; end; $$;
  do $$ begin delete from public.increment_reviews;  exception when undefined_table then null; end; $$;
  do $$ begin delete from public.due_items;          exception when undefined_table then null; end; $$;

  -- The sent-message log. Its evaluation_id is ON DELETE SET NULL, so these rows
  -- would otherwise survive as orphans — a list of messages about people whose
  -- evaluations no longer exist.
  delete from public.notifications_log;

  /* -- THE IN-APP BELL, AND IT IS THE ONE THAT MATTERS MOST HERE.
        `app_notifications.evaluation_id` is a plain uuid with NO foreign key
        (P3-2), so NOTHING cascades these away. Without this line every employee
        opens the app to a bell reading "Your evaluation is open", linking to a
        form that no longer exists — the most confusing possible end state for a
        clean slate. FIX-17 found it missing from the full reset; this file was
        written before that and never had it either. -- */
  do $$ begin delete from public.app_notifications; exception when undefined_table then null; end; $$;

  delete from public.evaluations;

  /* -- The cycle guard (P10-8).
        `evaluation_cycles` has a trigger refusing to delete anything that is not
        DRAFT, because a launched cycle cascades to its frozen question sets and
        §5 exists to stop those disappearing. Here that is exactly the intent, so
        the guard is switched off DELIBERATELY and switched straight back on —
        rather than worked around by quietly setting every cycle to DRAFT, which
        would achieve the same thing while hiding what was done. -- */
  alter table public.evaluation_cycles disable trigger evaluation_cycles_guard_delete;
  delete from public.evaluation_cycles;
  alter table public.evaluation_cycles enable trigger evaluation_cycles_guard_delete;

  /* -- THE WORKER MODULE, in its own block because it shares no table (§7).
        This file predates that module and left every production round behind —
        a "reset" that cleared the staff cycles and nothing else.

        `worker_evaluation_decisions` holds the supervisor's percentage and what
        HR priced it at. That is CYCLE data, not pay: what somebody is actually
        paid lives in `employment_records` and `salary_history`, and neither is
        touched anywhere in this file. -- */
  do $$
  begin
    delete from public.worker_evaluation_decisions;
    delete from public.worker_evaluation_responses;
    delete from public.worker_evaluation_questions;
    delete from public.worker_evaluations;
    delete from public.worker_cycles;
  exception
    when undefined_table then
      raise notice 'Worker appraisal tables are not present (0047 not applied). Nothing to delete there.';
  end;
  $$;

commit;
*/


/* ============================================================================
   STEP 3 · Confirm what survived
   ==========================================================================
   Run this after STEP 2. Everything on the left should be 0; everything on the
   right should be what you had before.
*/

select
  (select count(*) from public.evaluation_cycles)     as cycles_left,
  (select count(*) from public.evaluations)           as evaluations_left,
  (select count(*) from public.evaluation_responses)  as answers_left,
  (select count(*) from public.notifications_log)     as messages_left,
  (select count(*) from public.app_notifications)     as bell_items_left,
  '|'                                                 as kept,
  (select count(*) from public.profiles)              as people,
  (select count(*) from public.user_roles)            as role_grants,
  (select count(*) from public.departments)           as departments,
  (select count(*) from public.questions)             as questions,
  (select count(*) from public.department_questions)  as question_mappings;

/* -- PAY, CHECKED SEPARATELY AND DELIBERATELY.

      "Salaries untouched" is the whole reason this file exists rather than
      RESET-CYCLES-AND-PAY. Nothing above deletes from either table, but an
      absence in a script is not something anybody can see — so it is asserted
      here, with the numbers from before the run to compare against.

      A NOTE ON WHAT THIS CANNOT UNDO. If a test INCREMENT cycle was confirmed
      and closed, `confirm_increment` already appended a `salary_history` row
      and moved `employment_records.current_ctc`. Deleting the cycle does not
      reverse that, and this file will not try: `salary_history` is append-only
      for every caller including a migration (P19-3), and the guarantee is worth
      more than a tidy table. Check `pay_changes_from_a_cycle` below — if it is
      not zero, those figures came from a test run and need correcting on the
      person's Employment tab. -- */

select
  (select count(*) from public.employment_records)    as employment_records,
  (select count(*) from public.salary_history)        as pay_history_rows,
  (select count(*) from public.salary_history
     where evaluation_id is not null)                 as pay_changes_from_a_cycle,
  (select count(*) from public.increment_reminders)   as increment_reminders,
  (select count(*) from public.employment_records
     where current_ctc is not null)                   as people_with_a_salary;
