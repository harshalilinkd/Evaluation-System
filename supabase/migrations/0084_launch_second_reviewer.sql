-- 0084 · Launch opens the third form.
--
-- Requires 0083. Without it `co_lead_id` does not exist and this would create a
-- function that fails at run time rather than at apply time — a plpgsql body is
-- not resolved at CREATE, which is how 0033's first attempt would have shipped a
-- broken `merge_evaluation_answers` (F9-3).

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'evaluations' and column_name = 'co_lead_id'
  ) then
    raise exception '0084 requires 0083 (evaluations.co_lead_id). Apply it first.';
  end if;
end $$;

/* ==========================================================================
   PATCHED IN PLACE, and matched by SHORT ANCHOR rather than by long literal.
   ==========================================================================
   `launch_cycle` is ~200 lines and every one of them is already tested.
   Retyping it to change three things invites a transcription error into the one
   function that writes a whole cycle at once — A1-5, P19B-17 and F2-3 all made
   this call for the same reason.

   THE FIRST VERSION OF THIS FILE MATCHED A SIX-LINE LITERAL AND FOUND NOTHING.
   That literal is byte-for-byte what 0022 contains — so the deployed body is
   not byte-for-byte what 0022 contains, and nothing in this repository can say
   how it differs. That is the lesson rather than the accident: a patch that has
   to reproduce six lines exactly is betting on six lines never having been
   reformatted, re-applied from a differently-ended copy, or edited by hand.
   FIX-10's addendum lost that bet on a single newline; 0056 lost it in the
   other direction and reported success.

   So every anchor below is ONE line, matched as a whitespace-tolerant regex,
   asserted to occur EXACTLY once, and every failure prints the region of the
   real body it was looking in — so a second miss diagnoses itself rather than
   sending somebody back here to guess again.
   ========================================================================== */
do $$
declare
  v_def     text;
  v_pattern text;
  v_add     text;
  v_hits    integer;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'launch_cycle';

  if v_def is null then
    raise exception '0084: launch_cycle not found. Apply 0009 and 0022 first.';
  end if;

  v_def := replace(v_def, chr(13), '');

  if position('co_lead_id' in v_def) > 0 then
    raise notice '0084: launch_cycle already opens the third form. Nothing to do.';
    return;
  end if;

  /* ---- The whole of the launch-side work, spliced at ONE anchor ----
     `v_evaluations := v_evaluations + 1;` is the last statement of the
     per-participant loop: one line, exactly one occurrence, and everything
     needed is in scope there — `v_evaluation` is this participant and `v_item`
     is their entry in the payload.

     At the END of the loop body rather than beside the SELF/LEAD insert, so the
     evaluation has already reached OPEN through §8's own function and the third
     form opens into the same state as the other two.

     THE SECOND REVIEWER IS COPIED, exactly as `lead_id` was at creation (P3-6):
     a reorganisation mid-cycle must not silently reassign a review that is
     already being written.

     REFUSED WHERE IT WOULD NOT BE A SECOND OPINION — the same person as the
     lead, or the evaluatee themselves. One person filling two manager forms is
     one opinion recorded twice, and under blind rating the evaluatee filling a
     manager form sees both sides. Skipped rather than raised: a whole cycle's
     launch should not fail because one person's master data is odd, and the
     ordinary two-form flow is the correct fallback (PR-8 made the same call for
     a self-led participant). */
  v_pattern := 'v_evaluations\s*:=\s*v_evaluations\s*\+\s*1\s*;';

  v_hits := array_length(regexp_split_to_array(v_def, v_pattern), 1) - 1;
  if v_hits <> 1 then
    raise exception '0084: expected exactly one participant counter in launch_cycle, found %.
Looked in: %', v_hits,
      substr(v_def, greatest(1, position('evaluation_responses' in v_def) - 400), 1200);
  end if;

  v_add := '
    /* -- 0084: a second manager, where the evaluatee carries one. -- */
    update public.evaluations e
       set co_lead_id = p.co_reviewer_id
      from public.profiles p
     where e.id = v_evaluation.id
       and p.id = e.evaluatee_id
       and p.co_reviewer_id is not null
       and p.co_reviewer_id is distinct from e.lead_id
       and p.co_reviewer_id is distinct from e.evaluatee_id;

    select * into v_evaluation from public.evaluations where id = v_evaluation.id;

    if v_evaluation.co_lead_id is not null then
      insert into public.evaluation_responses (evaluation_id, layer, answers, comments)
      values (v_evaluation.id, ''LEAD_2'', ''{}''::jsonb, ''{}''::jsonb)
      on conflict (evaluation_id, layer) do nothing;

      /* §10 scopes a token to (evaluation, layer, channel). Reusing the lead''s
         would open the LEAD form for the coordinator — not a wrong page but a
         blindness breach (F12-2 made the same point about the email link). */
      if v_item ? ''co_lead_token_hash'' then
        perform public.issue_invite_token(
          v_evaluation.id, v_item ->> ''channel'', v_item ->> ''co_lead_token_hash'', ''LEAD_2'');
        v_tokens := v_tokens + 1;
      end if;
    end if;

    v_evaluations := v_evaluations + 1;';

  v_def := regexp_replace(v_def, v_pattern, v_add);

  /* ---- §12: the audit diff names the second reviewer ----
     BEST EFFORT, deliberately. The copy above is the behaviour; this is
     enrichment of a diff that already records the launch. Raising here would
     let a formatting drift in one jsonb line block a working feature, so it
     reports instead — the evaluation row still says who the second reviewer is,
     and 0083's own trail is untouched. */
  v_pattern := '''lead_id''\s*,\s*v_evaluation\.lead_id\s*,';
  v_hits := array_length(regexp_split_to_array(v_def, v_pattern), 1) - 1;
  if v_hits = 1 then
    v_def := regexp_replace(
      v_def, v_pattern,
      '''lead_id'', v_evaluation.lead_id,
                           ''co_lead_id'', v_evaluation.co_lead_id,');
  else
    raise notice '0084: could not enrich the launch audit diff (% match(es)). The second reviewer is still recorded on the evaluation row.', v_hits;
  end if;

  execute v_def;
  raise notice '0084: launch_cycle now opens a third form for anybody with a second reviewer.';
end $$;

/* ---------- The token issuer must know the third layer ---------- */
-- 0022 decides the RECIPIENT from the layer: `case when p_layer = 'LEAD' then
-- e.lead_id else e.evaluatee_id end`. Left alone, a LEAD_2 token would be issued
-- to the EVALUATEE — so the coordinator's link would be refused as the wrong
-- recipient, and the designer would hold a token for a form that is not theirs.
-- The same else-branch that makes SELF correct makes this wrong.
do $$
declare
  v_def     text;
  v_pattern text;
  v_hits    integer;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'issue_invite_token';

  if v_def is null then
    raise exception '0084: issue_invite_token not found. Apply 0006 and 0022 first.';
  end if;

  v_def := replace(v_def, chr(13), '');

  if position('LEAD_2' in v_def) > 0 then
    raise notice '0084: issue_invite_token already knows the third layer.';
    return;
  end if;

  v_pattern := 'case\s+when\s+p_layer\s*=\s*''LEAD''\s+then\s+e\.lead_id\s+else\s+e\.evaluatee_id\s+end';
  v_hits := array_length(regexp_split_to_array(v_def, v_pattern), 1) - 1;
  if v_hits <> 1 then
    raise exception '0084: expected exactly one recipient CASE in issue_invite_token, found %.
Looked in: %', v_hits, substr(v_def, greatest(1, position('p_layer' in v_def) - 300), 900);
  end if;

  v_def := regexp_replace(v_def, v_pattern,
    'case p_layer
                  when ''LEAD'' then e.lead_id
                  when ''LEAD_2'' then e.co_lead_id
                  else e.evaluatee_id end');

  execute v_def;
  raise notice '0084: issue_invite_token issues a LEAD_2 token to the second reviewer.';
end $$;

/* ---------- Autosave must accept the third layer ---------- */
-- `merge_evaluation_answers` is the ONLY write path a form has (FIX-2), and it
-- branches per layer. Without an arm the coordinator's every keystroke is
-- refused — precisely the bug FIX-2 spent a migration on when the LEAD arm
-- named a status no row could hold.
--
-- `v_eval` and `v_caller` are 0011's own names, read from the function rather
-- than guessed: an earlier draft used `v_row.co_lead_id`, and `v_row` DOES
-- exist — as an `evaluation_responses` rowtype, which has no such column. That
-- compiles and raises at the first call, so it would have shipped and broken
-- the coordinator's first keystroke.
do $$
declare
  v_def     text;
  v_pattern text;
  v_hits    integer;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'merge_evaluation_answers';

  if v_def is null then
    raise exception '0084: merge_evaluation_answers not found. Apply 0011 and 0033 first.';
  end if;

  v_def := replace(v_def, chr(13), '');

  if position('LEAD_2' in v_def) > 0 then
    raise notice '0084: merge_evaluation_answers already accepts the third layer.';
    return;
  end if;

  v_pattern := 'elsif\s+p_layer\s*=\s*''LEAD''\s+then';
  v_hits := array_length(regexp_split_to_array(v_def, v_pattern), 1) - 1;
  if v_hits <> 1 then
    raise exception '0084: expected exactly one LEAD arm in merge_evaluation_answers, found %.
Looked in: %', v_hits, substr(v_def, greatest(1, position('p_layer' in v_def) - 300), 1200);
  end if;

  -- The gate is the LEAD arm's own shape: the caller must be that layer's
  -- reviewer, the record must be OPEN, and the layer must be open on its OWN
  -- timestamp (§8, A3-3) — never on another layer's, which would make one
  -- person's progress observable through whether the other's form saved (A3-8).
  v_def := regexp_replace(v_def, v_pattern,
    'elsif p_layer = ''LEAD_2'' then
    if v_caller is distinct from v_eval.co_lead_id then
      raise exception ''Only the second reviewer can write this review.''
        using errcode = ''insufficient_privilege'';
    end if;
    if v_eval.status <> ''OPEN'' or not public.co_lead_open(p_evaluation_id) then
      raise exception ''This review is no longer open for editing.''
        using errcode = ''check_violation'';
    end if;

  elsif p_layer = ''LEAD'' then');

  execute v_def;
  raise notice '0084: merge_evaluation_answers accepts the second reviewer''s layer.';
end $$;

do $$
begin
  raise notice '0084 applied. Anybody with profiles.co_reviewer_id set now gets a third form at launch.';
end $$;
