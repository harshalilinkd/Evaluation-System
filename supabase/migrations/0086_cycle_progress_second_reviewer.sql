-- 0086 · The progress view counts every manager who was asked.
--
-- Requires 0083. `v_cycle_progress` (0027) treats an evaluation as three steps —
-- self, lead, MD — and a person with a second reviewer has four. Left alone, a
-- designer's row reports its manager side as complete the moment ONE of their
-- two managers submits, so a cycle reads finishable while half its manager
-- ratings are outstanding.
--
-- RECREATED RATHER THAN PATCHED, and that is the difference from 0084 and 0085.
-- Those changed one arm of a two-hundred-line function whose body nobody should
-- have to retype; this is a forty-line view that IS its own definition, so
-- restating it is reading the whole thing rather than hoping a fragment still
-- matches. 0027's own reasoning is reproduced with it, because the two halves of
-- each condition are the part somebody will otherwise remove as redundant.
--
-- EVERY COLUMN NAME IS UNCHANGED (§0.2). `lib/analytics/queries.ts` selects `*`
-- into a generated type, so a renamed column is a compile error at best and a
-- silently missing figure at worst. What each column COUNTS changes; what it is
-- called does not.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'evaluations'
      and column_name = 'co_lead_submitted_at'
  ) then
    raise exception '0086 requires 0083 (evaluations.co_lead_submitted_at). Apply it first.';
  end if;
end $$;

-- security_invoker, as 0015 established and P16-2 proved by querying as three
-- different people: a Postgres view runs as its OWNER by default, so without
-- this it would bypass every policy on `evaluations` and hand any signed-in
-- employee the company's progress. Keep the flag on any rebuild.
create or replace view public.v_cycle_progress
with (security_invoker = true) as
with step as (
  select
    e.cycle_id,
    e.status,
    e.self_submitted_at,
    e.lead_submitted_at,
    e.co_lead_id,
    e.co_lead_submitted_at,
    /* -- PAST THE POINT THAT REQUIRES IT.
          A layer counts as done when its timestamp is set OR the evaluation has
          moved beyond the status that asks for it. Both halves are needed, and
          0027 says why: a SKIPPED layer advances the record deliberately
          without ever setting a timestamp, and any row an administrator moved
          would read as unstarted for ever. A progress bar that can go backwards,
          or that shows 33% on a finished evaluation, is worse than none. -- */
    (e.status in ('PENDING_HR_REVIEW','HR_APPROVED','MD_REVIEWED','INTERVIEW_DONE','CLOSED'))
      as past_open
  from public.evaluations e
  where e.excluded_at is null
    and e.track = 'STAFF'
),
scored as (
  select
    s.*,
    (s.self_submitted_at is not null or s.past_open)                        as self_done,
    /* -- THE MANAGER SIDE, COMPLETE.
          Complete means every manager who was asked — two, where the person
          carries a second reviewer (0083). Counting the reporting lead alone
          would report a designer as fully rated while one of their managers had
          not started, on the one figure HR reads to decide whether a cycle can
          close.

          Written as "no outstanding manager" so somebody with one manager is
          unaffected: the second clause is vacuously true when `co_lead_id` is
          null, exactly as 0083's completion trigger is. -- */
    (
      (s.lead_submitted_at is not null or s.past_open)
      and (s.co_lead_id is null or s.co_lead_submitted_at is not null or s.past_open)
    )                                                                       as lead_done,
    (s.status in ('MD_REVIEWED','INTERVIEW_DONE','CLOSED'))                 as md_done
  from step s
)
select
  sc.cycle_id,
  c.name          as cycle_name,
  c.period_label,
  count(*)                                                          as total,
  /* Nothing at all has happened. The second reviewer joins the condition: a
     designer whose coordinator has started IS started, whoever else has not. */
  count(*) filter (where sc.status = 'OPEN'
                     and sc.self_submitted_at is null
                     and sc.lead_submitted_at is null
                     and sc.co_lead_submitted_at is null)            as not_started,
  count(*) filter (where sc.self_done)                               as self_submitted,
  count(*) filter (where sc.lead_done)                               as lead_reviewed,
  count(*) filter (where sc.md_done)                                 as md_finalized,
  count(*) filter (where sc.status = 'CLOSED')                       as closed,
  /* -- STILL THREE STEPS PER EVALUATION, not four.
        A second reviewer does not make one person's appraisal worth more of the
        cycle than anybody else's — the denominator is people, and weighting
        designers higher would make a cycle's percentage depend on how many of
        them are in it. What changes is that their manager step is not done
        until both managers are, so the bar moves later for them and the figure
        stays comparable across cycles. -- */
  round(
    (count(*) filter (where sc.self_done)
   + count(*) filter (where sc.lead_done)
   + count(*) filter (where sc.md_done))::numeric
    / nullif(count(*) * 3, 0) * 100, 1)                              as percent_complete
from scored sc
join public.evaluation_cycles c on c.id = sc.cycle_id
group by sc.cycle_id, c.name, c.period_label;

comment on view public.v_cycle_progress is
  'Per-cycle progress, three steps per evaluation. The manager step needs EVERY manager who was asked, which is two where the evaluatee carries a second reviewer (0083). security_invoker: RLS decides what each reader sees.';

do $$
begin
  raise notice '0086 applied. A cycle with second reviewers now reports its manager step honestly.';
end $$;
