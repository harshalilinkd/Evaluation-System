-- 0019_departments_reconcile.sql
-- Reconciles the department list to the eleven LinkD Prints actually runs.
--
-- RENAMES ARE EXPLICITLY INSTRUCTED. §0.2 freezes a name once created, and this
-- migration changes eight of them. The owner gave the list directly and chose
-- "match my list exactly", which is the explicit instruction §0.2 requires. It
-- is recorded here and in §18 rather than absorbed silently.
--
-- WHAT WENT WRONG, so the shape of this file makes sense
--
-- P1 seeded five departments — MIS, SALES, OPS, DESIGNS, ACCOUNTS — from a brief
-- that predated knowing the business. 0017 introduced the real textile ones and
-- correctly left those five alone, because §0.2 freezes a name. Nobody looked at
-- the sum: fifteen departments, five of them empty shells, and two pairs that
-- read as near-homographs in a picker — "Sales" beside "Sales & Customer
-- Service", "MIS" beside "MIS & Systems". Assigning a new joiner to the wrong
-- one was a mistake the interface invited.
--
-- Supersedes 0018_retire_old_departments.sql, which retired the five but left
-- the longer names in place. 0018 is idempotent and harmless if already applied;
-- if it has not been, this file does its job as well.
--
-- WHY MAPPINGS NEED NO WORK
--
-- `department_questions` joins on department_id, so a rename carries every Job
-- Specific Skills question with it automatically — it is the same row. Retiring
-- likewise keeps its mappings dormant rather than dropping them, so reactivating
-- a department restores its full question set intact. Nothing here touches
-- `department_questions` at all, which is the point.
--
-- SAFE TO RE-RUN.

begin;

/* ---------- 1. Free the two names the live departments need ---------- */
--
-- `departments.name` is UNIQUE. "MIS" and "Sales" are held by the two empty
-- shells, and the working departments cannot take those names while they do.
--
-- The suffix is a rename nobody asked for, and it is the only one in this file
-- that is not from the owner's list. It is forced by the unique constraint, and
-- the alternative — deleting the shells — is refused by §17, since `profiles`
-- and `evaluations` may point at them. A retired row that says what it is beats
-- a deleted row that used to.

update public.departments set name = 'MIS (retired)'
 where code = 'MIS' and name = 'MIS';

update public.departments set name = 'Sales (retired)'
 where code = 'SALES' and name = 'Sales';

/* ---------- 2. Retire the seven that are not run ---------- */
--
-- is_active = false, never deleted — the same treatment P4-5 gives a person who
-- has left. Anything already filed against one keeps pointing at a row that is
-- still there.

update public.departments
   set is_active = false
 where code in (
   'ACCOUNTS',   -- empty P1 shell
   'ACCTS',      -- Accounts & Compliance — not run as its own department
   'DESIGNS',    -- empty P1 shell, duplicate of DESIGN
   'DISPATCH',   -- Dispatch & Packing — not run as its own department
   'MIS',        -- empty P1 shell, duplicate of MISSYS
   'SALES',      -- empty P1 shell, duplicate of SALESCS
   'STORES'      -- Stores & Fabric Inward — not run as its own department
 )
   and is_active;

/* ---------- 3. Rename the eight that are ---------- */
--
-- Each keeps its `code`, which is the stable handle every join and import uses
-- (P1's seed note). Only the display name moves, so no mapping, evaluation or
-- frozen snapshot is affected.

update public.departments set name = 'Printing'   where code = 'MDO'     and name <> 'Printing';
update public.departments set name = 'KATA'       where code = 'KATA'    and name <> 'KATA';
update public.departments set name = 'Fusing'     where code = 'FUSING'  and name <> 'Fusing';
update public.departments set name = 'HR'         where code = 'HRADMIN' and name <> 'HR';
update public.departments set name = 'MIS'        where code = 'MISSYS'  and name <> 'MIS';
update public.departments set name = 'Sales'      where code = 'SALESCS' and name <> 'Sales';
-- DESIGN is already called "Design" and OPS already "Operations"; both are named
-- here anyway so the file states the whole intended list in one place.
update public.departments set name = 'Design'     where code = 'DESIGN'  and name <> 'Design';
update public.departments set name = 'Operations' where code = 'OPS'     and name <> 'Operations';

/* ---------- 4. Create whatever the list needs and the database lacks ---------- */
--
-- The renames above only fire on a database that already carries the row. Two of
-- the eleven do not exist on a database built from scratch:
--
--   Operations — P1 seeded it, but FIX-1 stopped seed.sql creating the five
--                original departments, so a fresh `supabase db reset` has no OPS
--                row for the rename to find.
--   Rolling, Calendar — separate shop-floor processes at LinkD Prints that have
--                never appeared in any earlier list.
--
-- Inserting them here rather than in the seed is what makes this migration
-- produce the same eleven departments on a fresh database and on the live one.
-- `on conflict (code) do nothing` is what makes it idempotent: where the row
-- already exists, section 3 has already given it the right name.

insert into public.departments (name, code, description, is_active) values
  ('Operations', 'OPS',      'Production planning and delivery', true),
  ('Rolling',    'ROLLING',  'Rolling and winding',              true),
  ('Calendar',   'CALENDAR', 'Calendering — heat and finish',    true)
on conflict (code) do nothing;

-- OPS stays ACTIVE at the owner's instruction even though it carries no Job
-- Specific Skills questions — including where 0018 had already retired it. Per
-- P9-7 it cannot be launched until it does, and the departments screen and the
-- form builder both flag exactly that.
update public.departments set is_active = true where code = 'OPS' and not is_active;

/* ---------- 5. Say who is stranded ---------- */
--
-- Not an error: somebody may genuinely still sit in a retired department until
-- HR moves them. But it must not pass silently — their next cycle cannot launch
-- (§0.7, fail loudly). The notice names them so HR knows who to reassign.

do $$
declare
  stranded int;
  names    text;
begin
  select count(*), string_agg(p.full_name || ' (' || d.name || ')', ', ')
    into stranded, names
    from public.profiles p
    join public.departments d on d.id = p.department_id
   where p.is_active and not d.is_active;

  if stranded > 0 then
    raise notice
      '0019: % active % still assigned to a retired department and cannot be launched until reassigned: %',
      stranded, case when stranded = 1 then 'person is' else 'people are' end, names;
  end if;

  select count(*), string_agg(d.name, ', ' order by d.name)
    into stranded, names
    from public.departments d
   where d.is_active
     and not exists (
       select 1 from public.department_questions dq
         join public.questions q on q.id = dq.question_id
        where dq.department_id = d.id and q.is_active
          and q.section = 'DEPARTMENT_SPECIFIC');

  if stranded > 0 then
    raise notice
      '0019: % active % no Job Specific Skills questions and cannot be launched yet: %',
      stranded, case when stranded = 1 then 'department has' else 'departments have' end, names;
  end if;
end $$;

commit;
