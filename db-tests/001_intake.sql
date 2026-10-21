-- Tests for crm.intake_lead. Each block is a DO $$ ... ASSERT ... $$.
-- Each test uses its own email addresses so blocks are independent.

-- intake_creates_contact_business_lead
DO $$
DECLARE r jsonb; n int;
BEGIN
  r := crm.intake_lead('{"channel":"quiz","email":"t1@acme-one.org","name":"Tina One","org":"Acme One"}'::jsonb);
  ASSERT (r->>'created_contact')::boolean, 'created_contact should be true';
  ASSERT (r->>'created_lead')::boolean, 'created_lead should be true';
  ASSERT r->>'business_id' IS NOT NULL, 'business_id missing';
  ASSERT (SELECT name FROM crm.businesses WHERE id = (r->>'business_id')::uuid) = 'Acme One', 'business name';
  ASSERT (SELECT source FROM crm.leads WHERE id = (r->>'lead_id')::uuid) = 'quiz', 'lead source';
  SELECT count(*) INTO n FROM crm.lead_activities
    WHERE lead_id = (r->>'lead_id')::uuid AND activity_type = 'intake' AND logged_by = 'system';
  ASSERT n = 1, format('expected 1 intake activity, got %s', n);
  ASSERT (SELECT metadata->>'channel' FROM crm.lead_activities
          WHERE lead_id = (r->>'lead_id')::uuid AND activity_type = 'intake') = 'quiz', 'activity channel metadata';
END $$;

-- intake_dedups_case_and_whitespace
DO $$
DECLARE a jsonb; b jsonb;
BEGIN
  a := crm.intake_lead('{"channel":"contact_form","email":"jane@org.com","name":"Jane Doe","org":"Org Inc"}'::jsonb);
  b := crm.intake_lead('{"channel":"calendly","email":" Jane@Org.COM ","name":"Jane Doe"}'::jsonb);
  ASSERT a->>'contact_id' = b->>'contact_id', 'same contact expected';
  ASSERT a->>'lead_id' = b->>'lead_id', 'same lead expected';
  ASSERT NOT (b->>'created_contact')::boolean, 'created_contact should be false';
  ASSERT NOT (b->>'created_lead')::boolean, 'created_lead should be false';
  ASSERT (SELECT count(*) FROM crm.lead_activities
          WHERE lead_id = (a->>'lead_id')::uuid AND activity_type = 'intake') = 2, 'one activity per call';
END $$;

-- intake_keeps_plus_address_distinct
DO $$
DECLARE a jsonb; b jsonb;
BEGIN
  a := crm.intake_lead('{"channel":"manual","email":"plus@org.com","name":"Plus"}'::jsonb);
  b := crm.intake_lead('{"channel":"manual","email":"plus+x@org.com","name":"Plus"}'::jsonb);
  ASSERT a->>'contact_id' <> b->>'contact_id', 'plus address must be a new contact';
  ASSERT (b->>'created_contact')::boolean, 'created_contact should be true';
END $$;

-- intake_stage_only_moves_forward
DO $$
DECLARE a jsonb; b jsonb; c jsonb; lid uuid;
BEGIN
  a := crm.intake_lead('{"channel":"manual","email":"fwd@stage.org","name":"Fwd","org":"Stage Co"}'::jsonb);
  lid := (a->>'lead_id')::uuid;
  UPDATE crm.leads SET stage = 'proposal' WHERE id = lid;
  b := crm.intake_lead('{"channel":"manual","email":"fwd@stage.org","stage":"new"}'::jsonb);
  ASSERT b->>'lead_id' = a->>'lead_id', 'same lead';
  ASSERT (SELECT stage FROM crm.leads WHERE id = lid) = 'proposal', 'stage must not move back';
  c := crm.intake_lead('{"channel":"manual","email":"fwd@stage.org","stage":"won"}'::jsonb);
  ASSERT (SELECT stage FROM crm.leads WHERE id = lid) = 'won', 'stage should move forward to won';
END $$;

-- intake_first_touch_wins
DO $$
DECLARE a jsonb; lid uuid;
BEGIN
  a := crm.intake_lead('{"channel":"quiz","email":"ft@touch.org","name":"Ft","org":"Touch","utm_source":"google","utm_campaign":"spring","referrer":"https://g.co","landing_path":"/quiz"}'::jsonb);
  lid := (a->>'lead_id')::uuid;
  PERFORM crm.intake_lead('{"channel":"ebook","email":"ft@touch.org","utm_source":"facebook","utm_medium":"cpc"}'::jsonb);
  ASSERT (SELECT utm_source FROM crm.leads WHERE id = lid) = 'google', 'first utm_source kept';
  ASSERT (SELECT utm_campaign FROM crm.leads WHERE id = lid) = 'spring', 'first utm_campaign kept';
  ASSERT (SELECT utm_medium FROM crm.leads WHERE id = lid) = 'cpc', 'null column filled by later touch';
  ASSERT (SELECT first_touch_at FROM crm.leads WHERE id = lid) IS NOT NULL, 'first_touch_at set';
END $$;

-- intake_reopens_after_closed_lead
DO $$
DECLARE a jsonb; b jsonb;
BEGIN
  a := crm.intake_lead('{"channel":"manual","email":"closed@re.org","name":"Closed","org":"Re Co"}'::jsonb);
  UPDATE crm.leads SET stage = 'lost' WHERE id = (a->>'lead_id')::uuid;
  b := crm.intake_lead('{"channel":"contact_form","email":"closed@re.org"}'::jsonb);
  ASSERT a->>'lead_id' <> b->>'lead_id', 'new lead expected';
  ASSERT (b->>'created_lead')::boolean, 'created_lead true';
  ASSERT NOT (b->>'created_contact')::boolean, 'contact reused';
  ASSERT (SELECT stage FROM crm.leads WHERE id = (a->>'lead_id')::uuid) = 'lost', 'old lead stays lost';
END $$;

-- intake_freemail_business_name
DO $$
DECLARE a jsonb; d jsonb;
BEGIN
  a := crm.intake_lead('{"channel":"ebook","email":"bob@gmail.com","name":"Bob Builder"}'::jsonb);
  ASSERT (SELECT name FROM crm.businesses WHERE id = (a->>'business_id')::uuid) = 'Bob Builder', 'freemail uses person name';
  d := crm.intake_lead('{"channel":"ebook","email":"pat@domainco.example"}'::jsonb);
  ASSERT (SELECT name FROM crm.businesses WHERE id = (d->>'business_id')::uuid) = 'domainco.example', 'domain used when no org';
END $$;

-- intake_rejects_unknown_channel
DO $$
BEGIN
  BEGIN
    PERFORM crm.intake_lead('{"channel":"carrier_pigeon","email":"x@y.org"}'::jsonb);
    RAISE EXCEPTION 'should have raised';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM NOT LIKE 'should have raised', 'unknown channel was accepted';
  END;
  BEGIN
    PERFORM crm.intake_lead('{"channel":"quiz","email":"  "}'::jsonb);
    RAISE EXCEPTION 'should have raised';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM NOT LIKE 'should have raised', 'blank email was accepted';
  END;
END $$;

-- intake_grants: only service_role may execute
DO $$
BEGIN
  ASSERT has_function_privilege('service_role', 'crm.intake_lead(jsonb)', 'EXECUTE'), 'service_role needs execute';
  ASSERT NOT has_function_privilege('anon', 'crm.intake_lead(jsonb)', 'EXECUTE'), 'anon must not execute';
  ASSERT NOT has_function_privilege('authenticated', 'crm.intake_lead(jsonb)', 'EXECUTE'), 'authenticated must not execute';
END $$;

SELECT 'ok: 001_intake' AS result;
