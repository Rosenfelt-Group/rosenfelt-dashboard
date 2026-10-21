-- Tests for 2026-10-22_crm_timeline.sql (crm.contact_timeline).

CREATE OR REPLACE FUNCTION pg_temp.mk_msg(g text, ts timestamptz, c uuid, id_ uuid DEFAULT gen_random_uuid(), with_act boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO crm.email_messages (id, gmail_message_id, direction, from_email, to_emails, subject, snippet, body_text, sent_at, source)
  VALUES (id_, g, 'received', 'x@tl.test', '{}', 'S ' || g, 'sn', repeat('b', 900), ts, 'gmail_watch');
  INSERT INTO crm.email_message_links (email_message_id, contact_id) VALUES (id_, c);
  IF with_act THEN
    INSERT INTO crm.lead_activities (contact_id, activity_type, email_direction, email_subject, content, logged_by, metadata)
    VALUES (c, 'email_received', 'received', 'S ' || g, 'sn', 'system', jsonb_build_object('email_message_id', id_, 'gmail_message_id', g));
  END IF;
  RETURN id_;
END $$;

-- null_sent_at_paginates
DO $$
DECLARE c uuid; m_null uuid; p1 record; n int; seen uuid[] := '{}'; cur_ts timestamptz; cur_id uuid; r record; pages int := 0;
BEGIN
  INSERT INTO crm.contacts (first_name, email) VALUES ('Tl', 'tl1@timeline.test') RETURNING id INTO c;
  -- 4 dated messages and one with null sent_at (falls back to created_at = now(), the newest)
  PERFORM pg_temp.mk_msg('tl1-' || i, '2026-01-01T00:00:00Z'::timestamptz + (i || ' days')::interval, c) FROM generate_series(1, 4) i;
  m_null := pg_temp.mk_msg('tl1-null', NULL, c);
  ASSERT (SELECT count(*) FROM crm.contact_timeline(c)) = 5, 'all five';
  ASSERT (SELECT id FROM crm.contact_timeline(c) LIMIT 1) = m_null, 'null sent_at sorts by created_at (newest)';
  -- walk with page size 2: nothing lost, nothing repeated
  cur_ts := NULL; cur_id := NULL;
  LOOP
    n := 0;
    FOR r IN SELECT * FROM crm.contact_timeline(c, cur_ts, cur_id, 2) LOOP
      ASSERT NOT (r.id = ANY(seen)), 'no repeats';
      seen := seen || r.id; cur_ts := r.ts; cur_id := r.id; n := n + 1;
    END LOOP;
    EXIT WHEN n < 2; pages := pages + 1; EXIT WHEN pages > 10;
  END LOOP;
  ASSERT cardinality(seen) = 5, 'walk saw all 5, got ' || cardinality(seen);
  ASSERT (SELECT payload->>'preview' FROM crm.contact_timeline(c) LIMIT 1) IS NOT NULL, 'preview present';
  ASSERT length((SELECT payload->>'preview' FROM crm.contact_timeline(c) LIMIT 1)) = 500, 'preview is 500 chars';
  ASSERT NOT (SELECT payload ? 'body_text' FROM crm.contact_timeline(c) LIMIT 1), 'no full body in payload';
END $$;

-- email_and_activity_never_both
DO $$
DECLARE c uuid; m uuid;
BEGIN
  INSERT INTO crm.contacts (first_name, email) VALUES ('Tl', 'tl2@timeline.test') RETURNING id INTO c;
  m := pg_temp.mk_msg('tl2-1', '2026-02-01T00:00:00Z', c, gen_random_uuid(), true);
  INSERT INTO crm.lead_activities (contact_id, activity_type, content, logged_by) VALUES (c, 'note', 'plain note', 'brian');
  -- a manual email log (no message id) and an email activity whose message is NOT linked still show
  INSERT INTO crm.lead_activities (contact_id, activity_type, email_subject, logged_by) VALUES (c, 'email_sent', 'manual', 'brian');
  ASSERT (SELECT count(*) FROM crm.contact_timeline(c)) = 3, 'email + note + manual = 3, got ' || (SELECT count(*) FROM crm.contact_timeline(c));
  ASSERT (SELECT count(*) FROM crm.contact_timeline(c) WHERE kind = 'email') = 1, 'one email item';
  ASSERT (SELECT activity_id IS NOT NULL AND payload->'metadata'->>'email_message_id' = m::text AND payload->>'logged_by' = 'system' FROM crm.contact_timeline(c) WHERE kind = 'email'), 'email carries activity + metadata';
  ASSERT (SELECT count(*) FROM crm.contact_timeline(c) WHERE kind = 'activity' AND payload->>'activity_type' LIKE 'email_%' AND payload->'metadata'->>'email_message_id' = m::text) = 0, 'folded activity not returned separately';
END $$;

-- ties_on_ts_not_skipped
DO $$
DECLARE c uuid; seen uuid[] := '{}'; cur_ts timestamptz; cur_id uuid; r record; n int;
BEGIN
  INSERT INTO crm.contacts (first_name, email) VALUES ('Tl', 'tl3@timeline.test') RETURNING id INTO c;
  PERFORM pg_temp.mk_msg('tl3-' || i, '2026-03-01T00:00:00Z', c) FROM generate_series(1, 7) i;
  LOOP
    n := 0;
    FOR r IN SELECT * FROM crm.contact_timeline(c, cur_ts, cur_id, 3) LOOP
      ASSERT NOT (r.id = ANY(seen)), 'no repeats on ties';
      seen := seen || r.id; cur_ts := r.ts; cur_id := r.id; n := n + 1;
    END LOOP;
    EXIT WHEN n < 3;
  END LOOP;
  ASSERT cardinality(seen) = 7, 'all 7 tied rows seen across pages, got ' || cardinality(seen);
END $$;

-- page_boundary_between_activity_and_message_no_loss
DO $$
DECLARE c uuid; seen uuid[] := '{}'; cur_ts timestamptz; cur_id uuid; r record; n int; total int;
BEGIN
  INSERT INTO crm.contacts (first_name, email) VALUES ('Tl', 'tl4@timeline.test') RETURNING id INTO c;
  -- interleave 3 notes and 3 messages at distinct times, with a message and note sharing one ts
  PERFORM pg_temp.mk_msg('tl4-' || i, '2026-04-01T00:00:00Z'::timestamptz + (i || ' hours')::interval, c) FROM generate_series(1, 3) i;
  INSERT INTO crm.lead_activities (contact_id, activity_type, content, logged_by, created_at)
    SELECT c, 'note', 'n' || i, 'brian', '2026-04-01T00:00:00Z'::timestamptz + (i || ' hours')::interval + CASE WHEN i = 2 THEN interval '0' ELSE interval '30 minutes' END FROM generate_series(1, 3) i;
  total := (SELECT count(*) FROM crm.contact_timeline(c));
  ASSERT total = 6, 'six items';
  FOR n IN 1..4 LOOP
    seen := '{}'; cur_ts := NULL; cur_id := NULL;
    LOOP
      DECLARE k int := 0; BEGIN
        FOR r IN SELECT * FROM crm.contact_timeline(c, cur_ts, cur_id, n) LOOP
          ASSERT NOT (r.id = ANY(seen)), 'no repeats at page size ' || n;
          seen := seen || r.id; cur_ts := r.ts; cur_id := r.id; k := k + 1;
        END LOOP;
        EXIT WHEN k < n;
      END;
    END LOOP;
    ASSERT cardinality(seen) = total, 'no loss at page size ' || n || ': ' || cardinality(seen);
  END LOOP;
END $$;

-- execute is restricted to service_role
DO $$
BEGIN
  ASSERT NOT has_function_privilege('anon', 'crm.contact_timeline(uuid, timestamptz, uuid, int)', 'EXECUTE'), 'anon must not execute';
  ASSERT NOT has_function_privilege('authenticated', 'crm.contact_timeline(uuid, timestamptz, uuid, int)', 'EXECUTE'), 'authenticated must not execute';
  ASSERT has_function_privilege('service_role', 'crm.contact_timeline(uuid, timestamptz, uuid, int)', 'EXECUTE'), 'service_role executes';
END $$;
