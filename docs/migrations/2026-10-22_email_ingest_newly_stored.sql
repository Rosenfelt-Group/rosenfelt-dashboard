-- Rosably 3.0 phase 1, task 13b (R73): crm.store_ingested_email reports whether the message row was
-- newly inserted by this call ("newly_stored"), so the dashboard asks Riley for a reply draft only for
-- genuinely new mail, never on a re-delivery, retry or 7-day re-sync.
-- NOT YET APPLIED. Apply by hand with the owner's approval (psql service=rosably -f ...).
-- Idempotent: create or replace, same signature and grants. Requires 2026-10-22_crm_email_ingest.sql
-- (this file sorts after it). Only change vs that file: v_new + the returned "newly_stored" key.
-- A pre-existing key in the result is untouched, so old callers keep working.

begin;

create or replace function crm.store_ingested_email(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = crm, public, pg_temp
as $fn$
declare
  m     jsonb := p->'message';
  v_id  uuid;
  v_links int := 0;
  v_acts  int := 0;
  v_unm   int := 0;
  v_new   boolean;
begin
  insert into email_messages (gmail_message_id, thread_id, rfc_message_id, direction, from_email, from_name,
                              to_emails, cc_emails, subject, snippet, body_text, sent_at, source, delivered_to_crm)
  values (m->>'gmail_message_id', m->>'thread_id', m->>'rfc_message_id', m->>'direction', m->>'from_email', m->>'from_name',
          coalesce(array(select jsonb_array_elements_text(m->'to_emails')), '{}'),
          coalesce(array(select jsonb_array_elements_text(m->'cc_emails')), '{}'),
          m->>'subject', m->>'snippet', m->>'body_text', (m->>'sent_at')::timestamptz, m->>'source',
          coalesce((m->>'delivered_to_crm')::boolean, false))
  on conflict (gmail_message_id) do update set
    thread_id = excluded.thread_id, rfc_message_id = excluded.rfc_message_id, direction = excluded.direction,
    from_email = excluded.from_email, from_name = excluded.from_name, to_emails = excluded.to_emails,
    cc_emails = excluded.cc_emails, subject = excluded.subject, snippet = excluded.snippet,
    body_text = excluded.body_text, sent_at = excluded.sent_at,
    -- R29: the first writer's source wins (the executor/compose stores a sent message before the Gmail
    -- watch re-ingests it from SENT), and a true delivered_to_crm is never overwritten with false.
    source = email_messages.source,
    delivered_to_crm = coalesce(email_messages.delivered_to_crm, false) or excluded.delivered_to_crm
  returning id, (xmax = 0) into v_id, v_new; -- xmax = 0: the row was inserted, not updated by the conflict branch

  if jsonb_typeof(p->'links') = 'array' and jsonb_array_length(p->'links') > 0 then
    insert into email_message_links (email_message_id, contact_id, lead_id, client_id)
    select v_id, (l->>'contact_id')::uuid, (l->>'lead_id')::uuid, (l->>'client_id')::uuid
      from jsonb_array_elements(p->'links') l
    on conflict do nothing;
    get diagnostics v_links = row_count;

    insert into lead_activities (lead_id, contact_id, client_id, activity_type, email_direction, email_subject, content, logged_by, metadata)
    select (l->>'lead_id')::uuid, (l->>'contact_id')::uuid, (l->>'client_id')::uuid,
           p->'activity'->>'activity_type', p->'activity'->>'email_direction', p->'activity'->>'email_subject',
           p->'activity'->>'content', 'system',
           jsonb_build_object('email_message_id', v_id, 'gmail_message_id', m->>'gmail_message_id')
      from jsonb_array_elements(p->'links') l
    on conflict do nothing;
    get diagnostics v_acts = row_count;
  end if;

  if jsonb_typeof(p->'unmatched') = 'object' then
    insert into unmatched_email_log (contact_email, subject, direction, snippet, logged_by, email_message_id, suggested_contact_id, "timestamp")
    select e, p->'unmatched'->>'subject', coalesce(p->'unmatched'->>'direction', m->>'direction'), p->'unmatched'->>'snippet',
           'system', v_id, null, now()
      from jsonb_array_elements_text(p->'unmatched'->'contact_emails') e
    on conflict do nothing;
    get diagnostics v_unm = row_count;
  end if;

  return jsonb_build_object('email_message_id', v_id, 'links_added', v_links, 'activities_added', v_acts, 'unmatched_added', v_unm, 'newly_stored', v_new);
end;
$fn$;


revoke all on function crm.store_ingested_email(jsonb) from public, anon, authenticated;
grant execute on function crm.store_ingested_email(jsonb) to service_role;

commit;
