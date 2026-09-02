-- 0102: `overall_comment` is the TEAM LEADER's comment. It is not superseded.
--
-- ============================================================================
-- A COMMENT-ONLY MIGRATION, and it exists because 0100 said something that has
-- stopped being true.
--
-- 0100 moved the single comment to `worker_evaluation_decisions.supervisor_
-- comment` and marked `worker_evaluation_responses.overall_comment` SUPERSEDED,
-- with "Nothing reads it." That was right while there was one comment written
-- by one person.
--
-- At the owner's instruction there are now TWO, written by two people about the
-- same worker:
--
--   worker_evaluation_responses.overall_comment
--     the TEAM LEADER's, beside the ticks they are making. On their own layer
--     row, so it locks with the rest of their layer when they submit — theirs,
--     and read-only afterwards like every other answer they gave.
--
--   worker_evaluation_decisions.supervisor_comment
--     the SUPERVISOR's, beside the training tick and the increment they
--     recommend. On the row HR and the MD read, with the decision it explains.
--
-- Merging them would lose which of the two said it, which is the one thing a
-- comment on an appraisal has to carry.
--
-- NO DATA MOVES. 0100's backfill copied the old single comment into
-- `supervisor_comment` and left the original in place, so an appraisal filed
-- before today has the same text in both columns — which is correct: one person
-- wrote it, and it was both. The screens compare the two and show one heading
-- where they match, rather than inventing a second author.
--
-- `training_required` on the response row IS still superseded: it belongs to
-- the supervisor, with the salary decision, and nothing writes the old column
-- any more once one is assigned.
-- ============================================================================

comment on column public.worker_evaluation_responses.overall_comment is
  'The TEAM LEADER''s comment, written beside their ticks and locked with their layer. NOT superseded — 0100 said so while there was one comment; 0102 splits it from the supervisor''s, which lives on worker_evaluation_decisions.supervisor_comment with the increment it explains.';

comment on column public.worker_evaluation_decisions.supervisor_comment is
  'The SUPERVISOR''s comment, written beside the training tick and the increment they recommend. A different person from the team leader''s comment on the response row (0102).';

comment on column public.worker_evaluation_responses.training_required is
  'SUPERSEDED by worker_evaluation_decisions.training_required (0100). Still superseded at 0102: the training tick is the supervisor''s, filed with the salary decision. Kept because it holds the record of every appraisal filed before the review step existed.';

do $chk$
begin
  if (select col_description('public.worker_evaluation_responses'::regclass,
        (select attnum from pg_attribute
          where attrelid = 'public.worker_evaluation_responses'::regclass
            and attname = 'overall_comment'))) like 'SUPERSEDED%' then
    raise exception '0102: overall_comment is still marked superseded.';
  end if;

  raise notice '0102 applied. Two comments, two authors, two columns.';
end;
$chk$;
