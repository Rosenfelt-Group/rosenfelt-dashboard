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
          or jsonb_typeof(e -> 'key') <> 'string'
          or jsonb_typeof(e -> 'title') <> 'string'
          or jsonb_typeof(e -> 'body_md') <> 'string'
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
    raise exception 'scope version not found: %', p_version_id;
  end if;

  -- serialize on the document row, then re-read the version under the lock
  select * into d from crm.scope_documents where id = v_doc for update;
  select * into v from crm.scope_versions where id = p_version_id;

  if v.status <> 'proposed' then
    raise exception 'not proposed: version % has status %', p_version_id, v.status;
  end if;
  -- stale unless based on the current version; NULL base is allowed only for the first version
  if v.based_on_version_id is distinct from d.current_version_id then
    raise exception 'stale proposal: version % is based on %, document current is %',
      p_version_id, v.based_on_version_id, d.current_version_id;
  end if;

  if d.current_version_id is not null then
    update crm.scope_versions set status = 'superseded' where id = d.current_version_id;
  end if;
  update crm.scope_versions set status = 'current', decided_at = now() where id = p_version_id;
  update crm.scope_documents set current_version_id = p_version_id where id = v_doc;
end;
$$;

-- Insert a new current version (Brian's edits, or version 1 from the brief), superseding the previous one.
create or replace function crm.create_scope_version_current(
  p_doc_id uuid, p_sections jsonb, p_source text, p_created_by text, p_change_note text
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
    raise exception 'scope document not found: %', p_doc_id;
  end if;

  select coalesce(max(version_no), 0) + 1 into v_no from crm.scope_versions where scope_document_id = p_doc_id;

  if d.current_version_id is not null then
    update crm.scope_versions set status = 'superseded' where id = d.current_version_id;
  end if;

  insert into crm.scope_versions
    (scope_document_id, version_no, sections, status, source, change_note, based_on_version_id, created_by, decided_at)
  values
    (p_doc_id, v_no, p_sections, 'current', p_source, p_change_note, d.current_version_id, p_created_by, now())
  returning id into v_id;

  update crm.scope_documents set current_version_id = v_id where id = p_doc_id;
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
revoke all on function crm.create_scope_version_current(uuid, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function crm.accept_scope_version(uuid) to service_role;
grant execute on function crm.create_scope_version_current(uuid, jsonb, text, text, text) to service_role;
revoke all on function crm.scope_sections_valid(jsonb) from public, anon, authenticated;
grant execute on function crm.scope_sections_valid(jsonb) to service_role;

-- Riley's grants live in a helper so a test can exercise them without needing the role at migration
-- time. NO execute on accept/create-current: only Brian (dashboard / service_role) accepts.
create or replace function crm._apply_riley_scope_grants()
returns void
language plpgsql
as $$
begin
  grant usage on schema crm to riley_app;
  grant select, insert, update on crm.scope_documents, crm.scope_versions to riley_app;
  revoke execute on function crm.accept_scope_version(uuid) from riley_app;
  revoke execute on function crm.create_scope_version_current(uuid, jsonb, text, text, text) from riley_app;
end;
$$;
revoke all on function crm._apply_riley_scope_grants() from public, anon, authenticated;
grant execute on function crm._apply_riley_scope_grants() to service_role;

-- riley_app is created by Task 10; grant only if it already exists (re-run this file afterwards otherwise)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'riley_app') then
    perform crm._apply_riley_scope_grants();
  end if;
end $$;

commit;
