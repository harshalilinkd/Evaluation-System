-- RESET-PEOPLE-ARMED.sql
--
-- Deletes the people. Already armed: paste and run once.
--
--   DELETES  every account except the ones kept below — the login, the profile,
--            the role grants, the employment record (joining date, increment
--            schedule), any increment reminder and any notification bell
--   KEEPS    ONLY the addresses in the KEEP list at the top — administrators
--            included, so read that list before running this · departments ·
--            the question bank · the worker form · section names · the audit
--            trail, with the deleted people's names taken off it
--
--            AT LEAST ONE ADMINISTRATOR MUST SURVIVE. The file refuses rather
--            than leave a system nobody can sign in to.
--
-- ============================================================================
-- THIS CANNOT BE UNDONE, AND IT DELIBERATELY BREAKS A GUARANTEE.
--
-- P4-4 made `audit_log` append-only by TRIGGER as well as by policy, so that no
-- caller — not the service role, not a migration, not the owner in this editor —
-- could alter the record of who did what. §12 has no exception in it.
--
-- Deleting a person is refused by that table, and correctly: they are named on
-- every row they ever caused. This switches the guard off, ANONYMISES those
-- rows — `actor_id` to null, exactly what the system actor looks like — and
-- switches it back on. The rows are not deleted: WHAT happened survives, only
-- WHO did it goes, which is what deleting somebody means.
--
-- TAKE A BACKUP FIRST: Supabase dashboard → Database → Backups.
--
-- BEFORE REACHING FOR THIS:
--   · Re-importing your spreadsheet UPDATES people who already exist. Nobody
--     has to be deleted to correct a roster (FIX-24).
--   · If the pay figures are what you are trying to restore after
--     RESET-CYCLES-AND-PAY-ARMED.sql, re-importing does that on its own now:
--     the import fills a salary in where the ledger is EMPTY, and still refuses
--     to overwrite one that is not.
--   · Settings › Users → Delete several does this for the people it is allowed
--     to, names everyone it could not, and offers to deactivate them instead.
--     It is audited and it cannot lock you out.
-- ============================================================================

begin;

/* ============================================================================
   0 · Who survives
   ============================================================================
   ONE LIST, AND IT IS A KEEP LIST. Everybody not on it goes — administrators
   included. There is no "but they are an administrator" exemption any more:
   that was a safe default taken as a rule, and as a rule it made a system set
   up with three test administrators impossible to clear down.

   The invariant that replaced it is the narrow one, enforced below: AT LEAST
   ONE ADMINISTRATOR MUST SURVIVE. Locking the last one out is the single
   mistake the database cannot undo (P8-4).
   ========================================================================== */

create temporary table _keep_email (email text primary key) on commit drop;

/* ****************************************************************************
   THE ONE THING TO EDIT IN THIS FILE.

   Everybody whose address is NOT in this list is deleted. Add a line per person
   to keep; the address must be the one on their profile, and case does not
   matter.

   An address here that matches nobody STOPS the run rather than proceeding —
   because a typo would otherwise mean the person you meant to keep is not kept,
   and the file has no way to ask.
   **************************************************************************** */
insert into _keep_email (email) values
  ('harshali.linkd@gmail.com');
  -- ,('someone.else@example.com')

create temporary table _going on commit drop as
select p.id, p.full_name, p.email
  from public.profiles p
 /* -- A profile with NO address (a production worker — 0071) can never match a
       keep list, so it goes. That is correct for "delete all users except", and
       it is worth stating rather than discovering. -- */
 where lower(coalesce(p.email, '')) not in (select lower(email) from _keep_email);

/* -- What is about to go, printed before it goes. There is no blocker in this
      file — that is the point of it — so this notice is the only thing between
      a paste and an emptied roster. If these names are not test data, cancel. -- */
do $$
declare rec record; v_n int := 0; v_keep int;
begin
  /* -- EVERY KEPT ADDRESS MUST MATCH SOMEBODY.
        Without this, one mistyped character means the person meant to survive
        is in `_going` with everybody else. The administrator guard below would
        usually catch it — but only usually, and "usually" is not good enough
        for the account you sign in with. -- */
  for rec in
    select k.email from _keep_email k
     where not exists (
             select 1 from public.profiles p
              where lower(coalesce(p.email, '')) = lower(k.email))
  loop
    raise exception
      'REFUSED: "%" matches nobody on the roster, so it would not be kept. Check the address against Settings › Users.', rec.email;
  end loop;

  /* -- Counted AFTER the selection, not before it: the question is not "does
        anybody hold HR_ADMIN today" but "will anybody still hold it when this
        finishes". -- */
  select count(*) into v_keep from public.profiles p
   where exists (select 1 from public.user_roles ur
                  where ur.profile_id = p.id and ur.role in ('HR_ADMIN', 'MD'))
     and p.id not in (select id from _going);

  if v_keep = 0 then
    raise exception
      'REFUSED: nobody in the keep list holds HR_ADMIN or MD, so this would leave no way back in. Keep an administrator, or grant one first with supabase/grant-admin.sql.';
  end if;

  for rec in select full_name, email from _going order by full_name loop
    v_n := v_n + 1;
    raise notice 'DELETING ACCOUNT: % · %', rec.full_name, coalesce(rec.email, 'no address');
  end loop;
  raise notice '--- % account(s) will be destroyed, % administrator(s) will remain ---', v_n, v_keep;

  /* -- A RUN WITH NOTHING TO DELETE SAYS SO.
        Reported from a real run: the file was pasted with its list untouched,
        deleted nobody, wrote its own audit row and printed a tidy summary —
        which reads as "it worked" rather than "you have not told it who". -- */
  if v_n = 0 then
    raise exception
      'NOTHING TO DO: every account on the system is in the keep list, so there is nobody to delete.';
  end if;
end;
$$;

/* ============================================================================
   1 · The blocker that has to be answered first
   ============================================================================
   An evaluation, a production appraisal or a pay row REFUSES to let its person
   be deleted, and each of them is a record §5 and §17 exist to keep. This file
   will not quietly destroy one to get a person out of the way — clearing them
   is a separate, louder decision with its own script.
   ========================================================================== */

do $$
declare v_e bigint; v_w bigint := 0; v_p bigint;
begin
  select count(*) into v_e from public.evaluations
   where evaluatee_id in (select id from _going) or lead_id in (select id from _going);

  begin
    execute 'select count(*) from public.worker_evaluations
              where worker_id in (select id from _going)
                 or supervisor_id in (select id from _going)' into v_w;
  exception when undefined_table then v_w := 0;
  end;

  select count(*) into v_p from public.salary_history where profile_id in (select id from _going);

  if v_e > 0 or v_w > 0 or v_p > 0 then
    raise exception
      'REFUSED: % staff evaluation(s), % production appraisal(s) and % pay row(s) still belong to the people being deleted. Run RESET-CYCLES-AND-PAY-ARMED.sql first.',
      v_e, v_w, v_p;
  end if;
end;
$$;

/* ============================================================================
   2 · Every reference that would refuse the delete, cleared for these people
       and NOTHING ELSE
   ============================================================================
   Each of these is a nullable column pointing at `profiles` with no ON DELETE
   clause, so it holds the row rather than following it. Guarded per table, so
   the file still runs on a database where a later migration has not been
   applied — the same idiom the other reset scripts use.
   ========================================================================== */

-- The reporting line. An administrator who reported to somebody being deleted
-- would otherwise hold the whole delete up.
update public.profiles
   set reports_to = null
 where reports_to in (select id from _going);

do $$ begin
  update public.questions set created_by = null where created_by in (select id from _going);
exception when undefined_column or undefined_table then null; end; $$;

do $$ begin
  update public.notification_settings set paused_by = null where paused_by in (select id from _going);
exception when undefined_column or undefined_table then null; end; $$;

do $$ begin
  update public.notification_templates set updated_by = null where updated_by in (select id from _going);
exception when undefined_column or undefined_table then null; end; $$;

do $$ begin
  update public.evaluation_schedule set updated_by = null where updated_by in (select id from _going);
exception when undefined_column or undefined_table then null; end; $$;

do $$ begin
  update public.increment_settings set updated_by = null where updated_by in (select id from _going);
exception when undefined_column or undefined_table then null; end; $$;

do $$ begin
  update public.employment_records
     set joining_ctc_recorded_by = null
   where joining_ctc_recorded_by in (select id from _going);
exception when undefined_column or undefined_table then null; end; $$;

do $$ begin
  update public.notifications_log set sent_by = null where sent_by in (select id from _going);
exception when undefined_column or undefined_table then null; end; $$;

/* ============================================================================
   3 · The audit trail: the names come off, the rows stay
   ============================================================================
   §12 SAYS AUDIT ROWS ARE PERMANENT, AND THEY STAY PERMANENT. What changes is
   `actor_id`, from a person who no longer exists to null — which is precisely
   what the system actor already looks like on a scheduled transition (F11-4).

   The alternative was deleting those rows, and it is worse: it would remove the
   record that anything happened at all, on a table whose whole purpose is that
   nothing can. This keeps every row and every diff.
   ========================================================================== */

alter table public.audit_log disable trigger audit_log_no_update;

update public.audit_log
   set actor_id = null
 where actor_id in (select id from _going);

alter table public.audit_log enable trigger audit_log_no_update;

/* ============================================================================
   4 · The accounts
   ============================================================================
   `auth.users` is the root: `profiles` hangs off it with ON DELETE CASCADE
   (0001), and `user_roles`, `employment_records`, `increment_reminders`,
   `due_items` and the notification bells hang off the profile the same way.
   Deleting the login therefore takes the whole person, which is why the product
   deletes the account rather than the profile — a profile deleted on its own
   leaves a login that still works and a trigger that rebuilds a bare profile on
   the next sign-in.
   ========================================================================== */

delete from auth.users where id in (select id from _going);

/* ============================================================================
   5 · One audit row for the wipe itself
   ============================================================================
   The people are gone from the trail as actors; the fact that somebody removed
   them is not. `audit_log.entity_id` carries no foreign key (P3-2), so this row
   outlives everything it describes.
   ========================================================================== */

do $$
declare v_actor uuid; v_n int;
begin
  select count(*) into v_n from _going;
  select p.id into v_actor
    from public.profiles p
    join public.user_roles ur on ur.profile_id = p.id
   where ur.role = 'HR_ADMIN'
   order by p.created_at
   limit 1;

  insert into public.audit_log (actor_id, entity, entity_id, action, diff)
  values (v_actor, 'profile', gen_random_uuid(), 'people.reset',
          jsonb_build_object('deleted', v_n, 'via', 'RESET-PEOPLE-ARMED.sql'));
end;
$$;

/* ============================================================================
   6 · Verify before the commit
   ============================================================================ */

do $$
declare v_left bigint;
begin
  select count(*) into v_left from public.profiles p where p.id in (select id from _going);
  if v_left > 0 then
    raise exception 'REFUSED: % of the accounts did not go. Nothing has been committed.', v_left;
  end if;
end;
$$;

commit;

select
  (select count(*) from public.profiles)                                as people_left,
  (select count(*) from public.user_roles)                              as role_grants_left,
  (select count(*) from public.employment_records)                      as employment_records_left,
  (select count(*) from public.audit_log)                               as audit_rows_kept,
  (select count(*) from public.audit_log where actor_id is null)        as audit_rows_anonymised,
  '|'                                                                   as kept,
  (select count(*) from public.departments)                             as departments,
  (select count(*) from public.questions)                               as staff_questions,
  (select case tgenabled when 'O' then 'ON — append-only, correct'
                         else 'DISABLED — RE-ENABLE IT' end
     from pg_trigger
    where tgrelid = 'public.audit_log'::regclass
      and tgname = 'audit_log_no_update')                               as audit_guard;
