-- =============================================================================
-- 0014_md_finalise.sql — the MD finalise transaction. Phase P14.
-- CLAUDE.md §8 (state machine), §11 (scoring), §12 (audit).
-- =============================================================================
--
-- NO SCHEMA CHANGE. evaluation_decisions has carried every column this needs
-- since 0003; the MD layer is an ordinary evaluation_responses row; the
-- transition already exists. What is missing is ATOMICITY across the four
-- writes, and that is all this function adds.
--
-- WHY IT MUST BE ONE TRANSACTION
--
-- Finalising does four things: writes the MD layer, writes the decisions,
-- transitions to MD_FINALIZED, and audits each override. Done as four calls
-- from TypeScript, a failure between any two leaves a state nobody can explain
-- — decisions recorded against an evaluation still sitting at LEAD_REVIEWED, or
-- an evaluation finalised with no salary decision attached to it. Neither can be
-- unwound afterwards, because §8 has no path back from MD_FINALIZED except
-- CLOSED.
--
-- THE SPLIT IS P10's, FOR P10's REASON
--
-- The resolved answers and the section scores are computed in TypeScript by
-- computeFinalScores (§11, P4-12) and passed in. Reimplementing §11's means in
-- PL/pgSQL would give two scoring algorithms that must agree forever, and a
-- final score is the number a salary decision was made against. So: TypeScript
-- decides, SQL commits.
--
-- THE RULE THIS FUNCTION EXISTS TO PROTECT
--
-- P14: "Write the MD layer with an EXPLICIT final value for every scored
-- question — the override where one was given, otherwise the lead's score. No
-- nulls with an implied fallback. This is the rule that keeps history honest."
--
-- The check below refuses the whole transaction if a single scored question
-- would land null. Anything downstream computing `override ?? lead` at read
-- time would disagree with the stored value the moment the lead layer is
-- returned and resubmitted — which is precisely how a historical comparison
-- stops being honest.
-- =============================================================================

create or replace function public.finalise_evaluation(
  p_evaluation_id   uuid,
  -- Every scored question, resolved. Not a sparse set of overrides.
  p_resolved_answers jsonb,
  p_section_scores   jsonb,
  p_overall_score    numeric,
  -- The decision record. Keys map to evaluation_decisions columns.
  p_decisions        jsonb,
  -- [{question_id, lead_value, md_value}, ...] — only where they differ.
  p_overrides        jsonb default '[]'::jsonb,
  -- Ids of every SCALE_0_5 question in the snapshot, so the completeness check
  -- below knows what "every scored question" means without re-deriving it.
  p_scored_ids       uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller   uuid := (select auth.uid());
  v_eval     public.evaluations%rowtype;
  v_id       uuid;
  v_override jsonb;
  v_missing  text[] := '{}';
  v_count    integer := 0;
begin
  if v_caller is null or not public.is_admin() then
    raise exception 'Only management can finalise an evaluation.'
      using errcode = 'insufficient_privilege';
  end if;

  /* -- 1. Row lock. -- */
  --
  -- P14: "The MD opens an evaluation another MD is finalising: take a row lock
  -- and show 'This is being finalised by {name} right now.'" Two MDs pressing
  -- Finalise at the same instant would otherwise both read LEAD_REVIEWED and
  -- both proceed; the second would write decisions over the first's.
  select * into v_eval from public.evaluations where id = p_evaluation_id for update;

  if not found then
    raise exception 'No evaluation with id %.', p_evaluation_id using errcode = 'no_data_found';
  end if;

  if v_eval.status <> 'LEAD_REVIEWED' then
    raise exception
      'This evaluation is at % and cannot be finalised. It may have been finalised already.',
      v_eval.status
      using errcode = 'invalid_parameter_value';
  end if;

  if v_eval.excluded_at is not null then
    raise exception 'This person has been withdrawn from the cycle.'
      using errcode = 'invalid_parameter_value';
  end if;

  /* -- 2. Completeness: every scored question carries an explicit value. -- */
  --
  -- Checked here rather than trusted from the caller. This is the acceptance
  -- criterion "a database check confirms no nulls in the MD layer", and it is
  -- enforced at the only point where it still can be.
  foreach v_id in array coalesce(p_scored_ids, '{}'::uuid[])
  loop
    if p_resolved_answers -> (v_id::text) is null
       or jsonb_typeof(p_resolved_answers -> (v_id::text)) = 'null' then
      v_missing := v_missing || v_id::text;
    end if;
  end loop;

  if array_length(v_missing, 1) > 0 then
    raise exception
      'Cannot finalise: % scored question(s) have no final value. Every one must resolve to the override or the lead''s score.',
      array_length(v_missing, 1)
      using errcode = 'invalid_parameter_value';
  end if;

  /* -- 3. Decisions. -- */
  --
  -- Written BEFORE the transition, deliberately: §8's guard on
  -- LEAD_REVIEWED -> MD_FINALIZED is "decisions recorded", and the guard should
  -- find them already there rather than trusting that a later statement will
  -- add them.
  insert into public.evaluation_decisions (
    evaluation_id, promotion_recommendation, increment_type, old_salary,
    increment_pct, new_salary, training_required, concerns, md_remarks,
    decided_by, decided_at
  )
  values (
    p_evaluation_id,
    p_decisions ->> 'promotion_recommendation',
    p_decisions ->> 'increment_type',
    (p_decisions ->> 'old_salary')::numeric,
    (p_decisions ->> 'increment_pct')::numeric,
    (p_decisions ->> 'new_salary')::numeric,
    (p_decisions ->> 'training_required')::boolean,
    p_decisions ->> 'concerns',
    p_decisions ->> 'md_remarks',
    v_caller,
    now()
  )
  on conflict (evaluation_id) do update set
    promotion_recommendation = excluded.promotion_recommendation,
    increment_type           = excluded.increment_type,
    old_salary               = excluded.old_salary,
    increment_pct            = excluded.increment_pct,
    new_salary               = excluded.new_salary,
    training_required        = excluded.training_required,
    concerns                 = excluded.concerns,
    md_remarks               = excluded.md_remarks,
    decided_by               = excluded.decided_by,
    decided_at               = excluded.decided_at;

  /* -- 4. The transition: MD layer, scores, lock and the status audit row. -- */
  --
  -- apply_evaluation_transition writes the resolved answers onto the MD
  -- response row, stamps submitted_at/submitted_by, stores the section scores
  -- and the overall, moves the status and writes the audit row — all of which
  -- this function is now inside the transaction of.
  perform public.apply_evaluation_transition(
    p_evaluation_id  => p_evaluation_id,
    p_from_status    => 'LEAD_REVIEWED',
    p_to_status      => 'MD_FINALIZED',
    p_actor_id       => v_caller,
    p_action         => 'evaluation.md_finalize',
    p_reason         => null,
    p_diff           => jsonb_build_object(
                          'overrides', jsonb_array_length(coalesce(p_overrides, '[]'::jsonb)),
                          'final_overall', p_overall_score
                        ),
    p_evaluation_patch => jsonb_build_object('final_overall', p_overall_score),
    p_lock_layer     => 'MD',
    p_answers        => p_resolved_answers,
    p_section_scores => p_section_scores,
    p_overall_score  => p_overall_score
  );

  /* -- 5. One audit row per override. -- */
  --
  -- §12 requires an audit row for "every MD override". Separate rows rather
  -- than one row carrying an array: an override is a decision about one
  -- question, and a reviewer asking "why is this 4 when the lead said 2"
  -- should find a row about that question, not have to unpack a blob.
  for v_override in select * from jsonb_array_elements(coalesce(p_overrides, '[]'::jsonb))
  loop
    insert into public.audit_log (actor_id, entity, entity_id, action, diff)
    values (
      v_caller, 'evaluation', p_evaluation_id, 'evaluation.md_override',
      jsonb_build_object(
        'question_id', v_override ->> 'question_id',
        'lead_value',  v_override -> 'lead_value',
        'md_value',    v_override -> 'md_value'
      )
    );
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'evaluation_id', p_evaluation_id,
    'final_overall', p_overall_score,
    'overrides', v_count
  );
end;
$$;

revoke all on function public.finalise_evaluation(uuid, jsonb, jsonb, numeric, jsonb, jsonb, uuid[]) from public;
grant execute on function public.finalise_evaluation(uuid, jsonb, jsonb, numeric, jsonb, jsonb, uuid[]) to authenticated;

comment on function public.finalise_evaluation is
  'All-or-nothing MD finalise (P14). Refuses any payload where a scored question would land without an explicit final value (§11), and writes one audit row per override (§12). Scores are computed in TypeScript by computeFinalScores and passed in, so there is exactly one scoring algorithm.';
