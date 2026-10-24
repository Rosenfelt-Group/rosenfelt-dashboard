-- 2026-10-25 (CRM refresh, stream R): research links and scope research inputs (mockup recommendation 11).
--
-- Brian uses research two ways: research about a prospect or client belongs with the organization
-- (crm.business_research, plus any library brief linked to it), and market research lives in the
-- library (public.research_briefs). Research feeds a scope only when Brian ticks it: nothing is
-- selected by default, and each scope version records what it used.
--
--  - public.research_brief_links: many-to-many library brief <-> organization (crm.businesses).
--    Backfill: Avery saves every organization's research twice (a business_research row and a
--    research_type='business' brief whose topic is the business name); those briefs are linked to
--    the business by exact, case-insensitive name.
--  - crm.scope_research_inputs: what Brian ticked "Use in scope" on, per business (so it works before
--    a scope exists). Exactly one of business_research_id / research_brief_id. A brief selection
--    references its link, so unlinking a brief drops the selection.
--  - crm.scope_versions.research_used: the items a version was drafted with ([] = none).
--  - crm.scope_research_context(business): the selected items with bounded text, for Riley (doc text
--    comes from public.doc_registry, which riley_app cannot read directly).
--  - crm.set_scope_version_research_used(version, items): Riley records research_used on its own
--    versions (riley_app has no direct DML on scope tables).
--
-- Soft delete (stream A1) adds deleted_at to business_research and research_briefs. The context
-- function filters it through to_jsonb(row) so it works before and after that column exists.
-- Idempotent and additive. Applied to prod 2026-10-24 (schema_migrations 20261025000003).
begin;

-- ---------------------------------------------------------------------------------------------
-- Library brief <-> organization links
-- ---------------------------------------------------------------------------------------------
create table if not exists public.research_brief_links (
  brief_id    uuid not null references public.research_briefs(id) on delete cascade,
  business_id uuid not null references crm.businesses(id) on delete cascade,
  linked_by   text,
  created_at  timestamptz not null default now(),
  primary key (brief_id, business_id)
);
create index if not exists research_brief_links_business_idx on public.research_brief_links (business_id);

alter table public.research_brief_links enable row level security;
revoke all on public.research_brief_links from public, anon, authenticated;
grant select, insert, update, delete on public.research_brief_links to service_role;

-- Backfill: organization briefs -> their business, by exact case-insensitive name. A name shared by
-- two businesses links to both (none today: all 7 business briefs match exactly one business).
insert into public.research_brief_links (brief_id, business_id, linked_by)
select rb.id, b.id, 'system'
  from public.research_briefs rb
  join crm.businesses b on lower(btrim(b.name)) = lower(btrim(rb.topic))
 where rb.research_type = 'business'
on conflict (brief_id, business_id) do nothing;

-- Going forward, a new organization brief (Avery still writes one per organization run, from the chat
-- tool and from POST /research/run) is linked the same way when it is inserted.
create or replace function public.research_briefs_link_business()
returns trigger
language plpgsql
security definer
set search_path = crm, public, pg_temp
as $$
begin
  if new.research_type = 'business' then
    insert into public.research_brief_links (brief_id, business_id, linked_by)
    select new.id, b.id, 'system'
      from crm.businesses b
     where lower(btrim(b.name)) = lower(btrim(new.topic))
       and (to_jsonb(b) ->> 'deleted_at') is null
    on conflict (brief_id, business_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.research_briefs_link_business() from public, anon, authenticated;

drop trigger if exists research_briefs_link_business on public.research_briefs;
create trigger research_briefs_link_business
  after insert on public.research_briefs
  for each row execute function public.research_briefs_link_business();

-- ---------------------------------------------------------------------------------------------
-- What Brian chose to feed the scope
-- ---------------------------------------------------------------------------------------------
-- business_research(id, business_id) is unique already (id is the key); the composite constraint lets
-- a selection reference a note *of the same business*.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'business_research_id_business_key'
                    and conrelid = 'crm.business_research'::regclass) then
    alter table crm.business_research add constraint business_research_id_business_key unique (id, business_id);
  end if;
end $$;

create table if not exists crm.scope_research_inputs (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references crm.businesses(id) on delete cascade,
  business_research_id uuid,
  research_brief_id    uuid,
  added_by             text,
  created_at           timestamptz not null default now(),
  constraint scope_research_inputs_one_item check (num_nonnulls(business_research_id, research_brief_id) = 1),
  constraint scope_research_inputs_note_fk foreign key (business_research_id, business_id)
    references crm.business_research (id, business_id) on delete cascade,
  constraint scope_research_inputs_brief_fk foreign key (research_brief_id, business_id)
    references public.research_brief_links (brief_id, business_id) on delete cascade,
  constraint scope_research_inputs_note_key unique (business_id, business_research_id),
  constraint scope_research_inputs_brief_key unique (business_id, research_brief_id)
);

alter table crm.scope_research_inputs enable row level security;
revoke all on crm.scope_research_inputs from public, anon, authenticated;
grant select, insert, update, delete on crm.scope_research_inputs to service_role;

-- ---------------------------------------------------------------------------------------------
-- Which research each scope version used
-- ---------------------------------------------------------------------------------------------
alter table crm.scope_versions add column if not exists research_used jsonb not null default '[]'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'scope_versions_research_used_shape'
                    and conrelid = 'crm.scope_versions'::regclass) then
    alter table crm.scope_versions add constraint scope_versions_research_used_shape
      check (jsonb_typeof(research_used) = 'array');
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Functions for Riley
-- ---------------------------------------------------------------------------------------------
-- The business's selected research, oldest first: [{type: note|brief, id, title, created_at, text}].
-- Each text is cut to p_max_chars. Soft-deleted notes and briefs, and briefs no longer linked, are skipped.
create or replace function crm.scope_research_context(p_business_id uuid, p_max_chars integer default 6000)
returns jsonb
language plpgsql
stable
security definer
set search_path = crm, public, pg_temp
as $$
declare
  v_max integer := greatest(200, least(coalesce(p_max_chars, 6000), 20000));
  v jsonb;
begin
  select coalesce(jsonb_agg(x.item order by x.created_at, x.id), '[]'::jsonb) into v
    from (
      select br.id, br.created_at,
             jsonb_build_object(
               'type', 'note', 'id', br.id, 'created_at', br.created_at,
               'title', left(coalesce(nullif(btrim(br.details ->> 'title'), ''),
                                      case when br.researched_by = 'avery' then 'Avery research' else 'Note' end), 200),
               'text', left(concat_ws(e'\n\n', br.summary,
                              (select string_agg('- ' || coalesce(f ->> 'title', '') ||
                                                 coalesce(': ' || (f ->> 'description'), ''), e'\n')
                                 from jsonb_array_elements(case when jsonb_typeof(br.details -> 'findings') = 'array'
                                                                then br.details -> 'findings' else '[]'::jsonb end) f)),
                            v_max)) as item
        from crm.scope_research_inputs si
        join crm.business_research br on br.id = si.business_research_id and br.business_id = si.business_id
       where si.business_id = p_business_id
         and (to_jsonb(br) ->> 'deleted_at') is null
      union all
      select rb.id, rb.created_at,
             jsonb_build_object(
               'type', 'brief', 'id', rb.id, 'created_at', rb.created_at,
               'title', left(rb.topic, 200), 'research_type', rb.research_type,
               'text', left(coalesce(d.content, ''), v_max)) as item
        from crm.scope_research_inputs si
        join public.research_brief_links l on l.brief_id = si.research_brief_id and l.business_id = si.business_id
        join public.research_briefs rb on rb.id = si.research_brief_id
        left join public.doc_registry d
               on d.id = case when rb.doc_id ~ '^[0-9]{1,18}$' then rb.doc_id::bigint end
       where si.business_id = p_business_id
         and (to_jsonb(rb) ->> 'deleted_at') is null
    ) x;
  return v;
end;
$$;

-- Riley records which research a version it created was drafted with. Only versions Riley created
-- (version 1 from the brief, or a proposal), and only as an array of {type, id, title} objects.
create or replace function crm.set_scope_version_research_used(p_version_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = crm, public, pg_temp
as $$
declare
  v_rows integer;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 100 then
    raise exception 'research_used must be an array of at most 100 items' using errcode = 'SC005';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e
              where jsonb_typeof(e) <> 'object'
                 or (e ->> 'type') is null or (e ->> 'type') not in ('note', 'brief')
                 or (e ->> 'id') is null
                 or (e ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'each research_used item needs type note|brief and a uuid id' using errcode = 'SC005';
  end if;
  update crm.scope_versions set research_used = p_items
   where id = p_version_id and created_by = 'riley' and source in ('brief', 'riley');
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'scope version % not found or not created by riley', p_version_id using errcode = 'SC003';
  end if;
end;
$$;

revoke all on function crm.scope_research_context(uuid, integer) from public, anon, authenticated;
revoke all on function crm.set_scope_version_research_used(uuid, jsonb) from public, anon, authenticated;
grant execute on function crm.scope_research_context(uuid, integer) to service_role;
grant execute on function crm.set_scope_version_research_used(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------------------------
-- riley_app: read the selections and research; write research_used only through the function
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'riley_app') then
    grant usage on schema crm, public to riley_app;
    grant select on crm.scope_research_inputs to riley_app;
    drop policy if exists riley_read_scope_research_inputs on crm.scope_research_inputs;
    create policy riley_read_scope_research_inputs on crm.scope_research_inputs for select to riley_app using (true);
    grant select on public.research_brief_links to riley_app;
    drop policy if exists riley_read_research_brief_links on public.research_brief_links;
    create policy riley_read_research_brief_links on public.research_brief_links for select to riley_app using (true);
    grant select on public.research_briefs to riley_app;
    drop policy if exists riley_read_research_briefs on public.research_briefs;
    create policy riley_read_research_briefs on public.research_briefs for select to riley_app using (true);
    -- crm.business_research select + policy already come from 2026-10-22_riley_app_role.sql
    grant execute on function crm.scope_research_context(uuid, integer) to riley_app;
    grant execute on function crm.set_scope_version_research_used(uuid, jsonb) to riley_app;
  end if;
end $$;

commit;
