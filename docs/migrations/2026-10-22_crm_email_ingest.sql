-- Rosably 3.0 phase 1, task 6 (R19): atomic, idempotent Gmail ingest store step.
-- NOT YET APPLIED. Apply by hand with the owner's approval (psql service=rosably -f ...).
-- Idempotent: safe to re-run. Requires 2026-10-22_crm_email.sql and 2026-10-22_crm_identity_intake.sql.

begin;

create unique index if not exists unmatched_email_log_message_uidx
  on crm.unmatched_email_log (email_message_id) where email_message_id is not null;

create unique index if not exists lead_activities_email_msg_contact_uidx
  on crm.lead_activities ((metadata->>'email_message_id'), contact_id)
  where activity_type in ('email_received', 'email_sent');

-- p = {
--   message:   {gmail_message_id, thread_id, rfc_message_id, direction, from_email, from_name, to_emails[], cc_emails[],
--               subject, snippet, body_text, sent_at, source, delivered_to_crm},
--   links:     [{contact_id, lead_id, client_id}],
--   activity:  {activity_type, email_direction, email_subject, content}      (applied to every link),
--   unmatched: {contact_email, subject, snippet} | absent
-- }
-- One transaction: message upsert, links, one activity per link (every link, so a retry repairs a
-- missing activity), unmatched log. All inserts are ON CONFLICT DO NOTHING.
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
    body_text = excluded.body_text, sent_at = excluded.sent_at, source = excluded.source,
    delivered_to_crm = excluded.delivered_to_crm
  returning id into v_id;

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
    values (p->'unmatched'->>'contact_email', p->'unmatched'->>'subject', 'received', p->'unmatched'->>'snippet',
            'system', v_id, null, now())
    on conflict do nothing;
    get diagnostics v_unm = row_count;
  end if;

  return jsonb_build_object('email_message_id', v_id, 'links_added', v_links, 'activities_added', v_acts, 'unmatched_added', v_unm);
end;
$fn$;

revoke all on function crm.store_ingested_email(jsonb) from public, anon, authenticated;
grant execute on function crm.store_ingested_email(jsonb) to service_role;

commit;
