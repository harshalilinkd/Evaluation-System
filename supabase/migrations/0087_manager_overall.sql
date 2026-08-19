-- 0087 · The manager figure, where a person has two managers.
--
-- Requires 0083. `evaluations.lead_overall` is the REPORTING LEAD's average and
-- nothing else — which was the whole of the manager side until 0083, and is now
-- half of it for anybody carrying a second reviewer. Every screen showing one
-- headline manager number reads that column, so a designer's scorecard, the
-- Team review roster and the printed pack all under-report by leaving one of
-- their two managers out.
--
-- ============================================================================
-- A NEW NAME, NOT A NEW MEANING FOR AN OLD ONE.
-- ============================================================================
-- The obvious fix is to make `lead_overall` mean "what the managers said". It is
-- the wrong one: that column is written by the transition at the reporting
-- lead's submission and is the truthful answer to "what did THAT person score
-- them", which the report still shows in its own column. A column that quietly
-- starts meaning something else is worse than a missing one, because nothing
-- fails — the figures simply stop matching the label, and §0.2 freezes a name
-- precisely so that cannot happen by accident.
--
-- So `manager_overall` is added beside it: the mean of every manager layer that
-- has been SUBMITTED. With one manager it equals `lead_overall`, which is what
-- makes every existing figure identical.
--
-- NO NEW COLUMN ON `evaluations`. SR-12 settled that and the reasoning holds:
-- `evaluation_responses.overall_score` is already the authoritative per-layer
-- figure, written for every layer including this one, so a stored copy would be
-- a fourth number to keep in step and another patch to the transition
-- function's whitelist. It is computed on read, in the views that need it.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'evaluations'
      and column_name = 'co_lead_id'
  ) then
    raise exception '0087 requires 0083 (evaluations.co_lead_id). Apply it first.';
  end if;
end $$;

/* ---------- The rule, in one place ---------- */
-- Every view below calls this rather than repeating the aggregate. Three copies
-- of "what did the managers say" is three chances for one of them to drift, and
-- the one that drifts is the one nobody is looking at.
--
-- SUBMITTED ONLY. `evaluation_responses.answers` is written by autosave every
-- twenty seconds from the moment a form is opened, and `overall_score` is
-- written at submission — so a null there is a manager who has not finished,
-- and averaging it in as anything would be inventing a rating nobody stood
-- behind. FIX-55 had to fix exactly this on the report.
--
-- STABLE, not IMMUTABLE: it reads a table. SECURITY INVOKER, so RLS still
-- decides what the caller may see — a definer function here would hand every
-- signed-in employee the company's manager averages through an aggregate, which
-- is the default-view trap P16-2 proved by querying as three different people.
create or replace function public.manager_overall(p_evaluation_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select round(avg(r.overall_score), 2)
  from public.evaluation_responses r
  where r.evaluation_id = p_evaluation_id
    and r.layer in ('LEAD', 'LEAD_2')
    and r.submitted_at is not null
    and r.overall_score is not null;
$$;

grant execute on function public.manager_overall(uuid) to authenticated;

comment on function public.manager_overall(uuid) is
  'The mean of every SUBMITTED manager layer for one evaluation. Equals evaluations.lead_overall where there is one manager; the mean of both where the evaluatee carries a second reviewer (0083). Computed on read — evaluation_responses.overall_score is the authoritative per-layer figure (SR-12).';

/* ---------- v_employee_history ---------- */
-- Recreated rather than patched: a view IS its own definition, so restating it
-- is reading the whole thing rather than hoping a fragment still matches (SR-16).
-- `lead_overall` KEEPS ITS NAME AND ITS MEANING; `manager_overall` is new beside
-- it, so nothing that reads this view today changes until it asks for the new
-- column.
create or replace view public.v_employee_history
with (security_invoker = true) as
select
  e.evaluatee_id as profile_id,
  e.id           as evaluation_id,
  e.cycle_id,
  c.name         as cycle_name,
  c.period_label,
  c.starts_on,
  e.status,
  e.self_overall,
  e.lead_overall,
  e.final_overall,
  dec.promotion_recommendation,
  dec.increment_type,
  dec.increment_pct,
  -- Carried so a reader can apply §9 without a second query: what an employee
  -- may be shown of their own history depends on the cycle's policy.
  c.disclosure,
  /* -- LAST, and that is a Postgres constraint rather than a preference:
        `create or replace view` may only APPEND columns. Inserting this one
        beside `lead_overall`, where it reads better, fails with "cannot change
        name of view column final_overall to manager_overall" — the replace is
        positional, so every column after the insertion point would be renamed.

        Falls back to the stored column where no manager response carries a
        score. The two agree by construction — the transition writes both at
        submission — but the fallback costs nothing and means a row from before
        this view existed still reports a figure rather than a blank. -- */
  coalesce(public.manager_overall(e.id), e.lead_overall) as manager_overall
from public.evaluations e
join public.evaluation_cycles c on c.id = e.cycle_id
left join public.evaluation_decisions dec on dec.evaluation_id = e.id
where e.excluded_at is null
  and e.track = 'STAFF';

/* ---------- v_department_scores ---------- */
-- `avg_lead` and `gap` are computed from the MANAGER figure now, not from the
-- reporting lead's alone. The column names are unchanged (§0.2) and so is what
-- they claim to be — a department's manager average genuinely means every
-- manager who was asked, and leaving a designer's coordinator out of it made
-- the number quietly wrong rather than differently defined.
--
-- Identical wherever nobody in the department has a second reviewer.
create or replace view public.v_department_scores
with (security_invoker = true) as
select
  e.cycle_id,
  e.department_id,
  d.name as department_name,
  count(*)                                            as people,
  count(e.self_overall)                               as self_count,
  round(avg(e.self_overall), 2)                       as avg_self,
  round(avg(coalesce(public.manager_overall(e.id), e.lead_overall)), 2) as avg_lead,
  round(avg(e.final_overall), 2)                      as avg_final,
  -- The gap is manager minus self, the same direction §11 defines variance in,
  -- so a positive number always means "the manager scored higher" on every
  -- screen. What changed is only WHOSE figure the manager side is.
  round(
    avg(coalesce(public.manager_overall(e.id), e.lead_overall)) - avg(e.self_overall),
    2)                                                as gap
from public.evaluations e
-- LEFT join, as 0015 has it: a person with no department still counts toward the
-- cycle. An inner join here would drop them from the figures silently, which is
-- the kind of change nobody notices until a total stops adding up.
left join public.departments d on d.id = e.department_id
where e.excluded_at is null
  and e.track = 'STAFF'
group by e.cycle_id, e.department_id, d.name;

/* ---------- v_variance_by_lead ---------- */
-- THE SAME BLIND SPOT THE CHASE LIST HAD (SR-18), on the screen that asks
-- whether a rater is consistent. This view joined `e.lead_id` and read the LEAD
-- layer, so a Design Coordinator rating twelve designers appeared in it not at
-- all — the one report that would show them rating everybody two points high.
--
-- Each rater is now measured against THEIR OWN layer, which is what the view has
-- always meant: P16-5 keeps the signed and absolute means apart precisely so a
-- lead who is +2 on half their team and −2 on the other half reads as
-- inconsistent rather than neutral. That only works if the rows belong to one
-- rater.
create or replace view public.v_variance_by_lead
with (security_invoker = true) as
with rater as (
  -- One row per (evaluation, rater), naming which layer is theirs.
  select e.id as evaluation_id, e.cycle_id, e.lead_id as rater_id, 'LEAD'::public.rating_layer as layer
  from public.evaluations e
  where e.lead_id is not null
  union all
  select e.id, e.cycle_id, e.co_lead_id, 'LEAD_2'::public.rating_layer
  from public.evaluations e
  where e.co_lead_id is not null
)
select
  e.cycle_id,
  -- The column keeps its name: every caller selects it, and "the rater this row
  -- is about" is what it has always held.
  ra.rater_id as lead_id,
  p.full_name as lead_name,
  count(distinct e.id)                                    as reports_scored,
  round(avg(lead_score.value - self_score.value), 2)       as mean_delta,
  round(avg(abs(lead_score.value - self_score.value)), 2)  as mean_abs_delta
from public.evaluations e
join rater ra on ra.evaluation_id = e.id
join public.profiles p on p.id = ra.rater_id
join public.evaluation_questions eq on eq.evaluation_id = e.id
join lateral (
  select (r.answers ->> eq.question_id::text)::numeric as value
  from public.evaluation_responses r
  where r.evaluation_id = e.id and r.layer = 'SELF'
    and jsonb_typeof(r.answers -> eq.question_id::text) = 'number'
) self_score on true
join lateral (
  -- THEIR layer, not "the lead's". This is the whole change.
  select (r.answers ->> eq.question_id::text)::numeric as value
  from public.evaluation_responses r
  where r.evaluation_id = e.id and r.layer = ra.layer
    and jsonb_typeof(r.answers -> eq.question_id::text) = 'number'
) lead_score on true
where eq.response_type = 'SCALE_0_5'
  -- Only questions BOTH layers answer can vary. §11: a question answered by one
  -- side yields no delta rather than a disagreement with silence.
  and eq.answered_by = 'EMPLOYEE_AND_LEAD'
  and e.excluded_at is null
  and e.track = 'STAFF'
group by e.cycle_id, ra.rater_id, p.full_name;

do $$
begin
  raise notice '0087 applied. A second reviewer now counts toward the manager figure and appears in variance by rater.';
end $$;
