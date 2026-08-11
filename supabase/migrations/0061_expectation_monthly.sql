-- 0061: the employee is asked for a MONTHLY salary, and it is banked as annual.
--
-- Phase 1 of the increment overhaul, at the owner's explicit instruction:
-- "the expected salary metric is shifting from annual CTC to monthly."
--
-- ============================================================================
-- WHY THE STORED COLUMN STAYS ANNUAL, AND WHY THAT IS NOT A FUDGE
--
-- There are five independent salary stores in this system — employment_records,
-- salary_history, increment_reviews, worker_evaluation_decisions and the legacy
-- evaluation_decisions — and NOT ONE of them records a unit. In sixty
-- migrations there is no `salary_unit` column, no `is_monthly`, no CHECK on
-- ('ANNUAL','MONTHLY'). The annual-ness of every figure lives in comments,
-- question text and variable names. So the unit is not data, and it cannot be
-- migrated — only reinterpreted.
--
-- Rescaling the stored rows is not merely risky, it is BLOCKED.
-- `salary_history_is_append_only()` (0023) raises unconditionally on UPDATE and
-- DELETE for every caller — including a superuser, including a migration.
-- P19-3 built it that way on purpose: "a trigger holds for every caller." A
-- divide-by-twelve would have to drop the one guard the pay record's
-- evidentiary value rests on, and then rewrite the employee's own submitted
-- answer inside `evaluation_responses.answers` as well, because the raw number
-- they typed is banked there too.
--
-- So: MONTHLY AT THE EDGES, ANNUAL IN THE CORE. The employee types a monthly
-- figure, this function multiplies it by twelve on the way in, and every
-- comparison downstream is between two annual numbers as it always was. No row
-- is rewritten, no guard is dropped, and no historical figure changes meaning.
--
-- THE BUG THIS FIXES. `expectationGap` (lib/increment/calc.ts) divides the
-- proposal by the expectation with no unit check. An employee typing a monthly
-- 30,000 into a field the code read as annual produced, against a proposal of
-- ₹2,50,000, the reported "733.33% above their figure" — a precise, plausible,
-- entirely wrong number with nothing to flag it. The hint added by 0055 asked
-- people not to make that mistake; this makes it impossible to make.
-- ============================================================================

begin;

/* ---------- 1 · The question ---------- */

-- §0.2 freezes a question's id, never its wording, and 0055 reworded this same
-- row in the other direction. The id stays `salary_expectation_annual`: it is
-- referenced by 0052's lookup and is frozen into every launched snapshot, so
-- renaming it would orphan every evaluation already asking it (§5).
update public.questions
   set text =
         'What monthly salary would you consider fair for the year ahead?',
       help_text =
         'Your monthly figure, not your annual package — for example 30,000 rather than '
         || '3,60,000. This is your expectation, not a promise. It is one input among '
         || 'several and it goes only to HR and management.'
 where id = md5('linkd.q.salary_expectation_annual')::uuid;

do $$
begin
  if not found then
    raise notice '0061: the salary question was not present — nothing to reword.';
  end if;
end;
$$;

/* ---------- 2 · The copy, which now converts ---------- */

-- Rewritten rather than patched by regex. The body changes in three places and
-- 0056 is the standing lesson about a patch that reports success having matched
-- the wrong thing — a full replacement cannot half-apply.
create or replace function public.record_salary_expectation(p_evaluation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_answers  jsonb;
  v_qid      uuid;
  v_monthly  uuid := md5('linkd.q.salary_expectation_monthly')::uuid;
  v_amount   numeric;
  v_note     text;
  v_current  numeric;
begin
  select r.answers into v_answers
    from public.evaluation_responses r
   where r.evaluation_id = p_evaluation_id and r.layer = 'SELF';

  if v_answers is null then
    return false;
  end if;

  /* -- 1. The seeded question, by id. -- */
  v_qid  := md5('linkd.q.salary_expectation_annual')::uuid;
  v_amount := nullif(v_answers ->> v_qid::text, '')::numeric;

  /* -- 2. Otherwise whatever NUMBER question this evaluation actually asked.
        THE `!~* 'month'` FILTER IS GONE, and its removal is the point of this
        block. 0052 added it to keep an annual column away from a question
        asking per month — correct then, and exactly backwards now that the
        question asks per month by design. It would have excluded the only
        question we are looking for.

        The retired 0022 question is still excluded by id: it asked for a
        monthly figure and was never converted, so its answers cannot be
        multiplied by twelve without inventing a raise. -- */
  if v_amount is null then
    select q.question_id into v_qid
      from public.evaluation_questions q
     where q.evaluation_id = p_evaluation_id
       and q.response_type = 'NUMBER'
       and q.question_id <> v_monthly
       and q.text ~* '(salary|ctc|pay|compensation)'
     order by q.sort_order
     limit 1;

    if v_qid is not null then
      v_amount := nullif(v_answers ->> v_qid::text, '')::numeric;
    end if;
  end if;

  /* -- 3. MONTHLY IN, ANNUAL OUT. The single conversion in the whole path.
        Guarded on a positive figure so a 0 or a stray negative is left null
        rather than banked as a salary — §11's rule that missing is not zero,
        applied to money. -- */
  if v_amount is not null and v_amount > 0 then
    v_amount := round(v_amount * 12, 2);
  else
    v_amount := null;
  end if;

  /* -- The note, unchanged. -- */
  v_note := nullif(v_answers ->> md5('linkd.q.salary_expectation_why')::uuid::text, '');

  if v_note is null then
    select nullif(v_answers ->> q.question_id::text, '') into v_note
      from public.evaluation_questions q
     where q.evaluation_id = p_evaluation_id
       and q.response_type = 'TEXT_LONG'
       and q.text ~* '(fair|expectation)'
     order by q.sort_order
     limit 1;
  end if;

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

  /* -- No review row yet. `current_ctc` is NOT NULL on that table, so one
        cannot be created before the person has a salary on record — the row is
        created later, at HR's first proposal, and this runs again then. -- */
  select e.current_ctc into v_current
    from public.employment_records e
    join public.evaluations ev on ev.evaluatee_id = e.profile_id
   where ev.id = p_evaluation_id;

  if v_current is null or v_current <= 0 then
    return false;
  end if;

  insert into public.increment_reviews
    (evaluation_id, current_ctc, employee_expectation_ctc, employee_expectation_note)
  values
    (p_evaluation_id, v_current, v_amount, v_note)
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
grant execute on function public.record_salary_expectation(uuid) to service_role;

/* ---------- 3 · Audit ---------- */

-- §12. A change to what a question MEANS is worth a row: an answer of "30000"
-- banked before this migration means ₹30,000 a year and after it ₹3,60,000.
-- Anybody reconciling a figure across that boundary needs to find this.
insert into public.audit_log (actor_id, entity, entity_id, action, diff)
values (
  null,
  'question',
  md5('linkd.q.salary_expectation_annual')::uuid,
  'question.unit_changed',
  jsonb_build_object(
    'from', 'annual',
    'to',   'monthly, multiplied by 12 on save',
    'why',  'Owner instruction: the expected salary metric moves to monthly.',
    'note', 'Stored column remains annual. Answers recorded BEFORE this migration are raw annual figures; answers after it are monthly and are banked as annual.'
  )
);

commit;

/* ============================================================================
   Confirm
   ========================================================================== */

select
  (select text from public.questions
    where id = md5('linkd.q.salary_expectation_annual')::uuid)          as question_now,
  (select text ~* 'monthly' from public.questions
    where id = md5('linkd.q.salary_expectation_annual')::uuid)          as asks_monthly,
  (select pg_get_functiondef(p.oid) like '%v_amount * 12%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_salary_expectation') as converts_on_save,
  (select pg_get_functiondef(p.oid) not like '%!~* ''month''%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_salary_expectation') as monthly_filter_removed;
