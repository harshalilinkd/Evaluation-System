-- =============================================================================
-- 0011_self_answers.sql — Conflict-safe autosave for a layer's answers.
-- Phase P12. CLAUDE.md §5 (JSONB shape), §8 (locking rule), §9 (RLS).
-- =============================================================================
--
-- WHY THIS IS A FUNCTION AND NOT AN UPDATE
--
-- P12: "send only changed keys and merge server-side into the answers JSONB
-- rather than overwriting the whole object."
--
-- The failure it prevents is specific and easy to hit. Autosave fires every
-- 800ms. Two saves in flight, the first carrying {q1: 3} and the second
-- {q1: 3, q2: 4}, can land out of order — and if each writes the WHOLE answers
-- object, the older one wins and q2 silently vanishes. The employee sees their
-- answer disappear and has no idea why.
--
-- Merging a patch is order-independent for distinct keys: the same two writes
-- in either order leave both answers present. `||` on jsonb is exactly that
-- merge, done inside the database where the read and the write cannot be
-- separated by a network round trip.
--
-- WHY THE LOCKING RULE IS ENFORCED HERE TOO
--
-- §8: "once a layer is submitted it is read-only downstream forever, unless an
-- explicit return transition unlocks it." That is checked in the action, in RLS,
-- and again here — because this function is granted to `authenticated` and is
-- therefore callable directly through PostgREST with arguments of the caller's
-- choosing. An autosave path that could write to a submitted layer would undo
-- the whole state machine.
-- =============================================================================

create or replace function public.merge_evaluation_answers(
  p_evaluation_id uuid,
  p_layer         public.rating_layer,
  p_answers_patch jsonb,
  p_comments_patch jsonb default '{}'::jsonb,
  -- Keys whose questions have become hidden. §6: "Hidden questions are not
  -- validated and not stored." Removed in the same statement as the merge, so a
  -- flipped conditional never leaves an orphaned answer behind.
  p_remove_keys   text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller     uuid := (select auth.uid());
  v_eval       public.evaluations%rowtype;
  v_row        public.evaluation_responses%rowtype;
  v_answers    jsonb;
  v_comments   jsonb;
  v_key        text;
begin
  if v_caller is null then
    raise exception 'You must be signed in to save answers.'
      using errcode = 'insufficient_privilege';
  end if;

  if jsonb_typeof(coalesce(p_answers_patch, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_comments_patch, '{}'::jsonb)) <> 'object' then
    -- §5: the JSONB shape is a flat object, never an array and never nested.
    raise exception 'Answers must be a flat object keyed by question id.'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_eval from public.evaluations where id = p_evaluation_id;
  if not found then
    raise exception 'No evaluation with id %.', p_evaluation_id using errcode = 'no_data_found';
  end if;

  /* -- Who may write which layer (§9) -- */
  --
  -- Re-derived here rather than trusted. The SELF layer belongs to the
  -- evaluatee; the LEAD layer to the lead named on the evaluation, not to
  -- "any HOD"; the MD layer to the MD.
  if p_layer = 'SELF' then
    if v_caller <> v_eval.evaluatee_id then
      raise exception 'Only the employee can write their own self-evaluation.'
        using errcode = 'insufficient_privilege';
    end if;
    if v_eval.status <> 'CYCLE_ACTIVE' then
      raise exception 'This evaluation is no longer open for editing.'
        using errcode = 'invalid_parameter_value';
    end if;

  elsif p_layer = 'LEAD' then
    if v_caller is distinct from v_eval.lead_id then
      raise exception 'Only the assigned lead can write this review.'
        using errcode = 'insufficient_privilege';
    end if;
    if v_eval.status <> 'SELF_SUBMITTED' then
      raise exception 'This evaluation is not ready for a lead review.'
        using errcode = 'invalid_parameter_value';
    end if;

  else
    if not public.is_md() then
      raise exception 'Only the MD can write the final layer.'
        using errcode = 'insufficient_privilege';
    end if;
    if v_eval.status <> 'LEAD_REVIEWED' then
      raise exception 'This evaluation is not ready for a final decision.'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  if v_eval.excluded_at is not null then
    raise exception 'This person has been withdrawn from the cycle.'
      using errcode = 'invalid_parameter_value';
  end if;

  /* -- The row -- */
  select * into v_row
  from public.evaluation_responses
  where evaluation_id = p_evaluation_id and layer = p_layer
  for update;

  if not found then
    -- Launch creates the SELF row; the LEAD and MD rows appear on first write.
    insert into public.evaluation_responses (evaluation_id, layer, answers, comments)
    values (p_evaluation_id, p_layer, '{}'::jsonb, '{}'::jsonb)
    returning * into v_row;
  end if;

  -- §8's locking rule. A submitted layer is read-only until a return clears
  -- submitted_at, and this is the last place that can be enforced.
  if v_row.submitted_at is not null then
    raise exception 'This layer has been submitted and can no longer be edited.'
      using errcode = 'invalid_parameter_value';
  end if;

  /* -- Merge, then remove -- */
  v_answers  := coalesce(v_row.answers, '{}'::jsonb)  || coalesce(p_answers_patch, '{}'::jsonb);
  v_comments := coalesce(v_row.comments, '{}'::jsonb) || coalesce(p_comments_patch, '{}'::jsonb);

  -- Removal happens AFTER the merge, so a key that is both patched and hidden
  -- ends up absent. That ordering matters when a parent and its child change in
  -- the same keystroke.
  if p_remove_keys is not null then
    foreach v_key in array p_remove_keys loop
      v_answers  := v_answers  - v_key;
      v_comments := v_comments - v_key;
    end loop;
  end if;

  update public.evaluation_responses
  set answers = v_answers, comments = v_comments
  where id = v_row.id;

  -- The merged state is returned so the client can reconcile without a second
  -- round trip — and so a save that raced another one can see what actually won.
  return jsonb_build_object('answers', v_answers, 'comments', v_comments);
end;
$$;

revoke all on function public.merge_evaluation_answers(uuid, public.rating_layer, jsonb, jsonb, text[]) from public;
grant execute on function public.merge_evaluation_answers(uuid, public.rating_layer, jsonb, jsonb, text[]) to authenticated;

comment on function public.merge_evaluation_answers is
  'Conflict-safe autosave (P12). Merges a patch into answers/comments rather than overwriting, so two in-flight saves cannot lose an answer. Re-checks the §8 locking rule and §9 layer ownership.';
