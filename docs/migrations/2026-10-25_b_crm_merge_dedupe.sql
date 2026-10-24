-- 2026-10-25 (stream A2): merge organizations, people and deals; flag possible duplicates; intake
-- matches a business by work-email domain or website domain.
--
-- 1. crm.merge_businesses / merge_contacts / merge_leads (p_keep, p_merge, p_fields, p_by) -> jsonb.
--    Each runs in one transaction. It repoints every row that references the merged record, using
--    the live FK list from pg_constraint, so a table added later is moved too. It handles the unique
--    indexes that can collide, then checks that nothing references the merged record any more and
--    only then deletes it. Deleting a lead cascades to its activities and discovery invites, which
--    is why the order matters. The kept record gets a system "Merged from …" activity, and
--    crm.merge_redirects maps the merged id to the kept id (with a JSON snapshot of the deleted row)
--    so old links redirect. Chains are flattened: A->B then B->C makes A point at C.
--    p_fields picks a side per field: {"name":"merge","notes":"both"}. A field left out keeps the
--    kept record's value, or takes the merged value when the kept one is empty. Deal attribution
--    (source, UTMs, referrer, landing path, entry stage) is never filled in automatically, and an
--    ebook or quiz signup's attribution can't be moved onto the surviving deal at all: it stays on
--    the moved intake activity (metadata.attribution, metadata.merged_from_lead_id).
-- 2. crm.merge_preview(kind, keep, merge): both rows, per-field choices and counts of what moves.
-- 3. crm.duplicate_candidates(): pairs that look like duplicates (shared work domain, similar
--    names via pg_trgm or an exact normalized-name fallback, the same mailbox, two open deals at one
--    organization, or a marketing deal opened at an existing client). crm.duplicate_dismissals and
--    crm.dismiss_duplicate() hide a pair.
-- 4. crm.intake_lead: when the contact is new and the form left "org" blank, a non-free-mail email
--    domain now matches an existing business by a colleague's email domain, the business email or
--    the website domain, instead of creating a business named after the domain. Every earlier rule
--    (R9, R10, R11 and its trust check) is unchanged: a website match alone never reaches the won
--    lead, because R11 still needs another contact with the same work domain. Rows in Trash
--    (deleted_at set) are never matched; a signup from a contact in Trash restores that contact.
--    The result gains `business_match` ('contact' | 'name' | 'domain' | 'created').
--
-- deleted_at/deleted_by are added here with IF NOT EXISTS too, so this file works whether or not
-- stream A1's 2026-10-25_a_crm_soft_delete.sql ran first (same column definitions).
-- Supersedes intake_lead in 2026-10-24_intake_existing_client.sql. The v_stages array must match
-- src/lib/crm/stages.ts, crm.freemail_domains() must match FREE_MAIL_DOMAINS in
-- src/lib/crm/suggest.ts, and the merge field lists must match src/lib/crm/merge.ts (all enforced
-- by vitest). Idempotent.
begin;

alter table crm.businesses add column if not exists deleted_at timestamptz;
alter table crm.businesses add column if not exists deleted_by text;
alter table crm.contacts   add column if not exists deleted_at timestamptz;
alter table crm.contacts   add column if not exists deleted_by text;
alter table crm.leads      add column if not exists deleted_at timestamptz;
alter table crm.leads      add column if not exists deleted_by text;
alter table crm.clients    add column if not exists deleted_at timestamptz;
alter table crm.clients    add column if not exists deleted_by text;

-- pg_trgm powers name similarity. If it can't be created, duplicate_candidates falls back to an
-- exact match on normalized names.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_trgm') then
    begin
      create extension pg_trgm with schema extensions;
    exception when others then
      raise notice 'pg_trgm unavailable (%): similar-name duplicates use exact normalized names', sqlerrm;
    end;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Domain and name helpers (pure; used by intake and duplicate detection)
-- ---------------------------------------------------------------------------------------------

-- Must match FREE_MAIL_DOMAINS in src/lib/crm/suggest.ts (enforced by freemail.sql-sync.test.ts).
create or replace function crm.freemail_domains()
 returns text[] language sql immutable parallel safe
 set search_path = pg_catalog, pg_temp
as $$
  select array['gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','msn.com','yahoo.com','ymail.com','rocketmail.com','icloud.com','me.com','mac.com','aol.com','proton.me','protonmail.com','pm.me','gmx.com','gmx.net','mail.com','zoho.com','zohomail.com','fastmail.com','hey.com','yandex.com','tutanota.com','comcast.net','verizon.net','att.net','sbcglobal.net','cox.net','charter.net','earthlink.net']::text[]
$$;

-- Hosts that many unrelated organizations share (site builders, social profiles, link pages).
-- A website on one of these is not evidence that two records are the same organization.
create or replace function crm.shared_web_hosts()
 returns text[] language sql immutable parallel safe
 set search_path = pg_catalog, pg_temp
as $$
  select array['wixsite.com','wix.com','squarespace.com','wordpress.com','weebly.com','godaddysites.com','google.com','facebook.com','fb.com','instagram.com','linkedin.com','twitter.com','x.com','youtube.com','tiktok.com','linktr.ee','carrd.co','square.site','github.io','blogspot.com','webflow.io','myshopify.com','canva.site','eventbrite.com','gofundme.com','givebutter.com','paypal.com','bit.ly']::text[]
$$;

-- 'Jo@Example.ORG ' -> 'example.org'
create or replace function crm.email_domain(p text)
 returns text language sql immutable parallel safe
 set search_path = pg_catalog, pg_temp
as $$
  select nullif(substring(lower(btrim(p)) from '@([^@]+)$'), '')
$$;

-- 'https://www.Example.org/about?x' -> 'example.org'; null unless it looks like a host name.
create or replace function crm.website_domain(p text)
 returns text language sql immutable parallel safe
 set search_path = pg_catalog, pg_temp
as $$
  select case when d ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' then d end
  from (select regexp_replace(regexp_replace(regexp_replace(regexp_replace(lower(btrim(coalesce(p, ''))),
          '^[a-z][a-z0-9+.-]*://', ''), '^[^/@]*@', ''), '[/?#:].*$', ''), '^www\.', '') as d) x
$$;

-- The domain when it can identify one organization: null for free-mail and shared hosts.
create or replace function crm.org_domain(p_domain text)
 returns text language sql immutable parallel safe
 set search_path = pg_catalog, pg_temp
as $$
  select case
    when p_domain is null or p_domain = '' then null
    when p_domain = any (crm.freemail_domains()) then null
    when exists (select 1 from unnest(crm.shared_web_hosts()) h
                 where p_domain = h or right(p_domain, length(h) + 1) = '.' || h) then null
    else p_domain end
$$;

-- One mailbox, several spellings: drops +tags, and dots for Gmail. 'J.Doe+news@GoogleMail.com' -> 'jdoe@gmail.com'
create or replace function crm.mailbox_norm(p text)
 returns text language sql immutable parallel safe
 set search_path = pg_catalog, pg_temp
as $$
  select case when l is null or l = '' or d is null then null
              when d in ('gmail.com','googlemail.com') then replace(l, '.', '') || '@gmail.com'
              else l || '@' || d end
  from (select split_part(split_part(lower(btrim(p)), '@', 1), '+', 1) as l, crm.email_domain(p) as d) x
$$;

-- 'The Harbor Light Food Pantry, Inc.' -> 'harbor light food pantry'
create or replace function crm.org_name_norm(p text)
 returns text language sql immutable parallel safe
 set search_path = pg_catalog, pg_temp
as $$
  select nullif(btrim(regexp_replace(regexp_replace(regexp_replace(lower(coalesce(p, '')),
           '[^a-z0-9]+', ' ', 'g'), '\m(the|inc|llc|ltd|co|corp|corporation|company|org)\M', ' ', 'g'),
           '\s+', ' ', 'g')), '')
$$;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table if not exists crm.merge_redirects (
  merged_id    uuid primary key,
  kind         text not null check (kind in ('business','contact','lead')),
  kept_id      uuid not null,
  merged_label text,
  merged_by    text,
  merged_at    timestamptz not null default now(),
  moved        jsonb not null default '{}'::jsonb,
  snapshot     jsonb
);
create index if not exists merge_redirects_kept_idx on crm.merge_redirects (kind, kept_id);
comment on table crm.merge_redirects is
  'Merged record id -> surviving record id, so old links redirect. snapshot is the deleted row. Written by crm.merge_*.';

create table if not exists crm.duplicate_dismissals (
  kind         text not null check (kind in ('business','contact','lead')),
  id_a         uuid not null,
  id_b         uuid not null,
  dismissed_by text,
  dismissed_at timestamptz not null default now(),
  note         text,
  primary key (kind, id_a, id_b),
  check (id_a < id_b)
);
comment on table crm.duplicate_dismissals is
  '"Not a duplicate" decisions; crm.duplicate_candidates() skips these pairs. id_a < id_b.';

alter table crm.merge_redirects enable row level security;
alter table crm.duplicate_dismissals enable row level security;
revoke all on crm.merge_redirects, crm.duplicate_dismissals from public, anon, authenticated;
grant select, insert, update, delete on crm.merge_redirects, crm.duplicate_dismissals to service_role;

-- ---------------------------------------------------------------------------------------------
-- Generic reference handling (internal)
-- ---------------------------------------------------------------------------------------------

-- Single-column FKs pointing at a table, read live from pg_constraint.
create or replace function crm.merge_fk_refs(p_target regclass)
 returns table (tbl regclass, col name, key text)
 language sql stable
 set search_path = crm, public, pg_temp
as $$
  select c.conrelid::regclass, a.attname, n.nspname || '.' || r.relname || '.' || a.attname
  from pg_constraint c
  join pg_class r on r.oid = c.conrelid
  join pg_namespace n on n.oid = r.relnamespace
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.contype = 'f' and c.confrelid = p_target and cardinality(c.conkey) = 1
  order by 3
$$;

-- {"crm.leads.business_id": 3, ...} for rows referencing p_id (non-zero entries only).
create or replace function crm.merge_ref_counts(p_target regclass, p_id uuid)
 returns jsonb
 language plpgsql stable
 set search_path = crm, public, pg_temp
as $$
declare r record; n bigint; v jsonb := '{}'::jsonb;
begin
  for r in select * from crm.merge_fk_refs(p_target) loop
    execute format('select count(*) from %s where %I = $1', r.tbl, r.col) into n using p_id;
    if n > 0 then v := v || jsonb_build_object(r.key, n); end if;
  end loop;
  return v;
end $$;

-- Points every FK reference at p_from to p_to; returns counts like merge_ref_counts.
create or replace function crm.merge_repoint(p_target regclass, p_from uuid, p_to uuid)
 returns jsonb
 language plpgsql
 set search_path = crm, public, pg_temp
as $$
declare r record; n bigint; v jsonb := '{}'::jsonb;
begin
  for r in select * from crm.merge_fk_refs(p_target) loop
    execute format('update %s set %I = $1 where %I = $2', r.tbl, r.col, r.col) using p_to, p_from;
    get diagnostics n = row_count;
    if n > 0 then v := v || jsonb_build_object(r.key, n); end if;
  end loop;
  return v;
end $$;

-- Validates p_fields against the allowed fields and returns the merged-side row with the chosen
-- values applied (as jsonb). Defaults: absent field -> keep, unless the kept value is null and the
-- field is fillable. 'both' (notes only) joins the two values.
create or replace function crm.merge_apply_fields(p_keep jsonb, p_merge jsonb, p_fields jsonb,
                                                  p_allowed text[], p_fillable text[], p_locked text[])
 returns jsonb
 language plpgsql immutable
 set search_path = crm, public, pg_temp
as $$
declare k text; c text; v jsonb := p_keep;
begin
  if p_fields is not null and jsonb_typeof(p_fields) <> 'object' then
    raise exception 'merge: fields must be an object' using errcode = 'MG005';
  end if;
  for k, c in select key, value #>> '{}' from jsonb_each(coalesce(p_fields, '{}'::jsonb)) loop
    if not (k = any (p_allowed)) then
      raise exception 'merge: unknown field %', k using errcode = 'MG005';
    end if;
    if c not in ('keep', 'merge', 'both') or (c = 'both' and k <> 'notes') then
      raise exception 'merge: field % must be "keep" or "merge"%', k,
        case when k = 'notes' then ' or "both"' else '' end using errcode = 'MG005';
    end if;
    if c <> 'keep' and k = any (p_locked) then
      raise exception 'merge: % stays with the surviving record', k using errcode = 'MG005';
    end if;
  end loop;
  foreach k in array p_allowed loop
    c := coalesce(p_fields->>k, case when k = any (p_fillable) and coalesce(p_keep->>k, '') = ''
                                      and coalesce(p_merge->>k, '') <> '' then 'merge' else 'keep' end);
    if c = 'merge' then
      v := jsonb_set(v, array[k], coalesce(p_merge->k, 'null'::jsonb));
    elsif c = 'both' then
      v := jsonb_set(v, array[k], to_jsonb(nullif(concat_ws(E'\n\n', nullif(p_keep->>k, ''), nullif(p_merge->>k, '')), '')));
    end if;
  end loop;
  return v;
end $$;

-- logged_by must be one of the known actors; anyone else is recorded as system (metadata.merged_by keeps the name).
create or replace function crm.merge_actor(p_by text)
 returns text language sql immutable
 set search_path = pg_catalog, pg_temp
as $$
  select case when lower(p_by) = any (array['brian','jordan','riley','avery','casey','sam','pickle']) then lower(p_by) else 'system' end
$$;

-- Records the redirect (flattening chains) and drops dismissals that name the merged record.
create or replace function crm.merge_record_redirect(p_kind text, p_keep uuid, p_merge uuid, p_label text,
                                                     p_by text, p_moved jsonb, p_snapshot jsonb)
 returns void
 language plpgsql
 set search_path = crm, public, pg_temp
as $$
begin
  update merge_redirects set kept_id = p_keep where kind = p_kind and kept_id = p_merge;
  insert into merge_redirects (merged_id, kind, kept_id, merged_label, merged_by, moved, snapshot)
  values (p_merge, p_kind, p_keep, p_label, p_by, p_moved, p_snapshot)
  on conflict (merged_id) do update set kept_id = excluded.kept_id, merged_at = now(),
    merged_label = excluded.merged_label, merged_by = excluded.merged_by, moved = excluded.moved,
    snapshot = excluded.snapshot;
  delete from duplicate_dismissals where kind = p_kind and (id_a = p_merge or id_b = p_merge);
end $$;

-- Raises unless nothing references p_id (the repoint-before-delete guarantee).
create or replace function crm.merge_assert_unreferenced(p_target regclass, p_id uuid)
 returns void
 language plpgsql stable
 set search_path = crm, public, pg_temp
as $$
declare v jsonb := crm.merge_ref_counts(p_target, p_id);
begin
  if v <> '{}'::jsonb then
    raise exception 'merge: % % is still referenced by %', p_target, p_id, v using errcode = 'MG007';
  end if;
end $$;

-- Field lists. Must match MERGE_FIELDS in src/lib/crm/merge.ts (enforced by merge.sql-sync.test.ts).
create or replace function crm.merge_fields(p_kind text)
 returns text[] language sql immutable
 set search_path = pg_catalog, pg_temp
as $$
  select case p_kind
    when 'business' then array['name','website','phone','email','address','industry','size','source','notes']
    when 'contact'  then array['first_name','last_name','email','phone','title','role','linkedin_url','is_primary','business_id','notes']
    when 'lead'     then array['stage','estimated_value','contact_id','assigned_agent','close_date','lost_reason','source','entry_stage','utm_source','utm_medium','utm_campaign','utm_content','utm_term','referrer','landing_path','quiz_url']
  end
$$;

-- Fields filled from the merged record when the kept one is empty and p_fields doesn't say.
create or replace function crm.merge_fillable(p_kind text)
 returns text[] language sql immutable
 set search_path = pg_catalog, pg_temp
as $$
  select case p_kind
    when 'business' then array['website','phone','email','address','industry','size','source','notes']
    when 'contact'  then array['last_name','email','phone','title','role','linkedin_url','business_id','notes']
    when 'lead'     then array['estimated_value','contact_id','assigned_agent','close_date']
  end
$$;

-- Deal attribution; never filled automatically, and locked when the merged deal is an ebook/quiz signup.
create or replace function crm.merge_lead_attribution_fields()
 returns text[] language sql immutable
 set search_path = pg_catalog, pg_temp
as $$
  select array['source','entry_stage','utm_source','utm_medium','utm_campaign','utm_content','utm_term','referrer','landing_path','quiz_url']
$$;

-- Common checks: distinct ids, both exist, neither in Trash. Locks both rows in id order.
create or replace function crm.merge_lock_pair(p_kind text, p_keep uuid, p_merge uuid)
 returns void
 language plpgsql
 set search_path = crm, public, pg_temp
as $$
declare v_tbl text := case p_kind when 'business' then 'crm.businesses' when 'contact' then 'crm.contacts'
                                  when 'lead' then 'crm.leads' end;
        n int; d int;
begin
  if v_tbl is null then
    raise exception 'merge: unknown kind %', p_kind using errcode = 'MG006';
  end if;
  if p_keep is null or p_merge is null or p_keep = p_merge then
    raise exception 'merge: pick two different records' using errcode = 'MG002';
  end if;
  execute format('select count(*), count(deleted_at) from (select deleted_at from %s where id = any ($1) order by id for update) x', v_tbl)
    into n, d using array[p_keep, p_merge];
  if n < 2 then
    raise exception 'merge: % not found', p_kind using errcode = 'MG001';
  end if;
  if d > 0 then
    raise exception 'merge: a record in Trash can''t be merged; restore it first' using errcode = 'MG003';
  end if;
end $$;

-- Anchor for an organization-level note: newest client, else newest deal, else oldest person.
create or replace function crm.merge_business_anchor(p_business uuid, out lead_id uuid, out contact_id uuid, out client_id uuid)
 language plpgsql stable
 set search_path = crm, public, pg_temp
as $$
begin
  select c.id, c.lead_id, c.contact_id into client_id, lead_id, contact_id
  from clients c where c.business_id = p_business and c.deleted_at is null order by c.created_at desc limit 1;
  if client_id is not null then return; end if;
  select l.id, l.contact_id into lead_id, contact_id
  from leads l where l.business_id = p_business and l.deleted_at is null order by l.created_at desc limit 1;
  if lead_id is not null then return; end if;
  select c.id into contact_id
  from contacts c where c.business_id = p_business and c.deleted_at is null order by c.created_at limit 1;
end $$;

-- ---------------------------------------------------------------------------------------------
-- crm.merge_businesses
-- ---------------------------------------------------------------------------------------------
create or replace function crm.merge_businesses(p_keep uuid, p_merge uuid, p_fields jsonb default '{}'::jsonb, p_by text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path = crm, public, pg_temp
as $$
declare
  v_keep businesses; v_merge businesses; v_new businesses;
  v_moved jsonb; v_unlinked jsonb; n_lead int; n_client int; n_brief int := 0; n_inputs int;
  v_inputs jsonb; v_anchor record; v_note uuid;
begin
  perform crm.merge_lock_pair('business', p_keep, p_merge);
  select * into v_keep from businesses where id = p_keep;
  select * into v_merge from businesses where id = p_merge;

  v_new := jsonb_populate_record(v_keep, crm.merge_apply_fields(to_jsonb(v_keep), to_jsonb(v_merge), p_fields,
             crm.merge_fields('business'), crm.merge_fillable('business'), '{}'));

  -- Unique (business_id, lead_id) / (business_id, client_id) on scope_documents: a merged-side scope
  -- that duplicates one already on the kept business loses that link (the document itself stays).
  update scope_documents m set lead_id = null
  where m.business_id = p_merge and m.lead_id is not null
    and exists (select 1 from scope_documents k where k.business_id = p_keep and k.lead_id = m.lead_id);
  get diagnostics n_lead = row_count;
  update scope_documents m set client_id = null
  where m.business_id = p_merge and m.client_id is not null
    and exists (select 1 from scope_documents k where k.business_id = p_keep and k.client_id = m.client_id);
  get diagnostics n_client = row_count;
  v_unlinked := jsonb_strip_nulls(jsonb_build_object('scope_documents_lead', nullif(n_lead, 0),
                                                     'scope_documents_client', nullif(n_client, 0)));

  -- Research tables (2026-10-25_c_research_scope_inputs.sql), when present. scope_research_inputs
  -- has composite FKs (item, business_id) into research_brief_links and business_research, so its
  -- merged-side rows can't be repointed in place: they are lifted out and put back after the move.
  -- A brief linked to both organizations keeps one link (research_brief_links PK).
  if to_regclass('crm.scope_research_inputs') is not null then
    select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) into v_inputs
    from crm.scope_research_inputs s where s.business_id = p_merge;
    delete from crm.scope_research_inputs where business_id = p_merge;
  end if;
  if to_regclass('public.research_brief_links') is not null then
    delete from public.research_brief_links m
    where m.business_id = p_merge
      and exists (select 1 from public.research_brief_links k where k.business_id = p_keep and k.brief_id = m.brief_id);
    get diagnostics n_brief = row_count;
  end if;

  v_moved := crm.merge_repoint('crm.businesses', p_merge, p_keep);

  if v_inputs is not null and jsonb_array_length(v_inputs) > 0 then
    insert into crm.scope_research_inputs (id, business_id, business_research_id, research_brief_id, added_by, created_at)
    select x.id, p_keep, x.business_research_id, x.research_brief_id, x.added_by, x.created_at
    from jsonb_populate_recordset(null::crm.scope_research_inputs, v_inputs) x
    on conflict do nothing;
    get diagnostics n_inputs = row_count;
    v_moved := v_moved || jsonb_build_object('crm.scope_research_inputs.business_id', n_inputs);
  end if;
  if n_brief > 0 then
    v_unlinked := v_unlinked || jsonb_build_object('research_brief_links_combined', n_brief);
  end if;
  perform crm.merge_assert_unreferenced('crm.businesses', p_merge);

  update businesses set name = v_new.name, website = v_new.website, phone = v_new.phone, email = v_new.email,
         address = v_new.address, industry = v_new.industry, size = v_new.size, source = v_new.source,
         notes = v_new.notes
  where id = p_keep;

  select * into v_anchor from crm.merge_business_anchor(p_keep);
  if coalesce(v_anchor.lead_id, v_anchor.contact_id, v_anchor.client_id) is not null then
    insert into lead_activities (lead_id, contact_id, client_id, activity_type, content, logged_by, metadata)
    values (v_anchor.lead_id, v_anchor.contact_id, v_anchor.client_id, 'system',
            format('Merged from organization "%s"', v_merge.name), crm.merge_actor(p_by),
            jsonb_build_object('merge', jsonb_build_object('kind', 'business', 'kept_id', p_keep, 'merged_id', p_merge,
                                                           'merged_by', p_by, 'moved', v_moved, 'unlinked', v_unlinked),
                               'business_id', p_keep))
    returning id into v_note;
  end if;

  perform crm.merge_record_redirect('business', p_keep, p_merge, v_merge.name, p_by, v_moved, to_jsonb(v_merge));
  delete from businesses where id = p_merge;

  return jsonb_build_object('kind', 'business', 'kept_id', p_keep, 'merged_id', p_merge,
                            'moved', v_moved, 'unlinked', v_unlinked, 'note_activity_id', v_note);
end $$;

-- ---------------------------------------------------------------------------------------------
-- crm.merge_contacts
-- ---------------------------------------------------------------------------------------------
create or replace function crm.merge_contacts(p_keep uuid, p_merge uuid, p_fields jsonb default '{}'::jsonb, p_by text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path = crm, public, pg_temp
as $$
declare
  v_keep contacts; v_merge contacts; v_new contacts;
  v_moved jsonb; n_links int; n_acts int; v_note uuid; v_label text;
begin
  perform crm.merge_lock_pair('contact', p_keep, p_merge);
  select * into v_keep from contacts where id = p_keep;
  select * into v_merge from contacts where id = p_merge;
  v_label := btrim(concat_ws(' ', v_merge.first_name, v_merge.last_name))
             || coalesce(' <' || v_merge.email || '>', '');

  v_new := jsonb_populate_record(v_keep, crm.merge_apply_fields(to_jsonb(v_keep) - 'email_norm', to_jsonb(v_merge) - 'email_norm',
             p_fields, crm.merge_fields('contact'), crm.merge_fillable('contact'), '{}'));
  if v_new.business_id is not null and not exists (select 1 from businesses where id = v_new.business_id and deleted_at is null) then
    v_new.business_id := v_keep.business_id;
  end if;

  -- email_message_links PK (email_message_id, contact_id): one message linked to both people
  -- becomes one link on the kept person (its lead/client links are combined).
  update email_message_links k set lead_id = coalesce(k.lead_id, m.lead_id), client_id = coalesce(k.client_id, m.client_id)
  from email_message_links m
  where k.contact_id = p_keep and m.contact_id = p_merge and m.email_message_id = k.email_message_id;
  delete from email_message_links m using email_message_links k
  where m.contact_id = p_merge and k.contact_id = p_keep and k.email_message_id = m.email_message_id;
  get diagnostics n_links = row_count;
  -- Unique (metadata->>'email_message_id', contact_id) on email activities: the same message logged
  -- for both people is kept once, on the kept person.
  delete from lead_activities m using lead_activities k
  where m.contact_id = p_merge and k.contact_id = p_keep
    and m.activity_type in ('email_received','email_sent') and k.activity_type in ('email_received','email_sent')
    and m.metadata->>'email_message_id' = k.metadata->>'email_message_id';
  get diagnostics n_acts = row_count;

  v_moved := crm.merge_repoint('crm.contacts', p_merge, p_keep);
  perform crm.merge_assert_unreferenced('crm.contacts', p_merge);

  -- contacts.email_norm is unique: free the merged address before the kept row takes it.
  update contacts set email = null where id = p_merge;
  update contacts set first_name = v_new.first_name, last_name = v_new.last_name, email = v_new.email,
         phone = v_new.phone, title = v_new.title, role = v_new.role, linkedin_url = v_new.linkedin_url,
         is_primary = v_new.is_primary, business_id = v_new.business_id,
         notes = v_new.notes
  where id = p_keep;

  insert into lead_activities (contact_id, activity_type, content, logged_by, metadata)
  values (p_keep, 'system', format('Merged from person "%s"', v_label), crm.merge_actor(p_by),
          jsonb_build_object('merge', jsonb_build_object('kind', 'contact', 'kept_id', p_keep, 'merged_id', p_merge,
                                                         'merged_by', p_by, 'moved', v_moved,
                                                         'combined', jsonb_strip_nulls(jsonb_build_object(
                                                           'email_message_links', nullif(n_links, 0),
                                                           'email_activities', nullif(n_acts, 0))))))
  returning id into v_note;

  perform crm.merge_record_redirect('contact', p_keep, p_merge, v_label, p_by, v_moved, to_jsonb(v_merge));
  delete from contacts where id = p_merge;

  return jsonb_build_object('kind', 'contact', 'kept_id', p_keep, 'merged_id', p_merge, 'moved', v_moved,
                            'combined', jsonb_strip_nulls(jsonb_build_object('email_message_links', nullif(n_links, 0),
                                                                             'email_activities', nullif(n_acts, 0))),
                            'note_activity_id', v_note);
end $$;

-- ---------------------------------------------------------------------------------------------
-- crm.merge_leads
-- ---------------------------------------------------------------------------------------------
create or replace function crm.merge_leads(p_keep uuid, p_merge uuid, p_fields jsonb default '{}'::jsonb, p_by text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path = crm, public, pg_temp
as $$
declare
  v_keep leads; v_merge leads; v_new leads;
  v_signup boolean; v_attr jsonb; v_moved jsonb; n_scope int; v_note uuid; v_label text;
begin
  perform crm.merge_lock_pair('lead', p_keep, p_merge);
  select * into v_keep from leads where id = p_keep;
  select * into v_merge from leads where id = p_merge;
  if v_keep.business_id <> v_merge.business_id then
    raise exception 'merge: these deals belong to different organizations; merge the organizations first'
      using errcode = 'MG004';
  end if;
  v_signup := v_merge.source in ('ebook', 'quiz');
  v_label := coalesce(v_merge.source, 'deal') || ' deal (' || v_merge.stage || ', '
             || to_char(v_merge.created_at at time zone 'UTC', 'YYYY-MM-DD') || ')';

  v_new := jsonb_populate_record(v_keep, crm.merge_apply_fields(to_jsonb(v_keep), to_jsonb(v_merge), p_fields,
             crm.merge_fields('lead'), crm.merge_fillable('lead'),
             case when v_signup then crm.merge_lead_attribution_fields() else '{}'::text[] end));
  if v_new.contact_id is not null and not exists (select 1 from contacts where id = v_new.contact_id and deleted_at is null) then
    v_new.contact_id := v_keep.contact_id;
  end if;

  v_attr := jsonb_strip_nulls(jsonb_build_object(
    'source', v_merge.source, 'entry_stage', v_merge.entry_stage, 'stage', v_merge.stage,
    'estimated_value', v_merge.estimated_value, 'utm_source', v_merge.utm_source, 'utm_medium', v_merge.utm_medium,
    'utm_campaign', v_merge.utm_campaign, 'utm_content', v_merge.utm_content, 'utm_term', v_merge.utm_term,
    'referrer', v_merge.referrer, 'landing_path', v_merge.landing_path, 'quiz_url', v_merge.quiz_url,
    'first_touch_at', v_merge.first_touch_at, 'lead_created_at', v_merge.created_at));

  -- The merged deal's activities move with a pointer back; its intake keeps the attribution.
  update lead_activities
     set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('merged_from_lead_id', p_merge)
                    || case when activity_type = 'intake' then jsonb_build_object('attribution', v_attr) else '{}'::jsonb end
   where lead_id = p_merge;
  if not exists (select 1 from lead_activities where lead_id = p_merge and activity_type = 'intake') then
    -- deals created by hand have no intake row; keep the touchpoint anyway, at its original time
    insert into lead_activities (lead_id, contact_id, activity_type, content, logged_by, metadata, created_at)
    values (p_merge, v_merge.contact_id, 'intake', format('Opened as a %s deal', coalesce(v_merge.source, 'new')), 'system',
            jsonb_build_object('channel', v_merge.source, 'touchpoint', true, 'merged_from_lead_id', p_merge,
                               'attribution', v_attr),
            v_merge.created_at);
  end if;

  -- Unique (business_id, lead_id) on scope_documents: if both deals have a scope, the merged deal's
  -- scope stays on the organization without a deal link.
  update scope_documents m set lead_id = null
  where m.lead_id = p_merge and exists (select 1 from scope_documents k where k.lead_id = p_keep and k.business_id = m.business_id);
  get diagnostics n_scope = row_count;

  v_moved := crm.merge_repoint('crm.leads', p_merge, p_keep);
  perform crm.merge_assert_unreferenced('crm.leads', p_merge);

  update leads set stage = v_new.stage, estimated_value = v_new.estimated_value, contact_id = v_new.contact_id,
         assigned_agent = v_new.assigned_agent, close_date = v_new.close_date, lost_reason = v_new.lost_reason,
         source = v_new.source, entry_stage = v_new.entry_stage, utm_source = v_new.utm_source,
         utm_medium = v_new.utm_medium, utm_campaign = v_new.utm_campaign, utm_content = v_new.utm_content,
         utm_term = v_new.utm_term, referrer = v_new.referrer, landing_path = v_new.landing_path,
         quiz_url = v_new.quiz_url, converted_at = coalesce(converted_at, v_merge.converted_at)
  where id = p_keep;

  insert into lead_activities (lead_id, contact_id, activity_type, content, logged_by, metadata)
  values (p_keep, v_new.contact_id, 'system', format('Merged from %s', v_label), crm.merge_actor(p_by),
          jsonb_build_object('merge', jsonb_build_object('kind', 'lead', 'kept_id', p_keep, 'merged_id', p_merge,
                                                         'merged_by', p_by, 'moved', v_moved,
                                                         'unlinked', jsonb_strip_nulls(jsonb_build_object('scope_documents_lead', nullif(n_scope, 0)))),
                             'merged_from_lead_id', p_merge, 'attribution', v_attr))
  returning id into v_note;

  perform crm.merge_record_redirect('lead', p_keep, p_merge, v_label, p_by, v_moved, to_jsonb(v_merge));
  delete from leads where id = p_merge;

  return jsonb_build_object('kind', 'lead', 'kept_id', p_keep, 'merged_id', p_merge, 'moved', v_moved,
                            'unlinked', jsonb_strip_nulls(jsonb_build_object('scope_documents_lead', nullif(n_scope, 0))),
                            'note_activity_id', v_note);
end $$;

-- ---------------------------------------------------------------------------------------------
-- crm.merge_preview
-- ---------------------------------------------------------------------------------------------
-- {kind, keep, merge, fields: [{field, keep, merge, default, locked}], moves: {"crm.leads.business_id": n},
--  collisions: {...}, warnings: [text]}. Raises the same MG00x errors as the merge.
create or replace function crm.merge_preview(p_kind text, p_keep uuid, p_merge uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path = crm, public, pg_temp
as $$
declare
  v_tbl regclass; k jsonb; m jsonb; f text; v_fields jsonb := '[]'::jsonb; v_locked text[] := '{}';
  v_fill text[]; v_coll jsonb := '{}'::jsonb; v_warn jsonb := '[]'::jsonb; n int;
begin
  perform crm.merge_lock_pair(p_kind, p_keep, p_merge);  -- validates; the lock ends with the call
  v_tbl := case p_kind when 'business' then 'crm.businesses' when 'contact' then 'crm.contacts' else 'crm.leads' end;
  execute format('select to_jsonb(t) - ''email_norm'' from %s t where id = $1', v_tbl) into k using p_keep;
  execute format('select to_jsonb(t) - ''email_norm'' from %s t where id = $1', v_tbl) into m using p_merge;
  v_fill := crm.merge_fillable(p_kind);

  if p_kind = 'lead' then
    if k->>'business_id' <> m->>'business_id' then
      raise exception 'merge: these deals belong to different organizations; merge the organizations first'
        using errcode = 'MG004';
    end if;
    if m->>'source' in ('ebook', 'quiz') then
      v_locked := crm.merge_lead_attribution_fields();
      v_warn := v_warn || to_jsonb(format('The %s signup''s attribution stays on its timeline entry, not on the surviving deal.', m->>'source'));
    end if;
    select count(*) into n from scope_documents a join scope_documents b on b.business_id = a.business_id
      where a.lead_id = p_keep and b.lead_id = p_merge;
    if n > 0 then
      v_coll := v_coll || jsonb_build_object('scope_documents_lead', n);
      v_warn := v_warn || to_jsonb('Both deals have a scope. The merged deal''s scope stays on the organization without a deal link.'::text);
    end if;
  elsif p_kind = 'business' then
    select count(*) into n from scope_documents a join scope_documents b on b.lead_id = a.lead_id
      where a.business_id = p_keep and b.business_id = p_merge;
    if n > 0 then v_coll := v_coll || jsonb_build_object('scope_documents_lead', n); end if;
    select count(*) into n from scope_documents a join scope_documents b on b.client_id = a.client_id
      where a.business_id = p_keep and b.business_id = p_merge;
    if n > 0 then v_coll := v_coll || jsonb_build_object('scope_documents_client', n); end if;
    if exists (select 1 from clients where business_id = p_keep and deleted_at is null)
       and exists (select 1 from clients where business_id = p_merge and deleted_at is null) then
      v_warn := v_warn || to_jsonb('Both organizations have a client record; the merged one will have two.'::text);
    end if;
  else
    select count(*) into n from email_message_links a join email_message_links b using (email_message_id)
      where a.contact_id = p_keep and b.contact_id = p_merge;
    if n > 0 then v_coll := v_coll || jsonb_build_object('email_message_links', n); end if;
  end if;

  foreach f in array crm.merge_fields(p_kind) loop
    v_fields := v_fields || jsonb_build_object(
      'field', f, 'keep', k->f, 'merge', m->f,
      'default', case when f = any (v_fill) and coalesce(k->>f, '') = '' and coalesce(m->>f, '') <> '' then 'merge' else 'keep' end,
      'locked', f = any (v_locked));
  end loop;

  return jsonb_build_object('kind', p_kind, 'keep', k, 'merge', m, 'fields', v_fields,
                            'moves', crm.merge_ref_counts(v_tbl, p_merge), 'collisions', v_coll, 'warnings', v_warn);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Duplicate detection
-- ---------------------------------------------------------------------------------------------
-- One row per suspected pair, with a suggested keep/merge direction (client or more history wins,
-- then the older record). Records in Trash are ignored; dismissed pairs are left out unless
-- p_include_dismissed.
create or replace function crm.duplicate_candidates(p_include_dismissed boolean default false)
 returns table (kind text, keep_id uuid, merge_id uuid, keep_label text, merge_label text,
                reasons text[], detail jsonb, score numeric, dismissed boolean)
 language plpgsql
 stable
 security definer
 set search_path = crm, public, pg_temp
as $$
declare
  v_trgm text := (select extnamespace::regnamespace::text from pg_extension where extname = 'pg_trgm');
  v_sim text;
begin
  v_sim := case when v_trgm is not null
    then format('%I.similarity(crm.org_name_norm(x.name), crm.org_name_norm(y.name))::numeric', v_trgm)
    else 'case when crm.org_name_norm(x.name) = crm.org_name_norm(y.name) then 1.0 else 0 end' end;

  return query execute format($q$
  with
  b as (
    select b.id, b.name, b.created_at,
           exists (select 1 from crm.clients c where c.business_id = b.id and c.deleted_at is null)
             or exists (select 1 from crm.leads l where l.business_id = b.id and l.stage = 'won' and l.deleted_at is null) as is_client,
           (select count(*) from crm.leads l where l.business_id = b.id and l.deleted_at is null)
             + (select count(*) from crm.contacts c where c.business_id = b.id and c.deleted_at is null) as weight
    from crm.businesses b where b.deleted_at is null),
  bd as (
    select id, d, src from (
      select b.id, crm.org_domain(crm.website_domain(b.website)) as d, 'website' as src from crm.businesses b where b.deleted_at is null
      union select b.id, crm.org_domain(crm.email_domain(b.email)), 'email' from crm.businesses b where b.deleted_at is null
      union select c.business_id, crm.org_domain(crm.email_domain(c.email)), 'contact_email'
        from crm.contacts c join crm.businesses b on b.id = c.business_id and b.deleted_at is null
        where c.deleted_at is null) z
    where d is not null),
  bp as (
    select x.id as a, y.id as b2, 'same_domain' as reason, jsonb_build_object('domain', x.d) as det, 0.9::numeric as score
      from bd x join bd y on y.d = x.d and x.id < y.id
    union all
    select x.id, y.id, 'similar_name', jsonb_build_object('similarity', round(s, 2)), s
      from b x join b y on x.id < y.id
      cross join lateral (select %1$s as s) z
      where crm.org_name_norm(x.name) is not null and s >= 0.5),
  c as (
    select c.id, c.business_id, c.created_at, crm.mailbox_norm(c.email) as mbox,
           lower(btrim(concat_ws(' ', c.first_name, c.last_name))) as fname, c.last_name,
           crm.org_domain(crm.email_domain(c.email)) as d,
           btrim(concat_ws(' ', c.first_name, c.last_name)) || coalesce(' <' || c.email || '>', '') as label,
           (select count(*) from crm.leads l where l.contact_id = c.id and l.deleted_at is null) as weight
    from crm.contacts c where c.deleted_at is null),
  cp as (
    select x.id as a, y.id as b2, 'same_email' as reason, jsonb_build_object('mailbox', x.mbox) as det, 1.0::numeric as score
      from c x join c y on y.mbox = x.mbox and x.id < y.id
    union all
    select x.id, y.id, 'same_name', jsonb_build_object('name', x.fname), 0.7
      from c x join c y on y.fname = x.fname and x.id < y.id
      where coalesce(x.last_name, '') <> '' and coalesce(y.last_name, '') <> ''
        and (x.business_id = y.business_id or (x.d is not null and x.d = y.d))),
  l as (
    select l.id, l.business_id, l.stage, l.source, l.created_at,
           coalesce(b.name, '?') || ' · ' || coalesce(l.source, 'deal') || ' · ' || l.stage as label
    from crm.leads l join crm.businesses b on b.id = l.business_id and b.deleted_at is null
    where l.deleted_at is null),
  lp as (
    select x.id as a, y.id as b2, 'two_open_deals' as reason, '{}'::jsonb as det, 0.6::numeric as score
      from l x join l y on y.business_id = x.business_id and x.id < y.id
      where x.stage not in ('won','lost') and y.stage not in ('won','lost')
    union all
    select least(o.id, w.id), greatest(o.id, w.id), 'open_deal_at_client',
           jsonb_build_object('won_lead_id', w.id, 'open_lead_id', o.id, 'source', o.source), 0.8
      from l o join l w on w.business_id = o.business_id and w.stage = 'won'
      where o.stage not in ('won','lost')
        and o.source in ('website_contact','website_assessment','quiz','ebook','contact_form','calendly','stripe','typeform','email_inbound')),
  pairs as (
    select 'business' as kind, a, b2, array_agg(distinct reason order by reason) as reasons,
           jsonb_object_agg(reason, det) as det, max(score) as score from bp group by a, b2
    union all
    select 'contact', a, b2, array_agg(distinct reason order by reason), jsonb_object_agg(reason, det), max(score) from cp group by a, b2
    union all
    select 'lead', a, b2, array_agg(distinct reason order by reason), jsonb_object_agg(reason, det), max(score) from lp group by a, b2),
  ranked as (
    select p.*,
      case p.kind
        when 'business' then (select (xa.is_client, xa.weight, xb.created_at) >= (xb.is_client, xb.weight, xa.created_at)
                              from b xa, b xb where xa.id = p.a and xb.id = p.b2)
        when 'contact'  then (select (xa.weight, xb.created_at) >= (xb.weight, xa.created_at)
                              from c xa, c xb where xa.id = p.a and xb.id = p.b2)
        else (select ((xa.stage = 'won'), xb.created_at) >= ((xb.stage = 'won'), xa.created_at)
              from l xa, l xb where xa.id = p.a and xb.id = p.b2)
      end as a_keeps
    from pairs p)
  select r.kind,
         case when r.a_keeps then r.a else r.b2 end,
         case when r.a_keeps then r.b2 else r.a end,
         case r.kind when 'business' then (select name from b where id = case when r.a_keeps then r.a else r.b2 end)
                     when 'contact' then (select label from c where id = case when r.a_keeps then r.a else r.b2 end)
                     else (select label from l where id = case when r.a_keeps then r.a else r.b2 end) end,
         case r.kind when 'business' then (select name from b where id = case when r.a_keeps then r.b2 else r.a end)
                     when 'contact' then (select label from c where id = case when r.a_keeps then r.b2 else r.a end)
                     else (select label from l where id = case when r.a_keeps then r.b2 else r.a end) end,
         r.reasons, r.det, round(r.score, 2),
         exists (select 1 from crm.duplicate_dismissals d where d.kind = r.kind and d.id_a = r.a and d.id_b = r.b2)
  from ranked r
  where $1 or not exists (select 1 from crm.duplicate_dismissals d where d.kind = r.kind and d.id_a = r.a and d.id_b = r.b2)
  order by r.score desc, r.kind, 2, 3
  $q$, v_sim) using p_include_dismissed;
end $$;

create or replace function crm.dismiss_duplicate(p_kind text, p_a uuid, p_b uuid, p_by text default null, p_note text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path = crm, public, pg_temp
as $$
begin
  if p_kind not in ('business','contact','lead') then
    raise exception 'dismiss_duplicate: unknown kind %', p_kind using errcode = 'MG006';
  end if;
  if p_a is null or p_b is null or p_a = p_b then
    raise exception 'dismiss_duplicate: pick two different records' using errcode = 'MG002';
  end if;
  insert into duplicate_dismissals (kind, id_a, id_b, dismissed_by, note)
  values (p_kind, least(p_a, p_b), greatest(p_a, p_b), p_by, p_note)
  on conflict (kind, id_a, id_b) do update set dismissed_by = excluded.dismissed_by, dismissed_at = now(),
    note = coalesce(excluded.note, duplicate_dismissals.note);
  return jsonb_build_object('kind', p_kind, 'id_a', least(p_a, p_b), 'id_b', greatest(p_a, p_b));
end $$;

-- ---------------------------------------------------------------------------------------------
-- crm.intake_lead (adds domain matching and Trash awareness; R9-R11 unchanged)
-- ---------------------------------------------------------------------------------------------
create or replace function crm.intake_lead(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to crm, public, pg_temp
as $function$
declare
  -- Must match src/lib/crm/stages.ts order (enforced by stages.sql-order.test.ts).
  v_stages constant text[] := array['quiz_started','quiz_completed','snapshot_viewed','new','qualification','engaged','call_demo_scheduled','proposal','won','lost'];
  v_channels constant text[] := array['website_contact','website_assessment','manual','referral','pro_bono','quiz','ebook','contact_form','calendly','stripe','typeform','taproot','email_inbound'];
  -- R11: channels that are signups or touches, not a decision to open a new deal.
  v_auto_channels constant text[] := array['website_contact','website_assessment','quiz','ebook','contact_form','calendly','stripe','typeform','email_inbound'];
  -- Must match FREE_MAIL_DOMAINS in src/lib/crm/suggest.ts (enforced by freemail.sql-sync.test.ts).
  v_freemail constant text[] := crm.freemail_domains();

  v_channel text := nullif(btrim(p->>'channel'), '');
  v_email   text := nullif(btrim(p->>'email'), '');
  v_name    text := nullif(btrim(p->>'name'), '');
  v_org     text := nullif(btrim(p->>'org'), '');
  v_phone   text := nullif(btrim(p->>'phone'), '');
  v_stage   text := coalesce(nullif(btrim(p->>'stage'), ''), 'new');
  v_entry   text;
  v_value   numeric(10,2) := nullif(btrim(p->>'estimated_value'), '')::numeric;
  v_domain  text;
  v_org_domain text;
  v_bname   text;
  v_first   text;
  v_last    text;

  v_contact_id uuid;
  v_business_id uuid;
  v_lead_id uuid;
  v_created_contact boolean := false;
  v_created_lead boolean := false;
  v_existing_client boolean := false;
  v_business_trusted boolean;
  v_contact_deleted boolean := false;
  v_relink boolean := false;
  v_match text;
  v_cur_stage text;
  v_stage_ignored text;
  v_freemail_noorg boolean;
begin
  if v_channel is null or not (v_channel = any (v_channels)) then
    raise exception 'intake_lead: unknown or missing channel: %', coalesce(v_channel, '(null)');
  end if;
  if v_email is null or position('@' in v_email) < 2 then
    raise exception 'intake_lead: a valid email is required';
  end if;
  if not (v_stage = any (v_stages)) then
    raise exception 'intake_lead: unknown stage: %', v_stage;
  end if;
  -- R9: intake never closes a lead. 'lost' is ignored: new leads get the default
  -- stage, existing leads keep their stage.
  if v_stage = 'lost' then
    v_stage_ignored := 'lost';
    v_stage := 'new';
  end if;
  v_entry := coalesce(nullif(btrim(p->>'entry_stage'), ''),
                      case when v_stage = 'quiz_started' then 'quiz_started' else 'new' end);
  if v_entry not in ('quiz_started','new') then
    raise exception 'intake_lead: unknown entry_stage: %', v_entry;
  end if;

  v_domain := lower(split_part(v_email, '@', 2));
  v_org_domain := crm.org_domain(v_domain);  -- null for free-mail and shared hosts

  -- Contact. The email is unique even across Trash, so a contact in Trash is matched and restored.
  select id, business_id, deleted_at is not null into v_contact_id, v_business_id, v_contact_deleted
  from contacts where email_norm = lower(v_email);

  -- A business in Trash is never matched; the contact is relinked below.
  if v_business_id is not null and exists (select 1 from businesses where id = v_business_id and deleted_at is not null) then
    v_business_id := null;
    v_relink := true;
  end if;
  if v_business_id is not null then v_match := 'contact'; end if;

  if v_contact_id is null then
    v_first := coalesce(split_part(v_name, ' ', 1), split_part(v_email, '@', 1));
    v_last  := nullif(btrim(substr(v_name, length(split_part(v_name, ' ', 1)) + 1)), '');
    if v_first is null or v_first = '' then v_first := split_part(v_email, '@', 1); end if;
  end if;

  -- Business: contact's own, else match by org name, else (no org given) by work domain, else create.
  if v_business_id is null then
    v_freemail_noorg := (v_org is null and v_domain = any (v_freemail));
    if v_org is not null then
      v_bname := v_org;
    elsif v_domain = any (v_freemail) then
      v_bname := coalesce(v_name, split_part(v_email, '@', 1));
    else
      v_bname := v_domain;
    end if;

    -- R10: free-mail with no org always gets a new business (never name-matched).
    if not v_freemail_noorg then
      select id into v_business_id from businesses
      where deleted_at is null and lower(name) = lower(v_bname) order by created_at limit 1;
      if v_business_id is not null then v_match := 'name'; end if;
    end if;

    -- R12 (2026-10-25): no org given and a work domain: match a colleague's email domain, the
    -- business email or the website. A typed org that doesn't match by name still creates its own
    -- business (duplicate_candidates flags the shared domain). This only links the business; R11
    -- below decides separately whether the won lead may be reused.
    if v_business_id is null and v_org is null and v_org_domain is not null then
      select b.id into v_business_id
      from businesses b
      cross join lateral (select exists (select 1 from contacts c
                                         where c.business_id = b.id and c.deleted_at is null
                                           and crm.email_domain(c.email) = v_org_domain) as by_contact) x
      where b.deleted_at is null
        and (x.by_contact or crm.email_domain(b.email) = v_org_domain
             or crm.website_domain(b.website) = v_org_domain)
      order by x.by_contact desc, b.created_at
      limit 1;
      if v_business_id is not null then v_match := 'domain'; end if;
    end if;

    if v_business_id is null then
      insert into businesses (name, source, email, phone)
      values (v_bname, v_channel, v_email, v_phone)
      returning id into v_business_id;
      v_match := 'created';
    end if;
  end if;

  if v_contact_id is null then
    insert into contacts (business_id, first_name, last_name, email, phone)
    values (v_business_id, v_first, v_last, v_email, v_phone)
    on conflict (email_norm) where email_norm is not null do nothing
    returning id into v_contact_id;
    if v_contact_id is null then
      -- lost a race with a concurrent intake: reuse the winner
      select id into v_contact_id from contacts where email_norm = lower(v_email);
    else
      v_created_contact := true;
    end if;
  else
    update contacts
       set business_id = case when v_relink then v_business_id else coalesce(business_id, v_business_id) end,
           phone = coalesce(phone, v_phone),
           deleted_at = null,
           deleted_by = null
     where id = v_contact_id;
  end if;

  -- Lead: most recent open lead of this contact, else new.
  select id, stage into v_lead_id, v_cur_stage
  from leads
  where contact_id = v_contact_id and stage not in ('won','lost') and deleted_at is null
  order by created_at desc limit 1
  for update;

  -- R11: an automated signup from an existing client lands on their won lead, not a new one.
  -- The business's won lead is used only when another contact there shares this non-free-mail
  -- domain. A business matched by org name or website alone is not trusted. Since 2026-10-25 that
  -- other contact must be on a won lead or client record of the business: a contact that intake
  -- itself linked (by org name or domain) is not evidence, so two org-name-only signups from one
  -- outside domain can no longer vouch for each other.
  if v_lead_id is null and v_channel = any (v_auto_channels) then
    v_business_trusted := (not (v_domain = any (v_freemail)) and exists (
            select 1 from contacts c
            where c.business_id = v_business_id and c.id <> v_contact_id and c.deleted_at is null
              and split_part(c.email_norm, '@', 2) = v_domain
              and (exists (select 1 from leads l where l.contact_id = c.id and l.business_id = v_business_id
                             and l.stage = 'won' and l.deleted_at is null)
                   or exists (select 1 from clients k where k.contact_id = c.id and k.business_id = v_business_id
                                and k.deleted_at is null))));
    select id into v_lead_id
    from leads
    where stage = 'won' and deleted_at is null
      and (contact_id = v_contact_id or (v_business_trusted and business_id = v_business_id))
    order by (contact_id is not distinct from v_contact_id) desc, created_at desc limit 1;
    v_existing_client := v_lead_id is not null;
  end if;

  if v_lead_id is null then
    insert into leads (business_id, contact_id, stage, entry_stage, source, estimated_value,
                       utm_source, utm_medium, utm_campaign, utm_content, utm_term,
                       referrer, landing_path, first_touch_at)
    values (v_business_id, v_contact_id, v_stage, v_entry, v_channel, v_value,
            nullif(p->>'utm_source',''), nullif(p->>'utm_medium',''), nullif(p->>'utm_campaign',''),
            nullif(p->>'utm_content',''), nullif(p->>'utm_term',''),
            nullif(p->>'referrer',''), nullif(p->>'landing_path',''), now())
    returning id into v_lead_id;
    v_created_lead := true;
  elsif not v_existing_client then
    update leads set
      stage = case when v_stage_ignored is null
                    and array_position(v_stages, v_stage) > array_position(v_stages, stage)
                   then v_stage else stage end,
      estimated_value = coalesce(estimated_value, v_value),
      utm_source   = coalesce(utm_source,   nullif(p->>'utm_source','')),
      utm_medium   = coalesce(utm_medium,   nullif(p->>'utm_medium','')),
      utm_campaign = coalesce(utm_campaign, nullif(p->>'utm_campaign','')),
      utm_content  = coalesce(utm_content,  nullif(p->>'utm_content','')),
      utm_term     = coalesce(utm_term,     nullif(p->>'utm_term','')),
      referrer     = coalesce(referrer,     nullif(p->>'referrer','')),
      landing_path = coalesce(landing_path, nullif(p->>'landing_path','')),
      first_touch_at = coalesce(first_touch_at, now())
    where id = v_lead_id;
  end if;

  insert into lead_activities (lead_id, contact_id, activity_type, content, logged_by, metadata)
  values (v_lead_id, v_contact_id, 'intake', nullif(p->>'summary',''), 'system',
          jsonb_build_object('channel', v_channel, 'payload', p->'payload')
          || case when v_stage_ignored is not null
                  then jsonb_build_object('stage_ignored', v_stage_ignored) else '{}'::jsonb end
          || case when v_existing_client
                  then jsonb_build_object('existing_client', true) else '{}'::jsonb end
          || case when v_match = 'domain'
                  then jsonb_build_object('business_match', 'domain') else '{}'::jsonb end
          || case when v_contact_deleted
                  then jsonb_build_object('restored_contact', true) else '{}'::jsonb end);

  return jsonb_build_object(
    'contact_id', v_contact_id,
    'business_id', v_business_id,
    'lead_id', v_lead_id,
    'created_contact', v_created_contact,
    'created_lead', v_created_lead,
    'existing_client', v_existing_client,
    'business_match', v_match);
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------
revoke all on function crm.freemail_domains(), crm.shared_web_hosts(), crm.email_domain(text), crm.website_domain(text),
  crm.org_domain(text), crm.mailbox_norm(text), crm.org_name_norm(text),
  crm.merge_fk_refs(regclass), crm.merge_ref_counts(regclass, uuid), crm.merge_repoint(regclass, uuid, uuid),
  crm.merge_apply_fields(jsonb, jsonb, jsonb, text[], text[], text[]), crm.merge_actor(text),
  crm.merge_record_redirect(text, uuid, uuid, text, text, jsonb, jsonb), crm.merge_assert_unreferenced(regclass, uuid),
  crm.merge_fields(text), crm.merge_fillable(text), crm.merge_lead_attribution_fields(),
  crm.merge_lock_pair(text, uuid, uuid), crm.merge_business_anchor(uuid),
  crm.merge_businesses(uuid, uuid, jsonb, text), crm.merge_contacts(uuid, uuid, jsonb, text),
  crm.merge_leads(uuid, uuid, jsonb, text), crm.merge_preview(text, uuid, uuid),
  crm.duplicate_candidates(boolean), crm.dismiss_duplicate(text, uuid, uuid, text, text),
  crm.intake_lead(jsonb)
  from public, anon, authenticated;

grant execute on function crm.freemail_domains(), crm.shared_web_hosts(), crm.email_domain(text), crm.website_domain(text),
  crm.org_domain(text), crm.mailbox_norm(text), crm.org_name_norm(text),
  crm.merge_businesses(uuid, uuid, jsonb, text), crm.merge_contacts(uuid, uuid, jsonb, text),
  crm.merge_leads(uuid, uuid, jsonb, text), crm.merge_preview(text, uuid, uuid),
  crm.duplicate_candidates(boolean), crm.dismiss_duplicate(text, uuid, uuid, text, text),
  crm.intake_lead(jsonb)
  to service_role;

commit;
