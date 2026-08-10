-- 0052 — the salary expectation is found in the evaluation's own snapshot.
--
-- THE BUG. An employee answered "What salary would you consider fair for the
-- year ahead?" with 25000 and the report read "Not stated."
--
-- `record_salary_expectation` reads the answers blob at ONE hard-coded key:
--
--     v_answers ->> md5('linkd.q.salary_expectation_annual')::uuid::text
--
-- That is the id 0030 seeded, and it is right whenever the form carries 0030's
-- question. It is wrong the moment it does not — and there are three ordinary
-- ways for that to happen, none of them a mistake:
--
--   · HR authored their own salary question in the form builder, which gets a
--     random uuid (P8). The form looks identical and the key does not match.
--   · The cycle was launched BEFORE 0030 and froze 0022's monthly question,
--     whose id is `linkd.q.salary_expectation` — deliberately excluded here,
--     because copying a monthly answer into an annual column is wrong by a
--     factor of twelve (P21-1).
--   · The question was retired and reseeded at some point in between.
--
-- In every case the function returned false and said nothing, so the figure sat
-- in the answers blob with no way to know it had not been lifted out.
--
-- THE FIX: look the question up in `evaluation_questions` — the FROZEN list for
-- this evaluation — rather than assuming an id. That is the authoritative
-- record of what this person was actually asked (§5), and it carries the
-- response_type and the text needed to identify the question without either
-- being a guess about the bank's current state.
--
-- ORDER MATTERS AND IS DELIBERATE:
--   1. 0030's id, exactly. Unambiguous, and the common case.
--   2. Otherwise, a NUMBER question in the snapshot whose text reads as a
--      salary expectation. Text-matching is a fallback, never the primary —
--      P20-5 rejected it as a primary key for exactly the right reason, that
--      §5 freezes the text and a reword would break it. As a fallback it costs
--      nothing: if it matches nothing, we are no worse off than before.
--
-- 0022's monthly question is EXCLUDED by id at both steps. A wrong figure in a
-- pay decision is worse than an absent one.

begin;

create or replace function public.record_salary_expectation(p_evaluation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_eval     record;
  v_actor    uuid := (select auth.uid());
  v_answers  jsonb;
  v_amount   numeric;
  v_note     text;
  v_current  numeric;
  v_qid      uuid;
  v_monthly  uuid := md5('linkd.q.salary_expectation')::uuid;
begin
  select e.id, e.evaluatee_id into v_eval
    from public.evaluations e
   where e.id = p_evaluation_id;

  if not found then
    return false;
  end if;

  -- The employee, setting their own figure; or an administrator picking it up
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

  /* -- 1. The seeded question, by id. -- */
  v_qid  := md5('linkd.q.salary_expectation_annual')::uuid;
  v_amount := nullif(v_answers ->> v_qid::text, '')::numeric;

  /* -- 2. Otherwise whatever NUMBER question this evaluation actually asked.
        Scoped to THIS evaluation's frozen list, so it cannot pick up a question
        somebody else was asked. `order by sort_order` makes it deterministic if
        a form somehow carries two. -- */
  if v_amount is null then
    select q.question_id into v_qid
      from public.evaluation_questions q
     where q.evaluation_id = p_evaluation_id
       and q.response_type = 'NUMBER'
       and q.question_id <> v_monthly          -- never the retired monthly one
       and q.text ~* '(salary|ctc|pay|compensation)'
       and q.text !~* 'month'                  -- nor anything asking per month
     order by q.sort_order
     limit 1;

    if v_qid is not null then
      v_amount := nullif(v_answers ->> v_qid::text, '')::numeric;
    end if;
  end if;

  /* -- The note, the same way: the seeded id first, then any long-text question
        in this snapshot that asks why. -- */
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

/* ---------- The records already stranded ----------

   Every increment evaluation whose employee has submitted and whose expectation
   never landed. Without this the fix only helps the NEXT cycle, and the whole
   report is about one that already exists.

   `auth.uid()` is null inside a migration, so the actor check above lets it
   through as the system — the same exemption P5-6 wrote for the seed and every
   provisioning script. */
do $backfill$
declare
  v_row     record;
  v_fixed   int := 0;
  v_tried   int := 0;
begin
  for v_row in
    select e.id
      from public.evaluations e
      join public.evaluation_cycles c on c.id = e.cycle_id
      left join public.increment_reviews ir on ir.evaluation_id = e.id
     where c.cycle_type = 'INCREMENT'
       and e.self_submitted_at is not null
       and (ir.evaluation_id is null or ir.employee_expectation_ctc is null)
  loop
    v_tried := v_tried + 1;
    if public.record_salary_expectation(v_row.id) then
      v_fixed := v_fixed + 1;
    end if;
  end loop;

  raise notice '0052: % increment evaluation(s) had no expectation recorded; % now do.',
    v_tried, v_fixed;
end;
$backfill$;

commit;
