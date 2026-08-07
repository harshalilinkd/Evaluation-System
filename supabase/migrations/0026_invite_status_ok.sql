-- 0026_invite_status_ok.sql
-- 0022's rewrite of `verify_invite_token` lost fidelity with its callers in
-- three places. Every invite link in the system currently fails to verify.
--
--   1. success is reported as 'VALID'; every caller expects 'OK'
--   2. the rate limit reports 'LOCKED'; the invite page handles 'RATE_LIMITED'
--   3. the `invite.rate_limited` audit row 0006 wrote is no longer written
--
-- WHAT IS BROKEN
--
-- 0006 returned 'OK' on the success path. 0022 rewrote the function to carry the
-- new `layer` column (P10-REV's dual tokens) and, in the rewrite, the success
-- literal became 'VALID':
--
--   return query select 'VALID'::text, t.id, t.evaluation_id, ...
--
-- `lib/auth/invites.ts` branches on `row.status === "OK"`, and its VerifyStatus
-- union has no 'VALID' member — so the success row falls through to the failure
-- branch and is cast to an error status. An employee opening the WhatsApp link
-- §10 sent them is told the link is not valid. **This is the whole distribution
-- path.**
--
-- WHY 'OK' IS THE CORRECT SIDE TO FIX
--
-- `consume_invite_token`, rewritten in the same migration a few lines below,
-- still returns 'OK'. So does every other status vocabulary in the pair —
-- INVALID, REVOKED, USED, EXPIRED, NO_SESSION, WRONG_RECIPIENT are identical
-- across both functions. 'VALID' is the single odd literal in the file, and the
-- TypeScript was never changed to meet it. This is a slip in the rewrite, not a
-- rename anybody carried through.
--
-- Patched by targeted replacement rather than restated, so the rest of a long
-- and already-tested body cannot drift (A1-5).
--
-- SAFE TO RE-RUN.

begin;

do $$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'verify_invite_token';

  if v_src is null then
    raise exception 'verify_invite_token is missing — apply 0006 and 0022 first.';
  end if;

  -- Already correct (a re-run, or a database that never saw 0022's slip).
  if v_src not like '%''VALID''::text%' and v_src not like '%''LOCKED''::text%' then
    return;
  end if;

  v_new := v_src;

  -- 1. Success. The app branches on "OK" and has no 'VALID' member.
  v_new := replace(v_new, '''VALID''::text', '''OK''::text');

  -- 2. The rate limit. `app/(public)/invite/[token]/page.tsx` has a
  --    `case "RATE_LIMITED"` that renders §10's "too many attempts" screen;
  --    'LOCKED' misses it and falls through to the generic error page, so a
  --    locked-out employee is told nothing useful.
  v_new := replace(v_new, '''LOCKED''::text', '''RATE_LIMITED''::text');

  -- 3. The lock is audited again. 0006 wrote this row and 0022's rewrite lost
  --    it. §12 requires "every token issue/use" be logged, and the lock is the
  --    single most security-relevant event this function has: without the row,
  --    a token being hammered until it locks leaves no trace anybody can find.
  --    Anchored on one line rather than the whole branch — pg_get_functiondef
  --    returns the body exactly as stored, and a multi-line match would be at
  --    the mercy of the original's line breaks.
  if v_new not like '%invite.rate_limited%' then
    v_new := replace(
      v_new,
      'if v_recent >= 10 then',
      'if v_recent >= 10 then'                                        || chr(10) ||
      '    insert into public.audit_log (actor_id, entity, entity_id, action)' || chr(10) ||
      '    values (null, ''invite_token'', t.id, ''invite.rate_limited'');');
  end if;

  if v_new = v_src then
    raise exception
      'verify_invite_token did not match any expected literal — patch it by hand rather than guessing.';
  end if;

  execute v_new;
end $$;

comment on function public.verify_invite_token(text) is
  'Verifies an invite token hash (§10). Success is ''OK'' and the rate limit is ''RATE_LIMITED'', matching consume_invite_token and lib/auth/invites.ts; the lock writes an invite.rate_limited audit row (§12). 0022 returned ''VALID''/''LOCKED'' and wrote no row, none of which any caller understood; corrected in 0026.';

commit;
