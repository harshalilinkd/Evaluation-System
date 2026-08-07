-- RESET-CYCLE-DATA-ARMED.sql
--
-- The same reset as RESET-CYCLE-DATA.sql, already armed. Paste and run once.
--
-- That file is deliberately two-pass: STEP 2 sits inside /* … */ so a careless
-- run only ever counts. If you ran it and the counts came back unchanged, that
-- is what happened — nothing was wrong, the delete was never uncommented.
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

begin;

/* -- The blocker, checked INSIDE the transaction rather than in a separate pass.
      `salary_history.evaluation_id` and `increment_reminders.evaluation_id`
      point at evaluations with no cascade and no "set null" (0023), and both
      tables refuse UPDATE and DELETE by trigger (P19-3, §5) for every caller
      including the owner of this database.

      So a confirmed increment genuinely pins its evaluation in place. Without
      this check the run would reach `delete from evaluations` and fail there on
      a raw foreign-key violation, which names a constraint rather than the
      decision behind it. Raising here says what is actually true: somebody's
      pay record is attached to a record you are about to destroy, and getting
      past it means switching off the guarantee that record rests on.

      Everything is one transaction, so this raise leaves nothing deleted. -- */
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

/* -- Most of this goes by cascade from `evaluations` (0003, 0006, 0029, 0030):
      answers, frozen question sets, decisions, reports, increment reviews and
      invite links all have ON DELETE CASCADE. They are listed explicitly anyway
      so a table that ever loses its cascade cannot quietly survive a reset. -- */
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

commit;


/* ============================================================================
   Confirm. Left side all 0; right side unchanged from before.
   ========================================================================== */

select
  (select count(*) from public.evaluation_cycles)     as cycles_left,
  (select count(*) from public.evaluations)           as evaluations_left,
  (select count(*) from public.evaluation_responses)  as answers_left,
  (select count(*) from public.evaluation_questions)  as frozen_left,
  (select count(*) from public.invite_tokens)         as tokens_left,
  (select count(*) from public.notifications_log)     as messages_left,
  '|'                                                 as kept,
  (select count(*) from public.profiles)              as people,
  (select count(*) from public.user_roles)            as role_grants,
  (select count(*) from public.departments)           as departments,
  (select count(*) from public.questions)             as questions,
  (select count(*) from public.department_questions)  as question_mappings;
