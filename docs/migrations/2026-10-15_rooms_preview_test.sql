-- SAFETY: run only as:  begin;  <2026-10-15_rooms_preview.sql>;  <this script>;  rollback;
-- This script writes test data and always ends by raising an exception, so it can never commit.
do $$
declare
  v_biz uuid; v_eng uuid; v_eng2 uuid; v_proto uuid; v_doc uuid; v_pv uuid; v_dv uuid;
  v_prefix text; r record; n int; n_before int; n_after int;
begin
  select id into v_biz from crm.businesses limit 1;
  insert into rooms.engagements (business_id, relationship, title) values (v_biz, 'prospect', 'PV-a') returning id into v_eng;
  insert into rooms.engagements (business_id, relationship, title) values (v_biz, 'client', 'PV-b') returning id into v_eng2;
  insert into rooms.deliverables (engagement_id, title, kind, welcome_message) values (v_eng, 'Proposal', 'document', 'Hi') returning id into v_doc;
  insert into rooms.deliverables (engagement_id, title) values (v_eng, 'App') returning id into v_proto;
  insert into rooms.deliverable_versions (deliverable_id, version_no, status, storage_prefix, manifest)
    values (v_proto, 1, 'draft', v_eng::text || '/' || v_proto::text || '/v1', '{"entry":"app.html","screens":[{"id":"s1","name":"One"}]}') returning id into v_pv;
  v_prefix := v_eng::text || '/' || v_doc::text || '/' || gen_random_uuid()::text;
  insert into rooms.deliverable_versions (deliverable_id, version_no, status, source, storage_prefix, manifest)
    values (v_doc, 1, 'draft', 'upload', v_prefix, '{"kind":"document","file":"document.pdf","filename":"Proposal.pdf","ext":"pdf","size":10}') returning id into v_dv;

  select count(*) into n_before from rooms.engagement_events where engagement_id in (v_eng, v_eng2);

  -- preview_room
  select * into r from rooms.preview_room(v_eng);
  if not found or r.title <> 'PV-a' or r.relationship <> 'prospect' or r.org_name is null or r.status is null then raise exception 'FAIL preview_room header'; end if;
  select count(*) into n from rooms.preview_room(gen_random_uuid());
  if n <> 0 then raise exception 'FAIL preview_room unknown engagement returns rows'; end if;
  select count(*) into n from rooms.preview_room(null);
  if n <> 0 then raise exception 'FAIL preview_room null returns rows'; end if;

  -- preview_list_deliverables: drafts included, scoped to the engagement
  select count(*) into n from rooms.preview_list_deliverables(v_eng);
  if n <> 2 then raise exception 'FAIL list expected 2 rows, got %', n; end if;
  select count(*) into n from rooms.preview_list_deliverables(v_eng) where status = 'draft';
  if n <> 2 then raise exception 'FAIL list must include drafts'; end if;
  select * into r from rooms.preview_list_deliverables(v_eng) where kind = 'document';
  if r.document->>'filename' <> 'Proposal.pdf' or r.welcome_message <> 'Hi' then raise exception 'FAIL list document info'; end if;
  select * into r from rooms.preview_list_deliverables(v_eng) where kind = 'prototype';
  if jsonb_array_length(r.screens) <> 1 or r.document is not null then raise exception 'FAIL list prototype screens'; end if;
  select count(*) into n from rooms.preview_list_deliverables(v_eng2);
  if n <> 0 then raise exception 'FAIL list leaks another engagement'; end if;
  select count(*) into n from rooms.preview_list_deliverables(null);
  if n <> 0 then raise exception 'FAIL list null returns rows'; end if;

  -- preview_version
  select * into r from rooms.preview_version(v_eng, v_pv);
  if not found or r.kind <> 'prototype' or r.entry <> 'app.html' or r.file is not null or r.storage_prefix <> v_eng::text || '/' || v_proto::text || '/v1' then raise exception 'FAIL preview_version prototype'; end if;
  select * into r from rooms.preview_version(v_eng, v_dv);
  if not found or r.kind <> 'document' or r.file <> 'document.pdf' or r.filename <> 'Proposal.pdf' or r.entry is not null or r.storage_prefix <> v_prefix then raise exception 'FAIL preview_version document'; end if;
  select count(*) into n from rooms.preview_version(v_eng2, v_pv);
  if n <> 0 then raise exception 'FAIL preview_version crosses engagements'; end if;
  select count(*) into n from rooms.preview_version(v_eng, gen_random_uuid());
  if n <> 0 then raise exception 'FAIL preview_version unknown version'; end if;
  select count(*) into n from rooms.preview_version(null, v_pv);
  if n <> 0 then raise exception 'FAIL preview_version null engagement'; end if;

  -- no side effects
  select count(*) into n_after from rooms.engagement_events where engagement_id in (v_eng, v_eng2);
  if n_after <> n_before then raise exception 'FAIL preview functions wrote events (% -> %)', n_before, n_after; end if;

  -- privileges
  if not has_function_privilege('portal_app', 'rooms.preview_room(uuid)', 'execute')
     or not has_function_privilege('portal_app', 'rooms.preview_list_deliverables(uuid)', 'execute')
     or not has_function_privilege('portal_app', 'rooms.preview_version(uuid, uuid)', 'execute')
  then raise exception 'FAIL portal_app lacks execute'; end if;
  if has_function_privilege('anon', 'rooms.preview_room(uuid)', 'execute')
     or has_function_privilege('authenticated', 'rooms.preview_list_deliverables(uuid)', 'execute')
     or has_function_privilege('anon', 'rooms.preview_version(uuid, uuid)', 'execute')
  then raise exception 'FAIL anon/authenticated can execute'; end if;

  raise exception 'ALL PREVIEW ASSERTIONS PASSED (rolled back)';
end $$;
