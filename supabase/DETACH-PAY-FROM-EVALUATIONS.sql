-- DETACH-PAY-FROM-EVALUATIONS.sql
--
-- Run this when RESET-CYCLE-DATA-ARMED.sql stops with:
--   "STOP. N pay row(s) and N reminder(s) are tied to an evaluation…"
--
-- WHAT IS ACTUALLY IN THE WAY. When an increment is confirmed, the pay row it
-- creates records WHICH APPRAISAL justified it (`salary_history.evaluation_id`,
-- 0023). That link has no cascade and no "set null" on purpose: deleting an
-- evaluation must not silently erase the reason somebody's pay changed.
--
-- WHAT THIS DOES, AND WHAT IT DOES NOT. It sets that link to null and nothing
-- else. The amount, the date, the reason, the note and who recorded it are all
-- untouched — what somebody was paid, and when, is not something this file can
-- change. Afterwards the pay record still says "increment, 15%, 01-04-2026";
-- it just no longer points at an appraisal that is about to stop existing.
--
-- THE COST, stated plainly: after this you can no longer trace that raise back
-- to the appraisal that justified it. If these are REAL pay records and that
-- trail matters, do not run this — keep the evaluations instead, or delete the
-- cycles individually and leave that one alone.
--
-- ============================================================================
-- IT SWITCHES OFF THE APPEND-ONLY GUARD, DELIBERATELY, AND SWITCHES IT BACK ON.
--
-- P19-3 made `salary_history` refuse UPDATE and DELETE by trigger so that no
-- caller — not the service role, not a migration, not the owner in this editor
-- — could quietly rewrite the record of what somebody was paid. That guard is
-- doing its job here; this is the narrowest possible exception to it, and the
-- last section checks it came back.
--
-- TAKE A BACKUP FIRST: Supabase dashboard → Database → Backups.
-- ============================================================================

begin;

/* -- What is being detached, printed BEFORE it happens.
      "1 row updated" says nothing about whose pay it was or how much. If this
      is real data rather than test data, this notice is the last chance to
      notice that. -- */
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
     where h.evaluation_id is not null
     order by p.full_name, h.effective_from
  loop
    v_n := v_n + 1;
    raise notice 'Detaching: % · % · % · %', r.full_name, r.effective, r.new_ctc, r.reason;
  end loop;

  if v_n = 0 then
    raise notice 'No pay rows are tied to an evaluation. Nothing to do — re-run the reset.';
  end if;
end;
$$;

/* -- The pay rows. -- */
alter table public.salary_history disable trigger salary_history_no_update;

update public.salary_history
   set evaluation_id = null
 where evaluation_id is not null;

alter table public.salary_history enable trigger salary_history_no_update;

/* -- The reminders.
      No append-only trigger on this table — checked, not assumed. A reminder is
      a task, not a record of what happened, so it was never given one. -- */
do $$
begin
  update public.increment_reminders
     set evaluation_id = null
   where evaluation_id is not null;
exception
  when undefined_table then
    raise notice 'increment_reminders is not present. Nothing to detach there.';
end;
$$;

commit;


/* ============================================================================
   Confirm, then re-run RESET-CYCLE-DATA-ARMED.sql
   ==========================================================================
   `pay_rows_still_tied` must be 0, and `guard` must say ON. If the guard says
   DISABLED, salary history is editable by anybody and the ALTER above must be
   re-run before you do anything else. */

select
  (select count(*) from public.salary_history where evaluation_id is not null)
    as pay_rows_still_tied,
  (select count(*) from public.salary_history)
    as pay_rows_kept,
  (select case tgenabled when 'O' then 'ON — append-only, correct'
                         else 'DISABLED — RE-ENABLE IT' end
     from pg_trigger
    where tgrelid = 'public.salary_history'::regclass
      and tgname = 'salary_history_no_update')
    as guard;
