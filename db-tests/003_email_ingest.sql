-- Tests for 2026-10-22_crm_email_ingest.sql (crm.store_ingested_email).

-- store_is_idempotent + two_contacts_two_activities
DO $$
DECLARE c1 uuid; c2 uuid; p jsonb; r1 jsonb; r2 jsonb; m uuid;
BEGIN
  INSERT INTO crm.contacts (first_name, last_name, email) VALUES ('Ing', 'One', 'ing1@ingest-tests.org') RETURNING id INTO c1;
  INSERT INTO crm.contacts (first_name, last_name, email) VALUES ('Ing', 'Two', 'ing2@ingest-tests.org') RETURNING id INTO c2;
  p := jsonb_build_object(
    'message', jsonb_build_object('gmail_message_id','gi-1','thread_id','t','direction','sent','from_email','brian@rosably.com',
       'to_emails', jsonb_build_array('ing1@ingest-tests.org','ing2@ingest-tests.org'),'cc_emails','[]'::jsonb,
       'subject','Hi','snippet','sn','body_text','body','sent_at','2026-10-22T00:00:00Z','source','gmail_watch','delivered_to_crm',false),
    'links', jsonb_build_array(jsonb_build_object('contact_id',c1),jsonb_build_object('contact_id',c2)),
    'activity', jsonb_build_object('activity_type','email_sent','email_direction','sent','email_subject','Hi','content','sn'));
  r1 := crm.store_ingested_email(p);
  m := (r1->>'email_message_id')::uuid;
  ASSERT (r1->>'links_added')::int = 2 AND (r1->>'activities_added')::int = 2, 'first call should add 2 links + 2 activities: ' || r1;
  r2 := crm.store_ingested_email(p);
  ASSERT (r2->>'email_message_id')::uuid = m, 'same message id';
  ASSERT (r2->>'links_added')::int = 0 AND (r2->>'activities_added')::int = 0 AND (r2->>'unmatched_added')::int = 0, 'second call adds nothing: ' || r2;
  ASSERT (SELECT count(*) FROM crm.email_messages WHERE gmail_message_id='gi-1') = 1, 'one message';
  ASSERT (SELECT count(*) FROM crm.lead_activities WHERE metadata->>'email_message_id' = m::text) = 2, 'two activities';
  ASSERT (SELECT count(*) FROM crm.lead_activities WHERE metadata->>'email_message_id' = m::text AND logged_by='system' AND activity_type='email_sent') = 2, 'activity fields';

  -- retry_repairs_missing_activity
  DELETE FROM crm.lead_activities WHERE metadata->>'email_message_id' = m::text AND contact_id = c2;
  r2 := crm.store_ingested_email(p);
  ASSERT (r2->>'activities_added')::int = 1 AND (r2->>'links_added')::int = 0, 'retry repairs one activity: ' || r2;
  ASSERT (SELECT count(*) FROM crm.lead_activities WHERE metadata->>'email_message_id' = m::text) = 2, 'activity restored';
END $$;

-- unmatched_once_per_message
DO $$
DECLARE p jsonb; r1 jsonb; r2 jsonb; m uuid;
BEGIN
  p := jsonb_build_object(
    'message', jsonb_build_object('gmail_message_id','gi-2','direction','received','from_email','pat@new.com','to_emails','["crm@rosably.com"]'::jsonb,
       'cc_emails','[]'::jsonb,'subject','Fwd','snippet','sn','body_text','b','sent_at','2026-10-22T00:00:00Z','source','forward','delivered_to_crm',true),
    'links', '[]'::jsonb,
    'unmatched', jsonb_build_object('direction','received','contact_emails',jsonb_build_array('pat@new.com'),'subject','Fwd','snippet','sn'));
  r1 := crm.store_ingested_email(p);
  r2 := crm.store_ingested_email(p);
  m := (r1->>'email_message_id')::uuid;
  ASSERT (r1->>'unmatched_added')::int = 1 AND (r2->>'unmatched_added')::int = 0, 'unmatched once';
  ASSERT (SELECT count(*) FROM crm.unmatched_email_log WHERE email_message_id = m AND direction='received' AND logged_by='system' AND suggested_contact_id IS NULL) = 1, 'one log row';
END $$;

-- unmatched_bcc_keeps_sent_direction + bcc_two_new_recipients_two_unmatched_rows
DO $$
DECLARE p jsonb; r1 jsonb; r2 jsonb; m uuid;
BEGIN
  p := jsonb_build_object(
    'message', jsonb_build_object('gmail_message_id','gi-3','direction','sent','from_email','brian@rosably.com',
       'to_emails','["n1@new.com","N2@new.com"]'::jsonb,'cc_emails','[]'::jsonb,'subject','Intro','snippet','sn','body_text','b',
       'sent_at','2026-10-22T00:00:00Z','source','forward','delivered_to_crm',true),
    'links', '[]'::jsonb,
    'unmatched', jsonb_build_object('direction','sent','contact_emails',jsonb_build_array('n1@new.com','N2@new.com','n2@NEW.com'),'subject','Intro','snippet','sn'));
  r1 := crm.store_ingested_email(p);
  r2 := crm.store_ingested_email(p);
  m := (r1->>'email_message_id')::uuid;
  ASSERT (r1->>'unmatched_added')::int = 2, 'two unmatched rows (case-insensitive dedupe): ' || r1::text;
  ASSERT (r2->>'unmatched_added')::int = 0, 'retry adds none';
  ASSERT (SELECT count(*) FROM crm.unmatched_email_log WHERE email_message_id = m) = 2, 'two rows';
  ASSERT (SELECT count(*) FROM crm.unmatched_email_log WHERE email_message_id = m AND direction = 'sent') = 2, 'direction stays sent';
END $$;

-- execute is restricted to service_role
DO $$
BEGIN
  ASSERT NOT has_function_privilege('anon', 'crm.store_ingested_email(jsonb)', 'EXECUTE'), 'anon must not execute';
  ASSERT NOT has_function_privilege('authenticated', 'crm.store_ingested_email(jsonb)', 'EXECUTE'), 'authenticated must not execute';
  ASSERT has_function_privilege('service_role', 'crm.store_ingested_email(jsonb)', 'EXECUTE'), 'service_role must execute';
END $$;

-- executor_source_survives_watch_reingest (R29)
DO $$
DECLARE p jsonb; q jsonb; r1 jsonb; r2 jsonb;
BEGIN
  p := jsonb_build_object(
    'message', jsonb_build_object('gmail_message_id','gi-exec','thread_id','t','direction','sent','from_email','brian@rosably.com',
       'to_emails','["x@exec.org"]'::jsonb,'cc_emails','[]'::jsonb,'subject','S','snippet','sn','body_text','b',
       'sent_at','2026-10-22T00:00:00Z','source','executor','delivered_to_crm',true),
    'links', '[]'::jsonb);
  r1 := crm.store_ingested_email(p);
  -- watch re-ingest of the same message labels it gmail_watch / not delivered
  q := jsonb_set(jsonb_set(p, '{message,source}', '"gmail_watch"'), '{message,delivered_to_crm}', 'false');
  r2 := crm.store_ingested_email(q);
  ASSERT (r1->>'email_message_id') = (r2->>'email_message_id'), 'same row';
  ASSERT (SELECT source FROM crm.email_messages WHERE gmail_message_id='gi-exec') = 'executor', 'source must stay executor';
  ASSERT (SELECT delivered_to_crm FROM crm.email_messages WHERE gmail_message_id='gi-exec') = true, 'delivered_to_crm must not go back to false';
END $$;
