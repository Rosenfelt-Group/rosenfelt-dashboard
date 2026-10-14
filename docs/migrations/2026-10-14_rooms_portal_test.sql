do $$
declare
  v_biz uuid; v_eng uuid; v_eng2 uuid; v_acc uuid; v_acc_rev uuid; v_acc_exp uuid; v_acc_other uuid;
  v_hash text := encode(sha256('portal-test-token'::bytea), 'hex');
  v_hash_rev text := encode(sha256('portal-test-revoked'::bytea), 'hex');
  v_hash_exp text := encode(sha256('portal-test-expired'::bytea), 'hex');
  v_del uuid; v_del2 uuid; v_draft uuid; v_shared uuid; v_super uuid; v_other uuid; v_contact uuid; v_contact2 uuid; n int; r record; v_ok boolean;
begin
  -- Lets the migration role `SET ROLE portal_app/anon/authenticated` for the privilege checks (rolled back with everything else).
  grant portal_app to current_user;
  select id into v_biz from crm.businesses limit 1;
  insert into rooms.engagements (business_id, relationship, title) values (v_biz, 'prospect', 'T1') returning id into v_eng;
  insert into rooms.engagements (business_id, relationship, title) values (v_biz, 'partner', 'T2') returning id into v_eng2;
  insert into rooms.engagement_access (engagement_id, token_hash) values (v_eng, v_hash) returning id into v_acc;
  insert into rooms.engagement_access (engagement_id, token_hash, revoked_at) values (v_eng, v_hash_rev, now()) returning id into v_acc_rev;
  insert into rooms.engagement_access (engagement_id, token_hash, expires_at) values (v_eng, v_hash_exp, now() - interval '1 hour') returning id into v_acc_exp;
  insert into rooms.engagement_access (engagement_id, token_hash) values (v_eng2, encode(sha256('portal-test-other'::bytea), 'hex')) returning id into v_acc_other;
  insert into rooms.deliverables (engagement_id, title) values (v_eng, 'D1') returning id into v_del;
  insert into rooms.deliverables (engagement_id, title) values (v_eng2, 'D2') returning id into v_del2;
  insert into rooms.deliverable_versions (deliverable_id, version_no, status, storage_prefix, manifest)
    values (v_del, 1, 'superseded', 'a/b/v1', '{"entry":"index.html","screens":[{"id":"s1","name":"One"}]}') returning id into v_super;
  insert into rooms.deliverable_versions (deliverable_id, version_no, status, storage_prefix, manifest)
    values (v_del, 2, 'shared', 'a/b/v2', '{"entry":"index.html","screens":[{"id":"s1","name":"One"}]}') returning id into v_shared;
  insert into rooms.deliverable_versions (deliverable_id, version_no, status, storage_prefix, manifest)
    values (v_del, 3, 'draft', 'a/b/v3', '{"entry":"index.html"}') returning id into v_draft;
  insert into rooms.deliverable_versions (deliverable_id, version_no, status, storage_prefix, manifest)
    values (v_del2, 1, 'shared', 'c/d/v1', '{"entry":"index.html"}') returning id into v_other;

  -- open_room
  select count(*) into n from rooms.portal_open_room(v_hash);                 if n <> 1 then raise exception 'FAIL open valid'; end if;
  select count(*) into n from rooms.portal_open_room(v_hash_rev);             if n <> 0 then raise exception 'FAIL open revoked'; end if;
  select count(*) into n from rooms.portal_open_room(v_hash_exp);             if n <> 0 then raise exception 'FAIL open expired'; end if;
  select count(*) into n from rooms.portal_open_room('nothex');               if n <> 0 then raise exception 'FAIL open malformed'; end if;
  select count(*) into n from rooms.portal_open_room(repeat('0', 64));        if n <> 0 then raise exception 'FAIL open unknown'; end if;
  select count(*) into n from rooms.engagement_events where engagement_id = v_eng and type = 'room_opened'; if n <> 1 then raise exception 'FAIL room_opened event count %', n; end if;
  update rooms.engagements set status = 'closed' where id = v_eng;
  select count(*) into n from rooms.portal_open_room(v_hash);                 if n <> 0 then raise exception 'FAIL open closed engagement'; end if;
  update rooms.engagements set status = 'active' where id = v_eng;

  -- session
  select count(*) into n from rooms.portal_session(v_acc, v_eng, null);       if n <> 1 then raise exception 'FAIL session valid'; end if;
  select count(*) into n from rooms.portal_session(v_acc, v_eng2, null);      if n <> 0 then raise exception 'FAIL session wrong engagement'; end if;
  select count(*) into n from rooms.portal_session(v_acc_rev, v_eng, null);   if n <> 0 then raise exception 'FAIL session revoked'; end if;
  select count(*) into n from rooms.portal_session(v_acc_other, v_eng, null); if n <> 0 then raise exception 'FAIL session other access'; end if;

  -- identify
  v_contact := rooms.portal_identify(v_acc, v_eng, '  Pat Example ', 'Pat@Example.org ');
  if v_contact is null then raise exception 'FAIL identify valid'; end if;
  v_contact2 := rooms.portal_identify(v_acc, v_eng, 'Someone Else', 'pat@example.org');
  if v_contact2 is distinct from v_contact then raise exception 'FAIL identify dedupe'; end if;
  select name into r from rooms.engagement_contacts where id = v_contact;
  if r.name <> 'Pat Example' then raise exception 'FAIL identify name kept: %', r.name; end if;
  if rooms.portal_identify(v_acc, v_eng, 'X', 'not-an-email') is not null then raise exception 'FAIL identify bad email'; end if;
  if rooms.portal_identify(v_acc, v_eng, repeat('x', 101), 'a@b.co') is not null then raise exception 'FAIL identify long name'; end if;
  if rooms.portal_identify(v_acc, v_eng, '', 'a@b.co') is not null then raise exception 'FAIL identify empty name'; end if;
  if rooms.portal_identify(v_acc_rev, v_eng, 'X', 'a@b.co') is not null then raise exception 'FAIL identify revoked'; end if;
  if rooms.portal_identify(v_acc, v_eng2, 'X', 'a@b.co') is not null then raise exception 'FAIL identify wrong engagement'; end if;
  select count(*) into n from rooms.portal_session(v_acc, v_eng, v_contact) where contact_id = v_contact; if n <> 1 then raise exception 'FAIL session contact'; end if;
  select count(*) into n from rooms.portal_session(v_acc, v_eng, v_contact2) s where s.contact_id is null; if n <> 0 and v_contact2 = v_contact then raise exception 'FAIL session contact sanity'; end if;

  -- list deliverables: no drafts, no other engagement, no prefix column
  select count(*) into n from rooms.portal_list_deliverables(v_acc, v_eng);   if n <> 2 then raise exception 'FAIL list expected 2 got %', n; end if;
  select count(*) into n from rooms.portal_list_deliverables(v_acc, v_eng) where version_id = v_draft; if n <> 0 then raise exception 'FAIL draft visible'; end if;
  select count(*) into n from rooms.portal_list_deliverables(v_acc_rev, v_eng); if n <> 0 then raise exception 'FAIL list revoked'; end if;
  select count(*) into n from rooms.portal_list_deliverables(v_acc, v_eng2);  if n <> 0 then raise exception 'FAIL list wrong engagement'; end if;

  -- preview
  select count(*) into n from rooms.portal_version_for_preview(v_acc, v_eng, v_contact, v_draft);   if n <> 0 then raise exception 'FAIL preview draft'; end if;
  select count(*) into n from rooms.portal_version_for_preview(v_acc, v_eng, v_contact, v_other);   if n <> 0 then raise exception 'FAIL preview other engagement'; end if;
  select count(*) into n from rooms.portal_version_for_preview(v_acc_exp, v_eng, v_contact, v_shared); if n <> 0 then raise exception 'FAIL preview expired'; end if;
  select * into r from rooms.portal_version_for_preview(v_acc, v_eng, v_contact, v_shared);
  if r.storage_prefix <> 'a/b/v2' or r.entry <> 'index.html' then raise exception 'FAIL preview shared'; end if;
  perform rooms.portal_version_for_preview(v_acc, v_eng, v_contact, v_shared);
  select count(*) into n from rooms.engagement_events where version_id = v_shared and type = 'version_viewed'; if n <> 1 then raise exception 'FAIL view dedupe %', n; end if;
  perform rooms.portal_version_for_preview(v_acc, v_eng, v_contact, v_super);
  select count(*) into n from rooms.engagement_events where version_id = v_super and type = 'version_viewed'; if n <> 1 then raise exception 'FAIL superseded viewable'; end if;

  -- share_version
  select count(*) into n from rooms.share_version(v_draft);                    if n <> 1 then raise exception 'FAIL share'; end if;
  select status into r from rooms.deliverable_versions where id = v_draft;     if r.status <> 'shared' then raise exception 'FAIL share status'; end if;
  select status into r from rooms.deliverable_versions where id = v_shared;    if r.status <> 'superseded' then raise exception 'FAIL previous not superseded'; end if;
  -- NOTE: `raise exception` defaults to SQLSTATE P0001, so never raise a FAIL inside a block that catches P0001.
  v_ok := false;
  begin perform rooms.share_version(v_draft); exception when sqlstate 'P0001' then v_ok := true; end;
  if not v_ok then raise exception 'FAIL double share'; end if;
  v_ok := false;
  begin perform rooms.share_version(gen_random_uuid()); exception when sqlstate 'P0002' then v_ok := true; end;
  if not v_ok then raise exception 'FAIL share unknown'; end if;

  -- function-level EXECUTE must be absent for anon/authenticated (independent of schema USAGE)
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'rooms' and (p.proname like 'portal\_%' or p.proname in ('share_version', '_portal_access_ok')) loop
    if has_function_privilege('anon', r.sig, 'execute') or has_function_privilege('authenticated', r.sig, 'execute') then
      raise exception 'FAIL function-level execute for anon/authenticated on %', r.sig;
    end if;
  end loop;
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'rooms' and (p.proname like 'portal\_%' or p.proname in ('share_version', '_portal_access_ok'));
  if n <> 7 then raise exception 'FAIL expected 7 portal functions, found %', n; end if;

  -- privileges: anon / authenticated may execute nothing
  begin set local role anon; perform rooms.portal_open_room(v_hash); reset role; raise exception 'FAIL anon executes open_room';
  exception when insufficient_privilege then reset role; end;
  begin set local role authenticated; perform rooms.portal_session(v_acc, v_eng, null); reset role; raise exception 'FAIL authenticated executes session';
  exception when insufficient_privilege then reset role; end;
  begin set local role anon; perform rooms.share_version(v_draft); reset role; raise exception 'FAIL anon executes share';
  exception when insufficient_privilege then reset role; end;

  -- privileges: portal_app executes the portal functions and nothing else
  set local role portal_app;
  select count(*) into n from rooms.portal_open_room(v_hash);                  if n <> 1 then raise exception 'FAIL portal_app open_room'; end if;
  begin perform 1 from rooms.engagements limit 1; reset role; raise exception 'FAIL portal_app reads engagements';
  exception when insufficient_privilege then reset role; end;
  set local role portal_app;
  begin perform 1 from rooms.engagement_access limit 1; reset role; raise exception 'FAIL portal_app reads access';
  exception when insufficient_privilege then reset role; end;
  set local role portal_app;
  begin perform 1 from crm.businesses limit 1; reset role; raise exception 'FAIL portal_app reads crm';
  exception when insufficient_privilege then reset role; end;
  set local role portal_app;
  begin insert into rooms.engagement_events (engagement_id, type) values (v_eng, 'x'); reset role; raise exception 'FAIL portal_app inserts events';
  exception when insufficient_privilege then reset role; end;
  set local role portal_app;
  begin perform rooms.share_version(v_draft); reset role; raise exception 'FAIL portal_app executes share';
  exception when insufficient_privilege then reset role; end;
  set local role portal_app;
  begin perform rooms._portal_access_ok(v_acc, v_eng); reset role; raise exception 'FAIL portal_app executes helper';
  exception when insufficient_privilege then reset role; end;
  set local role portal_app;
  begin execute 'create table public.portal_probe(x int)'; reset role; raise exception 'FAIL portal_app creates tables';
  exception when insufficient_privilege then reset role; end;
  reset role;
end $$;
