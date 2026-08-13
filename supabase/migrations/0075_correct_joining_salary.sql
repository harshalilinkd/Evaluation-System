-- 0075 · HR may correct a joining salary.
--
-- AT THE OWNER'S EXPLICIT INSTRUCTION, and it REVERSES a rule 0069 enforced in
-- capitals: "Once recorded, joining_salary remains static for audit purposes."
-- The concern behind that rule was put to the owner and they asked for it to be
-- editable; §0.9 requires exactly that exchange before a documented decision is
-- undone, and this file is the record of it.
--
-- WHAT THE OLD RULE WAS PROTECTING, AND WHY REVERSING IT IS SURVIVABLE.
--
-- P19E-1 made the joining salary a COLUMN rather than a `salary_history` row
-- precisely so that filling it in months later could not be read as a rise —
-- that mistake once wrote a 620% hike onto somebody's record. That protection
-- is untouched: the baseline still is not a ledger row and still cannot be
-- mistaken for one.
--
-- What changes is only whether the figure may be corrected afterwards. It can,
-- and the damage is bounded because `previous_ctc`, `hike_amount` and `hike_pct`
-- are STORED on each `salary_history` row at the moment it was written — they
-- are not recomputed from the baseline. Correcting a typo therefore cannot
-- rewrite a single stored percentage.
--
-- THE ONE VISIBLE CONSEQUENCE, stated plainly: where somebody already has a
-- recorded rise, the ledger's baseline row and that rise's stored
-- `previous_ctc` can now disagree — the first row says ₹15,000 and the second
-- says "from ₹18,000". That is a reading somebody has to interpret, not
-- corrupted data, and it is the price of being able to fix a number that was
-- typed wrong. Correcting a baseline BEFORE any rise is recorded has no such
-- effect at all, which is the common case this exists for.
--
-- 0069 IS NOT EDITED (§0.8). `record_joining_salary` keeps its behaviour and its
-- callers; this adds the corrective path beside it.

create or replace function public.set_joining_salary(
  p_profile_id uuid,
  p_amount     numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing   numeric;
  v_current    numeric;
  v_revisions  int;
  v_seeded     boolean;
begin
  /* §9 as amended: the pay decision belongs to HR and the MD. Checked HERE
     rather than through the table policy, because a definer function runs as
     its owner and RLS has no say — which is the whole reason FIX-19 had to
     exist (`employment_records` admits only HR for UPDATE, so the MD's bare
     update matched zero rows and reported success). */
  if not (public.is_hr() or public.is_md()) then
    raise exception 'Only HR or management can set a joining salary.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'A joining salary has to be more than zero.'
      using errcode = 'check_violation';
  end if;

  select joining_ctc, current_ctc into v_existing, v_current
    from public.employment_records
   where profile_id = p_profile_id;

  if not found then
    raise exception 'This person has no employment record yet. Add their joining details first.'
      using errcode = 'no_data_found';
  end if;

  /* -- NO REFUSAL HERE. That is the whole difference from 0069. -- */

  /* -- WHETHER THE CURRENT FIGURE MOVES WITH IT IS DECIDED HERE, NOT BY THE
        CALLER — 0069's rule, kept verbatim and for the same reason (P9D-3).

        Somebody who joined on ₹15,000 and has had no rise IS on ₹15,000, so
        correcting the baseline has to correct today's salary too or the record
        contradicts itself. Where a revision exists, `current_ctc` is that
        revision's figure and this must not touch it.

        BROADER THAN 0069's, deliberately: that one seeded only when
        `current_ctc` was null, because it was writing a first value. This is a
        correction, so it also moves a current figure that came from the
        baseline itself. Legacy JOINING rows do not count as a revision — they
        are this same baseline recorded the old way, not a rise. -- */
  select count(*) into v_revisions
    from public.salary_history
   where profile_id = p_profile_id
     and reason <> 'JOINING';

  update public.employment_records
     set joining_ctc             = p_amount,
         joining_ctc_recorded_by = auth.uid(),
         joining_ctc_recorded_at = now(),
         current_ctc             = case
                                     when v_revisions = 0 then p_amount
                                     else current_ctc
                                   end
   where profile_id = p_profile_id;

  /* §12. A pay figure changing is exactly the kind of thing somebody asks about
     later — and NO AMOUNT reaches the diff (§5, P19-10): 0013 lets a lead read
     `audit_log` for their own reports, so a figure here would walk straight
     past the salary-confinement invariant. It records THAT it moved, whether it
     replaced an earlier figure, and whether today's salary moved with it. */
  insert into public.audit_log (actor_id, entity, entity_id, action, diff)
  values (
    auth.uid(),
    'employment',
    p_profile_id,
    case when v_existing is null then 'joining_salary.recorded' else 'joining_salary.corrected' end,
    jsonb_build_object(
      'had_a_baseline', v_existing is not null,
      'revisions_on_record', v_revisions,
      'current_salary_moved_with_it', v_revisions = 0
    )
  );

  v_seeded := (v_revisions = 0);
  return jsonb_build_object('seeded_current', v_seeded, 'corrected', v_existing is not null);
end;
$$;

revoke all on function public.set_joining_salary(uuid, numeric) from public;
grant execute on function public.set_joining_salary(uuid, numeric) to authenticated;

do $$
begin
  raise notice '0075: a joining salary can now be CORRECTED, not only recorded once. '
               'Stored percentages are untouched — previous_ctc and hike_pct are '
               'written per row and never recomputed from the baseline.';
end;
$$;
