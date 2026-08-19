-- RESET-PEOPLE.sql
--
-- READ-ONLY. Tells you what a people wipe would do and then refuses to do it.
-- The armed twin is RESET-PEOPLE-ARMED.sql.
--
-- Use this when the answer to "I want to clear the roster and re-import" needs
-- checking before it is acted on — because on a real database that sentence has
-- three answers, and two of them are cheaper than this one.
--
-- ============================================================================
-- READ THIS BEFORE THE ARMED VERSION. YOU MAY NOT NEED IT.
--
-- 1 · RE-IMPORTING DOES NOT NEED ANYBODY DELETED.
--     Since FIX-24 the employee import UPDATES somebody it already knows, matched
--     on email. Re-uploading your spreadsheet corrects names, codes, departments,
--     designations, reporting lines, joining dates and access levels in place.
--     Nobody has to be removed for that.
--
-- 2 · IF WHAT YOU ARE AFTER IS THE PAY FIGURES, THAT IS A DIFFERENT FIX.
--     RESET-CYCLES-AND-PAY-ARMED.sql emptied `salary_history` and the salary
--     columns on the employment record — deliberately, and it kept everything
--     else. The import then refuses to write salary onto somebody who already
--     exists (F24-11), because a re-upload must never overwrite a pay ledger.
--     It now makes an exception for a ledger that is EMPTY: with no pay history
--     and no current figure on record, a re-import fills them in. So after that
--     reset, re-uploading the same file restores the salaries — no deletion.
--
-- 3 · DELETING PEOPLE ALSO DELETES THEIR LOGINS AND THEIR ROLES.
--     Everybody has to be sent a new invite and every access level re-granted.
--     Joining dates and increment schedules go with them.
--
-- If none of that covers it, the armed file is there. It is the most
-- destructive script in this folder.
-- ============================================================================

/* ============================================================================
   0 · Who would be kept
   ============================================================================
   THE SAME KEEP LIST THE ARMED FILE USES, and it has to stay the same or this
   report describes a run nobody is going to make. Everybody not on it goes —
   administrators included. Edit both files together, or edit neither.
   ========================================================================== */

create temporary table _keep_email (email text primary key) on commit drop;

insert into _keep_email (email) values
  ('harshali.linkd@gmail.com');
  -- ,('someone.else@example.com')

create or replace function pg_temp.count_or_absent(p_table text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from public.%I', p_table) into n;
  return n;
exception when undefined_table then return null;
end;
$$;

select
  p.full_name,
  p.email,
  p.employee_code,
  case when lower(coalesce(p.email, '')) in (select lower(email) from _keep_email)
       then 'KEPT — in the keep list'
       else 'WOULD BE DELETED' end                                as outcome,
  coalesce((select string_agg(r.role::text, ' · ' order by r.role)
              from public.user_roles r where r.profile_id = p.id), '—') as access,
  (select count(*) from public.audit_log a where a.actor_id = p.id) as audit_rows,
  (select count(*) from public.profiles q where q.reports_to = p.id) as people_reporting
from public.profiles p
order by outcome, p.full_name;

/* ============================================================================
   1 · What would still be in the way
   ============================================================================
   These tables reference `profiles` with no ON DELETE clause, so every one of
   them refuses the delete rather than following it. The armed file clears each
   of them for the people going, and NOTHING ELSE.
   ========================================================================== */

select
  (select count(*) from public.evaluations)                     as staff_evaluations,
  pg_temp.count_or_absent('worker_evaluations')                 as worker_appraisals,
  (select count(*) from public.salary_history)                  as pay_rows,
  (select count(*) from public.audit_log)                       as audit_rows,
  (select count(*) from public.profiles where reports_to is not null) as reporting_lines;

/* ============================================================================
   2 · The verdict
   ============================================================================
   A RESULT SET, NOT AN EXCEPTION.

   This ended in `raise exception` so that nothing could possibly be changed by
   running it — which was true and useless: the Supabase editor returns only the
   LAST result, so raising threw away both tables above it and left a red error
   box as the whole report. A file that reads and never writes needs no
   exception to be safe; it needs to be readable.
   ========================================================================== */

with counted as (
  select
    (select count(*) from public.evaluations)          as evaluations,
    coalesce(pg_temp.count_or_absent('worker_evaluations'), 0) as appraisals,
    (select count(*) from public.salary_history)       as pay_rows,
    (select count(*) from public.profiles)             as people,
    (select count(*) from public.profiles p
      where lower(coalesce(p.email, '')) in (select lower(email) from _keep_email)) as surviving,
    /* -- Administrators AMONG THE SURVIVORS, which is the number that decides
          whether the armed file will run at all. -- */
    (select count(*) from public.profiles p
      where lower(coalesce(p.email, '')) in (select lower(email) from _keep_email)
        and exists (select 1 from public.user_roles ur
                     where ur.profile_id = p.id
                       and ur.role in ('HR_ADMIN', 'MD')))     as administrators
)
select
  'REPORT ONLY — nothing was changed by this file'                       as this_file,
  case
    when c.evaluations > 0 or c.appraisals > 0 or c.pay_rows > 0
      then 'BLOCKED — appraisal or pay data still belongs to these people. Run RESET-CYCLES-AND-PAY-ARMED.sql first.'
    when c.surviving = 0
      then 'BLOCKED — the keep list matches nobody. Check the address against the roster above.'
    when c.administrators = 0
      then 'BLOCKED — nobody in the keep list holds HR_ADMIN or MD, so a wipe would leave no way back in. Run supabase/grant-admin.sql first.'
    else 'READY — RESET-PEOPLE-ARMED.sql would delete ' || (c.people - c.surviving)::text
         || ' account(s) and keep ' || c.surviving::text || '.'
  end                                                                    as verdict,
  c.people,
  c.surviving                                                            as kept,
  c.administrators                                                       as kept_administrators,
  c.evaluations                                                          as blocking_evaluations,
  c.appraisals                                                           as blocking_appraisals,
  c.pay_rows                                                             as blocking_pay_rows
from counted c;
