-- whats-applied.sql
-- Paste into the Supabase SQL editor and Run. Reads only — changes nothing.
--
-- Three separate bugs this month had "that migration was never applied" as
-- their real cause, and there was no quick way to tell. This answers it.
--
-- Returns TWO result sets. Read the first one first.

/* ============================================================================
   1. WHICH STATE MACHINE IS THIS DATABASE ON?
   ========================================================================== */
--
-- The single most useful line. AMEND-3 (migrations 0020 and 0021) replaced the
-- sequential flow with blind parallel rating and migrated every row:
--
--   BEFORE 0020/0021:  DRAFT · CYCLE_ACTIVE · SELF_SUBMITTED · LEAD_REVIEWED · MD_FINALIZED · CLOSED
--   AFTER:             DRAFT · OPEN · PENDING_HR_REVIEW · HR_APPROVED · MD_REVIEWED · INTERVIEW_DONE · CLOSED
--
-- If you see CYCLE_ACTIVE or SELF_SUBMITTED below, the database is still on the
-- OLD machine while the application is written for the new one. That mismatch
-- is what produces, all at once:
--   · the employee's form saving normally
--   · the HOD's refused with "This evaluation is not ready for a lead review."
--   · "new row violates row-level security policy for table audit_log" on submit
-- Applying 0020 then 0021 is the fix, and it must happen BEFORE 0033.

select
  status::text                                        as evaluation_status,
  count(*)                                            as rows,
  case
    when status::text in ('CYCLE_ACTIVE','SELF_SUBMITTED','LEAD_REVIEWED','MD_FINALIZED')
      then 'OLD — apply 0020 and 0021'
    when status::text in ('OPEN','PENDING_HR_REVIEW','HR_APPROVED','MD_REVIEWED','INTERVIEW_DONE')
      then 'current'
    else 'either'
  end                                                 as machine
from public.evaluations
group by status
order by rows desc;

/* ============================================================================
   2. WHICH MIGRATIONS ARE IN?
   ========================================================================== */
--
-- One object each migration is known to create. Apply anything marked false,
-- in ascending order — several check their own prerequisites and will say so
-- rather than half-applying.

with expected(migration, kind, object_name, why_it_matters) as (values
  ('0020_blind_rating_enum',     'enum_label', 'OPEN',
     'The blind-rating statuses. Everything below assumes these exist.'),
  ('0021_blind_rating',          'function',   'lead_open',
     'CRITICAL. Blind parallel rating: the RLS policies and the transition function. 0033 REQUIRES this.'),
  ('0022_cycle_type',            'column',     'evaluation_cycles.cycle_type',
     'EVALUATION vs INCREMENT cycles, and per-evaluation due dates.'),
  ('0026_invite_status_ok',      'invite_ok',  'verify_invite_token returns OK',
     'Until this is applied, NO invite link in the system verifies.'),
  ('0027_cycle_progress_blind',  'view',       'v_cycle_progress',
     'Cycle progress reads 0% for every cycle without it.'),
  ('0028_employment_import',     'function',   'import_employment',
     'The bulk employment import.'),
  ('0029_reports',               'table',      'evaluation_reviews',
     'HR cannot review a record or send it to the MD without it.'),
  ('0030_increment',             'table',      'increment_reviews',
     'Salary review, MD approval and the interview record.'),
  ('0031_due_items',             'table',      'due_items',
     'What is due, and the nightly sweep behind it.'),
  ('0032_recycle_bin',           'column',     'evaluation_cycles.deleted_at',
     'The recycle bin tab errors without it.'),
  ('0033_parallel_layer_writes', 'merge_ok',   'merge_evaluation_answers is blind-rating aware',
     'CRITICAL, and needs 0021 first. Until this is applied the HOD cannot save.'),
  ('0034_question_import',       'function',   'import_questions',
     'Bulk Job Specific Skills import.'),
  ('0035_worker_questions',      'table',      'worker_questions',
     'The worker appraisal form in the Form Builder.'),
  ('0036_form_sections',         'table',      'form_sections',
     'Renaming and reordering the form''s sections.'),
  ('0037_audit_no_returning',    'audit_ok',   'apply_evaluation_transition writes audit without RETURNING',
     'CRITICAL. Without it an EMPLOYEE cannot submit their own evaluation — only the HOD can.'),
  ('0038_raise_pending_hr_review','function',   'raise_pending_hr_review',
     'Without it an evaluation with BOTH sides submitted sits at OPEN and never reaches HR.'),
  ('0023_employment',            'table',      'employment_records',
     'Employment and pay records. Without it the Employment tab and the increment calendar have nothing to read.'),
  ('0039_hr_close_evaluation',   'close_ok',   'HR may close an EVALUATION cycle without the MD',
     'Without it an evaluation cycle can only reach CLOSED through the MD, so HR cannot finish one on their own.'),
  ('0040_own_current_salary',    'view',       'v_my_current_salary',
     'Without it the increment form cannot show an employee their current salary — the field renders an em dash.'),
  ('0041_read_my_lead',          'function',   'is_my_lead',
     'Without it EVALUATED BY is blank on every self-evaluation: the employee cannot read their own HOD''s name.'),
  ('0042_pre_increment_evaluation','function',  'milestone_notice_days',
     'Without it the six-months-before-increment evaluation is never raised for tenured staff.'),
  ('0043_joining_salary_baseline','column',     'employment_records.joining_ctc',
     'Without it a joining salary recorded after a raise is filed as a rise over today''s pay.'),
  ('0044_joining_ctc_provenance','column',      'employment_records.joining_ctc_recorded_by',
     'Without it the joining salary row in the pay ledger has nobody''s name against it.'),
  ('0045_worker_appraisal',      'table',       'worker_evaluations',
     'The shop-floor appraisal. Without it there is no way to run a worker cycle at all.')
)
select
  e.migration,
  case e.kind
    when 'table'  then to_regclass('public.' || e.object_name) is not null
    when 'view'   then to_regclass('public.' || e.object_name) is not null
    when 'function' then exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = e.object_name)
    when 'column' then exists (
      select 1 from information_schema.columns c
       where c.table_schema = 'public'
         and c.table_name  = split_part(e.object_name, '.', 1)
         and c.column_name = split_part(e.object_name, '.', 2))
    when 'enum_label' then exists (
      select 1 from pg_enum en join pg_type t on t.oid = en.enumtypid
       where t.typname = 'evaluation_status' and en.enumlabel = e.object_name)
    when 'invite_ok' then exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'verify_invite_token'
         and pg_get_functiondef(p.oid) like '%''OK''%')
    when 'audit_ok' then exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'apply_evaluation_transition'
         and pg_get_functiondef(p.oid) not like '%returning id into v_audit_id%')
    -- 0039 patches apply_evaluation_transition rather than creating an object,
    -- so the tell is the transition itself appearing in the stored body.
    when 'close_ok' then exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'apply_evaluation_transition'
         -- The clause 0039 injects. The filename is not a tell: it appears
         -- only in the migration's own comments and never reaches the body.
         and pg_get_functiondef(p.oid) like '%''PENDING_HR_REVIEW'' and p_to_status = ''CLOSED''%')
    when 'merge_ok' then exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'merge_evaluation_answers'
         and pg_get_functiondef(p.oid) not like '%SELF_SUBMITTED%')
    else false
  end as applied,
  e.why_it_matters
from expected e
order by e.migration;
