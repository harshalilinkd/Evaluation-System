-- 0097 — The same CORE question cannot be asked twice.
--
-- ============================================================================
-- REPORTED FROM PRODUCTION: "why this quality of work question appeared two
-- times in the report and employee increment cycle evaluation forms. In form
-- builder i see only one question for quality of work. the second reviewer
-- also complain me this that they get this que repeated in their form."
--
-- WHAT HAPPENED. The bank held TWO rows reading "Quality of work", created
-- 0.365 seconds apart — a double-submit, not a decision. Both were
-- `category = 'CORE'`, and a CORE question goes to everybody regardless of
-- department (§1: every staff employee answers the same form), so assembly
-- correctly included both and froze both into the snapshot. Three people then
-- rated the same question twice and gave it the same score each time.
--
-- The builder shows one because one has since been retired, and the builder
-- reads the LIVE bank. The form and the report read the FROZEN SNAPSHOT (§5),
-- which still carries both — which is the snapshot rule working exactly as
-- intended, not a second bug.
--
-- WHY A PARTIAL INDEX AND NOT A PLAIN UNIQUE ON text. Two questions may
-- legitimately share their text, and this repository has recorded both cases:
--
--   * P2-3 — two conditional follow-ups both reading "If yes, please specify
--     the details and reasons", hanging off DIFFERENT parents. `depends_on` is
--     in the key, so those remain legal.
--
--   * A DEPARTMENT question repeated per team. Checked against live data before
--     writing this: "New Client Acquisition" exists twice, mapped to Sales
--     Coordinator and to Sales Person; "Work Management & Timely Completion"
--     three times, mapped to Design, DEO and HR. Those are redundant in the
--     bank and entirely harmless on a form, because a person is in one
--     department and only ever sees one of them. A constraint that caught those
--     would not be preventing a bug, it would be deleting three teams'
--     questions. Hence `category = 'CORE'`.
--
-- So the rule is exactly as narrow as the fault: a question that goes to
-- EVERYONE may not be asked twice.
--
-- WHAT THIS DOES NOT DO. It does not touch the one evaluation that already
-- carries the duplicate. §5 freezes a launched question set, `evaluation_questions`
-- deliberately has no UPDATE or DELETE policy for anybody (P5-9), and both
-- copies there are answered by all three layers — so removing one would move
-- three stored scores on an increment that is currently with the MD. That is a
-- decision about somebody's pay, not a cleanup, and it is the owner's to take.
-- ============================================================================

create unique index if not exists questions_no_duplicate_core
  on public.questions (
    lower(btrim(text)),
    section,
    answered_by,
    track,
    cycle_scope,
    /* A conditional follow-up is identified by its PARENT as much as by its
       text (P2-3). Coalesced because NULL is never equal to NULL in an index,
       so without this every non-conditional question would slip the check. */
    coalesce(depends_on, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where is_active and category = 'CORE';

do $chk$
begin
  if to_regclass('public.questions_no_duplicate_core') is null then
    raise exception '0097: the index was not created.';
  end if;

  raise notice '0097: a CORE question can no longer be added twice.';
end;
$chk$;
