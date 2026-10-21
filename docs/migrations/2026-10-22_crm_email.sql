-- Rosably 3.0 phase 1, task 5: email tables for Gmail ingest and executor sends.
-- NOT YET APPLIED. Apply by hand with the owner's approval (psql service=rosably -f ...).
-- Idempotent: safe to re-run.
--
-- Access model unchanged: RLS on, no policies; only service_role (server code) touches these.
-- Ruling R3: links cascade on message and contact delete; lead_id/client_id SET NULL.

begin;

create table if not exists crm.email_messages (
  id               uuid primary key default gen_random_uuid(),
  gmail_message_id text not null unique,
  thread_id        text,
  rfc_message_id   text,
  direction        text not null check (direction in ('received', 'sent')),
  from_email       text,
  from_name        text,
  to_emails        text[] not null default '{}',
  cc_emails        text[] not null default '{}',
  subject          text,
  snippet          text,
  body_text        text,
  sent_at          timestamptz,
  source           text not null check (source in ('gmail_watch', 'forward', 'compose', 'executor')),
  delivered_to_crm boolean not null default false,
  created_at       timestamptz not null default now()
);
create index if not exists email_messages_thread_idx on crm.email_messages (thread_id);
create index if not exists email_messages_rfc_idx on crm.email_messages (rfc_message_id);
create index if not exists email_messages_sent_at_idx on crm.email_messages (sent_at desc);

create table if not exists crm.email_message_links (
  email_message_id uuid not null references crm.email_messages(id) on delete cascade,
  contact_id       uuid not null references crm.contacts(id) on delete cascade,
  lead_id          uuid references crm.leads(id) on delete set null,
  client_id        uuid references crm.clients(id) on delete set null,
  primary key (email_message_id, contact_id)
);
create index if not exists email_message_links_contact_idx on crm.email_message_links (contact_id);
create index if not exists email_message_links_lead_idx on crm.email_message_links (lead_id) where lead_id is not null;

alter table crm.unmatched_email_log
  add column if not exists email_message_id uuid references crm.email_messages(id) on delete set null,
  add column if not exists suggested_contact_id uuid references crm.contacts(id) on delete set null,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_contact_id uuid references crm.contacts(id) on delete set null;
create index if not exists unmatched_email_log_message_idx on crm.unmatched_email_log (email_message_id);

-- Single-row state table: the boolean PK pinned to true makes a second row impossible.
create table if not exists crm.gmail_sync_state (
  id                boolean primary key default true check (id),
  history_id        text,
  watch_expiration  timestamptz,
  last_full_sync_at timestamptz
);
insert into crm.gmail_sync_state (id) values (true) on conflict do nothing;

alter table crm.email_messages enable row level security;
alter table crm.email_message_links enable row level security;
alter table crm.gmail_sync_state enable row level security;

grant select, insert, update, delete on crm.email_messages, crm.email_message_links, crm.gmail_sync_state to service_role;

commit;
