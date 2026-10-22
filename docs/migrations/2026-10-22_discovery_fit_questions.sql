-- Rosably 3.0 phase 1, task 12b (R68): "Fit" section for the discovery question bank.
-- NOT YET APPLIED. Apply by hand with the owner's approval (psql service=rosably -f ...).
-- Idempotent: safe to re-run (questions: on conflict (key) do nothing; template section and items are
-- added only when absent). One transaction.
--
-- Adds 5 Fit questions and appends the "fit" section (+ items, after the current max position) to the
-- default templates: "Standard Discovery" and "Small Nonprofit: Productivity & Integration".
-- NOT added to "Blank: custom questions". Templates are looked up by name.
-- Riley (agents/riley/discovery) always includes these five keys in a drafted questionnaire.

begin;

insert into crm.discovery_questions (key, label, help, section, type, options, required, config) values
  ('fit_engagement_model', 'What kind of engagement are you looking for?', null, 'Fit', 'single',
    '["Ongoing managed service","One-off project","Not sure"]'::jsonb, false, '{}'::jsonb),
  ('fit_ownership', 'Who would run the new setup day to day?', null, 'Fit', 'single',
    '["You run it","We run it with you","You hand it to us"]'::jsonb, false, '{}'::jsonb),
  ('fit_infrastructure', 'Which of these does your organization run on?', 'Check everything that applies.', 'Fit', 'multi',
    '["Microsoft 365","Google Workspace","Salesforce","Other SaaS","Self-hosted","None"]'::jsonb, false, '{}'::jsonb),
  ('fit_change_access', 'Could you give a partner access to make changes in your systems?', null, 'Fit', 'single',
    '["We can give a partner admin or API access","Limited","No"]'::jsonb, false, '{}'::jsonb),
  ('fit_budget_cadence', 'How would you expect to pay for this work?', null, 'Fit', 'single',
    '["Monthly","Per project","Grant-funded","Unknown"]'::jsonb, false, '{}'::jsonb)
on conflict (key) do nothing;

do $$
declare
  t record;
  base int;
begin
  for t in
    select id from crm.discovery_templates
    where name in ('Standard Discovery', 'Small Nonprofit: Productivity & Integration')
  loop
    update crm.discovery_templates
       set sections = sections || '[{"id":"fit","title":"Fit"}]'::jsonb,
           updated_at = now()
     where id = t.id
       and not exists (select 1 from jsonb_array_elements(sections) s where s->>'id' = 'fit');

    select coalesce(max("position"), 0) into base from crm.discovery_template_items where template_id = t.id;

    insert into crm.discovery_template_items (template_id, question_id, "position", section_id)
    select t.id, q.id, base + k.ord, 'fit'
      from (values ('fit_engagement_model', 1), ('fit_ownership', 2), ('fit_infrastructure', 3),
                   ('fit_change_access', 4), ('fit_budget_cadence', 5)) as k(key, ord)
      join crm.discovery_questions q on q.key = k.key
    on conflict (template_id, question_id) do nothing;
  end loop;
end $$;

commit;
