-- RESET-CYCLES-AND-PAY-ARMED.sql
--
-- Everything to do with appraisals AND everything to do with pay. Already
-- armed: paste and run once.
--
-- This is the harder-hitting sibling of RESET-CYCLE-DATA-ARMED.sql, which keeps
-- pay records and therefore stops on its own blocker when a confirmed increment
-- is attached to an evaluation. Use this one when the answer to that blocker is
-- "delete the pay records too".
--
--   DELETES
--     STAFF    cycles · evaluations · answers · frozen question sets · reports
--              · increment reviews · invite links
--     WORKER   appraisal rounds · appraisals · both sides' ticks · frozen sheets
--     PAY      the entire salary history · increment reminders · every salary
--              figure on the employment record
--     BOTH     the sent-message log · due items
--
--   KEEPS
--     people and their logins · roles · departments · the staff question bank ·
--     the worker form · section names · JOINING DATES and increment schedules ·
--     the audit trail
--
-- Employment RECORDS survive with their money emptied. Deleting them outright
-- would take joining dates and increment frequencies with them, and those are
-- personnel facts rather than pay — you would be re-typing every joining date
-- to get the increment calendar back.
--
-- ============================================================================
-- THIS CANNOT BE UNDONE, AND IT DELIBERATELY BREAKS A GUARANTEE.
--
-- P19-3 made `salary_history` append-only by TRIGGER as well as by policy, so
-- that no caller — not the service role, not a migration, not the owner in this
-- editor — could remove the record of what somebody was actually paid. There is
-- no product path to deleting one, by design.
--
-- This switches that off, deletes, and switches it back on. It is an operator
-- action for clearing test data, not a feature. On real payroll data it
-- destroys evidence you may be required to keep.
--
-- TAKE A BACKUP FIRST: Supabase dashboard → Database → Backups.
-- ============================================================================

begin;

/* -- What is about to go, printed before it goes.
      There is no blocker in this file — that is the point of it — so this
      notice is the only thing standing between a paste and a wiped pay ledger.
      If these names and figures are not test data, cancel now. -- */
do $$
declare
  r record;
  v_n int := 0;
begin
  for r in
    select p.full_name,
           to_char(h.effective_from, 'DD-MM-YYYY') as effective,
           h.new_ctc,
           h.reason
      from public.salary_history h
      join public.profiles p on p.id = h.profile_id
     order by p.full_name, h.effective_from
  loop
    v_n := v_n + 1;
    raise notice 'DELETING PAY ROW: % · % · % · %', r.full_name, r.effective, r.new_ctc, r.reason;
  end loop;
  raise notice '--- % pay row(s) will be destroyed ---', v_n;
end;
$$;

/* ============================================================================
   1 · Staff evaluations
   ==========================================================================
   Most of this cascades from `evaluations` (0003, 0006, 0029, 0030). Listed
   explicitly anyway, so a table that ever loses its cascade cannot quietly
   survive a reset. */

delete from public.invite_tokens;
delete from public.evaluation_responses;
delete from public.evaluation_questions;
delete from public.evaluation_decisions;

do $$ begin delete from public.evaluation_reviews; exception when undefined_table then null; end; $$;
do $$ begin delete from public.increment_reviews;  exception when undefined_table then null; end; $$;
do $$ begin delete from public.due_items;          exception when undefined_table then null; end; $$;

-- `notifications_log.evaluation_id` is ON DELETE SET NULL, so these would
-- otherwise survive as orphans: messages about evaluations that no longer exist.
delete from public.notifications_log;

/* ============================================================================
   2 · Pay — BEFORE the evaluations, because it is what pins them
   ==========================================================================
   `salary_history.evaluation_id` and `increment_reminders.evaluation_id` have
   no cascade and no "set null" (0023), deliberately: deleting an appraisal must
   never silently erase the reason somebody's pay changed. Clearing pay first is
   what lets the evaluations go afterwards without a foreign-key violation. */

alter table public.salary_history disable trigger salary_history_no_update;
delete from public.salary_history;
alter table public.salary_history enable trigger salary_history_no_update;

do $$ begin delete from public.increment_reminders; exception when undefined_table then null; end; $$;

/* -- The figures on the record, emptied but the record kept.
      P19D-5: a `current_ctc` with no history behind it is a number nobody can
      account for, and it would sit on the increment calendar and the employment
      tab with nothing to explain it. A blank honestly says "not recorded"; a
      figure is a claim.

      `date_of_joining`, `last_increment_date` and `increment_frequency_months`
      are NOT cleared — they are personnel facts, not pay, and the increment
      calendar is rebuilt from them. -- */
update public.employment_records
   set current_ctc = null,
       joining_ctc = null,
       salary_effective_from = null,
       joining_ctc_recorded_by = null,
       joining_ctc_recorded_at = null
 where current_ctc is not null
    or joining_ctc is not null;

/* ============================================================================
   3 · The evaluations and their cycles
   ========================================================================== */

delete from public.evaluations;

/* -- The cycle guard (P10-8). `evaluation_cycles` refuses to delete anything
      that is not DRAFT, because a launched cycle cascades to frozen question
      sets and §5 exists to stop those disappearing. Here that IS the intent, so
      it is switched off openly rather than worked around by quietly setting
      every cycle to DRAFT. -- */
alter table public.evaluation_cycles disable trigger evaluation_cycles_guard_delete;
delete from public.evaluation_cycles;
alter table public.evaluation_cycles enable trigger evaluation_cycles_guard_delete;

/* ============================================================================
   4 · Worker appraisals
   ==========================================================================
   Wrapped, so a database without 0047 runs this file unchanged. `worker_cycles`
   has no delete guard: a worker round freezes the same eight qualities for
   everybody, so unlike a staff cycle there is nothing unrecoverable to protect
   — the sheet is still in `worker_questions`, untouched by this file. */

do $$
begin
  delete from public.worker_evaluation_responses;
  delete from public.worker_evaluation_questions;
  delete from public.worker_evaluations;
  delete from public.worker_cycles;
exception
  when undefined_table then
    raise notice 'Worker appraisal tables are not present (0047 not applied).';
end;
$$;

commit;


/* ============================================================================
   Confirm
   ==========================================================================
   Everything left of the divider must be 0. `guard` must say ON — if it says
   DISABLED, salary history is editable by anybody and the ALTER must be re-run
   before anything else happens. */

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
  (select count(*) from public.evaluation_cycles)        as staff_cycles_left,
  (select count(*) from public.evaluations)              as staff_evaluations_left,
  (select count(*) from public.salary_history)           as pay_rows_left,
  (select count(*) from public.employment_records
    where current_ctc is not null or joining_ctc is not null) as salary_figures_left,
  pg_temp.count_or_absent('worker_cycles')               as worker_rounds_left,
  pg_temp.count_or_absent('worker_evaluations')          as worker_appraisals_left,
  (select count(*) from public.notifications_log)        as messages_left,
  '|'                                                    as kept,
  (select count(*) from public.profiles)                 as people,
  (select count(*) from public.departments)              as departments,
  (select count(*) from public.questions)                as staff_questions,
  pg_temp.count_or_absent('worker_questions')            as worker_qualities,
  (select count(*) from public.employment_records)       as employment_records_kept,
  (select case tgenabled when 'O' then 'ON — append-only, correct'
                         else 'DISABLED — RE-ENABLE IT' end
     from pg_trigger
    where tgrelid = 'public.salary_history'::regclass
      and tgname = 'salary_history_no_update')           as guard;
