-- =============================================================================
-- 0002_questions.sql — The question bank, its options, and department mapping.
-- Phase P2. CLAUDE.md §5 (data model), §6 (response types), §7 (tracks).
-- =============================================================================
--
-- This is the table that makes CLAUDE.md §1's defining idea work: "the form is
-- never a fixed schema." A form is assembled at runtime by selecting the CORE
-- questions for the evaluatee's track, plus the DEPARTMENT questions mapped to
-- their department. Adding a question next cycle is an INSERT, never a migration.
--
-- Nothing here is ever hard-deleted once a cycle has launched. `is_active`
-- retires a question from future forms; the snapshot rule in §5 means a launched
-- evaluation keeps its own frozen copy regardless (evaluation_questions, P3).
-- That is what lets HR edit the bank freely without rewriting history.
--
-- !! RLS IS STILL NOT ENABLED. Policies land in P5, as in 0001_core.sql. !!
-- =============================================================================


/* ---------- Enums ---------- */
-- CLAUDE.md §4: values are SCREAMING_SNAKE_CASE.

-- §6, in the order that section lists them. The UI contract for each value is
-- fixed there; the 0-5 label wording in particular is not to be paraphrased.
create type public.response_type as enum (
  'SCALE_0_5',
  'TICK_3',
  'NUMBER',
  'BOOLEAN',
  'TEXT_SHORT',
  'TEXT_LONG',
  'SINGLE_SELECT',
  'MULTI_SELECT',
  'DATE'
);

-- CORE       -> asked of everyone on the matching track
-- DEPARTMENT -> asked only of the departments mapped in department_questions
create type public.question_category as enum ('CORE', 'DEPARTMENT');

create type public.question_section as enum (
  'METADATA',
  'KPI',
  'CORE_PERFORMANCE',
  'BEHAVIOURAL',
  'LEARNING',
  'NARRATIVE',
  'DEPARTMENT_SPECIFIC',
  'MANAGER_REVIEW'
);

-- Which layers are asked this question when the form is assembled.
-- EMPLOYEE_AND_LEAD is the collision case: the same question appears on the
-- self form and again on the lead's form, and the two answers are compared
-- side by side in the MD's collision view (§11 variance = Lead - Self).
create type public.answered_by as enum (
  'EMPLOYEE_AND_LEAD',
  'EMPLOYEE_ONLY',
  'LEAD_ONLY',
  'MD_ONLY'
);


/* ---------- questions ---------- */

create table public.questions (
  id            uuid primary key default gen_random_uuid(),
  text          text not null,
  help_text     text,
  section       public.question_section not null,
  response_type public.response_type not null,
  category      public.question_category not null,

  -- §7: 'BOTH' means the question applies to either track. Form assembly
  -- filters on `track in (evaluatee.track, 'BOTH')`.
  track         public.track_type not null default 'BOTH',

  answered_by   public.answered_by not null default 'EMPLOYEE_AND_LEAD',
  is_required   boolean not null default true,

  -- Bounds for NUMBER. SCALE_0_5 and TICK_3 carry their range in the response
  -- type itself (§6), so these stay NULL for them rather than restating it in
  -- two places that could drift apart.
  min_value     numeric,
  max_value     numeric,

  -- §6 conditional questions: this question is shown only when the answer to
  -- `depends_on` equals `depends_value`. Hidden questions are neither validated
  -- nor stored. Stored as text because the parent may be BOOLEAN, SINGLE_SELECT
  -- or SCALE_0_5, and one column has to serve all three.
  depends_on    uuid references public.questions(id),
  depends_value text,

  sort_order    integer not null default 0,
  is_active     boolean not null default true,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- A question that depends on itself would never resolve and would hang the
  -- renderer. Same class of guard as profiles.reports_to in 0001.
  constraint questions_depends_not_self check (depends_on is null or depends_on <> id),

  -- Both halves of the condition are needed or neither is: a depends_on with no
  -- value to match against would leave the question permanently hidden, which
  -- looks identical to "HR forgot to add it".
  constraint questions_depends_pair check ((depends_on is null) = (depends_value is null)),

  constraint questions_value_range check (
    min_value is null or max_value is null or max_value >= min_value
  )
);

create trigger questions_set_updated_at
  before update on public.questions
  for each row execute function public.set_updated_at();

-- Form assembly always reads a section at a time, in order.
create index questions_section_sort_order_idx on public.questions (section, sort_order);

comment on table public.questions is
  'The editable question bank. HR adds, edits and retires rows here; §5''s snapshot rule protects launched evaluations from those edits.';
comment on column public.questions.is_active is
  'Soft delete. Retires a question from future forms without breaking historic responses, which key off the question id.';
comment on column public.questions.answered_by is
  'Which layers see this question. EMPLOYEE_AND_LEAD is what produces a self-vs-lead variance to flag.';


/* ---------- question_options ---------- */

-- Only for SINGLE_SELECT and MULTI_SELECT (§5). TICK_3 is NOT stored here: its
-- three cells are fixed by §6 and rendered by the TickScale component, so
-- putting them in data would invite someone to edit a scale that must not move.
create table public.question_options (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,

  -- `label` is what the evaluatee reads; `value` is what lands in the answers
  -- JSONB. Separating them means the wording can be corrected later without
  -- invalidating answers already recorded against the old text.
  label       text not null,
  value       text not null,
  sort_order  integer not null default 0
);

create index question_options_question_id_idx on public.question_options (question_id);

comment on column public.question_options.value is
  'Stored in evaluation_responses.answers. Treat as immutable once a cycle has launched.';


/* ---------- department_questions ---------- */

create table public.department_questions (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  question_id   uuid not null references public.questions(id) on delete cascade,
  -- Lets the same question sit at a different position for each department.
  sort_order    integer not null default 0,

  constraint department_questions_unique unique (department_id, question_id)
);

-- Requested explicitly in the phase brief. As with user_roles_profile_id_idx in
-- 0001, department_questions_unique already indexes department_id as its
-- leading column, so this is redundant and safe to drop if it ever matters.
create index department_questions_department_id_idx
  on public.department_questions (department_id);

comment on table public.department_questions is
  'Maps DEPARTMENT-category questions to the departments that are asked them. CORE questions are not listed here — they apply to every department on the matching track.';
