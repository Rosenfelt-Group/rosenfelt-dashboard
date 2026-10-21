-- Tests for 2026-10-22_crm_email.sql.

-- email_message_unique_gmail_id
DO $$
BEGIN
  INSERT INTO crm.email_messages (gmail_message_id, direction, source) VALUES ('g-dup-1', 'received', 'gmail_watch');
  BEGIN
    INSERT INTO crm.email_messages (gmail_message_id, direction, source) VALUES ('g-dup-1', 'sent', 'executor');
    ASSERT false, 'duplicate gmail_message_id should have been rejected';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO crm.email_messages (gmail_message_id, direction, source) VALUES ('g-bad-dir', 'sideways', 'executor');
    ASSERT false, 'bad direction should have been rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO crm.email_messages (gmail_message_id, direction, source) VALUES ('g-bad-src', 'sent', 'carrier_pigeon');
    ASSERT false, 'bad source should have been rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- links_cascade_on_message_delete
DO $$
DECLARE m uuid; c uuid;
BEGIN
  INSERT INTO crm.contacts (first_name, last_name, email) VALUES ('Link', 'Test', 'link-test@email-tests.org') RETURNING id INTO c;
  INSERT INTO crm.email_messages (gmail_message_id, direction, source) VALUES ('g-link-1', 'received', 'gmail_watch') RETURNING id INTO m;
  INSERT INTO crm.email_message_links (email_message_id, contact_id) VALUES (m, c);
  ASSERT (SELECT count(*) FROM crm.email_message_links WHERE email_message_id = m) = 1, 'link not inserted';
  DELETE FROM crm.email_messages WHERE id = m;
  ASSERT (SELECT count(*) FROM crm.email_message_links WHERE email_message_id = m) = 0, 'links should cascade';
  ASSERT EXISTS (SELECT 1 FROM crm.contacts WHERE id = c), 'contact must survive';
END $$;

-- links_cascade_on_contact_delete_and_lead_set_null
DO $$
DECLARE m uuid; c uuid; c2 uuid; l uuid; b uuid;
BEGIN
  INSERT INTO crm.contacts (first_name, last_name, email) VALUES ('A', 'B', 'cd-test@email-tests.org') RETURNING id INTO c;
  INSERT INTO crm.contacts (first_name, last_name, email) VALUES ('C', 'D', 'cd2-test@email-tests.org') RETURNING id INTO c2;
  INSERT INTO crm.businesses (name) VALUES ('Email Tests Co') RETURNING id INTO b;
  INSERT INTO crm.leads (business_id, contact_id) VALUES (b, c2) RETURNING id INTO l;
  INSERT INTO crm.email_messages (gmail_message_id, direction, source) VALUES ('g-link-2', 'sent', 'executor') RETURNING id INTO m;
  INSERT INTO crm.email_message_links (email_message_id, contact_id) VALUES (m, c);
  INSERT INTO crm.email_message_links (email_message_id, contact_id, lead_id) VALUES (m, c2, l);
  DELETE FROM crm.leads WHERE id = l;
  ASSERT (SELECT lead_id FROM crm.email_message_links WHERE email_message_id = m AND contact_id = c2) IS NULL, 'lead_id should be set null';
  DELETE FROM crm.contacts WHERE id = c;
  ASSERT (SELECT count(*) FROM crm.email_message_links WHERE email_message_id = m) = 1, 'contact delete should cascade its link only';
END $$;

-- unmatched_log_new_columns_and_sync_state_single_row
DO $$
DECLARE m uuid;
BEGIN
  INSERT INTO crm.email_messages (gmail_message_id, direction, source) VALUES ('g-unm-1', 'received', 'forward') RETURNING id INTO m;
  INSERT INTO crm.unmatched_email_log (contact_email, direction, email_message_id) VALUES ('x@nowhere.org', 'received', m);
  ASSERT (SELECT count(*) FROM crm.unmatched_email_log WHERE email_message_id = m AND resolved_at IS NULL) = 1, 'unmatched row';
  ASSERT (SELECT count(*) FROM crm.gmail_sync_state) = 1, 'sync state seeded with one row';
  BEGIN
    INSERT INTO crm.gmail_sync_state (id) VALUES (false);
    ASSERT false, 'second sync-state row should be rejected';
  EXCEPTION WHEN unique_violation OR check_violation THEN NULL;
  END;
END $$;
