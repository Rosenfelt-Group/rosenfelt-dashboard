-- Discovery questionnaires (CRM module: Discovery)
-- Applied to Supabase project "Rosably" (ukfpmpxwdlpsjqbxreza) on 2026-10-14.
--
-- Access model: RLS on, no policies → only the service role (dashboard API routes,
-- the rosably.com WordPress mu-plugin) can read or write. The public form never
-- talks to Supabase directly; it goes through /wp-json/rosably/v1/discovery/*,
-- which validates the invite token server-side.

-- Allow pro bono as a lead / business source.
alter table crm.leads drop constraint leads_source_check;
alter table crm.leads add constraint leads_source_check
  check (source = any (array['website_contact','website_assessment','manual','referral','pro_bono']));
alter table crm.businesses drop constraint businesses_source_check;
alter table crm.businesses add constraint businesses_source_check
  check (source = any (array['website_contact','website_assessment','manual','referral','pro_bono']));

create table crm.discovery_invites (
  id                    uuid primary key default gen_random_uuid(),
  token                 uuid not null unique default gen_random_uuid(),
  lead_id               uuid not null references crm.leads(id) on delete cascade,
  business_id           uuid references crm.businesses(id) on delete set null,
  contact_id            uuid references crm.contacts(id) on delete set null,
  project_title         text not null,
  project_brief         text,
  project_type          text not null default 'other'
                        check (project_type in ('content_social','operations','fundraising','data_reporting','other')),
  engagement_type       text not null default 'pro_bono' check (engagement_type in ('pro_bono','paid')),
  questionnaire_version text not null default 'v1',
  status                text not null default 'sent'
                        check (status in ('sent','opened','in_progress','submitted','archived')),
  sent_at               timestamptz not null default now(),
  opened_at             timestamptz,
  last_saved_at         timestamptz,
  submitted_at          timestamptz,
  expires_at            timestamptz not null default now() + interval '60 days',
  created_by            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index discovery_invites_lead_idx on crm.discovery_invites(lead_id);

create table crm.discovery_responses (
  id               uuid primary key default gen_random_uuid(),
  invite_id        uuid not null unique references crm.discovery_invites(id) on delete cascade,
  answers          jsonb not null default '{}'::jsonb,
  current_section  text,
  schema_snapshot  jsonb,          -- questionnaire definition as the respondent saw it
  respondent_name  text,
  respondent_email text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table crm.discovery_briefs (
  id            uuid primary key default gen_random_uuid(),
  invite_id     uuid not null references crm.discovery_invites(id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending','ready','failed','superseded')),
  model         text,
  content_md    text,
  error         text,
  input_tokens  integer,
  output_tokens integer,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);
-- At most one live brief per invite: makes generation idempotent and stops
-- duplicate Anthropic calls if submit is retried.
create unique index discovery_briefs_one_live
  on crm.discovery_briefs(invite_id) where status in ('pending','ready');

create trigger set_updated_at before update on crm.discovery_invites
  for each row execute function crm.set_updated_at();
create trigger set_updated_at before update on crm.discovery_responses
  for each row execute function crm.set_updated_at();

alter table crm.discovery_invites   enable row level security;
alter table crm.discovery_responses enable row level security;
alter table crm.discovery_briefs    enable row level security;

grant all on crm.discovery_invites, crm.discovery_responses, crm.discovery_briefs to service_role;
revoke all on crm.discovery_invites, crm.discovery_responses, crm.discovery_briefs from anon, authenticated;
