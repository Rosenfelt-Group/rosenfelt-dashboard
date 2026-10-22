-- Tests for 2026-10-22_riley_app_role.sql (riley_app grants + RLS policies, R46/R47/R49).
-- Everything runs in one transaction that is rolled back. Rows are seeded as the superuser,
-- then each check runs under SET ROLE riley_app. Errors are trapped in sub-blocks so a failed
-- statement does not abort the transaction.
begin;

-- seed (superuser)
insert into crm.businesses (id, name) values ('00000000-0000-0000-0006-000000000001', 'Riley Test Biz');
insert into crm.contacts (id, first_name, email) values ('00000000-0000-0000-0006-000000000002', 'Rl', 'rl@riley.test');
insert into crm.leads (id, business_id) values ('00000000-0000-0000-0006-000000000003', '00000000-0000-0000-0006-000000000001');
insert into crm.discovery_invites (id, lead_id, project_title, status)
  values ('00000000-0000-0000-0006-000000000004', '00000000-0000-0000-0006-000000000003', 'Draft', 'draft');
insert into crm.discovery_invites (id, lead_id, project_title, status, questionnaire_snapshot)
  values ('00000000-0000-0000-0006-000000000005', '00000000-0000-0000-0006-000000000003', 'Sent', 'sent', '{}');
-- the harness dump cannot load public.agent_memory / work_items (extension types); stub them when
-- absent so the "no access" checks still run (rolled back with everything else)
create table if not exists public.agent_memory (id uuid default gen_random_uuid() primary key, note text);
create table if not exists public.work_items (id uuid default gen_random_uuid() primary key, title text);
alter table public.agent_memory enable row level security;
alter table public.work_items enable row level security;

insert into crm.email_messages (id, gmail_message_id, direction, from_email, to_emails, subject, snippet, body_text, sent_at, source)
  values ('00000000-0000-0000-0006-000000000006', 'riley-test-gm', 'received', 'x@riley.test', '{}', 's', 'sn', 'b', now(), 'gmail_watch');
insert into public.pending_approvals (agent, action_type, title) values ('sam', 'sam_send_invoice', 'sam-secret');
insert into public.pending_approvals (agent, action_type, title) values ('riley', 'email_send', 'riley-own');

set role riley_app;

-- riley_can_read_contacts (policy, not just grant)
do $$
begin
  assert (select count(*) from crm.contacts where id = '00000000-0000-0000-0006-000000000002') = 1, 'riley sees seeded contact';
  assert (select count(*) from crm.leads where id = '00000000-0000-0000-0006-000000000003') = 1, 'riley sees seeded lead';
  assert (select count(*) from crm.email_messages where id = '00000000-0000-0000-0006-000000000006') = 1, 'riley sees seeded email_messages row';
end $$;

-- riley_cannot_read_billing
do $$
declare n int := 0;
begin
  begin perform 1 from crm.tm_billing_entries limit 1; exception when insufficient_privilege then n := n + 1; end;
  begin perform 1 from crm.client_services limit 1; exception when insufficient_privilege then n := n + 1; end;
  begin perform 1 from crm.gmail_sync_state limit 1; exception when insufficient_privilege then n := n + 1; end;
  assert n = 3, 'billing/client_services/gmail_sync_state must be permission denied, got ' || n;
end $$;

-- riley_can_insert_lead_activity
do $$
begin
  insert into crm.lead_activities (lead_id, contact_id, activity_type, content, logged_by)
    values ('00000000-0000-0000-0006-000000000003', '00000000-0000-0000-0006-000000000002', 'note', 'hi', 'riley');
  assert (select count(*) from crm.lead_activities where content = 'hi' and logged_by = 'riley') = 1, 'activity inserted and visible';
end $$;

-- riley_cannot_update_or_delete_lead_activity
do $$
declare n int := 0;
begin
  begin update crm.lead_activities set content = 'x'; exception when insufficient_privilege then n := n + 1; end;
  begin delete from crm.lead_activities; exception when insufficient_privilege then n := n + 1; end;
  assert n = 2, 'no update/delete on lead_activities';
end $$;

-- riley_can_write_discovery_briefs
do $$
declare b uuid;
begin
  insert into crm.discovery_briefs (invite_id, status) values ('00000000-0000-0000-0006-000000000004', 'pending') returning id into b;
  update crm.discovery_briefs set status = 'ready', content_md = 'x' where id = b;
  assert (select status from crm.discovery_briefs where id = b) = 'ready', 'brief updated';
end $$;

-- riley_can_update_draft_snapshot_only
do $$
declare n int; ok boolean := false;
begin
  update crm.discovery_invites set questionnaire_snapshot = '{"a":1}' where id = '00000000-0000-0000-0006-000000000004';
  get diagnostics n = row_count;
  assert n = 1, 'draft snapshot update hits 1 row, got ' || n;
  update crm.discovery_invites set questionnaire_snapshot = '{"a":1}' where id = '00000000-0000-0000-0006-000000000005';
  get diagnostics n = row_count;
  assert n = 0, 'sent invite not updatable, got ' || n;
  begin
    update crm.discovery_invites set project_title = 'hacked' where id = '00000000-0000-0000-0006-000000000004';
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'other columns permission denied';
  ok := false;
  begin
    update crm.discovery_invites set status = 'sent' where id = '00000000-0000-0000-0006-000000000004';
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'status column permission denied';
  ok := false;
  begin delete from crm.discovery_invites; exception when insufficient_privilege then ok := true; end;
  assert ok, 'no delete on invites';
end $$;

-- riley_can_insert_email_send_approval
do $$
begin
  insert into public.pending_approvals (agent, action_type, title, payload)
    values ('riley', 'email_send', 't', '{"to":"a@b.test"}');
  assert (select count(*) from public.pending_approvals where agent = 'riley' and action_type = 'email_send' and status = 'pending' and title = 't') = 1, 'approval inserted';
  insert into public.pending_approvals (agent, action_type, status) values ('riley', 'email_send', 'pending');
end $$;

-- riley_cannot_insert_non_email_approval
do $$
declare ok boolean := false;
begin
  begin
    insert into public.pending_approvals (agent, action_type, title) values ('riley', 'wire_transfer', 't');
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'non email_send action_type rejected';
  ok := false;
  begin
    insert into public.pending_approvals (agent, action_type, title) values ('sam', 'email_send', 't');
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'agent other than riley rejected';
end $$;

-- riley_sees_only_own_approvals
do $$
begin
  assert (select count(*) from public.pending_approvals where agent = 'sam') = 0, 'sam row invisible to riley';
  assert (select count(*) from public.pending_approvals where title = 'sam-secret') = 0, 'sam_send_invoice invisible';
  assert (select count(*) from public.pending_approvals where title = 'riley-own') = 1, 'own email_send row visible';
end $$;

-- riley_insert_created_at_is_server_assigned
do $$
declare c timestamptz;
begin
  insert into public.pending_approvals (agent, action_type, title, created_at) values ('riley', 'email_send', 'backdated', '2000-01-01') returning created_at into c;
  assert c > now() - interval '1 minute', 'created_at forced to now()';
end $$;

-- riley_cannot_insert_preapproved
do $$
declare ok boolean; v text;
begin
  foreach v in array array['status', 'reviewed_by', 'reviewed_at', 'executed_at', 'result', 'error', 'executing_since'] loop
    ok := false;
    begin
      execute format('insert into public.pending_approvals (agent, action_type, %I) values (''riley'', ''email_send'', %L)', v,
        case v when 'status' then 'approved' when 'reviewed_by' then 'riley'
                 when 'result' then '{}' when 'error' then 'e'
                 else now()::text end);
    exception when insufficient_privilege then ok := true; end;
    assert ok, 'pre-set ' || v || ' must be rejected';
  end loop;
end $$;

-- riley_cannot_update_or_delete_approvals
do $$
declare n int := 0;
begin
  begin update public.pending_approvals set status = 'approved'; exception when insufficient_privilege then n := n + 1; end;
  begin delete from public.pending_approvals; exception when insufficient_privilege then n := n + 1; end;
  assert n = 2, 'no update/delete on pending_approvals';
end $$;

-- riley_cannot_write_agent_memory (or work_items)
do $$
declare n int := 0;
begin
  begin perform 1 from public.agent_memory limit 1; exception when insufficient_privilege then n := n + 1; end;
  begin perform 1 from public.work_items limit 1; exception when insufficient_privilege then n := n + 1; end;
  begin execute 'insert into public.agent_memory (note) values (''x'')'; exception when insufficient_privilege then n := n + 1; end;
  assert n = 3, 'agent_memory/work_items fully denied, got ' || n;
end $$;

-- riley_cannot_insert_scope_versions_directly
do $$
declare n int := 0;
begin
  begin
    insert into crm.scope_versions (scope_document_id, version_no, sections, status, source)
      values (gen_random_uuid(), 1, '[]', 'current', 'riley');
  exception when insufficient_privilege then n := n + 1; end;
  begin
    insert into crm.scope_documents (business_id, title) values ('00000000-0000-0000-0006-000000000001', 'x');
  exception when insufficient_privilege then n := n + 1; end;
  assert n = 2, 'scope tables stay SELECT-only';
end $$;

-- riley_cannot_execute_accept_scope_version
do $$
declare ok boolean := false;
begin
  begin perform crm.accept_scope_version(gen_random_uuid()); exception when insufficient_privilege then ok := true; end;
  assert ok, 'accept_scope_version denied';
  ok := false;
  begin perform crm._apply_riley_scope_grants(); exception when insufficient_privilege then ok := true; end;
  assert ok, 'grant helper denied';
end $$;

reset role;

-- riley_role_attributes_and_no_other_definer_exposure
do $$
declare r record; bad text;
begin
  select * into r from pg_roles where rolname = 'riley_app';
  assert r.rolcanlogin and not r.rolinherit and not r.rolcreatedb and not r.rolcreaterole and not r.rolbypassrls and r.rolconnlimit = 10, 'role attributes';
  select string_agg(n.nspname || '.' || p.proname, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.prosecdef and n.nspname in ('crm', 'public')
     and has_function_privilege('riley_app', p.oid, 'EXECUTE')
     -- run_sql is revoked from PUBLIC in prod by 2026-10-17_revoke_run_sql_public.sql, which the harness does not apply
     and p.proname not in ('create_initial_scope_from_brief', 'propose_scope_version', 'run_sql');
  assert bad is null, 'riley can execute other SECURITY DEFINER functions: ' || coalesce(bad, '');
end $$;

rollback;
