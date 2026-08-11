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
  -- ---- The increment overhaul, 0061–0068. These had NO ROWS AT ALL until now,
  -- which is the FIX-15 lesson repeating: a diagnostic with holes is worse than
  -- none, because it is trusted. Each detects the thing its migration WROTE,
  -- never a set of tokens the file happens to contain (0056's failure).
  ('0061_expectation_monthly',   'monthly_x12','record_salary_expectation converts ×12',
     'Without it a monthly answer is banked as though it were annual — a figure out by twelve, feeding a pay decision.'),
  ('0062_manager_hike_percent',  'question_id','linkd.q.mgr.hike_percent',
     'Without it the manager is never asked for a recommended hike percent, so a promotion recommendation arrives with no figure behind it.'),
  ('0063_review_row_on_arrival', 'function',   'ensure_increment_review',
     'Without it an increment evaluation reaching HR has no review row waiting, so the salary band has nothing to write into.'),
  ('0064_supervisor_percent_only','trigger',   'worker_decisions_guard',
     'Without it a supervisor can write the salary amounts on a worker sheet, not only the percentage. Pairs with the 0051 row above.'),
  ('0065_signature_image',       'column',     'profiles.signature_image',
     'Without it nobody can hold a signature image, so the printed sheet has only ruled lines where a signature was recorded.'),
  ('0066_salary_change_moves_the_clock','function','apply_salary_to_record',
     'Without it recording a pay change moves the money and NOT the increment clock — and the MD''s write silently does nothing at all.'),
  ('0067_hike_percent_required', 'pct_required','the hike percent is required',
     'Without it a manager can recommend a promotion and leave the percentage blank, which is the one number the recommendation exists to carry.'),
  ('0068_ledger_owns_the_clock', 'clock_from_ledger','the clock is taken from the pay ledger',
     'Without it a hand-typed last-increment date outranks a recorded rise, so somebody who WAS given a raise still shows the old date.'),
  -- A NEW name, so the generic detector is safe here: there is no earlier
  -- version of this function whose body a LIKE could match by accident. That
  -- was 0056's failure, and this row deliberately does not repeat it.
  ('0069_record_joining_salary', 'function',   'record_joining_salary',
     'Without it the MD recording a joining salary writes NOTHING and is told it worked — the update matches zero rows, and zero rows is a success.'),
  ('0039_hr_close_evaluation',   'close_ok',   'HR may close an EVALUATION cycle without the MD',
     'Without it an evaluation cycle can only reach CLOSED through the MD, so HR cannot finish one on their own.'),
  ('0046_increment_final_score', 'final_score','confirm_increment records a final score',
     'Without it a closed INCREMENT stores no final rating at all — the FINAL column stays an em dash for ever.'),
  ('0052_expectation_from_snapshot','expectation','the expectation is found in the snapshot',
     'Without it "What they asked for" reads Not stated whenever the form does not carry 0030''s exact question id.'),
  ('0053_supervisor_reads_their_workers','function','is_my_worker',
     'Without it the shop floor shows every worker as "Worker" with a dash — a supervisor cannot read the name of somebody they were assigned to rate.'),
  ('0054_supervisor_completes_worker_appraisal','function','complete_worker_appraisal',
     'Without it a supervisor''s rating never reaches HR: the appraisal stays OPEN for ever, because the update that should move it matches zero rows.'),
  -- SUPERSEDED BY 0061, DELIBERATELY — AND THIS ROW WAS DANGEROUS.
  --
  -- 0055 made the question say ANNUAL. 0061 then made it say MONTHLY at the
  -- owner's instruction ("the expected salary metric is shifting from annual CTC
  -- to monthly"), converting ×12 on save so the stored column stays annual.
  --
  -- So the text no longer contains "annual CTC", this row reported FALSE, and
  -- its wording invited exactly the wrong repair: re-running 0055 would undo
  -- 0061's wording while leaving the ×12 conversion in place — every answer then
  -- multiplied by twelve against a question asking for the annual figure. That
  -- is the 733% incident, reintroduced by a diagnostic.
  --
  -- It now checks the CURRENT correct wording, so TRUE means right.
  ('0055→0061_salary_question_wording','question_text','the salary question asks MONTHLY',
     'The employee is asked for a MONTHLY figure and it is banked as annual. TRUE is correct — do NOT re-run 0055, which would put the question back to annual while the ×12 conversion stayed.'),
  ('0056_hr_may_close_increment','hr_close_inc','HR may approve and close an INCREMENT',
     'Without it HR pressing Approve and close is refused: "You are not permitted to move this evaluation from HR_APPROVED to MD_REVIEWED".'),
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
  ('0047_worker_appraisal',      'table',       'worker_evaluations',
     'The shop-floor appraisal. Without it there is no way to run a worker cycle at all.'),
  ('0048_worker_handover',       'function',    'submit_worker_self_handover',
     'Without it a worker cannot tick their own sheet on their supervisor''s device.'),
  ('0050_worker_form_fields',    'table',       'worker_evaluation_decisions',
     'Without it the worker form has no supervisor comment, no training tick and nowhere to record the salary block.'),
  -- SUPERSEDED BY 0064, DELIBERATELY. 0051 gave the supervisor read and write on
  -- the whole worker salary block; 0064 took the amounts back at the owner's
  -- instruction ("supervisor will add only hike percent as they dont know the
  -- salary of employees") and left them the percentage. So the policy 0051
  -- created is GONE ON PURPOSE, and a row detecting its presence reported the
  -- intended state as a failure. It now detects 0064's replacement, so TRUE
  -- means correct. DO NOT re-run 0051 — it would hand the amounts back.
  ('0051→0064_worker_salary_confined','view',   'v_worker_supervisor_decision',
     'The supervisor sees the hike PERCENT and never an amount. TRUE is the correct state; 0051''s wider policy was revoked on purpose.'),
  ('0057_worker_submit',         'function',    'submit_worker_layer',
     'CRITICAL. Without it a submitted worker sheet is never RECORDED as submitted — the answers save and HR''s board stays on "Not yet".'),
  ('0058_worker_submit_backfill','worker_backfilled','no submitted sheet is stranded',
     'TRUE means nothing is stranded — either the repair ran or there was never anything to repair. It was listed as ''nothing to detect'', which returned null for ever and read as a permanent to-do; the repair''s own effect is perfectly detectable and this now checks it.'),
  ('0018_retire_old_departments','dept_retired','the five P1 placeholder departments',
     'Superseded by 0019 and harmless either way. Listed so the set below is complete.'),
  ('0019_departments_reconcile','dept_named',  'the ten real departments',
     'Without it the department picker still offers fifteen, three of which cannot be launched because they have no Job Specific Skills questions.'),
  ('0024_one_joining_date',     'one_doj',     'one joining date, on profiles',
     'Without it there are TWO joining dates written by different screens. The scorecard and the printed pack read the one no form ever sets, so it is permanently blank.'),
  ('0025_reassign_lead_blind',  'reassign_ok', 'reassign_evaluation_lead is blind-rating aware',
     'CRITICAL. Without it HR cannot reassign a lead on ANY live evaluation: the guard names four retired statuses and every live row is at OPEN, so it refuses every one with a self-contradictory message.'),
  ('0045_md_may_close_increment','md_close_inc','the MD may close an INCREMENT',
     'Without it confirm_increment rolls back at its last step, so a confirmed increment is not saved at all.'),
  ('0049_rating_distribution_settled','view',   'v_rating_distribution',
     'Without it the dashboard rating-band panel is empty.'),
  ('0059_app_notifications',    'table',        'app_notifications',
     'The notification bell. Without it the bell is empty for everybody, and every authenticated page load asks for a table that is not there.'),
  ('0060_hr_close_increment_really','hr_close_inc','HR may approve and close an INCREMENT — FOR REAL',
     'Applies what 0056 reported it had applied. 0056''s guard matched the UNPATCHED function, so it skipped its own work and said "already widened". Same row as 0056 above: if that says false, 0056 never took effect and this is the migration that fixes it.')
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
    -- A pure data repair creates no object, so there is nothing to look for.
    -- Reported rather than guessed at: a check that always says "missing" is
    -- worse than one that says it cannot tell.
    when 'dept_retired' then not exists (
      select 1 from public.departments where code in ('MIS','SALES','OPS','DESIGNS','ACCOUNTS') and is_active)
    when 'dept_named' then exists (
      select 1 from public.departments where name = 'Data Analyst' and is_active)
    -- 0024 DROPS a column, so its evidence is an absence.
    when 'one_doj' then not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'employment_records'
         and column_name = 'date_of_joining')
    -- The retired statuses gone from the guard is what 0025 does.
    when 'reassign_ok' then exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'reassign_evaluation_lead'
         and pg_get_functiondef(p.oid) not like '%CYCLE_ACTIVE%')
    -- One contiguous literal, deliberately: the loose multi-%% LIKE next door is
    -- what made 0056 report a success it had not achieved. See 0060.
    when 'md_close_inc' then exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'apply_evaluation_transition'
         and pg_get_functiondef(p.oid) like '%INTERVIEW_DONE%is_md() or v_is_system%')
    /* -- The EFFECT of the repair, not the fact of running it.
          0058 sets the evaluation's timestamp from its response row, so once it
          has run — or if it never had anything to do — there can be no response
          marked submitted whose evaluation still says otherwise. That is a
          stronger check than "did somebody run the file": it also catches a row
          drifting back into that state later. -- */
    when 'worker_backfilled' then
      to_regclass('public.worker_evaluation_responses') is not null
      and not exists (
        select 1
          from public.worker_evaluation_responses r
          join public.worker_evaluations e on e.id = r.evaluation_id
         where r.submitted_at is not null
           and ((r.layer = 'SELF' and e.self_submitted_at is null)
             or (r.layer = 'SUPERVISOR' and e.supervisor_submitted_at is null)))
    when 'none' then null
    when 'policy' then exists (
      select 1 from pg_policies
       where schemaname = 'public' and policyname = e.object_name)
    when 'view' then exists (
      select 1 from pg_views
       where schemaname = 'public' and viewname = e.object_name)
    when 'trigger' then exists (
      select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and t.tgname = e.object_name and not t.tgisinternal)
    -- A question by its DETERMINISTIC id (0017's md5 device), not by its text.
    -- Text is editable in the Form Builder; the id is not, so this cannot go
    -- false because somebody reworded a question.
    when 'question_id' then exists (
      select 1 from public.questions where id = md5(e.object_name)::uuid)
    when 'monthly_x12' then exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'record_salary_expectation'
         and pg_get_functiondef(p.oid) like '%v_amount * 12%')
    when 'pct_required' then exists (
      select 1 from public.questions
       where id = md5('linkd.q.mgr.hike_percent')::uuid and is_required)
    -- 0068 replaced 0066's forward-only comparison with a MAX over the ledger.
    -- Anchored to the aggregate it wrote, because both versions of the function
    -- carry the same name and most of the same body.
    when 'clock_from_ledger' then exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'apply_salary_to_record'
         and pg_get_functiondef(p.oid) ~ 'max\(h\.effective_from\)')
    when 'close_ok' then exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'apply_evaluation_transition'
         -- The clause 0039 injects. The filename is not a tell: it appears
         -- only in the migration's own comments and never reaches the body.
         and pg_get_functiondef(p.oid) like '%''PENDING_HR_REVIEW'' and p_to_status = ''CLOSED''%')
    when 'final_score' then exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'confirm_increment'
         and pg_get_functiondef(p.oid) like '%final_overall%')
    when 'expectation' then exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'record_salary_expectation'
         and pg_get_functiondef(p.oid) like '%evaluation_questions%')
    -- 0061's wording, NOT 0055's. See the note on that row: checking for
    -- "annual CTC" reported the current, correct state as a failure and invited
    -- a repair that would have reintroduced the ×12 error. The id deliberately
    -- still reads `..._annual` — 0061 kept it, because the STORED column is
    -- annual; only what the employee types is monthly.
    when 'question_text' then exists (
      select 1 from public.questions
       where id = md5('linkd.q.salary_expectation_annual')::uuid
         and text ilike '%monthly salary%')
    -- A REGEX ANCHORED TO THE ARM, not a LIKE over the whole body.
    --
    -- This read `like '%HR_APPROVED%MD_REVIEWED%is_hr() or public.is_md()%'`,
    -- which asks only that the three fragments appear in that order ANYWHERE.
    -- 0021 already put all three into unrelated arms of the same CASE, so the
    -- pattern matched the UNPATCHED function and this row reported 0056 as
    -- applied when it was not — the same flaw 0056's own guard had, which is
    -- why the failure was invisible from every angle. See 0060.
    when 'hr_close_inc' then exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'apply_evaluation_transition'
         and pg_get_functiondef(p.oid) ~ 'when p_from_status = ''HR_APPROVED'' and p_to_status = ''MD_REVIEWED''\s+then\s+public\.is_hr\(\) or public\.is_md\(\)')
    when 'merge_ok' then exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'merge_evaluation_answers'
         and pg_get_functiondef(p.oid) not like '%SELF_SUBMITTED%')
    else false
  end as applied,
  e.why_it_matters
from expected e
order by e.migration;
