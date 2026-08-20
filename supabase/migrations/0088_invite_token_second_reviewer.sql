-- 0088 · An invite link may be scoped to the second reviewer's layer.
--
-- REPORTED FROM PRODUCTION. Launching a cycle for a designer failed with
-- "An invite link can only be scoped to the SELF or LEAD layer." and the cycle
-- did not launch at all — so a person with a second reviewer could not be
-- appraised.
--
-- 0084 taught `issue_invite_token` WHO a LEAD_2 token belongs to and stopped
-- there. Three other things in the same area still know only two layers, and
-- they fail in that order:
--
--   1 · the function's own guard, `p_layer not in ('SELF','LEAD')` — the
--       message the owner saw, raised before anything else happens;
--   2 · the CHECK on `invite_tokens.layer`, which would refuse the row next;
--   3 · the DUE DATE, chosen with `case when p_layer = 'LEAD' … else self`, so
--       a LEAD_2 token would silently take the EMPLOYEE'S deadline and expire
--       on the wrong date — the one failure here that does not announce itself.
--
-- WHY THE SUITE DID NOT CATCH IT, recorded because the lesson is bigger than
-- the bug: 0084's test built a STUB `issue_invite_token` with no guard and no
-- constraint, so the patch was exercised against a function more permissive
-- than the real one. A stub that omits the checks is a stub that cannot fail
-- the way production fails. 0088's own test loads 0022's real body and 0022's
-- real constraint, reproduces the exact message first, and only then applies
-- this file.

do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'rating_layer' and e.enumlabel = 'LEAD_2'
  ) then
    raise exception '0088 requires 0082 (rating_layer.LEAD_2). Apply it first.';
  end if;
end $$;

/* ---------- 1 · The constraint ---------- */
-- Widened rather than dropped: the point of it is that a token is scoped to a
-- layer somebody actually fills, and MD is still not one of those — the MD has
-- an account and a queue, and §10 is explicit that a token "never grants access
-- to anything beyond that one evaluation", which is a way IN for somebody who
-- has none rather than a convenience for somebody who has one (PW-4).
alter table public.invite_tokens drop constraint if exists invite_tokens_layer_valid;
alter table public.invite_tokens add constraint invite_tokens_layer_valid
  check (layer in ('SELF', 'LEAD', 'LEAD_2'));

comment on column public.invite_tokens.layer is
  'Which layer this link opens. SELF lands on /my-evaluation; LEAD and LEAD_2 land on /team, each on its own manager''s form. None opens another.';

/* ---------- 2 · The function ---------- */
-- Short, whitespace-tolerant anchors, each asserted to occur exactly once and
-- each printing what it looked at on failure. 0084's first version matched a
-- six-line literal and found nothing in the deployed body.
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
    raise exception '0088: issue_invite_token not found. Apply 0006 and 0022 first.';
  end if;

  v_def := replace(v_def, chr(13), '');

  if position('''SELF'', ''LEAD'', ''LEAD_2''' in v_def) > 0 then
    raise notice '0088: issue_invite_token already accepts the third layer.';
    return;
  end if;

  /* -- 2a · The guard. This is the message that reached the owner. -- */
  v_pattern := 'p_layer\s+not\s+in\s*\(\s*''SELF''\s*,\s*''LEAD''\s*\)';
  v_hits := array_length(regexp_split_to_array(v_def, v_pattern), 1) - 1;
  if v_hits <> 1 then
    raise exception '0088: expected exactly one layer guard, found %.
Looked in: %', v_hits, substr(v_def, greatest(1, position('p_layer' in v_def) - 200), 900);
  end if;

  v_def := regexp_replace(v_def, v_pattern, 'p_layer not in (''SELF'', ''LEAD'', ''LEAD_2'')');

  -- And the sentence, so a future refusal names the layers that are actually
  -- allowed rather than the two it used to be.
  v_def := replace(
    v_def,
    'An invite link can only be scoped to the SELF or LEAD layer.',
    'An invite link can only be scoped to the SELF, LEAD or LEAD_2 layer.');

  /* -- 2b · THE DUE DATE, which is the quiet one.
        `case when p_layer = 'LEAD' then <lead dates> else <self dates> end`
        sends a LEAD_2 token down the ELSE branch, so the second reviewer's link
        would expire on the EMPLOYEE'S deadline. Both managers are sent the same
        form on the same day and share the manager deadline (§10's expiry is the
        due date plus seven days), so this is not a nicety: it is a link that
        stops working while the form is still open. -- */
  v_pattern := 'when\s+p_layer\s*=\s*''LEAD''\s+then\s+coalesce\(e\.due_lead_on';
  v_hits := array_length(regexp_split_to_array(v_def, v_pattern), 1) - 1;
  if v_hits <> 1 then
    raise exception '0088: expected exactly one due-date branch, found %.
Looked in: %', v_hits, substr(v_def, greatest(1, position('due_lead_on' in v_def) - 300), 900);
  end if;

  v_def := regexp_replace(
    v_def, v_pattern,
    'when p_layer in (''LEAD'', ''LEAD_2'') then coalesce(e.due_lead_on');

  /* -- 2c · The "nobody to send it to" message. A LEAD_2 token on an evaluation
        with no second reviewer would otherwise report "no employee assigned",
        which names the wrong person entirely. -- */
  v_pattern := 'case\s+when\s+p_layer\s*=\s*''LEAD''\s+then\s+''HOD assigned''\s+else\s+''employee''\s+end';
  v_hits := array_length(regexp_split_to_array(v_def, v_pattern), 1) - 1;
  if v_hits = 1 then
    v_def := regexp_replace(
      v_def, v_pattern,
      'case p_layer
        when ''LEAD'' then ''HOD assigned''
        when ''LEAD_2'' then ''second reviewer assigned''
        else ''employee'' end');
  else
    raise notice '0088: could not reword the missing-recipient message (% match(es)). The refusal still fires; it names the employee.', v_hits;
  end if;

  execute v_def;
  raise notice '0088: a second reviewer can be sent their own link.';
end $$;

do $$
begin
  raise notice '0088 applied. Launching a cycle for somebody with a second reviewer now works.';
end $$;
