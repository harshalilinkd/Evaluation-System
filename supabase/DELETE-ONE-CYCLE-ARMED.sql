-- ============================================================================
-- DELETE ONE CYCLE, PERMANENTLY.  ⚠ ARMED — this one really deletes.
--
-- Paste into the Supabase SQL editor and run. It deletes a SINGLE named cycle
-- and everything under it, and it refuses to run if that cycle holds any real
-- appraisal work.
--
-- WHY THIS IS NOT A BUTTON IN THE APP.
-- `guard_cycle_delete` refuses to delete a launched cycle, and that guard is
-- right: a launched cycle holds the frozen question set each person was given
-- and every answer they have written into it, and §5 exists precisely so those
-- cannot be destroyed. The recycle bin is the product's answer — a binned cycle
-- is already out of every list and every report, and costs nothing to leave.
--
-- The one case the guard cannot tell apart is a cycle created BY MISTAKE that
-- nobody has touched. That is what this file is for, and the three guards below
-- are what keep it to that case. They are counted, not assumed:
--
--     * no layer has been submitted
--     * no layer holds a single answer
--     * no message has ever gone out about it
--
-- If any of those is non-zero the script raises and deletes nothing. Do not
-- weaken them — if a cycle has real work in it, the honest answer is the bin.
--
-- WHAT IT ALSO DOES, and both matter:
--   * clears the in-app bell entries for the evaluations it removes. Those
--     carry no foreign key (P3-2), so nothing cascades them — leave them and
--     somebody opens the app to "Your evaluation is open" pointing at a form
--     that no longer exists.
--   * puts anybody whose due item was consumed back on the watchlist. Their
--     item points at an evaluation about to disappear; left alone they would
--     never show as due again, which is a silent gap rather than a tidy delete.
--
-- SCHEMA. Unlike a migration — which is written against `public` and retargeted
-- when it is applied — this file is pasted and run as-is, so it names the
-- schema the tables actually live in.
-- ============================================================================

-- ⚠ NAME THE CYCLE HERE. Exactly as it appears on the cycle list.
--   The script refuses if this matches no cycle, or more than one.
--
-- No psql meta-commands in this file. The Supabase SQL editor is not psql, and
-- a leading `\set` is a syntax error there every time — which is how
-- `bootstrap-admin.sql` failed on the one screen it was written to be pasted
-- into (F1-3). Everything below is plain SQL.

do $op$
declare
  -- ⚠⚠ THE ONE LINE TO EDIT ⚠⚠
  v_target  text := '3-month reviews FY 26-27';

  v_cycle   uuid;
  v_matches integer;
  v_evals   integer;
  v_work    integer;
  v_sent    integer;
  v_notifs  integer;
  v_due     integer;
begin
  select count(*) into v_matches from evaluation.evaluation_cycles where name = v_target;

  if v_matches = 0 then
    raise exception 'No cycle is called "%". Nothing was deleted. Check the name on the cycle list.', v_target;
  end if;
  if v_matches > 1 then
    raise exception '% cycles are called "%". Refusing to guess which one. Rename one of them first.', v_matches, v_target;
  end if;

  select id into v_cycle from evaluation.evaluation_cycles where name = v_target;

  /* ---------- The three guards ---------- */

  select count(*) into v_evals
    from evaluation.evaluations where cycle_id = v_cycle;

  select count(*) into v_work
    from evaluation.evaluations e
    join evaluation.evaluation_responses r on r.evaluation_id = e.id
   where e.cycle_id = v_cycle
     and (r.answers <> '{}'::jsonb or r.submitted_at is not null);

  select count(*) into v_sent
    from evaluation.evaluations e
    join evaluation.notifications_log n on n.evaluation_id = e.id
   where e.cycle_id = v_cycle;

  if v_work > 0 or v_sent > 0 then
    raise exception
      'REFUSED. "%" holds % answered or submitted layer(s) and % sent message(s). That is real appraisal work and this script will not destroy it — leave the cycle in the recycle bin instead.',
      v_target, v_work, v_sent;
  end if;

  /* ---------- The parts nothing cascades ---------- */

  delete from evaluation.app_notifications
   where evaluation_id in (select id from evaluation.evaluations where cycle_id = v_cycle);
  get diagnostics v_notifs = row_count;

  update evaluation.due_items
     set status = 'PENDING', evaluation_id = null, actioned_by = null, actioned_at = null
   where evaluation_id in (select id from evaluation.evaluations where cycle_id = v_cycle);
  get diagnostics v_due = row_count;

  /* ---------- §12 ----------
     Written BEFORE the rows go: afterwards this is the only remaining record
     that the cycle ever existed. `audit_log.entity_id` carries no foreign key,
     so the row outlives everything it describes. */
  insert into evaluation.audit_log (actor_id, entity, entity_id, action, diff, reason)
  values (null, 'cycle', v_cycle, 'cycle.deleted_permanently',
          jsonb_build_object('name', v_target, 'evaluations', v_evals,
                             'answers', v_work, 'messages_sent', v_sent,
                             'notifications_cleared', v_notifs,
                             'due_items_reopened', v_due),
          'Deleted permanently at the owner''s request via DELETE-ONE-CYCLE-ARMED.sql. Held no answers, no submissions and no sent messages.');

  /* ---------- The cycle ----------
     The guard is lifted for this statement only and put straight back. Both
     sit inside the same transaction as everything above, so a failure anywhere
     leaves the guard enabled and the cycle untouched. */
  alter table evaluation.evaluation_cycles disable trigger evaluation_cycles_guard_delete;
  delete from evaluation.evaluation_cycles where id = v_cycle;
  alter table evaluation.evaluation_cycles enable trigger evaluation_cycles_guard_delete;

  raise notice 'Deleted "%" — % evaluation(s) removed, % bell entr(ies) cleared, % person/people put back on Evaluation Due.',
    v_target, v_evals, v_notifs, v_due;
end;
$op$;

-- ---------------------------------------------------------------------------
-- Confirm. Expect: the cycle gone, and the guard back on.
-- ---------------------------------------------------------------------------
select
  (select count(*) from evaluation.evaluation_cycles
    where name = '3-month reviews FY 26-27')                          as cycle_rows_left,
  (select tgenabled from pg_trigger
    where tgname = 'evaluation_cycles_guard_delete')                  as guard_enabled_O_is_on,
  (select count(*) from evaluation.due_items where status = 'PENDING') as items_now_pending;
