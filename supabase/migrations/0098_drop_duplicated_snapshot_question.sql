-- 0098 — Remove a question that was frozen into one evaluation twice.
--
-- ============================================================================
-- REPORTED FROM PRODUCTION, twice: "why this quality of work question appeared
-- two times in the report and employee increment cycle evaluation forms … the
-- second reviewer also complain me this that they get this que repeated in
-- their form", then "quality of work still showing in rports".
--
-- 0097 stopped it happening again. This clears the one record it already
-- reached, because a guard on the bank does nothing for a question set that was
-- frozen before the guard existed (§5).
--
-- WHY THIS IS A REPAIR AND NOT A REWRITE OF HISTORY, which matters because §5
-- freezes a launched question set and `evaluation_questions` deliberately has
-- no UPDATE or DELETE policy for anybody (P5-9). The snapshot rule exists so
-- that EDITING THE BANK cannot change what somebody was asked. It is not a
-- licence to keep asking one question twice: the two rows are the same question
-- — same text, same section, same type, same `answered_by` — and all three
-- raters answered both, identically. Nothing anybody said is being changed or
-- discarded. What is removed is the repetition, which was a double-submit in
-- the bank rather than anything a rater or HR decided.
--
-- NARROW BY CONSTRUCTION. It matches only a row whose text is duplicated WITHIN
-- ITS OWN evaluation, keeps the earliest by `sort_order`, and only ever touches
-- an evaluation that is not CLOSED. Against today's data that is one row on one
-- evaluation, and the block below refuses to run if it ever matches more than
-- it should.
--
-- THE STORED SCORES MOVE, and that is the whole reason this was put to the
-- owner before being run rather than done quietly. An average over 12 answers
-- becomes an average over 11:
--
--     SELF        4.27  ->  4.30
--     LEAD        3.83  ->  3.82
--     LEAD_2      3.67  ->  3.73
--
-- No opinion changes — both copies hold identical answers — but these figures
-- feed the manager average and the hike, so they are recomputed here rather
-- than left describing a question set that no longer exists.
-- ============================================================================

do $mig$
declare
  v_removed   integer := 0;
  v_evals     integer := 0;
  v_row       record;
begin
  /* -- 1. The duplicates, keeping the earliest of each set.
        `sort_order` rather than `id`: it is the order the form was frozen in,
        so the copy kept is the one people met first. -- */
  create temporary table _dupes on commit drop as
  select eq.id, eq.evaluation_id, eq.question_id::text as qid
  from (
    select id, evaluation_id, question_id, text,
           row_number() over (
             partition by evaluation_id, text
             order by sort_order, id
           ) as rn
    from public.evaluation_questions
  ) eq
  join public.evaluations e on e.id = eq.evaluation_id
  where eq.rn > 1
    and e.status <> 'CLOSED';

  select count(*), count(distinct evaluation_id) into v_removed, v_evals from _dupes;

  if v_removed = 0 then
    raise notice '0098: nothing to remove — no live evaluation carries a duplicated question.';
    return;
  end if;

  /* A blast-radius guard. If this ever matches a whole cycle's worth of rows
     something has gone wrong upstream, and the right answer is to stop rather
     than to quietly delete a hundred frozen questions. */
  if v_removed > 5 then
    raise exception '0098: refusing to remove % rows across % evaluations — that is more than this repair was written for. Investigate before running it.',
      v_removed, v_evals;
  end if;

  /* -- 2. The answer and comment keys for the removed copy.
        Left behind they would be an answer to a question nobody is asked,
        which is exactly what P12-5 removes in the same statement as its own
        merge. Done BEFORE the row goes, so the id is still knowable. -- */
  for v_row in select distinct evaluation_id, qid from _dupes loop
    update public.evaluation_responses
       set answers  = answers  - v_row.qid,
           comments = comments - v_row.qid
     where evaluation_id = v_row.evaluation_id;
  end loop;

  /* -- 3. The rows themselves. -- */
  delete from public.evaluation_questions q using _dupes d where q.id = d.id;

  /* -- 4. The stored averages, recomputed over what is actually left.
        §11 stores a score at submission and never recomputes it on read — so
        after changing the question set, the stored figure has to be corrected
        here or it describes a form that no longer exists. Same rule as the
        scoring module: the unweighted mean of the answered SCALE_0_5
        questions, to two decimals. -- */
  update public.evaluation_responses r
     set overall_score = s.mean
    from (
      select r2.id,
             round(avg((r2.answers ->> eq.question_id::text)::numeric), 2) as mean
      from public.evaluation_responses r2
      join public.evaluation_questions eq on eq.evaluation_id = r2.evaluation_id
      where r2.evaluation_id in (select distinct evaluation_id from _dupes)
        and eq.response_type = 'SCALE_0_5'
        and r2.answers ? eq.question_id::text
        and (r2.answers ->> eq.question_id::text) ~ '^[0-9]+(\.[0-9]+)?$'
      group by r2.id
    ) s
   where r.id = s.id;

  /* The evaluation's own copies of the two headline figures. */
  update public.evaluations e
     set self_overall = (select r.overall_score from public.evaluation_responses r
                          where r.evaluation_id = e.id and r.layer = 'SELF'),
         lead_overall = (select r.overall_score from public.evaluation_responses r
                          where r.evaluation_id = e.id and r.layer = 'LEAD')
   where e.id in (select distinct evaluation_id from _dupes);

  /* -- 5. §12. The rows are gone, so this is the only remaining record that
        they were ever there. No actor: nobody pressed anything. -- */
  insert into public.audit_log (actor_id, entity, entity_id, action, diff, reason)
  select null, 'evaluation', d.evaluation_id, 'evaluation.duplicate_question_removed',
         jsonb_build_object('question_id', d.qid, 'snapshot_row', d.id, 'migration', '0098'),
         'The same question was frozen into this evaluation twice (a duplicate in the question bank). Both copies held identical answers; the repeat was removed and the stored averages recomputed.'
  from _dupes d;

  raise notice '0098: removed % duplicated question row(s) across % evaluation(s).', v_removed, v_evals;
end;
$mig$;

do $chk$
declare
  v_left integer;
begin
  select count(*) into v_left
  from (
    select evaluation_id, text
    from public.evaluation_questions eq
    join public.evaluations e on e.id = eq.evaluation_id
    where e.status <> 'CLOSED'
    group by evaluation_id, text
    having count(*) > 1
  ) x;

  if v_left > 0 then
    raise exception '0098: verification failed — % duplicated question(s) still on a live evaluation.', v_left;
  end if;

  raise notice '0098: verified — no live evaluation asks the same question twice.';
end;
$chk$;
