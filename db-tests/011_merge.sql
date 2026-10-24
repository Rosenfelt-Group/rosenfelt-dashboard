-- Tests for crm.merge_businesses / merge_contacts / merge_leads and crm.duplicate_candidates
-- (docs/migrations/2026-10-25_b_crm_merge_dedupe.sql).

-- merge_businesses_moves_everything_then_deletes
DO $$
DECLARE a jsonb; b jsonb; r jsonb; ka uuid; kb uuid; inv uuid; res uuid; eng uuid; n int;
BEGIN
  a := crm.intake_lead('{"channel":"manual","email":"dana@harbor-mb.org","name":"Dana Whitfield","org":"Harbor Light Food Pantry"}'::jsonb);
  b := crm.intake_lead('{"channel":"manual","email":"dana.w@gmail.com","name":"Dana W","org":"Harbor Light Pantry"}'::jsonb);
  ka := (a->>'business_id')::uuid; kb := (b->>'business_id')::uuid;
  UPDATE crm.businesses SET website = 'https://harbor-mb.org', phone = NULL WHERE id = ka;
  UPDATE crm.businesses SET website = 'https://harbor2.example', phone = '555-0100' WHERE id = kb;
  INSERT INTO crm.discovery_invites (lead_id, business_id, contact_id, project_title, status)
    VALUES ((b->>'lead_id')::uuid, kb, (b->>'contact_id')::uuid, 'Pantry intake', 'draft') RETURNING id INTO inv;
  INSERT INTO crm.business_research (business_id, summary) VALUES (kb, 'research') RETURNING id INTO res;
  INSERT INTO rooms.engagements (business_id, lead_id, relationship, title)
    VALUES (kb, (b->>'lead_id')::uuid, 'prospect', 'Room') RETURNING id INTO eng;

  r := crm.merge_businesses(ka, kb, '{"website":"keep"}'::jsonb, 'brian');

  ASSERT r->>'kept_id' = ka::text AND r->>'merged_id' = kb::text, 'result ids';
  ASSERT NOT EXISTS (SELECT 1 FROM crm.businesses WHERE id = kb), 'merged business deleted';
  ASSERT (SELECT business_id FROM crm.leads WHERE id = (b->>'lead_id')::uuid) = ka, 'lead moved';
  ASSERT (SELECT business_id FROM crm.contacts WHERE id = (b->>'contact_id')::uuid) = ka, 'contact moved';
  ASSERT (SELECT business_id FROM crm.discovery_invites WHERE id = inv) = ka, 'invite moved, not dropped';
  ASSERT (SELECT business_id FROM crm.business_research WHERE id = res) = ka, 'research moved';
  ASSERT (SELECT business_id FROM rooms.engagements WHERE id = eng) = ka, 'room moved';
  ASSERT (r->'moved'->>'crm.leads.business_id')::int = 1 AND (r->'moved'->>'rooms.engagements.business_id')::int = 1, format('moved counts: %s', r->'moved');
  ASSERT (SELECT name FROM crm.businesses WHERE id = ka) = 'Harbor Light Food Pantry', 'name kept by default';
  ASSERT (SELECT website FROM crm.businesses WHERE id = ka) = 'https://harbor-mb.org', 'explicit keep';
  ASSERT (SELECT phone FROM crm.businesses WHERE id = ka) = '555-0100', 'empty field filled from merged';
  SELECT count(*) INTO n FROM crm.merge_redirects WHERE merged_id = kb AND kept_id = ka AND kind = 'business'
    AND snapshot->>'name' = 'Harbor Light Pantry';
  ASSERT n = 1, 'redirect with snapshot';
  SELECT count(*) INTO n FROM crm.lead_activities
    WHERE id = (r->>'note_activity_id')::uuid AND activity_type = 'system' AND logged_by = 'brian'
      AND content LIKE 'Merged from organization "Harbor Light Pantry"%';
  ASSERT n = 1, 'Merged from note';
END $$;

-- merge_businesses_scope_collision_unlinks
DO $$
DECLARE a jsonb; b jsonb; s1 uuid; s2 uuid; r jsonb;
BEGIN
  a := crm.intake_lead('{"channel":"manual","email":"x@scope-a.org","org":"Scope A"}'::jsonb);
  b := crm.intake_lead('{"channel":"manual","email":"x@scope-b.org","org":"Scope B"}'::jsonb);
  -- same lead linked from a scope on each business (inconsistent data the merge must survive)
  INSERT INTO crm.scope_documents (business_id, lead_id, title) VALUES ((a->>'business_id')::uuid, (a->>'lead_id')::uuid, 'A') RETURNING id INTO s1;
  INSERT INTO crm.scope_documents (business_id, lead_id, title) VALUES ((b->>'business_id')::uuid, (a->>'lead_id')::uuid, 'B') RETURNING id INTO s2;
  r := crm.merge_businesses((a->>'business_id')::uuid, (b->>'business_id')::uuid, '{}', 'jordan');
  ASSERT (r->'unlinked'->>'scope_documents_lead')::int = 1, format('unlinked: %s', r);
  ASSERT (SELECT lead_id FROM crm.scope_documents WHERE id = s2) IS NULL, 'colliding scope unlinked';
  ASSERT (SELECT business_id FROM crm.scope_documents WHERE id = s2) = (a->>'business_id')::uuid, 'scope kept, moved';
  ASSERT (SELECT lead_id FROM crm.scope_documents WHERE id = s1) = (a->>'lead_id')::uuid, 'kept scope untouched';
END $$;

-- merge_businesses_research_links_and_inputs (tables from 2026-10-25_c, when present)
DO $$
DECLARE a jsonb; b jsonb; ka uuid; kb uuid; br1 uuid; br2 uuid; note uuid; r jsonb; n int;
BEGIN
  IF to_regclass('crm.scope_research_inputs') IS NULL OR to_regclass('public.research_brief_links') IS NULL THEN
    RAISE NOTICE 'research tables absent; skipped'; RETURN;
  END IF;
  a := crm.intake_lead('{"channel":"manual","email":"r@research-a.org","org":"Research A"}'::jsonb);
  b := crm.intake_lead('{"channel":"manual","email":"r@research-b.org","org":"Research B"}'::jsonb);
  ka := (a->>'business_id')::uuid; kb := (b->>'business_id')::uuid;
  INSERT INTO public.research_briefs (topic, research_type) VALUES ('shared', 'business') RETURNING id INTO br1;
  INSERT INTO public.research_briefs (topic, research_type) VALUES ('only b', 'business') RETURNING id INTO br2;
  INSERT INTO public.research_brief_links (brief_id, business_id) VALUES (br1, ka), (br1, kb), (br2, kb);
  INSERT INTO crm.business_research (business_id, summary) VALUES (kb, 'b note') RETURNING id INTO note;
  INSERT INTO crm.scope_research_inputs (business_id, research_brief_id) VALUES (ka, br1), (kb, br1), (kb, br2);
  INSERT INTO crm.scope_research_inputs (business_id, business_research_id) VALUES (kb, note);
  r := crm.merge_businesses(ka, kb, '{}', 'brian');
  SELECT count(*) INTO n FROM public.research_brief_links WHERE business_id = ka;
  ASSERT n = 2, format('two brief links on the kept business, got %s', n);
  SELECT count(*) INTO n FROM crm.scope_research_inputs WHERE business_id = ka;
  ASSERT n = 3, format('inputs moved, shared brief once, got %s (%s)', n, r);
  ASSERT (SELECT business_id FROM crm.business_research WHERE id = note) = ka, 'research note moved';
  ASSERT (r->'unlinked'->>'research_brief_links_combined')::int = 1, format('combined reported: %s', r);
END $$;

-- merge_contacts_combines_email_and_links
DO $$
DECLARE a jsonb; b jsonb; ka uuid; kb uuid; msg uuid; r jsonb; n int; u uuid;
BEGIN
  a := crm.intake_lead('{"channel":"manual","email":"pat@pc-org.org","name":"Pat Lee","org":"PC Org"}'::jsonb);
  b := crm.intake_lead('{"channel":"manual","email":"pat.lee@pc-other.org","name":"Patricia Lee","org":"PC Org"}'::jsonb);
  ka := (a->>'contact_id')::uuid; kb := (b->>'contact_id')::uuid;
  UPDATE crm.contacts SET title = NULL WHERE id = ka;
  UPDATE crm.contacts SET title = 'Director' WHERE id = kb;
  INSERT INTO crm.email_messages (gmail_message_id, direction, source) VALUES ('m-merge-1', 'received', 'gmail_watch') RETURNING id INTO msg;
  INSERT INTO crm.email_message_links (email_message_id, contact_id) VALUES (msg, ka);
  INSERT INTO crm.email_message_links (email_message_id, contact_id, lead_id) VALUES (msg, kb, (b->>'lead_id')::uuid);
  INSERT INTO crm.lead_activities (contact_id, activity_type, logged_by, metadata)
    VALUES (ka, 'email_received', 'system', jsonb_build_object('email_message_id', msg)),
           (kb, 'email_received', 'system', jsonb_build_object('email_message_id', msg));
  INSERT INTO crm.unmatched_email_log (contact_email, suggested_contact_id) VALUES ('p@x.org', kb) RETURNING id INTO u;

  r := crm.merge_contacts(ka, kb, '{"email":"merge","first_name":"merge"}'::jsonb, 'someone_else');

  ASSERT NOT EXISTS (SELECT 1 FROM crm.contacts WHERE id = kb), 'merged contact deleted';
  ASSERT (SELECT email FROM crm.contacts WHERE id = ka) = 'pat.lee@pc-other.org', 'kept took the merged email (unique freed first)';
  ASSERT (SELECT first_name FROM crm.contacts WHERE id = ka) = 'Patricia', 'first name from merged';
  ASSERT (SELECT title FROM crm.contacts WHERE id = ka) = 'Director', 'blank title filled';
  ASSERT (SELECT contact_id FROM crm.leads WHERE id = (b->>'lead_id')::uuid) = ka, 'lead repointed';
  SELECT count(*) INTO n FROM crm.email_message_links WHERE email_message_id = msg;
  ASSERT n = 1, format('one combined link, got %s', n);
  ASSERT (SELECT lead_id FROM crm.email_message_links WHERE email_message_id = msg) = (b->>'lead_id')::uuid, 'lead link combined';
  SELECT count(*) INTO n FROM crm.lead_activities WHERE activity_type = 'email_received' AND metadata->>'email_message_id' = msg::text;
  ASSERT n = 1, 'duplicate email activity combined';
  ASSERT (SELECT suggested_contact_id FROM crm.unmatched_email_log WHERE id = u) = ka, 'unmatched log repointed';
  ASSERT (SELECT logged_by FROM crm.lead_activities WHERE id = (r->>'note_activity_id')::uuid) = 'system', 'unknown actor -> system';
  ASSERT (SELECT metadata->'merge'->>'merged_by' FROM crm.lead_activities WHERE id = (r->>'note_activity_id')::uuid) = 'someone_else', 'actor kept in metadata';
  ASSERT EXISTS (SELECT 1 FROM crm.merge_redirects WHERE merged_id = kb AND kept_id = ka AND kind = 'contact'), 'redirect';
END $$;

-- merge_leads_keeps_ebook_touchpoint_and_attribution
DO $$
DECLARE a jsonb; b jsonb; won uuid; eb uuid; inv uuid; s1 uuid; s2 uuid; r jsonb; n int; ok boolean;
BEGIN
  a := crm.intake_lead('{"channel":"manual","email":"chair@ml-client.org","name":"Chair","org":"ML Client"}'::jsonb);
  won := (a->>'lead_id')::uuid;
  UPDATE crm.leads SET stage = 'won', estimated_value = NULL WHERE id = won;
  -- an ebook lead opened next to the won one (the 2026-10-23 case)
  INSERT INTO crm.leads (business_id, contact_id, stage, source, utm_source, landing_path, estimated_value)
    VALUES ((a->>'business_id')::uuid, (a->>'contact_id')::uuid, 'new', 'ebook', 'newsletter', '/ebook', 250) RETURNING id INTO eb;
  INSERT INTO crm.lead_activities (lead_id, contact_id, activity_type, content, logged_by, metadata)
    VALUES (eb, (a->>'contact_id')::uuid, 'intake', 'Downloaded eBook', 'system', '{"channel":"ebook"}');
  INSERT INTO crm.discovery_invites (lead_id, business_id, project_title, status) VALUES (eb, (a->>'business_id')::uuid, 'X', 'draft') RETURNING id INTO inv;
  INSERT INTO crm.scope_documents (business_id, lead_id, title) VALUES ((a->>'business_id')::uuid, won, 'won scope') RETURNING id INTO s1;
  INSERT INTO crm.scope_documents (business_id, lead_id, title) VALUES ((a->>'business_id')::uuid, eb, 'ebook scope') RETURNING id INTO s2;

  -- attribution from an ebook signup can't be moved onto the surviving deal
  ok := false;
  BEGIN
    PERFORM crm.merge_leads(won, eb, '{"utm_source":"merge"}'::jsonb, 'brian');
  EXCEPTION WHEN SQLSTATE 'MG005' THEN ok := true;
  END;
  ASSERT ok, 'MG005 for ebook attribution';

  r := crm.merge_leads(won, eb, '{}'::jsonb, 'brian');

  ASSERT NOT EXISTS (SELECT 1 FROM crm.leads WHERE id = eb), 'merged lead deleted';
  ASSERT (SELECT lead_id FROM crm.discovery_invites WHERE id = inv) = won, 'invite repointed before delete (no cascade)';
  ASSERT (SELECT stage FROM crm.leads WHERE id = won) = 'won', 'stage kept';
  ASSERT (SELECT utm_source FROM crm.leads WHERE id = won) IS NULL, 'won lead attribution untouched';
  ASSERT (SELECT source FROM crm.leads WHERE id = won) = 'manual', 'source untouched';
  ASSERT (SELECT estimated_value FROM crm.leads WHERE id = won) = 250, 'blank value filled';
  SELECT count(*) INTO n FROM crm.lead_activities
    WHERE lead_id = won AND activity_type = 'intake' AND content = 'Downloaded eBook'
      AND metadata->>'merged_from_lead_id' = eb::text AND metadata->'attribution'->>'utm_source' = 'newsletter'
      AND metadata->'attribution'->>'source' = 'ebook';
  ASSERT n = 1, 'intake kept as touchpoint with attribution';
  ASSERT (SELECT lead_id FROM crm.scope_documents WHERE id = s2) IS NULL, 'colliding scope unlinked';
  ASSERT (SELECT lead_id FROM crm.scope_documents WHERE id = s1) = won, 'kept scope untouched';
  ASSERT (r->'unlinked'->>'scope_documents_lead')::int = 1, 'unlinked reported';
  ASSERT (SELECT content FROM crm.lead_activities WHERE id = (r->>'note_activity_id')::uuid) LIKE 'Merged from ebook deal%', 'note';
  ASSERT EXISTS (SELECT 1 FROM crm.merge_redirects WHERE merged_id = eb AND kept_id = won AND kind = 'lead'), 'redirect';
END $$;

-- merge_leads_manual_lead_gets_touchpoint_and_stage_choice
DO $$
DECLARE a jsonb; l2 uuid; r jsonb;
BEGIN
  a := crm.intake_lead('{"channel":"manual","email":"m@ml2.org","org":"ML2"}'::jsonb);
  INSERT INTO crm.leads (business_id, contact_id, stage, source) VALUES ((a->>'business_id')::uuid, (a->>'contact_id')::uuid, 'proposal', 'referral') RETURNING id INTO l2;
  r := crm.merge_leads((a->>'lead_id')::uuid, l2, '{"stage":"merge","source":"merge"}'::jsonb, 'brian');
  ASSERT (SELECT stage FROM crm.leads WHERE id = (a->>'lead_id')::uuid) = 'proposal', 'stage from merged';
  ASSERT (SELECT source FROM crm.leads WHERE id = (a->>'lead_id')::uuid) = 'referral', 'non-signup attribution may move when chosen';
  ASSERT EXISTS (SELECT 1 FROM crm.lead_activities WHERE lead_id = (a->>'lead_id')::uuid AND activity_type = 'intake'
                 AND (metadata->>'touchpoint')::boolean AND metadata->>'merged_from_lead_id' = l2::text), 'touchpoint row added';
  ASSERT EXISTS (SELECT 1 FROM crm.lead_activities WHERE lead_id = (a->>'lead_id')::uuid AND activity_type = 'stage_change'), 'stage change logged';
END $$;

-- merge_refusals
DO $$
DECLARE a jsonb; b jsonb; got text;
BEGIN
  a := crm.intake_lead('{"channel":"manual","email":"r1@refuse-a.org","org":"Refuse A"}'::jsonb);
  b := crm.intake_lead('{"channel":"manual","email":"r2@refuse-b.org","org":"Refuse B"}'::jsonb);
  BEGIN PERFORM crm.merge_leads((a->>'lead_id')::uuid, (b->>'lead_id')::uuid, '{}', 'brian'); got := 'none';
  EXCEPTION WHEN others THEN got := SQLSTATE; END;
  ASSERT got = 'MG004', format('different organizations -> MG004, got %s', got);
  BEGIN PERFORM crm.merge_businesses((a->>'business_id')::uuid, (a->>'business_id')::uuid, '{}', 'brian'); got := 'none';
  EXCEPTION WHEN others THEN got := SQLSTATE; END;
  ASSERT got = 'MG002', format('same id -> MG002, got %s', got);
  BEGIN PERFORM crm.merge_businesses((a->>'business_id')::uuid, gen_random_uuid(), '{}', 'brian'); got := 'none';
  EXCEPTION WHEN others THEN got := SQLSTATE; END;
  ASSERT got = 'MG001', format('missing -> MG001, got %s', got);
  BEGIN PERFORM crm.merge_businesses((a->>'business_id')::uuid, (b->>'business_id')::uuid, '{"bogus":"merge"}', 'brian'); got := 'none';
  EXCEPTION WHEN others THEN got := SQLSTATE; END;
  ASSERT got = 'MG005', format('unknown field -> MG005, got %s', got);
  UPDATE crm.businesses SET deleted_at = now() WHERE id = (b->>'business_id')::uuid;
  BEGIN PERFORM crm.merge_businesses((a->>'business_id')::uuid, (b->>'business_id')::uuid, '{}', 'brian'); got := 'none';
  EXCEPTION WHEN others THEN got := SQLSTATE; END;
  ASSERT got = 'MG003', format('deleted -> MG003, got %s', got);
  ASSERT EXISTS (SELECT 1 FROM crm.businesses WHERE id = (b->>'business_id')::uuid), 'nothing changed';
END $$;

-- merge_repoints_unknown_fk_tables_too (a cascading FK added later must not lose rows)
DO $$
DECLARE a jsonb; l2 uuid; n int;
BEGIN
  CREATE TABLE crm.zz_merge_probe (id serial primary key, lead_id uuid REFERENCES crm.leads(id) ON DELETE CASCADE);
  a := crm.intake_lead('{"channel":"manual","email":"p@probe.org","org":"Probe"}'::jsonb);
  INSERT INTO crm.leads (business_id, stage, source) VALUES ((a->>'business_id')::uuid, 'new', 'manual') RETURNING id INTO l2;
  INSERT INTO crm.zz_merge_probe (lead_id) VALUES (l2), (l2);
  PERFORM crm.merge_leads((a->>'lead_id')::uuid, l2, '{}', 'brian');
  SELECT count(*) INTO n FROM crm.zz_merge_probe WHERE lead_id = (a->>'lead_id')::uuid;
  ASSERT n = 2, format('probe rows repointed, got %s', n);
  DROP TABLE crm.zz_merge_probe;
END $$;

-- merge_redirect_chains_flatten
DO $$
DECLARE a jsonb; b jsonb; c jsonb;
BEGIN
  a := crm.intake_lead('{"channel":"manual","email":"c@chain-a.org","org":"Chain A"}'::jsonb);
  b := crm.intake_lead('{"channel":"manual","email":"c@chain-b.org","org":"Chain B"}'::jsonb);
  c := crm.intake_lead('{"channel":"manual","email":"c@chain-c.org","org":"Chain C"}'::jsonb);
  PERFORM crm.merge_businesses((b->>'business_id')::uuid, (a->>'business_id')::uuid, '{}', 'brian');
  PERFORM crm.merge_businesses((c->>'business_id')::uuid, (b->>'business_id')::uuid, '{}', 'brian');
  ASSERT (SELECT kept_id FROM crm.merge_redirects WHERE merged_id = (a->>'business_id')::uuid) = (c->>'business_id')::uuid, 'A -> C';
  ASSERT (SELECT kept_id FROM crm.merge_redirects WHERE merged_id = (b->>'business_id')::uuid) = (c->>'business_id')::uuid, 'B -> C';
END $$;

-- merge_preview_shape
DO $$
DECLARE a jsonb; eb uuid; p jsonb;
BEGIN
  a := crm.intake_lead('{"channel":"manual","email":"pv@preview.org","org":"Preview"}'::jsonb);
  INSERT INTO crm.leads (business_id, stage, source) VALUES ((a->>'business_id')::uuid, 'new', 'quiz') RETURNING id INTO eb;
  INSERT INTO crm.lead_activities (lead_id, activity_type, logged_by) VALUES (eb, 'intake', 'system'), (eb, 'note', 'brian');
  p := crm.merge_preview('lead', (a->>'lead_id')::uuid, eb);
  ASSERT (p->'moves'->>'crm.lead_activities.lead_id')::int = 2, format('moves: %s', p->'moves');
  ASSERT jsonb_array_length(p->'fields') = cardinality(crm.merge_fields('lead')), 'one entry per field';
  ASSERT (SELECT (f->>'locked')::boolean FROM jsonb_array_elements(p->'fields') f WHERE f->>'field' = 'utm_source'), 'quiz attribution locked';
  ASSERT jsonb_array_length(p->'warnings') = 1, 'quiz warning';
  ASSERT EXISTS (SELECT 1 FROM crm.leads WHERE id = eb), 'preview changes nothing';
END $$;

-- duplicate_candidates_and_dismissals
DO $$
DECLARE a jsonb; b jsonb; c jsonb; d jsonb; n int; r record; ab uuid; bb uuid;
BEGIN
  -- same work domain via a contact, plus a similar name
  a := crm.intake_lead('{"channel":"manual","email":"x@dupe-domain.org","org":"Riverbend Literacy Council"}'::jsonb);
  b := crm.intake_lead('{"channel":"manual","email":"y@dupe-domain.org","org":"Riverbend Literacy Council Inc."}'::jsonb);
  ab := (a->>'business_id')::uuid; bb := (b->>'business_id')::uuid;
  ASSERT ab <> bb, 'setup: two businesses';
  UPDATE crm.businesses SET created_at = now() + interval '1 minute' WHERE id = bb;  -- one transaction: make b newer
  SELECT * INTO r FROM crm.duplicate_candidates() x
    WHERE x.kind = 'business' AND ab IN (x.keep_id, x.merge_id) AND bb IN (x.keep_id, x.merge_id);
  ASSERT r.kind IS NOT NULL, 'business pair found';
  ASSERT 'same_domain' = ANY (r.reasons), format('reasons %s', r.reasons);
  ASSERT 'similar_name' = ANY (r.reasons), format('reasons %s', r.reasons);
  ASSERT r.keep_id = ab, 'older record suggested as keep';

  -- free-mail domains never pair businesses
  c := crm.intake_lead('{"channel":"manual","email":"one@gmail.com","org":"Gmail Org One"}'::jsonb);
  d := crm.intake_lead('{"channel":"manual","email":"two@gmail.com","org":"Totally Different Group"}'::jsonb);
  SELECT count(*) INTO n FROM crm.duplicate_candidates() x
    WHERE x.kind = 'business' AND (c->>'business_id')::uuid IN (x.keep_id, x.merge_id) AND (d->>'business_id')::uuid IN (x.keep_id, x.merge_id);
  ASSERT n = 0, 'gmail.com is not a shared organization domain';

  -- one mailbox spelled two ways
  c := crm.intake_lead('{"channel":"manual","email":"jane.doe@gmail.com","name":"Jane Doe"}'::jsonb);
  d := crm.intake_lead('{"channel":"manual","email":"janedoe+news@gmail.com","name":"J D"}'::jsonb);
  SELECT count(*) INTO n FROM crm.duplicate_candidates() x
    WHERE x.kind = 'contact' AND 'same_email' = ANY (x.reasons)
      AND (c->>'contact_id')::uuid IN (x.keep_id, x.merge_id) AND (d->>'contact_id')::uuid IN (x.keep_id, x.merge_id);
  ASSERT n = 1, 'same mailbox contacts paired';

  -- two open deals at one business
  INSERT INTO crm.leads (business_id, stage, source) VALUES (ab, 'qualification', 'referral');
  SELECT count(*) INTO n FROM crm.duplicate_candidates() x WHERE x.kind = 'lead' AND 'two_open_deals' = ANY (x.reasons)
    AND x.keep_id = (a->>'lead_id')::uuid;
  ASSERT n = 1, 'two open deals flagged, older kept';

  -- dismissal hides the pair (in either order); Trash rows are ignored
  PERFORM crm.dismiss_duplicate('business', bb, ab, 'brian', 'different chapters');
  SELECT count(*) INTO n FROM crm.duplicate_candidates() x WHERE x.kind = 'business' AND ab IN (x.keep_id, x.merge_id) AND bb IN (x.keep_id, x.merge_id);
  ASSERT n = 0, 'dismissed pair hidden';
  SELECT count(*) INTO n FROM crm.duplicate_candidates(true) x WHERE x.kind = 'business' AND x.dismissed AND ab IN (x.keep_id, x.merge_id);
  ASSERT n = 1, 'include_dismissed shows it';
  UPDATE crm.contacts SET deleted_at = now() WHERE id = (d->>'contact_id')::uuid;
  SELECT count(*) INTO n FROM crm.duplicate_candidates() x WHERE (d->>'contact_id')::uuid IN (x.keep_id, x.merge_id);
  ASSERT n = 0, 'Trash ignored';
END $$;

-- open_deal_at_client_flagged
DO $$
DECLARE a jsonb; o uuid; n int;
BEGIN
  a := crm.intake_lead('{"channel":"manual","email":"z@odc.org","org":"ODC"}'::jsonb);
  UPDATE crm.leads SET stage = 'won' WHERE id = (a->>'lead_id')::uuid;
  INSERT INTO crm.leads (business_id, stage, source) VALUES ((a->>'business_id')::uuid, 'new', 'ebook') RETURNING id INTO o;
  SELECT count(*) INTO n FROM crm.duplicate_candidates() x
    WHERE x.kind = 'lead' AND 'open_deal_at_client' = ANY (x.reasons) AND x.keep_id = (a->>'lead_id')::uuid AND x.merge_id = o;
  ASSERT n = 1, 'ebook deal at a client flagged, won deal kept';
END $$;

-- merge_functions_are_service_role_only
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['crm.merge_businesses(uuid,uuid,jsonb,text)','crm.merge_contacts(uuid,uuid,jsonb,text)',
    'crm.merge_leads(uuid,uuid,jsonb,text)','crm.merge_preview(text,uuid,uuid)','crm.duplicate_candidates(boolean)',
    'crm.dismiss_duplicate(text,uuid,uuid,text,text)','crm.merge_repoint(regclass,uuid,uuid)','crm.intake_lead(jsonb)'] LOOP
    ASSERT NOT has_function_privilege('anon', f, 'execute'), f || ' must not be executable by anon';
    ASSERT NOT has_function_privilege('authenticated', f, 'execute'), f || ' must not be executable by authenticated';
  END LOOP;
  ASSERT has_function_privilege('service_role', 'crm.merge_leads(uuid,uuid,jsonb,text)', 'execute'), 'service_role can merge';
  ASSERT NOT has_table_privilege('anon', 'crm.merge_redirects', 'select'), 'redirects hidden from anon';
END $$;
