-- 0049 — the rating distribution counted a score most evaluations never get.
--
-- SYMPTOM: the dashboard's "Where the ratings sit" panel said "Bands appear
-- here once ratings come in" on a cycle whose ratings were plainly in — the
-- same screen was showing a lead average of 3.50 and section averages above 4.
--
-- CAUSE: `v_rating_distribution` bands on `final_overall` and requires it to be
-- non-null. That was right in P16, when §8 ended every evaluation at
-- MD_FINALIZED and the MD wrote a final score on the way through. It has not
-- been right since:
--
--   · AMEND-2 removed the final score as a concept — §11 now reads "there is no
--     final score column and no override", and where a single headline figure
--     is needed it is the LEAD average, labelled as such.
--   · 0039 made the MD optional on an EVALUATION cycle, so HR completing a
--     report is the ordinary ending and `final_overall` stays null.
--   · 0046 writes one for the increment path only.
--
-- So on the common path the column is null, the view returns zero rows, and a
-- panel about ratings reports that there are none. Every other surface in the
-- product already resolves this the same way — §11's precedence, `final ?? lead`
-- — and this view was the one place still insisting on the final figure alone.
--
-- THE FIX: band on the SETTLED score. Column names are unchanged (§0.2, and
-- `lib/analytics/queries.ts` selects `*` into a generated type), so nothing
-- downstream needs to know.
--
-- Self is deliberately NOT a third fallback. A distribution built partly on
-- self-assessment describes confidence rather than performance, and the panel
-- would silently change meaning per row depending on which layers happened to
-- be in.

create or replace view public.v_rating_distribution
with (security_invoker = true) as
select
  e.cycle_id,
  case
    -- The settled figure: what was agreed if anything was, else what the HOD
    -- recorded. Computed once in the CASE rather than in five branches, so a
    -- future edit cannot change the precedence in only some of them.
    when coalesce(e.final_overall, e.lead_overall) < 1 then '0-1'
    when coalesce(e.final_overall, e.lead_overall) < 2 then '1-2'
    when coalesce(e.final_overall, e.lead_overall) < 3 then '2-3'
    when coalesce(e.final_overall, e.lead_overall) < 4 then '3-4'
    else '4-5'
  end as bucket,
  count(*) as people
from public.evaluations e
where coalesce(e.final_overall, e.lead_overall) is not null
  and e.excluded_at is null
  and e.track = 'STAFF'
group by e.cycle_id, bucket;

-- `create or replace view` keeps the existing grants, but stating it is cheap
-- and makes the file safe to run against a database where the view was dropped
-- rather than replaced.
grant select on public.v_rating_distribution to authenticated;

comment on view public.v_rating_distribution is
  'People per score band, on the SETTLED score (final where one was agreed, else the lead average — §11''s precedence). Banding on final_overall alone returned nothing on every cycle HR completed without the MD (0039).';
