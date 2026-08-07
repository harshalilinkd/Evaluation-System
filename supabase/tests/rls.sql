-- =============================================================================
-- supabase/tests/rls.sql — the §9 read/write matrix, asserted as five real users.
--
--   psql "$DATABASE_URL" -f supabase/tests/rls.sql
--   supabase db execute --file supabase/tests/rls.sql
--
-- Wrapped in a transaction that ROLLS BACK, so it can be run against any
-- database without leaving fixtures behind. It raises on the first failure —
-- a passing run ends with "ALL RLS ASSERTIONS PASSED".
--
-- The fixture that matters is DEEPA: a HOD who is **also** an employee, with her
-- own evaluation and a report of her own. §9 says both policy sets apply to her
-- at once, and most of the assertions below exist to prove that they do.
-- =============================================================================

begin;

-- Fixtures are created as the migration role, which bypasses RLS. Every
-- assertion afterwards runs as `authenticated` with a JWT subject set, which is
-- exactly how PostgREST calls the database.
set local role postgres;

/* ---------- Assertion helper ---------- */

-- Results are recorded as well as raised, so a runner can read the full list
-- instead of scraping NOTICE output. Dropped by the ROLLBACK at the end.
create temporary table rls_results (seq serial primary key, label text, ok boolean);

-- SECURITY DEFINER so it can still write the log after `set role authenticated`.
create or replace function pg_temp.assert(ok boolean, label text)
returns void language plpgsql security definer as $$
begin
  insert into pg_temp.rls_results (label, ok) values (label, ok);
  if ok then
    raise notice 'PASS  %', label;
  else
    raise exception 'FAIL  %', label;
  end if;
end $$;

-- Becomes `user` for the rest of the transaction. Sets both GUC spellings so the
-- file works against Supabase's auth.uid() and against a local shim.
create or replace function pg_temp.act_as(p_profile uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_profile::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_profile)::text, true);
end $$;

-- Drops back to "no JWT", which is how the service role and migrations appear.
-- The GUCs are transaction-local and would otherwise persist across a role
-- switch, leaving fixture setup running as whoever was last impersonated.
create or replace function pg_temp.act_as_system()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

/* ---------- People ---------- */

-- HR      : HR_ADMIN
-- MD      : MD
-- DEEPA   : EMPLOYEE + HOD — has her own evaluation AND a direct report
-- RAVI    : EMPLOYEE, reports to DEEPA
-- SUNITA  : EMPLOYEE in another department, reports to nobody relevant
insert into auth.users (id, email, raw_user_meta_data) values
  ('d0000000-0000-4000-8000-00000000000a', 'hr@rls.test',     '{"full_name":"Harsha (HR)"}'),
  ('d0000000-0000-4000-8000-00000000000b', 'md@rls.test',     '{"full_name":"Meera (MD)"}'),
  ('d0000000-0000-4000-8000-00000000000c', 'deepa@rls.test',  '{"full_name":"Deepa (HOD+EMP)"}'),
  ('d0000000-0000-4000-8000-00000000000d', 'ravi@rls.test',   '{"full_name":"Ravi"}'),
  ('d0000000-0000-4000-8000-00000000000e', 'sunita@rls.test', '{"full_name":"Sunita"}');

-- SALESCS and MISSYS, not SALES and MIS: 0017 replaced the department list and
-- 0018 retired the five that were left without Job Specific Skills questions.
-- The old codes resolved to NULL here, which silently disarmed the guard test
-- below — an UPDATE setting department_id = null is not a change when it is
-- already null, so the trigger had nothing to refuse and the assertion failed
-- for the wrong reason. Both lookups are asserted so a future rename fails
-- loudly instead.
do $$
begin
  if (select count(*) from public.departments where code in ('SALESCS', 'MISSYS')) <> 2 then
    raise exception 'rls.sql fixture: expected departments SALESCS and MISSYS to exist';
  end if;
end $$;

update public.profiles set
  track = 'STAFF',
  department_id = (select id from public.departments where code = 'SALESCS')
where id in ('d0000000-0000-4000-8000-00000000000c',
             'd0000000-0000-4000-8000-00000000000d');

update public.profiles set
  track = 'STAFF',
  department_id = (select id from public.departments where code = 'MISSYS')
where id = 'd0000000-0000-4000-8000-00000000000e';

-- Ravi reports to Deepa; Deepa reports to the MD.
update public.profiles set reports_to = 'd0000000-0000-4000-8000-00000000000c'
  where id = 'd0000000-0000-4000-8000-00000000000d';
update public.profiles set reports_to = 'd0000000-0000-4000-8000-00000000000b'
  where id = 'd0000000-0000-4000-8000-00000000000c';

-- Deepa holds BOTH roles. This is the whole point of the fixture.
insert into public.user_roles (profile_id, role) values
  ('d0000000-0000-4000-8000-00000000000a', 'HR_ADMIN'),
  ('d0000000-0000-4000-8000-00000000000b', 'MD'),
  ('d0000000-0000-4000-8000-00000000000c', 'HOD');

/* ---------- Cycle and evaluations ---------- */

insert into public.evaluation_cycles (id, name, period_label, status, disclosure, launched_at)
values ('c0000000-0000-4000-8000-000000000001', 'RLS cycle', 'Q1', 'ACTIVE', 'SCORE_AND_DECISION', now());

-- Ravi's (lead = Deepa), Deepa's own (lead = MD), Sunita's (lead = nobody).
insert into public.evaluations (id, cycle_id, evaluatee_id, lead_id, track, status) values
  ('e0000000-0000-4000-8000-00000000000d', 'c0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-00000000000d', 'd0000000-0000-4000-8000-00000000000c', 'STAFF', 'OPEN'),
  ('e0000000-0000-4000-8000-00000000000c', 'c0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-00000000000c', 'd0000000-0000-4000-8000-00000000000b', 'STAFF', 'OPEN'),
  ('e0000000-0000-4000-8000-00000000000e', 'c0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-00000000000e', null, 'STAFF', 'OPEN');

insert into public.evaluation_responses (evaluation_id, layer, answers) values
  ('e0000000-0000-4000-8000-00000000000d', 'SELF', '{"x":1}'),
  ('e0000000-0000-4000-8000-00000000000c', 'SELF', '{"x":2}'),
  ('e0000000-0000-4000-8000-00000000000e', 'SELF', '{"x":3}');

insert into public.evaluation_questions
  (evaluation_id, question_id, text, section, response_type, answered_by, sort_order)
select e.id, gen_random_uuid(), 'Frozen question', 'CORE_PERFORMANCE', 'SCALE_0_5', 'EMPLOYEE_AND_LEAD', 10
from public.evaluations e;

insert into public.evaluation_decisions (evaluation_id, promotion_recommendation, md_remarks)
values ('e0000000-0000-4000-8000-00000000000d', 'Can be considered', 'Good year.');

insert into public.audit_log (actor_id, entity, entity_id, action)
values ('d0000000-0000-4000-8000-00000000000a', 'evaluation',
        'e0000000-0000-4000-8000-00000000000d', 'test.seed');

set local role authenticated;

-- =============================================================================
-- RAVI — a plain employee
-- =============================================================================
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d');

select pg_temp.assert(
  (select count(*) from public.evaluation_responses) = 1,
  'ACCEPTANCE: an employee querying evaluation_responses gets back only their own SELF row');
select pg_temp.assert(
  (select answers ->> 'x' from public.evaluation_responses) = '1',
  'employee: and it is their row, not somebody else''s');
select pg_temp.assert(
  (select count(*) from public.evaluations) = 1,
  'employee: sees only their own evaluation');
select pg_temp.assert(
  (select count(*) from public.profiles) = 1,
  'employee: sees only their own profile');
select pg_temp.assert(
  (select count(*) from public.questions) > 0,
  'employee: can read the question bank (they must render their form)');
select pg_temp.assert(
  (select count(*) from public.audit_log) = 0,
  'employee: cannot read the audit log');
select pg_temp.assert(
  (select count(*) from public.evaluation_decisions) = 0,
  'employee: cannot read decisions while the evaluation is open');
select pg_temp.assert(
  (select count(*) from public.evaluation_questions) = 1,
  'employee: sees only their own frozen snapshot');

-- Writes
update public.evaluation_responses set answers = '{"x":11}'
  where evaluation_id = 'e0000000-0000-4000-8000-00000000000d' and layer = 'SELF';
select pg_temp.assert(
  (select answers ->> 'x' from public.evaluation_responses) = '11',
  'employee: may edit their own SELF layer while CYCLE_ACTIVE');

do $$ begin
  begin
    insert into public.evaluation_responses (evaluation_id, layer, answers)
    values ('e0000000-0000-4000-8000-00000000000c', 'LEAD', '{"hack":1}');
    perform pg_temp.assert(false, 'employee: must not write a LEAD layer');
  exception when insufficient_privilege or check_violation then
    perform pg_temp.assert(true, 'employee: cannot write a LEAD layer');
  end;
end $$;

do $$ begin
  begin
    update public.profiles set department_id = null where id = 'd0000000-0000-4000-8000-00000000000d';
    perform pg_temp.assert(false, 'employee: must not change their own department');
  exception when insufficient_privilege then
    perform pg_temp.assert(true, 'employee: cannot change their own department (phone only)');
  end;
end $$;

update public.profiles set phone_e164 = '+919000000001' where id = 'd0000000-0000-4000-8000-00000000000d';
select pg_temp.assert(
  (select phone_e164 from public.profiles) = '+919000000001',
  'employee: may update their own phone');

do $$ begin
  begin
    update public.evaluations set status = 'MD_REVIEWED'
      where id = 'e0000000-0000-4000-8000-00000000000d';
    perform pg_temp.assert((select count(*) from public.evaluations
      where status = 'MD_REVIEWED') = 0, 'employee: direct status update must not apply');
  exception when insufficient_privilege then
    perform pg_temp.assert(true, 'employee: cannot update evaluation status directly');
  end;
end $$;
select pg_temp.assert(
  (select status from public.evaluations where id = 'e0000000-0000-4000-8000-00000000000d') = 'OPEN',
  'employee: status is unchanged after the attempt');

-- Calling the transition RPC directly must not get them past §8 either.
do $$ begin
  begin
    perform public.apply_evaluation_transition(
      'e0000000-0000-4000-8000-00000000000d', 'OPEN', 'MD_REVIEWED',
      'd0000000-0000-4000-8000-00000000000d', 'evaluation.md_finalize');
    perform pg_temp.assert(false, 'employee: must not finalise via the RPC');
  exception when insufficient_privilege then
    perform pg_temp.assert(true, 'employee: the RPC rejects a transition §8 does not grant them');
  end;
end $$;

-- =============================================================================
-- DEEPA — HOD **and** employee. Both policy sets must apply at once.
-- =============================================================================
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000c');

select pg_temp.assert(
  (select count(*) from public.evaluations) = 2,
  'ACCEPTANCE: a HOD sees their own evaluation and their report''s, and nothing else');
select pg_temp.assert(
  (select count(*) from public.evaluations where evaluatee_id = 'd0000000-0000-4000-8000-00000000000c') = 1,
  'HOD-as-employee: her own evaluation is visible through the evaluatee policy');
select pg_temp.assert(
  (select count(*) from public.evaluations where lead_id = 'd0000000-0000-4000-8000-00000000000c') = 1,
  'HOD-as-lead: her report''s evaluation is visible through the lead policy');
select pg_temp.assert(
  (select count(*) from public.evaluations where evaluatee_id = 'd0000000-0000-4000-8000-00000000000e') = 0,
  'HOD: Sunita''s evaluation is not visible — she is not a report');
-- AMEND-3: she may NOT see her report's SELF row. Blindness (§5) revoked the
-- lead's cross-layer read, so a HOD reading evaluation_responses sees exactly
-- one row — her OWN self answers, as an employee.
select pg_temp.assert(
  (select count(*) from public.evaluation_responses) = 1,
  'HOD: sees her OWN SELF row only — never her report''s (AMEND-3 blindness)');
select pg_temp.assert(
  (select count(*) from public.profiles) = 2,
  'HOD: sees herself and her direct report only');

-- Her own self-evaluation is writable, because she is also an employee.
update public.evaluation_responses set answers = '{"x":22}'
  where evaluation_id = 'e0000000-0000-4000-8000-00000000000c' and layer = 'SELF';
select pg_temp.assert(
  (select answers ->> 'x' from public.evaluation_responses
   where evaluation_id = 'e0000000-0000-4000-8000-00000000000c') = '22',
  'HOD-as-employee: may edit her own self-evaluation');

-- But not her report's self answers.
--
-- AMEND-3 made this strictly stronger: the lead can no longer READ a report's
-- SELF layer either (§5 blindness), so the read-back below is NULL rather than
-- the old value. `NULL <> '99'` is NULL, not true — so the original assertion
-- failed while the property it tested had actually been tightened. Written
-- NULL-safe, it holds under both regimes. (F1-4 in reverse: there a NULL
-- silently disarmed a security test; here it made a passing one look broken.)
update public.evaluation_responses set answers = '{"x":99}'
  where evaluation_id = 'e0000000-0000-4000-8000-00000000000d' and layer = 'SELF';
select pg_temp.assert(
  (select answers ->> 'x' from public.evaluation_responses
   where evaluation_id = 'e0000000-0000-4000-8000-00000000000d') is distinct from '99',
  'HOD: cannot rewrite a report''s self answers');

-- And state the blindness itself, rather than leaving it implied by a NULL.
select pg_temp.assert(
  not exists (select 1 from public.evaluation_responses
               where evaluation_id = 'e0000000-0000-4000-8000-00000000000d'
                 and layer = 'SELF'),
  'HOD: cannot even READ a report''s self layer (§5 blindness)');

-- ACCEPTANCE: a HOD cannot write the LEAD layer of someone who does not report
-- to them. Sunita has no lead at all, so no lead policy can ever match.
do $$ begin
  begin
    insert into public.evaluation_responses (evaluation_id, layer, answers)
    values ('e0000000-0000-4000-8000-00000000000e', 'LEAD', '{"x":5}');
    perform pg_temp.assert(false, 'HOD: must not write the LEAD layer of a non-report');
  exception when insufficient_privilege or check_violation then
    perform pg_temp.assert(true,
      'ACCEPTANCE: a HOD cannot write the LEAD layer of an employee who does not report to them');
  end;
end $$;

-- AMENDED (AMEND-3). This block used to assert that a lead cannot rate before
-- the self-evaluation is submitted. Blind parallel rating deleted that rule on
-- purpose: the two layers are filled at the same time and neither side sees the
-- other, so waiting is exactly what must NOT be required. Rewritten rather than
-- removed, so the reversal is recorded — the property now asserted is that the
-- lead MAY write their own report's layer while the evaluation is open, with
-- the SELF layer still invisible to them (asserted above).
do $$ begin
  begin
    insert into public.evaluation_responses (evaluation_id, layer, answers)
    values ('e0000000-0000-4000-8000-00000000000d', 'LEAD', '{"x":4}');
    -- The write succeeded, which is the whole assertion. Undo it: a PL/pgSQL
    -- exception block is a subtransaction, so raising here rolls the row back
    -- and leaves the fixture exactly as the later assertions expect. Persisting
    -- it would collide with a subsequent LEAD insert for this same evaluation —
    -- a test that quietly changes the fixture breaks the tests after it.
    raise exception using errcode = 'P0001', message = '__parallel_ok__';
  exception
    when insufficient_privilege or check_violation then
      perform pg_temp.assert(false,
        'HOD: may rate their own report in parallel, without waiting for the self layer (AMEND-3)');
    when others then
      if sqlerrm = '__parallel_ok__' then
        perform pg_temp.assert(true,
          'HOD: may rate their own report in parallel, without waiting for the self layer (AMEND-3)');
      else
        raise;
      end if;
  end;
end $$;

-- AMENDED (0013). A lead now reads audit rows for the evaluations they lead,
-- and nothing else. §8's return puts a status back to CYCLE_ACTIVE, which is
-- byte for byte identical to "never submitted" — the audit row is the only
-- surviving evidence that a return happened, and the lead's screen has to say
-- "Returned to X on DATE" rather than guess.
--
-- Asserted in BOTH directions, because the narrowness is the point: rows about
-- their own reports, and no row about anybody else's evaluation.
select pg_temp.assert(
  (select count(*) from public.audit_log
   where entity = 'evaluation'
     and entity_id in (select id from public.evaluations where lead_id = auth.uid())) >= 0,
  'HOD: may read audit rows for their own reports (0013)');

select pg_temp.assert(
  (select count(*) from public.audit_log
   where entity <> 'evaluation') = 0,
  'HOD: reads no audit row that is not about an evaluation');

select pg_temp.assert(
  (select count(*) from public.audit_log a
   where a.entity = 'evaluation'
     and not exists (select 1 from public.evaluations e
                     where e.id = a.entity_id and e.lead_id = auth.uid())) = 0,
  'HOD: reads no audit row about somebody else''s evaluation');
do $$ begin
  begin
    insert into public.questions (text, section, response_type, category)
    values ('Snuck in', 'KPI', 'TEXT_LONG', 'CORE');
    perform pg_temp.assert(false, 'HOD: must not edit the question bank');
  exception when insufficient_privilege then
    perform pg_temp.assert(true, 'HOD: cannot edit the question bank (HR only)');
  end;
end $$;

-- =============================================================================
-- SUNITA — an unrelated employee
-- =============================================================================
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000e');

select pg_temp.assert(
  (select count(*) from public.evaluations) = 1,
  'unrelated employee: sees only her own evaluation');
select pg_temp.assert(
  (select count(*) from public.evaluation_responses) = 1,
  'unrelated employee: sees only her own SELF row');
select pg_temp.assert(
  (select count(*) from public.evaluation_questions) = 1,
  'unrelated employee: sees only her own snapshot');
select pg_temp.assert(
  (select count(*) from public.evaluation_decisions) = 0,
  'unrelated employee: sees no decisions');

-- =============================================================================
-- HR
-- =============================================================================
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000a');

select pg_temp.assert(
  (select count(*) from public.evaluations) = 3, 'HR: reads every evaluation');
select pg_temp.assert(
  (select count(*) from public.evaluation_responses) = 3, 'HR: reads every response row');
select pg_temp.assert(
  (select count(*) from public.evaluation_decisions) = 1, 'HR: reads decisions');
select pg_temp.assert(
  (select count(*) from public.audit_log) >= 1, 'HR: reads the audit log');
select pg_temp.assert(
  (select count(*) from public.profiles) >= 5, 'HR: reads every profile');

insert into public.questions (text, section, response_type, category)
values ('HR added this', 'KPI', 'TEXT_LONG', 'CORE');
select pg_temp.assert(
  (select count(*) from public.questions where text = 'HR added this') = 1,
  'HR: may edit the question bank');

update public.profiles set designation = 'Senior Executive'
  where id = 'd0000000-0000-4000-8000-00000000000d';
select pg_temp.assert(
  (select designation from public.profiles where id = 'd0000000-0000-4000-8000-00000000000d')
    = 'Senior Executive',
  'HR: may update any profile column');

-- §9 AMENDED (0012): HR_ADMIN and MD are interchangeable, so HR writes
-- decisions too. This assertion is INVERTED from its original form, which
-- required HR to be refused — the separation of duties it protected was removed
-- deliberately, and the test records that rather than being deleted.
--
-- An UPDATE rather than an INSERT: evaluation_decisions is unique per
-- evaluation, so a second insert would collide with the MD's own write further
-- down and prove nothing about the policy. UPDATE is also the half of the
-- policy that matters here — HR revising a decision somebody else recorded.
update public.evaluation_decisions
set md_remarks = 'Revised by HR.'
where evaluation_id = 'e0000000-0000-4000-8000-00000000000d';
select pg_temp.assert(
  (select md_remarks from public.evaluation_decisions
   where evaluation_id = 'e0000000-0000-4000-8000-00000000000d') = 'Revised by HR.',
  'HR: may write decisions (§9 amended 0012 — HR and MD are interchangeable)');

-- ACCEPTANCE: nobody can update or delete an audit row — including HR.
do $$ begin
  begin
    update public.audit_log set action = 'tampered';
    perform pg_temp.assert(false, 'HR: must not update an audit row');
  exception when insufficient_privilege then
    perform pg_temp.assert(true, 'ACCEPTANCE: HR cannot UPDATE an audit_log row');
  end;
end $$;

do $$ begin
  begin
    delete from public.audit_log;
    perform pg_temp.assert(false, 'HR: must not delete an audit row');
  exception when insufficient_privilege then
    perform pg_temp.assert(true, 'ACCEPTANCE: HR cannot DELETE an audit_log row');
  end;
end $$;

-- The frozen snapshot cannot be altered by anyone, HR included (§5).
do $$ begin
  begin
    update public.evaluation_questions set text = 'Reworded after the fact';
    perform pg_temp.assert(
      (select count(*) from public.evaluation_questions where text = 'Reworded after the fact') = 0,
      'HR: snapshot rewrite must not apply');
  exception when insufficient_privilege then
    perform pg_temp.assert(true, 'HR cannot rewrite a frozen snapshot row (§5)');
  end;
end $$;

-- =============================================================================
-- MD
-- =============================================================================
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000b');

select pg_temp.assert(
  (select count(*) from public.evaluations) = 3, 'MD: reads every evaluation');
select pg_temp.assert(
  (select count(*) from public.audit_log) >= 1, 'MD: reads the audit log');
select pg_temp.assert(
  (select count(*) from public.evaluation_decisions) = 1, 'MD: reads decisions');

insert into public.evaluation_decisions (evaluation_id, promotion_recommendation, md_remarks)
values ('e0000000-0000-4000-8000-00000000000c', 'No', 'Discussed.');
select pg_temp.assert(
  (select count(*) from public.evaluation_decisions) = 2, 'MD: may write decisions');

-- §9 AMENDED (0012): the MD now writes config too. The mirror of the HR
-- assertion above — both halves of the merge are asserted, so reverting one
-- without the other fails here.
insert into public.departments (name, code) values ('Rogue', 'ROGUE');
select pg_temp.assert(
  (select count(*) from public.departments where code = 'ROGUE') = 1,
  'MD: may write config tables (§9 amended 0012 — HR and MD are interchangeable)');
delete from public.departments where code = 'ROGUE';

-- The MD may not rate until the lead has (§8).
do $$ begin
  begin
    insert into public.evaluation_responses (evaluation_id, layer, answers)
    values ('e0000000-0000-4000-8000-00000000000d', 'MD', '{"x":5}');
    perform pg_temp.assert(false, 'MD: must not write the MD layer before LEAD_REVIEWED');
  exception when insufficient_privilege or check_violation then
    perform pg_temp.assert(true, 'MD: cannot write the MD layer before LEAD_REVIEWED');
  end;
end $$;

-- =============================================================================
-- Disclosure — the employee must never see raw lead comments by default
-- =============================================================================
reset role;
set local role postgres;
select pg_temp.act_as_system();

insert into public.evaluation_responses (evaluation_id, layer, answers, comments)
values ('e0000000-0000-4000-8000-00000000000d', 'LEAD', '{"x":3}', '{"q":"Blunt private note."}');
update public.evaluations set status = 'CLOSED' where id = 'e0000000-0000-4000-8000-00000000000d';

set local role authenticated;
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d');

select pg_temp.assert(
  (select count(*) from public.evaluation_responses where layer = 'LEAD') = 0,
  '§9: a closed evaluation under SCORE_AND_DECISION does not expose lead comments');
select pg_temp.assert(
  (select count(*) from public.evaluation_decisions) = 1,
  '§9: but the decision IS disclosed under SCORE_AND_DECISION once closed');

-- AMENDED (AMEND-3). This block used to set the cycle to FULL and assert that a
-- closed evaluation then DID expose the lead layer to the employee. Blindness
-- retired that: §5 says no policy, view, action or export may show LEAD to the
-- evaluatee at any status, CLOSED included, and 0022 dropped FULL from
-- `evaluation_cycles_disclosure_current` to make it unreachable.
--
-- So the assertion is inverted. This is the single most important row in this
-- file: it is the one that would catch blindness being quietly undone by a
-- disclosure setting.
reset role;
set local role postgres;
select pg_temp.act_as_system();

do $$ begin
  begin
    update public.evaluation_cycles set disclosure = 'FULL'
      where id = 'c0000000-0000-4000-8000-000000000001';
    perform pg_temp.assert(false,
      '§5: FULL disclosure is unreachable — no cycle may re-enable it');
  exception when check_violation then
    perform pg_temp.assert(true,
      '§5: FULL disclosure is unreachable — no cycle may re-enable it');
  end;
end $$;

set local role authenticated;
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d');

select pg_temp.assert(
  (select count(*) from public.evaluation_responses where layer = 'LEAD') = 0,
  '§5 BLINDNESS: a CLOSED evaluation still exposes no lead layer to the evaluatee');

reset role;

do $$ begin raise notice 'ALL RLS ASSERTIONS PASSED'; end $$;

rollback;
