-- Rosably 3.0 phase 1, task 10a (R46, R47, R49): grants + RLS policies for the riley_app database role.
-- NOT YET APPLIED. Apply by hand with the owner's approval (psql service=rosably -f ...).
-- Idempotent: safe to re-run. Requires 2026-10-22_crm_scope_documents.sql (crm._apply_riley_scope_grants)
-- and 2026-10-22_approvals_execution.sql (pending_approvals execution columns).
--
-- riley_app already exists in prod (LOGIN NOINHERIT, password set out of band). The DO block below only
-- creates it where it is missing (test harness); it never sets a password.
-- RLS is enabled on every crm table with no policies, so every table riley touches needs a policy TO
-- riley_app as well as a grant (R47). Riley is the firm's own ops agent in a single-tenant firm, so read
-- policies are using (true) (R49). Scope tables are handled by crm._apply_riley_scope_grants() (SELECT
-- only + execute on the two propose functions; never accept / create-current, R46).
-- Deliberately NOT granted: crm.tm_billing_entries, crm.client_services, crm.gmail_sync_state,
-- public.agent_memory, public.work_items, and any DML beyond what is listed under "writes".

begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'riley_app') then
    create role riley_app login noinherit nocreatedb nocreaterole nobypassrls connection limit 10;
  end if;
end $$;

grant usage on schema crm, public to riley_app;

-- reads: explicit table list (no ALL TABLES, so future tables are not auto-exposed)
do $$
declare t text;
begin
  foreach t in array array[
    'assessment_results', 'business_research', 'businesses', 'clients', 'contacts',
    'discovery_briefs', 'discovery_invites', 'discovery_questions', 'discovery_responses',
    'discovery_template_items', 'discovery_templates', 'email_message_links', 'email_messages',
    'lead_activities', 'leads', 'service_templates', 'unmatched_email_log']
  loop
    execute format('revoke all on crm.%I from riley_app', t);
    execute format('grant select on crm.%I to riley_app', t);
    execute format('drop policy if exists %I on crm.%I', 'riley_read_' || t, t);
    execute format('create policy %I on crm.%I for select to riley_app using (true)', 'riley_read_' || t, t);
  end loop;
end $$;

-- writes ---------------------------------------------------------------------------------------------

-- timeline entries: insert only
grant insert on crm.lead_activities to riley_app;
drop policy if exists riley_insert_lead_activities on crm.lead_activities;
create policy riley_insert_lead_activities on crm.lead_activities for insert to riley_app with check (true);

-- discovery briefs: insert + update
grant insert, update on crm.discovery_briefs to riley_app;
drop policy if exists riley_insert_discovery_briefs on crm.discovery_briefs;
create policy riley_insert_discovery_briefs on crm.discovery_briefs for insert to riley_app with check (true);
drop policy if exists riley_update_discovery_briefs on crm.discovery_briefs;
create policy riley_update_discovery_briefs on crm.discovery_briefs for update to riley_app using (true) with check (true);

-- discovery invites: riley may only rewrite the questionnaire snapshot of a draft invite
grant update (questionnaire_snapshot) on crm.discovery_invites to riley_app;
drop policy if exists riley_update_discovery_invites on crm.discovery_invites;
create policy riley_update_discovery_invites on crm.discovery_invites for update to riley_app
  using (status = 'draft') with check (status = 'draft');

-- approvals: riley may only propose an email_send, never decide or execute one
revoke all on public.pending_approvals from riley_app;
grant select, insert on public.pending_approvals to riley_app;
drop policy if exists riley_read_pending_approvals on public.pending_approvals;
-- pending_approvals is shared by every agent (Sam's invoices/refunds etc.): riley sees only its own email drafts
create policy riley_read_pending_approvals on public.pending_approvals for select to riley_app
  using (agent = 'riley' and action_type = 'email_send');
drop policy if exists riley_insert_pending_approvals on public.pending_approvals;
create policy riley_insert_pending_approvals on public.pending_approvals for insert to riley_app
  with check (agent = 'riley' and action_type = 'email_send');

-- belt and braces: keyed on current_user (SECURITY INVOKER, so it sees the real caller). Other roles
-- (service_role, the dashboard) are untouched.
create or replace function public.riley_guard_pending_approvals()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if current_user = 'riley_app' then
    if new.action_type is distinct from 'email_send' or new.agent is distinct from 'riley' then
      raise exception 'riley_app may only insert riley email_send approvals' using errcode = '42501';
    end if;
    if tg_op <> 'INSERT'
       or new.status is distinct from 'pending'
       or new.reviewed_by is not null or new.reviewed_at is not null
       or new.executed_at is not null or new.result is not null
       or new.error is not null or new.executing_since is not null then
      raise exception 'riley_app may only insert pending approvals with no review/execution fields' using errcode = '42501';
    end if;
    -- created_at is server-assigned; expires_at has no column default, so it is left as supplied
    new.created_at := pg_catalog.now();
  end if;
  return new;
end;
$fn$;
revoke all on function public.riley_guard_pending_approvals() from public, anon, authenticated;

drop trigger if exists riley_guard_pending_approvals on public.pending_approvals;
create trigger riley_guard_pending_approvals
  before insert or update on public.pending_approvals
  for each row execute function public.riley_guard_pending_approvals();

-- scope tables + the two propose functions (SELECT only; no accept / create-current)
select crm._apply_riley_scope_grants();

commit;
