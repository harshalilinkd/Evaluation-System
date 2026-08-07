-- 0030_increment.sql
-- Salary review, MD approval and the interview record (P21).
--
-- The brief names this 0017_increment.sql. 0017 is `0017_reseed_questions.sql`
-- and is applied, so §0.8 makes it 0030 — the same call as 0010, 0021, 0022,
-- 0023, 0028 and 0029.
--
-- EVERY NUMBER HERE IS SOMEBODY'S PAY. Two rules follow from that and shape the
-- whole file:
--
--   1. The confirmation is ONE transaction. It writes six things — the review
--      row, two status transitions, a salary_history row, the employment record
--      and the reminder — and a partially applied increment is a payroll
--      incident, not a bug report.
--   2. No figure is computed here that is also computed in TypeScript. The hike
--      percent arrives already calculated by `lib/increment/calc.ts` and is
--      STORED. A second implementation in SQL would eventually disagree with
--      the first about a number somebody is paid.
--
-- SAFE TO RE-RUN.

begin;

/* ============================================================================
   1. increment_reviews
   ========================================================================== */

create table if not exists public.increment_reviews (
  evaluation_id                uuid primary key
                                 references public.evaluations(id) on delete cascade,

  -- Copied from employment_records at the moment HR opens the review, so the
  -- decision is anchored to what the record said THEN. Reading it live would
  -- mean a correction to somebody's salary silently re-bases a proposal that
  -- has already been argued for.
  joining_ctc                  numeric(12, 2),
  current_ctc                  numeric(12, 2) not null,
  months_since_last_increment  int,

  -- The employee's own words. §5 keeps it to HR and the MD; the HOD never sees
  -- it, and it never reaches the combined report's non-salary bands.
  employee_expectation_ctc     numeric(12, 2),
  employee_expectation_note    text,

  hr_proposed_ctc              numeric(12, 2),
  hr_proposed_hike_pct         numeric(6, 2),
  hr_justification             text,

  md_approved_ctc              numeric(12, 2),
  md_approved_hike_pct         numeric(6, 2),
  md_remarks                   text,

  interview_date               date,
  interview_attendees          text,
  interview_notes              text,

  final_ctc                    numeric(12, 2),
  final_hike_pct               numeric(6, 2),
  effective_from               date,

  status                       text not null default 'DRAFT',

  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now()
);

alter table public.increment_reviews drop constraint if exists increment_reviews_status_valid;
alter table public.increment_reviews add constraint increment_reviews_status_valid
  check (status in ('DRAFT', 'HR_PROPOSED', 'MD_APPROVED', 'INTERVIEW_DONE', 'FINAL'));

-- A current CTC of zero would make every percent a division by zero. Refusing it
-- at the boundary means the screen never has to render an Infinity.
alter table public.increment_reviews drop constraint if exists increment_reviews_current_positive;
alter table public.increment_reviews add constraint increment_reviews_current_positive
  check (current_ctc > 0);

drop trigger if exists increment_reviews_set_updated_at on public.increment_reviews;
create trigger increment_reviews_set_updated_at
  before update on public.increment_reviews
  for each row execute function public.set_updated_at();

/* ---------- The column-level split ---------- */
--
-- Same reasoning as 0029's: §9 gives HR the proposal and the MD the approval,
-- RLS is row-level and cannot say which columns, and an MD who can rewrite HR's
-- justification is not a second pair of eyes. The interview columns are
-- deliberately writable by BOTH — §8 gives that transition to HR or the MD, and
-- the interview is a conversation they hold together.

create or replace function public.increment_reviews_guard_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if public.is_hr() then
    -- HR may not award themselves the MD's approval.
    if new.md_approved_ctc      is distinct from old.md_approved_ctc
       or new.md_approved_hike_pct is distinct from old.md_approved_hike_pct
       or new.md_remarks           is distinct from old.md_remarks then
      raise exception
        'The approved figure is the MD''s to set. HR proposes; the MD approves.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if public.is_md() then
    if new.hr_proposed_ctc       is distinct from old.hr_proposed_ctc
       or new.hr_proposed_hike_pct is distinct from old.hr_proposed_hike_pct
       or new.hr_justification     is distinct from old.hr_justification
       or new.employee_expectation_ctc  is distinct from old.employee_expectation_ctc
       or new.employee_expectation_note is distinct from old.employee_expectation_note then
      raise exception
        'HR''s proposal and the employee''s expectation are not the MD''s to edit.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  /* -- The evaluatee, setting their OWN expectation and nothing else.
        `record_salary_expectation` is SECURITY DEFINER, but a definer function
        does not change `auth.uid()` — so without this branch the function is
        blocked by its own guard, and the employee's answer never leaves the
        answers blob. The exemption is written as narrowly as it can be: every
        other column must be unchanged, so this cannot become a way for somebody
        to edit their own proposal. They still have no SELECT policy, so they
        can write this and never read it back. -- */
  if exists (
    select 1 from public.evaluations e
     where e.id = new.evaluation_id
       and e.evaluatee_id = (select auth.uid())
  ) then
    if new.joining_ctc            is distinct from old.joining_ctc
       or new.current_ctc                 is distinct from old.current_ctc
       or new.months_since_last_increment is distinct from old.months_since_last_increment
       or new.hr_proposed_ctc             is distinct from old.hr_proposed_ctc
       or new.hr_proposed_hike_pct        is distinct from old.hr_proposed_hike_pct
       or new.hr_justification            is distinct from old.hr_justification
       or new.md_approved_ctc             is distinct from old.md_approved_ctc
       or new.md_approved_hike_pct        is distinct from old.md_approved_hike_pct
       or new.md_remarks                  is distinct from old.md_remarks
       or new.interview_date              is distinct from old.interview_date
       or new.interview_attendees         is distinct from old.interview_attendees
       or new.interview_notes             is distinct from old.interview_notes
       or new.final_ctc                   is distinct from old.final_ctc
       or new.final_hike_pct              is distinct from old.final_hike_pct
       or new.effective_from              is distinct from old.effective_from
       or new.status                      is distinct from old.status then
      raise exception 'You may record your own salary expectation and nothing else.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  raise exception 'Only HR and the MD may write a salary review.'
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists increment_reviews_guard_columns on public.increment_reviews;
create trigger increment_reviews_guard_columns
  before update on public.increment_reviews
  for each row execute function public.increment_reviews_guard_columns();

/* ---------- RLS ---------- */

alter table public.increment_reviews enable row level security;

drop policy if exists "increments: hr reads" on public.increment_reviews;
create policy "increments: hr reads" on public.increment_reviews
  for select to authenticated using (public.is_hr());

drop policy if exists "increments: md reads" on public.increment_reviews;
create policy "increments: md reads" on public.increment_reviews
  for select to authenticated using (public.is_md());

drop policy if exists "increments: hr inserts" on public.increment_reviews;
create policy "increments: hr inserts" on public.increment_reviews
  for insert to authenticated with check (public.is_hr());

drop policy if exists "increments: hr updates" on public.increment_reviews;
create policy "increments: hr updates" on public.increment_reviews
  for update to authenticated using (public.is_hr()) with check (public.is_hr());

drop policy if exists "increments: md updates" on public.increment_reviews;
create policy "increments: md updates" on public.increment_reviews
  for update to authenticated using (public.is_md()) with check (public.is_md());

-- No DELETE policy for anyone. A pay decision that can be made to have never
-- happened is not a record (§12).

grant select, insert, update on public.increment_reviews to authenticated;

comment on table public.increment_reviews is
  'The salary review for one increment-cycle evaluation (P21). HR proposes, the MD approves, both record the interview — split by a BEFORE UPDATE trigger, because RLS is row-level. Readable by HR and the MD alone, at every status (§5).';

/* ============================================================================
   2. The quick-set hike bands — configurable, not hardcoded
   ========================================================================== */
--
-- The brief asks for three quick-set buttons "configurable in settings rather
-- than hardcoded". A single-row table, the P17-6 idiom: the CHECK on a boolean
-- primary key is what keeps it single-row, so no query has to decide which row
-- is current.

create table if not exists public.increment_settings (
  id          boolean primary key default true check (id),
  -- Percentages. Stored as an array rather than three columns so adding a
  -- fourth band is data, not a migration.
  hike_bands  numeric(6, 2)[] not null default array[5, 10, 15]::numeric(6,2)[],
  updated_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now()
);

insert into public.increment_settings (id) values (true) on conflict (id) do nothing;

alter table public.increment_settings enable row level security;

drop policy if exists "increment settings: admins read" on public.increment_settings;
create policy "increment settings: admins read" on public.increment_settings
  for select to authenticated using (public.is_hr() or public.is_md());

drop policy if exists "increment settings: hr writes" on public.increment_settings;
create policy "increment settings: hr writes" on public.increment_settings
  for update to authenticated using (public.is_hr()) with check (public.is_hr());

grant select, update on public.increment_settings to authenticated;

/* ============================================================================
   3. The employee's expectation
   ========================================================================== */
--
-- 0022 already seeded ONE expectation question, and it asks for a **monthly**
-- figure: "What monthly salary would you consider fair for the coming year?"
--
-- P21's column is `employee_expectation_ctc` — an annual CTC, compared directly
-- against `current_ctc` and HR's proposal. Copying a monthly answer into it
-- would be wrong by a factor of twelve, in a figure that feeds a pay decision.
-- That is not a wording quibble; it is the exact class of error this phase is
-- written to prevent.
--
-- So the monthly question is RETIRED, not renamed and not deleted (§17, and the
-- pattern P8P-3 and 0017 both used), and the brief's two questions are seeded
-- alongside it. Retiring leaves every launched snapshot untouched: an increment
-- cycle frozen before today keeps asking the monthly question, and the copy
-- step below is keyed to the NEW id, so an old answer never reaches the annual
-- column at all.

update public.questions
   set is_active = false
 where id = md5('linkd.q.salary_expectation')::uuid
   and is_active;

insert into public.questions
  (id, text, help_text, section, response_type, category, track, answered_by,
   is_required, sort_order, cycle_scope, is_active)
values
  (
    md5('linkd.q.salary_expectation_annual')::uuid,
    'What salary would you consider fair for the year ahead?',
    'This is your expectation, not a promise. It is one input among several and it goes only to HR and management.',
    'NARRATIVE', 'NUMBER', 'CORE', 'STAFF', 'EMPLOYEE_ONLY',
    false, 910, 'INCREMENT_ONLY', true
  ),
  (
    md5('linkd.q.salary_expectation_why')::uuid,
    'Why do you feel that is fair?',
    null,
    'NARRATIVE', 'TEXT_LONG', 'CORE', 'STAFF', 'EMPLOYEE_ONLY',
    false, 920, 'INCREMENT_ONLY', true
  )
on conflict (id) do update set
  text        = excluded.text,
  help_text   = excluded.help_text,
  cycle_scope = 'INCREMENT_ONLY',
  answered_by = 'EMPLOYEE_ONLY',
  is_required = false,
  is_active   = true;

-- §12: retiring a question is a question-bank edit and is recorded.
insert into public.audit_log (actor_id, entity, entity_id, action, diff)
select null, 'question', md5('linkd.q.salary_expectation')::uuid,
       'question.retired_monthly_expectation',
       jsonb_build_object(
         'why', 'P21 stores an annual CTC; the monthly wording would be wrong by 12x',
         'replaced_by', md5('linkd.q.salary_expectation_annual')::uuid)
where not exists (
  select 1 from public.audit_log
   where action = 'question.retired_monthly_expectation'
);

/* ============================================================================
   3b. Copying the expectation out of the answers blob
   ========================================================================== */
--
-- The brief: "On submission, copy the number into
-- increment_reviews.employee_expectation_ctc so the salary screen has it
-- without reading the answers blob."
--
-- It has to be a SECURITY DEFINER function because the employee — who is the
-- one submitting — has no read or write on `increment_reviews` at all, and must
-- not gain one. This writes exactly two columns and nothing else.
--
-- `current_ctc` is NOT NULL, so a review row cannot be created before there is
-- a salary on record. When there is none the function stores nothing and
-- returns false; HR cannot propose without one either (the band blocks), and
-- `saveProposal` calls this again once the row exists. So the expectation lands
-- either at submission or at the first proposal, and never silently vanishes.

create or replace function public.record_salary_expectation(p_evaluation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor    uuid := (select auth.uid());
  v_eval     public.evaluations%rowtype;
  v_answers  jsonb;
  v_amount   numeric(12, 2);
  v_note     text;
  v_current  numeric(12, 2);
begin
  select * into v_eval from public.evaluations where id = p_evaluation_id;
  if not found then
    return false;
  end if;

  -- The evaluatee copying their own answer, or an administrator picking it up
  -- later. Nobody else — a lead must never touch this figure (§5).
  if v_actor is not null
     and v_actor <> v_eval.evaluatee_id
     and not (public.is_hr() or public.is_md()) then
    raise exception 'Only the employee or an administrator may record this.'
      using errcode = 'insufficient_privilege';
  end if;

  select r.answers into v_answers
    from public.evaluation_responses r
   where r.evaluation_id = p_evaluation_id and r.layer = 'SELF';

  if v_answers is null then
    return false;
  end if;

  -- Keyed to the ANNUAL question's id. 0022's monthly question is retired above,
  -- and an answer to it must never reach this column — it would be wrong by a
  -- factor of twelve.
  v_amount := nullif(v_answers ->> md5('linkd.q.salary_expectation_annual')::uuid::text, '')::numeric;
  v_note   := nullif(v_answers ->> md5('linkd.q.salary_expectation_why')::uuid::text, '');

  if v_amount is null and v_note is null then
    return false;
  end if;

  update public.increment_reviews
     set employee_expectation_ctc  = coalesce(v_amount, employee_expectation_ctc),
         employee_expectation_note = coalesce(v_note, employee_expectation_note)
   where evaluation_id = p_evaluation_id;

  if found then
    return true;
  end if;

  select e.current_ctc into v_current
    from public.employment_records e
   where e.profile_id = v_eval.evaluatee_id;

  if v_current is null or v_current <= 0 then
    -- Nothing to anchor a review row to yet. Not an error: HR is blocked from
    -- proposing for the same reason, and this runs again when they can.
    return false;
  end if;

  insert into public.increment_reviews
    (evaluation_id, current_ctc, employee_expectation_ctc, employee_expectation_note)
  values (p_evaluation_id, v_current, v_amount, v_note)
  on conflict (evaluation_id) do update
    set employee_expectation_ctc  = coalesce(excluded.employee_expectation_ctc,
                                             public.increment_reviews.employee_expectation_ctc),
        employee_expectation_note = coalesce(excluded.employee_expectation_note,
                                             public.increment_reviews.employee_expectation_note);
  return true;
end;
$$;

revoke all on function public.record_salary_expectation(uuid) from public;
grant execute on function public.record_salary_expectation(uuid) to authenticated;

comment on function public.record_salary_expectation(uuid) is
  'Copies the employee''s salary expectation out of the SELF answers into increment_reviews (P21). SECURITY DEFINER because the employee has no access to that table and must not gain one; it writes exactly two columns. Keyed to the ANNUAL question id — 0022''s retired monthly question must never reach this column.';

/* ============================================================================
   4. Confirming the increment — one transaction, or none of it
   ========================================================================== */
--
-- Six writes. Every figure arrives already computed by `lib/increment/calc.ts`
-- and is stored; nothing is recalculated here, so there is exactly one
-- implementation of "what is a hike percent" in the system.
--
-- SECURITY DEFINER because it writes `salary_history` and `employment_records`
-- on behalf of a caller whose own policies would allow it anyway — the reason
-- for the definer is the two `apply_evaluation_transition` calls, which need the
-- transaction-local window 0005 opens. The role is re-checked inside.

create or replace function public.confirm_increment(
  p_evaluation_id       uuid,
  p_final_ctc           numeric,
  p_final_hike_pct      numeric,
  p_effective_from      date,
  p_interview_date      date,
  p_interview_attendees text,
  p_interview_notes     text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor      uuid := (select auth.uid());
  v_review     public.increment_reviews%rowtype;
  v_eval       public.evaluations%rowtype;
  v_previous   numeric(12, 2);
  v_hike       numeric(12, 2);
  v_salary_id  uuid;
begin
  -- §8 gives MD_REVIEWED -> INTERVIEW_DONE to HR or the MD, and this is that
  -- move plus its consequences.
  if v_actor is not null and not (public.is_hr() or public.is_md()) then
    raise exception 'Only HR and the MD may confirm an increment.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_eval from public.evaluations
   where id = p_evaluation_id for update;
  if not found then
    raise exception 'No evaluation with id %.', p_evaluation_id using errcode = 'no_data_found';
  end if;

  select * into v_review from public.increment_reviews
   where evaluation_id = p_evaluation_id for update;
  if not found then
    raise exception 'There is no salary review on this evaluation.'
      using errcode = 'no_data_found';
  end if;

  /* -- No increment without an MD approval. The brief forbids it and §9 is the
        reason: HR proposes, the MD approves, and that separation only exists if
        the confirmation checks it. -- */
  if v_review.md_approved_ctc is null then
    raise exception 'This increment has not been approved by the MD yet.'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_final_ctc is null or p_final_ctc <= 0 then
    raise exception 'A final salary is required, and it must be more than zero.'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_effective_from is null then
    raise exception 'An effective-from date is required.'
      using errcode = 'invalid_parameter_value';
  end if;

  v_previous := v_review.current_ctc;
  v_hike     := p_final_ctc - v_previous;

  /* -- 1. The review row. -- */
  update public.increment_reviews
     set final_ctc           = p_final_ctc,
         final_hike_pct      = p_final_hike_pct,
         effective_from      = p_effective_from,
         interview_date      = coalesce(p_interview_date, current_date),
         interview_attendees = p_interview_attendees,
         interview_notes     = p_interview_notes,
         status              = 'FINAL'
   where evaluation_id = p_evaluation_id;

  /* -- 2. MD_REVIEWED -> INTERVIEW_DONE, through §8's function. Never a direct
        UPDATE: the status column is only writable inside the window that
        function opens (P5-2). -- */
  perform public.apply_evaluation_transition(
    p_evaluation_id := p_evaluation_id,
    p_from_status   := 'MD_REVIEWED'::public.evaluation_status,
    p_to_status     := 'INTERVIEW_DONE'::public.evaluation_status,
    p_actor_id      := v_actor,
    p_action        := 'evaluation.interview_done',
    p_diff          := jsonb_build_object(
                         'interview_date', coalesce(p_interview_date, current_date),
                         'effective_from', p_effective_from));

  /* -- 3. The pay record. §17: a salary change is written to salary_history and
        nowhere else, and the table has no UPDATE path for anybody (P19-3). -- */
  insert into public.salary_history (
    profile_id, effective_from, previous_ctc, new_ctc,
    hike_amount, hike_pct, reason, evaluation_id, recorded_by, note
  )
  values (
    v_eval.evaluatee_id, p_effective_from, v_previous, p_final_ctc,
    v_hike, p_final_hike_pct, 'ANNUAL_INCREMENT', p_evaluation_id, v_actor,
    'Confirmed at the increment interview.')
  returning id into v_salary_id;

  /* -- 4. The employment record. `last_increment_date` moving is what makes the
        P19 trigger recalculate `next_increment_date` — the rule stays in one
        function rather than being restated here. -- */
  update public.employment_records
     set current_ctc           = p_final_ctc,
         salary_effective_from = p_effective_from,
         last_increment_date   = p_effective_from
   where profile_id = v_eval.evaluatee_id;

  /* -- 5. The reminder that started this. ACTIONED, not deleted: it is the
        record that HR was told and did something (P19-6). -- */
  update public.increment_reminders
     set status = 'ACTIONED', sent_at = coalesce(sent_at, now())
   where profile_id = v_eval.evaluatee_id
     and status in ('PENDING', 'SENT');

  /* -- 6. INTERVIEW_DONE -> CLOSED. -- */
  perform public.apply_evaluation_transition(
    p_evaluation_id := p_evaluation_id,
    p_from_status   := 'INTERVIEW_DONE'::public.evaluation_status,
    p_to_status     := 'CLOSED'::public.evaluation_status,
    p_actor_id      := v_actor,
    p_action        := 'evaluation.closed_after_interview',
    p_diff          := jsonb_build_object('effective_from', p_effective_from));

  /* -- 7. The salary movement itself, audited — WITHOUT the figures. §5 keeps
        them to HR and the MD, and 0013 lets a lead read audit_log for their own
        reports, so a CTC here would walk straight past it (P19-10). The row id
        is enough to find the record for anybody entitled to read it. -- */
  insert into public.audit_log (actor_id, entity, entity_id, action, diff)
  values (
    v_actor, 'evaluation', p_evaluation_id, 'increment.confirmed',
    jsonb_build_object(
      'salary_history_id', v_salary_id,
      'effective_from', p_effective_from,
      'recorded', true));

  return jsonb_build_object(
    'salary_history_id', v_salary_id,
    'effective_from', p_effective_from);
end;
$$;

revoke all on function public.confirm_increment(uuid, numeric, numeric, date, date, text, text) from public;
grant execute on function public.confirm_increment(uuid, numeric, numeric, date, date, text, text) to authenticated;

comment on function public.confirm_increment(uuid, numeric, numeric, date, date, text, text) is
  'Confirms an increment: review row, both §8 transitions, the salary_history append, the employment record, the reminder and the audit — all in ONE transaction. A partially applied increment is a payroll incident. Every figure arrives pre-computed by lib/increment/calc.ts and is stored, never recalculated here.';

commit;
