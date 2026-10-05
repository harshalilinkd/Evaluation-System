-- 0112 · Somebody holding HR AND MD may approve an increment.
--
-- Reported as: "Harshali has all the MD and HR access and still is not able to
-- approve salary." The screen gave her HR's read-only card (fixed in the app),
-- and behind it this guard would have refused her anyway: it asks "is this HR?"
-- FIRST, and an HR caller is refused any write to the MD's columns — with no
-- check for whether that same person is also the MD. So the one person who
-- holds both roles could do neither half of the MD's job.
--
-- THE CHANGE IS ONE BRANCH. Somebody holding both may write both halves,
-- because both roles say they may. HR-only and MD-only are UNTOUCHED: HR alone
-- still cannot set the approved figure, and the MD alone still cannot rewrite
-- HR's proposal or the employee's expectation.
--
-- Stated plainly, because AMEND-2 restored HR and MD as two people so that a
-- pay decision has a second pair of eyes: for a person holding BOTH roles there
-- is no second pair of eyes — they can propose and approve the same increment.
-- That is what granting one person both roles means; this guard was only
-- refusing it inconsistently (it already let them close a production appraisal
-- and send a staff one up). Removing MD from that person is how to restore the
-- split, not this trigger.
--
-- Recreated from the LIVE definition; nothing else moves. Written against
-- `public.` like every migration before it; applied to the `evaluation` schema.

begin;

create or replace function public.increment_reviews_guard_columns()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  -- 0112: holding both roles, both halves are theirs.
  if public.is_hr() and public.is_md() then
    return new;
  end if;

  if public.is_hr() then
    if new.md_approved_ctc      is distinct from old.md_approved_ctc
       or new.md_approved_hike_pct is distinct from old.md_approved_hike_pct
       or new.md_remarks           is distinct from old.md_remarks then
      raise exception
        'The approved figure is the MD''s to set. HR proposes; the MD approves.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if public.is_md() then
    if new.hr_proposed_ctc       is distinct from old.hr_proposed_ctc
       or new.hr_proposed_hike_pct is distinct from old.hr_proposed_hike_pct
       or new.hr_justification     is distinct from old.hr_justification
       or new.employee_expectation_ctc  is distinct from old.employee_expectation_ctc
       or new.employee_expectation_note is distinct from old.employee_expectation_note then
      raise exception
        'HR''s proposal and the employee''s expectation are not the MD''s to edit.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if exists (
    select 1 from public.evaluations e
     where e.id = new.evaluation_id
       and e.evaluatee_id = (select auth.uid())
  ) then
    if new.joining_ctc            is distinct from old.joining_ctc
       or new.current_ctc                 is distinct from old.current_ctc
       or new.months_since_last_increment is distinct from old.months_since_last_increment
       or new.hr_proposed_ctc             is distinct from old.hr_proposed_ctc
       or new.hr_proposed_hike_pct        is distinct from old.hr_proposed_hike_pct
       or new.hr_justification            is distinct from old.hr_justification
       or new.md_approved_ctc             is distinct from old.md_approved_ctc
       or new.md_approved_hike_pct        is distinct from old.md_approved_hike_pct
       or new.md_remarks                  is distinct from old.md_remarks
       or new.interview_date              is distinct from old.interview_date
       or new.interview_attendees         is distinct from old.interview_attendees
       or new.interview_notes             is distinct from old.interview_notes
       or new.final_ctc                   is distinct from old.final_ctc
       or new.final_hike_pct              is distinct from old.final_hike_pct
       or new.effective_from              is distinct from old.effective_from
       or new.status                      is distinct from old.status then
      raise exception 'You may record your own salary expectation and nothing else.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  raise exception 'Only HR and the MD may write a salary review.'
    using errcode = 'insufficient_privilege';
end;
$$;

commit;
