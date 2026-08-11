-- 0062: the manager recommends a hike percentage.
--
-- Phase 2 of the increment overhaul, at the owner's explicit instruction:
-- "if HOD select yes and can be considered then we will ask hod Hike percent."
--
-- ============================================================================
-- THIS AMENDS §5 SALARY CONFINEMENT, AT THE OWNER'S EXPLICIT INSTRUCTION.
--
-- §5 reads: "Salary figures are readable by HR_ADMIN and MD only. They never
-- appear in a HOD-facing screen." §17 repeats it as a prohibition.
--
-- The amendment is narrow, and the distinction it turns on is real:
--
--   A rater may RECORD a recommended increment percentage on the form they
--   own. That percentage is readable only by its author, HR and the MD. No
--   rater may read a salary AMOUNT, another person's percentage, or any figure
--   derived from theirs.
--
-- A percent is dimensionless and the manager is its AUTHOR, not a recipient —
-- nothing flows toward them. They already record "Promotion recommendation:
-- Yes", which is a larger pay signal than "12%". What §5 protects is a manager
-- READING pay, and this lets them read nothing.
--
-- The round trip is the part that would break it, and it is closed by where the
-- value is stored rather than by a rule somebody has to remember. It is an
-- ordinary question landing in `evaluation_responses`, layer LEAD, whose read
-- policy (0021) admits exactly the author, HR and the MD — §5's permitted set
-- plus the person who wrote it — at every status including CLOSED.
--
-- WHAT MUST NOT BE DONE, and is not: put it on `increment_reviews`. There is no
-- HOD policy on that table; RLS is row-level and cannot mask a column, so
-- admitting the row would hand over `current_ctc`, `joining_ctc` and every
-- proposal beside it. 0030's column guard would raise first in any case.
--
-- So: no new table, no new policy, no new trigger.
--
-- §5 BLINDNESS is unaffected and holds in both directions. Parent and child are
-- both LEAD_ONLY, so the employee is never shown either — and the manager is
-- shown nothing of the employee's expectation.
-- ============================================================================

begin;

/* ---------- The question ---------- */

do $$
declare
  v_promotion uuid := md5('linkd.q.mgr.promotion')::uuid;
  v_hike      uuid := md5('linkd.q.mgr.hike_percent')::uuid;
begin
  if not exists (select 1 from public.questions where id = v_promotion) then
    raise exception
      '0062: the promotion question is missing. Apply 0017 first.';
  end if;

  insert into public.questions
    (id, text, help_text, section, response_type, category, track, answered_by,
     is_required, min_value, max_value, sort_order, is_active,
     depends_on, depends_value)
  values (
    v_hike,
    'Recommended increment percentage',
    'Your recommendation only — HR and management decide the final figure. '
      || 'A percentage, not an amount: you are not shown anybody''s salary and '
      || 'do not need it to answer this.',
    'MANAGER_REVIEW',
    'NUMBER',
    'CORE',
    'STAFF',
    -- The manager's own layer. This is what keeps the value inside §5's
    -- permitted set without a single new policy.
    'LEAD_ONLY',
    -- NOT required. A manager who recommends a promotion but has no view on the
    -- figure must be able to say so by leaving it blank; forcing a number would
    -- manufacture a recommendation nobody meant to make.
    false,
    0,
    -- A ceiling, because a mistyped 500 reaching a pay screen as "500%" is a
    -- number somebody has to talk down from. 100 is far above any real rise and
    -- still refuses an obvious slip.
    100,
    -- Immediately after the promotion question it depends on (60).
    65,
    true,
    v_promotion,
    -- TWO acceptable values, separated by `|`. `matchesDependency` splits on it;
    -- a value without one behaves exactly as before, so every condition already
    -- frozen into a launched snapshot is untouched (§5).
    'YES|CAN_BE_CONSIDERED'
  )
  on conflict (id) do update
    set text          = excluded.text,
        help_text     = excluded.help_text,
        depends_on    = excluded.depends_on,
        depends_value = excluded.depends_value,
        min_value     = excluded.min_value,
        max_value     = excluded.max_value,
        is_active     = true;

  raise notice '0062: the manager''s hike percentage is on the form.';
end;
$$;

/* ---------- Audit ---------- */

-- §12, and this one earns its row twice over: it is a question-bank change AND
-- a constitutional amendment. The reasoning must be findable from the data, not
-- only from a migration file somebody would have to know to look for.
insert into public.audit_log (actor_id, entity, entity_id, action, diff)
values (
  null,
  'question',
  md5('linkd.q.mgr.hike_percent')::uuid,
  'question.created',
  jsonb_build_object(
    'text', 'Recommended increment percentage',
    'answered_by', 'LEAD_ONLY',
    'depends_on', 'Promotion recommendation = Yes or Can be considered',
    'amends', '§5 salary confinement — a rater may RECORD a percentage on their own form; they may never READ an amount, another rater''s percentage, or anything derived from theirs.',
    'why', 'Owner instruction: the manager recommends the increment percentage.'
  )
);

commit;

/* ============================================================================
   Confirm
   ==========================================================================
   `answered_by` is the load-bearing one: LEAD_ONLY is what keeps the value in a
   layer the employee cannot read and the manager cannot read back an amount
   from. */

select
  q.text                                                as question,
  q.answered_by                                         as who_answers,
  q.response_type                                       as type,
  q.is_required                                         as required,
  q.depends_value                                       as shown_when,
  p.text                                                as depends_on,
  (q.depends_value like '%|%')                          as accepts_two_values,
  (q.answered_by = 'LEAD_ONLY')                         as employee_cannot_see_it
from public.questions q
left join public.questions p on p.id = q.depends_on
where q.id = md5('linkd.q.mgr.hike_percent')::uuid;
