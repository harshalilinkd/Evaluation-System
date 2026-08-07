-- 0020_blind_rating_enum.sql
-- The five new §8 statuses. Nothing else — see 0021 for the rest of AMEND-3.
--
-- WHY THIS IS ITS OWN FILE
--
-- `alter type ... add value` may run inside a transaction on PostgreSQL 12+,
-- but the new label CANNOT BE USED until that transaction commits. Every
-- migration runs in a transaction, so a single file that both adds `OPEN` and
-- updates rows to `OPEN` fails on the update with "unsafe use of new value of
-- enum type".
--
-- Splitting it is the only clean way: this file adds the labels and commits;
-- 0021 uses them. A DO block with a nested COMMIT would work on some clients
-- and not others, and a text-swap of the whole column would rewrite history for
-- no benefit.
--
-- WHY THE OLD VALUES STAY
--
-- AMEND-3 is explicit: never drop an enum value that historical rows carry.
-- DRAFT is still the launch state and CLOSED is still the end, so both remain
-- live. CYCLE_ACTIVE, SELF_SUBMITTED, LEAD_REVIEWED and MD_FINALIZED become
-- historical only — 0021 migrates every row off them and adds a CHECK so no new
-- row can use one, which is how they are retired without being erased.
--
-- SAFE TO RE-RUN: `if not exists` on every value.

alter type public.evaluation_status add value if not exists 'OPEN';
alter type public.evaluation_status add value if not exists 'PENDING_HR_REVIEW';
alter type public.evaluation_status add value if not exists 'HR_APPROVED';
alter type public.evaluation_status add value if not exists 'MD_REVIEWED';
alter type public.evaluation_status add value if not exists 'INTERVIEW_DONE';
