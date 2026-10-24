-- Tests for docs/migrations/2026-10-25_d_leads_next_step.sql: next step fields and stage_entered_at.

-- next_step_columns_exist
DO $$
BEGIN
  ASSERT (SELECT data_type FROM information_schema.columns
           WHERE table_schema = 'crm' AND table_name = 'leads' AND column_name = 'next_step') = 'text', 'next_step is text';
  ASSERT (SELECT data_type FROM information_schema.columns
           WHERE table_schema = 'crm' AND table_name = 'leads' AND column_name = 'next_step_due') = 'date', 'next_step_due is date';
  ASSERT (SELECT is_nullable FROM information_schema.columns
           WHERE table_schema = 'crm' AND table_name = 'leads' AND column_name = 'stage_entered_at') = 'NO', 'stage_entered_at is not null';
END $$;

-- stage_entered_at_set_on_insert_and_reset_on_stage_change
DO $$
DECLARE r jsonb; lid uuid; t0 timestamptz;
BEGIN
  r := crm.intake_lead('{"channel":"manual","email":"next1@step.org","name":"Nia Next","org":"Next Step One"}'::jsonb);
  lid := (r->>'lead_id')::uuid;
  ASSERT (SELECT stage_entered_at FROM crm.leads WHERE id = lid) IS NOT NULL, 'set on insert';

  UPDATE crm.leads SET stage_entered_at = now() - interval '9 days' WHERE id = lid;
  UPDATE crm.leads SET next_step = 'Send intro email', next_step_due = current_date WHERE id = lid;
  t0 := (SELECT stage_entered_at FROM crm.leads WHERE id = lid);
  ASSERT t0 < now() - interval '8 days', 'a non-stage edit keeps stage_entered_at';
  ASSERT (SELECT next_step FROM crm.leads WHERE id = lid) = 'Send intro email', 'next_step saved';

  UPDATE crm.leads SET stage = 'new' WHERE id = lid;  -- same stage
  ASSERT (SELECT stage_entered_at FROM crm.leads WHERE id = lid) = t0, 'same-stage update keeps it';

  UPDATE crm.leads SET stage = 'qualification' WHERE id = lid;
  ASSERT (SELECT stage_entered_at FROM crm.leads WHERE id = lid) > now() - interval '1 minute', 'stage change resets it';
END $$;

-- derive_stage_entered_at_uses_latest_matching_stage_change
DO $$
DECLARE r jsonb; lid uuid; created timestamptz;
BEGIN
  r := crm.intake_lead('{"channel":"manual","email":"next2@step.org","name":"Ned Next","org":"Next Step Two"}'::jsonb);
  lid := (r->>'lead_id')::uuid;
  created := (SELECT created_at FROM crm.leads WHERE id = lid);
  -- no stage_change for the current stage yet: falls back to created_at
  ASSERT crm.derive_stage_entered_at(lid) = created, 'falls back to created_at';

  UPDATE crm.leads SET stage = 'engaged' WHERE id = lid;  -- log_stage_change writes a row
  UPDATE crm.lead_activities SET created_at = '2026-01-05T10:00:00Z'
   WHERE lead_id = lid AND activity_type = 'stage_change' AND metadata->>'to' = 'engaged';
  INSERT INTO crm.lead_activities (lead_id, activity_type, logged_by, metadata, created_at)
    VALUES (lid, 'stage_change', 'system', '{"from":"engaged","to":"proposal"}', '2026-02-01T10:00:00Z');
  ASSERT crm.derive_stage_entered_at(lid) = '2026-01-05T10:00:00Z'::timestamptz,
    'uses the stage_change into the current stage, ignoring other stages';
  INSERT INTO crm.lead_activities (lead_id, activity_type, logged_by, metadata, created_at)
    VALUES (lid, 'stage_change', 'system', '{"from":"proposal","to":"engaged"}', '2026-03-01T10:00:00Z');
  ASSERT crm.derive_stage_entered_at(lid) = '2026-03-01T10:00:00Z'::timestamptz, 'latest re-entry wins';
END $$;

-- next_step_length_capped
DO $$
DECLARE r jsonb; ok boolean := false;
BEGIN
  r := crm.intake_lead('{"channel":"manual","email":"next3@step.org","name":"Nora Next","org":"Next Step Three"}'::jsonb);
  BEGIN
    UPDATE crm.leads SET next_step = repeat('x', 501) WHERE id = (r->>'lead_id')::uuid;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  ASSERT ok, 'next_step over 500 chars is rejected';
END $$;
