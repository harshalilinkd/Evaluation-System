-- 0018_retire_old_departments.sql
-- Retires the five pre-textile departments that 0017 orphaned.
--
-- WHY
--
-- 0017 replaced the company-secretarial question bank with the textile one and
-- created ten departments to carry it: DESIGN, MDO, FUSING, KATA, STORES,
-- DISPATCH, SALESCS, MISSYS, ACCTS, HRADMIN.
--
-- It did not touch the five that came from P1's seed — MIS, SALES, OPS, DESIGNS,
-- ACCOUNTS — because §0.2 freezes a name once created and evaluations may be
-- filed against them. Correct as far as it went, but it leaves the product with
-- fifteen departments, five of which have **zero Job Specific Skills questions**.
--
-- That is not cosmetic. P9-7: a department with no Job Specific Skills questions
-- cannot be launched — every employee in it would receive an empty section. So
-- HR is shown a picker containing five choices that quietly cannot be used, two
-- of which ("Sales", "MIS") read as near-duplicates of the real ones ("Sales &
-- Customer Service", "MIS & Systems"). Assigning a new joiner to the wrong one
-- is a mistake the interface currently invites.
--
-- WHY DEACTIVATE RATHER THAN DELETE
--
-- §17 forbids deleting what history references, and `departments` is pointed at
-- by `profiles.department_id`, `evaluations.department_id` and
-- `department_questions`. Deleting would either cascade or fail. `is_active` is
-- the column that exists for precisely this — the same treatment P4-5 gives a
-- person who has left: deactivated, never erased.
--
-- Anything already filed against MIS or Sales keeps pointing at a row that is
-- still there and still named what it was named.
--
-- SAFE TO RE-RUN, and safe on a database where they were never created.

begin;

/* ---------- Retire, and record what was done ---------- */
--
-- Audited before the update, so the audit row carries the state that is about to
-- change rather than the state after it (§12: a diff of before/after).

insert into public.audit_log (actor_id, entity, entity_id, action, diff)
select
  null,                              -- a migration has no session; §12 keeps the slot
  'department',
  d.id,
  'department.retired_pre_textile',
  jsonb_build_object(
    'from', jsonb_build_object('code', d.code, 'name', d.name, 'is_active', d.is_active),
    'to',   jsonb_build_object('code', d.code, 'name', d.name, 'is_active', false),
    'reason', '0017 replaced the question bank; this department has no Job Specific Skills questions'
  )
from public.departments d
where d.code in ('MIS', 'SALES', 'OPS', 'DESIGNS', 'ACCOUNTS')
  and d.is_active                    -- idempotent: a second run audits nothing
  and not exists (
    -- Belt and braces. If somebody has curated Job Specific Skills questions onto
    -- one of these since, it is in use and must not be retired underneath them.
    select 1
      from public.department_questions dq
      join public.questions q on q.id = dq.question_id
     where dq.department_id = d.id
       and q.is_active
       and q.section = 'DEPARTMENT_SPECIFIC'
  );

update public.departments d
   set is_active = false
 where d.code in ('MIS', 'SALES', 'OPS', 'DESIGNS', 'ACCOUNTS')
   and d.is_active
   and not exists (
     select 1
       from public.department_questions dq
       join public.questions q on q.id = dq.question_id
      where dq.department_id = d.id
        and q.is_active
        and q.section = 'DEPARTMENT_SPECIFIC'
   );

/* ---------- Say so if anybody is still assigned to one ---------- */
--
-- Not an error: a real person may genuinely sit in "Operations" until HR moves
-- them. But it must not pass silently, because their next cycle cannot launch
-- (§0.7 — fail loudly). The notice names them so HR knows who to reassign.

do $$
declare
  stranded int;
  names    text;
begin
  select count(*), string_agg(p.full_name || ' (' || d.code || ')', ', ')
    into stranded, names
    from public.profiles p
    join public.departments d on d.id = p.department_id
   where p.is_active
     and not d.is_active;

  if stranded > 0 then
    raise notice
      '0018: % active % still assigned to a retired department and cannot be launched until reassigned: %',
      stranded,
      case when stranded = 1 then 'person is' else 'people are' end,
      names;
  end if;
end $$;

commit;
