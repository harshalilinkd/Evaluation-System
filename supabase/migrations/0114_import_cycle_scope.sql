-- 0114 · The bulk Job Specific Skills import can scope a question to one form.
--
-- Reported as "in evaluation form we have simple 10 que only but when i
-- import its importing all que including increment form also". Exactly right:
-- 0034's `import_questions` hardcodes every NEW question's `cycle_scope` to
-- 'BOTH', with no way to say otherwise — so a file of department questions
-- meant for the Evaluation form alone lands on the Increment form's builder
-- too, because `cycle_scope` is how §6 decides which cycle type a question
-- appears on (0022), and 'BOTH' means both.
--
-- NO NEW CSV COLUMN. The owner has already rejected a per-question "which
-- cycles ask this?" control in the single-question editor, on the grounds
-- that the Evaluation/Increment TAB already answers it (editor-pane.tsx's own
-- comment records the instruction). A `cycle_scope` column on every row of a
-- spreadsheet would be the same jargon in a different place. Instead the
-- import DIALOG asks once, for the whole file, in plain language — "Which
-- form is this for?" — which is the question the import dialog is actually
-- answering and the TypeScript layer passes down as a single value.
--
-- THE FIX DOES NOT TOUCH AN EXISTING QUESTION'S SCOPE. A row matched by text
-- to a question already in the bank is left exactly as it is (0034's own
-- comment: "the lookup by text ... Retired questions are excluded
-- deliberately: a re-import must not quietly bring one back onto a form" —
-- the same caution applies to its scope). Only a question CREATED by this
-- import takes the chosen scope.
--
-- Patched from the LIVE body via `pg_get_functiondef`, not restated — 0034 is
-- the only migration that has ever created this function, but FIX-10's own
-- addendum found a patch missing on a stored CRLF body, and 0056 found one
-- reporting success while matching nothing. Every replacement is verified to
-- have matched exactly once.
--
-- Written against `public.`; applied to the `evaluation` schema the
-- deployment uses.

begin;

do $mig$
declare
  v_def  text;
  v_new  text;
  v_pat  constant text :=
    '(v_next_sort\s*,\s*)''BOTH''(\s*\)\s*returning\s+id\s+into\s+v_question_id\s*;)';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = current_schema() and p.proname = 'import_questions';

  if v_def is null then
    raise exception '0114: import_questions does not exist. Apply 0034 first.';
  end if;

  if (select count(*) from regexp_matches(v_def, v_pat)) = 0 then
    if v_def ~ 'cycle_scope\s*\)\>' and v_def ~ 'v_row\s*->>\s*''cycle_scope''' then
      raise notice '0114: import_questions already reads cycle_scope from the row.';
      return;
    end if;
    raise exception '0114: expected one hardcoded BOTH in import_questions and found none. Nothing was changed.';
  end if;

  if (select count(*) from regexp_matches(v_def, v_pat)) <> 1 then
    raise exception '0114: expected exactly one hardcoded BOTH in import_questions, found more. Nothing was changed.';
  end if;

  v_new := regexp_replace(
    v_def,
    v_pat,
    E'\\1coalesce(nullif(upper(btrim(v_row ->> ''cycle_scope'')), ''''), ''BOTH'')\\2'
  );
  execute v_new;
end;
$mig$;

-- Read the body back: the hardcoded literal must be gone and the new
-- expression must be present, reading from the row rather than fixed.
do $chk$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = current_schema() and p.proname = 'import_questions';

  if v_def ~ '(v_next_sort\s*,\s*)''BOTH''(\s*\)\s*returning\s+id\s+into\s+v_question_id\s*;)' then
    raise exception '0114: verification failed — the hardcoded BOTH is still present.';
  end if;

  if v_def !~ 'v_row\s*->>\s*''cycle_scope''' then
    raise exception '0114: verification failed — cycle_scope is not read from the row.';
  end if;
end;
$chk$;

commit;
