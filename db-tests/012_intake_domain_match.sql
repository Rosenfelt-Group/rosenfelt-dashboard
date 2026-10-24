-- Tests for intake business matching by work domain (rule R12) and Trash awareness
-- (docs/migrations/2026-10-25_b_crm_merge_dedupe.sql). R9-R11 are covered by 001 and 009.

-- intake_colleague_links_by_email_domain
DO $$
DECLARE a jsonb; b jsonb; c jsonb; n int;
BEGIN
  a := crm.intake_lead('{"channel":"manual","email":"boss@domainclient.org","name":"Boss","org":"Domain Client"}'::jsonb);
  ASSERT a->>'business_match' = 'created', format('first intake creates, got %s', a->>'business_match');
  UPDATE crm.leads SET stage = 'won' WHERE id = (a->>'lead_id')::uuid;
  -- a colleague leaves org blank: used to create a business named "domainclient.org"
  b := crm.intake_lead('{"channel":"ebook","email":"staff@DomainClient.org","name":"Staff Member"}'::jsonb);
  ASSERT b->>'business_id' = a->>'business_id', 'colleague linked to the existing business';
  ASSERT b->>'business_match' = 'domain', 'matched by domain';
  ASSERT (b->>'created_contact')::boolean, 'new contact';
  -- R11 unchanged: another contact there shares the work domain, so the signup lands on the won lead
  ASSERT b->>'lead_id' = a->>'lead_id', 'colleague ebook lands on the won lead';
  ASSERT (b->>'existing_client')::boolean, 'existing_client';
  SELECT count(*) INTO n FROM crm.businesses WHERE name = 'domainclient.org';
  ASSERT n = 0, 'no business named after the domain';
  ASSERT (SELECT metadata->>'business_match' FROM crm.lead_activities
          WHERE lead_id = (a->>'lead_id')::uuid AND contact_id = (b->>'contact_id')::uuid AND activity_type = 'intake') = 'domain',
         'intake activity records the domain match';
  -- a human channel from another colleague still opens a new deal at the same business
  c := crm.intake_lead('{"channel":"referral","email":"ops@domainclient.org"}'::jsonb);
  ASSERT c->>'business_id' = a->>'business_id', 'same business';
  ASSERT (c->>'created_lead')::boolean AND c->>'lead_id' <> a->>'lead_id', 'new deal for a human channel';
  -- a returning contact is matched by contact
  c := crm.intake_lead('{"channel":"ebook","email":"staff@domainclient.org"}'::jsonb);
  ASSERT c->>'business_match' = 'contact', format('returning contact, got %s', c->>'business_match');
END $$;

-- intake_website_match_alone_never_reaches_won_lead
DO $$
DECLARE a jsonb; b jsonb;
BEGIN
  a := crm.intake_lead('{"channel":"manual","email":"founder.webonly@gmail.com","name":"Founder","org":"Web Only Org"}'::jsonb);
  UPDATE crm.businesses SET website = 'https://www.WebOnly.org/about' WHERE id = (a->>'business_id')::uuid;
  UPDATE crm.leads SET stage = 'won' WHERE id = (a->>'lead_id')::uuid;
  b := crm.intake_lead('{"channel":"ebook","email":"anyone@webonly.org"}'::jsonb);
  ASSERT b->>'business_id' = a->>'business_id', 'website domain links the business';
  ASSERT b->>'business_match' = 'domain', 'domain match';
  ASSERT b->>'lead_id' <> a->>'lead_id', 'website alone must not reach the won lead';
  ASSERT (b->>'created_lead')::boolean AND NOT (b->>'existing_client')::boolean, 'new lead, not existing client';
  -- a second address there: the first one was linked by intake, so it can't vouch for this one
  b := crm.intake_lead('{"channel":"ebook","email":"second@webonly.org"}'::jsonb);
  ASSERT b->>'business_id' = a->>'business_id', 'linked by domain';
  ASSERT b->>'lead_id' <> a->>'lead_id' AND NOT (b->>'existing_client')::boolean, 'chained domain match: no won lead';
END $$;

-- intake_freemail_never_matches_by_domain
DO $$
DECLARE a jsonb; b jsonb;
BEGIN
  a := crm.intake_lead('{"channel":"manual","email":"treasurer.fm@gmail.com","name":"Treasurer","org":"Free Mail Client"}'::jsonb);
  UPDATE crm.businesses SET email = 'treasurer.fm@gmail.com' WHERE id = (a->>'business_id')::uuid;
  UPDATE crm.leads SET stage = 'won' WHERE id = (a->>'lead_id')::uuid;
  b := crm.intake_lead('{"channel":"ebook","email":"stranger.fm@gmail.com","name":"Stranger Danger"}'::jsonb);
  ASSERT b->>'business_id' <> a->>'business_id', 'gmail.com never links a business';
  ASSERT b->>'business_match' = 'created', 'R10: new business';
  ASSERT (SELECT name FROM crm.businesses WHERE id = (b->>'business_id')::uuid) = 'Stranger Danger', 'R10 naming kept';
  ASSERT b->>'lead_id' <> a->>'lead_id', 'not the won lead';
  -- shared site-builder hosts are not organization domains either
  ASSERT crm.org_domain('pgbwebsite.wixsite.com') IS NULL, 'wixsite subdomain';
  ASSERT crm.org_domain('gmail.com') IS NULL AND crm.org_domain('proton.me') IS NULL, 'free-mail';
  ASSERT crm.org_domain('greenwichhouse.org') = 'greenwichhouse.org', 'work domain';
  ASSERT crm.website_domain('http://www.interestfree.org') = 'interestfree.org', 'website parse';
  ASSERT crm.website_domain('www.arnoldsmith.org') = 'arnoldsmith.org', 'website without scheme';
  ASSERT crm.website_domain('not a site') IS NULL, 'garbage';
END $$;

-- intake_spoofed_org_name_cannot_reach_won_lead
DO $$
DECLARE a jsonb; b jsonb; c jsonb; d jsonb;
BEGIN
  a := crm.intake_lead('{"channel":"manual","email":"ed@spoofed-client.org","name":"Ed","org":"Spoofed Client"}'::jsonb);
  UPDATE crm.leads SET stage = 'won' WHERE id = (a->>'lead_id')::uuid;
  UPDATE crm.businesses SET website = 'https://spoofed-client.org' WHERE id = (a->>'business_id')::uuid;
  -- the client's org name from an outside domain
  b := crm.intake_lead('{"channel":"contact_form","email":"mallory@attacker.example","org":"Spoofed Client"}'::jsonb);
  ASSERT b->>'business_match' = 'name', 'org name match (unchanged)';
  ASSERT b->>'lead_id' <> a->>'lead_id' AND NOT (b->>'existing_client')::boolean, 'org name alone: no won lead';
  -- the client's org name from free-mail
  c := crm.intake_lead('{"channel":"ebook","email":"mallory.sc@gmail.com","org":"Spoofed Client"}'::jsonb);
  ASSERT c->>'lead_id' <> a->>'lead_id' AND NOT (c->>'existing_client')::boolean, 'free-mail + org name: no won lead';
  -- a second outside address on the same domain: the first one (linked by org name only) can't vouch for it
  d := crm.intake_lead('{"channel":"quiz","email":"m2@attacker.example","org":"Spoofed Client","payload":{"website":"https://spoofed-client.org"}}'::jsonb);
  ASSERT d->>'business_id' = a->>'business_id', 'org name still links the business';
  ASSERT d->>'lead_id' <> a->>'lead_id' AND NOT (d->>'existing_client')::boolean, 'org-name-linked colleagues: no won lead';
  -- a typed org that differs keeps its own business even at a known domain (flagged as a duplicate instead)
  d := crm.intake_lead('{"channel":"ebook","email":"new.person@spoofed-client.org","org":"Spoofed Client Youth Program"}'::jsonb);
  ASSERT d->>'business_id' <> a->>'business_id', 'differently named org keeps its own business';
  ASSERT d->>'lead_id' <> a->>'lead_id', 'and its own lead';
END $$;

-- intake_ignores_trash_and_restores_contact
DO $$
DECLARE a jsonb; b jsonb; c jsonb; e jsonb;
BEGIN
  a := crm.intake_lead('{"channel":"manual","email":"head@trashed-org.org","org":"Trashed Org"}'::jsonb);
  UPDATE crm.leads SET stage = 'won' WHERE id = (a->>'lead_id')::uuid;
  UPDATE crm.businesses SET deleted_at = now() WHERE id = (a->>'business_id')::uuid;
  UPDATE crm.contacts SET deleted_at = now() WHERE id = (a->>'contact_id')::uuid;
  UPDATE crm.leads SET deleted_at = now() WHERE id = (a->>'lead_id')::uuid;
  -- a colleague: the deleted business is neither name- nor domain-matched
  b := crm.intake_lead('{"channel":"ebook","email":"colleague@trashed-org.org"}'::jsonb);
  ASSERT b->>'business_id' <> a->>'business_id', 'business in Trash not domain-matched';
  c := crm.intake_lead('{"channel":"manual","email":"other@elsewhere-t.org","org":"Trashed Org"}'::jsonb);
  ASSERT c->>'business_id' <> a->>'business_id', 'business in Trash not name-matched';
  -- the deleted contact signs up again: restored, relinked, and the deleted won lead isn't reused
  e := crm.intake_lead('{"channel":"ebook","email":"head@trashed-org.org"}'::jsonb);
  ASSERT e->>'contact_id' = a->>'contact_id', 'same contact row';
  ASSERT (SELECT deleted_at FROM crm.contacts WHERE id = (a->>'contact_id')::uuid) IS NULL, 'contact restored';
  ASSERT e->>'business_id' <> a->>'business_id', 'relinked away from the deleted business';
  ASSERT (SELECT business_id FROM crm.contacts WHERE id = (a->>'contact_id')::uuid) = (e->>'business_id')::uuid, 'contact relinked';
  ASSERT e->>'lead_id' <> a->>'lead_id' AND (e->>'created_lead')::boolean, 'deleted won lead not reused';
  ASSERT (SELECT (metadata->>'restored_contact')::boolean FROM crm.lead_activities
          WHERE lead_id = (e->>'lead_id')::uuid AND activity_type = 'intake'), 'restore recorded';
END $$;
