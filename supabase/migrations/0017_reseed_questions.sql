-- =============================================================================
-- 0017_reseed_questions.sql — the textile question bank. Phase P2-RESEED.
-- FORM_BLUEPRINT.md. CLAUDE.md §5 (snapshot rule), §17 (never reword).
-- =============================================================================
--
-- NUMBERING. FORM_BLUEPRINT.md names this 0012_reseed_questions.sql. 0012 is
-- 0012_merge_hr_md.sql and has been applied; §0.8 says numbering is sequential
-- and an applied migration is never edited. Renumbered, as 0010 and 0015 were.
--
-- WHY DEACTIVATE RATHER THAN DELETE
--
-- The bank seeded in P2 was transcribed from a company-secretarial Google form —
-- Companies Act, FEMA, RBI, SEBI — and describes no job at LD Group. It is
-- wrong, but it is not deletable: §5's snapshot rule means any launched
-- evaluation froze its own copy, and §17 forbids deleting a question row.
-- Setting is_active = false retires them from every future form while leaving
-- the audit trail and any frozen snapshot exactly as they were.
--
-- THE SNAPSHOT RULE IS WHY THIS IS SAFE AT ALL
--
-- evaluation_questions has no update or delete policy for anyone (0005), and it
-- never joins back to public.questions (0003). Replacing the entire bank
-- therefore cannot touch a single launched evaluation. p2reseed proves it by
-- fingerprinting a snapshot before and after.
--
-- WORKER QUESTIONS ARE NOT RESEEDED. The blueprint's step 6 asks for
-- worker_questions; that table does not exist — the worker module has never
-- been built. Writing it here would breach §0.4. Flagged rather than faked.
--
-- WORDING IS VERBATIM. §17: never "improve" wording that came from the source.
-- Every question and help text below is exactly as FORM_BLUEPRINT.md has it,
-- including the ±1 mm tolerance and the 36"/58"/64"/72" widths.
-- =============================================================================


/* ---------- 1. Retire the old bank ---------- */

do $$
declare
  v_retired integer;
begin
  update public.questions
  set is_active = false
  where is_active = true;

  get diagnostics v_retired = row_count;

  -- §12: a change of this size answers to the audit log. The count is recorded
  -- so somebody reading it later knows how much of the bank moved at once.
  if v_retired > 0 then
    insert into public.audit_log (actor_id, entity, entity_id, action, diff, reason)
    values (
      null, 'question', gen_random_uuid(), 'question.bank_retired',
      jsonb_build_object('retired', v_retired),
      'Carried over from a company-secretarial source form; replaced by the textile bank (FORM_BLUEPRINT.md). Retained for audit, never deleted.'
    );
  end if;
end;
$$;


/* ---------- 2. Departments ---------- */
--
-- The blueprint's ten. Existing rows are kept and NOT renamed (§0.2) — a
-- department whose code already exists keeps its name, because renaming one
-- would silently re-label every evaluation already filed against it.

insert into public.departments (name, code, description) values
  ('Design',                    'DESIGN',   'Design studio — concepts, colour and repeats'),
  ('MDO / Printing',            'MDO',      'Machine setup and printing'),
  ('Fusing & Calendering',      'FUSING',   'Transfer, temperature and pressure'),
  ('KATA — Measurement & QC',   'KATA',     'Measurement, inspection and shade control'),
  ('Stores & Fabric Inward',    'STORES',   'Inward, stock and issue'),
  ('Dispatch & Packing',        'DISPATCH', 'Rolling, packing and delivery'),
  ('Sales & Customer Service',  'SALESCS',  'Enquiries, orders and customer care'),
  ('MIS & Systems',             'MISSYS',   'Reporting, data and systems'),
  ('Accounts & Compliance',     'ACCTS',    'Billing, reconciliation and statutory'),
  ('HR & Admin',                'HRADMIN',  'People, payroll and facilities')
on conflict (code) do nothing;


/* ---------- 3. The bank ---------- */
--
-- Deterministic ids from md5('linkd.q.' || key), the same device P2 used: the
-- questions table has no natural unique key, and a stable id is what lets the
-- conditional wiring below reference a parent without a second round trip.
-- The keys live only in this migration — they are not a schema column.

create or replace function pg_temp.qid(key text) returns uuid
language sql immutable as $$
  -- md5 returns 32 hex characters, which uuid's input parser accepts without
  -- dashes. The same device P2's seed used.
  select md5('linkd.q.' || key)::uuid;
$$;

insert into public.questions
  (id, text, help_text, section, response_type, category, track, answered_by,
   is_required, min_value, max_value, sort_order, is_active)
values
  /* ---- Section 2 · Work Output (KPI) ---- */
  (pg_temp.qid('kpi.days_present'), 'Days present during the evaluation period', null,
   'KPI', 'NUMBER', 'CORE', 'STAFF', 'EMPLOYEE_AND_LEAD', true, 0, 120, 10, true),
  (pg_temp.qid('kpi.days_absent'), 'Days absent without prior information', null,
   'KPI', 'NUMBER', 'CORE', 'STAFF', 'EMPLOYEE_AND_LEAD', true, 0, 60, 20, true),
  (pg_temp.qid('kpi.jobs_handled'), 'Approximate number of jobs or orders you handled', null,
   'KPI', 'NUMBER', 'CORE', 'STAFF', 'EMPLOYEE_AND_LEAD', true, 0, null, 30, true),
  (pg_temp.qid('kpi.delay'), 'Did any job get delayed because of your work?', null,
   'KPI', 'BOOLEAN', 'CORE', 'STAFF', 'EMPLOYEE_AND_LEAD', true, null, null, 40, true),
  (pg_temp.qid('kpi.delay_detail'), 'If yes, what happened and why?', null,
   'KPI', 'TEXT_LONG', 'CORE', 'STAFF', 'EMPLOYEE_AND_LEAD', false, null, null, 50, true),
  (pg_temp.qid('kpi.complaint'), 'Did any customer complaint trace back to your work?', null,
   'KPI', 'BOOLEAN', 'CORE', 'STAFF', 'EMPLOYEE_AND_LEAD', true, null, null, 60, true),
  (pg_temp.qid('kpi.complaint_detail'), 'If yes, what was the complaint and what was done about it?', null,
   'KPI', 'TEXT_LONG', 'CORE', 'STAFF', 'EMPLOYEE_AND_LEAD', false, null, null, 70, true),
  (pg_temp.qid('kpi.loss'), 'Did you cause any material, fabric, paper or ink loss beyond normal?', null,
   'KPI', 'BOOLEAN', 'CORE', 'STAFF', 'EMPLOYEE_AND_LEAD', true, null, null, 80, true),
  (pg_temp.qid('kpi.loss_detail'), 'If yes, please explain', null,
   'KPI', 'TEXT_LONG', 'CORE', 'STAFF', 'EMPLOYEE_AND_LEAD', false, null, null, 90, true),

  /* ---- Section 3 · Core Performance ---- */
  (pg_temp.qid('core.quality'), 'Quality of work',
   'Output is right the first time and needs little correction',
   'CORE_PERFORMANCE', 'SCALE_0_5', 'CORE', 'STAFF', 'EMPLOYEE_AND_LEAD', true, null, null, 10, true),
  (pg_temp.qid('core.speed'), 'Speed and output',
   'Completes the expected volume of work in the time given',
   'CORE_PERFORMANCE', 'SCALE_0_5', 'CORE', 'STAFF', 'EMPLOYEE_AND_LEAD', true, null, null, 20, true),
  (pg_temp.qid('core.knowledge'), 'Knowledge of the job',
   'Understands the material, the machine or the process they work with',
   'CORE_PERFORMANCE', 'SCALE_0_5', 'CORE', 'STAFF', 'EMPLOYEE_AND_LEAD', true, null, null, 30, true),
  (pg_temp.qid('core.process'), 'Following the process',
   'Works to the SOP and the jobcard even when the day is rushed',
   'CORE_PERFORMANCE', 'SCALE_0_5', 'CORE', 'STAFF', 'EMPLOYEE_AND_LEAD', true, null, null, 40, true),
  (pg_temp.qid('core.ownership'), 'Ownership and follow-through',
   'Sees a job to completion without needing reminders',
   'CORE_PERFORMANCE', 'SCALE_0_5', 'CORE', 'STAFF', 'EMPLOYEE_AND_LEAD', true, null, null, 50, true),
  (pg_temp.qid('core.problems'), 'Handling problems',
   'Spots a problem early, solves what they can, escalates the rest in time',
   'CORE_PERFORMANCE', 'SCALE_0_5', 'CORE', 'STAFF', 'EMPLOYEE_AND_LEAD', true, null, null, 60, true),
  (pg_temp.qid('core.material'), 'Care for material and cost',
   'Avoids wastage of fabric, paper, ink, power and time',
   'CORE_PERFORMANCE', 'SCALE_0_5', 'CORE', 'STAFF', 'EMPLOYEE_AND_LEAD', true, null, null, 70, true),
  (pg_temp.qid('core.housekeeping'), 'Housekeeping and safety',
   'Keeps the work area clean and follows safety rules without being told',
   'CORE_PERFORMANCE', 'SCALE_0_5', 'CORE', 'STAFF', 'EMPLOYEE_AND_LEAD', true, null, null, 80, true),

  /* ---- Section 5 · Conduct & Teamwork ---- */
  (pg_temp.qid('beh.punctuality'), 'Punctuality and attendance',
   'Reports on time and informs in advance when unable to come',
   'BEHAVIOURAL', 'SCALE_0_5', 'CORE', 'STAFF', 'EMPLOYEE_AND_LEAD', true, null, null, 10, true),
  (pg_temp.qid('beh.discipline'), 'Discipline and conduct',
   'Follows company rules, dress and conduct expected at the workplace',
   'BEHAVIOURAL', 'SCALE_0_5', 'CORE', 'STAFF', 'EMPLOYEE_AND_LEAD', true, null, null, 20, true),
  (pg_temp.qid('beh.teamwork'), 'Teamwork',
   'Helps colleagues and other departments without being asked',
   'BEHAVIOURAL', 'SCALE_0_5', 'CORE', 'STAFF', 'EMPLOYEE_AND_LEAD', true, null, null, 30, true),
  (pg_temp.qid('beh.communication'), 'Communication',
   'Passes on information clearly and in time, up and down',
   'BEHAVIOURAL', 'SCALE_0_5', 'CORE', 'STAFF', 'EMPLOYEE_AND_LEAD', true, null, null, 40, true),
  (pg_temp.qid('beh.attitude'), 'Attitude and behaviour',
   'Respectful and steady with colleagues, seniors and customers',
   'BEHAVIOURAL', 'SCALE_0_5', 'CORE', 'STAFF', 'EMPLOYEE_AND_LEAD', true, null, null, 50, true),
  (pg_temp.qid('beh.pressure'), 'Handling pressure',
   'Stays reliable during rush periods and delivery pressure',
   'BEHAVIOURAL', 'SCALE_0_5', 'CORE', 'STAFF', 'EMPLOYEE_AND_LEAD', true, null, null, 60, true),
  (pg_temp.qid('beh.honesty'), 'Honesty and reporting mistakes',
   'Reports an error rather than hiding it',
   'BEHAVIOURAL', 'SCALE_0_5', 'CORE', 'STAFF', 'EMPLOYEE_AND_LEAD', true, null, null, 70, true),

  /* ---- Section 6 · Learning & Growth ---- */
  (pg_temp.qid('learn.willingness'), 'Willingness to learn new work', null,
   'LEARNING', 'SCALE_0_5', 'CORE', 'STAFF', 'EMPLOYEE_AND_LEAD', true, null, null, 10, true),
  (pg_temp.qid('learn.multiskill'), 'Ability to work on more than one machine, process or role', null,
   'LEARNING', 'SCALE_0_5', 'CORE', 'STAFF', 'EMPLOYEE_AND_LEAD', true, null, null, 20, true),
  (pg_temp.qid('learn.training_given'), 'Training or guidance given to juniors', null,
   'LEARNING', 'SCALE_0_5', 'CORE', 'STAFF', 'EMPLOYEE_AND_LEAD', true, null, null, 30, true),
  (pg_temp.qid('learn.learned'), 'What new skill or process did you learn this period?', null,
   'LEARNING', 'TEXT_LONG', 'CORE', 'STAFF', 'EMPLOYEE_ONLY', false, null, null, 40, true),
  (pg_temp.qid('learn.next'), 'What would you like to be trained in next?', null,
   'LEARNING', 'TEXT_LONG', 'CORE', 'STAFF', 'EMPLOYEE_ONLY', false, null, null, 50, true),

  /* ---- Section 7 · Your Voice ---- */
  (pg_temp.qid('voice.proud'), 'What are you most proud of in this period?', null,
   'NARRATIVE', 'TEXT_LONG', 'CORE', 'STAFF', 'EMPLOYEE_ONLY', true, null, null, 10, true),
  (pg_temp.qid('voice.difficult'), 'What made your work difficult, and what would have helped?', null,
   'NARRATIVE', 'TEXT_LONG', 'CORE', 'STAFF', 'EMPLOYEE_ONLY', false, null, null, 20, true),
  (pg_temp.qid('voice.idea'), 'Any idea to reduce wastage, rework or time in your area?', null,
   'NARRATIVE', 'TEXT_LONG', 'CORE', 'STAFF', 'EMPLOYEE_ONLY', false, null, null, 30, true),
  (pg_temp.qid('voice.support'), 'What support do you need from management?', null,
   'NARRATIVE', 'TEXT_LONG', 'CORE', 'STAFF', 'EMPLOYEE_ONLY', false, null, null, 40, true),

  /* ---- Section 8 · Manager Review ---- */
  (pg_temp.qid('mgr.overall'), 'Overall performance rating', null,
   'MANAGER_REVIEW', 'SCALE_0_5', 'CORE', 'STAFF', 'LEAD_ONLY', true, null, null, 10, true),
  (pg_temp.qid('mgr.strengths'), 'Main strengths', null,
   'MANAGER_REVIEW', 'TEXT_LONG', 'CORE', 'STAFF', 'LEAD_ONLY', true, null, null, 20, true),
  (pg_temp.qid('mgr.improvement'), 'Areas for improvement', null,
   'MANAGER_REVIEW', 'TEXT_LONG', 'CORE', 'STAFF', 'LEAD_ONLY', true, null, null, 30, true),
  (pg_temp.qid('mgr.training'), 'Training recommended', null,
   'MANAGER_REVIEW', 'TEXT_LONG', 'CORE', 'STAFF', 'LEAD_ONLY', false, null, null, 40, true),
  (pg_temp.qid('mgr.responsibility'), 'Can this person handle more responsibility?', null,
   'MANAGER_REVIEW', 'SINGLE_SELECT', 'CORE', 'STAFF', 'LEAD_ONLY', true, null, null, 50, true),
  (pg_temp.qid('mgr.promotion'), 'Promotion recommendation', null,
   'MANAGER_REVIEW', 'SINGLE_SELECT', 'CORE', 'STAFF', 'LEAD_ONLY', true, null, null, 60, true),
  (pg_temp.qid('mgr.concern'), 'Any concern or risk about this person?', null,
   'MANAGER_REVIEW', 'BOOLEAN', 'CORE', 'STAFF', 'LEAD_ONLY', true, null, null, 70, true),
  (pg_temp.qid('mgr.concern_detail'), 'Please specify the concern', null,
   'MANAGER_REVIEW', 'TEXT_LONG', 'CORE', 'STAFF', 'LEAD_ONLY', false, null, null, 80, true),
  (pg_temp.qid('mgr.final_remarks'), 'Final remarks', null,
   'MANAGER_REVIEW', 'TEXT_LONG', 'CORE', 'STAFF', 'LEAD_ONLY', false, null, null, 90, true)

on conflict (id) do update set
  text = excluded.text, help_text = excluded.help_text, section = excluded.section,
  response_type = excluded.response_type, category = excluded.category,
  answered_by = excluded.answered_by, is_required = excluded.is_required,
  min_value = excluded.min_value, max_value = excluded.max_value,
  sort_order = excluded.sort_order, is_active = true;


/* ---------- 4. Options for the two SINGLE_SELECTs ---------- */

insert into public.question_options (question_id, label, value, sort_order) values
  (pg_temp.qid('mgr.responsibility'), 'Yes',                    'YES',                   10),
  (pg_temp.qid('mgr.responsibility'), 'Not yet',                'NOT_YET',               20),
  (pg_temp.qid('mgr.responsibility'), 'Needs training first',   'NEEDS_TRAINING_FIRST',  30),
  (pg_temp.qid('mgr.promotion'),      'Yes',                    'YES',                   10),
  (pg_temp.qid('mgr.promotion'),      'No',                     'NO',                    20),
  (pg_temp.qid('mgr.promotion'),      'Can be considered',      'CAN_BE_CONSIDERED',     30)
on conflict do nothing;


/* ---------- 5. Conditionals ---------- */
--
-- Blueprint step 3. Each detail question hangs off the BOOLEAN immediately
-- before it. §6's rule: a hidden question is neither validated nor stored, so
-- an employee who answers No never has to look at the follow-up.
--
-- Note: the blueprint's counts table says "9 (4 conditional)" for Work Output
-- while the section itself lists three (Q5, Q7, Q9). Three is what the questions
-- describe, and three is what is wired here.

update public.questions set depends_on = pg_temp.qid('kpi.delay'),     depends_value = 'true'
  where id = pg_temp.qid('kpi.delay_detail');
update public.questions set depends_on = pg_temp.qid('kpi.complaint'), depends_value = 'true'
  where id = pg_temp.qid('kpi.complaint_detail');
update public.questions set depends_on = pg_temp.qid('kpi.loss'),      depends_value = 'true'
  where id = pg_temp.qid('kpi.loss_detail');
update public.questions set depends_on = pg_temp.qid('mgr.concern'),   depends_value = 'true'
  where id = pg_temp.qid('mgr.concern_detail');


/* ---------- 6. Job Specific Skills ---------- */
--
-- category DEPARTMENT and section DEPARTMENT_SPECIFIC, mapped to exactly one
-- department each. This is the only section that varies by department (§1), and
-- the mapping table is what makes that true.

create or replace function pg_temp.seed_jss(
  p_code text, p_key_prefix text, p_questions text[]
) returns void language plpgsql as $$
declare
  v_dept uuid;
  v_text text;
  v_i    integer := 0;
  v_id   uuid;
begin
  select id into v_dept from public.departments where code = p_code;
  if v_dept is null then return; end if;

  foreach v_text in array p_questions loop
    v_i := v_i + 1;
    v_id := pg_temp.qid(p_key_prefix || '.' || v_i);

    insert into public.questions
      (id, text, help_text, section, response_type, category, track, answered_by,
       is_required, sort_order, is_active)
    values
      (v_id, v_text, null, 'DEPARTMENT_SPECIFIC', 'SCALE_0_5', 'DEPARTMENT', 'STAFF',
       'EMPLOYEE_AND_LEAD', true, v_i * 10, true)
    on conflict (id) do update set
      text = excluded.text, section = excluded.section,
      response_type = excluded.response_type, category = excluded.category,
      answered_by = excluded.answered_by, sort_order = excluded.sort_order,
      is_active = true;

    insert into public.department_questions (department_id, question_id, sort_order)
    values (v_dept, v_id, v_i * 10)
    on conflict (department_id, question_id) do update set sort_order = excluded.sort_order;
  end loop;
end;
$$;

select pg_temp.seed_jss('DESIGN', 'jss.design', array[
  'Design turnaround against the brief deadline',
  'Originality and trend relevance of concepts',
  'Colour accuracy — Pantone and ICC matching against the approved shade',
  'Repeat setup correctness for the ordered width (36" / 58" / 64" / 72")',
  'File discipline and version control in the LINKD Design Repository',
  'Handling revision rounds without quality dropping',
  'Command over the design software used (Illustrator, Photoshop, CorelDRAW, CLO3D)'
]);

select pg_temp.seed_jss('MDO', 'jss.mdo', array[
  'Extracts the correct design and the correct version before setup',
  'Print alignment and registration accuracy',
  'Repeat and width setup accuracy against the jobcard',
  'Paper and ink wastage control',
  'Machine setup time between jobs',
  'Accuracy of jobcard and production challan entries',
  'Raises a doubt about a file before printing rather than after'
]);

select pg_temp.seed_jss('FUSING', 'jss.fusing', array[
  'Holds the correct temperature and pressure settings for the substrate',
  'Transfer quality stays consistent from the start of a roll to the end',
  'Balances machine speed against print quality',
  'Machine cleanliness and daily preventive care',
  'Handles fabric without creases, marks or edge damage'
]);

select pg_temp.seed_jss('KATA', 'jss.kata', array[
  'Measurement accuracy within the ±1 mm per metre tolerance',
  'Catches defects before dispatch rather than after a customer complains',
  'Defect photography and report completeness',
  'Shade continuity card discipline for repeat designs and customers',
  'Holds a roll and escalates when in doubt, instead of letting it pass',
  'Zero-tolerance discipline on stains, holes, streaks and misprints'
]);

select pg_temp.seed_jss('STORES', 'jss.stores', array[
  'Challan verification accuracy — lump count, meters, condition, labels',
  'Stock entry accuracy in IMS — type, GSM, width, meters, client',
  'Physical stock matches system stock on audit',
  'Material issue discipline and traceability to the right job',
  'Warehouse housekeeping, stacking and protection of goods'
]);

select pg_temp.seed_jss('DISPATCH', 'jss.dispatch', array[
  'Rolling and packing quality',
  'Right goods to the right client — dispatch error rate',
  'Invoice, delivery challan and POD completeness',
  'Dispatch on the promised date',
  'Coordination with transporters and follow-up on signed PODs'
]);

select pg_temp.seed_jss('SALESCS', 'jss.salescs', array[
  'Converting enquiries into confirmed orders',
  'Accuracy of order details captured — design, quantity, width, GSM, rate',
  'Follow-up discipline and keeping the customer updated on job status',
  'Payment follow-up and control of outstanding',
  'Handling complaints and shade issues with the customer',
  'Developing new accounts rather than only servicing existing ones'
]);

select pg_temp.seed_jss('MISSYS', 'jss.missys', array[
  'Turnaround on issues raised by users',
  'Accuracy and timeliness of reports',
  'Data integrity across SAB, the ERP and working sheets',
  'Documents what was built so someone else can maintain it',
  'Trains users instead of only fixing things for them'
]);

select pg_temp.seed_jss('ACCTS', 'jss.accts', array[
  'Accuracy of billing and GST invoices',
  'Reconciliation discipline — bank, customer and vendor',
  'Timeliness of statutory payments and filings',
  'Support to sales on outstanding recovery',
  'Documentation kept audit-ready through the year'
]);

select pg_temp.seed_jss('HRADMIN', 'jss.hradmin', array[
  'Attendance and payroll accuracy',
  'Recruitment turnaround for open positions',
  'Handling worker grievances fairly and quickly',
  'Statutory records and compliance upkeep',
  'Facility, canteen and housekeeping standards'
]);
