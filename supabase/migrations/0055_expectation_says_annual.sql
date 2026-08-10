-- 0055 — the salary question asks for an ANNUAL figure, in as many words.
--
-- THE PROBLEM. An employee answered 25000 against a current CTC of ₹2,00,000 a
-- year. The column is annual and the report compared the two directly, so a
-- proposal of ₹2,10,000 read as "740% above what they asked for" — arithmetic
-- that is precise and meaningless.
--
-- The question said "What salary would you consider fair for the year ahead?"
-- "For the year ahead" is a TIME, not a UNIT: it says when, and somebody
-- thinking in monthly pay reads it as "what should my salary be, next year"
-- and types their monthly figure. Most people on a payroll think in months.
--
-- P21-1 retired 0022's explicitly MONTHLY question for exactly this reason —
-- copying a monthly answer into an annual column is wrong by a factor of twelve
-- — and then left the replacement's wording implicit. This closes that.
--
-- §0.2 FREEZES QUESTION TEXT and this changes it. That is the owner's explicit
-- instruction: "for uniformity we need to mention in employees form that they
-- need to type their expected annual CTC."
--
-- Nothing already asked is rewritten. §5 freezes the text into
-- `evaluation_questions` at launch, so every live and historical evaluation
-- keeps the wording its employee actually saw — which is the point of the
-- snapshot rule. Only forms launched after this get the clearer question.

begin;

update public.questions
   set text =
         'What annual CTC would you consider fair for the year ahead?',
       help_text =
         'Your total cost to company for the whole YEAR, not your monthly salary — '
         || 'for example 3,60,000 rather than 30,000. This is your expectation, not a '
         || 'promise. It is one input among several and it goes only to HR and management.'
 where id = md5('linkd.q.salary_expectation_annual')::uuid;

do $$
begin
  if not found then
    raise notice
      '0055: the annual salary question was not present — nothing to reword. Apply 0030 first if this is unexpected.';
  end if;
end;
$$;

/* §12: a question-bank edit is an audited event. `log_admin_action` is the
   gated path for one (P8-5), but it takes its actor from the session and there
   is none inside a migration — so the row is written directly, with a null
   actor, which is how every other migration records a change it makes itself. */
insert into public.audit_log (actor_id, entity, entity_id, action, diff)
select
  null,
  'question',
  md5('linkd.q.salary_expectation_annual')::uuid,
  'question.reworded',
  jsonb_build_object(
    'why', 'The question asked for a salary "for the year ahead", which states a period '
           || 'rather than a unit. Employees who think in monthly pay were answering monthly, '
           || 'and the column is annual.',
    'now', 'What annual CTC would you consider fair for the year ahead?')
where exists (
  select 1 from public.questions
   where id = md5('linkd.q.salary_expectation_annual')::uuid
);

commit;
