-- 0027_cycle_progress_blind.sql
-- `v_cycle_progress` still counts the four statuses AMEND-3 retired, so every
-- cycle reads 0% complete no matter how much work has been done.
--
-- WHAT IS BROKEN
--
-- 0015 wrote the buckets as CYCLE_ACTIVE / SELF_SUBMITTED / LEAD_REVIEWED /
-- MD_FINALIZED. 0021 replaced all four (OPEN, PENDING_HR_REVIEW, HR_APPROVED,
-- MD_REVIEWED) and added `evaluations_status_current` so no new row can carry
-- an old one — but nothing rebuilt this view. Every `filter` therefore matches
-- nothing, and `percent_complete` divides zero by the participant count:
--
--   a cycle with both evaluations fully reviewed  →  0.0% complete
--
-- This is the number on HR's cycle board and the dashboard. It reports no
-- progress on a cycle that is finished.
--
-- WHAT CHANGED, AND WHAT DELIBERATELY DID NOT
--
-- Every column name is kept exactly as it was (§0.2 — names are fixed once
-- created, and `lib/analytics/queries.ts` selects * into a generated type).
-- Only what each column COUNTS is corrected:
--
--   not_started      CYCLE_ACTIVE            -> OPEN
--   self_submitted   status = SELF_SUBMITTED -> self_submitted_at is not null
--   lead_reviewed    status = LEAD_REVIEWED  -> lead_submitted_at is not null
--   md_finalized     status = MD_FINALIZED   -> MD_REVIEWED / INTERVIEW_DONE / CLOSED
--   closed           unchanged
--
-- The two middle rows are the substantive change. Under blind parallel rating
-- the self and lead layers are filled AT THE SAME TIME, so neither is a status
-- any more — AMEND-3 records them as timestamps, and the timestamp is now the
-- only honest source. Reading them from `status` would have been wrong even if
-- the old names had survived: an evaluation at PENDING_HR_REVIEW has both
-- layers in, and no single status can say "the self layer is done but the lead
-- layer is not" when the two no longer take turns.
--
-- `percent_complete` keeps its three-steps-per-evaluation shape for the same
-- reason 0015 chose it — the bar should move as work happens rather than only
-- when somebody finishes. The three steps are now: the self layer is in, the
-- lead layer is in, the MD has reviewed.
--
-- SAFE TO RE-RUN.

begin;

-- security_invoker is not decoration. A Postgres view runs as its OWNER by
-- default, and this one reads `evaluations`, which has RLS — a default view
-- would hand any signed-in employee the whole company's cycle progress. P16-2
-- proved this behaviour rather than assuming it; keep the flag on any rebuild.
create or replace view public.v_cycle_progress
with (security_invoker = true) as
select
  e.cycle_id,
  c.name          as cycle_name,
  c.period_label,
  count(*)                                                          as total,
  count(*) filter (where e.status = 'OPEN'
                     and e.self_submitted_at is null
                     and e.lead_submitted_at is null)               as not_started,
  -- A layer counts as done when its timestamp is set OR the evaluation has moved
  -- past the point that requires it. Both halves are needed. The timestamp alone
  -- under-reports twice: a SKIPPED layer (self_skipped / lead_skipped) advances
  -- the status deliberately without ever setting one, and any row whose status
  -- was moved by an administrator would read as unstarted for ever. Progress
  -- that can go backwards, or that shows 33% on a finished evaluation, is worse
  -- than no progress bar.
  count(*) filter (where e.self_submitted_at is not null
                      or e.status in ('PENDING_HR_REVIEW','HR_APPROVED',
                                      'MD_REVIEWED','INTERVIEW_DONE','CLOSED'))
                                                                    as self_submitted,
  count(*) filter (where e.lead_submitted_at is not null
                      or e.status in ('PENDING_HR_REVIEW','HR_APPROVED',
                                      'MD_REVIEWED','INTERVIEW_DONE','CLOSED'))
                                                                    as lead_reviewed,
  count(*) filter (where e.status in ('MD_REVIEWED','INTERVIEW_DONE','CLOSED'))
                                                                    as md_finalized,
  count(*) filter (where e.status = 'CLOSED')                       as closed,
  -- Each evaluation is worth three steps — self, lead, MD — so the bar moves as
  -- work happens rather than only when somebody finishes entirely.
  round(
    (count(*) filter (where e.self_submitted_at is not null
                        or e.status in ('PENDING_HR_REVIEW','HR_APPROVED',
                                        'MD_REVIEWED','INTERVIEW_DONE','CLOSED'))
   + count(*) filter (where e.lead_submitted_at is not null
                        or e.status in ('PENDING_HR_REVIEW','HR_APPROVED',
                                        'MD_REVIEWED','INTERVIEW_DONE','CLOSED'))
   + count(*) filter (where e.status in ('MD_REVIEWED','INTERVIEW_DONE','CLOSED')))::numeric
    / nullif(count(*) * 3, 0) * 100, 1)                             as percent_complete
from public.evaluations e
join public.evaluation_cycles c on c.id = e.cycle_id
where e.excluded_at is null
  and e.track = 'STAFF'
group by e.cycle_id, c.name, c.period_label;

comment on view public.v_cycle_progress is
  'Per-cycle completion (P16). Column names are unchanged from 0015; the buckets were retargeted in 0027 after AMEND-3 retired the four statuses they counted. The self and lead buckets read the submission TIMESTAMPS, because blind parallel rating means neither layer has a status of its own.';

commit;
