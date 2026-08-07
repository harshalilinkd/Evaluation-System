-- 0035_worker_questions.sql
-- The Worker Performance Appraisal form. §7's worker module, first table.
--
-- §7 has described this module since P0 and none of it has ever been built:
-- §18's STATUS calls it "the largest single gap against the constitution".
-- This migration builds ONE piece of it — the question set behind the form —
-- because that is what was asked for. The appraisal itself (worker_evaluations,
-- the supervisor flow, §8's worker transition table) is still absent, and
-- nothing here pretends otherwise.
--
-- §0.4 forbids inventing schema; §5 requires that "WORKER data lives
-- exclusively in the worker_ tables"; PR-5 flagged this exact table as missing
-- and refused to seed it for that reason. The owner has now instructed it
-- directly ("for workers we have separate simple form that also we need to
-- build in our app"), which is the explicit instruction §0.4 requires.
--
-- WHY A SEPARATE TABLE AT ALL.
-- 0008 added `questions_core_track_staff`, a CHECK that refuses a WORKER row in
-- `questions` (P8P-4). That constraint is the module boundary made structural,
-- and it is doing its job here: there is nowhere in the core bank these can go.
-- Which is the point — §7's isolation rule is that the two modules share
-- authentication, profiles, departments, the audit log and the design system,
-- and nothing else.

create table if not exists public.worker_questions (
  id            uuid primary key default gen_random_uuid(),
  text          text not null,
  help_text     text,
  -- The instrument is fixed by §6 and by the source form: three tick cells,
  -- Excellent / Satisfactory / Needs Improvement. It is a column rather than an
  -- assumption so a future Yes/No row (the form's "Training Required") has
  -- somewhere to live without a second table.
  response_type public.response_type not null default 'TICK_3',
  answered_by   public.answered_by not null default 'LEAD_ONLY',
  is_required   boolean not null default true,
  sort_order    integer not null default 0,
  is_active     boolean not null default true,
  /*
   * §11: "Worker track: overall = the Supervisor's 'Overall Performance' tick,
   * not a mean." The source form carries that as row 8 AND as a separate line
   * beneath the table — one fact printed twice. Marking the row is what lets
   * scoring find it without matching on its text, which §17 freezes and which
   * would break the first time somebody edits the wording.
   */
  is_overall    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Exactly one row may be the overall verdict. A second would make "the
-- supervisor's overall tick" ambiguous, and §11 names it in the singular.
create unique index if not exists worker_questions_one_overall
  on public.worker_questions (is_overall)
  where is_overall;

create index if not exists worker_questions_sort_idx
  on public.worker_questions (sort_order)
  where is_active;

drop trigger if exists set_worker_questions_updated_at on public.worker_questions;
create trigger set_worker_questions_updated_at
  before update on public.worker_questions
  for each row execute function public.set_updated_at();

comment on table public.worker_questions is
  '§7 worker module. The Worker Performance Appraisal tick sheet. Never joined to the staff bank: 0008''s CHECK is what keeps the two apart.';
comment on column public.worker_questions.is_overall is
  '§11: the supervisor''s Overall Performance tick IS the worker overall score. Never a mean.';

/* ============================================================================
   RLS
   ========================================================================== */
--
-- §9's matrix as amended: HR writes configuration, the MD reads it. A
-- SUPERVISOR needs to READ the questions to fill the sheet in — the same
-- position an employee is in with the staff bank, where reading is mediated by
-- the frozen snapshot. There is no worker snapshot table yet, so the read is
-- granted here and narrows later when there is one.

alter table public.worker_questions enable row level security;

drop policy if exists worker_questions_read on public.worker_questions;
create policy worker_questions_read on public.worker_questions
  for select to authenticated
  using (true);

drop policy if exists worker_questions_hr_write on public.worker_questions;
create policy worker_questions_hr_write on public.worker_questions
  for all to authenticated
  using (public.is_hr())
  with check (public.is_hr());

grant select on public.worker_questions to authenticated;
grant insert, update, delete on public.worker_questions to authenticated;

/* ============================================================================
   The form itself
   ========================================================================== */
--
-- Transcribed from "Worker Performance Appraisal Form" exactly as printed.
-- §17 forbids improving wording that came from a source form, so "Behavior &
-- Discipline" keeps its US spelling and "On-time Reporting" keeps its hyphen.
-- Helper text is NEW — the source form has none — and is marked as such here so
-- nobody mistakes it for something that must not be touched. Reword the helpers
-- freely; do not touch the eight qualities.
--
-- Deterministic ids, so a re-run maps rather than duplicates. Same device P2-3
-- and PR-3 use, and the keys live only in this file.

insert into public.worker_questions (id, text, help_text, sort_order, is_overall)
values
  (md5('linkd.worker.work_quality')::uuid,        'Work Quality',
   'The standard of the work produced', 10, false),
  (md5('linkd.worker.work_speed')::uuid,          'Work Speed',
   'The volume of work completed in the time given', 20, false),
  (md5('linkd.worker.attendance')::uuid,          'Attendance',
   'Present on the days they are rostered', 30, false),
  (md5('linkd.worker.on_time_reporting')::uuid,   'On-time Reporting',
   'Arrives and starts on time', 40, false),
  (md5('linkd.worker.behavior_discipline')::uuid, 'Behavior & Discipline',
   'Conduct with colleagues and on the floor', 50, false),
  (md5('linkd.worker.following_instructions')::uuid, 'Following Work Instructions',
   'Does the job the way it was explained', 60, false),
  (md5('linkd.worker.workplace_safety')::uuid,    'Workplace Safety',
   'Follows safety rules and uses the equipment properly', 70, false),
  (md5('linkd.worker.overall_performance')::uuid, 'Overall Performance',
   'The supervisor''s overall verdict. This is the worker''s score for the period.', 80, true)
on conflict (id) do nothing;

do $$
declare v_n int;
begin
  select count(*) into v_n from public.worker_questions where is_active;
  raise notice '0035: worker appraisal form has % questions. The worker APPRAISAL (cycles, supervisor flow, print pack) is still not built.', v_n;
end;
$$;
