-- 0036_form_sections.sql
-- Section names and their order become data, so HR can change both.
--
-- Until now a section's name lived in `lib/forms/labels.ts` and its position in
-- `SECTION_ORDER` beside it, and changing either meant a deploy. The owner asked
-- for both to be editable, and the specific need is real: "Manager Review (Team
-- Lead only)" is the wrong name for a section once some of its questions are
-- answered by the employee too.
--
-- WHAT IS AND IS NOT EDITABLE, AND WHY.
--
-- The eight sections themselves are `question_section`, a Postgres enum, and
-- §0.2 fixes an enum value once created. That is not conservatism: the value is
-- stored on every `questions` row AND frozen into every `evaluation_questions`
-- row at launch (§5). Renaming or dropping one would rewrite what people were
-- asked, in appraisals that have already been signed.
--
-- So this table changes what a section is CALLED and where it SITS. It cannot
-- add or remove one. That is the same line P8P-1 drew for DEPARTMENT_SPECIFIC,
-- which is still labelled "Job Specific Skills" while the enum value has never
-- moved: what the database calls a thing and what a person calls it are allowed
-- to differ, and only one of them is safe to change.

create table if not exists public.form_sections (
  -- The enum IS the key. One row per section, no more and no fewer, and a
  -- section that does not exist cannot be given a name.
  section     public.question_section primary key,
  label       text not null check (length(btrim(label)) between 1 and 80),
  sort_order  integer not null,
  /*
   * A section with no questions already renders as nothing, so this is not
   * about hiding an empty one — it is about deliberately parking a section that
   * still HAS questions, without retiring each of them one at a time.
   */
  is_active   boolean not null default true,
  updated_at  timestamptz not null default now()
);

drop trigger if exists set_form_sections_updated_at on public.form_sections;
create trigger set_form_sections_updated_at
  before update on public.form_sections
  for each row execute function public.set_updated_at();

comment on table public.form_sections is
  'What each section is called and where it sits. The SET of sections is the question_section enum and is not editable here — §5 freezes it into every launched evaluation.';

/* ============================================================================
   RLS
   ========================================================================== */
--
-- Everyone reads: a section name appears on the form every employee fills in,
-- so a policy that hid it would leave them looking at unlabelled blocks.
-- §9 as amended gives the WRITE to HR alone — this is configuration.

alter table public.form_sections enable row level security;

drop policy if exists form_sections_read on public.form_sections;
create policy form_sections_read on public.form_sections
  for select to authenticated using (true);

drop policy if exists form_sections_hr_write on public.form_sections;
create policy form_sections_hr_write on public.form_sections
  for all to authenticated
  using (public.is_hr()) with check (public.is_hr());

grant select on public.form_sections to authenticated;
grant insert, update, delete on public.form_sections to authenticated;

/* ============================================================================
   Seed — today's names and today's order, exactly
   ========================================================================== */
--
-- Taken from `lib/forms/labels.ts` as it stands, so applying this migration
-- changes nothing anybody can see. The point is to move the values somewhere
-- they can be edited, not to edit them.
--
-- P8P-2's order is preserved: Job Specific Skills sits FOURTH, after Core
-- Performance, which deliberately does not match the enum's declaration order.
-- That ordering was in TypeScript because reordering a Postgres enum means
-- dropping and recreating the type; now it is a column, which is where a thing
-- that changes belongs.

insert into public.form_sections (section, label, sort_order) values
  ('METADATA',            'Details',                             10),
  ('KPI',                 'Quantitative Performance (KPI)',      20),
  ('CORE_PERFORMANCE',    'Core Performance',                    30),
  ('DEPARTMENT_SPECIFIC', 'Job Specific Skills',                 40),
  ('BEHAVIOURAL',         'Behavioural, Team Skills & Learning', 50),
  ('LEARNING',            'Learning & Development',              60),
  ('NARRATIVE',           'Add-ons & Key Achievements',          70),
  ('MANAGER_REVIEW',      'Manager Review (Team Lead only)',     80)
on conflict (section) do nothing;

/* -- A backstop against the one way this table can go wrong: a section missing
      from it would render with no name at all. Every enum value must have a
      row, so a future enum addition fails loudly here rather than silently
      producing a blank heading on somebody's appraisal. -- */
do $$
declare v_missing text;
begin
  select string_agg(e.value, ', ') into v_missing
  from (
    select unnest(enum_range(null::public.question_section))::text as value
  ) e
  left join public.form_sections f on f.section::text = e.value
  where f.section is null;

  if v_missing is not null then
    raise exception '0036: these sections have no row in form_sections: %. Every section must have a name.', v_missing;
  end if;
end;
$$;
