-- SAFETY: run only as:  begin;  <2026-10-16_discovery_templates.sql>;  <this script>;  rollback;
-- This script writes test data and always ends by raising an exception, so it can never commit.
do $$
declare
  v_lead uuid; v_std uuid; v_snp uuid; v_inv uuid; n int; v_snap jsonb;
begin
  -- Seed
  select id into v_std from crm.discovery_templates where name = 'Standard Discovery' and is_default;
  if v_std is null then raise exception 'FAIL Standard Discovery missing or not default'; end if;
  select id into v_snp from crm.discovery_templates where name = 'Small Nonprofit: Productivity & Integration';
  if v_snp is null then raise exception 'FAIL Small Nonprofit template missing'; end if;
  select count(*) into n from crm.discovery_template_items where template_id = v_std; if n <> 62 then raise exception 'FAIL standard item count %', n; end if;
  select count(*) into n from crm.discovery_template_items where template_id = v_snp; if n <> 14 then raise exception 'FAIL nonprofit item count %', n; end if;
  select count(*) into n from crm.discovery_questions; if n <> 76 then raise exception 'FAIL bank count %', n; end if;
  select count(*) into n from crm.discovery_template_items where template_id = v_std and show_if is not null; if n <> 5 then raise exception 'FAIL showIf kept %', n; end if;
  select count(*) into n from crm.discovery_template_items i join crm.discovery_questions q on q.id = i.question_id
    where i.template_id = v_snp and q.type = 'yes_no' and q.config ? 'followUpLabel'; if n <> 1 then raise exception 'FAIL yes_no follow-up'; end if;
  -- Every template item's section exists in its template's sections list.
  select count(*) into n from crm.discovery_template_items i join crm.discovery_templates t on t.id = i.template_id
    where not exists (select 1 from jsonb_array_elements(t.sections) s where s->>'id' = i.section_id);
  if n <> 0 then raise exception 'FAIL % items point at unknown sections', n; end if;

  -- Backfill
  select count(*) into n from crm.discovery_invites where questionnaire_snapshot is null or template_id is null;
  if n <> 0 then raise exception 'FAIL % existing invites not backfilled', n; end if;
  select count(*) into n from crm.discovery_invites where questionnaire_snapshot->>'version' <> 'v1';
  if n <> 0 then raise exception 'FAIL backfilled snapshot is not v1'; end if;

  -- Freeze trigger
  select id into v_lead from crm.leads limit 1;
  insert into crm.discovery_invites (lead_id, project_title, status, sent_at, questionnaire_snapshot, template_id)
    values (v_lead, 'T draft', 'draft', null, '{"version":"t","sections":[]}', v_std) returning id into v_inv;
  update crm.discovery_invites set questionnaire_snapshot = '{"version":"t2","sections":[]}' where id = v_inv;  -- draft: allowed
  update crm.discovery_invites set status = 'sent', sent_at = now() where id = v_inv;
  begin
    update crm.discovery_invites set questionnaire_snapshot = '{"version":"t3","sections":[]}' where id = v_inv;
    raise exception 'FAIL snapshot editable after send';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    update crm.discovery_invites set status = 'draft' where id = v_inv;
    raise exception 'FAIL sent invite returned to draft';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  update crm.discovery_invites set status = 'opened', opened_at = now() where id = v_inv;  -- normal lifecycle still works
  select questionnaire_snapshot into v_snap from crm.discovery_invites where id = v_inv;
  if v_snap->>'version' <> 't2' then raise exception 'FAIL snapshot changed'; end if;
  -- Pre-templates dashboard inserts (v1, no snapshot) get the v1 definition.
  insert into crm.discovery_invites (lead_id, project_title) values (v_lead, 'T legacy') returning id into v_inv;
  select questionnaire_snapshot into v_snap from crm.discovery_invites where id = v_inv;
  if v_snap is distinct from crm.discovery_v1_definition() then raise exception 'FAIL legacy insert not snapshotted'; end if;
  if (select template_id from crm.discovery_invites where id = v_inv) is distinct from v_std then raise exception 'FAIL legacy insert template'; end if;
  begin
    insert into crm.discovery_invites (lead_id, project_title, status, questionnaire_version) values (v_lead, 'T nosnap', 'sent', 'v2');
    raise exception 'FAIL sent invite without snapshot';
  exception when check_violation then null;
  end;
  select id into v_inv from crm.discovery_invites where project_title = 'T draft';
  select questionnaire_snapshot into v_snap from crm.discovery_invites where id = v_inv;
  -- A template edit must not touch a sent invite.
  update crm.discovery_questions set label = 'changed' where key = 'why_now';
  delete from crm.discovery_template_items where template_id = v_std;
  if (select questionnaire_snapshot from crm.discovery_invites where id = v_inv) is distinct from v_snap then raise exception 'FAIL template edit leaked'; end if;
  begin
    delete from crm.discovery_questions where key = 'snp_owner';
    raise exception 'FAIL bank question in use was deletable';
  exception when foreign_key_violation then null;
  end;

  -- Atomic template save: reorders and replaces items; a bad item rolls the whole save back.
  perform crm.discovery_template_save(v_snp, '{"name":"SNP renamed","sections":[{"id":"x","title":"X"}]}',
    (select jsonb_agg(jsonb_build_object('question_id', question_id, 'section_id', 'x', 'project_types', '[]'::jsonb) order by position desc)
       from crm.discovery_template_items where template_id = v_snp));
  if (select name from crm.discovery_templates where id = v_snp) <> 'SNP renamed' then raise exception 'FAIL template rename'; end if;
  if (select q.key from crm.discovery_template_items i join crm.discovery_questions q on q.id = i.question_id
       where i.template_id = v_snp and i.position = 1) <> 'snp_success_90' then raise exception 'FAIL template reorder'; end if;
  if exists (select 1 from crm.discovery_template_items where template_id = v_snp and project_types is not null) then
    raise exception 'FAIL empty project_types should be null'; end if;
  begin
    perform crm.discovery_template_save(v_snp, '{"name":"SNP broken"}', '[{"question_id":"00000000-0000-0000-0000-000000000000","section_id":"x"}]');
    raise exception 'FAIL bad item accepted';
  exception when foreign_key_violation then null;
  end;
  select count(*) into n from crm.discovery_template_items where template_id = v_snp; if n <> 14 then raise exception 'FAIL failed save lost items (%)', n; end if;
  if (select name from crm.discovery_templates where id = v_snp) <> 'SNP renamed' then raise exception 'FAIL failed save kept rename'; end if;
  if has_function_privilege('anon', 'crm.discovery_template_save(uuid, jsonb, jsonb)', 'execute') then raise exception 'FAIL anon can save templates'; end if;

  -- Access
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'crm' and c.relname in ('discovery_questions','discovery_templates','discovery_template_items') and c.relrowsecurity;
  if n <> 3 then raise exception 'FAIL RLS not enabled on all new tables'; end if;
  select count(*) into n from pg_policies where schemaname = 'crm' and tablename in ('discovery_questions','discovery_templates','discovery_template_items');
  if n <> 0 then raise exception 'FAIL unexpected policies'; end if;
  if has_table_privilege('anon', 'crm.discovery_questions', 'select')
     or has_table_privilege('authenticated', 'crm.discovery_templates', 'select')
     or has_table_privilege('anon', 'crm.discovery_template_items', 'select')
  then raise exception 'FAIL anon/authenticated can read'; end if;

  raise exception 'ALL DISCOVERY TEMPLATE ASSERTIONS PASSED (rolled back)';
end $$;
