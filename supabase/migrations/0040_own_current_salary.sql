-- 0040 · An employee may read THEIR OWN current salary, and nothing else.
--
-- ============================================================================
-- THIS RELAXES A §5 CONTROL. Read this before applying it.
-- ============================================================================
--
-- §5 salary confinement: "Salary figures are readable by HR_ADMIN and MD only."
-- P19-2 implemented that literally and deliberately — `v_my_employment` selects
-- FOUR columns and none of them is money, because RLS is row-level and a policy
-- admitting somebody's own `employment_records` row hands them every column in
-- it. The absence of the column was the guarantee.
--
-- The owner has asked for the increment form to show the employee their current
-- salary, pre-filled, beside the expectation question. That is a deviation and
-- is recorded as one rather than absorbed.
--
-- WHY IT IS NEVERTHELESS THE RIGHT CALL, stated so the next reader can judge it:
--
--   · It is THEIR OWN figure. Confinement exists so a HOD cannot see what their
--     report earns and a colleague cannot see a peer's. An employee already
--     knows what they are paid — it reaches their bank monthly — so nothing is
--     disclosed that they did not have.
--
--   · The paper form this system replaces PRINTS it. P2-10 records that Old
--     Salary, Increment % and New Salary appear on the Worker appraisal sheet
--     and were kept out of the question bank because they are decision columns,
--     not questions. Showing it is faithful to the source (§17: do not "improve"
--     what came from the source forms).
--
--   · Asking somebody what they think is fair while withholding what they are
--     currently on makes the question harder to answer honestly and invites an
--     expectation anchored on nothing.
--
-- WHAT IS NOT RELAXED, and must stay that way:
--
--   · `employment_records` still has NO employee SELECT policy. Nobody gains a
--     row; this view is the only path, and it carries one money column.
--   · `salary_history` is untouched — an employee still cannot read their own
--     pay history, only today's figure.
--   · `v_my_employment` is untouched, so P19-2's guarantee about THAT view
--     still holds exactly as written. A second, narrowly named view is used
--     instead of widening the first, so the new capability is visible in its
--     name rather than hidden inside an existing one.
--   · Nobody else's figure is reachable. The `where` clause is on the primary
--     key against auth.uid(), so the view cannot return a second row.

begin;

/* ---------- v_my_current_salary ---------- */
--
-- Owner-rights, NOT security_invoker — the same shape as `v_my_employment`
-- (0023/0024). It has to be: `employment_records` grants the employee no
-- policy at all, so an invoker view would return nothing for the one person
-- it exists to serve. The `where` clause is the guard, and it is on the
-- primary key, so this view is structurally incapable of returning somebody
-- else's salary.

create or replace view public.v_my_current_salary as
select
  p.id as profile_id,
  e.current_ctc
from public.profiles p
join public.employment_records e on e.profile_id = p.id
where p.id = (select auth.uid());

comment on view public.v_my_current_salary is
  'A person''s OWN current CTC, and nothing else — one row, one money column (0040). Relaxes §5/P19-2 deliberately so the increment form can show what somebody is on beside what they think is fair. employment_records still admits no employee policy and salary_history is untouched: this view is the only path and it cannot widen.';

grant select on public.v_my_current_salary to authenticated;

commit;
