-- 0072 · Promotion and the recommended percentage are INCREMENT questions.
--
-- AT THE OWNER'S EXPLICIT INSTRUCTION, restating a distinction §1 already
-- makes: "in evaluation we just evaluate employees performance ... but no
-- salary discussion or salary part will be there. But in increment we have
-- Evaluation + increment hike on current salary."
--
-- WHAT WAS WRONG. `questions.cycle_scope` has existed since 0022 and assembly
-- has filtered on it since (PR-2). The EMPLOYEE's two salary questions were
-- seeded INCREMENT_ONLY at the time — 0022's expectation question and 0030's
-- note. The MANAGER's two never were, so they took the column default of
-- 'BOTH' and appeared on every form:
--
--   · Promotion recommendation          (0017, mgr.promotion)
--   · Recommended increment percentage  (0062, mgr.hike_percent)
--
-- So a plain EVALUATION cycle asked a HOD to recommend a promotion and a
-- percentage on a form whose cycle has no pay decision at the end of it (§8:
-- an EVALUATION cycle ends at CLOSED after the MD has read the report; only an
-- INCREMENT cycle continues into salary). The answers had nowhere to go.
--
-- THE SNAPSHOT RULE IS UNTOUCHED (§5). This edits the BANK. Every evaluation
-- already launched keeps the questions frozen into `evaluation_questions` at
-- its own launch, exactly as it was asked — which is the whole point of the
-- rule, and means a cycle currently running still shows them. Only cycles
-- launched from here on are affected.

/* ---------- The two manager questions ---------- */

do $$
declare
  v_promotion uuid := md5('linkd.q.mgr.promotion')::uuid;
  v_hike      uuid := md5('linkd.q.mgr.hike_percent')::uuid;
  v_moved     int  := 0;
begin
  /* -- Identified by the deterministic id, never by text.
        0017 derives every question id as md5('linkd.q.' || key) precisely so a
        later migration can find one without a lookup — and question TEXT is
        editable in the Form Builder, so a text match goes wrong the first time
        HR rewords something (F19-8). -- */

  update public.questions
     set cycle_scope = 'INCREMENT_ONLY'
   where id in (v_promotion, v_hike)
     and cycle_scope <> 'INCREMENT_ONLY';

  get diagnostics v_moved = row_count;

  /* -- The dependency survives, and that matters.
        0062 made the percentage conditional on the promotion answer being YES
        or CAN_BE_CONSIDERED. Both move together, so the parent is never absent
        from a form that still carries its child — which would leave a question
        that can never be revealed (P2-7's reasoning, from the other side). -- */
  if not exists (
    select 1 from public.questions
     where id = v_hike and depends_on = v_promotion
  ) then
    raise notice '0072: the percentage no longer depends on the promotion question. '
                 'Check 0062 was applied — the two must share a scope or the child '
                 'can never be shown.';
  end if;

  raise notice '0072: % question(s) moved to INCREMENT_ONLY. Evaluation cycles '
               'launched from now on will not ask them. Cycles ALREADY launched '
               'keep them, because a snapshot is frozen at launch (§5).', v_moved;
end;
$$;

/* ---------- §12 ---------- */
--
-- A question-bank change is one of the things §12 names explicitly. Recorded
-- against each question rather than as one batch row, so somebody asking "why
-- did this stop appearing" finds a row about that question.

insert into public.audit_log (actor_id, entity, entity_id, action, diff)
select
  null,
  'question',
  q.id,
  'question.cycle_scope_changed',
  jsonb_build_object(
    'before', 'BOTH',
    'after', 'INCREMENT_ONLY',
    'why', 'An EVALUATION cycle has no pay decision at the end of it (§1, §8), so it does not ask for one.'
  )
from public.questions q
where q.id in (md5('linkd.q.mgr.promotion')::uuid, md5('linkd.q.mgr.hike_percent')::uuid)
  and q.cycle_scope = 'INCREMENT_ONLY'
  -- Idempotent: a re-run writes no second row for the same change.
  and not exists (
    select 1 from public.audit_log a
     where a.entity = 'question'
       and a.entity_id = q.id
       and a.action = 'question.cycle_scope_changed'
  );
