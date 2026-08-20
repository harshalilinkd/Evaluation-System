-- 0089 · "Support & Expectations" sits last on the employee's form.
--
-- AT THE OWNER'S EXPLICIT INSTRUCTION, asked twice: "support and expectation
-- section will be at last", "keep support and expectation section at last of
-- form for employees".
--
-- §0.2 freezes a section's ORDER the same way it freezes its name, and P25 made
-- both editable precisely so HR owns them. I declined to write this the first
-- time on the grounds that a migration overwrites whatever order HR has since
-- set — which is true, and is exactly what is being asked for here. Recorded so
-- it reads as a decision rather than as a migration quietly resetting a
-- setting.
--
-- COMPUTED, NOT TYPED. The seeded order has NARRATIVE at 70 and LEARNING at 60,
-- so on a database that still carries the seed this file changes nothing. It is
-- written because THIS database does not: the section is rendering above
-- Learning & Development, so somebody has moved it. Setting a literal 70 would
-- fix that installation and break the next one; deriving the value from what is
-- actually there is correct on both.

do $$
begin
  if to_regclass('public.form_sections') is null then
    raise exception '0089 requires 0036 (form_sections). Apply it first.';
  end if;
end $$;

do $$
declare
  v_employee_max integer;
  v_before       integer;
begin
  select sort_order into v_before from public.form_sections where section = 'NARRATIVE';

  /* -- The last position on the EMPLOYEE'S form.
        MANAGER_REVIEW is excluded from the calculation deliberately: it is the
        manager's own section and the employee never sees it, so it is not the
        thing NARRATIVE has to get past. Including it would put NARRATIVE after
        the manager's questions on the manager's form, which is not what was
        asked and would read oddly there. -- */
  select coalesce(max(sort_order), 0) into v_employee_max
  from public.form_sections
  where section not in ('NARRATIVE', 'MANAGER_REVIEW');

  update public.form_sections
     set sort_order = v_employee_max + 10
   where section = 'NARRATIVE';

  /* -- And MANAGER_REVIEW stays AFTER it, so the manager's form still ends with
        the manager's own questions. Written unconditionally rather than "only
        if it is now lower", because the only thing that matters is the finished
        order — and a conditional here would leave a database where the two had
        been swapped in an order nobody asked for. -- */
  update public.form_sections
     set sort_order = v_employee_max + 20
   where section = 'MANAGER_REVIEW';

  raise notice
    '0089: NARRATIVE moved from % to %; MANAGER_REVIEW follows at %.',
    v_before, v_employee_max + 10, v_employee_max + 20;
end $$;

/* -- No enum was touched, and no question moved.
      `question_section` still carries NARRATIVE as its stored value on every
      row and in every frozen snapshot (§5, P25-1). What changed is one integer
      that decides where the heading is drawn — which is the whole reason P25
      put the order in a table rather than in the enum. -- */
do $$
declare v_order text;
begin
  select string_agg(label, ' → ' order by sort_order) into v_order
  from public.form_sections
  where is_active and section <> 'MANAGER_REVIEW';

  raise notice '0089 applied. The employee''s form now reads: %', v_order;
end $$;
