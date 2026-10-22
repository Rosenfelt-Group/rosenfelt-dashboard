-- Tests for 2026-10-22_discovery_fit_questions.sql (R68). The harness applies the migration in its
-- migration loop and then a second time (idempotency); the exact-count asserts below (one fit section,
-- five fit items per template, five Fit questions) fail if the re-apply duplicated anything. Runs in one transaction that is rolled back.
begin;

do $$
declare
  std uuid; snp uuid; blank uuid;
begin
  select id into std from crm.discovery_templates where name = 'Standard Discovery' and is_default;
  select id into snp from crm.discovery_templates where name = 'Small Nonprofit: Productivity & Integration';
  select id into blank from crm.discovery_templates where name = 'Blank: custom questions';
  assert std is not null and snp is not null and blank is not null, 'templates exist';

  -- questions
  assert (select count(*) from crm.discovery_questions where section = 'Fit') = 5, 'five Fit questions';
  assert (select type from crm.discovery_questions where key = 'fit_engagement_model') = 'single', 'engagement type';
  assert (select type from crm.discovery_questions where key = 'fit_ownership') = 'single', 'ownership type';
  assert (select type from crm.discovery_questions where key = 'fit_infrastructure') = 'multi', 'infrastructure type';
  assert (select type from crm.discovery_questions where key = 'fit_change_access') = 'single', 'change_access type';
  assert (select type from crm.discovery_questions where key = 'fit_budget_cadence') = 'single', 'budget type';
  assert (select options from crm.discovery_questions where key = 'fit_engagement_model')
       = '["Ongoing managed service","One-off project","Not sure"]'::jsonb, 'engagement options';
  assert (select options from crm.discovery_questions where key = 'fit_ownership')
       = '["You run it","We run it with you","You hand it to us"]'::jsonb, 'ownership options';
  assert (select options from crm.discovery_questions where key = 'fit_infrastructure')
       = '["Microsoft 365","Google Workspace","Salesforce","Other SaaS","Self-hosted","None"]'::jsonb, 'infrastructure options';
  assert (select options from crm.discovery_questions where key = 'fit_change_access')
       = '["We can give a partner admin or API access","Limited","No"]'::jsonb, 'change_access options';
  assert (select options from crm.discovery_questions where key = 'fit_budget_cadence')
       = '["Monthly","Per project","Grant-funded","Unknown"]'::jsonb, 'budget options';
  assert not exists (select 1 from crm.discovery_questions where section = 'Fit' and required), 'Fit not required';

  -- templates: section present once, items in order after the previous max position
  assert (select count(*) from crm.discovery_templates, jsonb_array_elements(sections) s
           where id = std and s->>'id' = 'fit') = 1, 'std fit section once';
  assert (select count(*) from crm.discovery_templates, jsonb_array_elements(sections) s
           where id = snp and s->>'id' = 'fit') = 1, 'snp fit section once';
  assert (select array_agg(q.key order by i."position") from crm.discovery_template_items i
            join crm.discovery_questions q on q.id = i.question_id
           where i.template_id = std and i.section_id = 'fit')
       = array['fit_engagement_model','fit_ownership','fit_infrastructure','fit_change_access','fit_budget_cadence'], 'std item order';
  assert (select array_agg(q.key order by i."position") from crm.discovery_template_items i
            join crm.discovery_questions q on q.id = i.question_id
           where i.template_id = snp and i.section_id = 'fit')
       = array['fit_engagement_model','fit_ownership','fit_infrastructure','fit_change_access','fit_budget_cadence'], 'snp item order';
  assert (select min("position") from crm.discovery_template_items where template_id = std and section_id = 'fit')
       > (select max("position") from crm.discovery_template_items where template_id = std and section_id <> 'fit'), 'std fit after rest';
  assert (select min("position") from crm.discovery_template_items where template_id = snp and section_id = 'fit')
       > (select max("position") from crm.discovery_template_items where template_id = snp and section_id <> 'fit'), 'snp fit after rest';

  -- Blank untouched
  assert not exists (select 1 from crm.discovery_templates, jsonb_array_elements(sections) s where id = blank and s->>'id' = 'fit'), 'blank has no fit section';
  assert not exists (select 1 from crm.discovery_template_items where template_id = blank and section_id = 'fit'), 'blank has no fit items';

end $$;

rollback;
