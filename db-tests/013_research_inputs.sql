-- Tests for 2026-10-25_c_research_scope_inputs.sql: research brief links, scope research inputs,
-- research_used on scope versions, and riley_app's access to them.
-- Everything runs in one transaction that is rolled back.
begin;

-- seed (superuser)
insert into crm.businesses (id, name) values
  ('00000000-0000-0000-0013-000000000001', 'Research Test Org'),
  ('00000000-0000-0000-0013-000000000002', 'Other Test Org');
insert into crm.leads (id, business_id) values ('00000000-0000-0000-0013-000000000003', '00000000-0000-0000-0013-000000000001');
insert into crm.business_research (id, business_id, summary, details, source, researched_by) values
  ('00000000-0000-0000-0013-000000000010', '00000000-0000-0000-0013-000000000001', 'Uses Google Sheets for volunteers.',
   '{"findings":[{"title":"Sheets","description":"600 shifts a month"}]}', 'avery_research_engine', 'avery'),
  ('00000000-0000-0000-0013-000000000011', '00000000-0000-0000-0013-000000000002', 'Other org note.', null, 'manual', 'brian');
insert into public.doc_registry (name, path, doc_type, content)
  values ('Research Brief: SMS tools', 'test/013-sms.md', 'reference', repeat('x', 9000));
insert into public.research_briefs (id, topic, research_type, doc_id) values
  ('00000000-0000-0000-0013-000000000020', 'SMS reminder tools', 'tool',
   (select id::text from public.doc_registry where path = 'test/013-sms.md')),
  ('00000000-0000-0000-0013-000000000021', 'research test org', 'business', null),
  ('00000000-0000-0000-0013-000000000022', 'Unlinked brief', 'trend', 'not-a-number');

-- backfill_links_business_briefs_by_name (re-run the backfill statement on the seeded rows)
do $$
begin
  insert into public.research_brief_links (brief_id, business_id, linked_by)
  select rb.id, b.id, 'system'
    from public.research_briefs rb
    join crm.businesses b on lower(btrim(b.name)) = lower(btrim(rb.topic))
   where rb.research_type = 'business'
  on conflict (brief_id, business_id) do nothing;
  assert (select count(*) from public.research_brief_links
           where brief_id = '00000000-0000-0000-0013-000000000021'
             and business_id = '00000000-0000-0000-0013-000000000001') = 1, 'business brief linked by case-insensitive name';
  assert (select count(*) from public.research_brief_links where brief_id = '00000000-0000-0000-0013-000000000020') = 0,
    'non-business briefs are not backfilled';
end $$;

-- new_business_brief_is_linked_on_insert
do $$
begin
  insert into public.research_briefs (id, topic, research_type) values
    ('00000000-0000-0000-0013-000000000023', 'OTHER TEST ORG ', 'business'),
    ('00000000-0000-0000-0013-000000000024', 'Other Test Org', 'competitor');
  assert (select count(*) from public.research_brief_links
           where brief_id = '00000000-0000-0000-0013-000000000023'
             and business_id = '00000000-0000-0000-0013-000000000002') = 1, 'trigger links a new business brief';
  assert (select count(*) from public.research_brief_links where brief_id = '00000000-0000-0000-0013-000000000024') = 0,
    'trigger ignores other research types';
end $$;

-- scope_research_inputs_exactly_one_item
do $$
declare n int := 0;
begin
  begin
    insert into crm.scope_research_inputs (business_id) values ('00000000-0000-0000-0013-000000000001');
  exception when check_violation then n := n + 1; end;
  begin
    insert into crm.scope_research_inputs (business_id, business_research_id, research_brief_id)
      values ('00000000-0000-0000-0013-000000000001', '00000000-0000-0000-0013-000000000010', '00000000-0000-0000-0013-000000000021');
  exception when check_violation then n := n + 1; end;
  assert n = 2, 'exactly one of business_research_id / research_brief_id';
end $$;

-- scope_research_inputs_item_must_belong_to_business
do $$
declare n int := 0;
begin
  -- another organization's note
  begin
    insert into crm.scope_research_inputs (business_id, business_research_id)
      values ('00000000-0000-0000-0013-000000000001', '00000000-0000-0000-0013-000000000011');
  exception when foreign_key_violation then n := n + 1; end;
  -- a brief that is not linked to this organization
  begin
    insert into crm.scope_research_inputs (business_id, research_brief_id)
      values ('00000000-0000-0000-0013-000000000001', '00000000-0000-0000-0013-000000000020');
  exception when foreign_key_violation then n := n + 1; end;
  assert n = 2, 'selections must reference the organization''s own note or a linked brief';
end $$;

-- scope_research_inputs_unique_per_item
do $$
declare ok boolean := false;
begin
  insert into crm.scope_research_inputs (business_id, business_research_id, added_by)
    values ('00000000-0000-0000-0013-000000000001', '00000000-0000-0000-0013-000000000010', 'brian');
  begin
    insert into crm.scope_research_inputs (business_id, business_research_id)
      values ('00000000-0000-0000-0013-000000000001', '00000000-0000-0000-0013-000000000010');
  exception when unique_violation then ok := true; end;
  assert ok, 'one selection per item';
end $$;

-- unlinking_a_brief_drops_its_selection
do $$
begin
  insert into public.research_brief_links (brief_id, business_id) values
    ('00000000-0000-0000-0013-000000000020', '00000000-0000-0000-0013-000000000001'),
    ('00000000-0000-0000-0013-000000000022', '00000000-0000-0000-0013-000000000001');
  insert into crm.scope_research_inputs (business_id, research_brief_id) values
    ('00000000-0000-0000-0013-000000000001', '00000000-0000-0000-0013-000000000020'),
    ('00000000-0000-0000-0013-000000000001', '00000000-0000-0000-0013-000000000022');
  delete from public.research_brief_links
   where brief_id = '00000000-0000-0000-0013-000000000022' and business_id = '00000000-0000-0000-0013-000000000001';
  assert (select count(*) from crm.scope_research_inputs where research_brief_id = '00000000-0000-0000-0013-000000000022') = 0,
    'selection removed with its link';
end $$;

-- scope_research_context_returns_selected_items_bounded
do $$
declare v jsonb; note jsonb; brief jsonb;
begin
  v := crm.scope_research_context('00000000-0000-0000-0013-000000000001', 1000);
  assert jsonb_array_length(v) = 2, 'note + linked brief, got ' || v::text;
  select e into note from jsonb_array_elements(v) e where e->>'type' = 'note';
  select e into brief from jsonb_array_elements(v) e where e->>'type' = 'brief';
  assert note->>'id' = '00000000-0000-0000-0013-000000000010', 'note id';
  assert note->>'text' like 'Uses Google Sheets for volunteers.%- Sheets: 600 shifts a month', 'note text has summary + findings: ' || (note->>'text');
  assert note->>'title' = 'Avery research', 'note title';
  assert brief->>'title' = 'SMS reminder tools' and length(brief->>'text') = 1000, 'brief doc text cut to p_max_chars';
  assert jsonb_array_length(crm.scope_research_context('00000000-0000-0000-0013-000000000002')) = 0, 'nothing selected elsewhere';
end $$;

-- scope_research_context_skips_soft_deleted (deleted_at comes from stream A1; added here if absent)
alter table crm.business_research add column if not exists deleted_at timestamptz;
alter table public.research_briefs add column if not exists deleted_at timestamptz;
do $$
begin
  update crm.business_research set deleted_at = now() where id = '00000000-0000-0000-0013-000000000010';
  assert (select count(*) from jsonb_array_elements(crm.scope_research_context('00000000-0000-0000-0013-000000000001')) e
           where e->>'type' = 'note') = 0, 'soft-deleted note skipped';
  update crm.business_research set deleted_at = null where id = '00000000-0000-0000-0013-000000000010';
  update public.research_briefs set deleted_at = now() where id = '00000000-0000-0000-0013-000000000020';
  assert (select count(*) from jsonb_array_elements(crm.scope_research_context('00000000-0000-0000-0013-000000000001')) e
           where e->>'type' = 'brief') = 0, 'soft-deleted brief skipped';
  update public.research_briefs set deleted_at = null where id = '00000000-0000-0000-0013-000000000020';
end $$;

-- research_used_defaults_and_riley_only_writes
do $$
declare doc uuid; v1 uuid; vb uuid; ok boolean := false;
begin
  v1 := crm.create_initial_scope_from_brief('00000000-0000-0000-0013-000000000001', '00000000-0000-0000-0013-000000000003',
          null, null, 'Research scope', '[{"key":"a","title":"A","body_md":"x","visibility":"client"}]', 'project', 'hybrid', null);
  assert (select research_used from crm.scope_versions where id = v1) = '[]'::jsonb, 'research_used defaults to []';
  perform crm.set_scope_version_research_used(v1,
    '[{"type":"note","id":"00000000-0000-0000-0013-000000000010","title":"Avery research"}]');
  assert (select research_used->0->>'type' from crm.scope_versions where id = v1) = 'note', 'research_used written';
  select scope_document_id into doc from crm.scope_versions where id = v1;
  vb := crm.create_scope_version_current(doc, '[]', 'brian', 'brian', null, v1);
  begin perform crm.set_scope_version_research_used(vb, '[]'); exception when sqlstate 'SC003' then ok := true; end;
  assert ok, 'cannot set research_used on Brian''s versions';
  ok := false;
  begin perform crm.set_scope_version_research_used(v1, '[{"type":"x","id":"1"}]'); exception when sqlstate 'SC005' then ok := true; end;
  assert ok, 'bad items rejected';
end $$;

set role riley_app;

-- riley_reads_selections_and_research
do $$
begin
  assert (select count(*) from crm.scope_research_inputs where business_id = '00000000-0000-0000-0013-000000000001') = 2, 'riley sees selections';
  assert (select count(*) from public.research_brief_links where business_id = '00000000-0000-0000-0013-000000000001') >= 2, 'riley sees links';
  assert (select count(*) from public.research_briefs where id = '00000000-0000-0000-0013-000000000020') = 1, 'riley sees briefs';
  assert jsonb_array_length(crm.scope_research_context('00000000-0000-0000-0013-000000000001')) = 2, 'riley can call the context function';
end $$;

-- riley_cannot_change_selections_links_or_versions_directly
do $$
declare n int := 0;
begin
  begin delete from crm.scope_research_inputs; exception when insufficient_privilege then n := n + 1; end;
  begin insert into public.research_brief_links (brief_id, business_id)
          values ('00000000-0000-0000-0013-000000000022', '00000000-0000-0000-0013-000000000002');
  exception when insufficient_privilege then n := n + 1; end;
  begin update crm.scope_versions set research_used = '[]'; exception when insufficient_privilege then n := n + 1; end;
  begin perform 1 from public.doc_registry limit 1; exception when insufficient_privilege then n := n + 1; end;
  assert n = 4, 'riley write/doc access must be denied, got ' || n;
end $$;

reset role;

rollback;
