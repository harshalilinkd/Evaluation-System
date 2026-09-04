-- 0107: the indexes Postgres asked for, and two policies that ran per row.
--
-- ============================================================================
-- MEASURED, NOT GUESSED. Supabase's own performance advisors were run against
-- this project and filtered to the `evaluation` schema: 27 foreign keys with no
-- covering index, and 2 policies re-evaluating auth.uid() for every row.
--
-- Nothing here changes what anybody may read or write. Every index is additive
-- and every policy keeps its predicate exactly — only WHEN the predicate is
-- evaluated moves.
-- ============================================================================

begin;

/* ---------- 1 · The bell, which every authenticated page reads ---------- */
--
-- `auth.uid() = profile_id` written that way is a VOLATILE call per candidate
-- row; wrapped in a sub-select it becomes an InitPlan, evaluated once for the
-- whole statement. Identical semantics — this is Supabase's own documented
-- form — and it matters here more than anywhere because the bell is read on
-- every page load and the table only grows.

drop policy if exists "app_notifications_read_own" on public.app_notifications;
create policy "app_notifications_read_own" on public.app_notifications
  for select to authenticated
  using (profile_id = (select auth.uid()));

drop policy if exists "app_notifications_mark_own_read" on public.app_notifications;
create policy "app_notifications_mark_own_read" on public.app_notifications
  for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

/* -- The read is always "mine, newest first", so it gets the index that
      answers exactly that rather than one on profile_id alone. -- */
create index if not exists app_notifications_profile_created_idx
  on public.app_notifications (profile_id, created_at desc);

/* ---------- 2 · Foreign keys with no covering index ---------- */
--
-- Two separate costs, and every column below carries at least one:
--   · a lookup by that column is a sequential scan;
--   · a DELETE on the parent must scan the child to enforce the constraint —
--     which 0106 has just made a thing this product does on purpose.
--
-- Most are `*_by` columns that are only read on a trail or a detail panel. They
-- are indexed anyway because the second cost applies to all of them, the tables
-- are small and write-light, and a partial list is a list somebody has to
-- re-derive.

-- Read paths first: these are joined on screens people open constantly.
create index if not exists profiles_co_reviewer_idx            on public.profiles (co_reviewer_id);
create index if not exists evaluations_department_idx          on public.evaluations (department_id);
create index if not exists department_questions_question_idx   on public.department_questions (question_id);
create index if not exists questions_depends_on_idx            on public.questions (depends_on);
create index if not exists notifications_log_profile_idx       on public.notifications_log (profile_id);
create index if not exists invite_tokens_profile_idx           on public.invite_tokens (profile_id);
create index if not exists audit_log_actor_idx                 on public.audit_log (actor_id);

-- The three that 0106 turned into DELETE-time scans.
create index if not exists salary_history_evaluation_idx       on public.salary_history (evaluation_id);
create index if not exists increment_reminders_evaluation_idx  on public.increment_reminders (evaluation_id);
create index if not exists due_items_evaluation_idx            on public.due_items (evaluation_id);

-- The rest of the advisor's list.
create index if not exists due_items_actioned_by_idx           on public.due_items (actioned_by);
create index if not exists employment_joining_recorded_by_idx  on public.employment_records (joining_ctc_recorded_by);
create index if not exists evaluation_cycles_created_by_idx    on public.evaluation_cycles (created_by);
create index if not exists evaluation_reviews_hr_by_idx        on public.evaluation_reviews (hr_reviewed_by);
create index if not exists evaluation_reviews_md_by_idx        on public.evaluation_reviews (md_reviewed_by);
create index if not exists evaluation_schedule_updated_by_idx  on public.evaluation_schedule (updated_by);
create index if not exists increment_settings_updated_by_idx   on public.increment_settings (updated_by);
create index if not exists invite_tokens_created_by_idx        on public.invite_tokens (created_by);
create index if not exists notification_settings_paused_by_idx on public.notification_settings (paused_by);
create index if not exists notification_templates_updated_by_idx on public.notification_templates (updated_by);
create index if not exists questions_created_by_idx            on public.questions (created_by);
create index if not exists salary_history_corrected_by_idx     on public.salary_history (corrected_by);
create index if not exists salary_history_recorded_by_idx      on public.salary_history (recorded_by);
create index if not exists worker_cycles_created_by_idx        on public.worker_cycles (created_by);
create index if not exists worker_decisions_decided_by_idx     on public.worker_evaluation_decisions (decided_by);
create index if not exists worker_evaluations_department_idx   on public.worker_evaluations (department_id);
create index if not exists worker_evaluations_self_filled_idx  on public.worker_evaluations (self_filled_by);

commit;

do $chk$
declare
  v_bad integer;
begin
  -- The predicate must be unchanged; only when it is evaluated moves.
  select count(*) into v_bad
    from pg_policy pol join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'app_notifications'
     and pg_get_expr(pol.polqual, pol.polrelid) not like '%( SELECT auth.uid()%';

  if v_bad > 0 then
    raise exception '0107: % app_notifications policy/policies still call auth.uid() per row.', v_bad;
  end if;

  -- And it must still be scoped to the reader's own rows (N1-10: nobody, not
  -- even HR, reads somebody else's bell).
  if exists (
    select 1 from pg_policy pol join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'app_notifications'
       and pg_get_expr(pol.polqual, pol.polrelid) not like '%profile_id =%'
  ) then
    raise exception '0107: an app_notifications policy is no longer scoped to the reader.';
  end if;

  raise notice '0107 applied. 28 indexes, and the bell no longer resolves the session per row.';
end;
$chk$;
