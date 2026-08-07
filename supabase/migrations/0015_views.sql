-- =============================================================================
-- 0015_views.sql — analytics views. Phase P16.
-- CLAUDE.md §5 (module boundary), §9 (RLS), §11 (scoring).
-- =============================================================================
--
-- NUMBERING. The P16 brief names this 0008_views.sql. 0008 is
-- 0008_single_form.sql and has been applied; §0.8 says numbering is sequential
-- and an applied migration is never edited. Renumbered to 0015, as 0010 was for
-- the same reason.
--
-- SECURITY_INVOKER IS THE WHOLE POINT OF THIS FILE.
--
-- A view in Postgres runs as its OWNER by default. Every view below reads
-- evaluations, and evaluations has RLS — so a default view would run as the
-- migration's owner, bypass every policy, and hand any signed-in employee the
-- company's salary decisions through an aggregate. That is not a hypothetical:
-- it is the default behaviour, and it is silent.
--
-- `with (security_invoker = true)` makes the view run as the CALLER, so the same
-- policies apply as if they had written the query themselves. An employee
-- selecting from v_department_scores sees rows built only from evaluations they
-- can already read — which for an employee is their own, so a department
-- average of one person is their own number and reveals nothing new.
--
-- The brief asks for this to be verified rather than assumed. It is: p16 asserts
-- reloptions on every view, and then proves the behaviour by querying as three
-- different people and comparing what comes back.
--
-- §5's MODULE BOUNDARY holds here too: every view filters track = 'STAFF'.
-- Averaging a shop-floor tick sheet into a staff mean would produce a number
-- that means nothing and cannot be traced back to why.
-- =============================================================================


/* ---------- v_cycle_progress ---------- */

create or replace view public.v_cycle_progress
with (security_invoker = true) as
select
  e.cycle_id,
  c.name          as cycle_name,
  c.period_label,
  count(*)                                                          as total,
  count(*) filter (where e.status = 'CYCLE_ACTIVE')                 as not_started,
  count(*) filter (where e.status = 'SELF_SUBMITTED')               as self_submitted,
  count(*) filter (where e.status = 'LEAD_REVIEWED')                as lead_reviewed,
  count(*) filter (where e.status = 'MD_FINALIZED')                 as md_finalized,
  count(*) filter (where e.status = 'CLOSED')                       as closed,
  -- Each evaluation is worth three steps — self, lead, MD — so the bar moves as
  -- work happens rather than only when somebody finishes entirely.
  round(
    (count(*) filter (where e.status in ('SELF_SUBMITTED','LEAD_REVIEWED','MD_FINALIZED','CLOSED'))
   + count(*) filter (where e.status in ('LEAD_REVIEWED','MD_FINALIZED','CLOSED'))
   + count(*) filter (where e.status in ('MD_FINALIZED','CLOSED')))::numeric
    / nullif(count(*) * 3, 0) * 100, 1)                             as percent_complete
from public.evaluations e
join public.evaluation_cycles c on c.id = e.cycle_id
where e.excluded_at is null
  and e.track = 'STAFF'
group by e.cycle_id, c.name, c.period_label;


/* ---------- v_department_scores ---------- */

create or replace view public.v_department_scores
with (security_invoker = true) as
select
  e.cycle_id,
  e.department_id,
  d.name as department_name,
  count(*)                                            as people,
  count(e.self_overall)                               as self_count,
  round(avg(e.self_overall), 2)                       as avg_self,
  round(avg(e.lead_overall), 2)                       as avg_lead,
  round(avg(e.final_overall), 2)                      as avg_final,
  -- The gap is lead minus self, the same direction §11 defines variance in, so
  -- a positive number always means "the lead scored higher" on every screen.
  round(avg(e.lead_overall) - avg(e.self_overall), 2) as gap
from public.evaluations e
left join public.departments d on d.id = e.department_id
where e.excluded_at is null
  and e.track = 'STAFF'
group by e.cycle_id, e.department_id, d.name;


/* ---------- v_section_scores ---------- */
--
-- Per section, so a department can see where it is strong. Reads the FROZEN
-- snapshot, never the live bank (§5) — a section average computed against
-- today's questions would not describe the form anybody actually answered.
--
-- `is_comparable` is the important column. Job Specific Skills is a DIFFERENT
-- SET OF QUESTIONS per department, so plotting Sales' 4.2 beside Accounts' 3.8
-- compares two unrelated things and invites a conclusion neither supports.
-- The flag travels with the row so a chart cannot forget.

create or replace view public.v_section_scores
with (security_invoker = true) as
select
  e.cycle_id,
  e.department_id,
  d.name        as department_name,
  eq.section,
  eq.section <> 'DEPARTMENT_SPECIFIC' as is_comparable,
  count(*)      as answer_count,
  round(avg((r.answers ->> eq.question_id::text)::numeric), 2) as avg_score,
  r.layer
from public.evaluation_questions eq
join public.evaluations e            on e.id = eq.evaluation_id
join public.evaluation_responses r   on r.evaluation_id = e.id
left join public.departments d       on d.id = e.department_id
where eq.response_type = 'SCALE_0_5'
  and e.excluded_at is null
  and e.track = 'STAFF'
  and r.answers ? eq.question_id::text
  and jsonb_typeof(r.answers -> eq.question_id::text) = 'number'
group by e.cycle_id, e.department_id, d.name, eq.section, r.layer;


/* ---------- v_variance_by_lead ---------- */
--
-- "Is a lead systematically over- or under-rating?"
--
-- The SIGNED mean matters, not the absolute one: a lead who is two points above
-- on half their team and two points below on the other half averages zero and is
-- inconsistent, not biased. A lead who is +1.4 across twenty people is telling
-- you something else entirely. Both are worth seeing, so the count travels with
-- the mean — a +2.0 over three people is noise.

create or replace view public.v_variance_by_lead
with (security_invoker = true) as
select
  e.cycle_id,
  e.lead_id,
  p.full_name as lead_name,
  count(distinct e.id)                                  as reports_scored,
  round(avg(lead_score.value - self_score.value), 2)     as mean_delta,
  round(avg(abs(lead_score.value - self_score.value)), 2) as mean_abs_delta
from public.evaluations e
join public.profiles p on p.id = e.lead_id
join public.evaluation_questions eq on eq.evaluation_id = e.id
join lateral (
  select (r.answers ->> eq.question_id::text)::numeric as value
  from public.evaluation_responses r
  where r.evaluation_id = e.id and r.layer = 'SELF'
    and jsonb_typeof(r.answers -> eq.question_id::text) = 'number'
) self_score on true
join lateral (
  select (r.answers ->> eq.question_id::text)::numeric as value
  from public.evaluation_responses r
  where r.evaluation_id = e.id and r.layer = 'LEAD'
    and jsonb_typeof(r.answers -> eq.question_id::text) = 'number'
) lead_score on true
where eq.response_type = 'SCALE_0_5'
  -- Only questions BOTH layers answer can vary. §11: a question answered by one
  -- side yields no delta rather than a disagreement with silence.
  and eq.answered_by = 'EMPLOYEE_AND_LEAD'
  and e.excluded_at is null
  and e.track = 'STAFF'
group by e.cycle_id, e.lead_id, p.full_name;


/* ---------- v_rating_distribution ---------- */

create or replace view public.v_rating_distribution
with (security_invoker = true) as
select
  e.cycle_id,
  case
    when e.final_overall < 1 then '0-1'
    when e.final_overall < 2 then '1-2'
    when e.final_overall < 3 then '2-3'
    when e.final_overall < 4 then '3-4'
    else '4-5'
  end as bucket,
  count(*) as people
from public.evaluations e
where e.final_overall is not null
  and e.excluded_at is null
  and e.track = 'STAFF'
group by e.cycle_id, bucket;


/* ---------- v_employee_history ---------- */

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
  c.disclosure
from public.evaluations e
join public.evaluation_cycles c on c.id = e.cycle_id
left join public.evaluation_decisions dec on dec.evaluation_id = e.id
where e.excluded_at is null
  and e.track = 'STAFF';


/* ---------- Indexes the views need ---------- */
--
-- P16: "The HR dashboard must render in under one second with 500 evaluations."
-- Everything above groups by cycle, department or lead, and joins the snapshot
-- to the responses.

create index if not exists evaluations_cycle_department_idx
  on public.evaluations (cycle_id, department_id)
  where excluded_at is null;

create index if not exists evaluations_cycle_lead_idx
  on public.evaluations (cycle_id, lead_id)
  where excluded_at is null;

-- v_section_scores filters on response_type before it groups; without this the
-- snapshot is scanned in full for every dashboard load.
create index if not exists evaluation_questions_scored_idx
  on public.evaluation_questions (evaluation_id, section)
  where response_type = 'SCALE_0_5';

create index if not exists evaluation_responses_layer_idx
  on public.evaluation_responses (layer, evaluation_id);


/* ---------- Grants ---------- */
--
-- SELECT only, and only to authenticated. The views are security_invoker, so
-- this grant is permission to *ask* — RLS on the underlying tables still decides
-- what comes back.

grant select on public.v_cycle_progress       to authenticated;
grant select on public.v_department_scores    to authenticated;
grant select on public.v_section_scores       to authenticated;
grant select on public.v_variance_by_lead     to authenticated;
grant select on public.v_rating_distribution  to authenticated;
grant select on public.v_employee_history     to authenticated;

comment on view public.v_department_scores is
  'Per cycle and department averages. security_invoker (P16): an employee selecting from this sees only rows built from evaluations RLS already admits, so an aggregate cannot leak a colleague''s score.';

comment on view public.v_section_scores is
  'Per section averages from the FROZEN snapshot (§5). is_comparable is false for Job Specific Skills: those are different questions per department and must never share an axis.';
