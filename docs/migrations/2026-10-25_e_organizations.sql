-- CRM refresh, stream O: organizations (businesses and clients in one place).
--   1. crm.businesses.relationship: a nullable manual override of the relationship status.
--   2. crm.org_status: each organization's relationship status (prospect, client, past_client, partner),
--      derived from crm.clients + crm.client_services unless the override is set.
--   3. crm.org_timeline(): one keyset-paginated history for an organization.
-- Idempotent and additive. Requires 2026-10-22_crm_timeline.sql and 2026-10-25_a_crm_soft_delete.sql
-- (the deleted_at columns). Mirrors src/lib/crm/org-status.ts; keep the two in step.

begin;

-- 1. Override. NULL means "derive it". 'partner' can't be derived from any table, so it is only ever set
-- here; the other values let Brian correct a derived status by hand.
alter table crm.businesses add column if not exists relationship text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'businesses_relationship_check' and conrelid = 'crm.businesses'::regclass) then
    alter table crm.businesses add constraint businesses_relationship_check
      check (relationship is null or relationship in ('prospect', 'client', 'past_client', 'partner'));
  end if;
end $$;

-- 2. Status. A client record is "live" when billing is active or paused, a service is pending activation,
-- active or paused, or it has no services yet and its contract hasn't ended (a client still in setup:
-- billing_status defaults to 'cancelled' until a service activates). An organization with live client
-- records is a client; one whose client records are all over is a past client; otherwise a prospect.
create or replace view crm.org_status with (security_invoker = true) as
with client_state as (
  select c.business_id,
         bool_or(
           c.billing_status in ('active', 'paused')
           or exists (select 1 from crm.client_services s
                       where s.client_id = c.id and s.status in ('pending_activation', 'active', 'paused'))
           or (not exists (select 1 from crm.client_services s where s.client_id = c.id)
               and (c.contract_end is null or c.contract_end >= (now() at time zone 'America/New_York')::date))
         ) as live,
         count(*) as client_count
    from crm.clients c
   where c.deleted_at is null and c.business_id is not null
   group by c.business_id
)
select b.id as business_id,
       coalesce(b.relationship, d.derived) as status,
       d.derived as derived_status,
       b.relationship as relationship_override,
       coalesce(cs.client_count, 0)::int as client_count
  from crm.businesses b
  left join client_state cs on cs.business_id = b.id
  cross join lateral (
    select case when cs.live then 'client' when cs.live is not null then 'past_client' else 'prospect' end as derived
  ) d
 where b.deleted_at is null;

revoke all on crm.org_status from public, anon, authenticated;
grant select on crm.org_status to service_role;

-- 3. Organization timeline: the same items as crm.contact_timeline for every contact at the business,
-- plus lead activities for its deals, client records and rooms, room events and scope versions.
--   activity item: kind='activity',   id = activity id
--   email item:    kind='email',      id = email_messages.id (folded with its email_* activity, as in contact_timeline)
--   room event:    kind='room_event', id = md5('room_event:' || event id)::uuid (events have bigint ids)
--   scope version: kind='scope',      id = scope_versions.id, ts = decided_at, else created_at
-- Newest first, keyset-paginated on (ts, id). Email payloads carry a 500-char preview only.
create or replace function crm.org_timeline(
  p_business_id uuid, p_before_ts timestamptz default null, p_before_id uuid default null, p_limit int default 50)
returns table(kind text, id uuid, ts timestamptz, activity_id uuid, email_message_id uuid, payload jsonb)
language sql
stable
security definer
set search_path = crm, public, pg_temp
as $fn$
  with org_contacts as (
    select c.id, c.first_name, c.last_name from crm.contacts c
     where c.business_id = p_business_id and c.deleted_at is null
  ),
  org_leads as (
    select l.id from crm.leads l where l.business_id = p_business_id and l.deleted_at is null
  ),
  org_clients as (
    select c.id from crm.clients c where c.business_id = p_business_id and c.deleted_at is null
  ),
  org_rooms as (
    select e.id, e.title from rooms.engagements e where e.business_id = p_business_id and e.deleted_at is null
  ),
  linked as (
    select distinct on (m.id) m.*, k.contact_id as link_contact_id from crm.email_messages m
      join crm.email_message_links k on k.email_message_id = m.id
     where k.contact_id in (select oc.id from org_contacts oc)
     order by m.id, k.contact_id
  ),
  org_acts as (
    select a.* from crm.lead_activities a
     where a.contact_id in (select oc.id from org_contacts oc)
        or a.lead_id in (select ol.id from org_leads ol)
        or a.client_id in (select ocl.id from org_clients ocl)
        or a.engagement_id in (select r.id from org_rooms r)
  ),
  items as (
    select 'activity'::text as kind, a.id as id, a.created_at as ts, a.id as activity_id, null::uuid as email_message_id,
           jsonb_build_object('activity_type', a.activity_type, 'content', a.content, 'email_direction', a.email_direction,
                              'email_subject', a.email_subject, 'logged_by', a.logged_by, 'lead_id', a.lead_id,
                              'contact_id', a.contact_id, 'metadata', a.metadata) as payload
      from org_acts a
     where not (a.activity_type in ('email_received', 'email_sent')
                and coalesce(a.metadata->>'email_message_id' in (select lk.id::text from linked lk), false))
    union all
    select 'email'::text, m.id, coalesce(m.sent_at, m.created_at), act.id, m.id,
           jsonb_build_object('gmail_message_id', m.gmail_message_id, 'thread_id', m.thread_id, 'direction', m.direction,
                              'from_email', m.from_email, 'from_name', m.from_name, 'to_emails', to_jsonb(m.to_emails),
                              'cc_emails', to_jsonb(m.cc_emails), 'subject', m.subject, 'snippet', m.snippet,
                              'preview', left(m.body_text, 500), 'body_truncated', coalesce(length(m.body_text) > 500, false),
                              'logged_by', act.logged_by, 'contact_id', m.link_contact_id,
                              'metadata', coalesce(act.metadata, jsonb_build_object('email_message_id', m.id, 'gmail_message_id', m.gmail_message_id)))
      from linked m
      left join lateral (
        select a.id, a.logged_by, a.metadata from org_acts a
         where a.activity_type in ('email_received', 'email_sent') and a.metadata->>'email_message_id' = m.id::text
         order by a.created_at, a.id limit 1
      ) act on true
    union all
    select 'room_event'::text, md5('room_event:' || ev.id::text)::uuid, ev.created_at, null::uuid, null::uuid,
           jsonb_build_object('event_type', ev.type, 'engagement_id', ev.engagement_id, 'room_title', r.title,
                              'version_id', ev.version_id, 'contact_id', ev.contact_id,
                              'contact_name', ec.name, 'meta', ev.meta)
      from rooms.engagement_events ev
      join org_rooms r on r.id = ev.engagement_id
      left join rooms.engagement_contacts ec on ec.id = ev.contact_id
    union all
    select 'scope'::text, v.id, coalesce(v.decided_at, v.created_at), null::uuid, null::uuid,
           jsonb_build_object('scope_document_id', d.id, 'title', d.title, 'version_no', v.version_no, 'status', v.status,
                              'source', v.source, 'created_by', v.created_by, 'change_note', v.change_note,
                              'decided_at', v.decided_at, 'lead_id', d.lead_id)
      from crm.scope_versions v
      join crm.scope_documents d on d.id = v.scope_document_id
     where d.deleted_at is null
       and (d.business_id = p_business_id
            or d.lead_id in (select ol.id from org_leads ol)
            or d.client_id in (select ocl.id from org_clients ocl))
  )
  select i.kind, i.id, i.ts, i.activity_id, i.email_message_id, i.payload
    from items i
   where p_before_ts is null
      or (i.ts, i.id) < (p_before_ts, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
   order by i.ts desc, i.id desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
$fn$;

revoke all on function crm.org_timeline(uuid, timestamptz, uuid, int) from public, anon, authenticated;
grant execute on function crm.org_timeline(uuid, timestamptz, uuid, int) to service_role;

commit;

notify pgrst, 'reload schema';
