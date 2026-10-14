# Portal Room (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `https://portal.rosably.com/r/<link>` work: a visitor opens a room link, introduces themselves once, and views the prototypes Brian has shared. Brian gets a Share action and an Activity tab in the dashboard.

**Architecture:** The portal (Next.js, `Rosenfelt-Group/portal`) connects to Postgres as a dedicated role `portal_app` with `EXECUTE`-only access to `SECURITY DEFINER` functions in the `rooms` schema; those functions re-validate the link on every call. A host-only signed cookie carries `{access, engagement, contact, exp}`; the database is the authority on revocation and expiry. Prototypes are embedded from the preview host using signed grants. The dashboard (service role, internal) gains an atomic Share function/route and an Activity tab.

**Tech Stack:** PostgreSQL (SECURITY DEFINER functions, role grants), Next.js 16 / React 19 / TypeScript, `postgres` (porsager) in the portal, vitest.

**Spec:** `docs/superpowers/specs/2026-10-14-portal-room-phase2-design.md` (PR #49 in `Rosenfelt-Group/rosenfelt-dashboard`; read it from that branch until it merges)

## Global Constraints

- The portal never uses the service-role key. Its only database credential is `PORTAL_DATABASE_URL` for role `portal_app` (pooler, port 6543, transaction mode, `prepare: false`).
- `portal_app` has **no table privileges anywhere**; only `USAGE` on schema `rooms` and `EXECUTE` on the five portal functions. Every portal function is `SECURITY DEFINER` with `SET search_path = rooms, pg_temp`.
- `EXECUTE` on every new function is revoked from `PUBLIC`, `anon` and `authenticated` (the `rooms` schema is exposed through the REST API). Portal functions are granted to `portal_app` and `service_role` only; `share_version` to `service_role` only; the internal helper to nobody.
- Session cookie: name `__Host-rooms`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`; value `base64url(JSON).base64url(HMAC-SHA256)` with `ROOM_SESSION_SECRET`; lifetime = min(link expiry, 8 hours). Every request re-validates in the database.
- The link token is 43 chars `[A-Za-z0-9_-]`; only its SHA-256 hex digest is sent to the database; the raw token is never logged, rendered, stored or placed in an error.
- Every failure of a link or session looks the same to the visitor (`/link-expired`); no reason is revealed.
- Drafts are never returned by any portal function; `storage_prefix` and the raw manifest never reach the browser.
- Mutating portal APIs require `Content-Type: application/json` and an `Origin` equal to the portal origin.
- Prototype frame: `<iframe sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer">` pointing only at `NEXT_PUBLIC_PREVIEW_URL`; never `allow-same-origin`, top-navigation, popups, modals or downloads. Preview grants are signed with `ROOM_GRANT_SECRET`, 15-minute TTL.
- Portal headers: `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: frame-ancestors 'none'; frame-src <preview origin>; base-uri 'none'; object-src 'none'; form-action 'self'`, `Cache-Control: private, no-store` on room pages and APIs.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Plan amendments to the spec

1. **`screen_viewed` events and `portal_log_event` are deferred to Phase 3.** They only make sense with the bridge's message listener, which has its own validation requirements. Phase 2 logs `room_opened`, `contact_identified` and `version_viewed` (server-side, when a preview URL is issued).
2. **Atomic Share is a database function** (`rooms.share_version`, `service_role` only) called by the dashboard route, because supabase-js has no transactions.
3. The room lives at `/room` (not `/r/room`).

## Review Focus

1. **Cross-engagement or forged session:** a cookie with a valid signature for another access/engagement, a tampered payload, an expired payload, a revoked link (Tasks 1, 3, 4).
2. **Draft or prefix leakage:** a draft version id passed to the preview-url endpoint; a version from another engagement; `storage_prefix` in any JSON sent to the browser (Tasks 1, 4).
3. **Token leakage:** token in logs, error messages, redirects, the `Referer` header, or rendered HTML (Tasks 3, 4).
4. **Function privileges:** `anon`/`authenticated` executing portal functions through the REST API; `portal_app` reaching any table, CRM data, or other functions (Task 1).
5. **Timing and enumeration:** different responses for malformed vs unknown vs expired vs revoked links (Tasks 3, 4).

## File Structure

**Dashboard repo (`rosenfelt-dashboard`):** `docs/migrations/2026-10-14_rooms_portal.sql` (role, functions, share function); `docs/migrations/2026-10-14_rooms_portal_test.sql` (dry-run assertions); `src/app/api/versions/[id]/share/route.ts` (+test); `src/app/api/engagements/[id]/activity/route.ts` (+test); changes to `src/app/(dashboard)/engagements/[id]/page.tsx`.

**Portal repo (`portal`):** `vitest.config.ts`; `lib/token.ts`, `lib/session.ts`, `lib/guards.ts`, `lib/grant.ts` (byte copy), `lib/db.ts`, `lib/queries.ts`, `lib/handlers.ts` (+ a test file beside each); `app/r/[token]/route.ts`; `app/room/page.tsx`; `app/link-expired/page.tsx`; `app/api/room/{identify,deliverables}/route.ts`; `app/api/room/versions/[id]/preview-url/route.ts`; `components/IntroForm.tsx`, `components/RoomView.tsx`; `next.config.ts` (CSP).

---

### Task 1: Migration — portal role, functions, share function (dashboard repo)

**Files:**
- Create: `docs/migrations/2026-10-14_rooms_portal.sql`
- Create: `docs/migrations/2026-10-14_rooms_portal_test.sql`

**Interfaces:**
- Produces (SQL): `rooms.portal_open_room(p_token_hash text)`, `rooms.portal_session(p_access uuid, p_eng uuid, p_contact uuid)`, `rooms.portal_identify(p_access uuid, p_eng uuid, p_name text, p_email text) returns uuid`, `rooms.portal_list_deliverables(p_access uuid, p_eng uuid)`, `rooms.portal_version_for_preview(p_access uuid, p_eng uuid, p_contact uuid, p_version uuid)`, `rooms.share_version(p_version uuid)`, internal `rooms._portal_access_ok(uuid, uuid)`; role `portal_app`. Column lists are given in the code below and are used verbatim by Task 3.

- [ ] **Step 1: Write the migration** (`docs/migrations/2026-10-14_rooms_portal.sql`)

```sql
-- Engagement Rooms Phase 2: portal access role, portal functions, atomic share.
-- The portal connects as portal_app (no table privileges). Everything it can do is a function below.
-- Brian sets portal_app's password in the Supabase dashboard (never in SQL).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'portal_app') then
    create role portal_app login noinherit nobypassrls connection limit 20;
  end if;
end $$;

alter role portal_app set statement_timeout = '5s';
alter role portal_app set idle_in_transaction_session_timeout = '5s';
grant usage on schema rooms to portal_app;

-- Internal helper: is this access (still) valid for this engagement?
create or replace function rooms._portal_access_ok(p_access uuid, p_eng uuid)
returns boolean language sql stable security definer set search_path = rooms, pg_temp as $$
  select exists (
    select 1
    from rooms.engagement_access a
    join rooms.engagements e on e.id = a.engagement_id
    where a.id = p_access and a.engagement_id = p_eng
      and a.revoked_at is null and a.expires_at > now()
      and e.status <> 'closed');
$$;

-- Exchange a hashed link for the room header; logs room_opened.
create or replace function rooms.portal_open_room(p_token_hash text)
returns table (access_id uuid, engagement_id uuid, expires_at timestamptz,
               title text, relationship text, org_name text, modules jsonb)
language plpgsql security definer set search_path = rooms, pg_temp as $$
#variable_conflict use_column
declare v_access rooms.engagement_access%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return; end if;
  select a.* into v_access from rooms.engagement_access a
   where a.token_hash = p_token_hash and a.revoked_at is null and a.expires_at > now();
  if not found then return; end if;
  if not rooms._portal_access_ok(v_access.id, v_access.engagement_id) then return; end if;
  update rooms.engagement_access set last_used_at = now() where id = v_access.id;
  insert into rooms.engagement_events (engagement_id, type, meta)
    values (v_access.engagement_id, 'room_opened', jsonb_build_object('access_id', v_access.id));
  return query
    select v_access.id, e.id, v_access.expires_at, e.title, e.relationship, b.name, e.modules
      from rooms.engagements e join crm.businesses b on b.id = e.business_id
     where e.id = v_access.engagement_id;
end $$;

-- Re-validate a session on every request; returns the header and (if given and valid) the contact.
create or replace function rooms.portal_session(p_access uuid, p_eng uuid, p_contact uuid)
returns table (access_id uuid, engagement_id uuid, expires_at timestamptz,
               title text, relationship text, org_name text, modules jsonb,
               contact_id uuid, contact_name text)
language plpgsql security definer set search_path = rooms, pg_temp as $$
#variable_conflict use_column
begin
  if p_access is null or p_eng is null or not rooms._portal_access_ok(p_access, p_eng) then return; end if;
  return query
    select a.id, e.id, a.expires_at, e.title, e.relationship, b.name, e.modules, c.id, c.name
      from rooms.engagement_access a
      join rooms.engagements e on e.id = a.engagement_id
      join crm.businesses b on b.id = e.business_id
      left join rooms.engagement_contacts c on c.id = p_contact and c.engagement_id = e.id
     where a.id = p_access;
end $$;

-- Self-asserted introduction. Returns the contact id, or null for any invalid input.
create or replace function rooms.portal_identify(p_access uuid, p_eng uuid, p_name text, p_email text)
returns uuid language plpgsql security definer set search_path = rooms, pg_temp as $$
declare v_name text := btrim(coalesce(p_name, '')); v_email text := lower(btrim(coalesce(p_email, ''))); v_id uuid;
begin
  if not rooms._portal_access_ok(p_access, p_eng) then return null; end if;
  if char_length(v_name) not between 1 and 100 then return null; end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then return null; end if;
  insert into rooms.engagement_contacts (engagement_id, name, email)
    values (p_eng, v_name, v_email)
  on conflict (engagement_id, lower(email)) do update set first_seen_at = rooms.engagement_contacts.first_seen_at
  returning id into v_id;
  insert into rooms.engagement_events (engagement_id, contact_id, type, meta)
    values (p_eng, v_id, 'contact_identified', jsonb_build_object('access_id', p_access));
  return v_id;
end $$;

-- Shared (never draft) versions of this engagement's deliverables. No storage_prefix, no raw manifest.
create or replace function rooms.portal_list_deliverables(p_access uuid, p_eng uuid)
returns table (deliverable_id uuid, deliverable_title text, description text,
               version_id uuid, version_no int, status text, shared_at timestamptz,
               change_summary text, screens jsonb)
language plpgsql security definer set search_path = rooms, pg_temp as $$
#variable_conflict use_column
begin
  if not rooms._portal_access_ok(p_access, p_eng) then return; end if;
  return query
    select d.id, d.title, d.description, v.id, v.version_no, v.status, v.shared_at, v.change_summary,
           case when jsonb_typeof(v.manifest->'screens') = 'array'
                then (select coalesce(jsonb_agg(jsonb_build_object('id', s->>'id', 'name', s->>'name')), '[]'::jsonb)
                        from jsonb_array_elements(v.manifest->'screens') s)
                else '[]'::jsonb end
      from rooms.deliverables d
      join rooms.deliverable_versions v on v.deliverable_id = d.id
     where d.engagement_id = p_eng
       and v.status in ('shared', 'superseded', 'approved', 'changes_requested')
     order by d.sort_order, d.created_at, v.version_no desc;
end $$;

-- What the portal server needs to sign a preview grant; logs version_viewed (deduplicated).
create or replace function rooms.portal_version_for_preview(p_access uuid, p_eng uuid, p_contact uuid, p_version uuid)
returns table (storage_prefix text, entry text, deliverable_id uuid, version_no int)
language plpgsql security definer set search_path = rooms, pg_temp as $$
#variable_conflict use_column
declare v_contact uuid := null; v_row record;
begin
  if not rooms._portal_access_ok(p_access, p_eng) then return; end if;
  select v.storage_prefix as sp, coalesce(v.manifest->>'entry', 'index.html') as ent, d.id as did, v.version_no as vno
    into v_row
    from rooms.deliverable_versions v join rooms.deliverables d on d.id = v.deliverable_id
   where v.id = p_version and d.engagement_id = p_eng
     and v.status in ('shared', 'superseded', 'approved', 'changes_requested');
  if not found then return; end if;
  if p_contact is not null and exists (select 1 from rooms.engagement_contacts c where c.id = p_contact and c.engagement_id = p_eng)
    then v_contact := p_contact; end if;
  if not exists (select 1 from rooms.engagement_events ev
                  where ev.engagement_id = p_eng and ev.type = 'version_viewed' and ev.version_id = p_version
                    and ev.contact_id is not distinct from v_contact and ev.created_at > now() - interval '10 minutes') then
    insert into rooms.engagement_events (engagement_id, version_id, contact_id, type, meta)
      values (p_eng, p_version, v_contact, 'version_viewed', jsonb_build_object('access_id', p_access));
  end if;
  return query select v_row.sp, v_row.ent, v_row.did, v_row.vno;
end $$;

-- Atomic Share (dashboard, service_role only): draft -> shared; previously shared version -> superseded.
create or replace function rooms.share_version(p_version uuid)
returns table (version_id uuid, version_no int, superseded_count int)
language plpgsql security definer set search_path = rooms, pg_temp as $$
#variable_conflict use_column
declare v rooms.deliverable_versions%rowtype; n int;
begin
  select * into v from rooms.deliverable_versions where id = p_version for update;
  if not found then raise exception 'version not found' using errcode = 'P0002'; end if;
  if v.status <> 'draft' then raise exception 'only a draft can be shared' using errcode = 'P0001'; end if;
  update rooms.deliverable_versions set status = 'superseded'
   where deliverable_id = v.deliverable_id and status = 'shared' and id <> v.id;
  get diagnostics n = row_count;
  update rooms.deliverable_versions set status = 'shared', shared_at = now() where id = v.id;
  return query select v.id, v.version_no, n;
end $$;

-- Privileges. rooms is exposed through the REST API: nothing may be executable by anon/authenticated.
revoke all on function rooms._portal_access_ok(uuid, uuid) from public, anon, authenticated;
revoke all on function rooms.portal_open_room(text) from public, anon, authenticated;
revoke all on function rooms.portal_session(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function rooms.portal_identify(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function rooms.portal_list_deliverables(uuid, uuid) from public, anon, authenticated;
revoke all on function rooms.portal_version_for_preview(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function rooms.share_version(uuid) from public, anon, authenticated;

grant execute on function rooms.portal_open_room(text) to portal_app, service_role;
grant execute on function rooms.portal_session(uuid, uuid, uuid) to portal_app, service_role;
grant execute on function rooms.portal_identify(uuid, uuid, text, text) to portal_app, service_role;
grant execute on function rooms.portal_list_deliverables(uuid, uuid) to portal_app, service_role;
grant execute on function rooms.portal_version_for_preview(uuid, uuid, uuid, uuid) to portal_app, service_role;
grant execute on function rooms.share_version(uuid) to service_role;
```

- [ ] **Step 2: Write the assertion script** (`docs/migrations/2026-10-14_rooms_portal_test.sql`). It runs **after** the migration inside the same transaction and raises on any failure; it creates its own fixtures and nothing persists because the whole run is rolled back.

```sql
do $$
declare
  v_biz uuid; v_eng uuid; v_eng2 uuid; v_acc uuid; v_acc_rev uuid; v_acc_exp uuid; v_acc_other uuid;
  v_hash text := encode(sha256('portal-test-token'::bytea), 'hex');
  v_hash_rev text := encode(sha256('portal-test-revoked'::bytea), 'hex');
  v_hash_exp text := encode(sha256('portal-test-expired'::bytea), 'hex');
  v_del uuid; v_del2 uuid; v_draft uuid; v_shared uuid; v_super uuid; v_other uuid; v_contact uuid; v_contact2 uuid; n int; r record; v_ok boolean;
begin
  -- Lets the migration role `SET ROLE portal_app/anon/authenticated` for the privilege checks (rolled back with everything else).
  grant portal_app to current_user;
  select id into v_biz from crm.businesses limit 1;
  insert into rooms.engagements (business_id, relationship, title) values (v_biz, 'prospect', 'T1') returning id into v_eng;
  insert into rooms.engagements (business_id, relationship, title) values (v_biz, 'partner', 'T2') returning id into v_eng2;
  insert into rooms.engagement_access (engagement_id, token_hash) values (v_eng, v_hash) returning id into v_acc;
  insert into rooms.engagement_access (engagement_id, token_hash, revoked_at) values (v_eng, v_hash_rev, now()) returning id into v_acc_rev;
  insert into rooms.engagement_access (engagement_id, token_hash, expires_at) values (v_eng, v_hash_exp, now() - interval '1 hour') returning id into v_acc_exp;
  insert into rooms.engagement_access (engagement_id, token_hash) values (v_eng2, encode(sha256('portal-test-other'::bytea), 'hex')) returning id into v_acc_other;
  insert into rooms.deliverables (engagement_id, title) values (v_eng, 'D1') returning id into v_del;
  insert into rooms.deliverables (engagement_id, title) values (v_eng2, 'D2') returning id into v_del2;
  insert into rooms.deliverable_versions (deliverable_id, version_no, status, storage_prefix, manifest)
    values (v_del, 1, 'superseded', 'a/b/v1', '{"entry":"index.html","screens":[{"id":"s1","name":"One"}]}') returning id into v_super;
  insert into rooms.deliverable_versions (deliverable_id, version_no, status, storage_prefix, manifest)
    values (v_del, 2, 'shared', 'a/b/v2', '{"entry":"index.html","screens":[{"id":"s1","name":"One"}]}') returning id into v_shared;
  insert into rooms.deliverable_versions (deliverable_id, version_no, status, storage_prefix, manifest)
    values (v_del, 3, 'draft', 'a/b/v3', '{"entry":"index.html"}') returning id into v_draft;
  insert into rooms.deliverable_versions (deliverable_id, version_no, status, storage_prefix, manifest)
    values (v_del2, 1, 'shared', 'c/d/v1', '{"entry":"index.html"}') returning id into v_other;

  -- open_room
  select count(*) into n from rooms.portal_open_room(v_hash);                 if n <> 1 then raise exception 'FAIL open valid'; end if;
  select count(*) into n from rooms.portal_open_room(v_hash_rev);             if n <> 0 then raise exception 'FAIL open revoked'; end if;
  select count(*) into n from rooms.portal_open_room(v_hash_exp);             if n <> 0 then raise exception 'FAIL open expired'; end if;
  select count(*) into n from rooms.portal_open_room('nothex');               if n <> 0 then raise exception 'FAIL open malformed'; end if;
  select count(*) into n from rooms.portal_open_room(repeat('0', 64));        if n <> 0 then raise exception 'FAIL open unknown'; end if;
  select count(*) into n from rooms.engagement_events where engagement_id = v_eng and type = 'room_opened'; if n <> 1 then raise exception 'FAIL room_opened event count %', n; end if;
  update rooms.engagements set status = 'closed' where id = v_eng;
  select count(*) into n from rooms.portal_open_room(v_hash);                 if n <> 0 then raise exception 'FAIL open closed engagement'; end if;
  update rooms.engagements set status = 'active' where id = v_eng;

  -- session
  select count(*) into n from rooms.portal_session(v_acc, v_eng, null);       if n <> 1 then raise exception 'FAIL session valid'; end if;
  select count(*) into n from rooms.portal_session(v_acc, v_eng2, null);      if n <> 0 then raise exception 'FAIL session wrong engagement'; end if;
  select count(*) into n from rooms.portal_session(v_acc_rev, v_eng, null);   if n <> 0 then raise exception 'FAIL session revoked'; end if;
  select count(*) into n from rooms.portal_session(v_acc_other, v_eng, null); if n <> 0 then raise exception 'FAIL session other access'; end if;

  -- identify
  v_contact := rooms.portal_identify(v_acc, v_eng, '  Pat Example ', 'Pat@Example.org ');
  if v_contact is null then raise exception 'FAIL identify valid'; end if;
  v_contact2 := rooms.portal_identify(v_acc, v_eng, 'Someone Else', 'pat@example.org');
  if v_contact2 is distinct from v_contact then raise exception 'FAIL identify dedupe'; end if;
  select name into r from rooms.engagement_contacts where id = v_contact;
  if r.name <> 'Pat Example' then raise exception 'FAIL identify name kept: %', r.name; end if;
  if rooms.portal_identify(v_acc, v_eng, 'X', 'not-an-email') is not null then raise exception 'FAIL identify bad email'; end if;
  if rooms.portal_identify(v_acc, v_eng, repeat('x', 101), 'a@b.co') is not null then raise exception 'FAIL identify long name'; end if;
  if rooms.portal_identify(v_acc, v_eng, '', 'a@b.co') is not null then raise exception 'FAIL identify empty name'; end if;
  if rooms.portal_identify(v_acc_rev, v_eng, 'X', 'a@b.co') is not null then raise exception 'FAIL identify revoked'; end if;
  if rooms.portal_identify(v_acc, v_eng2, 'X', 'a@b.co') is not null then raise exception 'FAIL identify wrong engagement'; end if;
  select count(*) into n from rooms.portal_session(v_acc, v_eng, v_contact) where contact_id = v_contact; if n <> 1 then raise exception 'FAIL session contact'; end if;
  select count(*) into n from rooms.portal_session(v_acc, v_eng, v_contact2) s where s.contact_id is null; if n <> 0 and v_contact2 = v_contact then raise exception 'FAIL session contact sanity'; end if;

  -- list deliverables: no drafts, no other engagement, no prefix column
  select count(*) into n from rooms.portal_list_deliverables(v_acc, v_eng);   if n <> 2 then raise exception 'FAIL list expected 2 got %', n; end if;
  select count(*) into n from rooms.portal_list_deliverables(v_acc, v_eng) where version_id = v_draft; if n <> 0 then raise exception 'FAIL draft visible'; end if;
  select count(*) into n from rooms.portal_list_deliverables(v_acc_rev, v_eng); if n <> 0 then raise exception 'FAIL list revoked'; end if;
  select count(*) into n from rooms.portal_list_deliverables(v_acc, v_eng2);  if n <> 0 then raise exception 'FAIL list wrong engagement'; end if;

  -- preview
  select count(*) into n from rooms.portal_version_for_preview(v_acc, v_eng, v_contact, v_draft);   if n <> 0 then raise exception 'FAIL preview draft'; end if;
  select count(*) into n from rooms.portal_version_for_preview(v_acc, v_eng, v_contact, v_other);   if n <> 0 then raise exception 'FAIL preview other engagement'; end if;
  select count(*) into n from rooms.portal_version_for_preview(v_acc_exp, v_eng, v_contact, v_shared); if n <> 0 then raise exception 'FAIL preview expired'; end if;
  select * into r from rooms.portal_version_for_preview(v_acc, v_eng, v_contact, v_shared);
  if r.storage_prefix <> 'a/b/v2' or r.entry <> 'index.html' then raise exception 'FAIL preview shared'; end if;
  perform rooms.portal_version_for_preview(v_acc, v_eng, v_contact, v_shared);
  select count(*) into n from rooms.engagement_events where version_id = v_shared and type = 'version_viewed'; if n <> 1 then raise exception 'FAIL view dedupe %', n; end if;
  perform rooms.portal_version_for_preview(v_acc, v_eng, v_contact, v_super);
  select count(*) into n from rooms.engagement_events where version_id = v_super and type = 'version_viewed'; if n <> 1 then raise exception 'FAIL superseded viewable'; end if;

  -- share_version
  select count(*) into n from rooms.share_version(v_draft);                    if n <> 1 then raise exception 'FAIL share'; end if;
  select status into r from rooms.deliverable_versions where id = v_draft;     if r.status <> 'shared' then raise exception 'FAIL share status'; end if;
  select status into r from rooms.deliverable_versions where id = v_shared;    if r.status <> 'superseded' then raise exception 'FAIL previous not superseded'; end if;
  -- NOTE: `raise exception` defaults to SQLSTATE P0001, so never raise a FAIL inside a block that catches P0001.
  v_ok := false;
  begin perform rooms.share_version(v_draft); exception when sqlstate 'P0001' then v_ok := true; end;
  if not v_ok then raise exception 'FAIL double share'; end if;
  v_ok := false;
  begin perform rooms.share_version(gen_random_uuid()); exception when sqlstate 'P0002' then v_ok := true; end;
  if not v_ok then raise exception 'FAIL share unknown'; end if;

  -- function-level EXECUTE must be absent for anon/authenticated (independent of schema USAGE)
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'rooms' and (p.proname like 'portal\_%' or p.proname in ('share_version', '_portal_access_ok')) loop
    if has_function_privilege('anon', r.sig, 'execute') or has_function_privilege('authenticated', r.sig, 'execute') then
      raise exception 'FAIL function-level execute for anon/authenticated on %', r.sig;
    end if;
  end loop;
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'rooms' and (p.proname like 'portal\_%' or p.proname in ('share_version', '_portal_access_ok'));
  if n <> 7 then raise exception 'FAIL expected 7 portal functions, found %', n; end if;

  -- privileges: anon / authenticated may execute nothing
  begin set local role anon; perform rooms.portal_open_room(v_hash); reset role; raise exception 'FAIL anon executes open_room';
  exception when insufficient_privilege then reset role; end;
  begin set local role authenticated; perform rooms.portal_session(v_acc, v_eng, null); reset role; raise exception 'FAIL authenticated executes session';
  exception when insufficient_privilege then reset role; end;
  begin set local role anon; perform rooms.share_version(v_draft); reset role; raise exception 'FAIL anon executes share';
  exception when insufficient_privilege then reset role; end;

  -- privileges: portal_app executes the portal functions and nothing else
  set local role portal_app;
  select count(*) into n from rooms.portal_open_room(v_hash);                  if n <> 1 then raise exception 'FAIL portal_app open_room'; end if;
  begin perform 1 from rooms.engagements limit 1; reset role; raise exception 'FAIL portal_app reads engagements';
  exception when insufficient_privilege then reset role; end;
  set local role portal_app;
  begin perform 1 from rooms.engagement_access limit 1; reset role; raise exception 'FAIL portal_app reads access';
  exception when insufficient_privilege then reset role; end;
  set local role portal_app;
  begin perform 1 from crm.businesses limit 1; reset role; raise exception 'FAIL portal_app reads crm';
  exception when insufficient_privilege then reset role; end;
  set local role portal_app;
  begin insert into rooms.engagement_events (engagement_id, type) values (v_eng, 'x'); reset role; raise exception 'FAIL portal_app inserts events';
  exception when insufficient_privilege then reset role; end;
  set local role portal_app;
  begin perform rooms.share_version(v_draft); reset role; raise exception 'FAIL portal_app executes share';
  exception when insufficient_privilege then reset role; end;
  set local role portal_app;
  begin perform rooms._portal_access_ok(v_acc, v_eng); reset role; raise exception 'FAIL portal_app executes helper';
  exception when insufficient_privilege then reset role; end;
  set local role portal_app;
  begin execute 'create table public.portal_probe(x int)'; reset role; raise exception 'FAIL portal_app creates tables';
  exception when insufficient_privilege then reset role; end;
  reset role;
end $$;
```

- [ ] **Step 3: Dry-run on production, nothing persists.** Using `execute_sql` on project `ukfpmpxwdlpsjqbxreza`, send one request containing: `begin;` + the full migration + the full assertion script + `rollback;`. Expected: no error. (If the tool does not hold the transaction open across statements, stop and report; do not apply anything.) Then confirm nothing leaked:

```sql
select not exists (select 1 from pg_roles where rolname = 'portal_app') as role_absent,
       not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'rooms' and p.proname like 'portal\_%') as functions_absent;
```
Expected: both `true`. If an assertion fails, fix the migration and repeat.

- [ ] **Step 4: Commit** (both files). **Do not apply to production in this task** — Brian approves that step (Task 7).

```bash
git add docs/migrations/2026-10-14_rooms_portal.sql docs/migrations/2026-10-14_rooms_portal_test.sql
git commit -m "feat(rooms): portal role, portal functions and atomic share (migration + assertions)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Portal foundations — test runner, token, session, guards, grant (portal repo)

**Files (repo `portal`, branch `feat/room-phase2` from `main`):**
- Modify: `package.json`; Create: `vitest.config.ts`
- Create: `lib/token.ts`, `lib/session.ts`, `lib/guards.ts`, `lib/grant.ts`, and tests `lib/token.test.ts`, `lib/session.test.ts`, `lib/guards.test.ts`, `lib/grant.test.ts`

**Interfaces (produces):** `isTokenShape(raw: string): boolean`, `hashToken(raw: string): string`; `COOKIE_NAME = "__Host-rooms"`, `SESSION_MAX_SEC = 28800`, `signSession(p: SessionPayload, secret: string): string`, `verifySession(value: string | undefined, secret: string, nowMs?: number): SessionPayload | null`, `sessionExpiry(accessExpiresAt: string | Date, nowMs?: number): number`, `setCookieHeader(value: string, maxAgeSec: number): string`, `clearCookieHeader(): string`; `isSameOriginJson(req: Request, origin: string): boolean`; `lib/grant.ts` = byte copy of the dashboard's `src/lib/rooms/grant.ts` (and its test).

- [ ] **Step 1: Install and configure**

```bash
npm install postgres@^3.4
npm install --save-dev vitest@^3.2.4 @types/react-dom@^19
```
Add `"test": "vitest run"` to `scripts`. `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  esbuild: { jsx: "automatic" },
  test: { environment: "node", include: ["lib/**/*.test.ts", "components/**/*.test.tsx", "app/**/*.test.ts*"] },
});
```
Copy the grant module and its test: `cp ../rosenfelt-dashboard/src/lib/rooms/grant.ts lib/grant.ts` and the test file (import path `./grant` is unchanged); confirm with `cmp`.

- [ ] **Step 2: Write the failing tests**

`lib/token.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { isTokenShape, hashToken } from "./token";

describe("token", () => {
  it("accepts exactly 43 url-safe characters", () => {
    expect(isTokenShape("a".repeat(43))).toBe(true);
    expect(isTokenShape("A_-0".repeat(10) + "abc")).toBe(true);
  });
  it("rejects everything else before any lookup", () => {
    for (const bad of ["", "a".repeat(42), "a".repeat(44), "a".repeat(42) + "!", "a".repeat(42) + "\n", " " + "a".repeat(42),
      "../".repeat(15), "a".repeat(42) + "/", null as unknown as string, 5 as unknown as string]) {
      expect(isTokenShape(bad)).toBe(false);
    }
  });
  it("hashes to 64 lowercase hex and matches the dashboard's SHA-256 digest", () => {
    expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hashToken("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

`lib/session.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { signSession, verifySession, sessionExpiry, setCookieHeader, clearCookieHeader, COOKIE_NAME, SESSION_MAX_SEC } from "./session";

const A = "0b6f1c0e-2d3a-4b5c-8d7e-9f0a1b2c3d4e";
const E = "1c7a2d1f-3e4b-4c6d-9e8f-0a1b2c3d4e5f";
const C = "2d8b3e20-4f5c-4d7e-8f90-1b2c3d4e5f60";
const SECRET = "s".repeat(32);
const NOW = 1_800_000_000_000;
const payload = { aid: A, eid: E, exp: NOW / 1000 + 3600 };

describe("session cookie", () => {
  it("round-trips with and without a contact", () => {
    expect(verifySession(signSession(payload, SECRET), SECRET, NOW)).toEqual(payload);
    const withC = { ...payload, cid: C };
    expect(verifySession(signSession(withC, SECRET), SECRET, NOW)).toEqual(withC);
  });
  it("rejects a wrong secret, tampering, expiry, and malformed values", () => {
    const v = signSession(payload, SECRET);
    expect(verifySession(v, "x".repeat(32), NOW)).toBeNull();
    const [p, s] = v.split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload, eid: A })).toString("base64url");
    expect(verifySession(`${forged}.${s}`, SECRET, NOW)).toBeNull();
    expect(verifySession(v, SECRET, (payload.exp + 1) * 1000)).toBeNull();
    for (const bad of [undefined, "", "a", "a.b", "a.b.c", `${p}.`, `.${s}`, "x".repeat(2000)]) {
      expect(verifySession(bad as string, SECRET, NOW)).toBeNull();
    }
  });
  it("rejects payloads with bad ids or extra types even when correctly signed", () => {
    for (const bad of [{ ...payload, aid: "nope" }, { ...payload, eid: 5 }, { ...payload, exp: "soon" }, { ...payload, cid: "bad" }, { aid: A, eid: E }]) {
      expect(verifySession(signSession(bad as never, SECRET), SECRET, NOW)).toBeNull();
    }
  });
  it("refuses to sign with an empty secret", () => {
    expect(() => signSession(payload, "")).toThrow();
    expect(verifySession(signSession(payload, SECRET), "", NOW)).toBeNull();
  });
  it("expires at the earlier of the link expiry and 8 hours", () => {
    const soon = new Date(NOW + 3600_000).toISOString();
    const later = new Date(NOW + 10 * 3600_000).toISOString();
    expect(sessionExpiry(soon, NOW)).toBe(Math.floor((NOW + 3600_000) / 1000));
    expect(sessionExpiry(later, NOW)).toBe(Math.floor(NOW / 1000) + SESSION_MAX_SEC);
  });
  it("sets a __Host- cookie with the required attributes and no Domain", () => {
    const h = setCookieHeader("v", 600);
    expect(h.startsWith(`${COOKIE_NAME}=v;`)).toBe(true);
    for (const a of ["Path=/", "Max-Age=600", "HttpOnly", "Secure", "SameSite=Lax"]) expect(h).toContain(a);
    expect(h.toLowerCase()).not.toContain("domain");
    expect(clearCookieHeader()).toContain("Max-Age=0");
  });
});
```

`lib/guards.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { isSameOriginJson } from "./guards";

const O = "https://portal.rosably.com";
const req = (h: Record<string, string>) => new Request(`${O}/api/room/identify`, { method: "POST", headers: h });

describe("isSameOriginJson", () => {
  it("accepts the portal origin with JSON", () => {
    expect(isSameOriginJson(req({ origin: O, "content-type": "application/json" }), O)).toBe(true);
    expect(isSameOriginJson(req({ origin: O, "content-type": "application/json; charset=utf-8" }), O)).toBe(true);
  });
  it("rejects missing, null, foreign and look-alike origins and non-JSON bodies", () => {
    for (const h of [
      { "content-type": "application/json" },
      { origin: "null", "content-type": "application/json" },
      { origin: "https://evil.example", "content-type": "application/json" },
      { origin: "https://portal.rosably.com.evil.example", "content-type": "application/json" },
      { origin: "http://portal.rosably.com", "content-type": "application/json" },
      { origin: O, "content-type": "text/plain" },
      { origin: O, "content-type": "application/x-www-form-urlencoded" },
      { origin: O },
    ]) expect(isSameOriginJson(req(h), O)).toBe(false);
  });
});
```

- [ ] **Step 3: Run and confirm failure** — `npx vitest run` → FAIL (modules missing; the copied grant tests pass).

- [ ] **Step 4: Implement**

`lib/token.ts`:
```ts
import { createHash } from "node:crypto";

export function isTokenShape(raw: unknown): raw is string {
  return typeof raw === "string" && /^[A-Za-z0-9_-]{43}$/.test(raw);
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
```

`lib/session.ts`:
```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE_NAME = "__Host-rooms";
export const SESSION_MAX_SEC = 8 * 3600;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface SessionPayload { aid: string; eid: string; cid?: string; exp: number }

const mac = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("base64url");

export function signSession(p: SessionPayload, secret: string): string {
  if (!secret) throw new Error("session secret missing");
  const body = Buffer.from(JSON.stringify(p), "utf8").toString("base64url");
  return `${body}.${mac(secret, body)}`;
}

export function verifySession(value: string | undefined, secret: string, nowMs: number = Date.now()): SessionPayload | null {
  if (typeof value !== "string" || !secret || value.length > 1024) return null;
  const parts = value.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(mac(secret, parts[0]));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let p: unknown;
  try { p = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { return null; }
  if (!p || typeof p !== "object") return null;
  const { aid, eid, cid, exp } = p as Record<string, unknown>;
  if (typeof aid !== "string" || !UUID.test(aid)) return null;
  if (typeof eid !== "string" || !UUID.test(eid)) return null;
  if (cid !== undefined && (typeof cid !== "string" || !UUID.test(cid))) return null;
  if (typeof exp !== "number" || !Number.isInteger(exp) || exp * 1000 <= nowMs) return null;
  return cid === undefined ? { aid, eid, exp } : { aid, eid, cid, exp };
}

export function sessionExpiry(accessExpiresAt: string | Date, nowMs: number = Date.now()): number {
  const link = Math.floor(new Date(accessExpiresAt).getTime() / 1000);
  return Math.min(link, Math.floor(nowMs / 1000) + SESSION_MAX_SEC);
}

export function setCookieHeader(value: string, maxAgeSec: number): string {
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${Math.max(0, Math.floor(maxAgeSec))}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}
```

`lib/guards.ts`:
```ts
export function isSameOriginJson(req: Request, origin: string): boolean {
  if (req.headers.get("origin") !== origin) return false;
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  return ct === "application/json" || ct.startsWith("application/json;");
}
```

- [ ] **Step 5: Run and confirm pass** — `npx vitest run` and `npx tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(room): test runner, token, session cookie, origin guard, grant copy

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Portal data layer and request handlers

**Files (portal repo):** Create `lib/db.ts`, `lib/queries.ts`, `lib/queries.test.ts`, `lib/handlers.ts`, `lib/handlers.test.ts`.

**Interfaces:**
- Consumes: Task 1 SQL column lists; Task 2 modules.
- Produces:
  - `type Q = <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T[]>`; `getQ(): Q` (lazy `postgres` client over `PORTAL_DATABASE_URL`).
  - Queries: `openRoom(q, hash)`, `getSessionRow(q, aid, eid, cid?)`, `identify(q, aid, eid, name, email)`, `listDeliverables(q, aid, eid)`, `versionForPreview(q, aid, eid, cid, versionId)`.
  - `interface Deps { q: Q; sessionSecret: string; grantSecret: string; previewUrl: string; portalOrigin: string; now?: () => number }`; `depsFromEnv(): Deps`.
  - Handlers (all return `Response`): `handleOpen(token, deps)`, `handleIdentify(req, cookie, deps)`, `handleDeliverables(cookie, deps)`, `handlePreviewUrl(cookie, versionId, deps)`, plus `requireSession(cookie, deps): Promise<{ s: SessionPayload; row: RoomHeader } | null>`.

- [ ] **Step 1: Write the failing tests**

`lib/queries.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { openRoom, getSessionRow, identify, listDeliverables, versionForPreview, type Q } from "./queries";

const A = "0b6f1c0e-2d3a-4b5c-8d7e-9f0a1b2c3d4e";
const E = "1c7a2d1f-3e4b-4c6d-9e8f-0a1b2c3d4e5f";
const C = "2d8b3e20-4f5c-4d7e-8f90-1b2c3d4e5f60";
const V = "3e9c4f31-5a6d-4e8f-9aa1-2c3d4e5f6071";

function fake(rows: unknown[][]) {
  const calls: { text: string; values: unknown[] }[] = [];
  const q = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return rows.shift() ?? [];
  }) as unknown as Q;
  return { q, calls };
}

describe("queries call only the portal functions with typed params", () => {
  it("openRoom", async () => {
    const { q, calls } = fake([[{ access_id: A }]]);
    expect(await openRoom(q, "h".repeat(64))).toEqual({ access_id: A });
    expect(calls[0].text).toContain("rooms.portal_open_room(");
    expect(calls[0].values).toEqual(["h".repeat(64)]);
  });
  it("openRoom returns null when the function returns no row", async () => {
    expect(await openRoom(fake([[]]).q, "h".repeat(64))).toBeNull();
  });
  it("getSessionRow passes a null contact explicitly", async () => {
    const { q, calls } = fake([[{ access_id: A }]]);
    await getSessionRow(q, A, E, undefined);
    expect(calls[0].text).toContain("rooms.portal_session(");
    expect(calls[0].values).toEqual([A, E, null]);
  });
  it("identify returns the id or null", async () => {
    expect(await identify(fake([[{ portal_identify: C }]]).q, A, E, "Pat", "p@x.co")).toBe(C);
    expect(await identify(fake([[{ portal_identify: null }]]).q, A, E, "Pat", "bad")).toBeNull();
    expect(await identify(fake([[]]).q, A, E, "Pat", "p@x.co")).toBeNull();
  });
  it("listDeliverables and versionForPreview", async () => {
    const l = fake([[{ version_id: V }]]);
    expect(await listDeliverables(l.q, A, E)).toEqual([{ version_id: V }]);
    expect(l.calls[0].text).toContain("rooms.portal_list_deliverables(");
    const p = fake([[{ storage_prefix: "a/b/v1", entry: "index.html" }]]);
    expect(await versionForPreview(p.q, A, E, C, V)).toEqual({ storage_prefix: "a/b/v1", entry: "index.html" });
    expect(p.calls[0].values).toEqual([A, E, C, V]);
  });
  it("never uses string concatenation: all inputs arrive as bound values", async () => {
    const { q, calls } = fake([[]]);
    await identify(q, A, E, "x'); drop table rooms.engagements; --", "a@b.co");
    expect(calls[0].text).not.toContain("drop table");
    expect(calls[0].values).toContain("x'); drop table rooms.engagements; --");
  });
});
```

`lib/handlers.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { handleOpen, handleIdentify, handleDeliverables, handlePreviewUrl, requireSession, type Deps } from "./handlers";
import { signSession, verifySession, COOKIE_NAME } from "./session";
import { hashToken } from "./token";
import { verifyGrant } from "./grant";
import type { Q } from "./queries";

const A = "0b6f1c0e-2d3a-4b5c-8d7e-9f0a1b2c3d4e";
const E = "1c7a2d1f-3e4b-4c6d-9e8f-0a1b2c3d4e5f";
const C = "2d8b3e20-4f5c-4d7e-8f90-1b2c3d4e5f60";
const V = "3e9c4f31-5a6d-4e8f-9aa1-2c3d4e5f6071";
const TOKEN = "t".repeat(43);
const NOW = 1_800_000_000_000;
const SESSION_SECRET = "s".repeat(32);
const GRANT_SECRET = "g".repeat(32);
const ORIGIN = "https://portal.rosably.com";

const header = { access_id: A, engagement_id: E, expires_at: new Date(NOW + 3600_000).toISOString(),
  title: "Intake", relationship: "prospect", org_name: "Her Promise Circle", modules: { solutions: true },
  contact_id: null as string | null, contact_name: null as string | null };

function deps(script: (text: string, values: unknown[]) => unknown[] | undefined) {
  const calls: { text: string; values: unknown[] }[] = [];
  const q = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push({ text, values });
    return script(text, values) ?? [];
  }) as unknown as Q;
  const d: Deps = { q, sessionSecret: SESSION_SECRET, grantSecret: GRANT_SECRET, previewUrl: "https://preview.rosably.com", portalOrigin: ORIGIN, now: () => NOW };
  return { d, calls };
}
const cookie = (p: object) => signSession(p as never, SESSION_SECRET);
const goodCookie = (extra: object = {}) => cookie({ aid: A, eid: E, exp: NOW / 1000 + 3000, ...extra });

describe("handleOpen", () => {
  it("sends malformed tokens to /link-expired without touching the database", async () => {
    const { d, calls } = deps(() => []);
    for (const bad of ["", "short", "a".repeat(44), "../etc", TOKEN + "\n"]) {
      const r = await handleOpen(bad, d);
      expect(r.status).toBe(303);
      expect(r.headers.get("location")).toBe("/link-expired");
      expect(r.headers.get("set-cookie")).toBeNull();
    }
    expect(calls).toEqual([]);
  });
  it("treats an unknown, revoked or expired link exactly like a malformed one", async () => {
    const { d, calls } = deps(() => []);
    const r = await handleOpen(TOKEN, d);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/link-expired");
    expect(r.headers.get("set-cookie")).toBeNull();
    expect(calls[0].values).toEqual([hashToken(TOKEN)]);
    expect(JSON.stringify(calls)).not.toContain(TOKEN);
  });
  it("sets the session cookie and redirects to /room for a valid link", async () => {
    const { d } = deps(() => [header]);
    const r = await handleOpen(TOKEN, d);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/room");
    const sc = r.headers.get("set-cookie")!;
    expect(sc.startsWith(`${COOKIE_NAME}=`)).toBe(true);
    const value = sc.split(";")[0].slice(COOKIE_NAME.length + 1);
    const p = verifySession(value, SESSION_SECRET, NOW)!;
    expect(p).toMatchObject({ aid: A, eid: E });
    expect(p.exp).toBe(Math.floor(NOW / 1000) + 3600);
    expect(sc).not.toContain(TOKEN);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("requireSession", () => {
  it("rejects missing, forged and expired cookies without a database call", async () => {
    const { d, calls } = deps(() => [header]);
    expect(await requireSession(undefined, d)).toBeNull();
    expect(await requireSession("garbage", d)).toBeNull();
    expect(await requireSession(cookie({ aid: A, eid: E, exp: NOW / 1000 - 10 }), d)).toBeNull();
    expect(calls).toEqual([]);
  });
  it("rejects a validly signed cookie when the database says the link is no longer valid (revoked)", async () => {
    const { d } = deps(() => []);
    expect(await requireSession(goodCookie(), d)).toBeNull();
  });
  it("returns the header row for a valid session", async () => {
    const { d, calls } = deps(() => [header]);
    const s = await requireSession(goodCookie({ cid: C }), d);
    expect(s?.row.title).toBe("Intake");
    expect(calls[0].values).toEqual([A, E, C]);
  });
});

describe("handleIdentify", () => {
  const req = (body: unknown, h: Record<string, string> = { origin: ORIGIN, "content-type": "application/json" }) =>
    new Request(`${ORIGIN}/api/room/identify`, { method: "POST", headers: h, body: JSON.stringify(body) });

  it("rejects cross-origin and non-JSON requests before anything else", async () => {
    const { d, calls } = deps(() => [header]);
    expect((await handleIdentify(req({ name: "P", email: "p@x.co" }, { origin: "https://evil.example", "content-type": "application/json" }), goodCookie(), d)).status).toBe(403);
    expect((await handleIdentify(req({ name: "P", email: "p@x.co" }, { origin: ORIGIN, "content-type": "text/plain" }), goodCookie(), d)).status).toBe(403);
    expect(calls).toEqual([]);
  });
  it("requires a session", async () => {
    const { d } = deps(() => []);
    expect((await handleIdentify(req({ name: "P", email: "p@x.co" }), undefined, d)).status).toBe(401);
  });
  it("validates the body without leaking details", async () => {
    const { d } = deps((t) => (t.includes("portal_session") ? [header] : []));
    for (const body of [{}, { name: 5, email: "a@b.co" }, { name: "P" }, { name: "P", email: "x".repeat(300) + "@b.co" }, "str", null]) {
      const r = await handleIdentify(req(body), goodCookie(), d);
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: "Please check your name and email." });
    }
  });
  it("identifies, then re-signs the cookie with the contact and the same expiry", async () => {
    const { d } = deps((t) => (t.includes("portal_session") ? [header] : t.includes("portal_identify") ? [{ portal_identify: C }] : []));
    const r = await handleIdentify(req({ name: "Pat", email: "pat@x.co" }), goodCookie(), d);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    const value = r.headers.get("set-cookie")!.split(";")[0].slice(COOKIE_NAME.length + 1);
    expect(verifySession(value, SESSION_SECRET, NOW)).toMatchObject({ aid: A, eid: E, cid: C, exp: NOW / 1000 + 3000 });
  });
  it("returns the same generic 400 when the database rejects the introduction", async () => {
    const { d } = deps((t) => (t.includes("portal_session") ? [header] : [{ portal_identify: null }]));
    const r = await handleIdentify(req({ name: "Pat", email: "pat@x.co" }), goodCookie(), d);
    expect(r.status).toBe(400);
  });
});

describe("handleDeliverables", () => {
  it("requires a session and a contact", async () => {
    const { d } = deps(() => [header]);
    expect((await handleDeliverables(undefined, d)).status).toBe(401);
    expect((await handleDeliverables(goodCookie(), d)).status).toBe(401); // header has no contact_id yet
  });
  it("groups versions by deliverable and never exposes internal fields", async () => {
    const rows = [
      { deliverable_id: "d1", deliverable_title: "App", description: null, version_id: "v2", version_no: 2, status: "shared", shared_at: "2026-10-14T10:00:00Z", change_summary: "v2", screens: [{ id: "a", name: "A" }], storage_prefix: "SECRET/PREFIX/v2", manifest: { x: 1 } },
      { deliverable_id: "d1", deliverable_title: "App", description: null, version_id: "v1", version_no: 1, status: "superseded", shared_at: "2026-10-13T10:00:00Z", change_summary: null, screens: [] },
    ];
    const { d } = deps((t) => (t.includes("portal_session") ? [{ ...header, contact_id: C }] : rows));
    const r = await handleDeliverables(goodCookie({ cid: C }), d);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.deliverables).toHaveLength(1);
    expect(body.deliverables[0].versions.map((v: { version_no: number }) => v.version_no)).toEqual([2, 1]);
    expect(JSON.stringify(body)).not.toContain("SECRET");
    expect(JSON.stringify(body)).not.toContain("storage_prefix");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("handlePreviewUrl", () => {
  const withContact = (t: string) => (t.includes("portal_session") ? [{ ...header, contact_id: C }] : undefined);
  it("rejects bad ids without a database call and requires a session", async () => {
    const { d, calls } = deps(() => []);
    expect((await handlePreviewUrl(goodCookie({ cid: C }), "not-a-uuid", d)).status).toBe(404);
    expect((await handlePreviewUrl(undefined, V, d)).status).toBe(401);
    expect(calls).toEqual([]);
  });
  it("returns 404 for a draft, another engagement's version or anything the database refuses", async () => {
    const { d } = deps((t) => withContact(t) ?? []);
    const r = await handlePreviewUrl(goodCookie({ cid: C }), V, d);
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "Not available." });
  });
  it("signs a 15-minute grant for exactly the returned prefix and encodes the entry path", async () => {
    const prefix = `${E}/${A}/v2`;
    const { d, calls } = deps((t) => withContact(t) ?? [{ storage_prefix: prefix, entry: "pages/my page.html", deliverable_id: A, version_no: 2 }]);
    const r = await handlePreviewUrl(goodCookie({ cid: C }), V, d);
    expect(r.status).toBe(200);
    const { url, expiresInSec } = await r.json();
    expect(expiresInSec).toBe(900);
    const m = url.match(/^https:\/\/preview\.rosably\.com\/v\/([^/]+)\/(.+)$/)!;
    expect(verifyGrant(m[1], GRANT_SECRET, NOW)).toMatchObject({ ok: true, prefix });
    expect(m[2]).toBe("pages/my%20page.html");
    expect(calls.at(-1)!.values).toEqual([A, E, C, V]);
  });
  it("falls back to index.html for a suspicious entry", async () => {
    const prefix = `${E}/${A}/v2`;
    for (const entry of ["../x.html", "", "a//b.html", ".hidden.html", null]) {
      const { d } = deps((t) => withContact(t) ?? [{ storage_prefix: prefix, entry, deliverable_id: A, version_no: 2 }]);
      const { url } = await (await handlePreviewUrl(goodCookie({ cid: C }), V, d)).json();
      expect(url.endsWith("/index.html")).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run and confirm failure** — `npx vitest run lib/queries.test.ts lib/handlers.test.ts` → FAIL (modules missing).

- [ ] **Step 3: Implement the data layer**

`lib/db.ts`:
```ts
import postgres from "postgres";

export type Q = <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T[]>;

let client: ReturnType<typeof postgres> | undefined;

// Lazy, pooled-connection client for the limited portal_app role. Never log the URL or any query values.
export function getQ(): Q {
  if (!client) {
    const url = process.env.PORTAL_DATABASE_URL;
    if (!url) throw new Error("PORTAL_DATABASE_URL is not configured");
    client = postgres(url, { max: 1, prepare: false, ssl: "require", idle_timeout: 20, connect_timeout: 10 });
  }
  const c = client;
  return ((strings: TemplateStringsArray, ...values: unknown[]) =>
    c(strings, ...(values as never[])) as unknown as Promise<unknown[]>) as unknown as Q;
}
```

`lib/queries.ts`:
```ts
import type { Q } from "./db";
export type { Q } from "./db";

export interface RoomHeader {
  access_id: string; engagement_id: string; expires_at: string | Date; title: string;
  relationship: string; org_name: string; modules: Record<string, unknown>;
  contact_id?: string | null; contact_name?: string | null;
}
export interface DeliverableRow {
  deliverable_id: string; deliverable_title: string; description: string | null;
  version_id: string; version_no: number; status: string; shared_at: string | null;
  change_summary: string | null; screens: { id: string; name: string }[];
}
export interface PreviewRow { storage_prefix: string; entry: string | null; deliverable_id: string; version_no: number }

export async function openRoom(q: Q, hash: string): Promise<RoomHeader | null> {
  const rows = await q<RoomHeader>`select * from rooms.portal_open_room(${hash})`;
  return rows[0] ?? null;
}

export async function getSessionRow(q: Q, aid: string, eid: string, cid: string | undefined): Promise<RoomHeader | null> {
  const rows = await q<RoomHeader>`select * from rooms.portal_session(${aid}::uuid, ${eid}::uuid, ${cid ?? null}::uuid)`;
  return rows[0] ?? null;
}

export async function identify(q: Q, aid: string, eid: string, name: string, email: string): Promise<string | null> {
  const rows = await q<{ portal_identify: string | null }>`select rooms.portal_identify(${aid}::uuid, ${eid}::uuid, ${name}, ${email})`;
  return rows[0]?.portal_identify ?? null;
}

export async function listDeliverables(q: Q, aid: string, eid: string): Promise<DeliverableRow[]> {
  return q<DeliverableRow>`select * from rooms.portal_list_deliverables(${aid}::uuid, ${eid}::uuid)`;
}

export async function versionForPreview(q: Q, aid: string, eid: string, cid: string | undefined, versionId: string): Promise<PreviewRow | null> {
  const rows = await q<PreviewRow>`select * from rooms.portal_version_for_preview(${aid}::uuid, ${eid}::uuid, ${cid ?? null}::uuid, ${versionId}::uuid)`;
  return rows[0] ?? null;
}
```
(In the tests `getSessionRow(q, A, E, undefined)` expects values `[A, E, null]`, `versionForPreview(q, A, E, C, V)` expects `[A, E, C, V]`.)

`lib/handlers.ts`:
```ts
import { getQ } from "./db";
import { openRoom, getSessionRow, identify, listDeliverables, versionForPreview, type Q, type RoomHeader, type DeliverableRow } from "./queries";
import { isTokenShape, hashToken } from "./token";
import { signSession, verifySession, sessionExpiry, setCookieHeader, type SessionPayload } from "./session";
import { isSameOriginJson } from "./guards";
import { signGrant, GRANT_TTL_SEC } from "./grant";

export interface Deps {
  q: Q; sessionSecret: string; grantSecret: string; previewUrl: string; portalOrigin: string; now?: () => number;
}

export function depsFromEnv(): Deps {
  return {
    q: getQ(),
    sessionSecret: process.env.ROOM_SESSION_SECRET ?? "",
    grantSecret: process.env.ROOM_GRANT_SECRET ?? "",
    previewUrl: (process.env.NEXT_PUBLIC_PREVIEW_URL ?? "https://preview.rosably.com").replace(/\/+$/, ""),
    portalOrigin: process.env.PORTAL_ORIGIN ?? "https://portal.rosably.com",
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const nowMs = (d: Deps) => (d.now ? d.now() : Date.now());

const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", ...extra },
  });

const expired = () => new Response(null, { status: 303, headers: { Location: "/link-expired", "Cache-Control": "private, no-store" } });

export async function handleOpen(token: string, d: Deps): Promise<Response> {
  if (!isTokenShape(token)) return expired();
  let row: RoomHeader | null;
  try { row = await openRoom(d.q, hashToken(token)); } catch { return expired(); }
  if (!row || !d.sessionSecret) return expired();
  const exp = sessionExpiry(row.expires_at, nowMs(d));
  const value = signSession({ aid: row.access_id, eid: row.engagement_id, exp }, d.sessionSecret);
  return new Response(null, {
    status: 303,
    headers: { Location: "/room", "Cache-Control": "private, no-store", "Set-Cookie": setCookieHeader(value, exp - Math.floor(nowMs(d) / 1000)) },
  });
}

export async function requireSession(cookie: string | undefined, d: Deps): Promise<{ s: SessionPayload; row: RoomHeader } | null> {
  const s = verifySession(cookie, d.sessionSecret, nowMs(d));
  if (!s) return null;
  try {
    const row = await getSessionRow(d.q, s.aid, s.eid, s.cid);
    return row ? { s, row } : null;
  } catch { return null; }
}

export async function handleIdentify(req: Request, cookie: string | undefined, d: Deps): Promise<Response> {
  if (!isSameOriginJson(req, d.portalOrigin)) return json({ error: "Not allowed." }, 403);
  const sess = await requireSession(cookie, d);
  if (!sess) return json({ error: "Session expired." }, 401);
  let body: unknown;
  try { body = await req.json(); } catch { body = null; }
  const b = body as { name?: unknown; email?: unknown } | null;
  const bad = () => json({ error: "Please check your name and email." }, 400);
  if (!b || typeof b !== "object" || typeof b.name !== "string" || typeof b.email !== "string") return bad();
  if (b.name.length > 200 || b.email.length > 300) return bad();
  let cid: string | null;
  try { cid = await identify(d.q, sess.s.aid, sess.s.eid, b.name, b.email); } catch { return bad(); }
  if (!cid) return bad();
  const value = signSession({ aid: sess.s.aid, eid: sess.s.eid, cid, exp: sess.s.exp }, d.sessionSecret);
  return json({ ok: true }, 200, { "Set-Cookie": setCookieHeader(value, sess.s.exp - Math.floor(nowMs(d) / 1000)) });
}

export async function handleDeliverables(cookie: string | undefined, d: Deps): Promise<Response> {
  const sess = await requireSession(cookie, d);
  if (!sess || !sess.row.contact_id) return json({ error: "Session expired." }, 401);
  let rows: DeliverableRow[];
  try { rows = await listDeliverables(d.q, sess.s.aid, sess.s.eid); } catch { return json({ error: "Not available." }, 500); }
  const byId = new Map<string, { id: string; title: string; description: string | null; versions: unknown[] }>();
  for (const r of rows) {
    if (!byId.has(r.deliverable_id)) byId.set(r.deliverable_id, { id: r.deliverable_id, title: r.deliverable_title, description: r.description, versions: [] });
    byId.get(r.deliverable_id)!.versions.push({
      id: r.version_id, version_no: r.version_no, status: r.status, shared_at: r.shared_at,
      change_summary: r.change_summary, screens: r.screens ?? [],
    });
  }
  return json({ deliverables: [...byId.values()] }, 200);
}

function entryPath(entry: unknown): string {
  if (typeof entry !== "string" || !entry) return "index.html";
  const segs = entry.split("/");
  if (segs.some(s => s === "" || s === "." || s === ".." || s.startsWith("."))) return "index.html";
  return segs.map(encodeURIComponent).join("/");
}

export async function handlePreviewUrl(cookie: string | undefined, versionId: string, d: Deps): Promise<Response> {
  if (!UUID.test(versionId)) return json({ error: "Not available." }, 404);
  const sess = await requireSession(cookie, d);
  if (!sess || !sess.row.contact_id) return json({ error: "Session expired." }, 401);
  let row;
  try { row = await versionForPreview(d.q, sess.s.aid, sess.s.eid, sess.s.cid, versionId); } catch { return json({ error: "Not available." }, 404); }
  if (!row) return json({ error: "Not available." }, 404);
  let grant: string;
  try { grant = signGrant(row.storage_prefix, d.grantSecret, nowMs(d)); } catch { return json({ error: "Not available." }, 404); }
  return json({ url: `${d.previewUrl}/v/${grant}/${entryPath(row.entry)}`, expiresInSec: GRANT_TTL_SEC }, 200);
}
```

- [ ] **Step 4: Run and confirm pass** — `npx vitest run` and `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(room): portal data layer and request handlers

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Portal routes, pages, UI and headers

**Files (portal repo):** Create `app/r/[token]/route.ts`, `app/room/page.tsx`, `app/link-expired/page.tsx`, `app/api/room/identify/route.ts`, `app/api/room/deliverables/route.ts`, `app/api/room/versions/[id]/preview-url/route.ts`, `components/IntroForm.tsx`, `components/RoomView.tsx`, `components/room-styles.ts`; Modify `next.config.ts`. Test: `components/room-pages.test.tsx`.

**Interfaces:** consumes Task 3 handlers; produces the public routes in the spec. No other public routes.

- [ ] **Step 1: Write the failing test** (`components/room-pages.test.tsx`) for the pure, server-renderable pieces:

```tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LinkExpired from "@/app/link-expired/page";
import { IntroForm } from "@/components/IntroForm";
import { FrameLabel, welcomeText } from "@/components/RoomView";

describe("link-expired page", () => {
  const html = renderToStaticMarkup(<LinkExpired />);
  it("is friendly, links home, and reveals no reason", () => {
    expect(html).toContain("This link isn&#x27;t working");
    expect(html).toContain('href="https://rosably.com"');
    expect(html.toLowerCase()).not.toMatch(/revoked|expired because|invalid token|not found in/);
    expect(html).not.toContain("<script");
  });
});

describe("intro form", () => {
  it("collects name and email with labels and posts only to the same origin", () => {
    const html = renderToStaticMarkup(<IntroForm orgName="Her Promise Circle" />);
    expect(html).toContain("Her Promise Circle");
    expect(html).toMatch(/<label[^>]*>Your name/);
    expect(html).toMatch(/<label[^>]*>Your email/);
    expect(html).toContain('type="email"');
    expect(html).not.toMatch(/action="https?:/);
  });
});

describe("room view helpers", () => {
  it("labels the frame as untrusted content", () => {
    expect(renderToStaticMarkup(<FrameLabel />)).toContain("untrusted");
  });
  it("words the welcome by relationship and never claims verification", () => {
    expect(welcomeText("prospect")).toMatch(/prototype/i);
    expect(welcomeText("client")).toMatch(/project/i);
    expect(welcomeText("partner")).toMatch(/collaborat|shared/i);
    expect(welcomeText("whatever")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run and confirm failure** — `npx vitest run components` → FAIL.

- [ ] **Step 3: Implement the routes** (each is a thin wiring of a Task 3 handler):

`app/r/[token]/route.ts`:
```ts
import { handleOpen, depsFromEnv } from "@/lib/handlers";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handleOpen(token, depsFromEnv());
}
```

`app/api/room/identify/route.ts`:
```ts
import { cookies } from "next/headers";
import { handleIdentify, depsFromEnv } from "@/lib/handlers";
import { COOKIE_NAME } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const jar = await cookies();
  return handleIdentify(req, jar.get(COOKIE_NAME)?.value, depsFromEnv());
}
```

`app/api/room/deliverables/route.ts`:
```ts
import { cookies } from "next/headers";
import { handleDeliverables, depsFromEnv } from "@/lib/handlers";
import { COOKIE_NAME } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const jar = await cookies();
  return handleDeliverables(jar.get(COOKIE_NAME)?.value, depsFromEnv());
}
```

`app/api/room/versions/[id]/preview-url/route.ts`:
```ts
import { cookies } from "next/headers";
import { handlePreviewUrl, depsFromEnv } from "@/lib/handlers";
import { COOKIE_NAME } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jar = await cookies();
  return handlePreviewUrl(jar.get(COOKIE_NAME)?.value, id, depsFromEnv());
}
```

`app/link-expired/page.tsx` (server component, static): heading "This link isn't working"; text "It may have expired or been replaced. Please ask your Rosably contact for a new link, or head back to our home page."; the same button style as the other friendly pages linking to `https://rosably.com`; `export const metadata = { title: "Rosably", robots: { index: false, follow: false } }`. Use `components/room-styles.ts` (shared style objects: `main`, `button`, `card`, `input`, `label`).

`app/room/page.tsx`:
```tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { depsFromEnv, requireSession } from "@/lib/handlers";
import { COOKIE_NAME } from "@/lib/session";
import { IntroForm } from "@/components/IntroForm";
import { RoomView } from "@/components/RoomView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rosably", robots: { index: false, follow: false } };

export default async function RoomPage() {
  const jar = await cookies();
  const sess = await requireSession(jar.get(COOKIE_NAME)?.value, depsFromEnv());
  if (!sess) redirect("/link-expired");
  if (!sess.row.contact_id) return <IntroForm orgName={sess.row.org_name} />;
  return (
    <RoomView title={sess.row.title} orgName={sess.row.org_name} relationship={sess.row.relationship}
      contactName={sess.row.contact_name ?? ""} />
  );
}
```

- [ ] **Step 4: Implement the components** (client components; plain, accessible, mobile-friendly, inline styles from `room-styles.ts`):

`components/IntroForm.tsx` (`"use client"`): heading "Welcome", text "Before we begin, please tell us who is looking so we can follow up on your feedback." (no claim of verification), labelled inputs `Your name` (required, max 100) and `Your email` (type email, required), submit "Continue". On submit: `fetch("/api/room/identify", { method: "POST", headers: {"Content-Type":"application/json"}, body })` (same origin); disable the button while pending (ref guard); on `ok` call `window.location.reload()` (do NOT use `useRouter` here: the component is rendered outside the Next router in unit tests, and `useRouter` throws there); on failure show the response's `error` text or "Something went wrong. Please try again." Props: `{ orgName: string }`. Export named `IntroForm`.

`components/RoomView.tsx` (`"use client"`): exports `FrameLabel`, `welcomeText(relationship: string): string` and `RoomView({ title, orgName, relationship, contactName })`.
- `welcomeText`: `prospect` -> "Here are the prototypes we've prepared for you. Click through them and tell us what you think."; `client` -> "Here's the latest on your project. Click through what we've shared."; `partner` -> "Here's what we've shared to collaborate on. Click through it any time."; default -> "Here's what we've shared with you."
- Header: org name and room title; "Hello, {contactName}"; welcome text.
- Fetch `/api/room/deliverables` on mount (guarded, with a Retry on error; a 401 shows a message and a link to reload). Empty state: "Nothing has been shared yet. We'll let you know when there's something to review."
- Solutions: per deliverable a card with its title, a version `<select>` (newest first, label `v{n}` plus " (older)" when status is `superseded`), the change summary, and the frame. Selecting a version calls `/api/room/versions/{id}/preview-url`, stores `{url}` and an expiry timer; a `setInterval` every 10 minutes silently re-requests the URL for the currently shown version. Cancel timers on unmount/selection change.
- Frame: `<FrameLabel />` ("Prototype preview — untrusted content. Don't enter real passwords or personal data.") above `<iframe src={url} sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer" title="Prototype preview" style={{width:"100%",height:"70vh",border:"1px solid #d0d5dd",borderRadius:8}} />`. The attribute strings must be exactly those; add a comment forbidding `allow-same-origin`.

- [ ] **Step 5: Headers** (`next.config.ts`): keep the existing three headers; add for all routes `Content-Security-Policy: frame-ancestors 'none'; frame-src <origin of NEXT_PUBLIC_PREVIEW_URL, default https://preview.rosably.com>; base-uri 'none'; object-src 'none'; form-action 'self'` (computed with `new URL(...).origin`), and `Cache-Control: private, no-store` for `/room`, `/r/:path*`, `/link-expired` and `/api/:path*`.

- [ ] **Step 6: Verify** — `npx vitest run`, `npx tsc --noEmit`, `rm -rf .next && npm run build` (routes: `/`, `/_not-found`, `/api/health`, `/api/room/deliverables`, `/api/room/identify`, `/api/room/versions/[id]/preview-url`, `/link-expired`, `/r/[token]`, `/room`). Also a `next start` smoke check with dummy env (`PORTAL_DATABASE_URL=postgres://u:p@127.0.0.1:1/x ROOM_SESSION_SECRET=x…`): `GET /r/<43 x's>` returns 303 to `/link-expired` (the database is unreachable and the handler must fail safe), `GET /room` returns 307/303 to `/link-expired`, `GET /link-expired` returns 200 with the CSP header and the home link, and no response contains the token.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(room): room routes, intro form, Solutions view, friendly expired page, CSP

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Dashboard — Share action (dashboard repo, branch `feat/room-share-activity`)

**Files:** Create `src/app/api/versions/[id]/share/route.ts`, `src/app/api/versions/[id]/share/route.test.ts`; Modify `src/app/(dashboard)/engagements/[id]/page.tsx`.

**Interfaces:** consumes `rooms.share_version` (Task 1). Produces `POST /api/versions/[id]/share` -> `200 { version_id, version_no, superseded_count }`, `404` unknown id, `409` not a draft.

- [ ] **Step 1: Write the failing route test** (`route.test.ts`; mock `@/lib/supabase-admin` with a stub whose `.schema("rooms").rpc(name, args)` returns `{ data, error }`):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: { schema: () => ({ rpc }) } }));
import { POST } from "./route";

const V = "3e9c4f31-5a6d-4e8f-9aa1-2c3d4e5f6071";
const call = (id: string) => POST(new Request("https://d.test/x", { method: "POST" }) as never, { params: Promise.resolve({ id }) });

beforeEach(() => rpc.mockReset());

describe("POST /api/versions/[id]/share", () => {
  it("rejects a non-uuid id without calling the database", async () => {
    const r = await call("nope");
    expect(r.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("shares a draft through the atomic function", async () => {
    rpc.mockResolvedValue({ data: [{ version_id: V, version_no: 3, superseded_count: 1 }], error: null });
    const r = await call(V);
    expect(rpc).toHaveBeenCalledWith("share_version", { p_version: V });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ version_id: V, version_no: 3, superseded_count: 1 });
  });
  it("maps 'only a draft can be shared' to 409 and 'not found' to 404, with no raw database text", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "only a draft can be shared" } });
    let r = await call(V);
    expect(r.status).toBe(409);
    expect(JSON.stringify(await r.json())).not.toContain("P0001");
    rpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "version not found" } });
    r = await call(V);
    expect(r.status).toBe(404);
  });
  it("returns 500 with a generic message for unexpected errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "secret internal detail" } });
    const r = await call(V);
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("secret internal detail");
  });
});
```

- [ ] **Step 2: Run and confirm failure**, then implement (`route.ts`):

```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST — publish a draft to the room. Atomic: the previously shared version of the deliverable becomes superseded.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid version id." }, { status: 400 });
  const { data, error } = await supabaseAdmin.schema("rooms").rpc("share_version", { p_version: id });
  if (error) {
    if (error.code === "P0001") return NextResponse.json({ error: "Only a draft can be shared." }, { status: 409 });
    if (error.code === "P0002") return NextResponse.json({ error: "Version not found." }, { status: 404 });
    return NextResponse.json({ error: "Could not share this version." }, { status: 500 });
  }
  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json(row ?? {});
}
```

- [ ] **Step 3: UI.** In `engagements/[id]/page.tsx`, read the file first. For each version row with `status === "draft"`, add a **Share with room** button next to **Preview**. Clicking it first reveals an inline confirm (not `window.confirm`): "Share v{n} with everyone who has a link to this room? The previous shared version will be marked as older." with **Share** and **Cancel**. **Share** runs through the existing `guarded(...)` helper: `fetchJson(`/api/versions/${versionId}/share`, { method: "POST" })`, then `load()`; success message "v{n} is now visible in the room."; errors via the existing `msg`. Show shared versions with a "Shared" badge in the row text (the row already prints the status). Do not add an unshare action.

- [ ] **Step 4: Verify** — `npx vitest run`, `npx tsc --noEmit`, placeholder-env production build.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(rooms): Share action for draft versions (atomic via share_version)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Dashboard — Activity tab

**Files:** Create `src/app/api/engagements/[id]/activity/route.ts`, `src/app/api/engagements/[id]/activity/route.test.ts`; Modify `src/app/(dashboard)/engagements/[id]/page.tsx`.

**Interfaces:** produces `GET /api/engagements/[id]/activity` -> `{ events: ActivityEvent[], contacts: Contact[] }` where `ActivityEvent = { id: number; type: string; created_at: string; contact: { name: string; email: string } | null; version: { deliverable_title: string; version_no: number } | null }` and `Contact = { id: string; name: string; email: string; first_seen_at: string }`.

- [ ] **Step 1: Failing test** (mock `supabaseAdmin.schema("rooms").from(table)` with a small chainable stub keyed by table: `engagement_events` -> `select().eq().order().limit()`, `engagement_contacts` -> `select().eq()`, `deliverable_versions` -> `select().in()` returning `deliverable:deliverables(title)`; read the repo's existing route tests for the stub style). Assertions: events come back newest first with contact name/email and `{deliverable_title, version_no}` attached; a non-uuid id returns 400 with no query; contacts are listed; a failed secondary lookup (contacts or versions) degrades to `contact: null` / `version: null` instead of a 500; the response never contains `access_id` or `meta`; at most 100 events.

- [ ] **Step 2: Implement** (`route.ts`): validate the uuid; fetch the latest 100 events (`id, type, created_at, contact_id, version_id`) ordered by `created_at desc`; one query for contacts of the engagement (`id, name, email, first_seen_at`); one query for the distinct `version_id`s (`id, version_no, deliverable:deliverables(title)`); join in code; return the shape above. Never select `meta`.

- [ ] **Step 3: UI.** Extend the page's tab type to `"deliverables" | "access" | "activity"` and the tab button list. The **Activity** tab loads `/api/engagements/${id}/activity` (via `fetchJson`, with Retry) when first opened and shows: a contacts list ("People who opened this room", each `name · email` with the muted note "provided by the visitor, not verified") and a reverse-chronological event list with plain-language lines: `room_opened` -> "Someone opened the room"; `contact_identified` -> "{name} introduced themselves"; `version_viewed` -> "{name or 'A visitor'} viewed {deliverable title} v{n}"; any other type -> the raw type. Each line has a relative time (`formatDistanceToNow`). Empty state: "No activity yet. Share a version and send the room link." Text is rendered as React text (never as HTML).

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run && npx tsc --noEmit
git add -A && git commit -m "feat(rooms): Activity tab (opens, introductions, views)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Deployment and end-to-end test (Brian + controller)

No new code. Do these in order; each needs Brian's explicit go-ahead.

- [ ] **Step 1: Apply the migration** (`apply_migration`, name `rooms_portal`) using the Task 1 file; re-run the assertion script against production **inside a rolled-back transaction**; confirm `portal_app` exists and `anon` cannot execute the functions (`has_function_privilege('anon', 'rooms.portal_open_room(text)', 'execute')` is `false`).
- [ ] **Step 2: Brian sets the role password** in the Supabase dashboard (Database -> Roles -> `portal_app`) and copies the **pooler** connection string (Connect -> Transaction pooler); the user part must read `portal_app.<project ref>`. Test it with `psql` or a one-line script that runs `select * from rooms.portal_open_room(repeat('0',64))` (expect zero rows) and `select count(*) from rooms.engagements` (expect `permission denied`).
- [ ] **Step 3: Portal Vercel env (Production only):** `PORTAL_DATABASE_URL`, `ROOM_SESSION_SECRET` (new `openssl rand -base64 32`), `ROOM_GRANT_SECRET` (same as the dashboard's), `NEXT_PUBLIC_PREVIEW_URL=https://preview.rosably.com`, `PORTAL_ORIGIN=https://portal.rosably.com`. Redeploy.
- [ ] **Step 4: Vercel Firewall rule** on the portal: rate limit `/r/*` and `/api/room/*` per IP (suggest 30 requests/minute).
- [ ] **Step 5: Merge the dashboard and portal PRs** (dashboard first, so Share exists).
- [ ] **Step 6: Manual end-to-end:**
  1. Create a room, request a prototype (or use an existing draft), **Share** the draft.
  2. Create a link; open it in a private window: you land on the introduction form with the URL showing `/room`, not the token.
  3. Introduce yourself; see the shared prototype in the frame; switch versions after sharing a second one (the first becomes "older").
  4. Dashboard **Activity** tab shows the open, the introduction and the view.
  5. **Revoke** the link; reload the private window: the friendly expired page.
  6. Open `https://portal.rosably.com/r/<43 random characters>` and an old/garbage link: identical friendly expired page.
  7. Confirm a draft version is not listed in the room, and that `view-source` on `/room` contains no `storage_prefix`.

---

## Self-review

**Spec coverage:** link exchange + cookie (T3/T4), introduction (T3/T4), Solutions view with version picker and sandboxed frame and silent grant refresh (T4), friendly expired page (T4), Share (T1/T5), Activity (T6), database-enforced access (T1), headers (T4), deployment and firewall rule (T7). Deferred by amendment: `screen_viewed` events and `portal_log_event` (Phase 3).

**Placeholder scan:** none. Two UI tasks (T5 Step 3, T6 Step 3) describe edits to an existing large page instead of reproducing it; they specify exact labels, flows and the existing helpers to reuse.

**Type/name consistency:** SQL column lists in Task 1 match `RoomHeader`, `DeliverableRow` and `PreviewRow` in Task 3; `portal_identify` returns a single column named `portal_identify` (used as such in `queries.ts`); function parameter order matches the query calls and the tests' expected bound values; cookie name and helpers are identical across tests and code; the preview grant uses the 15-minute TTL constant exported by the grant module.

**Known follow-ups:** Phase 3 (comments, decisions, bridge listener, `screen_viewed`); a storage-read-only credential for the preview host; email sending from the room.
