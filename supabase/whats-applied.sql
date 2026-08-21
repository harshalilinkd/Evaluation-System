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
  -- Also a new name, so the generic detector is exact by construction.
  ('0070_md_closes_worker_appraisal', 'function', 'close_worker_appraisal',
     'Without it the MD CANNOT close a production appraisal at all — worker_evaluations admits only HR for UPDATE, so their close matches zero rows, and the screen wrongly reports that somebody else moved it.'),
  ('0071_worker_profile_without_email', 'nullable', 'profiles.email',
     'Without it a production worker cannot be imported at all — their profile needs an address they do not have, and the column refuses null.'),
  -- Detects what the migration WROTE — the scope on the question itself — not a
  -- token the file happens to contain. Both questions move together, so either
  -- one answers for the pair; the promotion question is the parent and is the
  -- one that must be right.
  ('0072_promotion_is_increment_only', 'q_scope', 'the promotion question is INCREMENT_ONLY',
     'Without it a plain EVALUATION cycle asks the manager to recommend a promotion and a percentage, on a cycle that has no pay decision at the end of it.'),
  ('0073_notification_templates', 'table', 'notification_templates',
     'Without it Settings > Messages cannot save a reworded message — the editor is there and the table it writes to is not.'),
  /* -- Detected on the PROVIDER CHECK the migration wrote, not on the function
        name: `handle_new_auth_user` has existed since 0001 and 0071 rewrote it,
        so a `function` detector would report 0074 applied on a database that
        has never seen it — which is 0056's false positive exactly. -- */
  ('0074_no_self_signup', 'no_selfsignup', 'handle_new_auth_user refuses a social provider',
     'Without it, enabling Google sign-in lets ANY Google account on earth create itself a profile and an EMPLOYEE role. §9 puts account creation with HR.'),
  ('0075_correct_joining_salary', 'function', 'set_joining_salary',
     'Without it HR cannot CORRECT a joining salary — 0069 refuses to overwrite one, so a figure typed wrong at import stays wrong.'),
  ('0076_evaluation_schedule', 'table', 'evaluation_schedule',
     'Without it the review schedule is not a setting: evaluations are computed from the old fixed 1-and-6-months-from-joining rule, and Settings > Evaluation periods cannot save.'),
  /* -- Detected on the COLUMN, which is what 0081 wrote. The generic `column`
        kind would be right here too, but `nullable` says the other half of the
        claim: the whole safety argument is that both are optional and blank
        falls back, so a column that existed and were NOT NULL would be a
        different migration wearing the same name. -- */
  /* -- The second reviewer, 0082 to 0086. Each detector matches what its own
        migration WROTE, never a token the file happens to contain — 0056
        reported itself applied because a LIKE found three fragments that were
        already there in three unrelated places. -- */
  ('0089_narrative_last', 'narrative_is_last',
     'Support & Expectations sits last on the employee''s form',
     'Without it the section renders wherever it currently sits — on this database, above Learning & Development. Nothing breaks; the form simply asks for what somebody expects before asking what they learned.'),
  ('0090_md_only_approves_increment', 'md_only_approves', 'only the MD may approve and close an increment',
     'Without it HR can approve and close an increment alone — the second pair of eyes AMEND-2 restored on a pay decision. TRUE is the intended state; it reverses 0056 and 0060 at the owner''s explicit instruction.'),
  ('0091_supersede_earlier_milestone', 'supersedes_milestone', 'a later milestone withdraws an earlier open one',
     'Without it an employee whose 1-month review was never finished holds TWO live evaluations and gets TWO form links when their 6-month review falls due. DO NOT re-run 0079 after this — see the 0079 row.'),
  ('0092_second_reviewer_reads_their_people', 'co_reviewer_reads', 'a second reviewer may read the people they rate',
     'Without it a Design Coordinator opens My Team and the person they are there to rate is called "Unknown" — no name, no employee code, no designation. The evaluation is readable and the PROFILE is not, so the row renders with the department and nothing else. 0083 added co_reviewer_id and never the read.'),
  ('0088_invite_token_second_reviewer', 'invite_layer_lead2',
     'invite_tokens accepts a LEAD_2 link',
     'Without it, LAUNCHING A CYCLE FOR ANYBODY WITH A SECOND REVIEWER FAILS OUTRIGHT with "An invite link can only be scoped to the SELF or LEAD layer." — 0084 taught issue_invite_token who a LEAD_2 token belongs to and left the guard, the CHECK and the due-date branch knowing two layers.'),
  ('0087_manager_overall', 'manager_overall_fn', 'the manager_overall() function',
     'Without it a designer''s scorecard, the Team review roster, the printed pack and the department averages all show the REPORTING LEAD''s figure alone — half their review, under a heading that says Manager. Nothing errors; the number is simply one manager short.'),
  ('0086_cycle_progress_second_reviewer', 'progress_counts_co_lead',
     'v_cycle_progress waits for BOTH managers',
     'Without it a designer''s row reports its manager step complete the moment ONE of their two managers submits, so a cycle reads finishable on HR''s board while half its manager ratings are outstanding.'),
  ('0085_second_reviewer_submits', 'transition_knows_co_lead',
     'apply_evaluation_transition accepts a LEAD_2 submission',
     'Without it a second reviewer fills a whole review and Submit is refused. Worse if only half-applied: the patch ALSO adds co_lead_submitted_at to the evaluation-patch whitelist, and a key that is not in that list is dropped in SILENCE — the response row would lock, the evaluation would say nothing had been submitted, and the completion rule would wait for ever.'),
  ('0084_launch_second_reviewer', 'launch_opens_third_form',
     'launch_cycle freezes co_lead_id and opens a LEAD_2 row',
     'Without it, setting a second reviewer in Settings changes nothing: no third form is opened, no third token is issued, and the coordinator never hears about the cycle.'),
  ('0083_second_reviewer', 'column', 'evaluations.co_lead_id',
     'Without it nothing about a second reviewer exists — Settings cannot save one, and every screen that reads the column fails with "column does not exist".'),
  ('0082_second_reviewer_enum', 'enum_value', 'rating_layer.LEAD_2',
     'Without it 0083 cannot apply at all. An enum value cannot be added and USED in one transaction, which is why this is a migration of its own.'),
  ('0081_work_contact', 'nullable', 'profiles.work_email',
     'Without it nobody can have a second contact pair: HR''s digests and report notices go to the same number and address as her own appraisal, and Settings > Users refuses the two new fields with "column does not exist". Everything else works exactly as before — the pair is optional and blank falls back.'),
  ('0080_undo_0079_exception_splice', 'milestone_returns', 'create_milestone_evaluation reaches its RETURN',
     'Without it 0079 part 3 leaves an exception clause between the INSERT and the return, which ends the function''s block — so the snapshot, both response rows, the tokens and the RETURN all fall outside the normal path and Create and send fails with "control reached end of function without RETURN".'),
  ('0079_rolling_cycle_per_milestone', 'cycle_per_milestone', 'a rolling cycle per milestone, not one per year',
     'Without it a person can hold only ONE milestone evaluation per financial year — the yearly cycle plus unique (cycle_id, evaluatee_id) — so their second review of the year fails with "duplicate key value violates constraint evaluations_cycle_evaluatee_unique". Under the company schedule everybody has two. TRUE is correct; do NOT re-run 0079 once 0080 has run. 0079 part 3 skips itself only when it finds the text "already has this review in", and removing that text is precisely what 0080 does — so a re-run re-splices the exception clause and Create and send fails again with "control reached end of function without RETURN".'),
  ('0078_due_items_second_constraint', 'one_milestone_check', 'no constraint still enumerates MONTH_1',
     'Without it every MONTH_3 and MONTH_9 is refused by 0042''s constraint, which 0076 never widened — so "Check again" errors and Evaluation Due stays empty however many people are due. 0078 also carries 0077''s fix, so it is sufficient on its own.'),
  ('0077_due_sweep_count', 'sweep_count', 'compute_due_items counts all three branches',
     'Without it "Check again" reports only the new-joiner half. In a company where everybody has had an increment that is ZERO, so a sweep that created a dozen items says "Nothing new is due" — the button stating the opposite of what it just did.'),
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
     'The employee is asked for a MONTHLY figure and it is banked as annual (0061 multiplies by twelve). FALSE means the question has stopped saying "monthly" — answers would then be out by a factor of twelve. TRUE is correct; do NOT re-run 0055, which would put the question back to annual while the conversion stayed.'),
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
    -- A column that EXISTS either way; what 0071 changed is whether it may be
    -- null. The generic 'column' check would report it applied before it ran,
    -- which is the 0056 false positive in a different costume — a detector has
    -- to match what the migration WROTE.
    when 'nullable' then exists (
      select 1 from information_schema.columns c
       where c.table_schema = 'public'
         and c.table_name   = split_part(e.object_name, '.', 1)
         and c.column_name  = split_part(e.object_name, '.', 2)
         and c.is_nullable  = 'YES')
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
    /* -- 'none' IS GONE, and its absence is the guarantee.
          It returned NULL — "repair, nothing to detect" — and a row that cannot
          answer is exactly how 0058 sat on the outstanding list for three
          sessions, reported as a gap that was not there (FIX-16). That entry
          removed the last ROW using it and left the BRANCH, sitting where the
          next person adding a repair migration would reach for it.

          With it gone this expression is structurally incapable of returning
          NULL, so `true` means applied and `false` means not, with no third
          answer. A repair whose effect is undetectable is not exempt: 0058's
          own row proves the effect is what to detect, not the running. -- */
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
    when 'no_selfsignup' then exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'handle_new_auth_user'
         and pg_get_functiondef(p.oid) like '%raw_app_meta_data%')
    -- The VIEW's own text, not merely that a view exists: 0027 also creates a
    -- v_cycle_progress, so `view` would be true before 0086 ran.
    -- The FUNCTION plus the view that calls it: the function alone would be
    -- true if somebody created it by hand, and the views are where it bites.
    -- BOTH halves: the constraint and the function's own guard. Either alone
    -- would report the migration applied while a launch still failed.
    -- The finished ORDER, not the migration's own literal: 0089 computes the
    -- value from what is there, so a fixed number would not tell you anything.
    when 'narrative_is_last' then (
      select coalesce(
        (select sort_order from public.form_sections where section = 'NARRATIVE')
          > (select max(sort_order) from public.form_sections
              where section not in ('NARRATIVE', 'MANAGER_REVIEW')),
        false))
    when 'invite_layer_lead2' then exists (
      select 1 from pg_constraint
       where conname = 'invite_tokens_layer_valid'
         and pg_get_constraintdef(oid) like '%LEAD_2%')
      and exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'issue_invite_token'
         and pg_get_functiondef(p.oid) like '%''SELF'', ''LEAD'', ''LEAD_2''%')
    when 'manager_overall_fn' then exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'manager_overall')
      and exists (
      select 1 from pg_views
       where schemaname = 'public' and viewname = 'v_employee_history'
         and definition like '%manager_overall%')
    when 'progress_counts_co_lead' then exists (
      select 1 from pg_views
       where schemaname = 'public' and viewname = 'v_cycle_progress'
         and definition like '%co_lead_id IS NULL%')
    -- The ARM the patch wrote, anchored to the lock layer it gates on. 0085
    -- adds two things and this is the one that cannot be reached any other way.
    when 'transition_knows_co_lead' then exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'apply_evaluation_transition'
         and pg_get_functiondef(p.oid) like '%co_lead_submitted_at%'
         and pg_get_functiondef(p.oid) like '%p_lock_layer = ''LEAD_2''%')
    when 'launch_opens_third_form' then exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'launch_cycle'
         and pg_get_functiondef(p.oid) like '%co_reviewer_id%')
    when 'enum_value' then exists (
      select 1 from pg_enum e2 join pg_type t on t.oid = e2.enumtypid
       where t.typname = split_part(e.object_name, '.', 1)
         and e2.enumlabel = split_part(e.object_name, '.', 2))
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
    /* -- THE WORD, NOT THE PHRASE. This matched '%monthly salary%' and went
          FALSE against "What is your monthly Expected Salary?" — the two words
          are no longer adjacent, so a correct database reported a problem it
          did not have.

          FIX-19 wrote this lesson down and this row still carried the fault:
          question text is editable in the Form Builder, so any detector keyed
          to a PHRASE breaks the first time somebody rewords the question. The
          word is what carries the meaning, and its ABSENCE is the dangerous
          state worth catching — 0061 multiplies the answer by twelve, so a
          question that stops saying monthly is one whose answers are out by a
          factor of twelve, feeding a pay decision.

          Anchored to the deterministic id, as FIX-19 established (F19-8), so a
          rename cannot move it.

          NO BACKSLASH, deliberately. Postgres spells a word boundary '\m'/'\M',
          and whether a lone backslash in a string literal survives depends on
          standard_conforming_strings — which is one setting away from turning
          this check into a permanent false alarm in a file people PASTE into
          whatever console they have open. A bracket expression says the same
          thing and cannot be misread. -- */
    when 'question_text' then exists (
      select 1 from public.questions
       where id = md5('linkd.q.salary_expectation_annual')::uuid
         and text ~* '(^|[^[:alpha:]])monthly([^[:alpha:]]|$)')
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
    when 'q_scope' then exists (
      select 1 from public.questions
       where id = md5('linkd.q.mgr.promotion')::uuid
         and cycle_scope = 'INCREMENT_ONLY')
    -- Anchored to what 0077 WROTE — the accumulator — not to a token 0076's
    -- body already contains. That was 0056's failure and this row does not
    -- repeat it: 0076 has exactly one `get diagnostics`, 0077 has three
    -- followed by `v_created := v_created + v_batch`.
    -- By DEFINITION, not by name: two constraint names have drifted across
    -- three migrations here, and asking after either one is how 0076 missed the
    -- second. Anything still enumerating MONTH_1 is stale, whatever it is
    -- called; 0076's regex reads '^MONTH_[0-9]{1,3}$' and cannot match this.
    -- The ARGUMENT LIST is what 0079 wrote: it drops the one-argument form and
    -- creates (date, text). Detecting the milestone words in the body would go
    -- false the moment somebody rewords a cycle name.
    -- The tail after the INSERT must hold a RETURN and no exception clause.
    -- Anchored to control flow rather than to text, because "it compiled" was
    -- exactly what let 0079 part 3 through.
    when 'milestone_returns' then exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'create_milestone_evaluation'
         and substr(pg_get_functiondef(p.oid),
                    position('returning id into v_eval' in pg_get_functiondef(p.oid))) ~* '\mreturn\M'
         and substr(pg_get_functiondef(p.oid),
                    position('returning id into v_eval' in pg_get_functiondef(p.oid))) !~* '\mexception\s+when\M')
    /* -- TYPES, NOT THE IDENTITY STRING. This compared
          pg_get_function_identity_arguments() against 'date, text' and could
          NEVER be true: that function includes the parameter NAMES, so the real
          value is 'p_on date, p_milestone text'. It reported 0079 as
          outstanding on a database where it was fully applied — and the row's
          own note then sent the reader to re-apply a migration that had already
          run, whose part 3 splices an exception clause 0080 exists to remove.

          Third false alarm found in this file in one sitting, and the same
          shape each time: a detector matching a SPELLING rather than the state.
          oidvectortypes(proargtypes) is the types alone, so renaming a
          parameter cannot move it. -- */
    /* -- 0090 · The approval arm narrowed to the MD alone. Anchored to the ARM
          — the from/to clause and its `then` adjacent — never to a set of
          tokens the CASE happens to contain somewhere. That was 0056's failure:
          a LIKE over three fragments matched three UNRELATED rows and reported
          a success it had not achieved. -- */
    when 'md_only_approves' then exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'apply_evaluation_transition'
         and pg_get_functiondef(p.oid) ~
             'HR_APPROVED[^;]{0,80}MD_REVIEWED[[:space:]]+then[[:space:]]+public\.is_md\(\)')

    /* -- 0091 · The supersede block, detected by the comment 0091 SPLICES IN —
          which is the same string 0091 itself checks to decide it has already
          run, so the two cannot disagree. -- */
    when 'supersedes_milestone' then exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'create_milestone_evaluation'
         and pg_get_functiondef(p.oid) like '%Supersede any earlier%')

    /* -- 0092 · The second reviewer's read of the people they rate. On the
          POLICY's own expression, so it cannot be satisfied by the column
          merely existing (0083 added that and the read was still missing —
          which is the whole bug). -- */
    when 'co_reviewer_reads' then exists (
      select 1 from pg_policy pol join pg_class c on c.oid = pol.polrelid
       where c.relname = 'profiles'
         and pg_get_expr(pol.polqual, pol.polrelid) like '%co_reviewer_id%')

    when 'cycle_per_milestone' then exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'ensure_rolling_cycle'
         and oidvectortypes(p.proargtypes) = 'date, text')
    when 'one_milestone_check' then not exists (
      select 1 from pg_constraint c
       where c.contype = 'c'
         and c.conrelid in ('public.due_items'::regclass, 'public.evaluations'::regclass)
         and pg_get_constraintdef(c.oid) like '%''MONTH_1''%')
    when 'sweep_count' then exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'compute_due_items'
         and pg_get_functiondef(p.oid) like '%v_created := v_created + v_batch%')
    when 'merge_ok' then exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'merge_evaluation_answers'
         and pg_get_functiondef(p.oid) not like '%SELF_SUBMITTED%')
    else false
  end as applied,
  e.why_it_matters
from expected e
order by e.migration;
