-- Tests for docs/migrations/2026-10-25_e_organizations.sql (crm.org_status, crm.org_timeline).

-- org_status_derivation
DO $$
DECLARE b_pro uuid; b_cli uuid; b_setup uuid; b_past uuid; b_ended uuid; b_part uuid; b_over uuid; b_del uuid;
        c uuid; t uuid;
BEGIN
  INSERT INTO crm.service_templates (name, billing_type) VALUES ('Org test retainer', 'recurring') RETURNING id INTO t;
  INSERT INTO crm.businesses (name) VALUES ('Org Prospect') RETURNING id INTO b_pro;
  INSERT INTO crm.businesses (name) VALUES ('Org Client') RETURNING id INTO b_cli;
  INSERT INTO crm.businesses (name) VALUES ('Org Setup') RETURNING id INTO b_setup;
  INSERT INTO crm.businesses (name) VALUES ('Org Past') RETURNING id INTO b_past;
  INSERT INTO crm.businesses (name) VALUES ('Org Ended') RETURNING id INTO b_ended;
  INSERT INTO crm.businesses (name, relationship) VALUES ('Org Partner', 'partner') RETURNING id INTO b_part;
  INSERT INTO crm.businesses (name) VALUES ('Org Override') RETURNING id INTO b_over;
  INSERT INTO crm.businesses (name) VALUES ('Org Deleted') RETURNING id INTO b_del;

  -- client with a pending service: still a client (billing_status stays 'cancelled' until activation)
  INSERT INTO crm.clients (business_id, billing_status) VALUES (b_cli, 'cancelled') RETURNING id INTO c;
  INSERT INTO crm.client_services (client_id, service_template_id, status) VALUES (c, t, 'pending_activation');
  -- brand-new client with no services and no end date: a client in setup
  INSERT INTO crm.clients (business_id, billing_status) VALUES (b_setup, 'cancelled');
  -- every service cancelled: past client
  INSERT INTO crm.clients (business_id, billing_status) VALUES (b_past, 'cancelled') RETURNING id INTO c;
  INSERT INTO crm.client_services (client_id, service_template_id, status) VALUES (c, t, 'cancelled');
  -- no services and the contract ended: past client
  INSERT INTO crm.clients (business_id, billing_status, contract_end) VALUES (b_ended, 'cancelled', current_date - 1);
  -- override wins over the derived client status
  INSERT INTO crm.clients (business_id, billing_status) VALUES (b_over, 'active');
  UPDATE crm.businesses SET relationship = 'past_client' WHERE id = b_over;
  -- a deleted client record doesn't count
  INSERT INTO crm.clients (business_id, billing_status, deleted_at) VALUES (b_pro, 'active', now());

  ASSERT (SELECT status FROM crm.org_status WHERE business_id = b_pro) = 'prospect', 'prospect';
  ASSERT (SELECT client_count FROM crm.org_status WHERE business_id = b_pro) = 0, 'deleted client not counted';
  ASSERT (SELECT status FROM crm.org_status WHERE business_id = b_cli) = 'client', 'pending service -> client';
  ASSERT (SELECT status FROM crm.org_status WHERE business_id = b_setup) = 'client', 'setup -> client';
  ASSERT (SELECT status FROM crm.org_status WHERE business_id = b_past) = 'past_client', 'all cancelled -> past client';
  ASSERT (SELECT status FROM crm.org_status WHERE business_id = b_ended) = 'past_client', 'contract ended -> past client';
  ASSERT (SELECT status FROM crm.org_status WHERE business_id = b_part) = 'partner', 'partner override';
  ASSERT (SELECT derived_status FROM crm.org_status WHERE business_id = b_part) = 'prospect', 'partner derived is prospect';
  ASSERT (SELECT status || '/' || derived_status FROM crm.org_status WHERE business_id = b_over) = 'past_client/client', 'override wins';

  UPDATE crm.businesses SET deleted_at = now() WHERE id = b_del;
  ASSERT NOT EXISTS (SELECT 1 FROM crm.org_status WHERE business_id = b_del), 'deleted business hidden';

  BEGIN
    UPDATE crm.businesses SET relationship = 'vendor' WHERE id = b_pro;
    RAISE EXCEPTION 'relationship check did not fire';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- org_timeline_merges_sources
DO $$
DECLARE b uuid; b2 uuid; c1 uuid; c2 uuid; c_other uuid; l uuid; cl uuid; e uuid; m uuid; d uuid; v uuid;
        n int; seen uuid[] := '{}'; cur_ts timestamptz; cur_id uuid; r record; pages int := 0;
BEGIN
  INSERT INTO crm.businesses (name) VALUES ('Org Timeline') RETURNING id INTO b;
  INSERT INTO crm.businesses (name) VALUES ('Org Elsewhere') RETURNING id INTO b2;
  INSERT INTO crm.contacts (business_id, first_name, email) VALUES (b, 'Ann', 'ann@orgtl.test') RETURNING id INTO c1;
  INSERT INTO crm.contacts (business_id, first_name, email) VALUES (b, 'Bob', 'bob@orgtl.test') RETURNING id INTO c2;
  INSERT INTO crm.contacts (business_id, first_name, email) VALUES (b2, 'Out', 'out@orgtl.test') RETURNING id INTO c_other;
  INSERT INTO crm.leads (business_id, contact_id, stage) VALUES (b, c1, 'new') RETURNING id INTO l;
  INSERT INTO crm.clients (business_id, billing_status) VALUES (b, 'cancelled') RETURNING id INTO cl;

  -- one email linked to both org contacts (shown once), folded with its activity
  m := gen_random_uuid();
  INSERT INTO crm.email_messages (id, gmail_message_id, direction, from_email, to_emails, subject, body_text, sent_at, source)
  VALUES (m, 'orgtl-1', 'received', 'ann@orgtl.test', '{}', 'Hello', repeat('x', 800), '2026-03-01T10:00:00Z', 'gmail_watch');
  INSERT INTO crm.email_message_links (email_message_id, contact_id) VALUES (m, c1), (m, c2);
  INSERT INTO crm.lead_activities (contact_id, activity_type, email_direction, email_subject, logged_by, metadata, created_at)
  VALUES (c1, 'email_received', 'received', 'Hello', 'system', jsonb_build_object('email_message_id', m), '2026-03-01T10:00:01Z');
  -- lead, client and contact activities
  INSERT INTO crm.lead_activities (lead_id, activity_type, content, logged_by, created_at) VALUES (l, 'stage_change', 'moved', 'system', '2026-03-02T00:00:00Z');
  INSERT INTO crm.lead_activities (client_id, activity_type, content, logged_by, created_at) VALUES (cl, 'note', 'client note', 'brian', '2026-03-03T00:00:00Z');
  INSERT INTO crm.lead_activities (contact_id, activity_type, content, logged_by, created_at) VALUES (c2, 'note', 'bob note', 'brian', '2026-03-04T00:00:00Z');
  -- noise from another organization
  INSERT INTO crm.lead_activities (contact_id, activity_type, content, logged_by) VALUES (c_other, 'note', 'not ours', 'brian');
  -- a room with one event
  INSERT INTO rooms.engagements (business_id, lead_id, relationship, title, status) VALUES (b, l, 'prospect', 'Room A', 'active') RETURNING id INTO e;
  INSERT INTO rooms.engagement_events (engagement_id, type, meta, created_at) VALUES (e, 'room_opened', '{}', '2026-03-05T00:00:00Z');
  -- a scope document with one version
  INSERT INTO crm.scope_documents (business_id, lead_id, title) VALUES (b, l, 'Scope A') RETURNING id INTO d;
  INSERT INTO crm.scope_versions (scope_document_id, version_no, sections, status, source, created_at)
  VALUES (d, 1, '[]', 'current', 'brian', '2026-03-06T00:00:00Z') RETURNING id INTO v;

  ASSERT (SELECT count(*) FROM crm.org_timeline(b)) = 6, 'email + 3 activities + room event + scope = 6, got ' || (SELECT count(*) FROM crm.org_timeline(b));
  ASSERT (SELECT count(*) FROM crm.org_timeline(b) WHERE kind = 'email') = 1, 'email shown once';
  ASSERT (SELECT activity_id IS NOT NULL FROM crm.org_timeline(b) WHERE kind = 'email'), 'email folded with its activity';
  ASSERT NOT EXISTS (SELECT 1 FROM crm.org_timeline(b) WHERE payload->>'content' = 'not ours'), 'other org excluded';
  ASSERT (SELECT id FROM crm.org_timeline(b) LIMIT 1) = v, 'newest first (scope)';
  ASSERT (SELECT payload->>'event_type' FROM crm.org_timeline(b) WHERE kind = 'room_event') = 'room_opened', 'room event';
  ASSERT (SELECT payload->>'room_title' FROM crm.org_timeline(b) WHERE kind = 'room_event') = 'Room A', 'room title';
  ASSERT (SELECT payload->>'status' FROM crm.org_timeline(b) WHERE kind = 'scope') = 'current', 'scope status';
  ASSERT length((SELECT payload->>'preview' FROM crm.org_timeline(b) WHERE kind = 'email')) = 500, 'preview only';

  -- keyset walk with page size 2: nothing lost or repeated
  LOOP
    n := 0;
    FOR r IN SELECT * FROM crm.org_timeline(b, cur_ts, cur_id, 2) LOOP
      ASSERT NOT (r.id = ANY(seen)), 'no repeats';
      seen := seen || r.id; cur_ts := r.ts; cur_id := r.id; n := n + 1;
    END LOOP;
    EXIT WHEN n < 2; pages := pages + 1; EXIT WHEN pages > 10;
  END LOOP;
  ASSERT cardinality(seen) = 6, 'walk saw all 6, got ' || cardinality(seen);

  -- soft-deleted contacts, rooms and scopes drop out
  UPDATE crm.contacts SET deleted_at = now() WHERE id = c2;
  UPDATE rooms.engagements SET deleted_at = now() WHERE id = e;
  UPDATE crm.scope_documents SET deleted_at = now() WHERE id = d;
  ASSERT NOT EXISTS (SELECT 1 FROM crm.org_timeline(b) WHERE payload->>'content' = 'bob note'), 'deleted contact dropped';
  ASSERT NOT EXISTS (SELECT 1 FROM crm.org_timeline(b) WHERE kind IN ('room_event', 'scope')), 'deleted room and scope dropped';
  ASSERT (SELECT count(*) FROM crm.org_timeline(b) WHERE kind = 'email') = 1, 'email still reachable through Ann';
END $$;

-- org_timeline_grants
DO $$
BEGIN
  ASSERT NOT has_function_privilege('anon', 'crm.org_timeline(uuid, timestamptz, uuid, int)', 'execute'), 'anon cannot execute';
  ASSERT NOT has_function_privilege('authenticated', 'crm.org_timeline(uuid, timestamptz, uuid, int)', 'execute'), 'authenticated cannot execute';
  ASSERT has_function_privilege('service_role', 'crm.org_timeline(uuid, timestamptz, uuid, int)', 'execute'), 'service_role can execute';
  ASSERT NOT has_table_privilege('anon', 'crm.org_status', 'select'), 'anon cannot read org_status';
  ASSERT has_table_privilege('service_role', 'crm.org_status', 'select'), 'service_role reads org_status';
END $$;
