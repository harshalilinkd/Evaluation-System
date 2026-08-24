-- 0096 — One evaluation form per person, however they became due.
--
-- ============================================================================
-- REPORTED FROM PRODUCTION (as "Evaluation Cycle Launch Logic"): "When HR
-- launches a new evaluation cycle, employees should not receive multiple
-- overdue evaluation forms for all their missed cycles (for example, 1-month,
-- 3-month, and 6-month evaluations). Instead, the system should identify the
-- most recent applicable evaluation cycle for each employee and send only
-- that evaluation form."
--
-- TWO SEPARATE GAPS PRODUCE THIS, AND BOTH ARE CLOSED HERE.
--
-- GAP 1 — due_items can hold more than one PENDING MONTH_n milestone for one
-- person at once. `compute_due_items` inserts from two disjoint populations
-- (nobody had a rise yet / somebody already did) and neither checks the
-- other, so a person can accumulate a MONTH_3 row and a MONTH_9 row both
-- PENDING at the same time — confirmed live: five people currently hold
-- exactly that pair. 0091's supersede-on-confirm only fires in ONE direction
-- (a later milestone withdraws an earlier still-open EVALUATION when the
-- later one is confirmed) — its own note records that confirming the earlier
-- one AFTER the later one already exists does not touch the later one. So
-- confirming them in the "wrong" order, or a bulk action that does not
-- control the order at all, could create two live evaluations for one
-- person. This migration collapses the table itself: at most one PENDING
-- MONTH_n item survives per person, always the most advanced, re-applied on
-- every sweep so the invariant holds going forward rather than being patched
-- once.
--
-- GAP 2 — the real "cycle launch" bug. Launching a batch cycle for "everyone
-- due" (the People step's Evaluation Due preselection, which reads the same
-- due_items rows) creates evaluations through `launch_cycle` and never
-- touches due_items at all. So the corresponding due_items rows are left
-- PENDING, still fully visible and actionable on the Evaluation Due screen,
-- inviting a SECOND, entirely separate evaluation for a person who already
-- received one from the batch launch. `launch_cycle` now closes out the
-- due_items row(s) it satisfies for each participant it opens an evaluation
-- for — a MONTH_n item is satisfied by any newly-opened evaluation, an
-- INCREMENT item only by an INCREMENT-type cycle (section 1: an
-- evaluation-only cycle never touches salary, so it must not mark a pay
-- review as done).
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
   where n.nspname = 'public' and p.proname = 'compute_due_items'
   limit 1;

  if v_def is null then
    raise exception '0096: compute_due_items does not exist. Apply 0031 first.';
  end if;

  if v_def like '%at most one PENDING MONTH_n item per person%' then
    raise notice '0096: the due_items dedup is already in place.';
  else
    v_new := regexp_replace(
      v_def,
      'return v_created;',
      $r1$/* -- 0096: at most one PENDING MONTH_n item per person, always the
        most advanced. The two inserts above run from two disjoint
        populations and neither checks the other, so a person could hold
        two milestones PENDING at once with nothing stopping HR creating a
        form for each. Idempotent, and re-run on every sweep -- it only
        ever touches a row still PENDING; an item already CREATED or
        SKIPPED is left exactly as it is. -- */
  with ranked as (
    select id,
           row_number() over (
             partition by profile_id
             order by (substring(milestone_type from '[0-9]+'))::int desc
           ) as rnk
      from public.due_items
     where status = 'PENDING'
       and milestone_type ~ '^MONTH_[0-9]+$'
  )
  update public.due_items d
     set status = 'SKIPPED',
         skip_reason = 'Superseded automatically: a later evaluation milestone is now due for this person.'
    from ranked r
   where d.id = r.id
     and r.rnk > 1;

  return v_created;$r1$
    );
    if v_new = v_def then
      raise exception '0096: could not find the end of compute_due_items. Nothing was changed.';
    end if;

    execute v_new;
    raise notice '0096: compute_due_items now collapses duplicate PENDING milestones.';
  end if;
end;
$mig$;

do $chk1$
declare
  v_t text;
begin
  select pg_get_functiondef(oid) into v_t from pg_proc
   where proname = 'compute_due_items'
     and pronamespace = 'public'::regnamespace limit 1;

  if v_t not like '%at most one PENDING MONTH_n item per person%' then
    raise exception '0096: verification failed -- the due_items dedup did not take.';
  end if;

  if v_t not like '%partition by profile_id%' then
    raise exception '0096: verification failed -- the ranking window is missing.';
  end if;

  -- The unrelated body -- the three inserts, the schedule lookup -- must
  -- still be present, unmoved.
  if v_t not like '%joiner_evaluation_months%' or v_t not like '%next_increment_date%' then
    raise exception '0096: verification failed -- the rest of the function looks disturbed.';
  end if;

  raise notice '0096: compute_due_items verified.';
end;
$chk1$;

do $mig2$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid)
    into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'launch_cycle'
   limit 1;

  if v_def is null then
    raise exception '0096: launch_cycle does not exist.';
  end if;

  if v_def like '%closes the item this launch was for%' then
    raise notice '0096: launch_cycle already closes due_items on launch.';
  else
    v_new := regexp_replace(
      v_def,
      E'v_evaluations := v_evaluations \\+ 1;\n  end loop;',
      $r2$v_evaluations := v_evaluations + 1;
  end loop;

  /* -- 0096: closes the item this launch was for.
        A batch or rolling launch just gave every one of these people a
        live evaluation -- the MONTH_n milestone that put them on the
        Evaluation Due screen is satisfied, whichever cycle type opened
        it. An INCREMENT milestone is different (section 1): only an
        INCREMENT-type cycle touches salary, so an evaluation-only launch
        must not mark somebody's pay review as done. Left PENDING
        otherwise is what let a due_items row be actioned a second time
        after a batch launch had already opened a form for that person --
        the actual bug 0096 exists to close. -- */
  update public.due_items d
     set status = 'CREATED',
         evaluation_id = e.id,
         actioned_by = v_caller,
         actioned_at = now()
    from public.evaluations e
   where e.cycle_id = p_cycle_id
     and e.excluded_at is null
     and d.profile_id = e.evaluatee_id
     and d.status = 'PENDING'
     and (
       d.milestone_type ~ '^MONTH_[0-9]+$'
       or (d.milestone_type = 'INCREMENT' and v_cycle.cycle_type = 'INCREMENT')
     );$r2$
    );
    if v_new = v_def then
      raise exception '0096: could not find the end of the participant loop in launch_cycle. Nothing was changed.';
    end if;

    execute v_new;
    raise notice '0096: launch_cycle now closes out due_items for who it just opened.';
  end if;
end;
$mig2$;

do $chk2$
declare
  v_t text;
begin
  select pg_get_functiondef(oid) into v_t from pg_proc
   where proname = 'launch_cycle'
     and pronamespace = 'public'::regnamespace limit 1;

  if v_t not like '%closes the item this launch was for%' then
    raise exception '0096: verification failed -- launch_cycle was not patched.';
  end if;

  if v_t not like '%d.status = ''PENDING''%' then
    raise exception '0096: verification failed -- the due_items update is missing its guard.';
  end if;

  -- The unrelated body -- the per-participant loop, the second-reviewer
  -- handling, the cycle activation -- must still be present, unmoved.
  if v_t not like '%co_reviewer_id%' or v_t not like '%launched_at = now()%' then
    raise exception '0096: verification failed -- the rest of the function looks disturbed.';
  end if;

  raise notice '0096: launch_cycle verified.';
end;
$chk2$;

-- Retroactive: closes GAP 1 immediately for the people who already hold two
-- PENDING milestones today, rather than waiting for tonight's sweep.
select public.compute_due_items();
