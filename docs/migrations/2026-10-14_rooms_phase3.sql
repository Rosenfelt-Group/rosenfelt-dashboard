-- Engagement Rooms Phase 3 batch: documents, deliverable delete, link refresh, per-deliverable welcome
-- message, version dates in the portal. Additive: widens two CHECKs, adds one nullable column and one
-- private bucket, adds four functions, narrows portal_version_for_preview (same signature, grants kept),
-- and re-creates portal_list_deliverables with a wider result (DROP + CREATE; grants re-applied below).

-- 1) Schema
alter table rooms.deliverables drop constraint deliverables_kind_check;
alter table rooms.deliverables add constraint deliverables_kind_check check (kind in ('prototype', 'document'));
alter table rooms.deliverable_versions drop constraint deliverable_versions_source_check;
alter table rooms.deliverable_versions add constraint deliverable_versions_source_check check (source in ('agent', 'upload'));
alter table rooms.deliverables add column welcome_message text
  constraint deliverables_welcome_message_check
  check (welcome_message is null or char_length(welcome_message) between 1 and 1000);

-- 2) Private bucket for room documents. Storage enforces the size cap and MIME list on every upload,
--    including signed-URL uploads from the browser.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('room-documents', 'room-documents', false, 26214400, array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png', 'image/jpeg', 'text/plain', 'text/csv', 'text/markdown'])
on conflict (id) do nothing;

-- 3) Delete a deliverable completely (dashboard, service_role only). Rows go first, atomically; the
--    caller removes the returned Storage objects afterwards. A failed Storage removal leaves orphan
--    files that no row points to, never a row that points to a missing file.
create or replace function rooms.delete_deliverable(p_deliverable uuid, p_actor text)
returns table (bucket text, object_name text)
language plpgsql security definer set search_path = rooms, pg_temp as $$
#variable_conflict use_column
declare d rooms.deliverables%rowtype; v_folder text; n_versions int; n_comments int; v_objects jsonb;
begin
  select * into d from rooms.deliverables where id = p_deliverable for update;
  if not found then raise exception 'deliverable not found' using errcode = 'P0002'; end if;
  v_folder := d.engagement_id::text || '/' || d.id::text || '/';
  select count(*) into n_versions from rooms.deliverable_versions v where v.deliverable_id = d.id;
  select count(*) into n_comments from rooms.deliverable_comments c
    join rooms.deliverable_versions v on v.id = c.version_id where v.deliverable_id = d.id;
  select coalesce(jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'name', o.name) order by o.bucket_id, o.name), '[]'::jsonb)
    into v_objects
    from storage.objects o
   where o.bucket_id in ('prototypes', 'room-documents') and starts_with(o.name, v_folder);
  insert into rooms.engagement_events (engagement_id, type, meta)
    values (d.engagement_id, 'deliverable_deleted', jsonb_build_object(
      'deliverable_id', d.id, 'deliverable_title', d.title, 'kind', d.kind,
      'version_count', n_versions, 'comment_count', n_comments,
      'object_count', jsonb_array_length(v_objects), 'storage_folder', v_folder,
      'actor', left(coalesce(p_actor, ''), 100)));
  delete from rooms.deliverables where id = d.id;
  return query select x->>'bucket', x->>'name' from jsonb_array_elements(v_objects) x;
end $$;

-- 4) Refresh a room link (dashboard, service_role only): revoke it and issue its replacement atomically.
create or replace function rooms.refresh_access(p_eng uuid, p_access uuid, p_token_hash text, p_expires_at timestamptz)
returns table (access_id uuid, expires_at timestamptz)
language plpgsql security definer set search_path = rooms, pg_temp as $$
#variable_conflict use_column
declare a rooms.engagement_access%rowtype; v_status text; v_id uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid token hash' using errcode = 'P0001'; end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '366 days' then
    raise exception 'invalid expiry' using errcode = 'P0001'; end if;
  select e.status into v_status from rooms.engagements e where e.id = p_eng;
  if not found then raise exception 'engagement not found' using errcode = 'P0002'; end if;
  if v_status = 'closed' then raise exception 'engagement is closed' using errcode = 'P0001'; end if;
  select * into a from rooms.engagement_access x where x.id = p_access and x.engagement_id = p_eng for update;
  if not found then raise exception 'link not found' using errcode = 'P0002'; end if;
  if a.revoked_at is not null then raise exception 'link already revoked' using errcode = 'P0001'; end if;
  update rooms.engagement_access set revoked_at = now() where id = a.id;
  insert into rooms.engagement_access (engagement_id, token_hash, label, expires_at)
    values (p_eng, p_token_hash, a.label, p_expires_at) returning id into v_id;
  insert into rooms.engagement_events (engagement_id, type, meta)
    values (p_eng, 'link_refreshed', jsonb_build_object('old_access_id', a.id, 'access_id', v_id));
  return query select v_id, p_expires_at;
end $$;

-- 5) Add an uploaded document as a draft version (dashboard, service_role only). The object must already
--    exist in room-documents with an allowed size and the MIME type that matches the extension.
create or replace function rooms.add_document_version(p_deliverable uuid, p_upload uuid, p_ext text,
                                                      p_filename text, p_change_summary text)
returns table (version_id uuid, version_no int)
language plpgsql security definer set search_path = rooms, pg_temp as $$
#variable_conflict use_column
declare
  d rooms.deliverables%rowtype;
  v_mime text := case p_ext
    when 'pdf'  then 'application/pdf'
    when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    when 'xlsx' then 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    when 'pptx' then 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    when 'png'  then 'image/png'
    when 'jpg'  then 'image/jpeg'
    when 'txt'  then 'text/plain'
    when 'csv'  then 'text/csv'
    when 'md'   then 'text/markdown'
  end;
  v_prefix text; v_file text; v_meta jsonb; v_size bigint; v_no int; v_id uuid;
begin
  if v_mime is null or p_upload is null then raise exception 'unsupported document' using errcode = 'P0001'; end if;
  if p_filename is null or char_length(p_filename) not between 1 and 150
     or p_filename ~ '[[:cntrl:]/\\"\u200e\u200f\u202a-\u202e\u2066-\u2069]'
     or left(p_filename, 1) = '.' or p_filename <> btrim(p_filename) then
    raise exception 'invalid file name' using errcode = 'P0001'; end if;
  if p_change_summary is not null and char_length(p_change_summary) > 500 then
    raise exception 'change summary too long' using errcode = 'P0001'; end if;
  select * into d from rooms.deliverables where id = p_deliverable for update;
  if not found then raise exception 'deliverable not found' using errcode = 'P0002'; end if;
  if d.kind <> 'document' then raise exception 'not a document deliverable' using errcode = 'P0001'; end if;
  v_prefix := d.engagement_id::text || '/' || d.id::text || '/' || p_upload::text;
  v_file := 'document.' || p_ext;
  select o.metadata into v_meta from storage.objects o
   where o.bucket_id = 'room-documents' and o.name = v_prefix || '/' || v_file;
  if not found then raise exception 'uploaded file not found' using errcode = 'P0001'; end if;
  v_size := case when jsonb_typeof(v_meta->'size') = 'number' then (v_meta->>'size')::bigint end;
  if v_size is null or v_size < 1 or v_size > 26214400 then raise exception 'file size not allowed' using errcode = 'P0001'; end if;
  if lower(btrim(split_part(coalesce(v_meta->>'mimetype', ''), ';', 1))) <> v_mime then
    raise exception 'file type mismatch' using errcode = 'P0001'; end if;
  if exists (select 1 from rooms.deliverable_versions x where x.storage_prefix = v_prefix) then
    raise exception 'upload already added' using errcode = '23505'; end if;
  select coalesce(max(x.version_no), 0) + 1 into v_no from rooms.deliverable_versions x where x.deliverable_id = d.id;
  insert into rooms.deliverable_versions (deliverable_id, version_no, status, source, storage_prefix, manifest, change_summary)
    values (d.id, v_no, 'draft', 'upload', v_prefix,
            jsonb_build_object('kind', 'document', 'file', v_file, 'filename', p_filename, 'ext', p_ext,
                               'mime', v_mime, 'size', v_size),
            nullif(btrim(coalesce(p_change_summary, '')), ''))
    returning id into v_id;
  return query select v_id, v_no;
end $$;

-- 6) Portal: shared (never draft) documents of this engagement; logs document_downloaded (deduplicated).
create or replace function rooms.portal_document_for_download(p_access uuid, p_eng uuid, p_contact uuid, p_version uuid)
returns table (storage_prefix text, file text, filename text)
language plpgsql security definer set search_path = rooms, pg_temp as $$
#variable_conflict use_column
declare v_contact uuid := null; v_row record;
begin
  if not rooms._portal_access_ok(p_access, p_eng) then return; end if;
  select v.storage_prefix as sp, v.manifest->>'file' as f, v.manifest->>'filename' as fn
    into v_row
    from rooms.deliverable_versions v join rooms.deliverables d on d.id = v.deliverable_id
   where v.id = p_version and d.engagement_id = p_eng and d.kind = 'document' and v.source = 'upload'
     and v.status in ('shared', 'superseded', 'approved', 'changes_requested');
  if not found then return; end if;
  if p_contact is not null and exists (select 1 from rooms.engagement_contacts c where c.id = p_contact and c.engagement_id = p_eng)
    then v_contact := p_contact; end if;
  if not exists (select 1 from rooms.engagement_events ev
                  where ev.engagement_id = p_eng and ev.type = 'document_downloaded' and ev.version_id = p_version
                    and ev.contact_id is not distinct from v_contact and ev.created_at > now() - interval '10 minutes') then
    insert into rooms.engagement_events (engagement_id, version_id, contact_id, type, meta)
      values (p_eng, p_version, v_contact, 'document_downloaded', jsonb_build_object('access_id', p_access));
  end if;
  return query select v_row.sp, v_row.f, v_row.fn;
end $$;

-- 7) Prototype previews only for prototypes (same signature as Phase 2, so its grants are kept).
create or replace function rooms.portal_version_for_preview(p_access uuid, p_eng uuid, p_contact uuid, p_version uuid)
returns table (storage_prefix text, entry text, deliverable_id uuid, version_no int)
language plpgsql security definer set search_path = rooms, pg_temp as $$
#variable_conflict use_column
declare v_contact uuid := null; v_row record;
begin
  if not rooms._portal_access_ok(p_access, p_eng) then return; end if;
  select v.storage_prefix as sp, coalesce(v.manifest->>'entry', 'index.html') as ent, d.id as did, v.version_no as vno
    into v_row
    from rooms.deliverable_versions v join rooms.deliverables d on d.id = v.deliverable_id
   where v.id = p_version and d.engagement_id = p_eng and d.kind = 'prototype'
     and v.status in ('shared', 'superseded', 'approved', 'changes_requested');
  if not found then return; end if;
  if p_contact is not null and exists (select 1 from rooms.engagement_contacts c where c.id = p_contact and c.engagement_id = p_eng)
    then v_contact := p_contact; end if;
  if not exists (select 1 from rooms.engagement_events ev
                  where ev.engagement_id = p_eng and ev.type = 'version_viewed' and ev.version_id = p_version
                    and ev.contact_id is not distinct from v_contact and ev.created_at > now() - interval '10 minutes') then
    insert into rooms.engagement_events (engagement_id, version_id, contact_id, type, meta)
      values (p_eng, p_version, v_contact, 'version_viewed', jsonb_build_object('access_id', p_access));
  end if;
  return query select v_row.sp, v_row.ent, v_row.did, v_row.vno;
end $$;

-- 8) Wider portal list (return shape changes, so DROP + CREATE; grants re-applied below).
--    Callers: portal lib/queries.ts listDeliverables (select *), used by handleDeliverables.
drop function if exists rooms.portal_list_deliverables(uuid, uuid);
create function rooms.portal_list_deliverables(p_access uuid, p_eng uuid)
returns table (deliverable_id uuid, deliverable_title text, description text, kind text, welcome_message text,
               version_id uuid, version_no int, status text, shared_at timestamptz, created_at timestamptz,
               change_summary text, screens jsonb, document jsonb)
language plpgsql security definer set search_path = rooms, pg_temp as $$
#variable_conflict use_column
begin
  if not rooms._portal_access_ok(p_access, p_eng) then return; end if;
  return query
    select d.id, d.title, d.description, d.kind, d.welcome_message,
           v.id, v.version_no, v.status, v.shared_at, v.created_at, v.change_summary,
           case when d.kind = 'prototype' and jsonb_typeof(v.manifest->'screens') = 'array'
                then (select coalesce(jsonb_agg(jsonb_build_object('id', s->>'id', 'name', s->>'name')), '[]'::jsonb)
                        from jsonb_array_elements(v.manifest->'screens') s)
                else '[]'::jsonb end,
           case when d.kind = 'document'
                then jsonb_build_object('filename', v.manifest->'filename', 'ext', v.manifest->'ext', 'size', v.manifest->'size')
                else null end
      from rooms.deliverables d
      join rooms.deliverable_versions v on v.deliverable_id = d.id
     where d.engagement_id = p_eng
       and v.status in ('shared', 'superseded', 'approved', 'changes_requested')
     order by d.sort_order, d.created_at, v.version_no desc;
end $$;

-- 9) Privileges. rooms is exposed through the REST API: nothing may be executable by anon/authenticated.
revoke all on function rooms.delete_deliverable(uuid, text) from public, anon, authenticated;
revoke all on function rooms.refresh_access(uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function rooms.add_document_version(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function rooms.portal_document_for_download(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function rooms.portal_list_deliverables(uuid, uuid) from public, anon, authenticated;

grant execute on function rooms.delete_deliverable(uuid, text) to service_role;
grant execute on function rooms.refresh_access(uuid, uuid, text, timestamptz) to service_role;
grant execute on function rooms.add_document_version(uuid, uuid, text, text, text) to service_role;
grant execute on function rooms.portal_document_for_download(uuid, uuid, uuid, uuid) to portal_app, service_role;
grant execute on function rooms.portal_list_deliverables(uuid, uuid) to portal_app, service_role;

notify pgrst, 'reload schema';
