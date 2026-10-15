do $$
declare
  v_biz uuid; v_eng uuid; v_eng2 uuid; v_acc uuid; v_acc2 uuid; v_new_acc uuid; v_contact uuid;
  v_hash text := encode(sha256('phase3-test-token'::bytea), 'hex');
  v_hash_new text := encode(sha256('phase3-test-new'::bytea), 'hex');
  v_hash_x text := encode(sha256('phase3-test-x'::bytea), 'hex');
  v_proto uuid; v_doc uuid; v_pv uuid; v_dv1 uuid; v_dv2 uuid;
  v_up1 uuid := gen_random_uuid(); v_up2 uuid := gen_random_uuid(); v_up3 uuid := gen_random_uuid();
  v_prefix1 text; v_folder text; n int; r record; v_ok boolean;
begin
  grant portal_app to current_user;
  select id into v_biz from crm.businesses limit 1;
  insert into rooms.engagements (business_id, relationship, title) values (v_biz, 'prospect', 'P3a') returning id into v_eng;
  insert into rooms.engagements (business_id, relationship, title) values (v_biz, 'client', 'P3b') returning id into v_eng2;
  insert into rooms.engagement_access (engagement_id, token_hash, label) values (v_eng, v_hash, 'Board') returning id into v_acc;
  insert into rooms.engagement_access (engagement_id, token_hash) values (v_eng2, encode(sha256('phase3-other'::bytea), 'hex')) returning id into v_acc2;
  v_contact := rooms.portal_identify(v_acc, v_eng, 'Pat', 'pat@example.org');

  -- schema: kind, source, welcome_message
  insert into rooms.deliverables (engagement_id, title, kind, welcome_message) values (v_eng, 'Proposal', 'document', E'Hello\nthere') returning id into v_doc;
  insert into rooms.deliverables (engagement_id, title) values (v_eng, 'App') returning id into v_proto;
  v_ok := false; begin insert into rooms.deliverables (engagement_id, title, kind) values (v_eng, 'x', 'video'); exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'FAIL kind check accepts video'; end if;
  v_ok := false; begin update rooms.deliverables set welcome_message = repeat('x', 1001) where id = v_doc; exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'FAIL welcome 1001 chars accepted'; end if;
  v_ok := false; begin update rooms.deliverables set welcome_message = '' where id = v_doc; exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'FAIL empty welcome accepted'; end if;
  update rooms.deliverables set welcome_message = repeat('y', 1000) where id = v_doc;
  update rooms.deliverables set welcome_message = E'Hello\nthere' where id = v_doc;
  insert into rooms.deliverable_versions (deliverable_id, version_no, status, storage_prefix, manifest)
    values (v_proto, 1, 'shared', v_eng::text || '/' || v_proto::text || '/v1', '{"entry":"index.html","screens":[{"id":"s1","name":"One"}]}') returning id into v_pv;

  -- add_document_version
  v_prefix1 := v_eng::text || '/' || v_doc::text || '/' || v_up1::text;
  v_ok := false; begin perform rooms.add_document_version(v_doc, v_up1, 'pdf', 'Proposal.pdf', null); exception when sqlstate 'P0001' then v_ok := true; end;
  if not v_ok then raise exception 'FAIL add without uploaded object'; end if;
  insert into storage.objects (bucket_id, name, metadata) values ('room-documents', v_prefix1 || '/document.pdf', '{"size": 1234, "mimetype": "application/pdf"}');
  select * into r from rooms.add_document_version(v_doc, v_up1, 'pdf', 'Proposal.pdf', '  First draft  ');
  v_dv1 := r.version_id;
  if r.version_no <> 1 then raise exception 'FAIL first document version_no %', r.version_no; end if;
  select * into r from rooms.deliverable_versions where id = v_dv1;
  if r.status <> 'draft' or r.source <> 'upload' or r.storage_prefix <> v_prefix1 or r.change_summary <> 'First draft'
     or r.manifest->>'file' <> 'document.pdf' or r.manifest->>'filename' <> 'Proposal.pdf' or (r.manifest->>'size')::int <> 1234 then
    raise exception 'FAIL document version row %', row_to_json(r); end if;
  v_ok := false; begin perform rooms.add_document_version(v_doc, v_up1, 'pdf', 'Proposal.pdf', null); exception when sqlstate 'P0001' then v_ok := true; end;
  if not v_ok then raise exception 'FAIL same upload added twice'; end if;
  insert into storage.objects (bucket_id, name, metadata)
    values ('room-documents', v_eng::text || '/' || v_doc::text || '/' || v_up2::text || '/document.docx', '{"size": 10, "mimetype": "application/pdf"}');
  v_ok := false; begin perform rooms.add_document_version(v_doc, v_up2, 'docx', 'a.docx', null); exception when sqlstate 'P0001' then v_ok := true; end;
  if not v_ok then raise exception 'FAIL mime mismatch accepted'; end if;
  update storage.objects set metadata = '{"size": 26214401, "mimetype": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}'
   where bucket_id = 'room-documents' and name = v_eng::text || '/' || v_doc::text || '/' || v_up2::text || '/document.docx';
  v_ok := false; begin perform rooms.add_document_version(v_doc, v_up2, 'docx', 'a.docx', null); exception when sqlstate 'P0001' then v_ok := true; end;
  if not v_ok then raise exception 'FAIL oversize accepted'; end if;
  v_ok := false; begin perform rooms.add_document_version(v_doc, gen_random_uuid(), 'exe', 'a.exe', null); exception when sqlstate 'P0001' then v_ok := true; end;
  if not v_ok then raise exception 'FAIL exe accepted'; end if;
  -- hostile file names: use a VALID, not-yet-added object (v_up3, markdown) so only the name can cause the refusal;
  -- the same object is added successfully with a safe name further down, proving it was valid.
  insert into storage.objects (bucket_id, name, metadata)
    values ('room-documents', v_eng::text || '/' || v_doc::text || '/' || v_up3::text || '/document.md', '{"size": 20, "mimetype": "text/markdown"}');
  declare v_name text; begin
    foreach v_name in array array['a/b.md', 'a"b.md', E'a\nb.md', '.hidden.md', ' padded.md', E'evil‮dm.txt', repeat('n', 151)] loop
      v_ok := false;
      begin perform rooms.add_document_version(v_doc, v_up3, 'md', v_name, null); exception when sqlstate 'P0001' then v_ok := true; end;
      if not v_ok then raise exception 'FAIL hostile file name accepted: %', v_name; end if;
    end loop;
  end;
  select count(*) into n from rooms.deliverable_versions where storage_prefix = v_eng::text || '/' || v_doc::text || '/' || v_up3::text;
  if n <> 0 then raise exception 'FAIL a hostile name created a version'; end if;
  v_ok := false; begin perform rooms.add_document_version(v_proto, v_up1, 'pdf', 'x.pdf', null); exception when sqlstate 'P0001' then v_ok := true; end;
  if not v_ok then raise exception 'FAIL document added to a prototype deliverable'; end if;
  v_ok := false; begin perform rooms.add_document_version(gen_random_uuid(), v_up1, 'pdf', 'x.pdf', null); exception when sqlstate 'P0002' then v_ok := true; end;
  if not v_ok then raise exception 'FAIL unknown deliverable'; end if;

  -- portal list: drafts hidden, new columns, no prefix column
  select count(*) into n from rooms.portal_list_deliverables(v_acc, v_eng) where deliverable_id = v_doc;
  if n <> 0 then raise exception 'FAIL draft document visible'; end if;
  perform rooms.share_version(v_dv1);
  select * into r from rooms.portal_list_deliverables(v_acc, v_eng) where version_id = v_dv1;
  if r.kind <> 'document' or r.welcome_message <> E'Hello\nthere' or r.created_at is null or r.screens <> '[]'::jsonb
     or r.document->>'filename' <> 'Proposal.pdf' or r.document->>'ext' <> 'pdf' or (r.document->>'size')::int <> 1234 then
    raise exception 'FAIL list document row %', row_to_json(r); end if;
  select * into r from rooms.portal_list_deliverables(v_acc, v_eng) where version_id = v_pv;
  if r.kind <> 'prototype' or r.document is not null or jsonb_array_length(r.screens) <> 1 or r.welcome_message is not null then
    raise exception 'FAIL list prototype row %', row_to_json(r); end if;
  if pg_get_function_result('rooms.portal_list_deliverables(uuid,uuid)'::regprocedure) ~ 'storage_prefix|manifest' then
    raise exception 'FAIL list exposes storage_prefix or manifest'; end if;

  -- preview vs download separation
  select count(*) into n from rooms.portal_version_for_preview(v_acc, v_eng, v_contact, v_dv1);  if n <> 0 then raise exception 'FAIL document previewable as prototype'; end if;
  select count(*) into n from rooms.portal_version_for_preview(v_acc, v_eng, v_contact, v_pv);   if n <> 1 then raise exception 'FAIL prototype preview broken'; end if;
  select count(*) into n from rooms.portal_document_for_download(v_acc, v_eng, v_contact, v_pv); if n <> 0 then raise exception 'FAIL prototype downloadable as document'; end if;
  select * into r from rooms.portal_document_for_download(v_acc, v_eng, v_contact, v_dv1);
  if r.storage_prefix <> v_prefix1 or r.file <> 'document.pdf' or r.filename <> 'Proposal.pdf' then raise exception 'FAIL download row'; end if;
  perform rooms.portal_document_for_download(v_acc, v_eng, v_contact, v_dv1);
  select count(*) into n from rooms.engagement_events where version_id = v_dv1 and type = 'document_downloaded';
  if n <> 1 then raise exception 'FAIL download event dedupe %', n; end if;
  select count(*) into n from rooms.portal_document_for_download(v_acc2, v_eng2, null, v_dv1); if n <> 0 then raise exception 'FAIL download from other engagement'; end if;
  select count(*) into n from rooms.portal_document_for_download(v_acc2, v_eng, null, v_dv1);  if n <> 0 then raise exception 'FAIL download with other access'; end if;
  select version_id into v_dv2 from rooms.add_document_version(v_doc, v_up3, 'md', 'Notes.md', null);
  select count(*) into n from rooms.portal_document_for_download(v_acc, v_eng, v_contact, v_dv2); if n <> 0 then raise exception 'FAIL draft document downloadable'; end if;
  select version_no into n from rooms.deliverable_versions where id = v_dv2; if n <> 2 then raise exception 'FAIL second version_no %', n; end if;

  -- refresh_access
  select * into r from rooms.refresh_access(v_eng, v_acc, v_hash_new, now() + interval '60 days');
  v_new_acc := r.access_id;
  select count(*) into n from rooms.engagement_access where id = v_acc and revoked_at is not null; if n <> 1 then raise exception 'FAIL old link not revoked'; end if;
  select count(*) into n from rooms.engagement_access where id = v_new_acc and label = 'Board' and token_hash = v_hash_new and revoked_at is null;
  if n <> 1 then raise exception 'FAIL new link row'; end if;
  select count(*) into n from rooms.portal_open_room(v_hash);     if n <> 0 then raise exception 'FAIL old link still opens'; end if;
  select count(*) into n from rooms.portal_open_room(v_hash_new); if n <> 1 then raise exception 'FAIL new link does not open'; end if;
  select count(*) into n from rooms.engagement_events where engagement_id = v_eng and type = 'link_refreshed'; if n <> 1 then raise exception 'FAIL link_refreshed event'; end if;
  v_ok := false; begin perform rooms.refresh_access(v_eng, v_acc, v_hash_x, now() + interval '1 day'); exception when sqlstate 'P0001' then v_ok := true; end;
  if not v_ok then raise exception 'FAIL refresh of a revoked link (double click)'; end if;
  v_ok := false; begin perform rooms.refresh_access(v_eng2, v_new_acc, v_hash_x, now() + interval '1 day'); exception when sqlstate 'P0002' then v_ok := true; end;
  if not v_ok then raise exception 'FAIL refresh across engagements'; end if;
  v_ok := false; begin perform rooms.refresh_access(v_eng, v_new_acc, 'nothex', now() + interval '1 day'); exception when sqlstate 'P0001' then v_ok := true; end;
  if not v_ok then raise exception 'FAIL refresh with bad hash'; end if;
  v_ok := false; begin perform rooms.refresh_access(v_eng, v_new_acc, v_hash_x, now() - interval '1 day'); exception when sqlstate 'P0001' then v_ok := true; end;
  if not v_ok then raise exception 'FAIL refresh with past expiry'; end if;
  update rooms.engagements set status = 'closed' where id = v_eng;
  v_ok := false; begin perform rooms.refresh_access(v_eng, v_new_acc, v_hash_x, now() + interval '1 day'); exception when sqlstate 'P0001' then v_ok := true; end;
  if not v_ok then raise exception 'FAIL refresh in a closed room'; end if;
  update rooms.engagements set status = 'active' where id = v_eng;

  -- delete_deliverable
  insert into rooms.deliverable_comments (version_id, screen_id, body, author_user) values (v_dv1, 'doc', 'Looks good', 'brian');
  insert into storage.objects (bucket_id, name, metadata) values ('prototypes', v_eng::text || '/' || v_proto::text || '/v1/index.html', '{}');
  insert into storage.objects (bucket_id, name, metadata) values ('room-documents', v_eng::text || '/' || v_doc::text || '/' || gen_random_uuid()::text || '/document.pdf', '{}');
  v_folder := v_eng::text || '/' || v_doc::text || '/';
  n := 0;
  for r in select * from rooms.delete_deliverable(v_doc, 'brian') loop
    n := n + 1;
    if r.bucket <> 'room-documents' or not starts_with(r.object_name, v_folder) then raise exception 'FAIL delete returned foreign object %', r.object_name; end if;
  end loop;
  if n <> 4 then raise exception 'FAIL delete expected 4 objects (3 uploads + 1 orphan), got %', n; end if;
  select count(*) into n from rooms.deliverables where id = v_doc;                         if n <> 0 then raise exception 'FAIL deliverable still there'; end if;
  select count(*) into n from rooms.deliverable_versions where id in (v_dv1, v_dv2);       if n <> 0 then raise exception 'FAIL versions still there'; end if;
  select count(*) into n from rooms.deliverable_comments where version_id = v_dv1;         if n <> 0 then raise exception 'FAIL comments still there'; end if;
  select count(*) into n from rooms.engagement_events where type = 'document_downloaded' and engagement_id = v_eng and version_id is null;
  if n <> 1 then raise exception 'FAIL earlier events must survive with version_id null'; end if;
  select * into r from rooms.engagement_events where engagement_id = v_eng and type = 'deliverable_deleted';
  if r.meta->>'deliverable_title' <> 'Proposal' or (r.meta->>'version_count')::int <> 2 or (r.meta->>'comment_count')::int <> 1
     or (r.meta->>'object_count')::int <> 4 or r.meta->>'actor' <> 'brian' then raise exception 'FAIL delete event meta %', r.meta; end if;
  select count(*) into n from rooms.deliverable_versions where id = v_pv;                  if n <> 1 then raise exception 'FAIL other deliverable touched'; end if;
  select count(*) into n from storage.objects where starts_with(name, v_folder);           if n <> 4 then raise exception 'FAIL function must not delete storage rows itself'; end if;
  v_ok := false; begin perform rooms.delete_deliverable(v_doc, 'brian'); exception when sqlstate 'P0002' then v_ok := true; end;
  if not v_ok then raise exception 'FAIL delete twice'; end if;

  -- function-level EXECUTE: none for anon/authenticated
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'rooms' and (p.proname like 'portal\_%' or p.proname in
              ('share_version', '_portal_access_ok', 'delete_deliverable', 'refresh_access', 'add_document_version')) loop
    if has_function_privilege('anon', r.sig, 'execute') or has_function_privilege('authenticated', r.sig, 'execute') then
      raise exception 'FAIL function-level execute for anon/authenticated on %', r.sig;
    end if;
  end loop;
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'rooms' and (p.proname like 'portal\_%' or p.proname in
     ('share_version', '_portal_access_ok', 'delete_deliverable', 'refresh_access', 'add_document_version'));
  if n <> 11 then raise exception 'FAIL expected 11 room functions, found %', n; end if;
  if not has_function_privilege('service_role', 'rooms.delete_deliverable(uuid,text)', 'execute')
     or not has_function_privilege('service_role', 'rooms.refresh_access(uuid,uuid,text,timestamptz)', 'execute')
     or not has_function_privilege('service_role', 'rooms.add_document_version(uuid,uuid,text,text,text)', 'execute')
     or not has_function_privilege('portal_app', 'rooms.portal_list_deliverables(uuid,uuid)', 'execute')
     or not has_function_privilege('portal_app', 'rooms.portal_document_for_download(uuid,uuid,uuid,uuid)', 'execute')
     or not has_function_privilege('portal_app', 'rooms.portal_version_for_preview(uuid,uuid,uuid,uuid)', 'execute') then
    raise exception 'FAIL expected grants missing'; end if;

  -- portal_app: portal functions yes; service functions, tables and Storage no
  set local role portal_app;
  select count(*) into n from rooms.portal_list_deliverables(v_new_acc, v_eng); if n <> 1 then raise exception 'FAIL portal_app list'; end if;
  reset role;
  set local role portal_app;
  begin perform rooms.delete_deliverable(v_proto, 'x'); reset role; raise exception 'FAIL portal_app executes delete_deliverable';
  exception when insufficient_privilege then reset role; end;
  set local role portal_app;
  begin perform rooms.refresh_access(v_eng, v_new_acc, v_hash_x, now() + interval '1 day'); reset role; raise exception 'FAIL portal_app executes refresh_access';
  exception when insufficient_privilege then reset role; end;
  set local role portal_app;
  begin perform rooms.add_document_version(v_proto, v_up1, 'pdf', 'x.pdf', null); reset role; raise exception 'FAIL portal_app executes add_document_version';
  exception when insufficient_privilege then reset role; end;
  set local role portal_app;
  begin perform 1 from storage.objects limit 1; reset role; raise exception 'FAIL portal_app reads storage.objects';
  exception when insufficient_privilege then reset role; end;
  set local role portal_app;
  begin perform 1 from rooms.deliverables limit 1; reset role; raise exception 'FAIL portal_app reads deliverables';
  exception when insufficient_privilege then reset role; end;
  begin set local role anon; perform rooms.portal_document_for_download(v_new_acc, v_eng, null, v_pv); reset role; raise exception 'FAIL anon executes download';
  exception when insufficient_privilege then reset role; end;
  reset role;
end $$;
