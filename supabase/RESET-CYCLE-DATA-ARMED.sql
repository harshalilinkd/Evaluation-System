-- RESET-CYCLE-DATA-ARMED.sql
--
-- The same reset as RESET-CYCLE-DATA.sql, already armed. Paste and run once.
--
-- That file is deliberately two-pass: STEP 2 sits inside /* … */ so a careless
-- run only ever counts. If you ran it and the counts came back unchanged, that
-- is what happened — nothing was wrong, the delete was never uncommented.
--
--   KEEPS  people and their logins · roles · departments · the staff question
--          bank · the worker form · section names · employment and salary
--          records · the audit trail
--
--   DELETES  STAFF: cycles · evaluations · everyone's answers · the frozen
--            question sets · reports · increment reviews · invite links
--            WORKER: appraisal rounds · appraisals · both sides' ticks · the
--            frozen sheets
--            BOTH: the sent-message log · due items
--
-- ============================================================================
-- THIS CANNOT BE UNDONE. Take a backup first:
--   Supabase dashboard → Database → Backups → the current point-in-time
-- ============================================================================
--
-- The two modules are deleted SEPARATELY, in their own blocks, because they
-- share no table (§7). That is not tidiness: `worker_evaluations` has no
-- foreign key into anything staff, so deleting one module cannot cascade into
-- the other by accident — and the worker block is wrapped so a database without
-- 0047 applied still runs this file rather than failing on a missing table.

begin;

/* ============================================================================
   The blocker, checked INSIDE the transaction rather than in a separate pass
   ==========================================================================
   `salary_history.evaluation_id` and `increment_reminders.evaluation_id` point
   at evaluations with no cascade and no "set null" (0023), and both tables
   refuse UPDATE and DELETE by trigger (P19-3, §5) for every caller including
   the owner of this database.

   So a confirmed increment genuinely pins its evaluation in place. Without this
   check the run would reach `delete from evaluations` and fail there on a raw
   foreign-key violation, which names a constraint rather than the decision
   behind it. Raising here says what is actually true: somebody's pay record is
   attached to a record you are about to destroy, and getting past it means
   switching off the guarantee that record rests on.

   Everything is one transaction, so this raise leaves nothing deleted —
   including the worker data below, which is why the check comes first. */
do $$
declare
  v_salary int := 0;
  v_reminders int := 0;
begin
  begin
    select count(*) into v_salary
      from public.salary_history where evaluation_id is not null;
  exception when undefined_table then v_salary := 0; end;

  begin
    select count(*) into v_reminders
      from public.increment_reminders where evaluation_id is not null;
  exception when undefined_table then v_reminders := 0; end;

  if v_salary > 0 or v_reminders > 0 then
    raise exception
      'STOP. % pay row(s) and % reminder(s) are tied to an evaluation you are about to delete. Nothing has been deleted. Ask before going further — this is the record of what somebody was actually paid.',
      v_salary, v_reminders;
  end if;
end;
$$;

/* ============================================================================
   1 · Staff evaluations
   ========================================================================== */
--
-- Most of this goes by cascade from `evaluations` (0003, 0006, 0029, 0030):
-- answers, frozen question sets, decisions, reports, increment reviews and
-- invite links all have ON DELETE CASCADE. They are listed explicitly anyway so
-- a table that ever loses its cascade cannot quietly survive a reset.

delete from public.invite_tokens;
delete from public.evaluation_responses;
delete from public.evaluation_questions;
delete from public.evaluation_decisions;

-- Later tables, wrapped so a database without 0029/0030/0031 still runs this.
do $$ begin delete from public.evaluation_reviews; exception when undefined_table then null; end; $$;
do $$ begin delete from public.increment_reviews;  exception when undefined_table then null; end; $$;
do $$ begin delete from public.due_items;          exception when undefined_table then null; end; $$;

-- The sent-message log. Its evaluation_id is ON DELETE SET NULL, so these rows
-- would otherwise survive as orphans — a list of messages about people whose
-- evaluations no longer exist.
delete from public.notifications_log;

/* -- THE IN-APP BELL, AND IT IS THE ONE THAT MATTERS MOST HERE.

      `app_notifications.evaluation_id` is a plain uuid with NO foreign key —
      deliberately (P3-2: a reference that must outlive the row it points at
      cannot be a constraint). The consequence is that NOTHING cascades these
      rows away.

      Run the reset without this and every employee opens the app to a bell
      reading "Your evaluation is open", linking to a form that no longer
      exists. That is the most confusing possible end state for a clean slate,
      and it is exactly what FIX-17 found missing from the full reset.

      This CYCLES-ONLY file was written before that and never had the line. -- */
do $$ begin delete from public.app_notifications; exception when undefined_table then null; end; $$;

delete from public.evaluations;

/* -- The cycle guard (P10-8).
      `evaluation_cycles` carries a trigger refusing to delete anything that is
      not DRAFT, because a launched cycle cascades to its frozen question sets
      and §5 exists to stop those disappearing. Here that IS the intent, so the
      guard is switched off deliberately and switched straight back on — rather
      than worked around by quietly setting every cycle to DRAFT, which would
      achieve the same thing while hiding what was done. -- */
alter table public.evaluation_cycles disable trigger evaluation_cycles_guard_delete;
delete from public.evaluation_cycles;
alter table public.evaluation_cycles enable trigger evaluation_cycles_guard_delete;

/* ============================================================================
   2 · Worker appraisals
   ========================================================================== */
--
-- Wrapped in one block, so a database that has not had 0047 applied runs this
-- file unchanged instead of failing on a table that does not exist yet.
--
-- `worker_cycles` has NO delete guard, unlike its staff counterpart. That is
-- not an oversight in 0047: the staff guard exists because a launched staff
-- cycle cascades to per-department frozen question sets that can never be
-- rebuilt. A worker round freezes the same eight qualities for everybody, so
-- there is nothing unrecoverable to protect — the sheet is still in
-- `worker_questions`, which this file does not touch.
--
-- Both child tables cascade from `worker_evaluations`, which cascades from
-- `worker_cycles`. Listed explicitly for the same reason the staff ones are.

do $$
begin
  /* -- The salary block on a worker sheet: the supervisor's percentage and the
        figures HR priced it at. CYCLE data, not pay — what somebody is actually
        paid lives in `employment_records` and `salary_history`, and neither is
        touched by this file.

        It cascades from `worker_evaluations`, and is listed anyway for the
        reason F17-9 gives: a table that ever loses its cascade must not quietly
        survive a reset. It was the one worker table missing from this list. -- */
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


/* ============================================================================
   Confirm. Left side all 0; right side unchanged from before.
   ==========================================================================
   The worker counts are read through a function rather than a plain subquery,
   because a `select` naming a missing table fails to PARSE — the exception
   handler above cannot save a query that never runs. This returns -1 where the
   tables are absent, which reads as "not applicable" rather than as a count. */

create or replace function pg_temp.count_or_absent(p_table text)
returns bigint language plpgsql as $$
declare v_n bigint;
begin
  execute format('select count(*) from public.%I', p_table) into v_n;
  return v_n;
exception when undefined_table then return -1;
end;
$$;

select
  (select count(*) from public.evaluation_cycles)     as staff_cycles_left,
  (select count(*) from public.evaluations)           as staff_evaluations_left,
  (select count(*) from public.evaluation_responses)  as staff_answers_left,
  (select count(*) from public.evaluation_questions)  as staff_frozen_left,
  pg_temp.count_or_absent('worker_cycles')            as worker_rounds_left,
  pg_temp.count_or_absent('worker_evaluations')       as worker_appraisals_left,
  pg_temp.count_or_absent('worker_evaluation_responses') as worker_ticks_left,
  (select count(*) from public.invite_tokens)         as tokens_left,
  (select count(*) from public.notifications_log)     as messages_left,
  '|'                                                 as kept,
  (select count(*) from public.profiles)              as people,
  (select count(*) from public.user_roles)            as role_grants,
  (select count(*) from public.departments)           as departments,
  (select count(*) from public.questions)             as staff_questions,
  pg_temp.count_or_absent('worker_questions')         as worker_qualities;
