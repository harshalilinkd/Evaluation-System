-- 0033_parallel_layer_writes.sql
-- Autosave still enforced the sequential flow AMEND-3 replaced. Nobody could save.
--
-- AMEND-3 moved the staff machine to DRAFT → OPEN → PENDING_HR_REVIEW → … and
-- migrated every live row onto it. 0021 rewrote the RLS policies to match:
-- `status = 'OPEN'` plus `self_open()` / `lead_open()`, which is A3-3's rule —
-- a layer's write gate is its OWN timestamp, not the record's status.
--
-- It never touched `merge_evaluation_answers`, and that function is the only
-- write path autosave has. It is SECURITY DEFINER, so it runs as the owner and
-- RLS never sees the write: its three internal status checks are the whole gate,
-- and all three name statuses that 0021's `evaluations_status_current` CHECK now
-- forbids. Every one of them is therefore unreachable:
--
--   SELF  wanted CYCLE_ACTIVE   → 'This evaluation is no longer open for editing.'
--   LEAD  wanted SELF_SUBMITTED → 'This evaluation is not ready for a lead review.'
--   MD    wanted LEAD_REVIEWED  → 'This evaluation is not ready for a final decision.'
--
-- The LEAD message is the one that was reported, and it was worse than a refusal:
-- it stated the opposite of the product's central rule. Under blind parallel
-- rating (§1) the HOD's form opens at launch and they rate WITHOUT waiting for
-- the employee — that is the whole point, since neither side may see the other.
-- The employee's own autosave was failing identically and had not been noticed.
--
-- Patched rather than restated, per A1-5 and P19B-17: each of these differs from
-- a long, already-tested body by one condition, and retyping the rest invites a
-- transcription error into a function nobody would re-read. Every replacement
-- verifies it matched something and raises if it did not, so this cannot
-- silently no-op against an unexpected deployed version.

/* ---------- Preconditions ---------- */
--
-- The new body calls 0021's helpers. If 0021 has not been applied, failing here
-- with a sentence is very much better than failing later inside autosave.

do $patch$
begin
  if to_regprocedure('public.self_open(uuid)') is null
     or to_regprocedure('public.lead_open(uuid)') is null then
    raise exception
      '0033 requires 0021_blind_rating.sql (self_open/lead_open are missing). Apply 0021 first.';
  end if;
end;
$patch$;


/* ---------- The patch ---------- */

do $patch$
declare
  v_src text;
  v_new text;

  -- old text, new text. Checked one pair at a time so the error names which.
  v_pairs text[][] := array[
    -- SELF. The record is OPEN, and the employee's own layer is still unsubmitted
    -- and not skipped. `self_open()` is what carries the skipped case: HR
    -- advancing past a missing layer must not leave it writable.
    array[
      'if v_eval.status <> ''CYCLE_ACTIVE'' then',
      'if v_eval.status <> ''OPEN'' or not public.self_open(p_evaluation_id) then'
    ],

    -- LEAD. The same shape, and deliberately NOT a function of the employee's
    -- side. §1: the two rate at the same time, blind to each other. A gate that
    -- consulted `self_submitted_at` would also be a readout of the employee's
    -- progress, which A3-8 keeps out of every lead-facing path.
    array[
      'if v_eval.status <> ''SELF_SUBMITTED'' then',
      'if v_eval.status <> ''OPEN'' or not public.lead_open(p_evaluation_id) then'
    ],

    -- The message went with it. It did not merely refuse — it told the HOD the
    -- form was not ready, which is the opposite of the rule the product is
    -- built on, and would send them to HR to ask about a working screen.
    array[
      'This evaluation is not ready for a lead review.',
      'This review is no longer open for editing.'
    ],

    -- MD. §8 gives the MD their read at HR_APPROVED → MD_REVIEWED, so that is
    -- the status at which this layer is writable. LEAD_REVIEWED is retired and
    -- left this branch as unreachable as the other two.
    --
    -- The ROLE on this branch is left alone. 0012 merged it to is_admin() and
    -- AMEND-2 has since re-split HR and MD, so it is very likely wrong — but
    -- that is a §9 access-matrix change affecting sixteen policies, and it does
    -- not belong in a fix for a stuck form. Recorded, not smuggled.
    array[
      'if v_eval.status <> ''LEAD_REVIEWED'' then',
      'if v_eval.status <> ''HR_APPROVED'' then'
    ]
  ];

  v_i int;
begin
  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'merge_evaluation_answers';

  if v_src is null then
    raise exception '0033: public.merge_evaluation_answers does not exist. Apply 0011 and 0012 first.';
  end if;

  v_new := v_src;

  for v_i in 1 .. array_length(v_pairs, 1) loop
    -- Idempotent: a second run finds the replacement already in place and
    -- moves on. Only a body that has NEITHER form is a genuine surprise.
    if strpos(v_new, v_pairs[v_i][1]) > 0 then
      v_new := replace(v_new, v_pairs[v_i][1], v_pairs[v_i][2]);
    elsif strpos(v_new, v_pairs[v_i][2]) = 0 then
      raise exception
        '0033: merge_evaluation_answers matched neither the old nor the new form of "%". Its body is not what this migration expects — inspect it before proceeding.',
        v_pairs[v_i][1];
    end if;
  end loop;

  execute v_new;
end;
$patch$;


/* ---------- Proof, in the same transaction ---------- */
--
-- A patch that silently matched nothing is the failure mode this idiom has, so
-- the result is read back rather than assumed. Asserted on the rewritten
-- definition, not on the source text above.

do $patch$
declare
  v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'merge_evaluation_answers';

  if strpos(v_src, 'CYCLE_ACTIVE') > 0
     or strpos(v_src, 'SELF_SUBMITTED') > 0
     or strpos(v_src, 'LEAD_REVIEWED') > 0 then
    raise exception '0033 failed: a retired status survives in merge_evaluation_answers.';
  end if;

  if strpos(v_src, 'public.self_open(p_evaluation_id)') = 0
     or strpos(v_src, 'public.lead_open(p_evaluation_id)') = 0 then
    raise exception '0033 failed: the per-layer gates were not applied.';
  end if;

  raise notice '0033: merge_evaluation_answers now gates each layer on its own timestamp. Both layers are writable in parallel while the record is OPEN.';
end;
$patch$;


comment on function public.merge_evaluation_answers(uuid, public.rating_layer, jsonb, jsonb, text[]) is
  'Autosave. Each layer is gated on the record being OPEN and on its own submission timestamp (A3-3) — never on the other layer, which §1 requires stay invisible to both sides.';
