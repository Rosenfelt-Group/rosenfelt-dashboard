-- Tests for 2026-10-22_approvals_reply_dedup.sql and 2026-10-22_email_ingest_newly_stored.sql (task 13b).
-- One transaction, rolled back. Errors are trapped in sub-blocks so a failure does not abort it.
begin;

-- dedup index: same reply_to_email_message_id on two email_send rows is a unique violation
do $$
declare caught boolean := false;
begin
  insert into public.pending_approvals (agent, action_type, title, payload)
    values ('riley', 'email_send', 'r1', '{"reply_to_email_message_id":"00000000-0000-0000-0008-000000000001"}');
  begin
    insert into public.pending_approvals (agent, action_type, title, payload)
      values ('riley', 'email_send', 'r2', '{"reply_to_email_message_id":"00000000-0000-0000-0008-000000000001"}');
  exception when unique_violation then caught := true; end;
  assert caught, 'duplicate reply_to_email_message_id on email_send must be refused';
  -- a different message id is fine
  insert into public.pending_approvals (agent, action_type, title, payload)
    values ('riley', 'email_send', 'r3', '{"reply_to_email_message_id":"00000000-0000-0000-0008-000000000002"}');
end $$;

-- rows without the key, and non-email_send rows, are unaffected
do $$
begin
  insert into public.pending_approvals (agent, action_type, title, payload) values ('sam', 'email_send', 'n1', '{"to":["a@b.c"]}');
  insert into public.pending_approvals (agent, action_type, title, payload) values ('sam', 'email_send', 'n2', '{"to":["a@b.c"]}');
  insert into public.pending_approvals (agent, action_type, title, payload) values ('sam', 'email_send', 'n3', '{}');
  insert into public.pending_approvals (agent, action_type, title, payload) values ('sam', 'email_send', 'n4', '{}');
  -- other action types may repeat the key
  insert into public.pending_approvals (agent, action_type, title, payload)
    values ('sam', 'sam_send_invoice', 'o1', '{"reply_to_email_message_id":"00000000-0000-0000-0008-000000000001"}');
  insert into public.pending_approvals (agent, action_type, title, payload)
    values ('sam', 'sam_send_invoice', 'o2', '{"reply_to_email_message_id":"00000000-0000-0000-0008-000000000001"}');
  assert (select count(*) from public.pending_approvals where title in ('n1','n2','n3','n4','o1','o2')) = 6, 'unaffected rows inserted';
end $$;

-- a riley_app insert that duplicates an existing one is refused
set role riley_app;
do $$
declare caught boolean := false;
begin
  insert into public.pending_approvals (agent, action_type, title, payload)
    values ('riley', 'email_send', 'rr1', '{"reply_to_email_message_id":"00000000-0000-0000-0008-000000000009"}');
  begin
    insert into public.pending_approvals (agent, action_type, title, payload)
      values ('riley', 'email_send', 'rr2', '{"reply_to_email_message_id":"00000000-0000-0000-0008-000000000009"}');
  exception when unique_violation then caught := true; end;
  assert caught, 'riley_app duplicate must be refused';
  -- also a duplicate of a row riley cannot see (the earlier r1 is visible; sam rows are not) still errors
  caught := false;
  begin
    insert into public.pending_approvals (agent, action_type, title, payload)
      values ('riley', 'email_send', 'rr3', '{"reply_to_email_message_id":"00000000-0000-0000-0008-000000000001"}');
  exception when unique_violation then caught := true; end;
  assert caught, 'riley_app duplicate of an earlier approval must be refused';
end $$;
reset role;

-- store_ingested_email reports newly_stored: true on first insert, false on re-delivery
do $$
declare c1 uuid; p jsonb; r1 jsonb; r2 jsonb;
begin
  insert into crm.contacts (first_name, last_name, email) values ('New', 'Stored', 'newstored@dedup-tests.org') returning id into c1;
  p := jsonb_build_object(
    'message', jsonb_build_object('gmail_message_id','gns-1','thread_id','t','direction','received','from_email','newstored@dedup-tests.org',
       'to_emails', jsonb_build_array('brian@rosably.com'),'cc_emails','[]'::jsonb,
       'subject','Hi','snippet','sn','body_text','body','sent_at',now(),'source','gmail_watch','delivered_to_crm',false),
    'links', jsonb_build_array(jsonb_build_object('contact_id',c1)),
    'activity', jsonb_build_object('activity_type','email_received','email_direction','received','email_subject','Hi','content','sn'));
  r1 := crm.store_ingested_email(p);
  r2 := crm.store_ingested_email(p);
  assert (r1->>'newly_stored')::boolean is true, 'first call newly_stored: ' || r1;
  assert (r2->>'newly_stored')::boolean is false, 'second call not newly_stored: ' || r2;
  assert (r1->>'links_added')::int = 1, 'existing keys kept';
end $$;

rollback;
