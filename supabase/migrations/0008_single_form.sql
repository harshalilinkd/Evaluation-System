-- =============================================================================
-- 0008_single_form.sql — Align the question bank with the single-form model.
-- Phase P8-PATCH. CLAUDE.md §1, §5 (module boundary), §7.
-- =============================================================================
--
-- §1, as amended: "every staff employee fills the SAME form. One section of it
-- — Job Specific Skills — carries questions mapped to that person's department;
-- every other section is identical company-wide."
--
-- Two things this migration deliberately does NOT do:
--
--   • It does not rename or drop the `DEPARTMENT_SPECIFIC` enum value. That is
--     the stored value, it appears in `questions.section` and in every frozen
--     `evaluation_questions` row, and §0.2 fixes enum values once created. Only
--     the *display* label changes, in lib/forms/labels.ts. Renaming the enum
--     would rewrite history in every launched evaluation.
--
--   • It does not delete a single question row. Worker questions are retired
--     with is_active = false, because historic responses key off question_id
--     and a delete would orphan them (§17).
--
-- P7 was a UI phase and produced no migration, so the numbering here tracks the
-- sequence of migrations, not of phases. This is the eighth.
-- =============================================================================


/* ---------- 1. Retire the worker questions from the core bank ---------- */
--
-- §5's module boundary: "The core evaluation tables are STAFF only ... WORKER
-- data lives exclusively in the worker_ tables."
--
-- These ten rows came from the Worker Performance Appraisal in P2, before the
-- module split. They are retired rather than deleted: any evaluation already
-- launched against them keeps its frozen snapshot, and their ids remain
-- resolvable for historic answers. The worker module will seed its own
-- equivalents in worker_ tables — these are not moved, they are stood down.

-- Record what they were before the track is overwritten, so the audit trail
-- keeps the fact that these were WORKER questions (§12).
insert into public.audit_log (actor_id, entity, entity_id, action, diff)
select
  null,
  'question',
  q.id,
  'question.retired_to_worker_module',
  jsonb_build_object(
    'before', jsonb_build_object('track', q.track::text, 'is_active', q.is_active),
    'after',  jsonb_build_object('track', 'STAFF', 'is_active', false)
  )
from public.questions q
where q.track = 'WORKER';

update public.questions
set is_active = false
where track = 'WORKER';


/* ---------- 2. Every core question is STAFF ---------- */
--
-- Including the rows just retired: the acceptance for this phase is that no
-- core question carries track WORKER at all. What they used to be is preserved
-- in the audit rows written above, which is the right place for history.

update public.questions
set track = 'STAFF'
where track <> 'STAFF';

alter table public.questions
  add constraint questions_core_track_staff
  check (track in ('STAFF', 'BOTH'));

comment on constraint questions_core_track_staff on public.questions is
  'Core bank is STAFF only (§5 module boundary). WORKER questions live in worker_ tables.';


/* ---------- 3. Department questions are Job Specific Skills ---------- */
--
-- One section carries the department-specific questions, and both the employee
-- and their lead answer them — that is what produces a variance to flag (§11).
-- Anything mis-filed is corrected rather than left as a special case for the
-- renderer to cope with.

update public.questions
set section = 'DEPARTMENT_SPECIFIC'
where category = 'DEPARTMENT'
  and section <> 'DEPARTMENT_SPECIFIC';

update public.questions
set answered_by = 'EMPLOYEE_AND_LEAD'
where category = 'DEPARTMENT'
  and answered_by <> 'EMPLOYEE_AND_LEAD';


/* ---------- 4. Every department has Job Specific Skills questions ---------- */
--
-- Only fills departments that have none, so re-running changes nothing and a
-- department HR has already curated is never overwritten. Sets are the P2 ones.
--
-- Deterministic ids from a stable seed key, as in supabase/seed.sql: `questions`
-- has no natural unique column, so this is what makes the insert idempotent.

with wanted(department_code, key, text, sort_order) as (
  values
    ('MIS',      'dept.mis.report_accuracy',      'Report accuracy and timeliness',                   10),
    ('MIS',      'dept.mis.system_uptime',        'System uptime and issue turnaround',               20),
    ('MIS',      'dept.mis.data_integrity',       'Data integrity and documentation completeness',    30),
    ('SALES',    'dept.sales.revenue_target',     'Quarterly revenue target achievement',             10),
    ('SALES',    'dept.sales.conversion',         'Enquiry to order conversion',                      20),
    ('SALES',    'dept.sales.followup',           'Customer follow-up discipline',                    30),
    ('OPS',      'dept.ops.turnaround',           'Process turnaround time',                          10),
    ('OPS',      'dept.ops.cost_efficiency',      'Cost efficiency of workflows',                     20),
    ('OPS',      'dept.ops.coordination',         'Coordination with production and dispatch',        30),
    ('DESIGNS',  'dept.designs.turnaround',       'Design turnaround and revision handling',          10),
    ('DESIGNS',  'dept.designs.print_approval',   'Print approval accuracy',                          20),
    ('DESIGNS',  'dept.designs.creativity',       'Creativity and originality of output',             30),
    ('ACCOUNTS', 'dept.accounts.filings',         'Accuracy in statutory filings and reconciliations', 10),
    ('ACCOUNTS', 'dept.accounts.audit_readiness', 'Audit readiness and documentation',                20),
    ('ACCOUNTS', 'dept.accounts.payment_cycle',   'Payment cycle and vendor reconciliation',          30)
),
-- Departments that currently have no Job Specific Skills question at all.
bare as (
  select d.id, d.code
  from public.departments d
  where not exists (
    select 1
    from public.department_questions dq
    join public.questions q on q.id = dq.question_id
    where dq.department_id = d.id
      and q.category = 'DEPARTMENT'
      and q.is_active
  )
),
inserted as (
  insert into public.questions (
    id, text, section, response_type, category, track, answered_by,
    is_required, is_active, sort_order
  )
  select
    md5('appraise.question.' || w.key)::uuid,
    w.text,
    'DEPARTMENT_SPECIFIC',
    'SCALE_0_5',
    'DEPARTMENT',
    'STAFF',
    'EMPLOYEE_AND_LEAD',
    true,
    true,
    w.sort_order
  from wanted w
  join bare b on b.code = w.department_code
  on conflict (id) do update set
    section     = excluded.section,
    category    = excluded.category,
    track       = excluded.track,
    answered_by = excluded.answered_by,
    is_active   = true
  returning id
)
insert into public.department_questions (department_id, question_id, sort_order)
select b.id, md5('appraise.question.' || w.key)::uuid, w.sort_order
from wanted w
join bare b on b.code = w.department_code
on conflict (department_id, question_id) do nothing;


/* ---------- 5. Sanity ---------- */
--
-- Fail the migration rather than leave the bank in a state the renderer cannot
-- make sense of. A silent half-migration here shows up much later as an empty
-- Job Specific Skills section on somebody's appraisal.

do $$
declare
  v_worker  integer;
  v_bare    integer;
  v_misfiled integer;
begin
  select count(*) into v_worker from public.questions where track = 'WORKER';
  if v_worker > 0 then
    raise exception 'Migration incomplete: % core questions still carry track WORKER.', v_worker;
  end if;

  select count(*) into v_misfiled
  from public.questions
  where category = 'DEPARTMENT'
    and (section <> 'DEPARTMENT_SPECIFIC' or answered_by <> 'EMPLOYEE_AND_LEAD');
  if v_misfiled > 0 then
    raise exception 'Migration incomplete: % department questions are mis-filed.', v_misfiled;
  end if;

  select count(*) into v_bare
  from public.departments d
  where d.is_active
    and not exists (
      select 1 from public.department_questions dq
      join public.questions q on q.id = dq.question_id
      where dq.department_id = d.id and q.category = 'DEPARTMENT' and q.is_active
    );
  if v_bare > 0 then
    raise exception 'Migration incomplete: % active departments have no Job Specific Skills question.', v_bare;
  end if;
end $$;
