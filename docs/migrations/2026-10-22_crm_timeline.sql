-- Rosably 3.0 phase 1, task 9 fix round 1 (R40, R41): contact timeline in SQL, suggestion bookkeeping.
-- NOT YET APPLIED. Apply by hand with the owner's approval (psql service=rosably -f ...).
-- Idempotent: safe to re-run. Requires 2026-10-22_crm_email.sql.

begin;

-- R41: set once a suggestion lookup ran for the row (whether or not it found anything), so the inbox
-- list never repeats the work.
alter table crm.unmatched_email_log add column if not exists suggestion_checked_at timestamptz;

-- R40: one page of a contact's history, newest first, keyset-paginated on (ts, id).
--   activity item: kind='activity', id = activity id, ts = created_at
--   email item:    kind='email',    id = email_messages.id, ts = coalesce(sent_at, created_at)
-- email_* activities whose metadata->>'email_message_id' is a message linked to the contact are folded
-- into the email item (activity_id + metadata in the payload) and not returned separately.
-- Payload carries a 500-char preview only; never the full body_text.
create or replace function crm.contact_timeline(
  p_contact_id uuid, p_before_ts timestamptz default null, p_before_id uuid default null, p_limit int default 50)
returns table(kind text, id uuid, ts timestamptz, activity_id uuid, email_message_id uuid, payload jsonb)
language sql
stable
security definer
set search_path = crm, public, pg_temp
as $fn$
  with my_leads as (
    select l.id from crm.leads l where l.contact_id = p_contact_id
  ),
  linked as (
    select m.* from crm.email_messages m
      join crm.email_message_links k on k.email_message_id = m.id
     where k.contact_id = p_contact_id
  ),
  my_acts as (
    select a.* from crm.lead_activities a
     where a.contact_id = p_contact_id or a.lead_id in (select ml.id from my_leads ml)
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
$fn$;

revoke all on function crm.contact_timeline(uuid, timestamptz, uuid, int) from public, anon, authenticated;
grant execute on function crm.contact_timeline(uuid, timestamptz, uuid, int) to service_role;

commit;
