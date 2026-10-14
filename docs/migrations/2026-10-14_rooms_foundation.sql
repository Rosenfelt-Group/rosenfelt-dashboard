-- Engagement Rooms, Phase 1 foundation.
-- Access model: RLS on, no policies → only the service role (dashboard routes,
-- preview host, portal, agent tool) can read or write.

create schema if not exists rooms;

create table rooms.engagements (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references crm.businesses(id) on delete restrict,
  lead_id             uuid references crm.leads(id) on delete set null,
  client_id           uuid references crm.clients(id) on delete set null,
  discovery_invite_id uuid references crm.discovery_invites(id) on delete set null,
  assessment_lead_id  uuid references public.assessment_leads(id) on delete set null,
  relationship        text not null check (relationship in ('prospect','client','partner')),
  title               text not null,
  status              text not null default 'active' check (status in ('active','approved','closed')),
  modules             jsonb not null default '{"discovery": false, "solutions": true}'::jsonb,
  created_by          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index engagements_business_idx on rooms.engagements(business_id);

create table rooms.engagement_access (
  id            uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references rooms.engagements(id) on delete cascade,
  token_hash    text not null unique,
  label         text,
  expires_at    timestamptz not null default now() + interval '60 days',
  revoked_at    timestamptz,
  last_used_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index engagement_access_engagement_idx on rooms.engagement_access(engagement_id);

create table rooms.engagement_contacts (
  id             uuid primary key default gen_random_uuid(),
  engagement_id  uuid not null references rooms.engagements(id) on delete cascade,
  name           text not null,
  email          text not null,
  role           text,
  crm_contact_id uuid references crm.contacts(id) on delete set null,
  first_seen_at  timestamptz not null default now()
);
create unique index engagement_contacts_email_uq
  on rooms.engagement_contacts(engagement_id, lower(email));

create table rooms.deliverables (
  id            uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references rooms.engagements(id) on delete cascade,
  title         text not null,
  description   text,
  kind          text not null default 'prototype' check (kind in ('prototype')),
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);
create index deliverables_engagement_idx on rooms.deliverables(engagement_id);

create table rooms.deliverable_versions (
  id                 uuid primary key default gen_random_uuid(),
  deliverable_id     uuid not null references rooms.deliverables(id) on delete cascade,
  version_no         int not null check (version_no >= 1),
  status             text not null default 'draft'
                     check (status in ('draft','shared','approved','changes_requested','superseded')),
  source             text not null default 'agent' check (source in ('agent')),
  storage_prefix     text not null,
  manifest           jsonb not null,
  built_by_agent     text references public.agents(name),
  author_contact_id  uuid references rooms.engagement_contacts(id) on delete set null,
  work_item_id       uuid references public.work_items(id) on delete set null,
  change_summary     text,
  shared_at          timestamptz,
  decided_at         timestamptz,
  decided_by         uuid references rooms.engagement_contacts(id) on delete set null,
  created_at         timestamptz not null default now(),
  unique (deliverable_id, version_no)
);

create table rooms.deliverable_comments (
  id                   uuid primary key default gen_random_uuid(),
  version_id           uuid not null references rooms.deliverable_versions(id) on delete cascade,
  parent_id            uuid references rooms.deliverable_comments(id) on delete cascade,
  screen_id            text not null,
  pin_x                numeric check (pin_x between 0 and 1),
  pin_y                numeric check (pin_y between 0 and 1),
  viewport_w           int,
  viewport_h           int,
  body                 text not null,
  contact_id           uuid references rooms.engagement_contacts(id) on delete set null,
  author_user          text,
  status               text not null default 'open' check (status in ('open','addressed','wont_do')),
  addressed_in_version uuid references rooms.deliverable_versions(id) on delete set null,
  created_at           timestamptz not null default now(),
  check (num_nonnulls(contact_id, author_user) = 1)
);
create index deliverable_comments_version_idx on rooms.deliverable_comments(version_id);

create table rooms.engagement_events (
  id            bigint generated always as identity primary key,
  engagement_id uuid not null references rooms.engagements(id) on delete cascade,
  version_id    uuid references rooms.deliverable_versions(id) on delete set null,
  contact_id    uuid references rooms.engagement_contacts(id) on delete set null,
  type          text not null,
  meta          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index engagement_events_engagement_idx on rooms.engagement_events(engagement_id, created_at desc);

create trigger set_updated_at before update on rooms.engagements
  for each row execute function crm.set_updated_at();

alter table rooms.engagements          enable row level security;
alter table rooms.engagement_access    enable row level security;
alter table rooms.engagement_contacts  enable row level security;
alter table rooms.deliverables         enable row level security;
alter table rooms.deliverable_versions enable row level security;
alter table rooms.deliverable_comments enable row level security;
alter table rooms.engagement_events    enable row level security;

grant usage on schema rooms to service_role;
grant all on all tables in schema rooms to service_role;
grant usage, select on all sequences in schema rooms to service_role;
revoke all on all tables in schema rooms from anon, authenticated;

-- Private bucket for prototype bundles (10 MB per object).
insert into storage.buckets (id, name, public, file_size_limit)
values ('prototypes', 'prototypes', false, 10485760)
on conflict (id) do nothing;
