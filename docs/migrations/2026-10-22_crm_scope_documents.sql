-- Rosably 3.0 phase 1, task 11: living scope documents with versions.
-- NOT YET APPLIED. Apply by hand with the owner's approval (psql service=rosably -f ...).
-- Idempotent. Requires crm.businesses, crm.leads, crm.clients, rooms.engagements, crm.discovery_briefs.
--
-- Model: one scope_document per client/prospect; scope_versions are immutable-ish snapshots of
-- `sections` (jsonb array of {key,title,body_md,visibility}). Exactly one version is `current`.
--  - source 'brief'  : version 1, generated from the discovery pre-call brief
--  - source 'brian'  : Brian's direct edits, inserted current via crm.create_scope_version_current
--  - source 'riley'  : proposals (status 'proposed'); Brian accepts via crm.accept_scope_version
-- Access: service_role only (RLS on, no policies). riley_app (created by Task 10) gets S/I/U on the
-- tables but NO execute on the accept/create-current functions: only Brian accepts.

begin;

-- ---------------------------------------------------------------------------------------------
-- Shape validation for sections (usable in a CHECK; table-less, immutable)
-- ---------------------------------------------------------------------------------------------
create or replace function crm.scope_sections_valid(s jsonb)
returns boolean
language sql
immutable
as $$
  select case
    when jsonb_typeof(s) <> 'array' then false
    else not exists (
      select 1
        from jsonb_array_elements(s) e
       where jsonb_typeof(e) <> 'object'
          or not (e ?& array['key', 'title', 'body_md', 'visibility'])
          or jsonb_typeof(e -> 'key') is distinct from 'string'
          or jsonb_typeof(e -> 'title') is distinct from 'string'
          or jsonb_typeof(e -> 'body_md') is distinct from 'string'
          or jsonb_typeof(e -> 'visibility') is distinct from 'string'
          or (e ->> 'key') = ''
          or (e ->> 'visibility') not in ('internal', 'client')
    )
  end
$$;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------
create table if not exists crm.scope_documents (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references crm.businesses(id),
  lead_id            uuid references crm.leads(id) on delete set null,
  client_id          uuid references crm.clients(id) on delete set null,
  engagement_id      uuid references rooms.engagements(id) on delete set null,
  title              text not null,
  engagement_type    text,
  delivery_model     text,
  current_version_id uuid,
  created_at         timestamptz not null default now(),
  constraint scope_documents_engagement_type_check
    check (engagement_type in ('managed_service', 'project', 'pro_bono')),
  constraint scope_documents_delivery_model_check
    check (delivery_model in ('agentic', 'hybrid', 'manual', 'unknown'))
);
create index if not exists scope_documents_business_idx on crm.scope_documents (business_id);
create index if not exists scope_documents_lead_idx on crm.scope_documents (lead_id) where lead_id is not null;
create index if not exists scope_documents_client_idx on crm.scope_documents (client_id) where client_id is not null;
-- document key: one document per business+lead, and one per business+client
create unique index if not exists scope_documents_business_lead_key
  on crm.scope_documents (business_id, lead_id) where lead_id is not null;
create unique index if not exists scope_documents_business_client_key
  on crm.scope_documents (business_id, client_id) where client_id is not null;
create index if not exists scope_documents_engagement_idx on crm.scope_documents (engagement_id) where engagement_id is not null;

create table if not exists crm.scope_versions (
  id                   uuid primary key default gen_random_uuid(),
  scope_document_id    uuid not null references crm.scope_documents(id) on delete cascade,
  version_no           integer not null,
  sections             jsonb not null default '[]'::jsonb,
  status               text not null,
  source               text not null,
  change_note          text,
  based_on_version_id  uuid references crm.scope_versions(id) on delete set null,
  created_by           text,
  created_at           timestamptz not null default now(),
  decided_at           timestamptz,
  constraint scope_versions_status_check
    check (status in ('current', 'proposed', 'rejected', 'superseded')),
  constraint scope_versions_source_check
    check (source in ('brief', 'brian', 'riley')),
  constraint scope_versions_sections_shape
    check (jsonb_typeof(sections) = 'array'),
  constraint scope_versions_sections_elements
    check (crm.scope_sections_valid(sections)),
  constraint scope_versions_doc_version_no_key unique (scope_document_id, version_no)
);
-- one current version per document
create unique index if not exists scope_versions_one_current
  on crm.scope_versions (scope_document_id) where status = 'current';
create index if not exists scope_versions_doc_idx on crm.scope_versions (scope_document_id, status);

-- circular pointer (added after both tables exist)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'scope_documents_current_version_fk') then
    alter table crm.scope_documents
      add constraint scope_documents_current_version_fk
      foreign key (current_version_id) references crm.scope_versions(id) on delete set null;
  end if;
end $$;

alter table crm.discovery_briefs
  add column if not exists scope_version_id uuid references crm.scope_versions(id) on delete set null;

-- based_on_version_id must belong to the same document
create or replace function crm.scope_versions_check_base()
returns trigger
language plpgsql
security definer
set search_path = crm, public, pg_temp
as $$
begin
  if new.based_on_version_id is not null and not exists (
    select 1 from crm.scope_versions b
     where b.id = new.based_on_version_id and b.scope_document_id = new.scope_document_id
  ) then
    raise exception 'based_on_version_id % does not belong to document %', new.based_on_version_id, new.scope_document_id using errcode = 'SC005';
  end if;
  return new;
end;
$$;
drop trigger if exists scope_versions_check_base on crm.scope_versions;
create trigger scope_versions_check_base
  before insert or update of based_on_version_id, scope_document_id on crm.scope_versions
  for each row execute function crm.scope_versions_check_base();

-- ---------------------------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------------------------
-- Accept a Riley proposal. Refuses non-proposed versions and stale proposals.
create or replace function crm.accept_scope_version(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = crm, public, pg_temp
as $$
declare
  v_doc uuid;
  v     crm.scope_versions%rowtype;
  d     crm.scope_documents%rowtype;
begin
  select scope_document_id into v_doc from crm.scope_versions where id = p_version_id;
  if v_doc is null then
    raise exception 'scope version not found: %', p_version_id using errcode = 'SC003';
  end if;

  -- serialize on the document row, then re-read the version under the lock
  select * into d from crm.scope_documents where id = v_doc for update;
  select * into v from crm.scope_versions where id = p_version_id;

  if v.status <> 'proposed' then
    raise exception 'not proposed: version % has status %', p_version_id, v.status using errcode = 'SC002';
  end if;
  -- stale unless based on the current version; NULL base is allowed only for the first version
  if v.based_on_version_id is distinct from d.current_version_id then
    raise exception 'stale proposal: version % is based on %, document current is %',
      p_version_id, v.based_on_version_id, d.current_version_id using errcode = 'SC001';
  end if;

  if d.current_version_id is not null then
    update crm.scope_versions set status = 'superseded' where id = d.current_version_id;
  end if;
  update crm.scope_versions set status = 'current', decided_at = now() where id = p_version_id;
  update crm.scope_documents set current_version_id = p_version_id where id = v_doc;
end;
$$;

-- Insert a new current version (Brian's edits, or version 1 from the brief), superseding the previous one.
-- p_based_on must equal the document's current version (NULL only when there is none), else SQLSTATE SC001.
-- Error SQLSTATEs: SC001 stale, SC002 not proposed, SC003 not found, SC004 already exists, SC005 validation/ownership.
drop function if exists crm.create_scope_version_current(uuid, jsonb, text, text, text);
create or replace function crm.create_scope_version_current(
  p_doc_id uuid, p_sections jsonb, p_source text, p_created_by text, p_change_note text,
  p_based_on uuid
) returns uuid
language plpgsql
security definer
set search_path = crm, public, pg_temp
as $$
declare
  d     crm.scope_documents%rowtype;
  v_no  integer;
  v_id  uuid;
begin
  select * into d from crm.scope_documents where id = p_doc_id for update;
  if not found then
    raise exception 'scope document not found: %', p_doc_id using errcode = 'SC003';
  end if;

  -- optimistic concurrency, checked under the document lock: the caller must have seen the current version
  if p_based_on is distinct from d.current_version_id then
    raise exception 'stale edit: based on %, document current is %', p_based_on, d.current_version_id
      using errcode = 'SC001';
  end if;

  select coalesce(max(version_no), 0) + 1 into v_no from crm.scope_versions where scope_document_id = p_doc_id;

  update crm.scope_versions set status = 'superseded'
   where scope_document_id = p_doc_id and status = 'current';

  insert into crm.scope_versions
    (scope_document_id, version_no, sections, status, source, change_note, based_on_version_id, created_by, decided_at)
  values
    (p_doc_id, v_no, p_sections, 'current', p_source, p_change_note, d.current_version_id, p_created_by, now())
  returning id into v_id;

  update crm.scope_documents set current_version_id = v_id where id = p_doc_id;
  return v_id;
end;
$$;

-- Riley: create v1 from the discovery brief ("create or fail"). Validates every reference before any
-- write. Finds/creates the document (key: business+lead, else business+client). An EXISTING document
-- that has no current version is NOT altered (no engagement_*/type/model backfill): only v1 + the
-- current pointer are written. Refuses if a current version exists or the brief is already linked.
create or replace function crm.create_initial_scope_from_brief(
  p_business_id uuid, p_lead_id uuid, p_client_id uuid, p_engagement_id uuid, p_title text,
  p_sections jsonb, p_engagement_type text, p_delivery_model text, p_brief_id uuid
) returns uuid
language plpgsql
security definer
set search_path = crm, public, pg_temp
as $$
declare
  d      crm.scope_documents%rowtype;
  v_id   uuid;
  v_title text := btrim(p_title);
  v_rows integer;
begin
  if p_business_id is null or (p_lead_id is null and p_client_id is null) then
    raise exception 'business_id and one of lead_id/client_id are required' using errcode = 'SC005';
  end if;
  if v_title is null or char_length(v_title) < 1 or char_length(v_title) > 200 then
    raise exception 'title must be 1-200 characters' using errcode = 'SC005';
  end if;
  if p_lead_id is not null and not exists
     (select 1 from crm.leads where id = p_lead_id and business_id = p_business_id) then
    raise exception 'lead % does not belong to business %', p_lead_id, p_business_id using errcode = 'SC005';
  end if;
  if p_client_id is not null and not exists
     (select 1 from crm.clients where id = p_client_id and business_id = p_business_id) then
    raise exception 'client % does not belong to business %', p_client_id, p_business_id using errcode = 'SC005';
  end if;
  if p_brief_id is not null then
    if p_lead_id is null then
      raise exception 'a brief requires lead_id' using errcode = 'SC005';
    end if;
    if not exists (select 1 from crm.discovery_briefs b join crm.discovery_invites i on i.id = b.invite_id
                    where b.id = p_brief_id and i.lead_id = p_lead_id) then
      raise exception 'brief % does not belong to lead %', p_brief_id, p_lead_id using errcode = 'SC005';
    end if;
    if exists (select 1 from crm.discovery_briefs where id = p_brief_id and scope_version_id is not null) then
      raise exception 'brief % is already linked to a scope version', p_brief_id using errcode = 'SC005';
    end if;
  end if;

  if p_lead_id is not null then
    select * into d from crm.scope_documents where business_id = p_business_id and lead_id = p_lead_id for update;
  else
    select * into d from crm.scope_documents where business_id = p_business_id and client_id = p_client_id for update;
  end if;

  if not found then
    insert into crm.scope_documents
      (business_id, lead_id, client_id, engagement_id, title, engagement_type, delivery_model)
    values
      (p_business_id, p_lead_id, p_client_id, p_engagement_id, v_title, p_engagement_type, p_delivery_model)
    returning * into d;
  elsif d.current_version_id is not null then
    raise exception 'scope already exists for document %', d.id using errcode = 'SC004';
  end if;

  insert into crm.scope_versions
    (scope_document_id, version_no, sections, status, source, created_by, decided_at)
  values
    (d.id, coalesce((select max(version_no) from crm.scope_versions where scope_document_id = d.id), 0) + 1,
     p_sections, 'current', 'brief', 'riley', now())
  returning id into v_id;

  update crm.scope_documents set current_version_id = v_id where id = d.id;

  if p_brief_id is not null then
    update crm.discovery_briefs set scope_version_id = v_id where id = p_brief_id and scope_version_id is null;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'brief % could not be linked', p_brief_id using errcode = 'SC005';
    end if;
  end if;
  return v_id;
end;
$$;

-- Riley: propose a change, based on the document's current version (read under the document lock).
-- Refuses documents with no current version; note <= 2000 chars; sections <= 200 KB; <= 5 pending per doc.
create or replace function crm.propose_scope_version(p_document_id uuid, p_sections jsonb, p_change_note text)
returns uuid
language plpgsql
security definer
set search_path = crm, public, pg_temp
as $$
declare
  d    crm.scope_documents%rowtype;
  v_id uuid;
begin
  if char_length(p_change_note) > 2000 then
    raise exception 'change note too long (max 2000 characters)' using errcode = 'SC005';
  end if;
  if octet_length(p_sections::text) > 204800 then
    raise exception 'sections too large (max 200 KB)' using errcode = 'SC005';
  end if;
  select * into d from crm.scope_documents where id = p_document_id for update;
  if not found then
    raise exception 'scope document not found: %', p_document_id using errcode = 'SC003';
  end if;
  if d.current_version_id is null then
    raise exception 'scope document % has no current version; cannot propose', p_document_id using errcode = 'SC005';
  end if;
  if (select count(*) from crm.scope_versions where scope_document_id = p_document_id and status = 'proposed') >= 5 then
    raise exception 'too many pending proposals for document % (max 5)', p_document_id using errcode = 'SC005';
  end if;
  insert into crm.scope_versions
    (scope_document_id, version_no, sections, status, source, change_note, based_on_version_id, created_by)
  values
    (p_document_id,
     coalesce((select max(version_no) from crm.scope_versions where scope_document_id = p_document_id), 0) + 1,
     p_sections, 'proposed', 'riley', p_change_note, d.current_version_id, 'riley')
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------
alter table crm.scope_documents enable row level security;
alter table crm.scope_versions enable row level security;
-- no policies: service_role bypasses RLS; everyone else is denied

revoke all on crm.scope_documents, crm.scope_versions from public, anon, authenticated;
grant select, insert, update, delete on crm.scope_documents, crm.scope_versions to service_role;

revoke all on function crm.accept_scope_version(uuid) from public, anon, authenticated;
revoke all on function crm.create_scope_version_current(uuid, jsonb, text, text, text, uuid) from public, anon, authenticated;
grant execute on function crm.accept_scope_version(uuid) to service_role;
grant execute on function crm.create_scope_version_current(uuid, jsonb, text, text, text, uuid) to service_role;
revoke all on function crm.create_initial_scope_from_brief(uuid, uuid, uuid, uuid, text, jsonb, text, text, uuid) from public, anon, authenticated;
revoke all on function crm.propose_scope_version(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function crm.create_initial_scope_from_brief(uuid, uuid, uuid, uuid, text, jsonb, text, text, uuid) to service_role;
grant execute on function crm.propose_scope_version(uuid, jsonb, text) to service_role;
revoke all on function crm.scope_versions_check_base() from public, anon, authenticated;
revoke all on function crm.scope_sections_valid(jsonb) from public, anon, authenticated;
grant execute on function crm.scope_sections_valid(jsonb) to service_role;

-- Riley's access model (R46): SELECT only on the tables; writes go through the definer functions
-- create_initial_scope_from_brief / propose_scope_version. NO execute on accept/create-current.
-- Kept in an invoker helper so a test can exercise it without the role existing at migration time.
create or replace function crm._apply_riley_scope_grants()
returns void
language plpgsql
as $$
begin
  grant usage on schema crm to riley_app;
  revoke all on crm.scope_documents, crm.scope_versions from riley_app;
  grant select on crm.scope_documents, crm.scope_versions to riley_app;
  drop policy if exists riley_read_scope_documents on crm.scope_documents;
  create policy riley_read_scope_documents on crm.scope_documents for select to riley_app using (true);
  drop policy if exists riley_read_scope_versions on crm.scope_versions;
  create policy riley_read_scope_versions on crm.scope_versions for select to riley_app using (true);
  revoke execute on function crm.accept_scope_version(uuid) from riley_app;
  revoke execute on function crm.create_scope_version_current(uuid, jsonb, text, text, text, uuid) from riley_app;
  grant execute on function crm.create_initial_scope_from_brief(uuid, uuid, uuid, uuid, text, jsonb, text, text, uuid) to riley_app;
  grant execute on function crm.propose_scope_version(uuid, jsonb, text) to riley_app;
end;
$$;
revoke all on function crm._apply_riley_scope_grants() from public, anon, authenticated;

-- riley_app is created by Task 10; grant only if it already exists (re-run this file afterwards otherwise)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'riley_app') then
    perform crm._apply_riley_scope_grants();
  end if;
end $$;

commit;
