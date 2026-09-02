-- 0099: `PENDING_SUPERVISOR` — the step between the team leader and HR.
--
-- SPLIT FROM 0100 BECAUSE POSTGRES REQUIRES IT. A value added by
-- `alter type ... add value` cannot be USED in the transaction that adds it, so
-- the label and the code that reads it have to arrive in two migrations.
-- AMEND-3 split 0020/0021 for the same reason and recorded it (A3 header).
--
-- WHY A NEW STATUS AT ALL. The production round gains a person: the team
-- leader ticks the sheet, and their supervisor then reviews those ticks and
-- records the comment, the training tick and the recommended percentage before
-- it reaches HR. Without a status of its own, "with the supervisor" and "with
-- HR" are the same value, so HR's queue fills with rows nobody can act on yet
-- and the board cannot say who is holding an appraisal — which is the one
-- question a board exists to answer.
--
-- BEFORE 'PENDING_REVIEW', so the enum's own order still reads as the flow:
--   DRAFT → OPEN → PENDING_SUPERVISOR → PENDING_REVIEW → REVIEWED → CLOSED

do $$
begin
  if not exists (
    select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'worker_evaluation_status'
       and e.enumlabel = 'PENDING_SUPERVISOR'
  ) then
    alter type public.worker_evaluation_status
      add value 'PENDING_SUPERVISOR' before 'PENDING_REVIEW';
  end if;
end;
$$;
