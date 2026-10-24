-- Tests for intake rule R11 (docs/migrations/2026-10-24_intake_existing_client.sql):
-- an automated signup from an existing client is logged on the won lead instead of opening a new one.

-- intake_existing_client_reuses_won_lead
DO $$
DECLARE a jsonb; b jsonb; lid uuid; n int;
BEGIN
  a := crm.intake_lead('{"channel":"manual","email":"won1@client.org","name":"Wanda Won","org":"Client One"}'::jsonb);
  lid := (a->>'lead_id')::uuid;
  UPDATE crm.leads SET stage = 'won' WHERE id = lid;
  b := crm.intake_lead('{"channel":"ebook","email":"won1@client.org","utm_source":"newsletter"}'::jsonb);
  ASSERT b->>'lead_id' = lid::text, 'ebook signup should land on the won lead';
  ASSERT NOT (b->>'created_lead')::boolean, 'created_lead should be false';
  ASSERT (b->>'existing_client')::boolean, 'existing_client should be true';
  ASSERT (SELECT stage FROM crm.leads WHERE id = lid) = 'won', 'won lead keeps its stage';
  ASSERT (SELECT utm_source FROM crm.leads WHERE id = lid) IS NULL, 'won lead attribution untouched';
  SELECT count(*) INTO n FROM crm.leads WHERE contact_id = (a->>'contact_id')::uuid;
  ASSERT n = 1, format('expected 1 lead, got %s', n);
  ASSERT (SELECT metadata->>'existing_client' FROM crm.lead_activities
          WHERE lead_id = lid AND activity_type = 'intake' AND metadata->>'channel' = 'ebook') = 'true',
         'intake activity flagged existing_client';
END $$;

-- intake_existing_client_matches_by_business
DO $$
DECLARE a jsonb; b jsonb;
BEGIN
  a := crm.intake_lead('{"channel":"manual","email":"boss@client-two.org","name":"Boss","org":"Client Two"}'::jsonb);
  UPDATE crm.leads SET stage = 'won' WHERE id = (a->>'lead_id')::uuid;
  -- a new person at the same organization (matched by org name)
  b := crm.intake_lead('{"channel":"quiz","email":"staff@client-two.org","name":"Staffer","org":"Client Two"}'::jsonb);
  ASSERT b->>'business_id' = a->>'business_id', 'same business';
  ASSERT (b->>'created_contact')::boolean, 'new contact created';
  ASSERT b->>'lead_id' = a->>'lead_id', 'quiz from a colleague lands on the business won lead';
  ASSERT (b->>'existing_client')::boolean, 'existing_client true';
END $$;

-- intake_existing_client_manual_still_opens_new_deal
DO $$
DECLARE a jsonb; b jsonb;
BEGIN
  a := crm.intake_lead('{"channel":"manual","email":"won3@client.org","name":"Third","org":"Client Three"}'::jsonb);
  UPDATE crm.leads SET stage = 'won' WHERE id = (a->>'lead_id')::uuid;
  b := crm.intake_lead('{"channel":"referral","email":"won3@client.org"}'::jsonb);
  ASSERT b->>'lead_id' <> a->>'lead_id', 'a human channel opens a new deal';
  ASSERT (b->>'created_lead')::boolean, 'created_lead true';
  ASSERT NOT (b->>'existing_client')::boolean, 'existing_client false';
END $$;

-- intake_existing_client_prefers_open_lead
DO $$
DECLARE a jsonb; b jsonb; c jsonb;
BEGIN
  a := crm.intake_lead('{"channel":"manual","email":"won4@client.org","name":"Fourth","org":"Client Four"}'::jsonb);
  UPDATE crm.leads SET stage = 'won' WHERE id = (a->>'lead_id')::uuid;
  b := crm.intake_lead('{"channel":"manual","email":"won4@client.org"}'::jsonb);  -- new open deal
  c := crm.intake_lead('{"channel":"ebook","email":"won4@client.org"}'::jsonb);
  ASSERT c->>'lead_id' = b->>'lead_id', 'an open lead still wins over the won lead';
  ASSERT NOT (c->>'existing_client')::boolean, 'existing_client false when an open lead matched';
END $$;

-- intake_lost_only_still_reopens
DO $$
DECLARE a jsonb; b jsonb;
BEGIN
  a := crm.intake_lead('{"channel":"manual","email":"lost5@x.org","name":"Five","org":"Lost Five"}'::jsonb);
  UPDATE crm.leads SET stage = 'lost' WHERE id = (a->>'lead_id')::uuid;
  b := crm.intake_lead('{"channel":"ebook","email":"lost5@x.org"}'::jsonb);
  ASSERT (b->>'created_lead')::boolean, 'lost-only contact gets a new lead';
  ASSERT NOT (b->>'existing_client')::boolean, 'existing_client false';
END $$;

-- intake_existing_client_org_name_alone_not_trusted
DO $$
DECLARE a jsonb; b jsonb; c jsonb;
BEGIN
  a := crm.intake_lead('{"channel":"manual","email":"ed@client-six.org","name":"Ed","org":"Client Six"}'::jsonb);
  UPDATE crm.leads SET stage = 'won' WHERE id = (a->>'lead_id')::uuid;
  -- a new address on another domain that only names the org
  b := crm.intake_lead('{"channel":"contact_form","email":"someone@elsewhere.example","org":"Client Six","summary":"hi"}'::jsonb);
  ASSERT b->>'business_id' = a->>'business_id', 'org name still matches the business (unchanged)';
  ASSERT b->>'lead_id' <> a->>'lead_id', 'must not land on the client''s won lead';
  ASSERT (b->>'created_lead')::boolean, 'opens a new lead instead';
  ASSERT NOT (b->>'existing_client')::boolean, 'existing_client false';
  -- free-mail with the org name is not trusted either
  c := crm.intake_lead('{"channel":"ebook","email":"six.fan@gmail.com","org":"Client Six"}'::jsonb);
  ASSERT c->>'lead_id' <> a->>'lead_id', 'free-mail + org name must not land on the won lead';
  ASSERT NOT (c->>'existing_client')::boolean, 'existing_client false for free-mail';
END $$;

-- intake_existing_client_saved_org_link_not_trusted
DO $$
DECLARE a jsonb; b jsonb; c jsonb;
BEGIN
  a := crm.intake_lead('{"channel":"manual","email":"ann@client-seven.org","name":"Ann","org":"Client Seven"}'::jsonb);
  UPDATE crm.leads SET stage = 'won' WHERE id = (a->>'lead_id')::uuid;
  -- first submission: a new outside address names the org; intake links the contact to the business
  b := crm.intake_lead('{"channel":"contact_form","email":"x@outside.example","org":"Client Seven"}'::jsonb);
  ASSERT b->>'business_id' = a->>'business_id', 'linked to the business by org name (unchanged)';
  ASSERT b->>'lead_id' <> a->>'lead_id', 'first submission gets its own lead';
  UPDATE crm.leads SET stage = 'lost' WHERE id = (b->>'lead_id')::uuid;
  -- second submission from the same, now-linked address must still not reach the won lead
  c := crm.intake_lead('{"channel":"ebook","email":"x@outside.example"}'::jsonb);
  ASSERT c->>'lead_id' <> a->>'lead_id', 'saved org-name link must not unlock the won lead';
  ASSERT NOT (c->>'existing_client')::boolean, 'existing_client false';
END $$;

-- intake_existing_client_consumer_domains_not_trusted
DO $$
DECLARE a jsonb; b jsonb; c jsonb;
BEGIN
  -- a client whose contact uses a consumer provider
  a := crm.intake_lead('{"channel":"manual","email":"chair@aol.com","name":"Chair","org":"Client Eight"}'::jsonb);
  UPDATE crm.leads SET stage = 'won' WHERE id = (a->>'lead_id')::uuid;
  b := crm.intake_lead('{"channel":"ebook","email":"other@aol.com","org":"Client Eight"}'::jsonb);
  ASSERT b->>'lead_id' <> a->>'lead_id', 'a shared aol.com domain is not evidence';
  ASSERT NOT (b->>'existing_client')::boolean, 'existing_client false';
  -- R10 now treats proton.me as free-mail: no org means a business named after the person
  c := crm.intake_lead('{"channel":"ebook","email":"pat@proton.me","name":"Pat Proton"}'::jsonb);
  ASSERT (SELECT name FROM crm.businesses WHERE id = (c->>'business_id')::uuid) = 'Pat Proton', 'proton.me is free-mail';
END $$;
