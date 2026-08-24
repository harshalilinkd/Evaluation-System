/**
 * The second reviewer's own overall, per cycle, on the employee history view.
 *
 * 0087 added `manager_overall` to `v_employee_history` — the mean of the
 * reporting lead and the second reviewer where both exist. That is the right
 * figure for a single headline number, and it is the ONLY figure the
 * scorecard's multi-cycle panels ("Appraisals over time", "Every cycle")
 * could draw on: the second reviewer's own, unblended score was never exposed
 * per cycle, only for the current one (0083's evaluations table, read
 * directly by `getScorecard` for the latest rated cycle alone).
 *
 * AT THE OWNER'S INSTRUCTION — "coordinator ratings still not added in all
 * charts" — this closes that gap so a history table can show the second
 * reviewer's own figure for every past cycle, not only the newest.
 *
 * `co_lead_overall` mirrors `manager_overall` exactly (STABLE SQL function,
 * same search_path, same submitted-only guard) but reads LEAD_2 alone rather
 * than averaging LEAD and LEAD_2 — the two figures answer different
 * questions and neither can be derived from the other once there is more
 * than one manager.
 */

create or replace function public.co_lead_overall(p_evaluation_id uuid)
returns numeric
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select round(r.overall_score, 2)
  from public.evaluation_responses r
  where r.evaluation_id = p_evaluation_id
    and r.layer = 'LEAD_2'
    and r.submitted_at is not null
    and r.overall_score is not null;
$$;

/* -- `create or replace view` may only APPEND a column (P34's own note on
      this exact view family): the replace is positional, so every column
      after the insertion point would otherwise be treated as renamed. New
      column goes last. -- */
create or replace view public.v_employee_history as
select
  e.evaluatee_id as profile_id,
  e.id as evaluation_id,
  e.cycle_id,
  c.name as cycle_name,
  c.period_label,
  c.starts_on,
  e.status,
  e.self_overall,
  e.lead_overall,
  e.final_overall,
  dec.promotion_recommendation,
  dec.increment_type,
  dec.increment_pct,
  c.disclosure,
  coalesce(public.manager_overall(e.id), e.lead_overall) as manager_overall,
  public.co_lead_overall(e.id) as co_lead_overall
from public.evaluations e
join public.evaluation_cycles c on c.id = e.cycle_id
left join public.evaluation_decisions dec on dec.evaluation_id = e.id
where e.excluded_at is null
  and e.track = 'STAFF';
