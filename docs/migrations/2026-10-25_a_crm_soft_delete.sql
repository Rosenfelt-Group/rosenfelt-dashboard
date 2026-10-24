-- 2026-10-25: soft delete and a 30-day Trash for CRM records (CRM refresh, Recommendation 12).
--
-- Organizations, people and clients could not be deleted at all: leads, clients and rooms RESTRICT
-- the business, and research and scope documents reference it with NO ACTION. Instead of hard
-- deletes, every CRM record kind gets deleted_at / deleted_by:
--   crm.businesses, crm.contacts, crm.leads, crm.clients, crm.discovery_invites, crm.scope_documents,
--   crm.business_research, rooms.engagements, public.research_briefs.
--
-- crm.soft_delete(kind, id, by) stamps the record and its children with ONE deleted_at
-- (clock_timestamp(), so two deletes never share a stamp). crm.restore_deleted(kind, id) brings back
-- exactly the rows that carry that stamp under the record. Children deleted on their own earlier keep
-- their own stamp and stay in Trash.
--   business -> contacts, leads, clients, discovery invites (its own and its leads'), scope documents,
--               engagements, business research
--   lead     -> its discovery invites
--   anything else -> just the row
-- A business or client with a live Stripe subscription on a client service cannot be deleted
-- (SQLSTATE TR001), so a deletion never leaves a subscription billing.
--
-- crm.purge_trash(older_than) hard-deletes Trash older than the cutoff in FK-safe order (the
-- dashboard's daily cron calls it; pg_cron is not installed on this project, see the end).
-- crm.purge_deleted(kind, id) does the same for one item now.
--
-- SQLSTATEs (mapped in src/lib/crm/trash.ts):
--   TR001 live Stripe subscription      TR002 not found          TR003 wrong state (already / not in Trash)
--   TR004 unknown kind                  TR005 parent is in Trash TR006 purge blocked by live child rows
--
-- Readers: crm.contact_timeline skips deleted leads, rooms._portal_access_ok refuses a deleted room
-- (clients lose access at once), and riley_app's policies hide deleted rows. Idempotent and additive.
begin;

-- ---------- columns and indexes ----------

alter table crm.businesses        add column if not exists deleted_at timestamptz, add column if not exists deleted_by text;
alter table crm.contacts          add column if not exists deleted_at timestamptz, add column if not exists deleted_by text;
alter table crm.leads             add column if not exists deleted_at timestamptz, add column if not exists deleted_by text;
alter table crm.clients           add column if not exists deleted_at timestamptz, add column if not exists deleted_by text;
alter table crm.discovery_invites add column if not exists deleted_at timestamptz, add column if not exists deleted_by text;
alter table crm.scope_documents   add column if not exists deleted_at timestamptz, add column if not exists deleted_by text;
alter table crm.business_research add column if not exists deleted_at timestamptz, add column if not exists deleted_by text;
alter table rooms.engagements     add column if not exists deleted_at timestamptz, add column if not exists deleted_by text;
alter table public.research_briefs add column if not exists deleted_at timestamptz, add column if not exists deleted_by text;

-- Trash and purge scan only deleted rows; lists filter `deleted_at is null` (nearly every row), so
-- the useful index is the small partial one over deleted rows.
create index if not exists businesses_deleted_at_idx        on crm.businesses (deleted_at)        where deleted_at is not null;
create index if not exists contacts_deleted_at_idx          on crm.contacts (deleted_at)          where deleted_at is not null;
create index if not exists leads_deleted_at_idx             on crm.leads (deleted_at)             where deleted_at is not null;
create index if not exists clients_deleted_at_idx           on crm.clients (deleted_at)           where deleted_at is not null;
create index if not exists discovery_invites_deleted_at_idx on crm.discovery_invites (deleted_at) where deleted_at is not null;
create index if not exists scope_documents_deleted_at_idx   on crm.scope_documents (deleted_at)   where deleted_at is not null;
create index if not exists business_research_deleted_at_idx on crm.business_research (deleted_at) where deleted_at is not null;
create index if not exists engagements_deleted_at_idx       on rooms.engagements (deleted_at)     where deleted_at is not null;
create index if not exists research_briefs_deleted_at_idx   on public.research_briefs (deleted_at) where deleted_at is not null;
-- Child lookups by business during cascade, restore and purge.
create index if not exists contacts_business_idx          on crm.contacts (business_id) where business_id is not null;
create index if not exists business_research_business_idx on crm.business_research (business_id);
create index if not exists discovery_invites_business_idx on crm.discovery_invites (business_id) where business_id is not null;

-- ---------- helpers ----------

create or replace function crm._trash_kinds()
 returns text[]
 language sql
 immutable
as $$ select array['business','contact','lead','client','discovery_invite','scope_document','engagement','business_research','research_brief'] $$;

create or replace function crm._trash_check_kind(p_kind text)
 returns void
 language plpgsql
 immutable
as $$
begin
  if p_kind is null or not (p_kind = any (crm._trash_kinds())) then
    raise exception 'unknown kind %', coalesce(p_kind, '(null)') using errcode = 'TR004';
  end if;
end $$;

-- deleted_at of one record (null = live); raises TR002 when it does not exist.
create or replace function crm._trash_state(p_kind text, p_id uuid, p_lock boolean default false)
 returns timestamptz
 language plpgsql
 security definer
 set search_path = crm, public, pg_temp
as $$
declare v timestamptz; v_rows int;
begin
  perform crm._trash_check_kind(p_kind);
  execute format('select deleted_at from %s where id = $1 %s',
    case p_kind
      when 'business' then 'crm.businesses' when 'contact' then 'crm.contacts' when 'lead' then 'crm.leads'
      when 'client' then 'crm.clients' when 'discovery_invite' then 'crm.discovery_invites'
      when 'scope_document' then 'crm.scope_documents' when 'engagement' then 'rooms.engagements'
      when 'business_research' then 'crm.business_research' when 'research_brief' then 'public.research_briefs' end,
    case when p_lock then 'for update' else '' end)
    into v using p_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception '% % not found', p_kind, p_id using errcode = 'TR002'; end if;
  return v;
end $$;

-- Client services whose Stripe subscription is still live (anything but cancelled / canceled).
-- 'active' alone is not enough: a paused or pending service can still carry a live subscription.
create or replace function crm._live_stripe_services(p_business_id uuid, p_client_id uuid)
 returns jsonb
 language sql
 stable
 security definer
 set search_path = crm, public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'client_id', s.client_id, 'service', t.name, 'status', s.status,
           'stripe_subscription_id', s.stripe_subscription_id, 'stripe_subscription_status', s.stripe_subscription_status)
           order by s.created_at), '[]'::jsonb)
    from crm.client_services s
    join crm.clients c on c.id = s.client_id
    left join crm.service_templates t on t.id = s.service_template_id
   where (c.id = p_client_id or (p_business_id is not null and c.business_id = p_business_id))
     and s.stripe_subscription_id is not null
     and s.status <> 'cancelled'
     and coalesce(s.stripe_subscription_status, '') not in ('canceled', 'incomplete_expired');
$$;

create or replace function crm._trash_name(p_kind text, p_id uuid)
 returns text
 language sql
 stable
 security definer
 set search_path = crm, public, pg_temp
as $$
  select case p_kind
    when 'business' then (select b.name from crm.businesses b where b.id = p_id)
    when 'contact' then (select coalesce(nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), c.email, 'Person') from crm.contacts c where c.id = p_id)
    when 'lead' then (select coalesce(b.name, 'Deal') || ' (' || l.stage || ')' from crm.leads l left join crm.businesses b on b.id = l.business_id where l.id = p_id)
    when 'client' then (select coalesce(b.name, 'Client') from crm.clients k left join crm.businesses b on b.id = k.business_id where k.id = p_id)
    when 'discovery_invite' then (select i.project_title from crm.discovery_invites i where i.id = p_id)
    when 'scope_document' then (select d.title from crm.scope_documents d where d.id = p_id)
    when 'engagement' then (select e.title from rooms.engagements e where e.id = p_id)
    when 'business_research' then (select coalesce(nullif(left(btrim(r.summary), 80), ''), 'Research note') from crm.business_research r where r.id = p_id)
    when 'research_brief' then (select rb.topic from public.research_briefs rb where rb.id = p_id)
  end;
$$;

-- The business a record belongs to (for Trash context and restore checks).
create or replace function crm._trash_business_id(p_kind text, p_id uuid)
 returns uuid
 language sql
 stable
 security definer
 set search_path = crm, public, pg_temp
as $$
  select case p_kind
    when 'business' then p_id
    when 'contact' then (select business_id from crm.contacts where id = p_id)
    when 'lead' then (select business_id from crm.leads where id = p_id)
    when 'client' then (select business_id from crm.clients where id = p_id)
    when 'discovery_invite' then (select coalesce(i.business_id, l.business_id) from crm.discovery_invites i left join crm.leads l on l.id = i.lead_id where i.id = p_id)
    when 'scope_document' then (select business_id from crm.scope_documents where id = p_id)
    when 'engagement' then (select business_id from rooms.engagements where id = p_id)
    when 'business_research' then (select business_id from crm.business_research where id = p_id)
  end;
$$;

-- ---------- soft delete ----------

create or replace function crm.soft_delete(p_kind text, p_id uuid, p_by text)
 returns jsonb
 language plpgsql
 security definer
 set search_path = crm, public, pg_temp
as $$
declare
  v_ts timestamptz := clock_timestamp();
  v_by text := nullif(btrim(p_by), '');
  v_state timestamptz;
  v_live jsonb;
  v_counts jsonb := '{}'::jsonb;
  n int;
begin
  v_state := crm._trash_state(p_kind, p_id, true);
  if v_state is not null then raise exception '% % is already in Trash', p_kind, p_id using errcode = 'TR003'; end if;

  if p_kind in ('business', 'client') then
    v_live := crm._live_stripe_services(case when p_kind = 'business' then p_id end, case when p_kind = 'client' then p_id end);
    if jsonb_array_length(v_live) > 0 then
      raise exception 'it has % client service(s) billing through Stripe; cancel them first', jsonb_array_length(v_live)
        using errcode = 'TR001', detail = v_live::text;
    end if;
  end if;

  if p_kind = 'business' then
    update crm.leads set deleted_at = v_ts, deleted_by = v_by where business_id = p_id and deleted_at is null;
    get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('leads', n);
    update crm.discovery_invites set deleted_at = v_ts, deleted_by = v_by
     where deleted_at is null
       and (business_id = p_id or lead_id in (select id from crm.leads where business_id = p_id));
    get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('discovery_invites', n);
    update crm.contacts set deleted_at = v_ts, deleted_by = v_by where business_id = p_id and deleted_at is null;
    get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('contacts', n);
    update crm.clients set deleted_at = v_ts, deleted_by = v_by where business_id = p_id and deleted_at is null;
    get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('clients', n);
    update crm.scope_documents set deleted_at = v_ts, deleted_by = v_by where business_id = p_id and deleted_at is null;
    get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('scope_documents', n);
    update rooms.engagements set deleted_at = v_ts, deleted_by = v_by where business_id = p_id and deleted_at is null;
    get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('engagements', n);
    update crm.business_research set deleted_at = v_ts, deleted_by = v_by where business_id = p_id and deleted_at is null;
    get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('business_research', n);
    update crm.businesses set deleted_at = v_ts, deleted_by = v_by where id = p_id;
  elsif p_kind = 'lead' then
    update crm.discovery_invites set deleted_at = v_ts, deleted_by = v_by where lead_id = p_id and deleted_at is null;
    get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('discovery_invites', n);
    update crm.leads set deleted_at = v_ts, deleted_by = v_by where id = p_id;
  elsif p_kind = 'contact' then
    update crm.contacts set deleted_at = v_ts, deleted_by = v_by where id = p_id;
  elsif p_kind = 'client' then
    update crm.clients set deleted_at = v_ts, deleted_by = v_by where id = p_id;
  elsif p_kind = 'discovery_invite' then
    update crm.discovery_invites set deleted_at = v_ts, deleted_by = v_by where id = p_id;
  elsif p_kind = 'scope_document' then
    update crm.scope_documents set deleted_at = v_ts, deleted_by = v_by where id = p_id;
  elsif p_kind = 'engagement' then
    update rooms.engagements set deleted_at = v_ts, deleted_by = v_by where id = p_id;
  elsif p_kind = 'business_research' then
    update crm.business_research set deleted_at = v_ts, deleted_by = v_by where id = p_id;
  elsif p_kind = 'research_brief' then
    update public.research_briefs set deleted_at = v_ts, deleted_by = v_by where id = p_id;
  end if;

  return jsonb_build_object('kind', p_kind, 'id', p_id, 'name', crm._trash_name(p_kind, p_id),
                            'deleted_at', v_ts, 'deleted_by', v_by, 'cascaded', v_counts);
end $$;

-- ---------- preview (confirm dialog) ----------

-- goes: live rows that go to Trash with the record (or are removed with it, e.g. a contact's email
--       links are hidden with the contact). stays: rows that are linked but remain.
-- blocked: null, or {reason:'stripe_services', services:[...]} when soft_delete would raise TR001.
create or replace function crm.delete_preview(p_kind text, p_id uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path = crm, public, pg_temp
as $$
declare
  v_state timestamptz;
  v_live jsonb := '[]'::jsonb;
  v_goes jsonb := '{}'::jsonb;
  v_stays jsonb := '{}'::jsonb;
begin
  v_state := crm._trash_state(p_kind, p_id);

  if p_kind in ('business', 'client') then
    v_live := crm._live_stripe_services(case when p_kind = 'business' then p_id end, case when p_kind = 'client' then p_id end);
  end if;

  if p_kind = 'business' then
    v_goes := jsonb_build_object(
      'contacts', (select count(*) from crm.contacts where business_id = p_id and deleted_at is null),
      'leads', (select count(*) from crm.leads where business_id = p_id and deleted_at is null),
      'clients', (select count(*) from crm.clients where business_id = p_id and deleted_at is null),
      'discovery_invites', (select count(*) from crm.discovery_invites where deleted_at is null
                              and (business_id = p_id or lead_id in (select id from crm.leads where business_id = p_id))),
      'scope_documents', (select count(*) from crm.scope_documents where business_id = p_id and deleted_at is null),
      'engagements', (select count(*) from rooms.engagements where business_id = p_id and deleted_at is null),
      'business_research', (select count(*) from crm.business_research where business_id = p_id and deleted_at is null),
      'lead_activities', (select count(*) from crm.lead_activities a join crm.leads l on l.id = a.lead_id
                            where l.business_id = p_id and l.deleted_at is null),
      'client_services', (select count(*) from crm.client_services s join crm.clients k on k.id = s.client_id
                            where k.business_id = p_id and k.deleted_at is null));
  elsif p_kind = 'contact' then
    v_goes := jsonb_build_object(
      'email_links', (select count(*) from crm.email_message_links where contact_id = p_id),
      'engagement_contacts', (select count(*) from rooms.engagement_contacts where crm_contact_id = p_id));
    v_stays := jsonb_build_object(
      'leads', (select count(*) from crm.leads where contact_id = p_id and deleted_at is null),
      'clients', (select count(*) from crm.clients where contact_id = p_id and deleted_at is null),
      'discovery_invites', (select count(*) from crm.discovery_invites where contact_id = p_id and deleted_at is null));
  elsif p_kind = 'lead' then
    v_goes := jsonb_build_object(
      'discovery_invites', (select count(*) from crm.discovery_invites where lead_id = p_id and deleted_at is null),
      'lead_activities', (select count(*) from crm.lead_activities where lead_id = p_id));
    v_stays := jsonb_build_object(
      'scope_documents', (select count(*) from crm.scope_documents where lead_id = p_id and deleted_at is null),
      'engagements', (select count(*) from rooms.engagements where lead_id = p_id and deleted_at is null),
      'clients', (select count(*) from crm.clients where lead_id = p_id and deleted_at is null));
  elsif p_kind = 'client' then
    v_goes := jsonb_build_object(
      'client_services', (select count(*) from crm.client_services where client_id = p_id));
    v_stays := jsonb_build_object(
      'scope_documents', (select count(*) from crm.scope_documents where client_id = p_id and deleted_at is null),
      'engagements', (select count(*) from rooms.engagements where client_id = p_id and deleted_at is null));
  elsif p_kind = 'discovery_invite' then
    v_goes := jsonb_build_object(
      'discovery_responses', (select count(*) from crm.discovery_responses where invite_id = p_id),
      'discovery_briefs', (select count(*) from crm.discovery_briefs where invite_id = p_id));
    v_stays := jsonb_build_object(
      'engagements', (select count(*) from rooms.engagements where discovery_invite_id = p_id and deleted_at is null));
  elsif p_kind = 'scope_document' then
    v_goes := jsonb_build_object(
      'scope_versions', (select count(*) from crm.scope_versions where scope_document_id = p_id));
    v_stays := jsonb_build_object(
      'engagements', (select count(*) from rooms.engagements e join crm.scope_documents d on d.engagement_id = e.id
                        where d.id = p_id and e.deleted_at is null));
  elsif p_kind = 'engagement' then
    v_goes := jsonb_build_object(
      'deliverables', (select count(*) from rooms.deliverables where engagement_id = p_id),
      'access_links', (select count(*) from rooms.engagement_access where engagement_id = p_id
                         and revoked_at is null and expires_at > now()),
      'engagement_contacts', (select count(*) from rooms.engagement_contacts where engagement_id = p_id));
    v_stays := jsonb_build_object(
      'scope_documents', (select count(*) from crm.scope_documents where engagement_id = p_id and deleted_at is null));
  end if;

  return jsonb_build_object(
    'kind', p_kind, 'id', p_id, 'name', crm._trash_name(p_kind, p_id),
    'deleted_at', v_state,
    'blocked', case when jsonb_array_length(v_live) > 0
                    then jsonb_build_object('reason', 'stripe_services', 'services', v_live) end,
    'goes', v_goes, 'stays', v_stays);
end $$;

-- ---------- restore ----------

create or replace function crm.restore_deleted(p_kind text, p_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path = crm, public, pg_temp
as $$
declare
  v_ts timestamptz;
  v_biz uuid;
  v_lead uuid;
  v_counts jsonb := '{}'::jsonb;
  n int;
begin
  v_ts := crm._trash_state(p_kind, p_id, true);
  if v_ts is null then raise exception '% % is not in Trash', p_kind, p_id using errcode = 'TR003'; end if;

  -- A record cannot come back under a parent that is still in Trash; restore the parent instead.
  if p_kind <> 'business' and p_kind <> 'research_brief' then
    v_biz := crm._trash_business_id(p_kind, p_id);
    if v_biz is not null and exists (select 1 from crm.businesses where id = v_biz and deleted_at is not null) then
      raise exception 'its organization is in Trash; restore the organization first' using errcode = 'TR005';
    end if;
    if p_kind = 'discovery_invite' then
      select lead_id into v_lead from crm.discovery_invites where id = p_id;
      if exists (select 1 from crm.leads where id = v_lead and deleted_at is not null) then
        raise exception 'its deal is in Trash; restore the deal first' using errcode = 'TR005';
      end if;
    end if;
  end if;

  if p_kind = 'business' then
    -- invites first: they are found through the business's leads, whatever their own business_id
    update crm.discovery_invites set deleted_at = null, deleted_by = null
     where deleted_at = v_ts
       and (business_id = p_id or lead_id in (select id from crm.leads where business_id = p_id));
    get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('discovery_invites', n);
    update crm.leads set deleted_at = null, deleted_by = null where business_id = p_id and deleted_at = v_ts;
    get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('leads', n);
    update crm.contacts set deleted_at = null, deleted_by = null where business_id = p_id and deleted_at = v_ts;
    get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('contacts', n);
    update crm.clients set deleted_at = null, deleted_by = null where business_id = p_id and deleted_at = v_ts;
    get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('clients', n);
    update crm.scope_documents set deleted_at = null, deleted_by = null where business_id = p_id and deleted_at = v_ts;
    get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('scope_documents', n);
    update rooms.engagements set deleted_at = null, deleted_by = null where business_id = p_id and deleted_at = v_ts;
    get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('engagements', n);
    update crm.business_research set deleted_at = null, deleted_by = null where business_id = p_id and deleted_at = v_ts;
    get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('business_research', n);
    update crm.businesses set deleted_at = null, deleted_by = null where id = p_id;
  elsif p_kind = 'lead' then
    update crm.discovery_invites set deleted_at = null, deleted_by = null where lead_id = p_id and deleted_at = v_ts;
    get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('discovery_invites', n);
    update crm.leads set deleted_at = null, deleted_by = null where id = p_id;
  elsif p_kind = 'contact' then
    update crm.contacts set deleted_at = null, deleted_by = null where id = p_id;
  elsif p_kind = 'client' then
    update crm.clients set deleted_at = null, deleted_by = null where id = p_id;
  elsif p_kind = 'discovery_invite' then
    update crm.discovery_invites set deleted_at = null, deleted_by = null where id = p_id;
  elsif p_kind = 'scope_document' then
    update crm.scope_documents set deleted_at = null, deleted_by = null where id = p_id;
  elsif p_kind = 'engagement' then
    update rooms.engagements set deleted_at = null, deleted_by = null where id = p_id;
  elsif p_kind = 'business_research' then
    update crm.business_research set deleted_at = null, deleted_by = null where id = p_id;
  elsif p_kind = 'research_brief' then
    update public.research_briefs set deleted_at = null, deleted_by = null where id = p_id;
  end if;

  return jsonb_build_object('kind', p_kind, 'id', p_id, 'name', crm._trash_name(p_kind, p_id),
                            'restored', v_counts);
end $$;

-- ---------- hard delete (purge) ----------

-- Hard-deletes one record that is in Trash, with everything under it, children before parents.
-- Live rows under a deleted business or lead block the purge (TR006) rather than being deleted.
create or replace function crm._hard_delete(p_kind text, p_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path = crm, public, pg_temp
as $$
declare
  v_ts timestamptz;
  v_live jsonb;
begin
  v_ts := crm._trash_state(p_kind, p_id, true);
  if v_ts is null then raise exception '% % is not in Trash', p_kind, p_id using errcode = 'TR003'; end if;

  if p_kind in ('business', 'client') then
    v_live := crm._live_stripe_services(case when p_kind = 'business' then p_id end, case when p_kind = 'client' then p_id end);
    if jsonb_array_length(v_live) > 0 then
      raise exception 'it has client service(s) billing through Stripe' using errcode = 'TR001', detail = v_live::text;
    end if;
  end if;

  if p_kind = 'business' then
    if exists (select 1 from crm.leads where business_id = p_id and deleted_at is null)
       or exists (select 1 from crm.clients where business_id = p_id and deleted_at is null)
       or exists (select 1 from rooms.engagements where business_id = p_id and deleted_at is null)
       or exists (select 1 from crm.scope_documents where business_id = p_id and deleted_at is null)
       or exists (select 1 from crm.business_research where business_id = p_id and deleted_at is null)
       or exists (select 1 from crm.discovery_invites i join crm.leads l on l.id = i.lead_id
                   where l.business_id = p_id and i.deleted_at is null) then
      raise exception 'business % has live records under it', p_id using errcode = 'TR006';
    end if;
    -- tm_billing_entries -> client_services is NO ACTION; client_services cascade from clients.
    delete from crm.tm_billing_entries where client_service_id in
      (select s.id from crm.client_services s join crm.clients k on k.id = s.client_id where k.business_id = p_id);
    delete from crm.scope_documents where business_id = p_id;        -- versions cascade
    delete from rooms.engagements where business_id = p_id;          -- access, contacts, deliverables, events cascade
    delete from crm.business_research where business_id = p_id;
    delete from crm.clients where business_id = p_id;                -- client_services cascade
    delete from crm.leads where business_id = p_id;                  -- activities, invites cascade
    delete from crm.discovery_invites where business_id = p_id and deleted_at is not null;
    -- Contacts are SET NULL by the FK; only those deleted with the business go now. People deleted
    -- on their own keep their own Trash clock.
    delete from crm.contacts where business_id = p_id and deleted_at = v_ts;
    delete from crm.businesses where id = p_id;
  elsif p_kind = 'lead' then
    if exists (select 1 from crm.discovery_invites where lead_id = p_id and deleted_at is null) then
      raise exception 'lead % has live discovery invites', p_id using errcode = 'TR006';
    end if;
    delete from crm.leads where id = p_id;
  elsif p_kind = 'client' then
    delete from crm.tm_billing_entries where client_service_id in (select id from crm.client_services where client_id = p_id);
    delete from crm.clients where id = p_id;
  elsif p_kind = 'contact' then
    delete from crm.contacts where id = p_id;
  elsif p_kind = 'discovery_invite' then
    delete from crm.discovery_invites where id = p_id;
  elsif p_kind = 'scope_document' then
    delete from crm.scope_documents where id = p_id;
  elsif p_kind = 'engagement' then
    delete from rooms.engagements where id = p_id;
  elsif p_kind = 'business_research' then
    delete from crm.business_research where id = p_id;
  elsif p_kind = 'research_brief' then
    delete from public.research_briefs where id = p_id;
  end if;
end $$;

-- Purge one Trash item now ("Delete now"). Errors propagate (TR001/TR002/TR003/TR004/TR006).
create or replace function crm.purge_deleted(p_kind text, p_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path = crm, public, pg_temp
as $$
declare v_name text;
begin
  perform crm._trash_check_kind(p_kind);
  v_name := crm._trash_name(p_kind, p_id);
  perform crm._hard_delete(p_kind, p_id);
  return jsonb_build_object('kind', p_kind, 'id', p_id, 'name', v_name, 'purged', true);
end $$;

-- Nightly: hard-delete everything deleted before now() - p_older_than. Children kinds go first, so
-- a record deleted on its own is purged on its own clock; a business takes the rest of its group.
-- A failing item is skipped (savepoint per item) and reported, never blocking the rest.
create or replace function crm.purge_trash(p_older_than interval default '30 days')
 returns jsonb
 language plpgsql
 security definer
 set search_path = crm, public, pg_temp
as $$
declare
  v_cutoff timestamptz;
  r record;
  v_purged int := 0;
  v_skipped jsonb := '[]'::jsonb;
begin
  if p_older_than is null or p_older_than < interval '0' then
    raise exception 'older_than must be a non-negative interval' using errcode = '22023';
  end if;
  v_cutoff := now() - p_older_than;

  for r in
    select k.kind, k.id, k.ord from (
      select 'business_research'::text as kind, id, deleted_at, 1 as ord from crm.business_research where deleted_at < v_cutoff
      union all select 'scope_document', id, deleted_at, 2 from crm.scope_documents where deleted_at < v_cutoff
      union all select 'engagement', id, deleted_at, 3 from rooms.engagements where deleted_at < v_cutoff
      union all select 'discovery_invite', id, deleted_at, 4 from crm.discovery_invites where deleted_at < v_cutoff
      union all select 'client', id, deleted_at, 5 from crm.clients where deleted_at < v_cutoff
      union all select 'lead', id, deleted_at, 6 from crm.leads where deleted_at < v_cutoff
      union all select 'contact', id, deleted_at, 7 from crm.contacts where deleted_at < v_cutoff
      union all select 'business', id, deleted_at, 8 from crm.businesses where deleted_at < v_cutoff
      union all select 'research_brief', id, deleted_at, 9 from public.research_briefs where deleted_at < v_cutoff
    ) k order by k.ord, k.deleted_at
  loop
    begin
      perform crm._hard_delete(r.kind, r.id);
      v_purged := v_purged + 1;
    exception
      when sqlstate 'TR002' then null;  -- already gone with its parent earlier in this run
      when others then
        v_skipped := v_skipped || jsonb_build_object('kind', r.kind, 'id', r.id, 'code', sqlstate, 'error', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('cutoff', v_cutoff, 'purged', v_purged, 'skipped', v_skipped);
end $$;

-- ---------- Trash listing ----------

-- Top-level Trash items: deleted rows that were not deleted as part of a parent's group
-- (a parent with the same deleted_at). group_count = rows deleted with it (excluding itself).
create or replace function crm.trash_items(p_retention interval default '30 days')
 returns table(kind text, id uuid, name text, business_id uuid, business_name text, deleted_at timestamptz,
               deleted_by text, purge_at timestamptz, days_left int, group_count int)
 language sql
 stable
 security definer
 set search_path = crm, public, pg_temp
as $$
  with items as (
    select 'business'::text as kind, b.id, b.id as business_id, b.deleted_at, b.deleted_by from crm.businesses b
     where b.deleted_at is not null
    union all
    select 'contact', c.id, c.business_id, c.deleted_at, c.deleted_by from crm.contacts c
     where c.deleted_at is not null
       and not exists (select 1 from crm.businesses p where p.id = c.business_id and p.deleted_at = c.deleted_at)
    union all
    select 'lead', l.id, l.business_id, l.deleted_at, l.deleted_by from crm.leads l
     where l.deleted_at is not null
       and not exists (select 1 from crm.businesses p where p.id = l.business_id and p.deleted_at = l.deleted_at)
    union all
    select 'client', k.id, k.business_id, k.deleted_at, k.deleted_by from crm.clients k
     where k.deleted_at is not null
       and not exists (select 1 from crm.businesses p where p.id = k.business_id and p.deleted_at = k.deleted_at)
    union all
    select 'discovery_invite', i.id, coalesce(i.business_id, l.business_id), i.deleted_at, i.deleted_by
      from crm.discovery_invites i left join crm.leads l on l.id = i.lead_id
     where i.deleted_at is not null
       and l.deleted_at is distinct from i.deleted_at
       and not exists (select 1 from crm.businesses p where p.id = coalesce(i.business_id, l.business_id) and p.deleted_at = i.deleted_at)
    union all
    select 'scope_document', d.id, d.business_id, d.deleted_at, d.deleted_by from crm.scope_documents d
     where d.deleted_at is not null
       and not exists (select 1 from crm.businesses p where p.id = d.business_id and p.deleted_at = d.deleted_at)
    union all
    select 'engagement', e.id, e.business_id, e.deleted_at, e.deleted_by from rooms.engagements e
     where e.deleted_at is not null
       and not exists (select 1 from crm.businesses p where p.id = e.business_id and p.deleted_at = e.deleted_at)
    union all
    select 'business_research', r.id, r.business_id, r.deleted_at, r.deleted_by from crm.business_research r
     where r.deleted_at is not null
       and not exists (select 1 from crm.businesses p where p.id = r.business_id and p.deleted_at = r.deleted_at)
    union all
    select 'research_brief', rb.id, null::uuid, rb.deleted_at, rb.deleted_by from public.research_briefs rb
     where rb.deleted_at is not null
  )
  select i.kind, i.id, crm._trash_name(i.kind, i.id),
         case when i.kind = 'business' then null else i.business_id end,
         case when i.kind = 'business' then null else (select b.name from crm.businesses b where b.id = i.business_id) end,
         i.deleted_at, i.deleted_by,
         i.deleted_at + p_retention,
         least(ceil(extract(epoch from p_retention) / 86400),
               greatest(0, ceil(extract(epoch from (i.deleted_at + p_retention - now())) / 86400)))::int,
         case i.kind
           when 'business' then
             (select count(*) from crm.contacts x where x.business_id = i.id and x.deleted_at = i.deleted_at)
           + (select count(*) from crm.leads x where x.business_id = i.id and x.deleted_at = i.deleted_at)
           + (select count(*) from crm.clients x where x.business_id = i.id and x.deleted_at = i.deleted_at)
           + (select count(*) from crm.discovery_invites x where x.deleted_at = i.deleted_at
                and (x.business_id = i.id or x.lead_id in (select y.id from crm.leads y where y.business_id = i.id)))
           + (select count(*) from crm.scope_documents x where x.business_id = i.id and x.deleted_at = i.deleted_at)
           + (select count(*) from rooms.engagements x where x.business_id = i.id and x.deleted_at = i.deleted_at)
           + (select count(*) from crm.business_research x where x.business_id = i.id and x.deleted_at = i.deleted_at)
           when 'lead' then (select count(*) from crm.discovery_invites x where x.lead_id = i.id and x.deleted_at = i.deleted_at)
           else 0
         end::int
    from items i
   order by i.deleted_at desc, i.kind, i.id;
$$;

-- ---------- readers that must ignore deleted rows ----------

-- Timeline: activities of a deleted deal no longer show on the person's timeline.
create or replace function crm.contact_timeline(p_contact_id uuid, p_before_ts timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS TABLE(kind text, id uuid, ts timestamp with time zone, activity_id uuid, email_message_id uuid, payload jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'crm', 'public', 'pg_temp'
AS $function$
  with my_leads as (
    select l.id from crm.leads l where l.contact_id = p_contact_id and l.deleted_at is null
  ),
  linked as (
    select m.* from crm.email_messages m
      join crm.email_message_links k on k.email_message_id = m.id
     where k.contact_id = p_contact_id
  ),
  my_acts as (
    select a.* from crm.lead_activities a
     where (a.contact_id = p_contact_id or a.lead_id in (select ml.id from my_leads ml))
       and not exists (select 1 from crm.leads dl where dl.id = a.lead_id and dl.deleted_at is not null)
  ),
  items as (
    select 'activity'::text as kind, a.id as id, a.created_at as ts, a.id as activity_id, null::uuid as email_message_id,
           jsonb_build_object('activity_type', a.activity_type, 'content', a.content, 'email_direction', a.email_direction,
                              'email_subject', a.email_subject, 'logged_by', a.logged_by, 'lead_id', a.lead_id,
                              'metadata', a.metadata) as payload
      from my_acts a
     where not (a.activity_type in ('email_received', 'email_sent')
                and coalesce(a.metadata->>'email_message_id' in (select lk.id::text from linked lk), false))
    union all
    select 'email'::text, m.id, coalesce(m.sent_at, m.created_at), act.id, m.id,
           jsonb_build_object('gmail_message_id', m.gmail_message_id, 'thread_id', m.thread_id, 'direction', m.direction,
                              'from_email', m.from_email, 'from_name', m.from_name, 'to_emails', to_jsonb(m.to_emails),
                              'cc_emails', to_jsonb(m.cc_emails), 'subject', m.subject, 'snippet', m.snippet,
                              'preview', left(m.body_text, 500), 'body_truncated', coalesce(length(m.body_text) > 500, false),
                              'logged_by', act.logged_by,
                              'metadata', coalesce(act.metadata, jsonb_build_object('email_message_id', m.id, 'gmail_message_id', m.gmail_message_id)))
      from linked m
      left join lateral (
        select a.id, a.logged_by, a.metadata from my_acts a
         where a.activity_type in ('email_received', 'email_sent') and a.metadata->>'email_message_id' = m.id::text
         order by a.created_at, a.id limit 1
      ) act on true
  )
  select i.kind, i.id, i.ts, i.activity_id, i.email_message_id, i.payload
    from items i
   where p_before_ts is null
      or (i.ts, i.id) < (p_before_ts, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
   order by i.ts desc, i.id desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
$function$;

-- Rooms portal: every portal function checks access through this; a room in Trash is closed.
create or replace function rooms._portal_access_ok(p_access uuid, p_eng uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'rooms', 'pg_temp'
as $function$
  select exists (
    select 1
    from rooms.engagement_access a
    join rooms.engagements e on e.id = a.engagement_id
    where a.id = p_access and a.engagement_id = p_eng
      and a.revoked_at is null and a.expires_at > now()
      and e.status <> 'closed'
      and e.deleted_at is null);
$function$;

-- Riley reads CRM rows as riley_app; deleted rows are invisible to it. Conditional, because the
-- policies only exist where riley_app does (research_briefs' comes from stream R's migration).
do $$
declare r record;
begin
  for r in
    select * from (values
      ('crm', 'businesses', 'riley_read_businesses'), ('crm', 'contacts', 'riley_read_contacts'),
      ('crm', 'leads', 'riley_read_leads'), ('crm', 'clients', 'riley_read_clients'),
      ('crm', 'discovery_invites', 'riley_read_discovery_invites'), ('crm', 'scope_documents', 'riley_read_scope_documents'),
      ('crm', 'business_research', 'riley_read_business_research'), ('public', 'research_briefs', 'riley_read_research_briefs')
    ) v(sch, tbl, pol)
  loop
    if exists (select 1 from pg_policies p where p.schemaname = r.sch and p.tablename = r.tbl and p.policyname = r.pol) then
      execute format('alter policy %I on %I.%I using (deleted_at is null)', r.pol, r.sch, r.tbl);
    end if;
  end loop;
  if exists (select 1 from pg_policies where schemaname = 'crm' and tablename = 'discovery_invites' and policyname = 'riley_update_discovery_invites') then
    alter policy riley_update_discovery_invites on crm.discovery_invites
      using (status = 'draft' and deleted_at is null) with check (status = 'draft' and deleted_at is null);
  end if;
end $$;

-- Same definition as 2026-10-22_crm_scope_documents.sql, except the scope_documents policy hides
-- deleted rows, so re-running it does not undo the policy above.
create or replace function crm._apply_riley_scope_grants()
 returns void
 language plpgsql
as $function$
begin
  grant usage on schema crm to riley_app;
  revoke all on crm.scope_documents, crm.scope_versions from riley_app;
  grant select on crm.scope_documents, crm.scope_versions to riley_app;
  drop policy if exists riley_read_scope_documents on crm.scope_documents;
  create policy riley_read_scope_documents on crm.scope_documents for select to riley_app using (deleted_at is null);
  drop policy if exists riley_read_scope_versions on crm.scope_versions;
  create policy riley_read_scope_versions on crm.scope_versions for select to riley_app using (true);
  revoke execute on function crm.accept_scope_version(uuid) from riley_app;
  revoke execute on function crm.create_scope_version_current(uuid, jsonb, text, text, text, uuid) from riley_app;
  grant execute on function crm.create_initial_scope_from_brief(uuid, uuid, uuid, uuid, text, jsonb, text, text, uuid) to riley_app;
  grant execute on function crm.propose_scope_version(uuid, jsonb, text) to riley_app;
end;
$function$;

-- ---------- grants ----------

revoke all on function crm._trash_kinds() from public, anon, authenticated;
revoke all on function crm._trash_check_kind(text) from public, anon, authenticated;
revoke all on function crm._trash_state(text, uuid, boolean) from public, anon, authenticated;
revoke all on function crm._live_stripe_services(uuid, uuid) from public, anon, authenticated;
revoke all on function crm._trash_name(text, uuid) from public, anon, authenticated;
revoke all on function crm._trash_business_id(text, uuid) from public, anon, authenticated;
revoke all on function crm._hard_delete(text, uuid) from public, anon, authenticated;
revoke all on function crm.soft_delete(text, uuid, text) from public, anon, authenticated;
revoke all on function crm.delete_preview(text, uuid) from public, anon, authenticated;
revoke all on function crm.restore_deleted(text, uuid) from public, anon, authenticated;
revoke all on function crm.purge_deleted(text, uuid) from public, anon, authenticated;
revoke all on function crm.purge_trash(interval) from public, anon, authenticated;
revoke all on function crm.trash_items(interval) from public, anon, authenticated;
revoke all on function crm.contact_timeline(uuid, timestamptz, uuid, int) from public, anon, authenticated;
revoke all on function rooms._portal_access_ok(uuid, uuid) from public, anon, authenticated;
revoke all on function crm._apply_riley_scope_grants() from public, anon, authenticated;
grant execute on function crm.soft_delete(text, uuid, text) to service_role;
grant execute on function crm.delete_preview(text, uuid) to service_role;
grant execute on function crm.restore_deleted(text, uuid) to service_role;
grant execute on function crm.purge_deleted(text, uuid) to service_role;
grant execute on function crm.purge_trash(interval) to service_role;
grant execute on function crm.trash_items(interval) to service_role;
grant execute on function crm.contact_timeline(uuid, timestamptz, uuid, int) to service_role;

-- ---------- schedule ----------

-- pg_cron is not installed on this project (checked 2026-10-25), so the dashboard's daily Vercel cron
-- (/api/cron/gmail-watch, job "purge-trash") calls crm.purge_trash(). If pg_cron is ever enabled,
-- this block schedules it in the database as well (purging twice is harmless).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('crm-purge-trash', '30 7 * * *', $c$select crm.purge_trash('30 days')$c$);
  end if;
end $$;

commit;
