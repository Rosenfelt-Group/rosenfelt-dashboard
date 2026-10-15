-- Engagement Rooms: Preview room read functions (staff preview, drafts included). Additive only:
-- three new functions, no table changes. They take only an engagement id, so the portal (which verifies
-- a signed preview cookie before calling them) is the trust boundary. They never write rows.

create or replace function rooms.preview_room(p_eng uuid)
returns table (engagement_id uuid, title text, relationship text, org_name text, status text)
language plpgsql security definer set search_path = rooms, pg_temp as $$
#variable_conflict use_column
begin
  if p_eng is null then return; end if;
  return query
    select e.id, e.title, e.relationship, b.name, e.status
      from rooms.engagements e
      join crm.businesses b on b.id = e.business_id
     where e.id = p_eng;
end $$;

create or replace function rooms.preview_list_deliverables(p_eng uuid)
returns table (deliverable_id uuid, deliverable_title text, description text, kind text, welcome_message text,
               version_id uuid, version_no int, status text, shared_at timestamptz, created_at timestamptz,
               change_summary text, screens jsonb, document jsonb)
language plpgsql security definer set search_path = rooms, pg_temp as $$
#variable_conflict use_column
begin
  if p_eng is null then return; end if;
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
     order by d.sort_order, d.created_at, v.version_no desc;
end $$;

create or replace function rooms.preview_version(p_eng uuid, p_version uuid)
returns table (kind text, storage_prefix text, entry text, file text, filename text)
language plpgsql security definer set search_path = rooms, pg_temp as $$
#variable_conflict use_column
begin
  if p_eng is null or p_version is null then return; end if;
  return query
    select d.kind, v.storage_prefix,
           case when d.kind = 'prototype' then coalesce(v.manifest->>'entry', 'index.html') end,
           case when d.kind = 'document' then v.manifest->>'file' end,
           case when d.kind = 'document' then v.manifest->>'filename' end
      from rooms.deliverable_versions v
      join rooms.deliverables d on d.id = v.deliverable_id
     where v.id = p_version and d.engagement_id = p_eng
       and (d.kind = 'prototype' or (d.kind = 'document' and v.source = 'upload'));
end $$;

revoke all on function rooms.preview_room(uuid) from public, anon, authenticated;
revoke all on function rooms.preview_list_deliverables(uuid) from public, anon, authenticated;
revoke all on function rooms.preview_version(uuid, uuid) from public, anon, authenticated;

grant execute on function rooms.preview_room(uuid) to portal_app, service_role;
grant execute on function rooms.preview_list_deliverables(uuid) to portal_app, service_role;
grant execute on function rooms.preview_version(uuid, uuid) to portal_app, service_role;

notify pgrst, 'reload schema';
