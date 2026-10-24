-- Tests for soft delete and Trash (docs/migrations/2026-10-25_a_crm_soft_delete.sql).

-- Fixture: one organization with two people, two deals (one with a questionnaire), a client with a
-- service, a scope document, a room with an access link and a research note. Returns the ids.
create or replace function pg_temp.seed(p_tag text) returns jsonb language plpgsql as $$
declare b uuid; c1 uuid; c2 uuid; l1 uuid; l2 uuid; k uuid; i uuid; d uuid; e uuid; r uuid; t uuid; s uuid; a uuid;
begin
  insert into crm.businesses (name) values ('Org ' || p_tag) returning id into b;
  insert into crm.contacts (business_id, first_name, last_name, email) values (b, 'Ann', p_tag, 'ann-' || p_tag || '@org.test') returning id into c1;
  insert into crm.contacts (business_id, first_name, email) values (b, 'Bo', 'bo-' || p_tag || '@org.test') returning id into c2;
  insert into crm.leads (business_id, contact_id, stage) values (b, c1, 'qualification') returning id into l1;
  insert into crm.leads (business_id, contact_id, stage) values (b, c2, 'won') returning id into l2;
  insert into crm.lead_activities (lead_id, contact_id, activity_type, content, logged_by) values (l1, c1, 'note', 'hello ' || p_tag, 'brian');
  -- the invite's business_id is null on purpose: it belongs to the org only through its lead
  insert into crm.discovery_invites (lead_id, business_id, contact_id, project_title, status, questionnaire_snapshot)
    values (l1, null, c1, 'Questionnaire ' || p_tag, 'draft', '{}'::jsonb) returning id into i;
  insert into crm.clients (business_id, contact_id, lead_id) values (b, c2, l2) returning id into k;
  insert into crm.service_templates (name, billing_type) values ('Svc ' || p_tag, 'tm') returning id into t;
  insert into crm.client_services (client_id, service_template_id, status) values (k, t, 'pending_activation') returning id into s;
  insert into crm.tm_billing_entries (client_service_id, hours, description, logged_by) values (s, 1, 'work', 'brian');
  insert into rooms.engagements (business_id, lead_id, client_id, relationship, title) values (b, l2, k, 'client', 'Room ' || p_tag) returning id into e;
  insert into rooms.engagement_access (engagement_id, token_hash) values (e, md5(p_tag) || md5(p_tag || 'x')) returning id into a;
  insert into crm.scope_documents (business_id, lead_id, engagement_id, title) values (b, l1, e, 'Scope ' || p_tag) returning id into d;
  insert into crm.business_research (business_id, summary) values (b, 'Research ' || p_tag) returning id into r;
  return jsonb_build_object('b', b, 'c1', c1, 'c2', c2, 'l1', l1, 'l2', l2, 'i', i, 'k', k, 'd', d, 'e', e, 'r', r, 's', s, 'a', a);
end $$;

-- Expect fn to raise the given SQLSTATE.
create or replace function pg_temp.expect_code(p_sql text, p_code text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected SQLSTATE % from: %', p_code, p_sql;
exception when others then
  if sqlstate <> p_code then raise exception 'expected SQLSTATE %, got % (%) from: %', p_code, sqlstate, sqlerrm, p_sql; end if;
end $$;

-- soft_delete_business_cascades_with_one_stamp
DO $$
DECLARE x jsonb; res jsonb; ts timestamptz; n int;
BEGIN
  x := pg_temp.seed('cascade');
  res := crm.soft_delete('business', (x->>'b')::uuid, 'brian');
  ts := (res->>'deleted_at')::timestamptz;
  ASSERT res->>'deleted_by' = 'brian', 'deleted_by returned';
  ASSERT (res->'cascaded'->>'contacts')::int = 2, format('2 contacts cascaded, got %s', res->'cascaded');
  ASSERT (res->'cascaded'->>'leads')::int = 2, 'leads cascaded';
  ASSERT (res->'cascaded'->>'discovery_invites')::int = 1, 'invite found through its lead';
  ASSERT (res->'cascaded'->>'clients')::int = 1 AND (res->'cascaded'->>'scope_documents')::int = 1
     AND (res->'cascaded'->>'engagements')::int = 1 AND (res->'cascaded'->>'business_research')::int = 1, 'other children';
  SELECT (SELECT count(*) FROM crm.contacts WHERE business_id = (x->>'b')::uuid AND deleted_at = ts)
       + (SELECT count(*) FROM crm.leads WHERE business_id = (x->>'b')::uuid AND deleted_at = ts)
       + (SELECT count(*) FROM crm.discovery_invites WHERE id = (x->>'i')::uuid AND deleted_at = ts)
       + (SELECT count(*) FROM crm.clients WHERE id = (x->>'k')::uuid AND deleted_at = ts)
       + (SELECT count(*) FROM crm.scope_documents WHERE id = (x->>'d')::uuid AND deleted_at = ts)
       + (SELECT count(*) FROM rooms.engagements WHERE id = (x->>'e')::uuid AND deleted_at = ts)
       + (SELECT count(*) FROM crm.business_research WHERE id = (x->>'r')::uuid AND deleted_at = ts)
       + (SELECT count(*) FROM crm.businesses WHERE id = (x->>'b')::uuid AND deleted_at = ts AND deleted_by = 'brian')
    INTO n;
  ASSERT n = 10, format('every row carries the same stamp, got %s', n);
  -- the room is closed to clients at once
  ASSERT NOT rooms._portal_access_ok((x->>'a')::uuid, (x->>'e')::uuid), 'portal refuses a deleted room';
  -- the Trash shows the organization once, with its group
  SELECT count(*) INTO n FROM crm.trash_items() t WHERE t.business_id = (x->>'b')::uuid OR t.id = (x->>'b')::uuid;
  ASSERT n = 1, format('only the business is top-level, got %s', n);
  ASSERT (SELECT group_count FROM crm.trash_items() t WHERE t.id = (x->>'b')::uuid) = 9, 'group_count';
  ASSERT (SELECT days_left FROM crm.trash_items() t WHERE t.id = (x->>'b')::uuid) = 30, 'days_left';
  ASSERT (SELECT name FROM crm.trash_items() t WHERE t.id = (x->>'b')::uuid) = 'Org cascade', 'name';
  PERFORM pg_temp.expect_code(format($q$select crm.soft_delete('business', %L, 'brian')$q$, x->>'b'), 'TR003');
END $$;

-- restore_round_trip_keeps_separately_deleted_children_in_trash
DO $$
DECLARE x jsonb; res jsonb; n int;
BEGIN
  x := pg_temp.seed('restore');
  -- a person deleted on their own first keeps their own stamp
  PERFORM crm.soft_delete('contact', (x->>'c2')::uuid, 'jordan');
  PERFORM crm.soft_delete('business', (x->>'b')::uuid, 'brian');
  ASSERT (SELECT count(*) FROM crm.trash_items() t WHERE t.id IN ((x->>'b')::uuid, (x->>'c2')::uuid)) = 2, 'both top-level';
  -- a child cannot come back while its organization is in Trash
  PERFORM pg_temp.expect_code(format($q$select crm.restore_deleted('lead', %L)$q$, x->>'l1'), 'TR005');
  PERFORM pg_temp.expect_code(format($q$select crm.restore_deleted('contact', %L)$q$, x->>'c2'), 'TR005');
  PERFORM pg_temp.expect_code(format($q$select crm.restore_deleted('discovery_invite', %L)$q$, x->>'i'), 'TR005');

  res := crm.restore_deleted('business', (x->>'b')::uuid);
  ASSERT (res->'restored'->>'contacts')::int = 1, format('only the group contact restored, got %s', res);
  ASSERT (res->'restored'->>'discovery_invites')::int = 1, 'invite restored';
  SELECT count(*) INTO n FROM (
    SELECT deleted_at FROM crm.businesses WHERE id = (x->>'b')::uuid
    UNION ALL SELECT deleted_at FROM crm.leads WHERE business_id = (x->>'b')::uuid
    UNION ALL SELECT deleted_at FROM crm.contacts WHERE id = (x->>'c1')::uuid
    UNION ALL SELECT deleted_at FROM crm.discovery_invites WHERE id = (x->>'i')::uuid
    UNION ALL SELECT deleted_at FROM crm.clients WHERE id = (x->>'k')::uuid
    UNION ALL SELECT deleted_at FROM crm.scope_documents WHERE id = (x->>'d')::uuid
    UNION ALL SELECT deleted_at FROM rooms.engagements WHERE id = (x->>'e')::uuid
    UNION ALL SELECT deleted_at FROM crm.business_research WHERE id = (x->>'r')::uuid) q
  WHERE deleted_at IS NULL;
  ASSERT n = 9, format('group back, got %s', n);
  ASSERT (SELECT deleted_by FROM crm.businesses WHERE id = (x->>'b')::uuid) IS NULL, 'deleted_by cleared';
  ASSERT (SELECT deleted_by FROM crm.contacts WHERE id = (x->>'c2')::uuid) = 'jordan', 'separately deleted person stays in Trash';
  ASSERT rooms._portal_access_ok((x->>'a')::uuid, (x->>'e')::uuid), 'portal works again';
  res := crm.restore_deleted('contact', (x->>'c2')::uuid);
  ASSERT (SELECT deleted_at FROM crm.contacts WHERE id = (x->>'c2')::uuid) IS NULL, 'person restored on their own';
  PERFORM pg_temp.expect_code(format($q$select crm.restore_deleted('contact', %L)$q$, x->>'c2'), 'TR003');
END $$;

-- lead_delete_takes_its_invites_and_hides_its_timeline
DO $$
DECLARE x jsonb; res jsonb; n int;
BEGIN
  x := pg_temp.seed('lead');
  SELECT count(*) INTO n FROM crm.contact_timeline((x->>'c1')::uuid) WHERE kind = 'activity';
  ASSERT n >= 1, 'timeline has the note before';
  res := crm.soft_delete('lead', (x->>'l1')::uuid, 'brian');
  ASSERT (res->'cascaded'->>'discovery_invites')::int = 1, 'invite went with the lead';
  ASSERT (SELECT deleted_at FROM crm.discovery_invites WHERE id = (x->>'i')::uuid) = (res->>'deleted_at')::timestamptz, 'same stamp';
  ASSERT (SELECT deleted_at FROM crm.scope_documents WHERE id = (x->>'d')::uuid) IS NULL, 'scope stays';
  SELECT count(*) INTO n FROM crm.contact_timeline((x->>'c1')::uuid) WHERE kind = 'activity';
  ASSERT n = 0, format('deleted deal activity hidden from the timeline, got %s', n);
  ASSERT (SELECT count(*) FROM crm.trash_items() t WHERE t.id = (x->>'i')::uuid) = 0, 'invite is part of the lead group';
  ASSERT (SELECT group_count FROM crm.trash_items() t WHERE t.id = (x->>'l1')::uuid) = 1, 'lead group_count';
  PERFORM crm.restore_deleted('lead', (x->>'l1')::uuid);
  ASSERT (SELECT deleted_at FROM crm.discovery_invites WHERE id = (x->>'i')::uuid) IS NULL, 'invite back with the lead';
END $$;

-- active_stripe_services_block_delete
DO $$
DECLARE x jsonb; p jsonb;
BEGIN
  x := pg_temp.seed('stripe');
  UPDATE crm.client_services SET status = 'paused', stripe_subscription_id = 'sub_123', stripe_subscription_status = 'paused'
   WHERE id = (x->>'s')::uuid;
  PERFORM pg_temp.expect_code(format($q$select crm.soft_delete('business', %L, 'brian')$q$, x->>'b'), 'TR001');
  PERFORM pg_temp.expect_code(format($q$select crm.soft_delete('client', %L, 'brian')$q$, x->>'k'), 'TR001');
  ASSERT (SELECT deleted_at FROM crm.leads WHERE id = (x->>'l1')::uuid) IS NULL, 'nothing was deleted';
  p := crm.delete_preview('business', (x->>'b')::uuid);
  ASSERT p->'blocked'->>'reason' = 'stripe_services', format('preview shows the block: %s', p);
  ASSERT jsonb_array_length(p->'blocked'->'services') = 1, 'one service listed';
  -- a person at the org can still be deleted
  PERFORM crm.soft_delete('contact', (x->>'c1')::uuid, 'brian');
  -- once cancelled, the org can go
  UPDATE crm.client_services SET status = 'cancelled', stripe_subscription_status = 'canceled' WHERE id = (x->>'s')::uuid;
  ASSERT crm.delete_preview('business', (x->>'b')::uuid)->'blocked' = 'null'::jsonb, 'unblocked';
  PERFORM crm.soft_delete('business', (x->>'b')::uuid, 'brian');
  -- a one-time service without a subscription never blocks
  x := pg_temp.seed('onetime');
  UPDATE crm.client_services SET status = 'active' WHERE id = (x->>'s')::uuid;
  PERFORM crm.soft_delete('client', (x->>'k')::uuid, 'brian');
END $$;

-- delete_preview_counts
DO $$
DECLARE x jsonb; p jsonb;
BEGIN
  x := pg_temp.seed('preview');
  p := crm.delete_preview('business', (x->>'b')::uuid);
  ASSERT p->>'name' = 'Org preview' AND p->'deleted_at' = 'null'::jsonb AND p->'blocked' = 'null'::jsonb, format('header: %s', p);
  ASSERT p->'goes' @> '{"contacts":2,"leads":2,"clients":1,"discovery_invites":1,"scope_documents":1,"engagements":1,"business_research":1,"lead_activities":1,"client_services":1}'::jsonb,
         format('business goes: %s', p->'goes');
  p := crm.delete_preview('lead', (x->>'l1')::uuid);
  ASSERT p->'goes' @> '{"discovery_invites":1,"lead_activities":1}'::jsonb, format('lead goes: %s', p);
  ASSERT p->'stays' @> '{"scope_documents":1,"engagements":0,"clients":0}'::jsonb, format('lead stays: %s', p);
  p := crm.delete_preview('contact', (x->>'c2')::uuid);
  ASSERT p->'stays' @> '{"leads":1,"clients":1}'::jsonb, format('contact stays: %s', p);
  ASSERT p->>'name' = 'Bo', 'contact name';
  p := crm.delete_preview('engagement', (x->>'e')::uuid);
  ASSERT p->'goes' @> '{"access_links":1}'::jsonb AND p->'stays' @> '{"scope_documents":1}'::jsonb, format('engagement: %s', p);
  -- counts skip rows already in Trash
  PERFORM crm.soft_delete('contact', (x->>'c2')::uuid, 'brian');
  ASSERT (crm.delete_preview('business', (x->>'b')::uuid)->'goes'->>'contacts')::int = 1, 'deleted contact not counted';
  ASSERT crm.delete_preview('contact', (x->>'c2')::uuid)->>'deleted_at' IS NOT NULL, 'preview reports deleted_at';
  PERFORM pg_temp.expect_code($q$select crm.delete_preview('widget', gen_random_uuid())$q$, 'TR004');
  PERFORM pg_temp.expect_code($q$select crm.delete_preview('lead', gen_random_uuid())$q$, 'TR002');
END $$;

-- purge_respects_age_and_fk_order
DO $$
DECLARE x jsonb; y jsonb; res jsonb; n int;
BEGIN
  x := pg_temp.seed('purge');
  y := pg_temp.seed('young');
  PERFORM crm.soft_delete('business', (x->>'b')::uuid, 'brian');
  PERFORM crm.soft_delete('business', (y->>'b')::uuid, 'brian');
  -- age the first group past the retention window (keep one shared stamp)
  UPDATE crm.businesses SET deleted_at = deleted_at - interval '31 days' WHERE id = (x->>'b')::uuid;
  UPDATE crm.contacts SET deleted_at = deleted_at - interval '31 days' WHERE business_id = (x->>'b')::uuid;
  UPDATE crm.leads SET deleted_at = deleted_at - interval '31 days' WHERE business_id = (x->>'b')::uuid;
  UPDATE crm.discovery_invites SET deleted_at = deleted_at - interval '31 days' WHERE id = (x->>'i')::uuid;
  UPDATE crm.clients SET deleted_at = deleted_at - interval '31 days' WHERE business_id = (x->>'b')::uuid;
  UPDATE crm.scope_documents SET deleted_at = deleted_at - interval '31 days' WHERE business_id = (x->>'b')::uuid;
  UPDATE rooms.engagements SET deleted_at = deleted_at - interval '31 days' WHERE business_id = (x->>'b')::uuid;
  UPDATE crm.business_research SET deleted_at = deleted_at - interval '31 days' WHERE business_id = (x->>'b')::uuid;
  ASSERT (SELECT days_left FROM crm.trash_items() t WHERE t.id = (x->>'b')::uuid) = 0, 'aged item has 0 days left';

  res := crm.purge_trash();
  ASSERT jsonb_array_length(res->'skipped') = 0, format('nothing skipped: %s', res);
  ASSERT NOT EXISTS (SELECT 1 FROM crm.businesses WHERE id = (x->>'b')::uuid), 'old business purged';
  ASSERT NOT EXISTS (SELECT 1 FROM crm.contacts WHERE business_id = (x->>'b')::uuid OR id = (x->>'c1')::uuid), 'its people purged';
  ASSERT NOT EXISTS (SELECT 1 FROM crm.leads WHERE id = (x->>'l1')::uuid), 'leads purged';
  ASSERT NOT EXISTS (SELECT 1 FROM crm.discovery_invites WHERE id = (x->>'i')::uuid), 'invite purged';
  ASSERT NOT EXISTS (SELECT 1 FROM crm.client_services WHERE id = (x->>'s')::uuid), 'services purged';
  ASSERT NOT EXISTS (SELECT 1 FROM rooms.engagement_access WHERE id = (x->>'a')::uuid), 'room access purged';
  ASSERT NOT EXISTS (SELECT 1 FROM crm.lead_activities WHERE content = 'hello purge'), 'activities purged';
  ASSERT EXISTS (SELECT 1 FROM crm.businesses WHERE id = (y->>'b')::uuid), 'young group kept';
  ASSERT EXISTS (SELECT 1 FROM crm.leads WHERE id = (y->>'l1')::uuid), 'young leads kept';

  -- a live record under a deleted business blocks its purge instead of being deleted
  INSERT INTO crm.leads (business_id, stage) VALUES ((y->>'b')::uuid, 'new');
  UPDATE crm.businesses SET deleted_at = deleted_at - interval '1 day' WHERE id = (y->>'b')::uuid;
  res := crm.purge_trash('1 hour');
  ASSERT EXISTS (SELECT 1 FROM crm.businesses WHERE id = (y->>'b')::uuid), 'blocked business kept';
  ASSERT res->'skipped' @> jsonb_build_array(jsonb_build_object('kind', 'business', 'id', y->>'b', 'code', 'TR006')), format('skip reported: %s', res);
  SELECT count(*) INTO n FROM crm.leads WHERE business_id = (y->>'b')::uuid;
  ASSERT n = 3, format('the deleted leads and the live one are left, got %s', n);
  PERFORM pg_temp.expect_code('select crm.purge_trash(''-1 day'')', '22023');
END $$;

-- purge_deleted_one_item_now
DO $$
DECLARE x jsonb; res jsonb;
BEGIN
  x := pg_temp.seed('now');
  PERFORM pg_temp.expect_code(format($q$select crm.purge_deleted('scope_document', %L)$q$, x->>'d'), 'TR003');
  PERFORM crm.soft_delete('scope_document', (x->>'d')::uuid, 'brian');
  res := crm.purge_deleted('scope_document', (x->>'d')::uuid);
  ASSERT (res->>'purged')::boolean AND res->>'name' = 'Scope now', format('result: %s', res);
  ASSERT NOT EXISTS (SELECT 1 FROM crm.scope_documents WHERE id = (x->>'d')::uuid), 'scope purged';
  ASSERT EXISTS (SELECT 1 FROM rooms.engagements WHERE id = (x->>'e')::uuid), 'room stays';
  -- research briefs have no parent
  INSERT INTO public.research_briefs (topic, research_type) VALUES ('Brief now', 'tool');
  PERFORM crm.soft_delete('research_brief', (SELECT id FROM public.research_briefs WHERE topic = 'Brief now'), 'brian');
  ASSERT (SELECT kind FROM crm.trash_items() t WHERE t.name = 'Brief now') = 'research_brief', 'brief in Trash';
  PERFORM crm.purge_deleted('research_brief', (SELECT id FROM public.research_briefs WHERE topic = 'Brief now'));
  ASSERT NOT EXISTS (SELECT 1 FROM public.research_briefs WHERE topic = 'Brief now'), 'brief purged';
  -- an engagement purge takes the room's children
  PERFORM crm.soft_delete('engagement', (x->>'e')::uuid, 'brian');
  PERFORM crm.purge_deleted('engagement', (x->>'e')::uuid);
  ASSERT NOT EXISTS (SELECT 1 FROM rooms.engagement_access WHERE id = (x->>'a')::uuid), 'access gone';
END $$;

-- intake_restored_contact_is_left_alone
-- Stream A2's intake restores a contact in Trash on a new signup and relinks it away from a business
-- in Trash. Simulated here: restore and purge of the old business must not touch that contact.
DO $$
DECLARE x jsonb; other uuid;
BEGIN
  x := pg_temp.seed('relink');
  PERFORM crm.soft_delete('business', (x->>'b')::uuid, 'brian');
  INSERT INTO crm.businesses (name) VALUES ('Org relink new') RETURNING id INTO other;
  UPDATE crm.contacts SET business_id = other, deleted_at = null, deleted_by = null WHERE id = (x->>'c1')::uuid;
  ASSERT (SELECT group_count FROM crm.trash_items() t WHERE t.id = (x->>'b')::uuid) = 8, 'relinked contact left the group';
  PERFORM crm.restore_deleted('business', (x->>'b')::uuid);
  ASSERT (SELECT business_id FROM crm.contacts WHERE id = (x->>'c1')::uuid) = other, 'restore keeps the new link';
  ASSERT (SELECT deleted_at FROM crm.contacts WHERE id = (x->>'c2')::uuid) IS NULL, 'the rest of the group is back';
  PERFORM crm.soft_delete('business', (x->>'b')::uuid, 'brian');
  PERFORM crm.purge_deleted('business', (x->>'b')::uuid);
  ASSERT EXISTS (SELECT 1 FROM crm.contacts WHERE id = (x->>'c1')::uuid AND deleted_at IS NULL), 'purge keeps the relinked contact';
  ASSERT NOT EXISTS (SELECT 1 FROM crm.contacts WHERE id = (x->>'c2')::uuid), 'group contact purged';
END $$;

-- trash_functions_are_service_role_only
DO $$
BEGIN
  ASSERT NOT has_function_privilege('anon', 'crm.soft_delete(text, uuid, text)', 'execute'), 'anon cannot soft delete';
  ASSERT NOT has_function_privilege('authenticated', 'crm.purge_trash(interval)', 'execute'), 'authenticated cannot purge';
  ASSERT has_function_privilege('service_role', 'crm.trash_items(interval)', 'execute'), 'service_role lists Trash';
  ASSERT has_function_privilege('service_role', 'crm.restore_deleted(text, uuid)', 'execute'), 'service_role restores';
  ASSERT (SELECT count(*) FROM pg_policies WHERE policyname IN ('riley_read_leads', 'riley_read_businesses', 'riley_read_scope_documents')
           AND qual LIKE '%deleted_at IS NULL%') = 3, 'riley policies hide deleted rows';
END $$;
