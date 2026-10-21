-- Tests for 2026-10-22_crm_scope_documents.sql (scope documents + versions).
-- Helper-free: each block builds its own business/document.

-- one_current_version_per_document
DO $$
DECLARE b uuid; d uuid; ok boolean := false;
BEGIN
  INSERT INTO crm.businesses (name) VALUES ('Scope Test One') RETURNING id INTO b;
  INSERT INTO crm.scope_documents (business_id, title) VALUES (b, 'S1') RETURNING id INTO d;
  INSERT INTO crm.scope_versions (scope_document_id, version_no, sections, status, source)
    VALUES (d, 1, '[]', 'current', 'brian');
  BEGIN
    INSERT INTO crm.scope_versions (scope_document_id, version_no, sections, status, source)
      VALUES (d, 2, '[]', 'current', 'brian');
  EXCEPTION WHEN unique_violation THEN ok := true; END;
  ASSERT ok, 'second current version must violate partial unique index';
  -- version_no unique per document
  ok := false;
  BEGIN
    INSERT INTO crm.scope_versions (scope_document_id, version_no, sections, status, source)
      VALUES (d, 1, '[]', 'proposed', 'riley');
  EXCEPTION WHEN unique_violation THEN ok := true; END;
  ASSERT ok, 'duplicate version_no must be rejected';
END $$;

-- accept_supersedes_previous
DO $$
DECLARE b uuid; d uuid; v1 uuid; v2 uuid;
BEGIN
  INSERT INTO crm.businesses (name) VALUES ('Scope Test Two') RETURNING id INTO b;
  INSERT INTO crm.scope_documents (business_id, title) VALUES (b, 'S2') RETURNING id INTO d;
  INSERT INTO crm.scope_versions (scope_document_id, version_no, sections, status, source)
    VALUES (d, 1, '[]', 'current', 'brief') RETURNING id INTO v1;
  UPDATE crm.scope_documents SET current_version_id = v1 WHERE id = d;
  INSERT INTO crm.scope_versions (scope_document_id, version_no, sections, status, source, based_on_version_id)
    VALUES (d, 2, '[]', 'proposed', 'riley', v1) RETURNING id INTO v2;
  PERFORM crm.accept_scope_version(v2);
  ASSERT (SELECT status FROM crm.scope_versions WHERE id = v1) = 'superseded', 'v1 superseded';
  ASSERT (SELECT status FROM crm.scope_versions WHERE id = v2) = 'current', 'v2 current';
  ASSERT (SELECT decided_at IS NOT NULL FROM crm.scope_versions WHERE id = v2), 'decided_at set';
  ASSERT (SELECT current_version_id FROM crm.scope_documents WHERE id = d) = v2, 'doc points at v2';
END $$;

-- accept_refuses_stale_proposal
DO $$
DECLARE b uuid; d uuid; v1 uuid; v2 uuid; v3 uuid; msg text;
BEGIN
  INSERT INTO crm.businesses (name) VALUES ('Scope Test Three') RETURNING id INTO b;
  INSERT INTO crm.scope_documents (business_id, title) VALUES (b, 'S3') RETURNING id INTO d;
  INSERT INTO crm.scope_versions (scope_document_id, version_no, sections, status, source)
    VALUES (d, 1, '[]', 'current', 'brief') RETURNING id INTO v1;
  UPDATE crm.scope_documents SET current_version_id = v1 WHERE id = d;
  -- two proposals based on v1; accepting one makes the other stale
  INSERT INTO crm.scope_versions (scope_document_id, version_no, sections, status, source, based_on_version_id)
    VALUES (d, 2, '[]', 'proposed', 'riley', v1) RETURNING id INTO v2;
  INSERT INTO crm.scope_versions (scope_document_id, version_no, sections, status, source, based_on_version_id)
    VALUES (d, 3, '[]', 'proposed', 'riley', v1) RETURNING id INTO v3;
  PERFORM crm.accept_scope_version(v2);
  BEGIN
    PERFORM crm.accept_scope_version(v3);
    ASSERT false, 'stale accept should have raised';
  EXCEPTION WHEN OTHERS THEN msg := SQLSTATE || ' ' || SQLERRM; END;
  ASSERT msg LIKE 'SC001 stale proposal%', 'stable message, got: ' || coalesce(msg, 'null');
  ASSERT (SELECT status FROM crm.scope_versions WHERE id = v3) = 'proposed', 'v3 untouched';
  ASSERT (SELECT current_version_id FROM crm.scope_documents WHERE id = d) = v2, 'v2 still current';
END $$;

-- sections_shape_check
DO $$
DECLARE b uuid; d uuid; ok boolean := false;
BEGIN
  INSERT INTO crm.businesses (name) VALUES ('Scope Test Four') RETURNING id INTO b;
  INSERT INTO crm.scope_documents (business_id, title) VALUES (b, 'S4') RETURNING id INTO d;
  BEGIN
    INSERT INTO crm.scope_versions (scope_document_id, version_no, sections, status, source)
      VALUES (d, 1, '{"key":"a"}', 'proposed', 'riley');
  EXCEPTION WHEN check_violation THEN ok := true; END;
  ASSERT ok, 'object (non-array) sections must be rejected';
END $$;

-- section_element_shape_enforced
DO $$
DECLARE b uuid; d uuid; bad jsonb; n int := 0;
BEGIN
  INSERT INTO crm.businesses (name) VALUES ('Scope Test Five') RETURNING id INTO b;
  INSERT INTO crm.scope_documents (business_id, title) VALUES (b, 'S5') RETURNING id INTO d;
  FOREACH bad IN ARRAY ARRAY[
    '[{"key":"a","title":"A","body_md":"x"}]'::jsonb,                                   -- missing visibility
    '[{"key":"a","title":"A","visibility":"client"}]'::jsonb,                           -- missing body_md
    '[{"key":"a","title":"A","body_md":"x","visibility":"public"}]'::jsonb,             -- bad visibility
    '["just a string"]'::jsonb,                                                         -- non-object element
    '[{"key":"a","title":"A","body_md":"x","visibility":"client"},{"key":"b"}]'::jsonb, -- one good, one bad
    '[{"key":"a","title":"A","body_md":"x","visibility":null}]'::jsonb,                 -- null visibility
    '[{"key":"a","title":5,"body_md":"x","visibility":"client"}]'::jsonb,               -- numeric title
    '[{"key":"","title":"A","body_md":"x","visibility":"client"}]'::jsonb               -- empty key
  ] LOOP
    BEGIN
      INSERT INTO crm.scope_versions (scope_document_id, version_no, sections, status, source)
        VALUES (d, 100 + n, bad, 'proposed', 'riley');
      ASSERT false, 'should have been rejected: ' || bad::text;
    EXCEPTION WHEN check_violation THEN n := n + 1; END;
  END LOOP;
  ASSERT n = 8, 'all eight malformed shapes rejected';
  INSERT INTO crm.scope_versions (scope_document_id, version_no, sections, status, source)
    VALUES (d, 1, '[{"key":"a","title":"A","body_md":"x","visibility":"client"},{"key":"b","title":"B","body_md":"","visibility":"internal"}]', 'proposed', 'riley');
END $$;

-- create_current_supersedes_previous
DO $$
DECLARE b uuid; d uuid; v1 uuid; v2 uuid; v3 uuid;
BEGIN
  INSERT INTO crm.businesses (name) VALUES ('Scope Test Six') RETURNING id INTO b;
  INSERT INTO crm.scope_documents (business_id, title) VALUES (b, 'S6') RETURNING id INTO d;
  v1 := crm.create_scope_version_current(d, '[]', 'brief', 'system', 'initial', NULL);
  ASSERT (SELECT version_no FROM crm.scope_versions WHERE id = v1) = 1, 'first is v1';
  ASSERT (SELECT current_version_id FROM crm.scope_documents WHERE id = d) = v1, 'doc -> v1';
  v2 := crm.create_scope_version_current(d, '[{"key":"a","title":"A","body_md":"x","visibility":"internal"}]', 'brian', 'brian', 'edit', v1);
  ASSERT (SELECT version_no FROM crm.scope_versions WHERE id = v2) = 2, 'second is v2';
  ASSERT (SELECT status FROM crm.scope_versions WHERE id = v1) = 'superseded', 'v1 superseded';
  ASSERT (SELECT status FROM crm.scope_versions WHERE id = v2) = 'current', 'v2 current';
  ASSERT (SELECT based_on_version_id FROM crm.scope_versions WHERE id = v2) = v1, 'v2 based on v1';
  ASSERT (SELECT change_note FROM crm.scope_versions WHERE id = v2) = 'edit', 'change note';
  ASSERT (SELECT current_version_id FROM crm.scope_documents WHERE id = d) = v2, 'doc -> v2';
  v3 := crm.create_scope_version_current(d, '[]', 'brian', 'brian', NULL, v2);
  ASSERT (SELECT count(*) FROM crm.scope_versions WHERE scope_document_id = d AND status = 'current') = 1, 'exactly one current';
END $$;

-- accept_refuses_non_proposed
DO $$
DECLARE b uuid; d uuid; v1 uuid; v2 uuid; msg text; s text;
BEGIN
  INSERT INTO crm.businesses (name) VALUES ('Scope Test Seven') RETURNING id INTO b;
  INSERT INTO crm.scope_documents (business_id, title) VALUES (b, 'S7') RETURNING id INTO d;
  v1 := crm.create_scope_version_current(d, '[]', 'brief', 'system', NULL, NULL);
  INSERT INTO crm.scope_versions (scope_document_id, version_no, sections, status, source, based_on_version_id)
    VALUES (d, 2, '[]', 'rejected', 'riley', v1) RETURNING id INTO v2;
  FOREACH s IN ARRAY ARRAY['current', 'rejected'] LOOP
    msg := NULL;
    BEGIN
      PERFORM crm.accept_scope_version(CASE s WHEN 'current' THEN v1 ELSE v2 END);
    EXCEPTION WHEN OTHERS THEN msg := SQLSTATE || ' ' || SQLERRM; END;
    ASSERT msg LIKE 'SC002 not proposed%', s || ' version must be refused, got: ' || coalesce(msg, 'null');
  END LOOP;
  msg := NULL;
  BEGIN
    PERFORM crm.accept_scope_version(gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN msg := SQLSTATE || ' ' || SQLERRM; END;
  ASSERT msg LIKE 'SC003 %', 'unknown version refused with SC003, got: ' || coalesce(msg, 'null');
END $$;

-- first_version_with_null_base_accepted
DO $$
DECLARE b uuid; d uuid; v1 uuid; v2 uuid; msg text;
BEGIN
  INSERT INTO crm.businesses (name) VALUES ('Scope Test Eight') RETURNING id INTO b;
  INSERT INTO crm.scope_documents (business_id, title) VALUES (b, 'S8') RETURNING id INTO d;
  INSERT INTO crm.scope_versions (scope_document_id, version_no, sections, status, source)
    VALUES (d, 1, '[]', 'proposed', 'riley') RETURNING id INTO v1;
  PERFORM crm.accept_scope_version(v1);
  ASSERT (SELECT status FROM crm.scope_versions WHERE id = v1) = 'current', 'first version accepted';
  ASSERT (SELECT current_version_id FROM crm.scope_documents WHERE id = d) = v1, 'doc -> v1';
  -- a NULL base is NOT allowed once a current version exists
  INSERT INTO crm.scope_versions (scope_document_id, version_no, sections, status, source)
    VALUES (d, 2, '[]', 'proposed', 'riley') RETURNING id INTO v2;
  BEGIN
    PERFORM crm.accept_scope_version(v2);
  EXCEPTION WHEN OTHERS THEN msg := SQLSTATE || ' ' || SQLERRM; END;
  ASSERT msg LIKE 'SC001 stale proposal%', 'null base refused when a current exists, got: ' || coalesce(msg, 'null');
END $$;

-- riley_grants_applied_when_role_exists
-- The harness applies migrations BEFORE tests, when riley_app does not exist (Task 10 creates it in prod),
-- so the migration's conditional DO block is a no-op here. The migration puts the grants in
-- crm._apply_riley_scope_grants(), which the DO block calls only IF the role exists. This test creates a
-- throwaway riley_app and calls that same function, exercising the exact grant code path.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'riley_app') THEN
    CREATE ROLE riley_app NOLOGIN;
  END IF;
  PERFORM crm._apply_riley_scope_grants();
  ASSERT has_table_privilege('riley_app', 'crm.scope_documents', 'SELECT')
     AND has_table_privilege('riley_app', 'crm.scope_versions', 'SELECT'), 'riley SELECT';
  ASSERT NOT has_table_privilege('riley_app', 'crm.scope_documents', 'INSERT, UPDATE, DELETE')
     AND NOT has_table_privilege('riley_app', 'crm.scope_versions', 'INSERT')
     AND NOT has_table_privilege('riley_app', 'crm.scope_versions', 'UPDATE')
     AND NOT has_table_privilege('riley_app', 'crm.scope_versions', 'DELETE'), 'riley has no write grants';
  ASSERT has_function_privilege('riley_app', 'crm.create_initial_scope_from_brief(uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid)', 'EXECUTE')
     AND has_function_privilege('riley_app', 'crm.propose_scope_version(uuid,jsonb,text)', 'EXECUTE'), 'riley can call definer fns';
  ASSERT NOT has_function_privilege('riley_app', 'crm.accept_scope_version(uuid)', 'EXECUTE'), 'riley cannot accept';
  ASSERT NOT has_function_privilege('riley_app', 'crm.create_scope_version_current(uuid,jsonb,text,text,text,uuid)', 'EXECUTE'), 'riley cannot create current';
  -- service_role / lockdown
  ASSERT has_function_privilege('service_role', 'crm.accept_scope_version(uuid)', 'EXECUTE'), 'service_role accept';
  ASSERT has_function_privilege('service_role', 'crm.create_scope_version_current(uuid,jsonb,text,text,text,uuid)', 'EXECUTE'), 'service_role create';
  ASSERT has_table_privilege('service_role', 'crm.scope_versions', 'DELETE'), 'service_role DML';
  ASSERT NOT has_table_privilege('authenticated', 'crm.scope_versions', 'SELECT'), 'authenticated locked out';
  ASSERT NOT has_table_privilege('anon', 'crm.scope_documents', 'SELECT'), 'anon locked out';
  ASSERT NOT has_function_privilege('anon', 'crm.accept_scope_version(uuid)', 'EXECUTE'), 'anon cannot accept';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'crm.scope_documents'::regclass), 'RLS docs';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'crm.scope_versions'::regclass), 'RLS versions';
  ASSERT NOT has_function_privilege('riley_app', 'crm._apply_riley_scope_grants()', 'EXECUTE'), 'helper not callable by riley';
  ASSERT NOT has_function_privilege('anon', 'crm._apply_riley_scope_grants()', 'EXECUTE')
     AND NOT has_function_privilege('authenticated', 'crm._apply_riley_scope_grants()', 'EXECUTE'), 'helper not callable by anon/authenticated';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      WHERE p.oid = 'crm._apply_riley_scope_grants()'::regprocedure AND a.grantee = 0), 'helper not callable by PUBLIC';
  ASSERT NOT has_function_privilege('service_role', 'crm._apply_riley_scope_grants()', 'EXECUTE'), 'no service_role grant on helper';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      WHERE p.oid IN ('crm.accept_scope_version(uuid)'::regprocedure,
                                      'crm.create_scope_version_current(uuid,jsonb,text,text,text,uuid)'::regprocedure,
                                      'crm.propose_scope_version(uuid,jsonb,text)'::regprocedure,
                                      'crm.create_initial_scope_from_brief(uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid)'::regprocedure)
                        AND a.grantee = 0), 'no PUBLIC execute on scope functions';
END $$;

-- discovery_briefs.scope_version_id exists
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='crm' AND table_name='discovery_briefs' AND column_name='scope_version_id'), 'column exists';
END $$;

-- Riley tests: throwaway riley_app (the harness applies migrations before tests, so the role is created here
-- and the grants helper re-run).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'riley_app') THEN CREATE ROLE riley_app NOLOGIN; END IF;
  PERFORM crm._apply_riley_scope_grants();
END $$;

-- riley_can_create_initial_and_propose + propose_sets_based_on_current
DO $$
DECLARE b uuid; l uuid; br uuid; v1 uuid; v2 uuid; d uuid; sec jsonb := '[{"key":"a","title":"A","body_md":"x","visibility":"client"}]';
BEGIN
  INSERT INTO crm.businesses (name) VALUES ('Scope Riley') RETURNING id INTO b;
  INSERT INTO crm.leads (business_id) VALUES (b) RETURNING id INTO l;
  INSERT INTO crm.discovery_templates (id, name) VALUES ('855b74c5-d0f2-5b3a-8953-6661e2eaea1f', 'scope-test') ON CONFLICT DO NOTHING;
  INSERT INTO crm.discovery_invites (lead_id, project_title) VALUES (l, 'P') RETURNING id INTO br;
  INSERT INTO crm.discovery_briefs (invite_id) VALUES (br) RETURNING id INTO br;
  SET LOCAL ROLE riley_app;
  -- (riley reads via SELECT-only RLS policies; all writes go through the definer functions)
  v1 := crm.create_initial_scope_from_brief(b, l, NULL, NULL, 'Riley doc', sec, 'project', 'hybrid', br);
  RESET ROLE;
  SELECT scope_document_id INTO d FROM crm.scope_versions WHERE id = v1;
  SET LOCAL ROLE riley_app;
  v2 := crm.propose_scope_version(d, sec, 'tweak');
  RESET ROLE;
  ASSERT (SELECT status || source FROM crm.scope_versions WHERE id = v1) = 'currentbrief', 'v1 current/brief';
  ASSERT (SELECT current_version_id FROM crm.scope_documents WHERE id = d) = v1, 'doc -> v1';
  ASSERT (SELECT scope_version_id FROM crm.discovery_briefs WHERE id = br) = v1, 'brief linked';
  ASSERT (SELECT engagement_type || delivery_model FROM crm.scope_documents WHERE id = d) = 'projecthybrid', 'doc type/model';
  ASSERT (SELECT status || source FROM crm.scope_versions WHERE id = v2) = 'proposedriley', 'v2 proposed/riley';
  ASSERT (SELECT based_on_version_id FROM crm.scope_versions WHERE id = v2) = v1, 'based on current';
  ASSERT (SELECT version_no FROM crm.scope_versions WHERE id = v2) = 2, 'v2 number';
EXCEPTION WHEN OTHERS THEN RESET ROLE; RAISE;
END $$;

-- riley_cannot_insert_or_update_tables_directly
DO $$
DECLARE d uuid; ok1 boolean := false; ok2 boolean := false; ok3 boolean := false;
BEGIN
  SELECT id INTO d FROM crm.scope_documents WHERE title = 'Riley doc';
  SET LOCAL ROLE riley_app;
  BEGIN INSERT INTO crm.scope_versions (scope_document_id, version_no, sections, status, source) VALUES (d, 50, '[]', 'proposed', 'riley');
  EXCEPTION WHEN insufficient_privilege THEN ok1 := true; END;
  BEGIN UPDATE crm.scope_versions SET status = 'current' WHERE scope_document_id = d;
  EXCEPTION WHEN insufficient_privilege THEN ok2 := true; END;
  BEGIN INSERT INTO crm.scope_documents (business_id, title) SELECT business_id, 'x' FROM crm.scope_documents WHERE id = d;
  EXCEPTION WHEN insufficient_privilege THEN ok3 := true; END;
  ASSERT (SELECT count(*) FROM crm.scope_versions WHERE scope_document_id = d) >= 2, 'riley can read versions via policy';
  ASSERT (SELECT count(*) FROM crm.scope_documents WHERE id = d) = 1, 'riley can read documents via policy';
  RESET ROLE;
  ASSERT ok1 AND ok2 AND ok3, 'riley direct writes must be denied';
EXCEPTION WHEN OTHERS THEN RESET ROLE; RAISE;
END $$;

-- riley_cannot_accept
DO $$
DECLARE v uuid; ok1 boolean := false; ok2 boolean := false;
BEGIN
  SELECT id INTO v FROM crm.scope_versions WHERE status = 'proposed' AND source = 'riley' AND change_note = 'tweak';
  SET LOCAL ROLE riley_app;
  BEGIN PERFORM crm.accept_scope_version(v); EXCEPTION WHEN insufficient_privilege THEN ok1 := true; END;
  BEGIN PERFORM crm.create_scope_version_current((SELECT scope_document_id FROM crm.scope_versions WHERE id = v), '[]', 'brian', 'x', NULL, NULL);
  EXCEPTION WHEN insufficient_privilege THEN ok2 := true; END;
  RESET ROLE;
  ASSERT ok1 AND ok2, 'riley cannot accept or create current';
  ASSERT (SELECT status FROM crm.scope_versions WHERE id = v) = 'proposed', 'still proposed';
EXCEPTION WHEN OTHERS THEN RESET ROLE; RAISE;
END $$;

-- initial_refuses_when_current_exists
DO $$
DECLARE b uuid; l uuid; msg text; sec jsonb := '[]';
BEGIN
  INSERT INTO crm.businesses (name) VALUES ('Scope Initial Twice') RETURNING id INTO b;
  INSERT INTO crm.leads (business_id) VALUES (b) RETURNING id INTO l;
  PERFORM crm.create_initial_scope_from_brief(b, l, NULL, NULL, 'T', sec, NULL, NULL, NULL);
  BEGIN PERFORM crm.create_initial_scope_from_brief(b, l, NULL, NULL, 'T', sec, NULL, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN msg := SQLSTATE || ' ' || SQLERRM; END;
  ASSERT msg LIKE 'SC004 scope already exists%', 'got: ' || coalesce(msg, 'null');
  ASSERT (SELECT count(*) FROM crm.scope_documents WHERE business_id = b AND lead_id = l) = 1, 'one doc per business+lead';
END $$;

-- based_on must belong to same document
DO $$
DECLARE b uuid; d1 uuid; d2 uuid; v1 uuid; ok boolean := false;
BEGIN
  INSERT INTO crm.businesses (name) VALUES ('Scope Base Cross') RETURNING id INTO b;
  INSERT INTO crm.scope_documents (business_id, title) VALUES (b, 'D1') RETURNING id INTO d1;
  INSERT INTO crm.scope_documents (business_id, title) VALUES (b, 'D2') RETURNING id INTO d2;
  v1 := crm.create_scope_version_current(d1, '[]', 'brief', 'system', NULL, NULL);
  BEGIN
    INSERT INTO crm.scope_versions (scope_document_id, version_no, sections, status, source, based_on_version_id)
      VALUES (d2, 1, '[]', 'proposed', 'riley', v1);
  EXCEPTION WHEN SQLSTATE 'SC005' THEN ok := true; END;
  ASSERT ok, 'cross-document base refused';
END $$;

-- R48 helpers: expect a raise_exception whose message matches
CREATE OR REPLACE FUNCTION pg_temp.expect_err(sql text, pat text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE msg text;
BEGIN
  BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN msg := SQLSTATE || ' ' || SQLERRM; END;
  ASSERT msg LIKE pat, format('expected error like %L, got %L for %s', pat, msg, sql);
END $f$;

-- initial_rejects_lead_from_other_business / client / brief_from_other_lead / already_linked_brief
DO $$
DECLARE b1 uuid; b2 uuid; l1 uuid; l2 uuid; c2 uuid; br1 uuid; v uuid; inv uuid;
BEGIN
  INSERT INTO crm.discovery_templates (id, name) VALUES ('855b74c5-d0f2-5b3a-8953-6661e2eaea1f', 'scope-test') ON CONFLICT DO NOTHING;
  INSERT INTO crm.businesses (name) VALUES ('R48 A') RETURNING id INTO b1;
  INSERT INTO crm.businesses (name) VALUES ('R48 B') RETURNING id INTO b2;
  INSERT INTO crm.leads (business_id) VALUES (b1) RETURNING id INTO l1;
  INSERT INTO crm.leads (business_id) VALUES (b2) RETURNING id INTO l2;
  INSERT INTO crm.clients (business_id) VALUES (b2) RETURNING id INTO c2;
  INSERT INTO crm.discovery_invites (lead_id, project_title) VALUES (l1, 'P') RETURNING id INTO inv;
  INSERT INTO crm.discovery_briefs (invite_id) VALUES (inv) RETURNING id INTO br1;

  -- initial_rejects_lead_from_other_business
  PERFORM pg_temp.expect_err(format($q$select crm.create_initial_scope_from_brief(%L,%L,NULL,NULL,'T','[]',NULL,NULL,NULL)$q$, b1, l2), 'SC005 lead % does not belong%');
  -- initial_rejects_client_from_other_business
  PERFORM pg_temp.expect_err(format($q$select crm.create_initial_scope_from_brief(%L,NULL,%L,NULL,'T','[]',NULL,NULL,NULL)$q$, b1, c2), 'SC005 client % does not belong%');
  -- neither lead nor client; bad title
  PERFORM pg_temp.expect_err(format($q$select crm.create_initial_scope_from_brief(%L,NULL,NULL,NULL,'T','[]',NULL,NULL,NULL)$q$, b1), 'SC005 %required%');
  PERFORM pg_temp.expect_err(format($q$select crm.create_initial_scope_from_brief(%L,%L,NULL,NULL,'   ','[]',NULL,NULL,NULL)$q$, b1, l1), 'SC005 title must%');
  -- initial_rejects_brief_from_other_lead
  PERFORM pg_temp.expect_err(format($q$select crm.create_initial_scope_from_brief(%L,%L,NULL,NULL,'T','[]',NULL,NULL,%L)$q$, b2, l2, br1), 'SC005 brief % does not belong%');
  ASSERT (SELECT count(*) FROM crm.scope_documents WHERE business_id IN (b1, b2)) = 0, 'failed calls wrote nothing';
  -- initial_rejects_already_linked_brief
  v := crm.create_initial_scope_from_brief(b1, l1, NULL, NULL, ' Trim me ', '[]', NULL, NULL, br1);
  ASSERT (SELECT title FROM crm.scope_documents WHERE business_id = b1) = 'Trim me', 'title trimmed';
  UPDATE crm.scope_documents SET current_version_id = NULL WHERE business_id = b1;
  UPDATE crm.scope_versions SET status = 'superseded' WHERE id = v;
  PERFORM pg_temp.expect_err(format($q$select crm.create_initial_scope_from_brief(%L,%L,NULL,NULL,'T','[]',NULL,NULL,%L)$q$, b1, l1, br1), 'SC005 brief % is already linked%');
  ASSERT (SELECT count(*) FROM crm.scope_versions WHERE scope_document_id = (SELECT id FROM crm.scope_documents WHERE business_id = b1)) = 1, 'no extra version written';
END $$;

-- initial_existing_doc_without_current_not_altered
DO $$
DECLARE b uuid; l uuid; e uuid; d uuid; v uuid;
BEGIN
  INSERT INTO crm.businesses (name) VALUES ('R48 Existing') RETURNING id INTO b;
  INSERT INTO crm.leads (business_id) VALUES (b) RETURNING id INTO l;
  INSERT INTO crm.scope_documents (business_id, lead_id, title, engagement_type, delivery_model)
    VALUES (b, l, 'Original', 'project', 'manual') RETURNING id INTO d;
  v := crm.create_initial_scope_from_brief(b, l, NULL, NULL, 'New title', '[]', 'pro_bono', 'agentic', NULL);
  ASSERT (SELECT current_version_id FROM crm.scope_documents WHERE id = d) = v, 'pointer set on existing doc';
  ASSERT (SELECT title || engagement_type || delivery_model FROM crm.scope_documents WHERE id = d) = 'Originalprojectmanual', 'existing doc fields untouched';
  ASSERT (SELECT engagement_id IS NULL FROM crm.scope_documents WHERE id = d), 'engagement untouched';
END $$;

-- propose_refused_without_current
DO $$
DECLARE b uuid; d uuid;
BEGIN
  INSERT INTO crm.businesses (name) VALUES ('R48 NoCurrent') RETURNING id INTO b;
  INSERT INTO crm.scope_documents (business_id, title) VALUES (b, 'NC') RETURNING id INTO d;
  PERFORM pg_temp.expect_err(format($q$select crm.propose_scope_version(%L,'[]','n')$q$, d), 'SC005 %no current version%');
END $$;

-- propose_caps_pending_at_5 + propose_rejects_oversized_note (+ oversized sections)
DO $$
DECLARE b uuid; d uuid; i int;
BEGIN
  INSERT INTO crm.businesses (name) VALUES ('R48 Caps') RETURNING id INTO b;
  INSERT INTO crm.scope_documents (business_id, title) VALUES (b, 'Caps') RETURNING id INTO d;
  PERFORM crm.create_scope_version_current(d, '[]', 'brief', 'system', NULL, NULL);
  FOR i IN 1..5 LOOP PERFORM crm.propose_scope_version(d, '[]', 'p' || i); END LOOP;
  PERFORM pg_temp.expect_err(format($q$select crm.propose_scope_version(%L,'[]','sixth')$q$, d), 'SC005 too many pending%');
  -- rejecting one frees a slot
  UPDATE crm.scope_versions SET status = 'rejected' WHERE scope_document_id = d AND change_note = 'p1';
  PERFORM crm.propose_scope_version(d, '[]', 'sixth ok');
  PERFORM pg_temp.expect_err(format($q$select crm.propose_scope_version(%L,'[]',%L)$q$, d, repeat('x', 2001)), 'SC005 change note too long%');
  PERFORM pg_temp.expect_err(format($q$select crm.propose_scope_version(%L,%L::jsonb,'n')$q$, d,
    jsonb_build_array(jsonb_build_object('key','a','title','A','body_md',repeat('x', 210000),'visibility','internal'))::text), 'SC005 sections too large%');
END $$;

-- create_current_refuses_stale_base (R51): SC001 when p_based_on is not the current version
DO $$
DECLARE b uuid; d uuid; v1 uuid; v2 uuid; msg text;
BEGIN
  INSERT INTO crm.businesses (name) VALUES ('Scope Stale Edit') RETURNING id INTO b;
  INSERT INTO crm.scope_documents (business_id, title) VALUES (b, 'SE') RETURNING id INTO d;
  v1 := crm.create_scope_version_current(d, '[]', 'brief', 'system', NULL, NULL);
  v2 := crm.create_scope_version_current(d, '[]', 'brian', 'brian', NULL, v1);
  BEGIN PERFORM crm.create_scope_version_current(d, '[]', 'brian', 'brian', NULL, v1);
  EXCEPTION WHEN OTHERS THEN msg := SQLSTATE || ' ' || SQLERRM; END;
  ASSERT msg LIKE 'SC001 %', 'stale base refused, got: ' || coalesce(msg, 'null');
  msg := NULL;
  BEGIN PERFORM crm.create_scope_version_current(d, '[]', 'brian', 'brian', NULL, NULL);
  EXCEPTION WHEN OTHERS THEN msg := SQLSTATE || ' ' || SQLERRM; END;
  ASSERT msg LIKE 'SC001 %', 'null base refused when current exists';
  ASSERT (SELECT current_version_id FROM crm.scope_documents WHERE id = d) = v2, 'unchanged';
  msg := NULL;
  BEGIN PERFORM crm.create_scope_version_current(gen_random_uuid(), '[]', 'brian', 'brian', NULL, NULL);
  EXCEPTION WHEN OTHERS THEN msg := SQLSTATE || ' ' || SQLERRM; END;
  ASSERT msg LIKE 'SC003 %', 'missing doc SC003';
END $$;
