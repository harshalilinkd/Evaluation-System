-- =============================================================================
-- Make the first administrator.
--
-- SUPERSEDED BY grant-admin.sql — use that one.
--
-- This file used `\set admin_email '...'`, which is a psql META-COMMAND. Pasted
-- into the Supabase SQL editor it fails on line 1 with a bare syntax error at
-- "\", which reads as a broken script rather than as the wrong tool. The editor
-- speaks SQL, not psql.
--
-- grant-admin.sql does the same job in plain SQL, checks the account exists and
-- is confirmed before granting, and works in the editor. It is kept as a
-- separate file rather than this one being rewritten, because anyone who
-- bookmarked this path should be told where to go rather than silently handed
-- different behaviour.
-- =============================================================================

do $$
begin
  raise exception using
    message = 'Use supabase/grant-admin.sql instead.',
    detail  = 'This file needed psql. grant-admin.sql is plain SQL and runs in the Supabase SQL editor.',
    hint    = 'Open supabase/grant-admin.sql, change the email on line 14, and run the whole file.';
end;
$$;
