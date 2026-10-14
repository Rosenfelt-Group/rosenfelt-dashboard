-- Engagement Rooms Phase 2: portal access role, portal functions, atomic share.
-- The portal connects as portal_app (no table privileges). Everything it can do is a function below.
-- Brian sets portal_app's password in the Supabase dashboard (never in SQL).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'portal_app') then
    create role portal_app login noinherit nobypassrls connection limit 20;
  end if;
end $$;

alter role portal_app set statement_timeout = '5s';
alter role portal_app set idle_in_transaction_session_timeout = '5s';
grant usage on schema rooms to portal_app;

-- Internal helper: is this access (still) valid for this engagement?
create or replace function rooms._portal_access_ok(p_access uuid, p_eng uuid)
returns boolean language sql stable security definer set search_path = rooms, pg_temp as $$
  select exists (
    select 1
    from rooms.engagement_access a
    join rooms.engagements e on e.id = a.engagement_id
    where a.id = p_access and a.engagement_id = p_eng
      and a.revoked_at is null and a.expires_at > now()
      and e.status <> 'closed');
$$;

-- Exchange a hashed link for the room header; logs room_opened.
create or replace function rooms.portal_open_room(p_token_hash text)
returns table (access_id uuid, engagement_id uuid, expires_at timestamptz,
               title text, relationship text, org_name text, modules jsonb)
language plpgsql security definer set search_path = rooms, pg_temp as $$
#variable_conflict use_column
declare v_access rooms.engagement_access%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return; end if;
  select a.* into v_access from rooms.engagement_access a
   where a.token_hash = p_token_hash and a.revoked_at is null and a.expires_at > now();
  if not found then return; end if;
  if not rooms._portal_access_ok(v_access.id, v_access.engagement_id) then return; end if;
  update rooms.engagement_access set last_used_at = now() where id = v_access.id;
  insert into rooms.engagement_events (engagement_id, type, meta)
    values (v_access.engagement_id, 'room_opened', jsonb_build_object('access_id', v_access.id));
  return query
    select v_access.id, e.id, v_access.expires_at, e.title, e.relationship, b.name, e.modules
      from rooms.engagements e join crm.businesses b on b.id = e.business_id
     where e.id = v_access.engagement_id;
end $$;

-- Re-validate a session on every request; returns the header and (if given and valid) the contact.
create or replace function rooms.portal_session(p_access uuid, p_eng uuid, p_contact uuid)
returns table (access_id uuid, engagement_id uuid, expires_at timestamptz,
               title text, relationship text, org_name text, modules jsonb,
               contact_id uuid, contact_name text)
language plpgsql security definer set search_path = rooms, pg_temp as $$
#variable_conflict use_column
begin
  if p_access is null or p_eng is null or not rooms._portal_access_ok(p_access, p_eng) then return; end if;
  return query
    select a.id, e.id, a.expires_at, e.title, e.relationship, b.name, e.modules, c.id, c.name
      from rooms.engagement_access a
      join rooms.engagements e on e.id = a.engagement_id
      join crm.businesses b on b.id = e.business_id
      left join rooms.engagement_contacts c on c.id = p_contact and c.engagement_id = e.id
     where a.id = p_access;
end $$;

-- Self-asserted introduction. Returns the contact id, or null for any invalid input.
create or replace function rooms.portal_identify(p_access uuid, p_eng uuid, p_name text, p_email text)
returns uuid language plpgsql security definer set search_path = rooms, pg_temp as $$
declare v_name text := btrim(coalesce(p_name, '')); v_email text := lower(btrim(coalesce(p_email, ''))); v_id uuid;
begin
  if not rooms._portal_access_ok(p_access, p_eng) then return null; end if;
  if char_length(v_name) not between 1 and 100 then return null; end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then return null; end if;
  insert into rooms.engagement_contacts (engagement_id, name, email)
    values (p_eng, v_name, v_email)
  on conflict (engagement_id, lower(email)) do update set first_seen_at = rooms.engagement_contacts.first_seen_at
  returning id into v_id;
  insert into rooms.engagement_events (engagement_id, contact_id, type, meta)
    values (p_eng, v_id, 'contact_identified', jsonb_build_object('access_id', p_access));
  return v_id;
end $$;

-- Shared (never draft) versions of this engagement's deliverables. No storage_prefix, no raw manifest.
create or replace function rooms.portal_list_deliverables(p_access uuid, p_eng uuid)
returns table (deliverable_id uuid, deliverable_title text, description text,
               version_id uuid, version_no int, status text, shared_at timestamptz,
               change_summary text, screens jsonb)
language plpgsql security definer set search_path = rooms, pg_temp as $$
#variable_conflict use_column
begin
  if not rooms._portal_access_ok(p_access, p_eng) then return; end if;
  return query
    select d.id, d.title, d.description, v.id, v.version_no, v.status, v.shared_at, v.change_summary,
           case when jsonb_typeof(v.manifest->'screens') = 'array'
                then (select coalesce(jsonb_agg(jsonb_build_object('id', s->>'id', 'name', s->>'name')), '[]'::jsonb)
                        from jsonb_array_elements(v.manifest->'screens') s)
                else '[]'::jsonb end
      from rooms.deliverables d
      join rooms.deliverable_versions v on v.deliverable_id = d.id
     where d.engagement_id = p_eng
       and v.status in ('shared', 'superseded', 'approved', 'changes_requested')
     order by d.sort_order, d.created_at, v.version_no desc;
end $$;

-- What the portal server needs to sign a preview grant; logs version_viewed (deduplicated).
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
   where v.id = p_version and d.engagement_id = p_eng
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

-- Atomic Share (dashboard, service_role only): draft -> shared; previously shared version -> superseded.
create or replace function rooms.share_version(p_version uuid)
returns table (version_id uuid, version_no int, superseded_count int)
language plpgsql security definer set search_path = rooms, pg_temp as $$
#variable_conflict use_column
declare v rooms.deliverable_versions%rowtype; n int;
begin
  select * into v from rooms.deliverable_versions where id = p_version for update;
  if not found then raise exception 'version not found' using errcode = 'P0002'; end if;
  if v.status <> 'draft' then raise exception 'only a draft can be shared' using errcode = 'P0001'; end if;
  update rooms.deliverable_versions set status = 'superseded'
   where deliverable_id = v.deliverable_id and status = 'shared' and id <> v.id;
  get diagnostics n = row_count;
  update rooms.deliverable_versions set status = 'shared', shared_at = now() where id = v.id;
  return query select v.id, v.version_no, n;
end $$;

-- Privileges. rooms is exposed through the REST API: nothing may be executable by anon/authenticated.
revoke all on function rooms._portal_access_ok(uuid, uuid) from public, anon, authenticated;
revoke all on function rooms.portal_open_room(text) from public, anon, authenticated;
revoke all on function rooms.portal_session(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function rooms.portal_identify(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function rooms.portal_list_deliverables(uuid, uuid) from public, anon, authenticated;
revoke all on function rooms.portal_version_for_preview(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function rooms.share_version(uuid) from public, anon, authenticated;

grant execute on function rooms.portal_open_room(text) to portal_app, service_role;
grant execute on function rooms.portal_session(uuid, uuid, uuid) to portal_app, service_role;
grant execute on function rooms.portal_identify(uuid, uuid, text, text) to portal_app, service_role;
grant execute on function rooms.portal_list_deliverables(uuid, uuid) to portal_app, service_role;
grant execute on function rooms.portal_version_for_preview(uuid, uuid, uuid, uuid) to portal_app, service_role;
grant execute on function rooms.share_version(uuid) to service_role;
