-- 0091 — A later milestone review supersedes an earlier one still open.
--
-- ============================================================================
-- REPORTED FROM PRODUCTION: "i sent one evaluation link for employee but they
-- get 2 links at a time — if employees 1 month review not done and their
-- 6 months review time came then we'll only send one form link for 6months
-- review not 2 links its time waste for employees to fill 2 forms."
--
-- WHY THIS HAPPENS. `ensure_rolling_cycle` picks one cycle per MILESTONE per
-- financial year (0079) — "1-month reviews FY 26-27" and "6-month reviews
-- FY 26-27" are two separate cycles by design. Nothing in
-- `create_milestone_evaluation` ever looks at whether the SAME employee
-- already has an earlier milestone open when a later one is confirmed, so an
-- employee whose 1-month review was never finished ends up holding two live
-- evaluations — and two invite links — the moment their 6-month review comes
-- due and HR confirms it.
--
-- THE FIX. When HR confirms a MONTH_<n> milestone for somebody, any EARLIER
-- (smaller n), still-open (not CLOSED, not already excluded) MONTH_ evaluation
-- for the SAME employee is withdrawn automatically, through the EXISTING
-- `exclude_evaluation` function (0009) — the same mechanism P10-6 built for
-- "the organisation is no longer asking for it". Archived, not deleted: the
-- record stays, audited, and simply stops being something anybody is asked to
-- fill in.
--
-- SCOPED TO MONTH_ MILESTONES ONLY, ON BOTH SIDES. An INCREMENT or
-- PRE_INCREMENT confirmation is a different exercise — different form, a pay
-- decision rather than a review — and neither supersedes an evaluation nor is
-- superseded by one. That is a separate question nobody has asked yet.
-- ============================================================================

do $mig$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid)
    into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_milestone_evaluation'
   limit 1;

  if v_def is null then
    raise exception '0091: create_milestone_evaluation does not exist. Apply 0031 first.';
  end if;

  if v_def like '%Supersede any earlier%' then
    raise notice '0091: the supersede logic is already in place.';
    return;
  end if;

  /* -- 1. Two new locals, added right after v_order — the last one declared. -- */
  v_new := regexp_replace(
    v_def,
    'v_order    integer := 0;',
    'v_order    integer := 0;' || E'\n'
      || '  v_superseded uuid;' || E'\n'
      || '  v_new_month  int;'
  );
  if v_new = v_def then
    raise exception '0091: could not find the declare block''s last local (v_order). Nothing was changed.';
  end if;
  v_def := v_new;

  /* -- 2. The supersede loop, spliced in right before the cycle is chosen —
        before anything about the NEW evaluation exists, so a failure here
        leaves neither evaluation half-open.

        ANCHORED ON THE 0079-PATCHED FORM, not 0031's original. 0079 rewrote
        this exact call from `ensure_rolling_cycle(v_item.due_on)` to
        `ensure_rolling_cycle(v_item.due_on, v_item.milestone_type)` — one
        cycle per milestone per financial year, which is why "1-month reviews
        FY 26-27" and "6-month reviews FY 26-27" are separate cycles in the
        first place, and the reason two links could exist at once. Anchoring
        on the pre-0079 text would raise "could not find the call" against
        every database this migration will actually run on. -- */
  v_new := regexp_replace(
    v_def,
    'v_cycle := public\.ensure_rolling_cycle\(v_item\.due_on, v_item\.milestone_type\);',
    '-- Supersede any earlier, still-open evaluation-milestone review for the'
      || E'\n' || '  -- same employee (0091). Scoped to MONTH_ milestones on both sides —'
      || E'\n' || '  -- an INCREMENT or PRE_INCREMENT confirmation is a different exercise.'
      || E'\n' || '  if v_item.milestone_type ~ ''^MONTH_[0-9]+$'' then'
      || E'\n' || '    v_new_month := substring(v_item.milestone_type from ''[0-9]+'')::int;'
      || E'\n' || ''
      || E'\n' || '    for v_superseded in'
      || E'\n' || '      select e.id'
      || E'\n' || '        from public.evaluations e'
      || E'\n' || '       where e.evaluatee_id = v_item.profile_id'
      || E'\n' || '         and e.excluded_at is null'
      || E'\n' || '         and e.status <> ''CLOSED'''
      || E'\n' || '         and e.milestone_type ~ ''^MONTH_[0-9]+$'''
      || E'\n' || '         and substring(e.milestone_type from ''[0-9]+'')::int < v_new_month'
      || E'\n' || '    loop'
      || E'\n' || '      perform public.exclude_evaluation('
      || E'\n' || '        v_superseded,'
      || E'\n' || '        format(''Superseded: their %s-month review has come due, replacing this one.'', v_new_month)'
      || E'\n' || '      );'
      || E'\n' || '    end loop;'
      || E'\n' || '  end if;'
      || E'\n' || ''
      || E'\n' || '  v_cycle := public.ensure_rolling_cycle(v_item.due_on, v_item.milestone_type);'
  );
  if v_new = v_def then
    raise exception '0091: could not find the (0079-patched) ensure_rolling_cycle call. Nothing was changed. Check whether 0079 is applied.';
  end if;
  v_def := v_new;

  execute v_def;
  raise notice '0091: a later milestone review now withdraws an earlier one still open.';
end;
$mig$;

do $chk$
declare
  v_t text;
begin
  select pg_get_functiondef(oid) into v_t from pg_proc
   where proname = 'create_milestone_evaluation'
     and pronamespace = 'public'::regnamespace limit 1;

  if v_t not like '%Supersede any earlier%' then
    raise exception '0091: verification failed — the supersede logic did not take.';
  end if;

  if v_t not like '%v_superseded uuid;%' or v_t not like '%v_new_month  int;%' then
    raise exception '0091: verification failed — the new locals were not declared.';
  end if;

  -- The unrelated body — the frozen snapshot, both layers, both tokens — must
  -- still be present, unmoved.
  if v_t not like '%Both layers open at once%' then
    raise exception '0091: verification failed — the rest of the function looks disturbed.';
  end if;

  raise notice '0091: verified.';
end;
$chk$;
