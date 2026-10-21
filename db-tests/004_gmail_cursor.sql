-- Tests for 2026-10-22_crm_gmail_cursor.sql (crm.advance_gmail_cursor).

-- cursor_never_regresses
DO $$
DECLARE r text;
BEGIN
  UPDATE crm.gmail_sync_state SET history_id = NULL, last_full_sync_at = NULL;
  ASSERT crm.advance_gmail_cursor('150') = '150', 'seed from null';
  r := crm.advance_gmail_cursor('140');
  ASSERT r = '150', 'must not regress: ' || r;
  ASSERT (SELECT history_id FROM crm.gmail_sync_state) = '150', 'stored stays 150';
  ASSERT (SELECT last_full_sync_at FROM crm.gmail_sync_state) IS NULL, 'no full sync mark unless asked';
  PERFORM crm.advance_gmail_cursor('150', true);
  ASSERT (SELECT last_full_sync_at FROM crm.gmail_sync_state) IS NOT NULL, 'full sync marked';
END $$;

-- cursor_numeric_not_string
DO $$
DECLARE r text;
BEGIN
  UPDATE crm.gmail_sync_state SET history_id = '9000';
  r := crm.advance_gmail_cursor('999');
  ASSERT r = '9000', '999 < 9000 numerically: ' || r;
  r := crm.advance_gmail_cursor('10000');
  ASSERT r = '10000', 'moves forward: ' || r;
  r := crm.advance_gmail_cursor('12345678901234567890');
  ASSERT r = '12345678901234567890', 'beyond bigint: ' || r;
  BEGIN
    PERFORM crm.advance_gmail_cursor('abc');
    ASSERT false, 'non-numeric must raise';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
END $$;
