-- 0090 — The second pair of eyes, restored. HR proposes; only the MD approves.
--
-- ============================================================================
-- REVERSES 0056 AND 0060, AT THE OWNER'S EXPLICIT INSTRUCTION.
--
-- Reported from the HR screen: "hr dont have access to approve and close" —
-- the panel's own wording, "Management has not set a figure. You can approve
-- and close this yourself.", was read back and rejected. Asked directly
-- whether HR's ability to approve and close should be removed so only the MD
-- can, the answer was "Yes, MD-only from now on".
--
-- 0056 gave up the second pair of eyes on a pay decision deliberately, twice
-- instructed at the time ("either MD will do this or HR", then "give it close
-- option to hr also"), and said so in capitals in its own header. This
-- migration puts it back. What 0056 kept untouched is untouched here too: HR
-- still proposes, still cannot rewrite the MD's approval once it exists, and
-- the MD still cannot rewrite HR's proposal.
--
-- ANCHORED REGEX (`~`), NOT `LIKE '%A%B%C%'`, THROUGHOUT.
-- 0056's own bug — and the reason 0060 had to exist — was an existence check
-- that asked only whether three fragments appeared IN ORDER somewhere in the
-- function, not whether they belonged to the same CASE arm. This CASE has
-- several arms shaped like "HR_APPROVED ... MD_REVIEWED ... is_hr() or
-- is_md()" scattered across unrelated rows (0060's own comment lists three).
-- A loose membership check here would either report success while touching
-- nothing (0056's failure) or raise a false failure on a correct run, by
-- matching fragments borrowed from neighbouring arms. Every check below is a
-- SINGLE regex with the from/to clause and its `then` immediately adjacent
-- (only `\s+` as a gap), which cannot span two different arms.
--
-- TO RE-REVERSE: widen `apply_evaluation_transition`'s HR_APPROVED ->
-- MD_REVIEWED arm back to `is_hr() or is_md()`, widen the HR branch of
-- `increment_reviews_guard_columns` back to a bare permit, and put
-- `actors: ["HR_ADMIN", "MD"]` back on that row in `transitions.ts`.
-- ============================================================================

begin;

/* ---------- 1. §8: only the MD may record the review ---------- */

do $mig$
declare
  v_def     text;
  v_new     text;
  v_widened text :=
    'when p_from_status = ''HR_APPROVED'' and p_to_status = ''MD_REVIEWED''\s+then public\.is_hr\(\) or public\.is_md\(\)';
  v_narrow  text :=
    'when p_from_status = ''HR_APPROVED'' and p_to_status = ''MD_REVIEWED''\s+then public\.is_md\(\)';
begin
  select pg_get_functiondef(p.oid)
    into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'apply_evaluation_transition'
   limit 1;

  if v_def is null then
    raise exception '0090: apply_evaluation_transition does not exist. Apply 0021 first.';
  end if;

  if v_def !~ v_widened then
    if v_def ~ v_narrow then
      raise notice '0090: §8 arm already narrowed to the MD.';
    else
      raise exception
        '0090: neither the widened nor the narrowed HR_APPROVED -> MD_REVIEWED arm was found. The function has changed shape since this migration was written — check it by hand before proceeding.';
    end if;
  else
    v_new := regexp_replace(
      v_def, v_widened,
      'when p_from_status = ''HR_APPROVED'' and p_to_status = ''MD_REVIEWED'''
        || E'\n      then public.is_md()'
    );

    if v_new = v_def then
      raise exception
        '0090: the widened arm matched a lookup but not the replace. This should not happen — stop and check by hand.';
    end if;

    execute v_new;
    raise notice '0090: HR_APPROVED -> MD_REVIEWED narrowed to the MD alone.';
  end if;
end;
$mig$;

/* ---------- 2. The column guard: only the MD may set the approved figure ---------- */

do $guard$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid)
    into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'increment_reviews_guard_columns'
   limit 1;

  if v_def is null then
    raise exception '0090: increment_reviews_guard_columns does not exist. Apply 0030 first.';
  end if;

  /* -- A SINGLE fragment, not a multi-part membership check, so it does not
        carry the risk above. It is unique to the ORIGINAL (0030) comment text
        and cannot appear by accident. -- */
  if v_def like '%HR may not award themselves%' then
    raise notice '0090: the HR branch already refuses the MD''s columns.';
  else
    /* -- Restored VERBATIM from 0030 — this is not a rewording, it is the
          exact text the column guard carried before 0056 widened it, so the
          two migrations are exact inverses of each other. Matched on 0056's
          own distinctive sentence, which appears nowhere else in this
          function, so the non-greedy span cannot run past the HR block into
          the MD's identically-shaped one beneath it. -- */
    v_new := regexp_replace(
      v_def,
      'if public\.is_hr\(\) then.*?who really pressed it\.\s*return new;\s*end if;',
      'if public.is_hr() then' || E'\n'
        || '    -- HR may not award themselves the MD''s approval.' || E'\n'
        || '    if new.md_approved_ctc      is distinct from old.md_approved_ctc' || E'\n'
        || '       or new.md_approved_hike_pct is distinct from old.md_approved_hike_pct' || E'\n'
        || '       or new.md_remarks           is distinct from old.md_remarks then' || E'\n'
        || '      raise exception' || E'\n'
        || '        ''The approved figure is the MD''''s to set. HR proposes; the MD approves.''' || E'\n'
        || '        using errcode = ''insufficient_privilege'';' || E'\n'
        || '    end if;' || E'\n'
        || '    return new;' || E'\n'
        || '  end if;',
      ''
    );

    if v_new = v_def then
      raise exception '0090: could not find 0056''s widened HR branch. Nothing was changed.';
    end if;

    execute v_new;
    raise notice '0090: the column guard refuses HR the approved figure again.';
  end if;
end;
$guard$;

/* ---------- 3. Prove both took, and that the MD's own restriction is untouched ---------- */

do $chk$
declare
  v_t text;
  v_g text;
  v_widened text :=
    'when p_from_status = ''HR_APPROVED'' and p_to_status = ''MD_REVIEWED''\s+then public\.is_hr\(\) or public\.is_md\(\)';
  v_narrow  text :=
    'when p_from_status = ''HR_APPROVED'' and p_to_status = ''MD_REVIEWED''\s+then public\.is_md\(\)';
begin
  select pg_get_functiondef(oid) into v_t from pg_proc
   where proname = 'apply_evaluation_transition'
     and pronamespace = 'public'::regnamespace limit 1;

  select pg_get_functiondef(oid) into v_g from pg_proc
   where proname = 'increment_reviews_guard_columns'
     and pronamespace = 'public'::regnamespace limit 1;

  if v_t ~ v_widened then
    raise exception '0090: verification failed — HR can still record the MD review.';
  end if;

  if v_t !~ v_narrow then
    raise exception '0090: verification failed — the MD''s own arm did not survive.';
  end if;

  if v_g not like '%HR may not award themselves%' then
    raise exception '0090: verification failed — HR can still set the approved figure.';
  end if;

  /* -- The half that must NOT have moved. Same fragment 0056 checked, chosen
        for the same reason: it has no apostrophe in it, so a LIKE pattern
        cannot be got wrong by doubling or not doubling a quote. -- */
  if v_g not like '%expectation are not the MD%' then
    raise exception
      '0090: the MD''s own branch was altered. It must not be — this narrows one direction only.';
  end if;

  raise notice '0090: HR proposes; only the MD approves and closes. The second pair of eyes is restored.';
end;
$chk$;

commit;
