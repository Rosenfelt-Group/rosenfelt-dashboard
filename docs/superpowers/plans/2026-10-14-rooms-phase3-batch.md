# Engagement Rooms Phase 3 Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seven approved room improvements: delete a deliverable, refresh a room link, a sliding 2-hour portal session, documents (Brian uploads, visitors download), version dates, a full-height prototype frame, and a welcome message per deliverable.

**Architecture:** One additive migration adds the `document` kind, an `upload` version source, `deliverables.welcome_message`, a private `room-documents` bucket and four `SECURITY DEFINER` functions (`delete_deliverable`, `refresh_access`, `add_document_version` for `service_role`; `portal_document_for_download` for `portal_app`), and re-creates `portal_list_deliverables` with a wider result. The dashboard uploads documents straight from the browser to Storage with a signed upload URL, then verifies the object (magic bytes in the route, size and MIME in the database) before a draft version row exists. Visitors download through the preview host (`/d/<grant>`), which streams the object with `Content-Disposition: attachment` and `nosniff`; the grant is a new, domain-separated "document grant" in the shared `grant.ts`, so the portal still holds no Storage credential.

**Tech Stack:** PostgreSQL 17 (Supabase, `SECURITY DEFINER` functions, Storage), Next.js 16 / React 19 / TypeScript, `@supabase/supabase-js` 2.x (dashboard), `postgres` (portal), zod 4 (dashboard), vitest.

**Spec:** `docs/superpowers/specs/2026-10-14-engagement-rooms-design.md` (room model), the Phase 2 plan `docs/superpowers/plans/2026-10-14-portal-room-phase2.md` (portal security model, which this plan keeps), and the user-approved feature list for this batch, restated as decisions in Global Constraints below. There is no separate Phase 3 spec; the decisions below are the spec.

## Global Constraints

- Repos (all under `/home/brian/work/discovery/`): `dashboard` (GitHub `Rosenfelt-Group/rosenfelt-dashboard`, branch `feat/rooms-phase3` from `origin/main`), `portal` (branch `feat/room-phase3` from `origin/main`), `preview-host` (branch `feat/room-documents` from `origin/main`, NOT from the unmerged `feat/friendly-landing`).
- Database: ONE additive migration `docs/migrations/2026-10-14_rooms_phase3.sql` plus a rolled-back assertion script `docs/migrations/2026-10-14_rooms_phase3_test.sql`, in the dashboard repo. Every new function is `SECURITY DEFINER` with `SET search_path = rooms, pg_temp`; `EXECUTE` is revoked from `public, anon, authenticated`; grants go only to `portal_app` and/or `service_role` as listed in Task 1.
- `portal_list_deliverables` changes its return shape, so it is `DROP FUNCTION` + `CREATE FUNCTION` with the identical grants re-applied (`portal_app, service_role`). Its only callers: portal `lib/queries.ts` `listDeliverables` (`select *`), used by `lib/handlers.ts` `handleDeliverables`; the Phase 2 assertion script. Nothing in `dashboard` or `casey-agent` calls it (checked with grep). The deployed portal uses `select *` and reads named fields, so extra columns are harmless to it.
- `portal_app` gets no table privilege and no Storage access. The portal never receives `storage_prefix` in browser-bound JSON and never holds a Storage key.
- Shared byte-identical file: only `grant.ts` (and `grant.test.ts`) is copied across all three repos (`dashboard/src/lib/rooms/grant.ts` is the source; `portal/lib/grant.ts`, `preview-host/lib/grant.ts`). After editing, `cmp` all three. `token.ts` differs between dashboard and portal (not shared); `guards.ts` and `session.ts` exist only in the portal.
- Documents: allowed extensions exactly `pdf, docx, xlsx, pptx, png, jpg` (`.jpeg` accepted and stored as `jpg`), `txt, csv, md`; size 1 byte to 25 MB (26214400 bytes); visitors do NOT upload. Storage path `{engagement}/{deliverable}/{upload uuid}/document.{ext}` in bucket `room-documents`; version `storage_prefix` = `{engagement}/{deliverable}/{upload uuid}`; `manifest` = `{kind:"document", file, filename, ext, mime, size}`; `source = 'upload'`; uploads start as `draft` and become visible only through the existing `share_version`.
- Downloads: only from the preview host route `/d/<document grant>`, with `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cache-Control: private, no-store`; `Content-Type` comes from the extension map, never from Storage. Document grant TTL 120 seconds.
- Session: sliding idle timeout `SESSION_IDLE_SEC = 7200`, absolute cap `SESSION_MAX_SEC = 28800` measured from `st` (link-open time), link expiry still applies; `exp = min(link expiry, now + 2h, st + 8h)`. Cookies without `st` fail closed (visitor re-opens the link). Every authenticated portal API response re-issues the cookie.
- Welcome message: nullable `rooms.deliverables.welcome_message`, 1-1000 characters (empty means null), plain text, rendered as React text with `white-space: pre-line`, never as HTML.
- Version dates: `created_at` formatted `MMM d, yyyy` in `en-US` (e.g. `Oct 14, 2026`) in the viewer's local time zone.
- Prototype frame: `height: calc(100dvh - 2rem)` with `min-height: 480px`; sandbox stays exactly `allow-scripts allow-forms`; never `allow-same-origin` or any new flag.
- Never put secrets, raw room tokens or grants in logs, error messages or chat. Dashboard API errors return fixed messages, never raw database text.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push or open PRs until Brian asks.

## Decisions (and why)

1. **Delete order: database first, then Storage.** `rooms.delete_deliverable` locks the deliverable, collects every object under `{engagement}/{deliverable}/` in both buckets, records `deliverable_deleted`, deletes the row (versions and comments cascade; `engagement_events.version_id` is `ON DELETE SET NULL`, so events never block), and returns the object list. The route then removes the objects through the Storage API (direct SQL deletes on `storage.objects` are blocked by Supabase's `protect_objects_delete` trigger). If Storage removal fails, the files are orphans no row points to and nothing can grant access to them; the event's `meta.storage_folder` records where they are. The reverse order could leave a row pointing at deleted files. Casey work items have no foreign key to rooms (verified), so they stay as history.
2. **Refresh = one database transaction** (`rooms.refresh_access`): revoke the chosen link and insert its replacement (same label, new expiry) atomically. Per-link "Refresh" button; works on an expired link too.
3. **Document storage**: a new private bucket `room-documents` (the existing `documents` bucket belongs to Casey's document tools and is left alone) with `file_size_limit` 25 MB and an `allowed_mime_types` list, so Storage itself refuses oversize or off-list uploads. The browser uploads with a signed upload URL (Vercel's 4.5 MB function body limit never applies). No version row exists until `finalize` has checked magic bytes (route) and size + MIME (database, from `storage.objects.metadata`); a failed check deletes the object.
4. **Download path: preview host, not portal.** The portal verifies the session and asks the database (`portal_document_for_download`), then signs a document grant; the preview host verifies the grant and streams the file. This keeps Storage credentials out of the portal, serves untrusted bytes from the already-untrusted preview origin, and streams (Vercel's 4.5 MB response limit does not apply to streamed responses). Grant separation: a document grant has a different shape (`d1.<path>.<filename>.<exp>.<mac>`, five parts), a MAC over a domain-prefixed string, a different route (`/d/`) and a different bucket; a prototype grant fails `verifyDocGrant` and a document grant fails `verifyGrant`. `portal_version_for_preview` is also narrowed to `kind = 'prototype'`.
5. **Sliding session renews only from API calls.** The `/room` page is a Server Component and cannot set cookies; the client's `/api/room/deliverables` call on mount renews right after. Clicking around inside a prototype does not reach the portal, so a visitor who only interacts inside the frame for 2 hours will be asked to re-open the link. Accepted.
6. **Welcome message placement**: the room-level line (`welcomeText(relationship)`) stays at the top; a deliverable's own message shows under its title in its card. The "Nothing has been shared yet" screen keeps the room-level line only, because unshared deliverables are not sent to the portal.
7. **Version date time zone**: the viewer's local zone (dashboard: Brian's browser; portal: the visitor's browser). Both views are client-rendered after fetch, so there is no server/client hydration mismatch.
8. **Frame height**: viewport-height sizing. Residual limitation: a sandboxed, cross-origin (opaque-origin) frame cannot be measured from the parent, so a prototype taller than the viewport still scrolls inside the frame; the page itself only scrolls to bring the frame into view. A bridge `postMessage` height report would fix that later but is out of scope.

## Review Focus

1. **A file whose contents do not match its extension** (an HTML or SVG file renamed `.pdf` or `.png`, a binary renamed `.txt`): must be refused at finalize and its object deleted; even if it slipped through, it is only ever served as an attachment with `nosniff` and a sandbox CSP from the preview origin (Tasks 8, 3).
2. **Hostile file names** (quotes, CR/LF, path separators, leading dots, right-to-left override characters, 300-character names, non-ASCII): sanitized at upload, re-checked in SQL and in the grant, and encoded safely in `Content-Disposition` (Tasks 2, 3, 8, 1).
3. **Old or odd session cookies** after deploy: a Phase 2 cookie without `st`, an `st` in the future, `exp` beyond `st + 8h`, a link that expires before the idle window: all fail closed or cap correctly (Task 10).
4. **Partial failure during delete or refresh**: Storage removal fails after the rows are gone; a double-clicked refresh; refreshing a link of a closed room (Tasks 4, 5, 1).
5. **Welcome text that looks like markup or is very long** (`<script>`, `<b>`, CRLF, 1001 characters, only whitespace): stored as plain text or null, rendered as text with line breaks (Tasks 7, 11, 1).

## File Structure

**dashboard** (`Rosenfelt-Group/rosenfelt-dashboard`)
- Create `docs/migrations/2026-10-14_rooms_phase3.sql`, `docs/migrations/2026-10-14_rooms_phase3_test.sql` (Task 1)
- Modify `src/lib/rooms/grant.ts`, `src/lib/rooms/grant.test.ts` (Task 2, shared copy)
- Create `src/lib/rooms/storage-cleanup.ts` (+test), `src/app/api/deliverables/[id]/route.ts` (+test) (Tasks 4, 7)
- Create `src/app/api/engagements/[id]/access/[accessId]/refresh/route.ts` (+test) (Task 5)
- Create `src/lib/rooms/format.ts` (+test) (Task 6)
- Modify `src/lib/rooms/schemas.ts`; create `src/lib/rooms/schemas-phase3.test.ts` (Tasks 5, 7, 8)
- Create `src/app/(dashboard)/engagements/[id]/WelcomeEditor.tsx` (Task 7)
- Create `src/lib/rooms/doc-limits.ts`, `src/lib/rooms/documents.ts` (+test), `src/app/api/engagements/[id]/documents/route.ts` (+test), `src/app/api/engagements/[id]/documents/finalize/route.ts` (+test), `src/app/api/versions/[id]/download/route.ts`, `src/app/(dashboard)/engagements/[id]/DocumentUpload.tsx` (Task 8)
- Modify `src/app/api/engagements/[id]/route.ts` (Tasks 7, 8), `src/app/api/engagements/[id]/prototype-request/route.ts` (Task 8), `src/app/api/engagements/[id]/activity/route.ts` (+test) (Task 9), `src/app/(dashboard)/engagements/[id]/page.tsx` (Tasks 4-9)

**preview-host**: Modify `lib/grant.ts`, `lib/grant.test.ts` (copies), `lib/storage.ts` (+test); create `lib/docs.ts` (+test), `app/d/[grant]/route.ts`; modify `README.md` (Task 3)

**portal**: Modify `lib/session.ts` (+test), `lib/handlers.ts` (+test), `lib/queries.ts` (+test), `lib/grant.ts`/`lib/grant.test.ts` (copies), `components/RoomView.tsx`, `components/room-pages.test.tsx`; create `lib/format.ts` (+test), `app/api/room/versions/[id]/document-url/route.ts` (Tasks 10-12)

---

### Task 1: Migration and assertions (dashboard repo)

**Files:**
- Create: `docs/migrations/2026-10-14_rooms_phase3.sql`
- Create: `docs/migrations/2026-10-14_rooms_phase3_test.sql`

**Interfaces:**
- Consumes: Phase 2 objects (`rooms._portal_access_ok`, `rooms.share_version`, role `portal_app`).
- Produces (SQL, used verbatim by later tasks):
  - `rooms.delete_deliverable(p_deliverable uuid, p_actor text) returns table (bucket text, object_name text)`; errors: `P0002` not found. `service_role` only.
  - `rooms.refresh_access(p_eng uuid, p_access uuid, p_token_hash text, p_expires_at timestamptz) returns table (access_id uuid, expires_at timestamptz)`; errors: `P0002` engagement/link not found, `P0001` revoked link, closed room, bad hash, bad expiry. `service_role` only.
  - `rooms.add_document_version(p_deliverable uuid, p_upload uuid, p_ext text, p_filename text, p_change_summary text) returns table (version_id uuid, version_no int)`; errors: `P0002` deliverable not found, `P0001` anything else. `service_role` only.
  - `rooms.portal_document_for_download(p_access uuid, p_eng uuid, p_contact uuid, p_version uuid) returns table (storage_prefix text, file text, filename text)`; logs `document_downloaded`. `portal_app, service_role`.
  - `rooms.portal_list_deliverables(p_access uuid, p_eng uuid) returns table (deliverable_id uuid, deliverable_title text, description text, kind text, welcome_message text, version_id uuid, version_no int, status text, shared_at timestamptz, created_at timestamptz, change_summary text, screens jsonb, document jsonb)` where `document` is `{filename, ext, size}` for documents and null for prototypes.
  - Event types: `deliverable_deleted` (meta `deliverable_id, deliverable_title, kind, version_count, comment_count, object_count, storage_folder, actor`), `link_refreshed` (meta `old_access_id, access_id`), `document_downloaded` (`version_id`, `contact_id`, meta `access_id`).
  - Bucket `room-documents`.

- [ ] **Step 1: Write the migration** (`docs/migrations/2026-10-14_rooms_phase3.sql`)

```sql
-- Engagement Rooms Phase 3 batch: documents, deliverable delete, link refresh, per-deliverable welcome
-- message, version dates in the portal. Additive: widens two CHECKs, adds one nullable column and one
-- private bucket, adds four functions, narrows portal_version_for_preview (same signature, grants kept),
-- and re-creates portal_list_deliverables with a wider result (DROP + CREATE; grants re-applied below).

-- 1) Schema
alter table rooms.deliverables drop constraint deliverables_kind_check;
alter table rooms.deliverables add constraint deliverables_kind_check check (kind in ('prototype', 'document'));
alter table rooms.deliverable_versions drop constraint deliverable_versions_source_check;
alter table rooms.deliverable_versions add constraint deliverable_versions_source_check check (source in ('agent', 'upload'));
alter table rooms.deliverables add column welcome_message text
  constraint deliverables_welcome_message_check
  check (welcome_message is null or char_length(welcome_message) between 1 and 1000);

-- 2) Private bucket for room documents. Storage enforces the size cap and MIME list on every upload,
--    including signed-URL uploads from the browser.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('room-documents', 'room-documents', false, 26214400, array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png', 'image/jpeg', 'text/plain', 'text/csv', 'text/markdown'])
on conflict (id) do nothing;

-- 3) Delete a deliverable completely (dashboard, service_role only). Rows go first, atomically; the
--    caller removes the returned Storage objects afterwards. A failed Storage removal leaves orphan
--    files that no row points to, never a row that points to a missing file.
create or replace function rooms.delete_deliverable(p_deliverable uuid, p_actor text)
returns table (bucket text, object_name text)
language plpgsql security definer set search_path = rooms, pg_temp as $$
#variable_conflict use_column
declare d rooms.deliverables%rowtype; v_folder text; n_versions int; n_comments int; v_objects jsonb;
begin
  select * into d from rooms.deliverables where id = p_deliverable for update;
  if not found then raise exception 'deliverable not found' using errcode = 'P0002'; end if;
  v_folder := d.engagement_id::text || '/' || d.id::text || '/';
  select count(*) into n_versions from rooms.deliverable_versions v where v.deliverable_id = d.id;
  select count(*) into n_comments from rooms.deliverable_comments c
    join rooms.deliverable_versions v on v.id = c.version_id where v.deliverable_id = d.id;
  select coalesce(jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'name', o.name) order by o.bucket_id, o.name), '[]'::jsonb)
    into v_objects
    from storage.objects o
   where o.bucket_id in ('prototypes', 'room-documents') and starts_with(o.name, v_folder);
  insert into rooms.engagement_events (engagement_id, type, meta)
    values (d.engagement_id, 'deliverable_deleted', jsonb_build_object(
      'deliverable_id', d.id, 'deliverable_title', d.title, 'kind', d.kind,
      'version_count', n_versions, 'comment_count', n_comments,
      'object_count', jsonb_array_length(v_objects), 'storage_folder', v_folder,
      'actor', left(coalesce(p_actor, ''), 100)));
  delete from rooms.deliverables where id = d.id;
  return query select x->>'bucket', x->>'name' from jsonb_array_elements(v_objects) x;
end $$;

-- 4) Refresh a room link (dashboard, service_role only): revoke it and issue its replacement atomically.
create or replace function rooms.refresh_access(p_eng uuid, p_access uuid, p_token_hash text, p_expires_at timestamptz)
returns table (access_id uuid, expires_at timestamptz)
language plpgsql security definer set search_path = rooms, pg_temp as $$
#variable_conflict use_column
declare a rooms.engagement_access%rowtype; v_status text; v_id uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid token hash' using errcode = 'P0001'; end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '366 days' then
    raise exception 'invalid expiry' using errcode = 'P0001'; end if;
  select e.status into v_status from rooms.engagements e where e.id = p_eng;
  if not found then raise exception 'engagement not found' using errcode = 'P0002'; end if;
  if v_status = 'closed' then raise exception 'engagement is closed' using errcode = 'P0001'; end if;
  select * into a from rooms.engagement_access x where x.id = p_access and x.engagement_id = p_eng for update;
  if not found then raise exception 'link not found' using errcode = 'P0002'; end if;
  if a.revoked_at is not null then raise exception 'link already revoked' using errcode = 'P0001'; end if;
  update rooms.engagement_access set revoked_at = now() where id = a.id;
  insert into rooms.engagement_access (engagement_id, token_hash, label, expires_at)
    values (p_eng, p_token_hash, a.label, p_expires_at) returning id into v_id;
  insert into rooms.engagement_events (engagement_id, type, meta)
    values (p_eng, 'link_refreshed', jsonb_build_object('old_access_id', a.id, 'access_id', v_id));
  return query select v_id, p_expires_at;
end $$;

-- 5) Add an uploaded document as a draft version (dashboard, service_role only). The object must already
--    exist in room-documents with an allowed size and the MIME type that matches the extension.
create or replace function rooms.add_document_version(p_deliverable uuid, p_upload uuid, p_ext text,
                                                      p_filename text, p_change_summary text)
returns table (version_id uuid, version_no int)
language plpgsql security definer set search_path = rooms, pg_temp as $$
#variable_conflict use_column
declare
  d rooms.deliverables%rowtype;
  v_mime text := case p_ext
    when 'pdf'  then 'application/pdf'
    when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    when 'xlsx' then 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    when 'pptx' then 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    when 'png'  then 'image/png'
    when 'jpg'  then 'image/jpeg'
    when 'txt'  then 'text/plain'
    when 'csv'  then 'text/csv'
    when 'md'   then 'text/markdown'
  end;
  v_prefix text; v_file text; v_meta jsonb; v_size bigint; v_no int; v_id uuid;
begin
  if v_mime is null or p_upload is null then raise exception 'unsupported document' using errcode = 'P0001'; end if;
  if p_filename is null or char_length(p_filename) not between 1 and 150
     or p_filename ~ '[[:cntrl:]/\\"\u200e\u200f\u202a-\u202e\u2066-\u2069]'
     or left(p_filename, 1) = '.' or p_filename <> btrim(p_filename) then
    raise exception 'invalid file name' using errcode = 'P0001'; end if;
  if p_change_summary is not null and char_length(p_change_summary) > 500 then
    raise exception 'change summary too long' using errcode = 'P0001'; end if;
  select * into d from rooms.deliverables where id = p_deliverable for update;
  if not found then raise exception 'deliverable not found' using errcode = 'P0002'; end if;
  if d.kind <> 'document' then raise exception 'not a document deliverable' using errcode = 'P0001'; end if;
  v_prefix := d.engagement_id::text || '/' || d.id::text || '/' || p_upload::text;
  v_file := 'document.' || p_ext;
  select o.metadata into v_meta from storage.objects o
   where o.bucket_id = 'room-documents' and o.name = v_prefix || '/' || v_file;
  if not found then raise exception 'uploaded file not found' using errcode = 'P0001'; end if;
  v_size := case when jsonb_typeof(v_meta->'size') = 'number' then (v_meta->>'size')::bigint end;
  if v_size is null or v_size < 1 or v_size > 26214400 then raise exception 'file size not allowed' using errcode = 'P0001'; end if;
  if lower(btrim(split_part(coalesce(v_meta->>'mimetype', ''), ';', 1))) <> v_mime then
    raise exception 'file type mismatch' using errcode = 'P0001'; end if;
  if exists (select 1 from rooms.deliverable_versions x where x.storage_prefix = v_prefix) then
    raise exception 'upload already added' using errcode = 'P0001'; end if;
  select coalesce(max(x.version_no), 0) + 1 into v_no from rooms.deliverable_versions x where x.deliverable_id = d.id;
  insert into rooms.deliverable_versions (deliverable_id, version_no, status, source, storage_prefix, manifest, change_summary)
    values (d.id, v_no, 'draft', 'upload', v_prefix,
            jsonb_build_object('kind', 'document', 'file', v_file, 'filename', p_filename, 'ext', p_ext,
                               'mime', v_mime, 'size', v_size),
            nullif(btrim(coalesce(p_change_summary, '')), ''))
    returning id into v_id;
  return query select v_id, v_no;
end $$;

-- 6) Portal: shared (never draft) documents of this engagement; logs document_downloaded (deduplicated).
create or replace function rooms.portal_document_for_download(p_access uuid, p_eng uuid, p_contact uuid, p_version uuid)
returns table (storage_prefix text, file text, filename text)
language plpgsql security definer set search_path = rooms, pg_temp as $$
#variable_conflict use_column
declare v_contact uuid := null; v_row record;
begin
  if not rooms._portal_access_ok(p_access, p_eng) then return; end if;
  select v.storage_prefix as sp, v.manifest->>'file' as f, v.manifest->>'filename' as fn
    into v_row
    from rooms.deliverable_versions v join rooms.deliverables d on d.id = v.deliverable_id
   where v.id = p_version and d.engagement_id = p_eng and d.kind = 'document' and v.source = 'upload'
     and v.status in ('shared', 'superseded', 'approved', 'changes_requested');
  if not found then return; end if;
  if p_contact is not null and exists (select 1 from rooms.engagement_contacts c where c.id = p_contact and c.engagement_id = p_eng)
    then v_contact := p_contact; end if;
  if not exists (select 1 from rooms.engagement_events ev
                  where ev.engagement_id = p_eng and ev.type = 'document_downloaded' and ev.version_id = p_version
                    and ev.contact_id is not distinct from v_contact and ev.created_at > now() - interval '10 minutes') then
    insert into rooms.engagement_events (engagement_id, version_id, contact_id, type, meta)
      values (p_eng, p_version, v_contact, 'document_downloaded', jsonb_build_object('access_id', p_access));
  end if;
  return query select v_row.sp, v_row.f, v_row.fn;
end $$;

-- 7) Prototype previews only for prototypes (same signature as Phase 2, so its grants are kept).
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
   where v.id = p_version and d.engagement_id = p_eng and d.kind = 'prototype'
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

-- 8) Wider portal list (return shape changes, so DROP + CREATE; grants re-applied below).
--    Callers: portal lib/queries.ts listDeliverables (select *), used by handleDeliverables.
drop function if exists rooms.portal_list_deliverables(uuid, uuid);
create function rooms.portal_list_deliverables(p_access uuid, p_eng uuid)
returns table (deliverable_id uuid, deliverable_title text, description text, kind text, welcome_message text,
               version_id uuid, version_no int, status text, shared_at timestamptz, created_at timestamptz,
               change_summary text, screens jsonb, document jsonb)
language plpgsql security definer set search_path = rooms, pg_temp as $$
#variable_conflict use_column
begin
  if not rooms._portal_access_ok(p_access, p_eng) then return; end if;
  return query
    select d.id, d.title, d.description, d.kind, d.welcome_message,
           v.id, v.version_no, v.status, v.shared_at, v.created_at, v.change_summary,
           case when d.kind = 'prototype' and jsonb_typeof(v.manifest->'screens') = 'array'
                then (select coalesce(jsonb_agg(jsonb_build_object('id', s->>'id', 'name', s->>'name')), '[]'::jsonb)
                        from jsonb_array_elements(v.manifest->'screens') s)
                else '[]'::jsonb end,
           case when d.kind = 'document'
                then jsonb_build_object('filename', v.manifest->'filename', 'ext', v.manifest->'ext', 'size', v.manifest->'size')
                else null end
      from rooms.deliverables d
      join rooms.deliverable_versions v on v.deliverable_id = d.id
     where d.engagement_id = p_eng
       and v.status in ('shared', 'superseded', 'approved', 'changes_requested')
     order by d.sort_order, d.created_at, v.version_no desc;
end $$;

-- 9) Privileges. rooms is exposed through the REST API: nothing may be executable by anon/authenticated.
revoke all on function rooms.delete_deliverable(uuid, text) from public, anon, authenticated;
revoke all on function rooms.refresh_access(uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function rooms.add_document_version(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function rooms.portal_document_for_download(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function rooms.portal_list_deliverables(uuid, uuid) from public, anon, authenticated;

grant execute on function rooms.delete_deliverable(uuid, text) to service_role;
grant execute on function rooms.refresh_access(uuid, uuid, text, timestamptz) to service_role;
grant execute on function rooms.add_document_version(uuid, uuid, text, text, text) to service_role;
grant execute on function rooms.portal_document_for_download(uuid, uuid, uuid, uuid) to portal_app, service_role;
grant execute on function rooms.portal_list_deliverables(uuid, uuid) to portal_app, service_role;
```

- [ ] **Step 2: Write the assertion script** (`docs/migrations/2026-10-14_rooms_phase3_test.sql`). It runs after the migration in the same transaction and raises on any failure; everything is rolled back. Note: `raise exception` defaults to SQLSTATE `P0001`, so FAIL raises are always placed outside blocks that catch `P0001`.

```sql
do $$
declare
  v_biz uuid; v_eng uuid; v_eng2 uuid; v_acc uuid; v_acc2 uuid; v_new_acc uuid; v_contact uuid;
  v_hash text := encode(sha256('phase3-test-token'::bytea), 'hex');
  v_hash_new text := encode(sha256('phase3-test-new'::bytea), 'hex');
  v_hash_x text := encode(sha256('phase3-test-x'::bytea), 'hex');
  v_proto uuid; v_doc uuid; v_pv uuid; v_dv1 uuid; v_dv2 uuid;
  v_up1 uuid := gen_random_uuid(); v_up2 uuid := gen_random_uuid(); v_up3 uuid := gen_random_uuid();
  v_prefix1 text; v_folder text; n int; r record; v_ok boolean;
begin
  grant portal_app to current_user;
  select id into v_biz from crm.businesses limit 1;
  insert into rooms.engagements (business_id, relationship, title) values (v_biz, 'prospect', 'P3a') returning id into v_eng;
  insert into rooms.engagements (business_id, relationship, title) values (v_biz, 'client', 'P3b') returning id into v_eng2;
  insert into rooms.engagement_access (engagement_id, token_hash, label) values (v_eng, v_hash, 'Board') returning id into v_acc;
  insert into rooms.engagement_access (engagement_id, token_hash) values (v_eng2, encode(sha256('phase3-other'::bytea), 'hex')) returning id into v_acc2;
  v_contact := rooms.portal_identify(v_acc, v_eng, 'Pat', 'pat@example.org');

  -- schema: kind, source, welcome_message
  insert into rooms.deliverables (engagement_id, title, kind, welcome_message) values (v_eng, 'Proposal', 'document', E'Hello\nthere') returning id into v_doc;
  insert into rooms.deliverables (engagement_id, title) values (v_eng, 'App') returning id into v_proto;
  v_ok := false; begin insert into rooms.deliverables (engagement_id, title, kind) values (v_eng, 'x', 'video'); exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'FAIL kind check accepts video'; end if;
  v_ok := false; begin update rooms.deliverables set welcome_message = repeat('x', 1001) where id = v_doc; exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'FAIL welcome 1001 chars accepted'; end if;
  v_ok := false; begin update rooms.deliverables set welcome_message = '' where id = v_doc; exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'FAIL empty welcome accepted'; end if;
  update rooms.deliverables set welcome_message = repeat('y', 1000) where id = v_doc;
  update rooms.deliverables set welcome_message = E'Hello\nthere' where id = v_doc;
  insert into rooms.deliverable_versions (deliverable_id, version_no, status, storage_prefix, manifest)
    values (v_proto, 1, 'shared', v_eng::text || '/' || v_proto::text || '/v1', '{"entry":"index.html","screens":[{"id":"s1","name":"One"}]}') returning id into v_pv;

  -- add_document_version
  v_prefix1 := v_eng::text || '/' || v_doc::text || '/' || v_up1::text;
  v_ok := false; begin perform rooms.add_document_version(v_doc, v_up1, 'pdf', 'Proposal.pdf', null); exception when sqlstate 'P0001' then v_ok := true; end;
  if not v_ok then raise exception 'FAIL add without uploaded object'; end if;
  insert into storage.objects (bucket_id, name, metadata) values ('room-documents', v_prefix1 || '/document.pdf', '{"size": 1234, "mimetype": "application/pdf"}');
  select * into r from rooms.add_document_version(v_doc, v_up1, 'pdf', 'Proposal.pdf', '  First draft  ');
  v_dv1 := r.version_id;
  if r.version_no <> 1 then raise exception 'FAIL first document version_no %', r.version_no; end if;
  select * into r from rooms.deliverable_versions where id = v_dv1;
  if r.status <> 'draft' or r.source <> 'upload' or r.storage_prefix <> v_prefix1 or r.change_summary <> 'First draft'
     or r.manifest->>'file' <> 'document.pdf' or r.manifest->>'filename' <> 'Proposal.pdf' or (r.manifest->>'size')::int <> 1234 then
    raise exception 'FAIL document version row %', row_to_json(r); end if;
  v_ok := false; begin perform rooms.add_document_version(v_doc, v_up1, 'pdf', 'Proposal.pdf', null); exception when sqlstate 'P0001' then v_ok := true; end;
  if not v_ok then raise exception 'FAIL same upload added twice'; end if;
  insert into storage.objects (bucket_id, name, metadata)
    values ('room-documents', v_eng::text || '/' || v_doc::text || '/' || v_up2::text || '/document.docx', '{"size": 10, "mimetype": "application/pdf"}');
  v_ok := false; begin perform rooms.add_document_version(v_doc, v_up2, 'docx', 'a.docx', null); exception when sqlstate 'P0001' then v_ok := true; end;
  if not v_ok then raise exception 'FAIL mime mismatch accepted'; end if;
  update storage.objects set metadata = '{"size": 26214401, "mimetype": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}'
   where bucket_id = 'room-documents' and name = v_eng::text || '/' || v_doc::text || '/' || v_up2::text || '/document.docx';
  v_ok := false; begin perform rooms.add_document_version(v_doc, v_up2, 'docx', 'a.docx', null); exception when sqlstate 'P0001' then v_ok := true; end;
  if not v_ok then raise exception 'FAIL oversize accepted'; end if;
  v_ok := false; begin perform rooms.add_document_version(v_doc, gen_random_uuid(), 'exe', 'a.exe', null); exception when sqlstate 'P0001' then v_ok := true; end;
  if not v_ok then raise exception 'FAIL exe accepted'; end if;
  -- hostile file names: use a VALID, not-yet-added object (v_up3, markdown) so only the name can cause the refusal;
  -- the same object is added successfully with a safe name further down, proving it was valid.
  insert into storage.objects (bucket_id, name, metadata)
    values ('room-documents', v_eng::text || '/' || v_doc::text || '/' || v_up3::text || '/document.md', '{"size": 20, "mimetype": "text/markdown"}');
  declare v_name text; begin
    foreach v_name in array array['a/b.md', 'a"b.md', E'a\nb.md', '.hidden.md', ' padded.md', E'evil\u202Edm.txt', repeat('n', 151)] loop
      v_ok := false;
      begin perform rooms.add_document_version(v_doc, v_up3, 'md', v_name, null); exception when sqlstate 'P0001' then v_ok := true; end;
      if not v_ok then raise exception 'FAIL hostile file name accepted: %', v_name; end if;
    end loop;
  end;
  select count(*) into n from rooms.deliverable_versions where storage_prefix = v_eng::text || '/' || v_doc::text || '/' || v_up3::text;
  if n <> 0 then raise exception 'FAIL a hostile name created a version'; end if;
  v_ok := false; begin perform rooms.add_document_version(v_proto, v_up1, 'pdf', 'x.pdf', null); exception when sqlstate 'P0001' then v_ok := true; end;
  if not v_ok then raise exception 'FAIL document added to a prototype deliverable'; end if;
  v_ok := false; begin perform rooms.add_document_version(gen_random_uuid(), v_up1, 'pdf', 'x.pdf', null); exception when sqlstate 'P0002' then v_ok := true; end;
  if not v_ok then raise exception 'FAIL unknown deliverable'; end if;

  -- portal list: drafts hidden, new columns, no prefix column
  select count(*) into n from rooms.portal_list_deliverables(v_acc, v_eng) where deliverable_id = v_doc;
  if n <> 0 then raise exception 'FAIL draft document visible'; end if;
  perform rooms.share_version(v_dv1);
  select * into r from rooms.portal_list_deliverables(v_acc, v_eng) where version_id = v_dv1;
  if r.kind <> 'document' or r.welcome_message <> E'Hello\nthere' or r.created_at is null or r.screens <> '[]'::jsonb
     or r.document->>'filename' <> 'Proposal.pdf' or r.document->>'ext' <> 'pdf' or (r.document->>'size')::int <> 1234 then
    raise exception 'FAIL list document row %', row_to_json(r); end if;
  select * into r from rooms.portal_list_deliverables(v_acc, v_eng) where version_id = v_pv;
  if r.kind <> 'prototype' or r.document is not null or jsonb_array_length(r.screens) <> 1 or r.welcome_message is not null then
    raise exception 'FAIL list prototype row %', row_to_json(r); end if;
  if pg_get_function_result('rooms.portal_list_deliverables(uuid,uuid)'::regprocedure) ~ 'storage_prefix|manifest' then
    raise exception 'FAIL list exposes storage_prefix or manifest'; end if;

  -- preview vs download separation
  select count(*) into n from rooms.portal_version_for_preview(v_acc, v_eng, v_contact, v_dv1);  if n <> 0 then raise exception 'FAIL document previewable as prototype'; end if;
  select count(*) into n from rooms.portal_version_for_preview(v_acc, v_eng, v_contact, v_pv);   if n <> 1 then raise exception 'FAIL prototype preview broken'; end if;
  select count(*) into n from rooms.portal_document_for_download(v_acc, v_eng, v_contact, v_pv); if n <> 0 then raise exception 'FAIL prototype downloadable as document'; end if;
  select * into r from rooms.portal_document_for_download(v_acc, v_eng, v_contact, v_dv1);
  if r.storage_prefix <> v_prefix1 or r.file <> 'document.pdf' or r.filename <> 'Proposal.pdf' then raise exception 'FAIL download row'; end if;
  perform rooms.portal_document_for_download(v_acc, v_eng, v_contact, v_dv1);
  select count(*) into n from rooms.engagement_events where version_id = v_dv1 and type = 'document_downloaded';
  if n <> 1 then raise exception 'FAIL download event dedupe %', n; end if;
  select count(*) into n from rooms.portal_document_for_download(v_acc2, v_eng2, null, v_dv1); if n <> 0 then raise exception 'FAIL download from other engagement'; end if;
  select count(*) into n from rooms.portal_document_for_download(v_acc2, v_eng, null, v_dv1);  if n <> 0 then raise exception 'FAIL download with other access'; end if;
  select version_id into v_dv2 from rooms.add_document_version(v_doc, v_up3, 'md', 'Notes.md', null);
  select count(*) into n from rooms.portal_document_for_download(v_acc, v_eng, v_contact, v_dv2); if n <> 0 then raise exception 'FAIL draft document downloadable'; end if;
  select version_no into n from rooms.deliverable_versions where id = v_dv2; if n <> 2 then raise exception 'FAIL second version_no %', n; end if;

  -- refresh_access
  select * into r from rooms.refresh_access(v_eng, v_acc, v_hash_new, now() + interval '60 days');
  v_new_acc := r.access_id;
  select count(*) into n from rooms.engagement_access where id = v_acc and revoked_at is not null; if n <> 1 then raise exception 'FAIL old link not revoked'; end if;
  select count(*) into n from rooms.engagement_access where id = v_new_acc and label = 'Board' and token_hash = v_hash_new and revoked_at is null;
  if n <> 1 then raise exception 'FAIL new link row'; end if;
  select count(*) into n from rooms.portal_open_room(v_hash);     if n <> 0 then raise exception 'FAIL old link still opens'; end if;
  select count(*) into n from rooms.portal_open_room(v_hash_new); if n <> 1 then raise exception 'FAIL new link does not open'; end if;
  select count(*) into n from rooms.engagement_events where engagement_id = v_eng and type = 'link_refreshed'; if n <> 1 then raise exception 'FAIL link_refreshed event'; end if;
  v_ok := false; begin perform rooms.refresh_access(v_eng, v_acc, v_hash_x, now() + interval '1 day'); exception when sqlstate 'P0001' then v_ok := true; end;
  if not v_ok then raise exception 'FAIL refresh of a revoked link (double click)'; end if;
  v_ok := false; begin perform rooms.refresh_access(v_eng2, v_new_acc, v_hash_x, now() + interval '1 day'); exception when sqlstate 'P0002' then v_ok := true; end;
  if not v_ok then raise exception 'FAIL refresh across engagements'; end if;
  v_ok := false; begin perform rooms.refresh_access(v_eng, v_new_acc, 'nothex', now() + interval '1 day'); exception when sqlstate 'P0001' then v_ok := true; end;
  if not v_ok then raise exception 'FAIL refresh with bad hash'; end if;
  v_ok := false; begin perform rooms.refresh_access(v_eng, v_new_acc, v_hash_x, now() - interval '1 day'); exception when sqlstate 'P0001' then v_ok := true; end;
  if not v_ok then raise exception 'FAIL refresh with past expiry'; end if;
  update rooms.engagements set status = 'closed' where id = v_eng;
  v_ok := false; begin perform rooms.refresh_access(v_eng, v_new_acc, v_hash_x, now() + interval '1 day'); exception when sqlstate 'P0001' then v_ok := true; end;
  if not v_ok then raise exception 'FAIL refresh in a closed room'; end if;
  update rooms.engagements set status = 'active' where id = v_eng;

  -- delete_deliverable
  insert into rooms.deliverable_comments (version_id, screen_id, body, author_user) values (v_dv1, 'doc', 'Looks good', 'brian');
  insert into storage.objects (bucket_id, name, metadata) values ('prototypes', v_eng::text || '/' || v_proto::text || '/v1/index.html', '{}');
  insert into storage.objects (bucket_id, name, metadata) values ('room-documents', v_eng::text || '/' || v_doc::text || '/' || gen_random_uuid()::text || '/document.pdf', '{}');
  v_folder := v_eng::text || '/' || v_doc::text || '/';
  n := 0;
  for r in select * from rooms.delete_deliverable(v_doc, 'brian') loop
    n := n + 1;
    if r.bucket <> 'room-documents' or not starts_with(r.object_name, v_folder) then raise exception 'FAIL delete returned foreign object %', r.object_name; end if;
  end loop;
  if n <> 4 then raise exception 'FAIL delete expected 4 objects (3 uploads + 1 orphan), got %', n; end if;
  select count(*) into n from rooms.deliverables where id = v_doc;                         if n <> 0 then raise exception 'FAIL deliverable still there'; end if;
  select count(*) into n from rooms.deliverable_versions where id in (v_dv1, v_dv2);       if n <> 0 then raise exception 'FAIL versions still there'; end if;
  select count(*) into n from rooms.deliverable_comments where version_id = v_dv1;         if n <> 0 then raise exception 'FAIL comments still there'; end if;
  select count(*) into n from rooms.engagement_events where type = 'document_downloaded' and engagement_id = v_eng and version_id is null;
  if n <> 1 then raise exception 'FAIL earlier events must survive with version_id null'; end if;
  select * into r from rooms.engagement_events where engagement_id = v_eng and type = 'deliverable_deleted';
  if r.meta->>'deliverable_title' <> 'Proposal' or (r.meta->>'version_count')::int <> 2 or (r.meta->>'comment_count')::int <> 1
     or (r.meta->>'object_count')::int <> 4 or r.meta->>'actor' <> 'brian' then raise exception 'FAIL delete event meta %', r.meta; end if;
  select count(*) into n from rooms.deliverable_versions where id = v_pv;                  if n <> 1 then raise exception 'FAIL other deliverable touched'; end if;
  select count(*) into n from storage.objects where starts_with(name, v_folder);           if n <> 4 then raise exception 'FAIL function must not delete storage rows itself'; end if;
  v_ok := false; begin perform rooms.delete_deliverable(v_doc, 'brian'); exception when sqlstate 'P0002' then v_ok := true; end;
  if not v_ok then raise exception 'FAIL delete twice'; end if;

  -- function-level EXECUTE: none for anon/authenticated
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'rooms' and (p.proname like 'portal\_%' or p.proname in
              ('share_version', '_portal_access_ok', 'delete_deliverable', 'refresh_access', 'add_document_version')) loop
    if has_function_privilege('anon', r.sig, 'execute') or has_function_privilege('authenticated', r.sig, 'execute') then
      raise exception 'FAIL function-level execute for anon/authenticated on %', r.sig;
    end if;
  end loop;
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'rooms' and (p.proname like 'portal\_%' or p.proname in
     ('share_version', '_portal_access_ok', 'delete_deliverable', 'refresh_access', 'add_document_version'));
  if n <> 11 then raise exception 'FAIL expected 11 room functions, found %', n; end if;
  if not has_function_privilege('service_role', 'rooms.delete_deliverable(uuid,text)', 'execute')
     or not has_function_privilege('service_role', 'rooms.refresh_access(uuid,uuid,text,timestamptz)', 'execute')
     or not has_function_privilege('service_role', 'rooms.add_document_version(uuid,uuid,text,text,text)', 'execute')
     or not has_function_privilege('portal_app', 'rooms.portal_list_deliverables(uuid,uuid)', 'execute')
     or not has_function_privilege('portal_app', 'rooms.portal_document_for_download(uuid,uuid,uuid,uuid)', 'execute')
     or not has_function_privilege('portal_app', 'rooms.portal_version_for_preview(uuid,uuid,uuid,uuid)', 'execute') then
    raise exception 'FAIL expected grants missing'; end if;

  -- portal_app: portal functions yes; service functions, tables and Storage no
  set local role portal_app;
  select count(*) into n from rooms.portal_list_deliverables(v_new_acc, v_eng); if n <> 1 then raise exception 'FAIL portal_app list'; end if;
  reset role;
  set local role portal_app;
  begin perform rooms.delete_deliverable(v_proto, 'x'); reset role; raise exception 'FAIL portal_app executes delete_deliverable';
  exception when insufficient_privilege then reset role; end;
  set local role portal_app;
  begin perform rooms.refresh_access(v_eng, v_new_acc, v_hash_x, now() + interval '1 day'); reset role; raise exception 'FAIL portal_app executes refresh_access';
  exception when insufficient_privilege then reset role; end;
  set local role portal_app;
  begin perform rooms.add_document_version(v_proto, v_up1, 'pdf', 'x.pdf', null); reset role; raise exception 'FAIL portal_app executes add_document_version';
  exception when insufficient_privilege then reset role; end;
  set local role portal_app;
  begin perform 1 from storage.objects limit 1; reset role; raise exception 'FAIL portal_app reads storage.objects';
  exception when insufficient_privilege then reset role; end;
  set local role portal_app;
  begin perform 1 from rooms.deliverables limit 1; reset role; raise exception 'FAIL portal_app reads deliverables';
  exception when insufficient_privilege then reset role; end;
  begin set local role anon; perform rooms.portal_document_for_download(v_new_acc, v_eng, null, v_pv); reset role; raise exception 'FAIL anon executes download';
  exception when insufficient_privilege then reset role; end;
  reset role;
end $$;
```

- [ ] **Step 3: Dry-run on production, nothing persists.** With the Supabase MCP `execute_sql` on project `ukfpmpxwdlpsjqbxreza`, send ONE request: `begin;` + the full migration + the full assertion script + `rollback;`. Expected: no error. Then confirm nothing leaked:

```sql
select not exists (select 1 from storage.buckets where id = 'room-documents') as bucket_absent,
       not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'rooms' and p.proname in ('delete_deliverable','refresh_access','add_document_version','portal_document_for_download')) as functions_absent,
       not exists (select 1 from information_schema.columns
                    where table_schema = 'rooms' and table_name = 'deliverables' and column_name = 'welcome_message') as column_absent;
```
Expected: all `true`. If an assertion fails, fix the migration (not the assertion, unless the assertion is wrong) and repeat.

- [ ] **Step 4: Note the stale Phase 2 count.** The Phase 2 assertion script expects 7 functions; after this migration there are 8 matching its pattern (`portal_document_for_download` is new). Edit `docs/migrations/2026-10-14_rooms_portal_test.sql`: change `if n <> 7 then raise exception 'FAIL expected 7 portal functions, found %', n; end if;` to `if n <> 8 then raise exception 'FAIL expected 8 portal functions (7 from Phase 2 + portal_document_for_download from Phase 3), found %', n; end if;` so both scripts pass against the post-Phase-3 database.

- [ ] **Step 5: Commit.** Do NOT apply to production here (Task 13).

```bash
git add docs/migrations/2026-10-14_rooms_phase3.sql docs/migrations/2026-10-14_rooms_phase3_test.sql docs/migrations/2026-10-14_rooms_portal_test.sql
git commit -m "feat(rooms): phase 3 migration (documents, delete, link refresh, welcome, list dates) + assertions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Document grants in the shared grant module (dashboard repo, source copy)

**Files:**
- Modify: `src/lib/rooms/grant.ts` (append), `src/lib/rooms/grant.test.ts` (append)

**Interfaces:**
- Consumes: existing `grant.ts` internals `UUID`, `b64`, `unb64`, `mac`.
- Produces (exported, identical in all three repos after Tasks 3 and 12):
  - `DOC_GRANT_TTL_SEC = 120`
  - `DOC_TYPES: { pdf, docx, xlsx, pptx, png, jpg, txt, csv, md }` (ext -> MIME), `type DocExt = keyof typeof DOC_TYPES`, `DOC_EXTS: DocExt[]`
  - `isSafeDocFilename(name: unknown): name is string`
  - `signDocGrant(path: string, filename: string, secret: string, nowMs?: number, ttlSec?: number): string` (throws on bad input)
  - `verifyDocGrant(grant: string, secret: string, nowMs?: number): { ok: true; path: string; filename: string; exp: number } | { ok: false; reason: "malformed" | "bad_signature" | "expired" }`
  - Path shape: `{uuid}/{uuid}/{uuid}/document.{ext}`.

- [ ] **Step 1: Write the failing tests** (append to `src/lib/rooms/grant.test.ts`; add the new names to its existing import from `./grant`, and add `import { createHmac } from "node:crypto";` at the top)

```ts
describe("document grant", () => {
  const U = "2d8b3e20-4f5c-4d7e-8f90-1b2c3d4e5f60";
  const PATH = `${E}/${D}/${U}/document.pdf`;

  it("round-trips path and filename", () => {
    const g = signDocGrant(PATH, "Proposal – 2026.pdf", SECRET, NOW);
    expect(verifyDocGrant(g, SECRET, NOW + 1000)).toEqual({ ok: true, path: PATH, filename: "Proposal – 2026.pdf", exp: NOW / 1000 + DOC_GRANT_TTL_SEC });
  });

  it("expires after 120 seconds and refuses a longer ttl", () => {
    const g = signDocGrant(PATH, "a.pdf", SECRET, NOW);
    expect(verifyDocGrant(g, SECRET, NOW + 121_000)).toEqual({ ok: false, reason: "expired" });
    expect(() => signDocGrant(PATH, "a.pdf", SECRET, NOW, 121)).toThrow();
  });

  it("rejects a wrong secret and a tampered filename", () => {
    const g = signDocGrant(PATH, "a.pdf", SECRET, NOW);
    expect(verifyDocGrant(g, "other", NOW)).toEqual({ ok: false, reason: "bad_signature" });
    const parts = g.split(".");
    parts[2] = Buffer.from("b.pdf").toString("base64url");
    expect(verifyDocGrant(parts.join("."), SECRET, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("is never interchangeable with a prototype grant", () => {
    const proto = signGrant(PREFIX, SECRET, NOW);
    const doc = signDocGrant(PATH, "a.pdf", SECRET, NOW);
    expect(verifyDocGrant(proto, SECRET, NOW).ok).toBe(false);
    expect(verifyGrant(doc, SECRET, NOW).ok).toBe(false);
  });

  it("uses a domain-separated MAC (a plain HMAC over the same payload does not verify)", () => {
    const doc = signDocGrant(PATH, "a.pdf", SECRET, NOW);
    const payload = doc.split(".").slice(0, 4).join(".");
    const plain = createHmac("sha256", SECRET).update(payload).digest("base64url");
    expect(verifyDocGrant(`${payload}.${plain}`, SECRET, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("only signs document paths in the expected shape", () => {
    for (const bad of [PREFIX, `${E}/${D}/v3/document.pdf`, `${E}/${D}/${U}/document.exe`, `${E}/${D}/${U}/../document.pdf`,
      `${E}/${D}/${U}/other.pdf`, `${E}/${D}/${U}/document.PDF`, ""]) {
      expect(() => signDocGrant(bad, "a.pdf", SECRET, NOW)).toThrow();
    }
  });

  it("only signs safe filenames", () => {
    for (const bad of ["", ".hidden.pdf", "a/b.pdf", "a\\b.pdf", 'a"b.pdf', "a\r\nb.pdf", "evil\u202Efdp.pdf", " lead.pdf", "x".repeat(151)]) {
      expect(isSafeDocFilename(bad)).toBe(false);
      expect(() => signDocGrant(PATH, bad, SECRET, NOW)).toThrow();
    }
    expect(isSafeDocFilename("Résumé (final) – v2.pdf")).toBe(true);
  });

  it("maps every allowed extension to a MIME type", () => {
    expect([...DOC_EXTS].sort()).toEqual(["csv", "docx", "jpg", "md", "pdf", "png", "pptx", "txt", "xlsx"]);
    expect(DOC_TYPES.pdf).toBe("application/pdf");
    expect(DOC_TYPES.jpg).toBe("image/jpeg");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/rooms/grant.test.ts` -> FAIL (`signDocGrant` is not exported).

- [ ] **Step 3: Implement** (append to `src/lib/rooms/grant.ts`)

```ts
// ---- Document download grants ----
// Shape: "d1" . base64url(path) . base64url(filename) . expiry . MAC, where the MAC covers a
// domain-prefixed string. A prototype grant (3 parts, plain MAC) can never verify as a document
// grant, and a document grant can never verify as a prototype grant.
export const DOC_GRANT_TTL_SEC = 120;

export const DOC_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpg: "image/jpeg",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
} as const;
export type DocExt = keyof typeof DOC_TYPES;
export const DOC_EXTS = Object.keys(DOC_TYPES) as DocExt[];

const DOC_PATH_RE = new RegExp(`^${UUID}/${UUID}/${UUID}/document\\.(?:${Object.keys(DOC_TYPES).join("|")})$`);
const DOC_MAC_DOMAIN = "rooms-document-grant-v1\n";
// Control characters, path separators, quotes, backslash and bidi overrides (which can disguise an extension).
const UNSAFE_NAME_RE = /[\x00-\x1f\x7f/\\"\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

export type DocGrantResult =
  | { ok: true; path: string; filename: string; exp: number }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function isSafeDocFilename(name: unknown): name is string {
  return typeof name === "string" && name.length >= 1 && name.length <= 150
    && !UNSAFE_NAME_RE.test(name) && !name.startsWith(".") && name.trim() === name;
}

export function signDocGrant(
  path: string,
  filename: string,
  secret: string,
  nowMs: number = Date.now(),
  ttlSec: number = DOC_GRANT_TTL_SEC,
): string {
  if (!DOC_PATH_RE.test(path)) throw new Error("invalid document path");
  if (!isSafeDocFilename(filename)) throw new Error("invalid document filename");
  if (!secret) throw new Error("grant secret missing");
  if (!Number.isFinite(nowMs)) throw new Error("invalid nowMs");
  if (!Number.isInteger(ttlSec) || ttlSec < 1 || ttlSec > DOC_GRANT_TTL_SEC) throw new Error("invalid ttlSec");
  const exp = Math.floor(nowMs / 1000) + ttlSec;
  const payload = `d1.${b64(path)}.${b64(filename)}.${exp}`;
  return `${payload}.${mac(secret, DOC_MAC_DOMAIN + payload)}`;
}

export function verifyDocGrant(grant: string, secret: string, nowMs: number = Date.now()): DocGrantResult {
  if (typeof grant !== "string" || grant.length === 0 || grant.length > 2048) return { ok: false, reason: "malformed" };
  if (typeof secret !== "string" || secret.length === 0) return { ok: false, reason: "malformed" };
  if (!Number.isFinite(nowMs)) return { ok: false, reason: "malformed" };
  const parts = grant.split(".");
  if (parts.length !== 5 || parts[0] !== "d1") return { ok: false, reason: "malformed" };
  const [, p, f, expStr, sig] = parts;
  if (!p || !f || !sig || !/^\d{1,12}$/.test(expStr)) return { ok: false, reason: "malformed" };

  const a = Buffer.from(sig);
  const b = Buffer.from(mac(secret, `${DOC_MAC_DOMAIN}d1.${p}.${f}.${expStr}`));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad_signature" };

  const exp = Number(expStr);
  if (exp * 1000 <= nowMs) return { ok: false, reason: "expired" };

  const path = unb64(p);
  const filename = unb64(f);
  if (!DOC_PATH_RE.test(path) || !isSafeDocFilename(filename)) return { ok: false, reason: "malformed" };
  return { ok: true, path, filename, exp };
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/lib/rooms/grant.test.ts` -> PASS (old prototype tests still pass), then `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rooms/grant.ts src/lib/rooms/grant.test.ts
git commit -m "feat(rooms): domain-separated document download grants in the shared grant module

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Preview host serves documents as attachments (preview-host repo)

**Files:**
- Modify: `lib/grant.ts`, `lib/grant.test.ts` (byte copies of the dashboard files from Task 2)
- Modify: `lib/storage.ts`, `lib/storage.test.ts`
- Create: `lib/docs.ts`, `lib/docs.test.ts`, `app/d/[grant]/route.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `verifyDocGrant`, `DOC_TYPES`, `DocExt` (Task 2); existing `StorageError`.
- Produces: `GET https://preview.rosably.com/d/<document grant>` -> 200 attachment stream, 403 `Forbidden` (any grant failure, identical body), 404, 502. `streamDocument(objectPath: string): Promise<{ body: ReadableStream<Uint8Array>; length: string | null } | null>`; `contentDisposition(filename: string): string`; `makeDocHandler(deps: DocDeps): (grant: string) => Promise<Response>`.

- [ ] **Step 1: Copy the shared files and confirm**

```bash
cd /home/brian/work/discovery/preview-host && git fetch && git checkout -b feat/room-documents origin/main
cp ../dashboard/src/lib/rooms/grant.ts lib/grant.ts
cp ../dashboard/src/lib/rooms/grant.test.ts lib/grant.test.ts
cmp lib/grant.ts ../dashboard/src/lib/rooms/grant.ts && cmp lib/grant.test.ts ../dashboard/src/lib/rooms/grant.test.ts && echo IDENTICAL
```
Expected: `IDENTICAL`. (The dashboard checkout must be on `feat/rooms-phase3` with Task 2 committed.)

- [ ] **Step 2: Write the failing tests**

Append to `lib/storage.test.ts` (and add `streamDocument` to its import from `./storage`):
```ts
describe("storage streamDocument", () => {
  it("streams from the room-documents bucket with auth headers and passes Content-Length through", async () => {
    const f = stubFetch(new Response("PDFDATA", { status: 200, headers: { "content-length": "7" } }));
    const out = await streamDocument("e/d/u/document.pdf");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${URL_BASE}/storage/v1/object/room-documents/e/d/u/document.pdf`);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(init.redirect).toBe("error");
    expect(out!.length).toBe("7");
    expect(await new Response(out!.body).text()).toBe("PDFDATA");
  });
  it("returns null for a missing object and throws StorageError for other failures", async () => {
    stubFetch(new Response(JSON.stringify({ statusCode: "404", error: "not_found" }), { status: 400 }));
    expect(await streamDocument("e/d/u/document.pdf")).toBeNull();
    stubFetch(new Response("boom", { status: 500 }));
    await expect(streamDocument("e/d/u/document.pdf")).rejects.toBeInstanceOf(StorageError);
  });
});
```
(`StorageError` must be imported from `./storage` in that file if it is not already.)

`lib/docs.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { makeDocHandler, contentDisposition } from "./docs";
import { signDocGrant, signGrant } from "./grant";
import { StorageError } from "./storage";

const E = "0b6f1c0e-2d3a-4b5c-8d7e-9f0a1b2c3d4e";
const D = "1c7a2d1f-3e4b-4c6d-9e8f-0a1b2c3d4e5f";
const U = "2d8b3e20-4f5c-4d7e-8f90-1b2c3d4e5f60";
const SECRET = "s";
const NOW = 1_800_000_000_000;
const stream = (s: string) => new Response(s).body!;

function setup(result: { body: ReadableStream<Uint8Array>; length: string | null } | null | Error) {
  const streamDocument = vi.fn(async () => { if (result instanceof Error) throw result; return result; });
  return { handle: makeDocHandler({ secret: SECRET, streamDocument, now: () => NOW }), streamDocument };
}

describe("document handler", () => {
  it("serves an attachment with a fixed content type and hardening headers", async () => {
    const { handle, streamDocument } = setup({ body: stream("%PDF-1.7"), length: "8" });
    const res = await handle(signDocGrant(`${E}/${D}/${U}/document.pdf`, "Proposal.pdf", SECRET, NOW));
    expect(res.status).toBe(200);
    expect(streamDocument).toHaveBeenCalledWith(`${E}/${D}/${U}/document.pdf`);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="Proposal.pdf"; filename*=UTF-8''Proposal.pdf`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-length")).toBe("8");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(await res.text()).toBe("%PDF-1.7");
  });

  it("serves a markdown file as text/markdown attachment, never inline", async () => {
    const { handle } = setup({ body: stream("# hi <script>x</script>"), length: null });
    const res = await handle(signDocGrant(`${E}/${D}/${U}/document.md`, "notes.md", SECRET, NOW));
    expect(res.headers.get("content-type")).toBe("text/markdown");
    expect(res.headers.get("content-disposition")!.startsWith("attachment;")).toBe(true);
    expect(res.headers.get("content-length")).toBeNull();
  });

  it("answers every grant failure with the same 403 and never touches storage", async () => {
    const { handle, streamDocument } = setup({ body: stream("x"), length: null });
    const bodies = new Set<string>();
    for (const g of [
      "garbage",
      signDocGrant(`${E}/${D}/${U}/document.pdf`, "a.pdf", SECRET, NOW - 3_600_000),
      signDocGrant(`${E}/${D}/${U}/document.pdf`, "a.pdf", "other", NOW),
      signGrant(`${E}/${D}/v1`, SECRET, NOW),
    ]) {
      const res = await handle(g);
      expect(res.status).toBe(403);
      bodies.add(await res.text());
    }
    expect(bodies.size).toBe(1);
    expect(streamDocument).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing object and 502 for a storage failure, logging no grant or path", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const g = signDocGrant(`${E}/${D}/${U}/document.pdf`, "a.pdf", SECRET, NOW);
    expect((await setup(null).handle(g)).status).toBe(404);
    expect((await setup(new StorageError(500)).handle(g)).status).toBe(502);
    const logged = err.mock.calls.flat().join(" ");
    expect(logged).not.toContain(g);
    expect(logged).not.toContain(U);
    err.mockRestore();
  });
});

describe("contentDisposition", () => {
  it("gives an ASCII fallback and an RFC 5987 UTF-8 name", () => {
    expect(contentDisposition("Résumé – 2026.pdf")).toBe(
      `attachment; filename="R_sum_ _ 2026.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9%20%E2%80%93%202026.pdf`);
    expect(contentDisposition("a'(b)*.pdf")).toBe(`attachment; filename="a'(b)*.pdf"; filename*=UTF-8''a%27%28b%29%2A.pdf`);
  });
  it("never emits a quote, backslash, semicolon or line break inside the quoted name", () => {
    const h = contentDisposition('x";\\\r\nSet-Cookie: a=b.pdf');
    expect(h).not.toMatch(/[\r\n]/);
    expect(h.split('"').length).toBe(3);
  });
});
```

- [ ] **Step 3: Run to verify failure** — `npx vitest run` -> FAIL (`./docs` missing, `streamDocument` not exported).

- [ ] **Step 4: Implement**

Append to `lib/storage.ts`:
```ts
// Streams a private object from the room-documents bucket. The timeout bounds only the wait for
// response headers; the body is streamed to the client (Vercel's 4.5 MB limit does not apply to streams).
export async function streamDocument(objectPath: string): Promise<{ body: ReadableStream<Uint8Array>; length: string | null } | null> {
  const base = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error("Supabase env is not configured");
  const encoded = objectPath.split("/").map(encodeURIComponent).join("/");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  let res: Response;
  try {
    res = await fetch(`${base}/storage/v1/object/room-documents/${encoded}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
      redirect: "error",
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    if (await isMissing(res)) return null;
    throw new StorageError(res.status);
  }
  if (!res.body) throw new StorageError(502);
  return { body: res.body, length: res.headers.get("content-length") };
}
```

`lib/docs.ts`:
```ts
import { verifyDocGrant, DOC_TYPES, type DocExt } from "./grant";
import { StorageError } from "./storage";

export interface DocDeps {
  secret: string;
  streamDocument: (objectPath: string) => Promise<{ body: ReadableStream<Uint8Array>; length: string | null } | null>;
  now?: () => number;
}

// Downloads are never rendered here: attachment + nosniff + a sandboxing CSP, and the type comes
// from our extension map, never from Storage metadata.
const DOC_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};

const plain = (status: number, text: string) =>
  new Response(text, {
    status,
    headers: { ...DOC_HEADERS, "Content-Type": "text/plain; charset=utf-8", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'" },
  });

export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\;]/g, "_");
  const utf8 = encodeURIComponent(filename).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

export function makeDocHandler(deps: DocDeps) {
  return async function handle(grant: string): Promise<Response> {
    const g = verifyDocGrant(grant, deps.secret, deps.now ? deps.now() : Date.now());
    if (!g.ok) return plain(403, "Forbidden");
    let obj: { body: ReadableStream<Uint8Array>; length: string | null } | null;
    try {
      obj = await deps.streamDocument(g.path);
    } catch (e) {
      // Fixed strings only: never log e.message, the grant, path or filename.
      const what = e instanceof StorageError ? `HTTP ${e.status}` : e instanceof Error ? e.constructor.name : "unknown";
      console.error(`preview-host: document storage failure (${what})`);
      return plain(502, "Bad gateway");
    }
    if (!obj) return plain(404, "Not found");
    const ext = g.path.slice(g.path.lastIndexOf(".") + 1) as DocExt;
    const headers: Record<string, string> = {
      ...DOC_HEADERS,
      "Content-Type": DOC_TYPES[ext],
      "Content-Disposition": contentDisposition(g.filename),
    };
    if (obj.length && /^\d{1,9}$/.test(obj.length)) headers["Content-Length"] = obj.length;
    return new Response(obj.body, { status: 200, headers });
  };
}
```

`app/d/[grant]/route.ts`:
```ts
import { makeDocHandler } from "@/lib/docs";
import { streamDocument } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ grant: string }> }) {
  const { grant } = await params;
  const secret = process.env.ROOM_GRANT_SECRET ?? "";
  if (!secret) console.error("preview-host: ROOM_GRANT_SECRET is not configured");
  return makeDocHandler({ secret, streamDocument })(grant);
}
```

`README.md`: after the existing description add the line: `It also serves room documents at /d/<grant> (a separate, domain-separated grant type) as downloads only: Content-Disposition: attachment, nosniff, a sandbox CSP, streamed from the private room-documents bucket.`

- [ ] **Step 5: Verify** — `npx vitest run`, `npx tsc --noEmit`, `rm -rf .next && npm run build` (routes now include `/d/[grant]` and `/v/[grant]/[...path]`).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: serve room documents as attachments at /d/<document grant>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Delete a deliverable (dashboard repo)

**Files:**
- Create: `src/lib/rooms/storage-cleanup.ts`, `src/lib/rooms/storage-cleanup.test.ts`
- Create: `src/app/api/deliverables/[id]/route.ts`, `src/app/api/deliverables/[id]/route.test.ts`
- Modify: `src/app/(dashboard)/engagements/[id]/page.tsx`

**Interfaces:**
- Consumes: `rooms.delete_deliverable` (Task 1); `sessionUsername(req)` from `@/lib/rooms/session-user`.
- Produces: `type StorageObjectRef = { bucket: string; object_name: string }`; `interface StorageLike`; `CLEANUP_BUCKETS`; `removeObjects(storage: StorageLike, objects: StorageObjectRef[]): Promise<{ removed: number; failed: number }>`; `DELETE /api/deliverables/[id]` -> `200 { deleted: true, files_removed: number, files_left: number }`, `400`, `404`, `500`. The test mock in `route.test.ts` also stubs `from(...)` chains for the `PATCH` tests added in Task 7.

- [ ] **Step 1: Write the failing tests**

`src/lib/rooms/storage-cleanup.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { removeObjects, type StorageLike } from "./storage-cleanup";

function storage(fail: (bucket: string, names: string[]) => boolean | "throw" = () => false) {
  const calls: { bucket: string; names: string[] }[] = [];
  const s: StorageLike = {
    from: (bucket: string) => ({
      remove: vi.fn(async (names: string[]) => {
        calls.push({ bucket, names });
        const f = fail(bucket, names);
        if (f === "throw") throw new Error("network");
        return f ? { data: null, error: { message: "nope" } } : { data: names, error: null };
      }),
    }),
  };
  return { s, calls };
}

describe("removeObjects", () => {
  it("removes objects grouped by bucket", async () => {
    const { s, calls } = storage();
    const r = await removeObjects(s, [
      { bucket: "prototypes", object_name: "e/d/v1/index.html" },
      { bucket: "room-documents", object_name: "e/d/u/document.pdf" },
      { bucket: "prototypes", object_name: "e/d/v1/app.js" },
    ]);
    expect(r).toEqual({ removed: 3, failed: 0 });
    expect(calls).toEqual([
      { bucket: "prototypes", names: ["e/d/v1/index.html", "e/d/v1/app.js"] },
      { bucket: "room-documents", names: ["e/d/u/document.pdf"] },
    ]);
  });
  it("chunks at 1000 names per call", async () => {
    const { s, calls } = storage();
    const many = Array.from({ length: 2001 }, (_, i) => ({ bucket: "prototypes", object_name: `e/d/v1/f${i}` }));
    expect(await removeObjects(s, many)).toEqual({ removed: 2001, failed: 0 });
    expect(calls.map(c => c.names.length)).toEqual([1000, 1000, 1]);
  });
  it("counts errors and thrown calls as failed and never touches unknown buckets", async () => {
    const { s, calls } = storage((b) => (b === "room-documents" ? "throw" : true));
    const r = await removeObjects(s, [
      { bucket: "prototypes", object_name: "a" },
      { bucket: "room-documents", object_name: "b" },
      { bucket: "documents", object_name: "c" },
      { bucket: "prototypes", object_name: "" },
    ]);
    expect(r).toEqual({ removed: 0, failed: 4 });
    expect(calls.some(c => c.bucket === "documents")).toBe(false);
  });
});
```

`src/app/api/deliverables/[id]/route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({
  order: [] as string[],
  rpcResult: { data: null as unknown, error: null as null | { code: string; message: string } },
  removeError: null as null | { message: string },
  removed: [] as { bucket: string; names: string[] }[],
  rpcArgs: [] as unknown[],
  // PATCH (Task 7)
  updateResult: { data: null as unknown, error: null as null | { message: string } },
  updates: [] as unknown[],
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: () => ({
      rpc: async (...a: unknown[]) => { s.order.push("rpc"); s.rpcArgs.push(a); return s.rpcResult; },
      from: () => {
        const b: Record<string, unknown> = {};
        b.update = (row: unknown) => { s.updates.push(row); return b; };
        b.eq = () => b;
        b.select = () => b;
        b.maybeSingle = async () => s.updateResult;
        return b;
      },
    }),
    storage: {
      from: (bucket: string) => ({
        remove: async (names: string[]) => {
          s.order.push(`remove:${bucket}`);
          s.removed.push({ bucket, names });
          return s.removeError ? { data: null, error: s.removeError } : { data: names, error: null };
        },
      }),
    },
  },
}));
vi.mock("@/lib/rooms/session-user", () => ({ sessionUsername: async () => "brian" }));

import { DELETE } from "./route";

const ID = "3e9c4f31-5a6d-4e8f-9aa1-2c3d4e5f6071";
const del = (id = ID) => DELETE(new NextRequest(`https://d.test/api/deliverables/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  s.order = []; s.removed = []; s.rpcArgs = []; s.removeError = null; s.updates = [];
  s.rpcResult = { data: [
    { bucket: "prototypes", object_name: "e/d/v1/index.html" },
    { bucket: "room-documents", object_name: "e/d/u/document.pdf" },
  ], error: null };
});

describe("DELETE /api/deliverables/[id]", () => {
  it("rejects a non-uuid without touching the database", async () => {
    const r = await del("nope");
    expect(r.status).toBe(400);
    expect(s.order).toEqual([]);
  });
  it("deletes rows first (atomic function) and then removes the returned files", async () => {
    const r = await del();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ deleted: true, files_removed: 2, files_left: 0 });
    expect(s.rpcArgs[0]).toEqual(["delete_deliverable", { p_deliverable: ID, p_actor: "brian" }]);
    expect(s.order[0]).toBe("rpc");
    expect(s.order.slice(1).sort()).toEqual(["remove:prototypes", "remove:room-documents"]);
  });
  it("still reports success when file removal fails, with the number of files left", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    s.removeError = { message: "storage down" };
    const r = await del();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ deleted: true, files_removed: 0, files_left: 2 });
    expect(err.mock.calls.flat().join(" ")).not.toContain("e/d/");
    err.mockRestore();
  });
  it("never removes files when the database delete fails", async () => {
    s.rpcResult = { data: null, error: { code: "P0002", message: "deliverable not found" } };
    expect((await del()).status).toBe(404);
    s.rpcResult = { data: null, error: { code: "XX000", message: "secret detail" } };
    const r = await del();
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("secret detail");
    expect(s.removed).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/rooms/storage-cleanup.test.ts src/app/api/deliverables` -> FAIL (modules missing).

- [ ] **Step 3: Implement**

`src/lib/rooms/storage-cleanup.ts`:
```ts
export type StorageObjectRef = { bucket: string; object_name: string };
export interface StorageLike {
  from(bucket: string): { remove(paths: string[]): PromiseLike<{ data: unknown; error: unknown }> };
}

// Only buckets that hold room deliverables. Anything else in the list is refused, never removed.
export const CLEANUP_BUCKETS = ["prototypes", "room-documents"] as const;
const CHUNK = 1000;

export async function removeObjects(storage: StorageLike, objects: StorageObjectRef[]): Promise<{ removed: number; failed: number }> {
  const byBucket = new Map<string, string[]>();
  let failed = 0;
  for (const o of objects) {
    if (!(CLEANUP_BUCKETS as readonly string[]).includes(o.bucket) || typeof o.object_name !== "string" || !o.object_name) {
      failed++;
      continue;
    }
    const list = byBucket.get(o.bucket) ?? [];
    list.push(o.object_name);
    byBucket.set(o.bucket, list);
  }
  let removed = 0;
  for (const [bucket, names] of byBucket) {
    for (let i = 0; i < names.length; i += CHUNK) {
      const chunk = names.slice(i, i + CHUNK);
      try {
        const { error } = await storage.from(bucket).remove(chunk);
        if (error) failed += chunk.length;
        else removed += chunk.length;
      } catch {
        failed += chunk.length;
      }
    }
  }
  return { removed, failed };
}
```

`src/app/api/deliverables/[id]/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sessionUsername } from "@/lib/rooms/session-user";
import { removeObjects, type StorageObjectRef } from "@/lib/rooms/storage-cleanup";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string }> };

// DELETE — permanently delete a deliverable. Rows go first, atomically, in the database
// (rooms.delete_deliverable); then its files are removed. If file removal fails, the files are
// orphaned and unreachable, but no row ever points at a missing file.
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid deliverable id." }, { status: 400 });
  const actor = (await sessionUsername(req)) ?? "unknown";
  const { data, error } = await supabaseAdmin.schema("rooms").rpc("delete_deliverable", { p_deliverable: id, p_actor: actor });
  if (error) {
    if (error.code === "P0002") return NextResponse.json({ error: "Deliverable not found." }, { status: 404 });
    return NextResponse.json({ error: "Could not delete this deliverable." }, { status: 500 });
  }
  const objects = (Array.isArray(data) ? data : []) as StorageObjectRef[];
  const { removed, failed } = await removeObjects(supabaseAdmin.storage, objects);
  if (failed > 0) console.error(`rooms: deliverable deleted; ${failed} storage object(s) could not be removed`);
  return NextResponse.json({ deleted: true, files_removed: removed, files_left: failed });
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/lib/rooms/storage-cleanup.test.ts src/app/api/deliverables` -> PASS.

- [ ] **Step 5: UI** in `src/app/(dashboard)/engagements/[id]/page.tsx`.

Add state next to `confirmShare`:
```tsx
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
```
Add the action next to `share`:
```tsx
  const deleteDeliverable = (deliverableId: string, title: string) => guarded("delete", async () => {
    const r = await fetchJson<{ deleted: boolean; files_removed: number; files_left: number }>(`/api/deliverables/${deliverableId}`, { method: "DELETE" });
    setConfirmDelete(null);
    if (!r.ok) { setMsg(r.error); return; }
    setPreviewUrl(null);
    setMsg(r.data.files_left > 0
      ? `Deleted “${title}”. ${r.data.files_left} file(s) could not be removed from storage; they are no longer reachable from any room.`
      : `Deleted “${title}”.`);
    await load();
  });
```
Replace
```tsx
              <h3 className="text-sm font-semibold mb-1">{d.title}</h3>
```
with
```tsx
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold">{d.title}</h3>
                <button disabled={!!pending} onClick={() => setConfirmDelete(d.id)} className="text-xs text-red-600 disabled:opacity-50">Delete</button>
              </div>
              {confirmDelete === d.id && (
                <div className="mb-2 border border-red-300 bg-red-50 rounded p-2 text-sm flex flex-wrap items-center gap-2">
                  <span>
                    Permanently delete “{d.title}” with its {d.versions.length} version(s), all comments and all files?
                    Visitors lose access immediately. This cannot be undone. Casey&apos;s work items are kept.
                  </span>
                  <button disabled={!!pending} onClick={() => deleteDeliverable(d.id, d.title)} className="px-2 py-1 rounded bg-red-600 text-white disabled:opacity-50">Delete permanently</button>
                  <button disabled={!!pending} onClick={() => setConfirmDelete(null)} className="px-2 py-1 rounded border border-brand-border disabled:opacity-50">Cancel</button>
                </div>
              )}
```

- [ ] **Step 6: Verify** — `npx vitest run`, `npx tsc --noEmit`.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(rooms): delete a deliverable completely (atomic rows, then files)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Refresh a room link (dashboard repo)

**Files:**
- Modify: `src/lib/rooms/schemas.ts`; Create: `src/lib/rooms/schemas-phase3.test.ts`
- Create: `src/app/api/engagements/[id]/access/[accessId]/refresh/route.ts`, `.../refresh/route.test.ts`
- Modify: `src/app/(dashboard)/engagements/[id]/page.tsx`

**Interfaces:**
- Consumes: `rooms.refresh_access` (Task 1); `generateToken`, `hashToken`, `roomLink` from `@/lib/rooms/token`.
- Produces: `RefreshAccessSchema` (`{ expires_days: int 1..365, default 60 }`); `POST /api/engagements/[id]/access/[accessId]/refresh` -> `201 { id, link, expires_at }`, `400`, `404`, `409`, `500`.

- [ ] **Step 1: Write the failing tests**

`src/lib/rooms/schemas-phase3.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { RefreshAccessSchema } from "./schemas";

describe("RefreshAccessSchema", () => {
  it("defaults to 60 days and bounds the range", () => {
    expect(RefreshAccessSchema.parse({})).toEqual({ expires_days: 60 });
    expect(RefreshAccessSchema.safeParse({ expires_days: 0 }).success).toBe(false);
    expect(RefreshAccessSchema.safeParse({ expires_days: 366 }).success).toBe(false);
    expect(RefreshAccessSchema.safeParse({ expires_days: 1.5 }).success).toBe(false);
  });
});
```

`src/app/api/engagements/[id]/access/[accessId]/refresh/route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { hashToken } from "@/lib/rooms/token";

const s = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: { schema: () => ({ rpc: s.rpc }) } }));
import { POST } from "./route";

const ENG = "11111111-1111-4111-8111-111111111111";
const ACC = "22222222-2222-4222-8222-222222222222";
const NEW = "33333333-3333-4333-8333-333333333333";
const call = (body?: unknown, id = ENG, accessId = ACC) =>
  POST(new NextRequest(`https://d.test/api/engagements/${id}/access/${accessId}/refresh`, {
    method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  }), { params: Promise.resolve({ id, accessId }) });

beforeEach(() => {
  s.rpc.mockReset();
  s.rpc.mockImplementation(async (_n: string, a: { p_expires_at: string }) => ({ data: [{ access_id: NEW, expires_at: a.p_expires_at }], error: null }));
});

describe("POST refresh link", () => {
  it("rejects bad ids and bad bodies without calling the database", async () => {
    expect((await call(undefined, "x")).status).toBe(400);
    expect((await call(undefined, ENG, "x")).status).toBe(400);
    expect((await call({ expires_days: 999 })).status).toBe(400);
    expect(s.rpc).not.toHaveBeenCalled();
  });
  it("sends only the hash of the new token and returns the link once", async () => {
    const r = await call();
    expect(r.status).toBe(201);
    const body = await r.json();
    const token = body.link.split("/r/")[1];
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [name, args] = s.rpc.mock.calls[0];
    expect(name).toBe("refresh_access");
    expect(args).toMatchObject({ p_eng: ENG, p_access: ACC, p_token_hash: hashToken(token) });
    expect(JSON.stringify(args)).not.toContain(token);
    expect(body.id).toBe(NEW);
    const days = (new Date(args.p_expires_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(59.9);
    expect(days).toBeLessThan(60.1);
  });
  it("maps database refusals to 404/409/500 without leaking text or a token", async () => {
    s.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0002", message: "link not found" } });
    expect((await call()).status).toBe(404);
    s.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "link already revoked" } });
    const r = await call();
    expect(r.status).toBe(409);
    const t = JSON.stringify(await r.json());
    expect(t).not.toContain("/r/");
    expect(t).not.toContain("P0001");
    s.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "secret" } });
    const r5 = await call();
    expect(r5.status).toBe(500);
    expect(JSON.stringify(await r5.json())).not.toContain("secret");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/rooms/schemas-phase3.test.ts "src/app/api/engagements/[id]/access"` -> FAIL.

- [ ] **Step 3: Implement**

Append to `src/lib/rooms/schemas.ts`:
```ts
export const RefreshAccessSchema = z.object({
  expires_days: z.number().int().min(1).max(365).default(60),
});
```

`src/app/api/engagements/[id]/access/[accessId]/refresh/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { RefreshAccessSchema } from "@/lib/rooms/schemas";
import { generateToken, hashToken, roomLink } from "@/lib/rooms/token";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string; accessId: string }> };

// POST — revoke this link and issue its replacement in one database transaction (rooms.refresh_access).
// The new raw token is returned exactly once; only its hash reaches the database; it is never logged.
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id, accessId } = await params;
  if (!UUID.test(id) || !UUID.test(accessId)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  const parsed = RefreshAccessSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const raw = generateToken();
  const expiresAt = new Date(Date.now() + parsed.data.expires_days * 86_400_000).toISOString();
  const { data, error } = await supabaseAdmin.schema("rooms").rpc("refresh_access", {
    p_eng: id, p_access: accessId, p_token_hash: hashToken(raw), p_expires_at: expiresAt,
  });
  if (error) {
    if (error.code === "P0002") return NextResponse.json({ error: "Link not found." }, { status: 404 });
    if (error.code === "P0001") {
      return NextResponse.json({ error: "This link can't be refreshed: it was already revoked or the room is closed." }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not refresh this link." }, { status: 500 });
  }
  const row = (Array.isArray(data) ? data[0] : data) as { access_id: string; expires_at: string } | null;
  if (!row) return NextResponse.json({ error: "Could not refresh this link." }, { status: 500 });
  return NextResponse.json({ id: row.access_id, link: roomLink(raw), expires_at: row.expires_at }, { status: 201 });
}
```

- [ ] **Step 4: Run to verify pass** — same command -> PASS.

- [ ] **Step 5: UI** in `page.tsx`.

State next to `confirmDelete`:
```tsx
  const [confirmRefresh, setConfirmRefresh] = useState<string | null>(null);
```
Action next to `revoke`:
```tsx
  const refreshLink = (accessId: string) => guarded("refresh", async () => {
    const r = await fetchJson<{ link: string }>(`/api/engagements/${id}/access/${accessId}/refresh`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    setConfirmRefresh(null);
    if (!r.ok) { setMsg(`Refresh failed: ${r.error}`); return; }
    setNewLink(r.data.link);
    setMsg("The old link no longer works. Send the new link below.");
    await load();
  });
```
Replace the whole `{access.map(a => ( ... ))}` block in the Access tab with:
```tsx
            {access.map(a => (
              <li key={a.id} className="px-3 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span>{a.label ?? "Unlabelled"} · expires {new Date(a.expires_at).toLocaleDateString()}
                    {a.revoked_at ? " · revoked" : ""}{a.last_used_at ? ` · last used ${formatDistanceToNow(new Date(a.last_used_at), { addSuffix: true })}` : ""}
                  </span>
                  {!a.revoked_at && (
                    <span className="flex gap-3">
                      <button disabled={!!pending} onClick={() => setConfirmRefresh(a.id)} className="text-brand-orange disabled:opacity-50">Refresh</button>
                      <button disabled={!!pending} onClick={() => revoke(a.id)} className="text-red-600 disabled:opacity-50">Revoke</button>
                    </span>
                  )}
                </div>
                {confirmRefresh === a.id && (
                  <div className="mt-2 border border-amber-300 bg-amber-50 rounded p-2 flex flex-wrap items-center gap-2">
                    <span>Replace this link? The current link stops working immediately and a new one (60 days) is shown once.</span>
                    <button disabled={!!pending} onClick={() => refreshLink(a.id)} className="px-2 py-1 rounded bg-brand-orange text-white disabled:opacity-50">Refresh link</button>
                    <button disabled={!!pending} onClick={() => setConfirmRefresh(null)} className="px-2 py-1 rounded border border-brand-border disabled:opacity-50">Cancel</button>
                  </div>
                )}
              </li>
            ))}
```

- [ ] **Step 6: Verify** — `npx vitest run`, `npx tsc --noEmit`.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(rooms): refresh a room link in one step (atomic revoke + reissue)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Version dates and full-height preview in the dashboard (dashboard repo)

**Files:**
- Create: `src/lib/rooms/format.ts`, `src/lib/rooms/format.test.ts`
- Modify: `src/app/(dashboard)/engagements/[id]/page.tsx`

**Interfaces:**
- Produces: `formatVersionDate(value: string | Date, timeZone?: string): string` (`""` for an invalid date). The portal gets its own copy in Task 11 (not a byte-shared file).

- [ ] **Step 1: Write the failing test** (`src/lib/rooms/format.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { formatVersionDate } from "./format";

describe("formatVersionDate", () => {
  it("formats as 'Oct 14, 2026'", () => {
    expect(formatVersionDate("2026-10-14T12:00:00Z", "UTC")).toBe("Oct 14, 2026");
    expect(formatVersionDate(new Date("2026-01-05T12:00:00Z"), "UTC")).toBe("Jan 5, 2026");
  });
  it("uses the given time zone at day boundaries", () => {
    expect(formatVersionDate("2026-10-15T03:00:00Z", "UTC")).toBe("Oct 15, 2026");
    expect(formatVersionDate("2026-10-15T03:00:00Z", "America/Los_Angeles")).toBe("Oct 14, 2026");
  });
  it("returns an empty string for an invalid date", () => {
    expect(formatVersionDate("not a date")).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/rooms/format.test.ts` -> FAIL.

- [ ] **Step 3: Implement** (`src/lib/rooms/format.ts`)

```ts
// "Oct 14, 2026" in the viewer's time zone (or the zone given, for tests).
export function formatVersionDate(value: string | Date, timeZone?: string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", ...(timeZone ? { timeZone } : {}),
  }).format(d);
}
```

- [ ] **Step 4: Run to verify pass**.

- [ ] **Step 5: UI** in `page.tsx`. Add `import { formatVersionDate } from "@/lib/rooms/format";`. Replace
```tsx
                          <span className="text-brand-muted"> · {formatDistanceToNow(new Date(v.created_at), { addSuffix: true })}</span>
```
with
```tsx
                          <span className="text-brand-muted" title={formatDistanceToNow(new Date(v.created_at), { addSuffix: true })}> · {formatVersionDate(v.created_at)}</span>
```
Replace the preview iframe's `className="w-full h-[70vh] border border-brand-border rounded"` with `className="w-full h-[calc(100dvh-8rem)] min-h-[480px] border border-brand-border rounded"` (sandbox and other attributes unchanged).

- [ ] **Step 6: Verify** — `npx vitest run`, `npx tsc --noEmit`; in `npm run dev`, open an engagement: each version shows e.g. `· Oct 14, 2026` (hover shows the relative time); Preview fills the window height without a second page-level scrollbar inside the frame area.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(rooms): version dates and a full-height preview frame in the dashboard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Welcome message per deliverable (dashboard repo)

**Files:**
- Modify: `src/lib/rooms/schemas.ts`, `src/lib/rooms/schemas-phase3.test.ts`
- Modify: `src/app/api/deliverables/[id]/route.ts`, `src/app/api/deliverables/[id]/route.test.ts`
- Modify: `src/app/api/engagements/[id]/route.ts`
- Create: `src/app/(dashboard)/engagements/[id]/WelcomeEditor.tsx`
- Modify: `src/app/(dashboard)/engagements/[id]/page.tsx`

**Interfaces:**
- Consumes: column `rooms.deliverables.welcome_message` (Task 1); the PATCH mock already present in `route.test.ts` (Task 4).
- Produces: `WELCOME_MAX = 1000`; `normalizeWelcome(raw: string | null): string | null`; `DeliverablePatchSchema` (strict `{ welcome_message: string | null }`, normalized); `PATCH /api/deliverables/[id]` -> `200 { id, welcome_message }`, `400`, `404`, `500`; `GET /api/engagements/[id]` deliverables now include `welcome_message`; `<WelcomeEditor deliverableId initial onSaved />`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/rooms/schemas-phase3.test.ts` (extend the import to `import { RefreshAccessSchema, DeliverablePatchSchema, normalizeWelcome } from "./schemas";`):
```ts
describe("welcome message", () => {
  it("normalizes line endings, strips control characters, trims, and maps empty to null", () => {
    expect(normalizeWelcome("  Hi\r\nthere\rfriend\u0007  ")).toBe("Hi\nthere\nfriend");
    expect(normalizeWelcome("   \n\t ")).toBeNull();
    expect(normalizeWelcome(null)).toBeNull();
    expect(normalizeWelcome("tab\tkept")).toBe("tab\tkept");
  });
  it("keeps markup as literal text (it is rendered as text, never HTML)", () => {
    expect(DeliverablePatchSchema.parse({ welcome_message: "<b>hi</b><script>x</script>" })).toEqual({ welcome_message: "<b>hi</b><script>x</script>" });
  });
  it("accepts 1000 characters and rejects 1001", () => {
    expect(DeliverablePatchSchema.safeParse({ welcome_message: "x".repeat(1000) }).success).toBe(true);
    expect(DeliverablePatchSchema.safeParse({ welcome_message: "x".repeat(1001) }).success).toBe(false);
  });
  it("rejects unknown keys and wrong types", () => {
    expect(DeliverablePatchSchema.safeParse({ welcome_message: "x", title: "y" }).success).toBe(false);
    expect(DeliverablePatchSchema.safeParse({ welcome_message: 5 }).success).toBe(false);
    expect(DeliverablePatchSchema.safeParse({}).success).toBe(false);
  });
});
```

Append to `src/app/api/deliverables/[id]/route.test.ts` (extend the import to `import { DELETE, PATCH } from "./route";`):
```ts
const patch = (body: unknown, id = ID) =>
  PATCH(new NextRequest(`https://d.test/api/deliverables/${id}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) });

describe("PATCH /api/deliverables/[id]", () => {
  it("saves a normalized welcome message", async () => {
    s.updateResult = { data: { id: ID, welcome_message: "Hi\nthere" }, error: null };
    const r = await patch({ welcome_message: " Hi\r\nthere " });
    expect(r.status).toBe(200);
    expect(s.updates).toEqual([{ welcome_message: "Hi\nthere" }]);
    expect(await r.json()).toEqual({ id: ID, welcome_message: "Hi\nthere" });
  });
  it("clears with null or whitespace", async () => {
    s.updateResult = { data: { id: ID, welcome_message: null }, error: null };
    await patch({ welcome_message: "   " });
    expect(s.updates).toEqual([{ welcome_message: null }]);
  });
  it("rejects bad input and unknown ids", async () => {
    expect((await patch({ welcome_message: "x".repeat(1001) })).status).toBe(400);
    expect((await patch({ welcome_message: "x" }, "nope")).status).toBe(400);
    expect(s.updates).toEqual([]);
    s.updateResult = { data: null, error: null };
    expect((await patch({ welcome_message: "x" })).status).toBe(404);
  });
  it("returns a generic 500 on a database error", async () => {
    s.updateResult = { data: null, error: { message: "secret" } };
    const r = await patch({ welcome_message: "x" });
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("secret");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/rooms/schemas-phase3.test.ts src/app/api/deliverables` -> FAIL.

- [ ] **Step 3: Implement**

Append to `src/lib/rooms/schemas.ts`:
```ts
export const WELCOME_MAX = 1000;

// Plain text only: CRLF/CR -> LF, control characters other than LF and TAB removed, trimmed; empty -> null.
export function normalizeWelcome(raw: string | null): string | null {
  if (raw === null) return null;
  const s = raw.replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").trim();
  return s === "" ? null : s;
}

export const DeliverablePatchSchema = z.strictObject({
  welcome_message: z.string().max(5000).nullable().transform(normalizeWelcome)
    .refine(v => v === null || v.length <= WELCOME_MAX, { message: `Welcome message must be ${WELCOME_MAX} characters or fewer.` }),
});
```

Append to `src/app/api/deliverables/[id]/route.ts` (and add `import { DeliverablePatchSchema } from "@/lib/rooms/schemas";`):
```ts
// PATCH — set or clear the deliverable's welcome message (plain text, shown in the room as text).
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid deliverable id." }, { status: 400 });
  const parsed = DeliverablePatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin.schema("rooms").from("deliverables")
    .update({ welcome_message: parsed.data.welcome_message })
    .eq("id", id).select("id, welcome_message").maybeSingle();
  if (error) return NextResponse.json({ error: "Could not save the welcome message." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Deliverable not found." }, { status: 404 });
  return NextResponse.json(data);
}
```

In `src/app/api/engagements/[id]/route.ts` change the deliverables select string to:
```ts
      .select("id, title, description, kind, sort_order, welcome_message, versions:deliverable_versions(id, version_no, status, source, change_summary, built_by_agent, manifest, created_at)")
```

`src/app/(dashboard)/engagements/[id]/WelcomeEditor.tsx`:
```tsx
"use client";
import { useRef, useState } from "react";
import { fetchJson } from "@/lib/rooms/fetch-json";

const MAX = 1000;

// Per-deliverable welcome message. Plain text; the room shows it as text with line breaks kept.
export function WelcomeEditor({ deliverableId, initial, onSaved }: {
  deliverableId: string; initial: string | null; onSaved: (msg: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(initial ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const save = async (value: string | null) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setErr(null);
    try {
      const r = await fetchJson<{ welcome_message: string | null }>(`/api/deliverables/${deliverableId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ welcome_message: value }),
      });
      if (!r.ok) { setErr(r.error); return; }
      setText(r.data.welcome_message ?? "");
      setEditing(false);
      onSaved(r.data.welcome_message ? "Welcome message saved." : "Welcome message removed.");
    } finally { inFlight.current = false; setBusy(false); }
  };

  if (!editing) {
    return (
      <div className="mb-2 text-sm">
        {text
          ? <p className="whitespace-pre-line text-brand-black border-l-2 border-brand-border pl-2">{text}</p>
          : <p className="text-brand-muted">No welcome message (the room shows its default greeting).</p>}
        <button onClick={() => setEditing(true)} className="text-xs text-brand-orange">{text ? "Edit welcome message" : "Add welcome message"}</button>
      </div>
    );
  }
  return (
    <div className="mb-2 space-y-1 text-sm">
      <textarea value={text} onChange={e => setText(e.target.value)} rows={4} maxLength={MAX}
        placeholder="Shown to visitors above this deliverable. Plain text; line breaks are kept."
        className="w-full border border-brand-border rounded px-2 py-1.5" />
      <div className="flex items-center gap-2">
        <span className="text-xs text-brand-muted">{text.length}/{MAX}</span>
        <button disabled={busy} onClick={() => save(text)} className="px-2 py-1 rounded bg-brand-orange text-white disabled:opacity-50">Save</button>
        {initial && <button disabled={busy} onClick={() => save(null)} className="px-2 py-1 rounded border border-brand-border disabled:opacity-50">Remove</button>}
        <button disabled={busy} onClick={() => { setText(initial ?? ""); setEditing(false); }} className="px-2 py-1 rounded border border-brand-border disabled:opacity-50">Cancel</button>
      </div>
      {err && <p className="text-red-600">{err}</p>}
    </div>
  );
}
```

In `page.tsx`: add `import { WelcomeEditor } from "./WelcomeEditor";`; change the `Deliverable` type to
```tsx
type Deliverable = { id: string; title: string; kind: string; welcome_message: string | null; versions: Version[] };
```
and insert immediately before the line `{d.versions.length === 0 ? <p className="text-sm text-brand-muted">No versions yet.</p> : (`:
```tsx
              <WelcomeEditor key={`${d.id}:${d.welcome_message ?? ""}`} deliverableId={d.id} initial={d.welcome_message}
                onSaved={(m) => { setMsg(m); void load(); }} />
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run`, `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(rooms): per-deliverable welcome message (PATCH with zod, plain text)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Document upload, verification and Brian's download (dashboard repo)

**Files:**
- Create: `src/lib/rooms/doc-limits.ts`, `src/lib/rooms/documents.ts`, `src/lib/rooms/documents.test.ts`
- Modify: `src/lib/rooms/schemas.ts`, `src/lib/rooms/schemas-phase3.test.ts`
- Create: `src/app/api/engagements/[id]/documents/route.ts` (+`route.test.ts`)
- Create: `src/app/api/engagements/[id]/documents/finalize/route.ts` (+`route.test.ts`)
- Create: `src/app/api/versions/[id]/download/route.ts`
- Modify: `src/app/api/engagements/[id]/prototype-request/route.ts`
- Create: `src/app/(dashboard)/engagements/[id]/DocumentUpload.tsx`
- Modify: `src/app/(dashboard)/engagements/[id]/page.tsx`

**Interfaces:**
- Consumes: `DOC_TYPES`, `DocExt`, `isSafeDocFilename` (Task 2); `rooms.add_document_version`, bucket `room-documents` (Task 1); existing `share_version` route for sharing.
- Produces:
  - `doc-limits.ts` (no imports; safe for client components): `DOC_MAX_BYTES = 26214400`, `DOC_ACCEPT = ".pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.txt,.csv,.md"`, `DOC_BUCKET = "room-documents"`.
  - `documents.ts` (server only): `docExt(name: string): DocExt | null`, `sanitizeDocFilename(name: string): string | null`, `sniffDocument(ext: DocExt, head: Uint8Array): boolean`, `readHead(stream: ReadableStream<Uint8Array>, max?: number): Promise<Uint8Array>`.
  - Schemas: `DocumentUploadSchema` `{ filename, size, deliverable_id? | deliverable_title?, }`; `DocumentFinalizeSchema` `{ deliverable_id, upload_id, filename, change_summary? }`.
  - `POST /api/engagements/[id]/documents` -> `201 { deliverable_id, upload_id, filename, signed_url, content_type }`.
  - `POST /api/engagements/[id]/documents/finalize` -> `201 { version_id, version_no }`; `400` (object removed) when contents or DB checks fail.
  - `GET /api/versions/[id]/download` -> `200 { url }` (Supabase signed URL, 60 s, `download=<filename>`), dashboard only.
  - `prototype-request` returns `409` for a document deliverable.

- [ ] **Step 1: Write the failing tests**

`src/lib/rooms/documents.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { docExt, sanitizeDocFilename, sniffDocument, readHead } from "./documents";

const bytes = (...b: number[]) => new Uint8Array(b);
const text = (s: string) => new TextEncoder().encode(s);

describe("docExt", () => {
  it("allows only the listed extensions, case-insensitively, mapping jpeg to jpg", () => {
    expect(docExt("a.PDF")).toBe("pdf");
    expect(docExt("photo.jpeg")).toBe("jpg");
    expect(docExt("deck.pptx")).toBe("pptx");
    for (const bad of ["a.exe", "a.html", "a.svg", "a.pdf.exe", "noext", "a.", "a.docm"]) expect(docExt(bad)).toBeNull();
  });
});

describe("sanitizeDocFilename", () => {
  it("keeps a normal name and strips path, controls, quotes and bidi overrides", () => {
    expect(sanitizeDocFilename("Proposal 2026.pdf")).toBe("Proposal 2026.pdf");
    expect(sanitizeDocFilename("C:\\Users\\b\\Q3 \"final\".pdf")).toBe("Q3 final.pdf");
    expect(sanitizeDocFilename("evil\u202Efdp.pdf")).toBe("evilfdp.pdf");
    expect(sanitizeDocFilename("a\r\nb.pdf")).toBe("ab.pdf");
    expect(sanitizeDocFilename("...hidden.pdf")).toBe("hidden.pdf");
  });
  it("truncates long names but keeps the extension", () => {
    const s = sanitizeDocFilename("x".repeat(300) + ".docx")!;
    expect(s.length).toBe(150);
    expect(s.endsWith(".docx")).toBe(true);
  });
  it("returns null for a disallowed or missing extension or an empty name", () => {
    expect(sanitizeDocFilename("a.exe")).toBeNull();
    expect(sanitizeDocFilename("\u0001\u0002")).toBeNull();
    expect(sanitizeDocFilename(".pdf")).toBeNull();
  });
});

describe("sniffDocument", () => {
  it("accepts real signatures", () => {
    expect(sniffDocument("pdf", text("%PDF-1.7\n"))).toBe(true);
    expect(sniffDocument("pdf", new Uint8Array([...new Uint8Array(100), ...text("%PDF-1.4")]))).toBe(true);
    expect(sniffDocument("png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(true);
    expect(sniffDocument("jpg", bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    for (const e of ["docx", "xlsx", "pptx"] as const) expect(sniffDocument(e, bytes(0x50, 0x4b, 0x03, 0x04, 0x14))).toBe(true);
    expect(sniffDocument("csv", text("a,b\n1,2\n"))).toBe(true);
    expect(sniffDocument("md", text("# Título\n"))).toBe(true);
  });
  it("refuses renamed or disguised files", () => {
    expect(sniffDocument("pdf", text("<html><script>alert(1)</script>"))).toBe(false);
    expect(sniffDocument("png", text("<svg onload=alert(1)>"))).toBe(false);
    expect(sniffDocument("jpg", bytes(0x89, 0x50, 0x4e, 0x47))).toBe(false);
    expect(sniffDocument("docx", text("%PDF-1.7"))).toBe(false);
    expect(sniffDocument("txt", bytes(0x4d, 0x5a, 0x90, 0x00))).toBe(false);
    expect(sniffDocument("txt", bytes(0xff, 0xfe, 0xfd))).toBe(false);
    expect(sniffDocument("pdf", new Uint8Array())).toBe(false);
  });
  it("does not fail text that is cut in the middle of a multi-byte character", () => {
    const t = text("ok é");
    expect(sniffDocument("txt", t.subarray(0, t.length - 1))).toBe(true);
  });
});

describe("readHead", () => {
  it("reads at most max bytes across chunks and cancels the stream", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) { c.enqueue(new Uint8Array(5000).fill(65)); },
      cancel() { cancelled = true; },
    });
    const head = await readHead(stream, 8192);
    expect(head.length).toBe(8192);
    expect(cancelled).toBe(true);
  });
  it("returns everything for a short stream", async () => {
    expect((await readHead(new Response("abc").body!)).length).toBe(3);
  });
});
```

Append to `src/lib/rooms/schemas-phase3.test.ts` (extend the import with `DocumentUploadSchema, DocumentFinalizeSchema`):
```ts
describe("document schemas", () => {
  const D = "11111111-1111-4111-8111-111111111111";
  it("upload needs exactly one of deliverable_id / deliverable_title and a size up to 25 MB", () => {
    expect(DocumentUploadSchema.safeParse({ filename: "a.pdf", size: 10, deliverable_title: "Proposal" }).success).toBe(true);
    expect(DocumentUploadSchema.safeParse({ filename: "a.pdf", size: 10, deliverable_id: D }).success).toBe(true);
    expect(DocumentUploadSchema.safeParse({ filename: "a.pdf", size: 10 }).success).toBe(false);
    expect(DocumentUploadSchema.safeParse({ filename: "a.pdf", size: 10, deliverable_id: D, deliverable_title: "x" }).success).toBe(false);
    expect(DocumentUploadSchema.safeParse({ filename: "a.pdf", size: 26214401, deliverable_title: "x" }).success).toBe(false);
    expect(DocumentUploadSchema.safeParse({ filename: "a.pdf", size: 0, deliverable_title: "x" }).success).toBe(false);
  });
  it("finalize needs uuids and caps the change summary", () => {
    expect(DocumentFinalizeSchema.safeParse({ deliverable_id: D, upload_id: D, filename: "a.pdf" }).success).toBe(true);
    expect(DocumentFinalizeSchema.safeParse({ deliverable_id: D, upload_id: "x", filename: "a.pdf" }).success).toBe(false);
    expect(DocumentFinalizeSchema.safeParse({ deliverable_id: D, upload_id: D, filename: "a.pdf", change_summary: "x".repeat(501) }).success).toBe(false);
  });
});
```

`src/app/api/engagements/[id]/documents/route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

type Res = { data: unknown; error: unknown };
const s = vi.hoisted(() => ({
  queue: {} as Record<string, Res[]>,
  inserts: [] as unknown[],
  eqs: [] as unknown[][],
  signed: [] as string[],
  signError: null as unknown,
}));
function chain(table: string) {
  const b: Record<string, unknown> = {};
  const next = async () => (s.queue[table] ?? []).shift() ?? { data: null, error: null };
  b.select = () => b;
  b.eq = (...a: unknown[]) => { s.eqs.push([table, ...a]); return b; };
  b.insert = (row: unknown) => { s.inserts.push([table, row]); return b; };
  b.single = next;
  b.maybeSingle = next;
  return b;
}
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: () => ({ from: (t: string) => chain(t) }),
    storage: { from: () => ({ createSignedUploadUrl: async (p: string) => { s.signed.push(p); return s.signError ? { data: null, error: s.signError } : { data: { signedUrl: `https://x.supabase.co/storage/v1/object/upload/sign/room-documents/${p}?token=T`, path: p, token: "T" }, error: null }; } }) },
  },
}));
import { POST } from "./route";

const ENG = "11111111-1111-4111-8111-111111111111";
const DEL = "22222222-2222-4222-8222-222222222222";
const call = (body: unknown) => POST(new NextRequest(`https://d.test/api/engagements/${ENG}/documents`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
}), { params: Promise.resolve({ id: ENG }) });

beforeEach(() => { s.queue = {}; s.inserts = []; s.eqs = []; s.signed = []; s.signError = null; });

describe("POST documents (prepare upload)", () => {
  it("refuses a disallowed type before touching the database", async () => {
    const r = await call({ filename: "x.html", size: 10, deliverable_title: "Proposal" });
    expect(r.status).toBe(400);
    expect(s.eqs).toEqual([]);
  });
  it("creates a document deliverable and signs an upload path under it", async () => {
    s.queue = { engagements: [{ data: { id: ENG, status: "active" }, error: null }], deliverables: [{ data: { id: DEL }, error: null }] };
    const r = await call({ filename: "Q3 Proposal.PDF", size: 1234, deliverable_title: "Proposal" });
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(s.inserts).toEqual([["deliverables", { engagement_id: ENG, title: "Proposal", kind: "document" }]]);
    expect(s.signed[0]).toMatch(new RegExp(`^${ENG}/${DEL}/[0-9a-f-]{36}/document\\.pdf$`));
    expect(body).toMatchObject({ deliverable_id: DEL, filename: "Q3 Proposal.PDF", content_type: "application/pdf" });
    expect(s.signed[0]).toContain(body.upload_id);
  });
  it("refuses an existing deliverable that is a prototype, and a closed room", async () => {
    s.queue = { engagements: [{ data: { id: ENG, status: "active" }, error: null }], deliverables: [{ data: { id: DEL, kind: "prototype" }, error: null }] };
    expect((await call({ filename: "a.pdf", size: 1, deliverable_id: DEL })).status).toBe(409);
    s.queue = { engagements: [{ data: { id: ENG, status: "closed" }, error: null }] };
    expect((await call({ filename: "a.pdf", size: 1, deliverable_title: "x" })).status).toBe(409);
    expect(s.signed).toEqual([]);
  });
});
```

`src/app/api/engagements/[id]/documents/finalize/route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({
  deliverable: { data: null as unknown, error: null as unknown },
  head: new Uint8Array(),
  downloadError: null as unknown,
  removed: [] as string[][],
  rpc: vi.fn(),
}));
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: () => ({
      rpc: s.rpc,
      from: () => {
        const b: Record<string, unknown> = {};
        b.select = () => b; b.eq = () => b;
        b.maybeSingle = async () => s.deliverable;
        return b;
      },
    }),
    storage: {
      from: () => ({
        download: () => ({ asStream: async () => (s.downloadError ? { data: null, error: s.downloadError } : { data: new Response(s.head).body, error: null }) }),
        remove: async (p: string[]) => { s.removed.push(p); return { data: p, error: null }; },
      }),
    },
  },
}));
import { POST } from "./route";

const ENG = "11111111-1111-4111-8111-111111111111";
const DEL = "22222222-2222-4222-8222-222222222222";
const UP = "33333333-3333-4333-8333-333333333333";
const PATH = `${ENG}/${DEL}/${UP}/document.pdf`;
const call = (body: unknown = { deliverable_id: DEL, upload_id: UP, filename: "Proposal.pdf" }) =>
  POST(new NextRequest(`https://d.test/api/engagements/${ENG}/documents/finalize`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: ENG }) });

beforeEach(() => {
  s.deliverable = { data: { id: DEL, engagement_id: ENG, kind: "document" }, error: null };
  s.head = new TextEncoder().encode("%PDF-1.7\n");
  s.downloadError = null; s.removed = [];
  s.rpc.mockReset();
  s.rpc.mockResolvedValue({ data: [{ version_id: "v", version_no: 3 }], error: null });
});

describe("POST documents/finalize", () => {
  it("checks contents, then lets the database check size/type and create the draft", async () => {
    const r = await call({ deliverable_id: DEL, upload_id: UP, filename: "Proposal.pdf", change_summary: "Pricing updated" });
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ version_id: "v", version_no: 3 });
    expect(s.rpc).toHaveBeenCalledWith("add_document_version", {
      p_deliverable: DEL, p_upload: UP, p_ext: "pdf", p_filename: "Proposal.pdf", p_change_summary: "Pricing updated",
    });
    expect(s.removed).toEqual([]);
  });
  it("deletes the object and refuses when the contents do not match the extension", async () => {
    s.head = new TextEncoder().encode("<html><script>alert(1)</script>");
    const r = await call();
    expect(r.status).toBe(400);
    expect(s.removed).toEqual([[PATH]]);
    expect(s.rpc).not.toHaveBeenCalled();
  });
  it("deletes the object when the database refuses it (size, MIME, duplicate)", async () => {
    s.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "file size not allowed" } });
    const r = await call();
    expect(r.status).toBe(400);
    expect(JSON.stringify(await r.json())).not.toContain("file size not allowed");
    expect(s.removed).toEqual([[PATH]]);
  });
  it("keeps the object on an unexpected database error (a row may exist; never orphan a row)", async () => {
    s.rpc.mockResolvedValue({ data: null, error: { code: "08006", message: "connection" } });
    expect((await call()).status).toBe(500);
    expect(s.removed).toEqual([]);
  });
  it("404s when the upload or deliverable is missing, and refuses prototype deliverables", async () => {
    s.downloadError = { message: "not found" };
    expect((await call()).status).toBe(404);
    s.downloadError = null;
    s.deliverable = { data: null, error: null };
    expect((await call()).status).toBe(404);
    s.deliverable = { data: { id: DEL, engagement_id: ENG, kind: "prototype" }, error: null };
    expect((await call()).status).toBe(409);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/rooms "src/app/api/engagements/[id]/documents"` -> FAIL.

- [ ] **Step 3: Implement the libraries and schemas**

`src/lib/rooms/doc-limits.ts`:
```ts
// No imports: safe to use from client components.
export const DOC_MAX_BYTES = 25 * 1024 * 1024; // must equal the room-documents bucket file_size_limit (26214400)
export const DOC_ACCEPT = ".pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.txt,.csv,.md";
export const DOC_BUCKET = "room-documents";
```

`src/lib/rooms/documents.ts`:
```ts
import { DOC_TYPES, isSafeDocFilename, type DocExt } from "./grant";

export function docExt(name: string): DocExt | null {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(name);
  if (!m) return null;
  const e = m[1].toLowerCase();
  const norm = e === "jpeg" ? "jpg" : e;
  return norm in DOC_TYPES ? (norm as DocExt) : null;
}

// A display name safe for headers and the database: last path segment only, no control characters,
// quotes, backslashes or bidi overrides, no leading dots, at most 150 characters with the extension kept.
export function sanitizeDocFilename(name: string): string | null {
  const last = name.split(/[\\/]/).pop() ?? "";
  let s = last.normalize("NFC")
    .replace(/[\x00-\x1f\x7f"\\\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ").trim().replace(/^\.+/, "").trim();
  if (!docExt(s)) return null;
  if (s.length > 150) {
    const dot = s.lastIndexOf(".");
    s = s.slice(0, 150 - (s.length - dot)).trimEnd() + s.slice(dot);
  }
  return isSafeDocFilename(s) && s.lastIndexOf(".") > 0 ? s : null;
}

function indexOfSeq(h: Uint8Array, seq: number[], limit: number): number {
  const end = Math.min(h.length, limit) - seq.length;
  for (let i = 0; i <= end; i++) if (seq.every((b, j) => h[i + j] === b)) return i;
  return -1;
}
const startsWith = (h: Uint8Array, seq: number[]) => h.length >= seq.length && seq.every((b, i) => h[i] === b);

function isLikelyText(h: Uint8Array): boolean {
  if (h.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(h, { stream: true });
    return true;
  } catch {
    return false;
  }
}

// Magic-byte check on the first bytes of the uploaded object.
export function sniffDocument(ext: DocExt, head: Uint8Array): boolean {
  if (head.length === 0) return false;
  switch (ext) {
    case "pdf": return indexOfSeq(head, [0x25, 0x50, 0x44, 0x46, 0x2d], 1024) >= 0; // "%PDF-" within the first 1 KB
    case "png": return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "jpg": return startsWith(head, [0xff, 0xd8, 0xff]);
    case "docx": case "xlsx": case "pptx": return startsWith(head, [0x50, 0x4b, 0x03, 0x04]); // ZIP (OOXML)
    case "txt": case "csv": case "md": return isLikelyText(head);
  }
}

export async function readHead(stream: ReadableStream<Uint8Array>, max = 8192): Promise<Uint8Array> {
  const reader = stream.getReader();
  const out = new Uint8Array(max);
  let n = 0;
  try {
    while (n < max) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const take = Math.min(value.length, max - n);
      out.set(value.subarray(0, take), n);
      n += take;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return out.slice(0, n);
}
```

Append to `src/lib/rooms/schemas.ts` (add `import { DOC_MAX_BYTES } from "./doc-limits";` at the top):
```ts
export const DocumentUploadSchema = z.object({
  filename: z.string().min(1).max(300),
  size: z.number().int().min(1).max(DOC_MAX_BYTES),
  deliverable_id: z.string().uuid().optional(),
  deliverable_title: z.string().trim().min(1).max(200).optional(),
}).refine(b => Boolean(b.deliverable_id) !== Boolean(b.deliverable_title), {
  message: "Choose an existing document or give a new title.",
});

export const DocumentFinalizeSchema = z.object({
  deliverable_id: z.string().uuid(),
  upload_id: z.string().uuid(),
  filename: z.string().min(1).max(300),
  change_summary: z.string().trim().max(500).optional(),
});
```

- [ ] **Step 4: Implement the routes**

`src/app/api/engagements/[id]/documents/route.ts`:
```ts
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { DocumentUploadSchema } from "@/lib/rooms/schemas";
import { docExt, sanitizeDocFilename } from "@/lib/rooms/documents";
import { DOC_TYPES } from "@/lib/rooms/grant";
import { DOC_BUCKET } from "@/lib/rooms/doc-limits";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES_MSG = "Allowed file types: PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), PNG, JPG, TXT, CSV, Markdown.";
type Ctx = { params: Promise<{ id: string }> };

// POST — prepare a document upload: resolve or create the document deliverable and return a signed
// upload URL. The browser sends the file straight to Storage (never through this function).
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  const parsed = DocumentUploadSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  const b = parsed.data;
  const filename = sanitizeDocFilename(b.filename);
  const ext = filename ? docExt(filename) : null;
  if (!filename || !ext) return NextResponse.json({ error: TYPES_MSG }, { status: 400 });

  const rooms = supabaseAdmin.schema("rooms");
  const { data: eng } = await rooms.from("engagements").select("id, status").eq("id", id).single();
  if (!eng) return NextResponse.json({ error: "Engagement not found" }, { status: 404 });
  if (eng.status === "closed") return NextResponse.json({ error: "Engagement is closed" }, { status: 409 });

  let deliverableId: string;
  if (b.deliverable_id) {
    const { data: d } = await rooms.from("deliverables").select("id, kind")
      .eq("id", b.deliverable_id).eq("engagement_id", eng.id).maybeSingle();
    if (!d) return NextResponse.json({ error: "Deliverable not found in this engagement" }, { status: 404 });
    if (d.kind !== "document") return NextResponse.json({ error: "That deliverable is a prototype, not a document." }, { status: 409 });
    deliverableId = d.id;
  } else {
    const { data: d, error } = await rooms.from("deliverables")
      .insert({ engagement_id: eng.id, title: b.deliverable_title, kind: "document" }).select("id").single();
    if (error || !d) return NextResponse.json({ error: "Could not create the document." }, { status: 500 });
    deliverableId = d.id;
  }

  const uploadId = randomUUID();
  const path = `${eng.id}/${deliverableId}/${uploadId}/document.${ext}`;
  const { data, error } = await supabaseAdmin.storage.from(DOC_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: "Could not prepare the upload." }, { status: 500 });
  return NextResponse.json({
    deliverable_id: deliverableId, upload_id: uploadId, filename, signed_url: data.signedUrl, content_type: DOC_TYPES[ext],
  }, { status: 201 });
}
```

`src/app/api/engagements/[id]/documents/finalize/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { DocumentFinalizeSchema } from "@/lib/rooms/schemas";
import { docExt, sanitizeDocFilename, sniffDocument, readHead } from "@/lib/rooms/documents";
import { DOC_BUCKET } from "@/lib/rooms/doc-limits";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string }> };

// POST — verify an uploaded object and add it as a draft version. Contents are sniffed here; size and
// MIME are checked again in the database (rooms.add_document_version) from Storage's own metadata.
// The object is deleted only on a definite refusal, never on an unknown error (a row might exist).
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  const parsed = DocumentFinalizeSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  const b = parsed.data;
  const filename = sanitizeDocFilename(b.filename);
  const ext = filename ? docExt(filename) : null;
  if (!filename || !ext) return NextResponse.json({ error: "This file type is not allowed." }, { status: 400 });

  const rooms = supabaseAdmin.schema("rooms");
  const { data: d } = await rooms.from("deliverables").select("id, engagement_id, kind")
    .eq("id", b.deliverable_id).eq("engagement_id", id).maybeSingle();
  if (!d) return NextResponse.json({ error: "Deliverable not found in this engagement" }, { status: 404 });
  if (d.kind !== "document") return NextResponse.json({ error: "That deliverable is a prototype, not a document." }, { status: 409 });

  const uploadId = b.upload_id.toLowerCase();
  const path = `${d.engagement_id}/${d.id}/${uploadId}/document.${ext}`;
  const bucket = supabaseAdmin.storage.from(DOC_BUCKET);
  const refuse = async (error: string) => {
    await bucket.remove([path]).catch(() => undefined);
    return NextResponse.json({ error }, { status: 400 });
  };

  const dl = await bucket.download(path).asStream();
  if (dl.error || !dl.data) return NextResponse.json({ error: "The upload was not found. Please upload the file again." }, { status: 404 });
  const head = await readHead(dl.data as ReadableStream<Uint8Array>);
  if (!sniffDocument(ext, head)) return refuse(`This file's contents don't match its type (.${ext}). It was not added.`);

  const { data, error } = await rooms.rpc("add_document_version", {
    p_deliverable: d.id, p_upload: uploadId, p_ext: ext, p_filename: filename, p_change_summary: b.change_summary ?? null,
  });
  if (error) {
    if (error.code === "P0001") return refuse("This file could not be added (it may be too large, the wrong type, or already added).");
    if (error.code === "P0002") return NextResponse.json({ error: "Deliverable not found." }, { status: 404 });
    return NextResponse.json({ error: "Could not add this document. Try again." }, { status: 500 });
  }
  const row = (Array.isArray(data) ? data[0] : data) as { version_id: string; version_no: number } | null;
  if (!row) return NextResponse.json({ error: "Could not add this document. Try again." }, { status: 500 });
  return NextResponse.json({ version_id: row.version_id, version_no: row.version_no }, { status: 201 });
}
```

`src/app/api/versions/[id]/download/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isSafeDocFilename } from "@/lib/rooms/grant";
import { DOC_BUCKET } from "@/lib/rooms/doc-limits";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET — a 60-second signed download URL for a document version (drafts included), dashboard only.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid version id." }, { status: 400 });
  const { data: v } = await supabaseAdmin.schema("rooms").from("deliverable_versions")
    .select("storage_prefix, source, manifest").eq("id", id).maybeSingle();
  const file = v?.manifest?.file;
  if (!v || v.source !== "upload" || typeof file !== "string") return NextResponse.json({ error: "Document not found." }, { status: 404 });
  const name = isSafeDocFilename(v.manifest.filename) ? v.manifest.filename : file;
  const { data, error } = await supabaseAdmin.storage.from(DOC_BUCKET).createSignedUrl(`${v.storage_prefix}/${file}`, 60, { download: name });
  if (error || !data) return NextResponse.json({ error: "Could not create a download link." }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl });
}
```

In `src/app/api/engagements/[id]/prototype-request/route.ts` replace the existing-deliverable lookup block
```ts
    const { data: d } = await rooms.from("deliverables")
      .select("id, title").eq("id", deliverableId).eq("engagement_id", id).single();
    if (!d) return NextResponse.json({ error: "Deliverable not found in this engagement" }, { status: 404 });
    deliverableTitle = d.title;
```
with
```ts
    const { data: d } = await rooms.from("deliverables")
      .select("id, title, kind").eq("id", deliverableId).eq("engagement_id", id).single();
    if (!d) return NextResponse.json({ error: "Deliverable not found in this engagement" }, { status: 404 });
    if (d.kind !== "prototype") return NextResponse.json({ error: "That deliverable is a document; Casey only builds prototypes." }, { status: 409 });
    deliverableTitle = d.title;
```
and add to `src/app/api/engagements/[id]/prototype-request/route.test.ts` a test following that file's existing stub style: with the deliverable lookup returning `{ id, title: "Proposal", kind: "document" }`, the POST with `deliverable_id` returns 409 and no `work_items` insert happens.

- [ ] **Step 5: Run to verify pass** — `npx vitest run`, `npx tsc --noEmit`.

- [ ] **Step 6: UI.** `src/app/(dashboard)/engagements/[id]/DocumentUpload.tsx`:
```tsx
"use client";
import { useRef, useState } from "react";
import { fetchJson } from "@/lib/rooms/fetch-json";
import { DOC_ACCEPT, DOC_MAX_BYTES } from "@/lib/rooms/doc-limits";

type Prep = { deliverable_id: string; upload_id: string; filename: string; signed_url: string; content_type: string };

// Upload a document (proposal, PDF, sheet…) as a draft version. The file goes from the browser
// straight to Storage via a signed upload URL; the server then verifies it before any row exists.
export function DocumentUpload({ engagementId, documents, onDone }: {
  engagementId: string; documents: { id: string; title: string }[]; onDone: (msg: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [targetId, setTargetId] = useState("");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inFlight = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const upload = async () => {
    if (!file || inFlight.current) return;
    if (file.size > DOC_MAX_BYTES) { setErr("Files must be 25 MB or smaller."); return; }
    if (file.size === 0) { setErr("That file is empty."); return; }
    inFlight.current = true; setBusy(true); setErr(null);
    try {
      const prep = await fetchJson<Prep>(`/api/engagements/${engagementId}/documents`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, size: file.size, ...(targetId ? { deliverable_id: targetId } : { deliverable_title: title }) }),
      });
      if (!prep.ok) { setErr(prep.error); return; }
      let put: Response;
      try {
        put = await fetch(prep.data.signed_url, {
          method: "PUT", headers: { "content-type": prep.data.content_type, "x-upsert": "false" }, body: file,
        });
      } catch { setErr("Upload failed (network error). Try again."); return; }
      if (!put.ok) { setErr(`Upload failed (HTTP ${put.status}). Check the file is 25 MB or smaller and an allowed type.`); return; }
      const fin = await fetchJson<{ version_no: number }>(`/api/engagements/${engagementId}/documents/finalize`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliverable_id: prep.data.deliverable_id, upload_id: prep.data.upload_id, filename: file.name,
          ...(summary.trim() ? { change_summary: summary.trim() } : {}) }),
      });
      if (!fin.ok) { setErr(fin.error); return; }
      setFile(null); setTitle(""); setSummary(""); setTargetId("");
      if (fileInput.current) fileInput.current.value = "";
      onDone(`Uploaded “${prep.data.filename}” as v${fin.data.version_no} (draft). Use “Share with room” to make it visible.`);
    } finally {
      inFlight.current = false; setBusy(false);
    }
  };

  return (
    <div className="border border-brand-border rounded p-3 space-y-2">
      <h2 className="text-sm font-semibold">Upload document</h2>
      <p className="text-xs text-brand-muted">PDF, Word, Excel, PowerPoint, PNG, JPG, TXT, CSV or Markdown, up to 25 MB. Visitors can download it once you share it.</p>
      <select value={targetId} onChange={e => setTargetId(e.target.value)} className="border border-brand-border rounded px-2 py-1.5 text-sm">
        <option value="">New document…</option>
        {documents.map(d => <option key={d.id} value={d.id}>New version of: {d.title}</option>)}
      </select>
      {!targetId && (
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Document title (e.g. Proposal)"
          className="w-full border border-brand-border rounded px-2 py-1.5 text-sm" />
      )}
      <input ref={fileInput} type="file" accept={DOC_ACCEPT} onChange={e => setFile(e.target.files?.[0] ?? null)} className="block text-sm" />
      <input value={summary} onChange={e => setSummary(e.target.value)} maxLength={500} placeholder="What changed? (optional)"
        className="w-full border border-brand-border rounded px-2 py-1.5 text-sm" />
      <button disabled={busy || !file || (!targetId && !title.trim())} onClick={upload}
        className="px-3 py-1.5 text-sm rounded bg-brand-orange text-white disabled:opacity-50">
        {busy ? "Uploading…" : "Upload"}
      </button>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  );
}
```

In `page.tsx`:
- Add `import { DocumentUpload } from "./DocumentUpload";`.
- Change the `Version` type to add `source: string; manifest: { filename?: string; size?: number } | null;`.
- In the Request-prototype select, replace `{deliverables.map(d => <option key={d.id} value={d.id}>New version of: {d.title}</option>)}` with `{deliverables.filter(d => d.kind === "prototype").map(d => <option key={d.id} value={d.id}>New version of: {d.title}</option>)}`.
- Insert directly before `          {deliverables.map(d => (` (the per-deliverable list):
```tsx
          <DocumentUpload engagementId={id} documents={deliverables.filter(d => d.kind === "document").map(d => ({ id: d.id, title: d.title }))}
            onDone={(m) => { setMsg(m); void load(); }} />
```
- Add the download action next to `preview`:
```tsx
  const download = (versionId: string) => guarded("download", async () => {
    const r = await fetchJson<{ url: string }>(`/api/versions/${versionId}/download`);
    if (r.ok) window.location.assign(r.data.url);
    else setMsg(r.error);
  });
```
- Replace `<button disabled={!!pending} onClick={() => preview(v.id)} className="text-brand-orange disabled:opacity-50">Preview</button>` with:
```tsx
                          {v.source === "upload"
                            ? <button disabled={!!pending} onClick={() => download(v.id)} className="text-brand-orange disabled:opacity-50">Download</button>
                            : <button disabled={!!pending} onClick={() => preview(v.id)} className="text-brand-orange disabled:opacity-50">Preview</button>}
```
- In the version row text, after the change summary, show the file name for documents: change `{v.change_summary ? ` · ${v.change_summary}` : ""}` to `{v.source === "upload" && v.manifest?.filename ? ` · ${v.manifest.filename}` : ""}{v.change_summary ? ` · ${v.change_summary}` : ""}`.

- [ ] **Step 7: Verify** — `npx vitest run`, `npx tsc --noEmit`, placeholder-env production build (`rm -rf .next && npm run build`).

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(rooms): documents — direct-to-storage upload, verified finalize, dashboard download

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Activity lines for the new events (dashboard repo)

**Files:**
- Modify: `src/app/api/engagements/[id]/activity/route.ts`, `src/app/api/engagements/[id]/activity/route.test.ts`
- Modify: `src/app/(dashboard)/engagements/[id]/page.tsx`

**Interfaces:**
- Consumes: event types from Task 1.
- Produces: `ActivityEvent` gains `deliverable_title: string | null` (set only for `deliverable_deleted`, from `meta->>deliverable_title`). The whole `meta` column is still never selected or returned.

- [ ] **Step 1: Update the tests** in `route.test.ts`:
  - Replace the last assertion of "never exposes access_id or meta and never selects them" with:
```ts
    expect(state.selects.join(",")).not.toMatch(/access_id|(^|,\s*)meta\s*(,|$)/);
    expect(state.selects[0]).toContain("deliverable_title:meta->>deliverable_title");
```
  - Add:
```ts
  it("returns the deleted deliverable's title only for deliverable_deleted events", async () => {
    state.events = { data: [
      { id: 9, type: "deliverable_deleted", created_at: "2026-10-14T11:00:00Z", contact_id: null, version_id: null, deliverable_title: "Proposal" },
      { id: 8, type: "link_refreshed", created_at: "2026-10-14T10:30:00Z", contact_id: null, version_id: null, deliverable_title: null },
      { id: 7, type: "version_viewed", created_at: "2026-10-14T10:00:00Z", contact_id: C1, version_id: V1, deliverable_title: "ignored" },
    ], error: null };
    const body = await (await call()).json();
    expect(body.events[0]).toMatchObject({ type: "deliverable_deleted", deliverable_title: "Proposal" });
    expect(body.events[1].deliverable_title).toBeNull();
    expect(body.events[2].deliverable_title).toBeNull();
  });
```
- [ ] **Step 2: Run to verify failure** — `npx vitest run "src/app/api/engagements/[id]/activity"` -> FAIL.

- [ ] **Step 3: Implement** in `route.ts`:
  - `type EventRow = { id: number; type: string; created_at: string; contact_id: string | null; version_id: string | null; deliverable_title: string | null };`
  - select string: `.select("id, type, created_at, contact_id, version_id, deliverable_title:meta->>deliverable_title")`
  - in the mapped event object add `deliverable_title: e.type === "deliverable_deleted" && typeof e.deliverable_title === "string" ? e.deliverable_title : null,`

  In `page.tsx`, extend `ActivityEvent` with `deliverable_title: string | null` and add to `describeEvent` before `return e.type;`:
```tsx
    if (e.type === "document_downloaded") {
      return `${e.contact?.name ?? "A visitor"} downloaded ${e.version ? `${e.version.deliverable_title} v${e.version.version_no}` : "a document"}`;
    }
    if (e.type === "deliverable_deleted") return `Deleted “${e.deliverable_title ?? "a deliverable"}”`;
    if (e.type === "link_refreshed") return "A room link was refreshed (the old link stopped working)";
```
- [ ] **Step 4: Verify** — `npx vitest run`, `npx tsc --noEmit`.
- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(rooms): activity lines for downloads, deletions and link refreshes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Sliding 2-hour session (portal repo)

**Files:**
- Modify: `lib/session.ts`, `lib/session.test.ts`, `lib/handlers.ts`, `lib/handlers.test.ts`, `components/RoomView.tsx`

**Interfaces:**
- Consumes: Phase 2 portal modules.
- Produces:
  - `SESSION_MAX_SEC = 28800`, `SESSION_IDLE_SEC = 7200`; `interface SessionPayload { aid: string; eid: string; cid?: string; st: number; exp: number }`.
  - `sessionExpiry(accessExpiresAt: string | Date, startSec: number, nowMs?: number): number` (new required `startSec`).
  - `verifySession` additionally requires integer `st` with `st <= now + 60s`, `exp <= st + SESSION_MAX_SEC`.
  - `requireSession(cookie, d): Promise<{ s: SessionPayload; row: RoomHeader; renewed: string } | null>` where `renewed` is a full `Set-Cookie` header value.
  - `handleDeliverables`, `handlePreviewUrl`, `handleIdentify` (and Task 12's `handleDocumentUrl`) send `Set-Cookie: renewed` on every response after a valid session.

- [ ] **Step 1: Branch** — `cd /home/brian/work/discovery/portal && git fetch && git checkout -b feat/room-phase3 origin/main`.

- [ ] **Step 2: Write the failing tests**

Replace the top of `lib/session.test.ts` (imports and `payload`) and the "expires at the earlier…" test as follows; keep the cookie-attribute test:
```ts
import { describe, it, expect } from "vitest";
import { signSession, verifySession, sessionExpiry, setCookieHeader, clearCookieHeader, COOKIE_NAME, SESSION_MAX_SEC, SESSION_IDLE_SEC } from "./session";

const A = "0b6f1c0e-2d3a-4b5c-8d7e-9f0a1b2c3d4e";
const E = "1c7a2d1f-3e4b-4c6d-9e8f-0a1b2c3d4e5f";
const C = "2d8b3e20-4f5c-4d7e-8f90-1b2c3d4e5f60";
const SECRET = "s".repeat(32);
const NOW = 1_800_000_000_000;
const NOW_S = NOW / 1000;
const payload = { aid: A, eid: E, st: NOW_S - 60, exp: NOW_S + 3600 };
```
Keep the existing round-trip / wrong-secret / bad-ids / empty-secret tests (they use `payload`), change the bad-payload list in "rejects payloads with bad ids…" to also include `{ ...payload, st: "x" }` and `{ aid: A, eid: E, exp: NOW_S + 3600 }`, and add:
```ts
  it("fails closed for a Phase 2 cookie without a start time", () => {
    expect(verifySession(signSession({ aid: A, eid: E, exp: NOW_S + 3600 } as never, SECRET), SECRET, NOW)).toBeNull();
  });
  it("rejects a start in the future, an expiry past the 8-hour cap, and a session older than 8 hours", () => {
    expect(verifySession(signSession({ ...payload, st: NOW_S + 120 }, SECRET), SECRET, NOW)).toBeNull();
    expect(verifySession(signSession({ ...payload, st: NOW_S - 60, exp: NOW_S - 60 + SESSION_MAX_SEC + 1 }, SECRET), SECRET, NOW)).toBeNull();
    expect(verifySession(signSession({ ...payload, st: NOW_S - SESSION_MAX_SEC - 1, exp: NOW_S + 10 }, SECRET), SECRET, NOW)).toBeNull();
  });
  it("tolerates up to 60 seconds of clock skew on the start time", () => {
    expect(verifySession(signSession({ ...payload, st: NOW_S + 30 }, SECRET), SECRET, NOW)).not.toBeNull();
  });
  it("expires at the earliest of link expiry, 2 idle hours and 8 hours from the start", () => {
    const far = new Date(NOW + 30 * 86_400_000).toISOString();
    expect(sessionExpiry(far, NOW_S, NOW)).toBe(NOW_S + SESSION_IDLE_SEC);
    expect(sessionExpiry(new Date(NOW + 3600_000).toISOString(), NOW_S, NOW)).toBe(NOW_S + 3600);
    expect(sessionExpiry(far, NOW_S - 7 * 3600, NOW)).toBe(NOW_S - 7 * 3600 + SESSION_MAX_SEC);
    expect(Number.isNaN(sessionExpiry("garbage", NOW_S, NOW))).toBe(true);
  });
```

In `lib/handlers.test.ts`:
- change `goodCookie` to `const goodCookie = (extra: object = {}) => cookie({ aid: A, eid: E, st: NOW / 1000 - 60, exp: NOW / 1000 + 3000, ...extra });`
- in "rejects missing, forged and expired cookies…" change the expired cookie to `cookie({ aid: A, eid: E, st: NOW / 1000 - 600, exp: NOW / 1000 - 10 })`.
- in "sets the session cookie and redirects to /room for a valid link" add `expect(p.st).toBe(Math.floor(NOW / 1000));`.
- in "identifies, then re-signs the cookie…" change the expectation to `toMatchObject({ aid: A, eid: E, cid: C, st: NOW / 1000 - 60, exp: NOW / 1000 + 3600 })` (the session slides to the link expiry, which is earlier than 2 hours) and rename the test to "identifies, then re-signs the cookie with the contact and a renewed expiry".
- add:
```ts
describe("sliding session", () => {
  const farHeader = { ...header, contact_id: C, expires_at: new Date(NOW + 30 * 86_400_000).toISOString() };
  const valueOf = (r: Response) => r.headers.get("set-cookie")!.split(";")[0].slice(COOKIE_NAME.length + 1);

  it("renews the cookie to now + 2 hours on an authenticated API call, keeping the start", async () => {
    const { d } = deps((t) => (t.includes("portal_session") ? [farHeader] : []));
    const r = await handleDeliverables(goodCookie({ cid: C, exp: NOW / 1000 + 60 }), d);
    expect(r.status).toBe(200);
    const p = verifySession(valueOf(r), SESSION_SECRET, NOW)!;
    expect(p).toMatchObject({ aid: A, eid: E, cid: C, st: NOW / 1000 - 60, exp: NOW / 1000 + 7200 });
    expect(r.headers.get("set-cookie")).toContain("Max-Age=7200");
  });
  it("never renews past 8 hours from the start", async () => {
    const st = NOW / 1000 - 7.5 * 3600;
    const { d } = deps((t) => (t.includes("portal_session") ? [farHeader] : []));
    const r = await handleDeliverables(goodCookie({ cid: C, st, exp: NOW / 1000 + 60 }), d);
    expect(verifySession(valueOf(r), SESSION_SECRET, NOW)!.exp).toBe(st + 8 * 3600);
  });
  it("an idle-expired cookie is refused without a database call", async () => {
    const { d, calls } = deps(() => [farHeader]);
    expect((await handleDeliverables(goodCookie({ cid: C, exp: NOW / 1000 - 1 }), d)).status).toBe(401);
    expect(calls).toEqual([]);
  });
  it("a Phase 2 cookie (no st) is refused", async () => {
    const { d } = deps(() => [farHeader]);
    expect((await handleDeliverables(cookie({ aid: A, eid: E, cid: C, exp: NOW / 1000 + 600 }), d)).status).toBe(401);
  });
  it("preview-url also renews", async () => {
    const { d } = deps((t) => (t.includes("portal_session") ? [farHeader] : []));
    const r = await handlePreviewUrl(goodCookie({ cid: C }), V, d);
    expect(r.headers.get("set-cookie")).toContain(`${COOKIE_NAME}=`);
  });
});
```

- [ ] **Step 3: Run to verify failure** — `npx vitest run lib/session.test.ts lib/handlers.test.ts` -> FAIL.

- [ ] **Step 4: Implement**

`lib/session.ts` — replace the constants, interface, `verifySession` and `sessionExpiry` (keep `COOKIE_NAME`, `mac`, `signSession`, `setCookieHeader`, `clearCookieHeader` unchanged):
```ts
export const SESSION_MAX_SEC = 8 * 3600;  // absolute cap, counted from when the link was opened (st)
export const SESSION_IDLE_SEC = 2 * 3600; // sliding idle timeout, renewed on every authenticated API call
const CLOCK_SKEW_SEC = 60;

export interface SessionPayload { aid: string; eid: string; cid?: string; st: number; exp: number }

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
  const { aid, eid, cid, st, exp } = p as Record<string, unknown>;
  if (typeof aid !== "string" || !UUID.test(aid)) return null;
  if (typeof eid !== "string" || !UUID.test(eid)) return null;
  if (cid !== undefined && (typeof cid !== "string" || !UUID.test(cid))) return null;
  // Phase 2 cookies have no st: they fail closed here and the visitor re-opens the link.
  if (typeof st !== "number" || !Number.isInteger(st) || st * 1000 > nowMs + CLOCK_SKEW_SEC * 1000) return null;
  if (typeof exp !== "number" || !Number.isInteger(exp) || exp * 1000 <= nowMs) return null;
  if (exp > st + SESSION_MAX_SEC) return null;
  return cid === undefined ? { aid, eid, st, exp } : { aid, eid, cid, st, exp };
}

export function sessionExpiry(accessExpiresAt: string | Date, startSec: number, nowMs: number = Date.now()): number {
  const link = Math.floor(new Date(accessExpiresAt).getTime() / 1000);
  return Math.min(link, Math.floor(nowMs / 1000) + SESSION_IDLE_SEC, startSec + SESSION_MAX_SEC);
}
```

`lib/handlers.ts`:
- Add a helper below `expired`:
```ts
// Signs a renewed session cookie (sliding idle timeout, capped at st + 8h and the link expiry).
function sessionCookie(p: { aid: string; eid: string; cid?: string; st: number }, linkExpiresAt: string | Date, d: Deps): string | null {
  const now = nowMs(d);
  const exp = sessionExpiry(linkExpiresAt, p.st, now);
  if (!Number.isInteger(exp) || exp * 1000 <= now) return null;
  const payload: SessionPayload = p.cid ? { aid: p.aid, eid: p.eid, cid: p.cid, st: p.st, exp } : { aid: p.aid, eid: p.eid, st: p.st, exp };
  return setCookieHeader(signSession(payload, d.sessionSecret), exp - Math.floor(now / 1000));
}
```
- `handleOpen`: replace the three lines from `const exp = …` through the `return new Response(…)` with:
```ts
  const st = Math.floor(nowMs(d) / 1000);
  const setCookie = sessionCookie({ aid: row.access_id, eid: row.engagement_id, st }, row.expires_at, d);
  if (!setCookie) return expired();
  return new Response(null, {
    status: 303,
    headers: { Location: "/room", "Cache-Control": "private, no-store", "Set-Cookie": setCookie },
  });
```
- `requireSession`:
```ts
export async function requireSession(cookie: string | undefined, d: Deps): Promise<{ s: SessionPayload; row: RoomHeader; renewed: string } | null> {
  const s = verifySession(cookie, d.sessionSecret, nowMs(d));
  if (!s) return null;
  let row: RoomHeader | null;
  try { row = await getSessionRow(d.q, s.aid, s.eid, s.cid); } catch { return null; }
  if (!row) return null;
  const renewed = sessionCookie(s, row.expires_at, d);
  return renewed ? { s, row, renewed } : null;
}
```
- `handleIdentify`: replace the last two lines with
```ts
  const setCookie = sessionCookie({ aid: sess.s.aid, eid: sess.s.eid, cid, st: sess.s.st }, sess.row.expires_at, d);
  if (!setCookie) return json({ error: "Session expired." }, 401);
  return json({ ok: true }, 200, { "Set-Cookie": setCookie });
```
- `handleDeliverables`: pass `{ "Set-Cookie": sess.renewed }` as the third argument to both `json(...)` calls after the session check (the 500 and the 200).
- `handlePreviewUrl`: pass `{ "Set-Cookie": sess.renewed }` to every `json(...)` after the session check (the three 404s and the 200).
- Remove the now-unused `sessionExpiry`/`setCookieHeader` names from the import only if the compiler reports them unused (both are still used by `sessionCookie`).

`components/RoomView.tsx`: replace the expired message
```tsx
          Your session has ended. <a href="/room">Reload this page</a> to continue.
```
with
```tsx
          Your session ended after 2 hours without activity (or 8 hours in total). Open your room link again to continue.
```

- [ ] **Step 5: Verify** — `npx vitest run`, `npx tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(room): sliding 2-hour session with the 8-hour cap and link expiry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Portal deliverables payload, version dates, welcome messages, full-height frame (portal repo)

**Files:**
- Create: `lib/format.ts`, `lib/format.test.ts`
- Modify: `lib/queries.ts`, `lib/handlers.ts`, `lib/handlers.test.ts`, `components/RoomView.tsx`, `components/room-pages.test.tsx`

**Interfaces:**
- Consumes: new `portal_list_deliverables` columns (Task 1); `requireSession(...).renewed` (Task 10).
- Produces:
  - `DeliverableRow` gains `kind: string; welcome_message: string | null; created_at: string | Date; document: unknown`.
  - `GET /api/room/deliverables` -> `{ deliverables: [{ id, title, description, kind: "prototype" | "document", welcome_message: string | null, versions: [{ id, version_no, status, shared_at, created_at, change_summary, screens, document: { filename, ext, size } | null }] }] }`.
  - `formatVersionDate(value: string | Date, timeZone?: string): string`, `formatBytes(n: number): string` (`lib/format.ts`).
  - RoomView exports `versionLabel(v: Version, timeZone?: string): string`, `WelcomeNote({ text })`, `PreviewFrame` (new sizing), `Version` (with `created_at`, `document`).

- [ ] **Step 1: Write the failing tests**

`lib/format.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { formatVersionDate, formatBytes } from "./format";

describe("formatVersionDate", () => {
  it("formats as 'Oct 14, 2026' in the given zone", () => {
    expect(formatVersionDate("2026-10-14T12:00:00Z", "UTC")).toBe("Oct 14, 2026");
    expect(formatVersionDate("2026-10-15T03:00:00Z", "America/Los_Angeles")).toBe("Oct 14, 2026");
    expect(formatVersionDate("2026-10-15T03:00:00Z", "UTC")).toBe("Oct 15, 2026");
  });
  it("is empty for an invalid date", () => { expect(formatVersionDate("x")).toBe(""); });
});

describe("formatBytes", () => {
  it("uses B, KB and MB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1572864)).toBe("1.5 MB");
  });
});
```

Add to `lib/handlers.test.ts` inside `describe("handleDeliverables")`:
```ts
  it("returns kind, welcome message, created_at and safe document info, and nothing internal", async () => {
    const rows = [
      { deliverable_id: "d2", deliverable_title: "Proposal", description: null, kind: "document", welcome_message: "Hi\n<b>there</b>",
        version_id: "v9", version_no: 1, status: "shared", shared_at: "2026-10-14T10:00:00Z", created_at: "2026-10-14T09:00:00Z",
        change_summary: null, screens: [], document: { filename: "Proposal.pdf", ext: "pdf", size: 1234, extra: "x" }, storage_prefix: "SECRET" },
      { deliverable_id: "d1", deliverable_title: "App", description: null, kind: "prototype", welcome_message: null,
        version_id: "v1", version_no: 1, status: "shared", shared_at: null, created_at: "2026-10-13T09:00:00Z",
        change_summary: null, screens: [], document: null },
    ];
    const { d } = deps((t) => (t.includes("portal_session") ? [{ ...header, contact_id: C }] : rows));
    const body = await (await handleDeliverables(goodCookie({ cid: C }), d)).json();
    expect(body.deliverables[0]).toMatchObject({ id: "d2", kind: "document", welcome_message: "Hi\n<b>there</b>" });
    expect(body.deliverables[0].versions[0]).toMatchObject({ created_at: "2026-10-14T09:00:00Z", document: { filename: "Proposal.pdf", ext: "pdf", size: 1234 } });
    expect(body.deliverables[0].versions[0].document).not.toHaveProperty("extra");
    expect(body.deliverables[1]).toMatchObject({ kind: "prototype", welcome_message: null });
    expect(body.deliverables[1].versions[0].document).toBeNull();
    expect(JSON.stringify(body)).not.toContain("SECRET");
  });
  it("defaults kind to prototype for rows from an older database function", async () => {
    const rows = [{ deliverable_id: "d1", deliverable_title: "App", description: null, version_id: "v1", version_no: 1, status: "shared", shared_at: null, change_summary: null, screens: [] }];
    const { d } = deps((t) => (t.includes("portal_session") ? [{ ...header, contact_id: C }] : rows));
    const body = await (await handleDeliverables(goodCookie({ cid: C }), d)).json();
    expect(body.deliverables[0]).toMatchObject({ kind: "prototype", welcome_message: null });
    expect(body.deliverables[0].versions[0]).toMatchObject({ created_at: null, document: null });
  });
```

Add to `components/room-pages.test.tsx` (extend the RoomView import with `versionLabel, WelcomeNote`):
```tsx
describe("version label and welcome note", () => {
  it("labels versions with number, date and older marker", () => {
    const v = { id: "1", version_no: 3, status: "superseded", shared_at: null, created_at: "2026-10-14T12:00:00Z", change_summary: null, screens: [], document: null } as Version;
    expect(versionLabel(v, "UTC")).toBe("v3 · Oct 14, 2026 (older)");
    expect(versionLabel({ ...v, status: "shared", created_at: null } as unknown as Version, "UTC")).toBe("v3");
  });
  it("renders the welcome message as text with line breaks, never as HTML", () => {
    const html = renderToStaticMarkup(<WelcomeNote text={"Hello\n<b>there</b><script>x</script>"} />);
    expect(html).toContain("&lt;b&gt;there&lt;/b&gt;&lt;script&gt;");
    expect(html).not.toContain("<b>");
    expect(html).toContain("white-space:pre-line");
  });
});
```
and change the "preview frame" test to also assert the new sizing:
```tsx
    expect(html).toContain("height:calc(100dvh - 2rem)");
    expect(html).toContain("min-height:480px");
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run` -> FAIL.

- [ ] **Step 3: Implement**

`lib/format.ts`:
```ts
// "Oct 14, 2026" in the viewer's time zone (or the zone given, for tests).
export function formatVersionDate(value: string | Date, timeZone?: string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", ...(timeZone ? { timeZone } : {}),
  }).format(d);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
```

`lib/queries.ts` — replace `DeliverableRow`:
```ts
export interface DeliverableRow {
  deliverable_id: string; deliverable_title: string; description: string | null;
  kind?: string; welcome_message?: string | null;
  version_id: string; version_no: number; status: string; shared_at: string | null; created_at?: string | Date | null;
  change_summary: string | null; screens: { id: string; name: string }[]; document?: unknown;
}
```

`lib/handlers.ts` — replace the body of `handleDeliverables` after the `rows` query with:
```ts
  const byId = new Map<string, { id: string; title: string; description: string | null; kind: string; welcome_message: string | null; versions: unknown[] }>();
  for (const r of rows) {
    if (!byId.has(r.deliverable_id)) {
      byId.set(r.deliverable_id, {
        id: r.deliverable_id, title: r.deliverable_title, description: r.description,
        kind: r.kind === "document" ? "document" : "prototype",
        welcome_message: typeof r.welcome_message === "string" ? r.welcome_message : null,
        versions: [],
      });
    }
    byId.get(r.deliverable_id)!.versions.push({
      id: r.version_id, version_no: r.version_no, status: r.status, shared_at: r.shared_at,
      created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
      change_summary: r.change_summary, screens: r.screens ?? [], document: docInfo(r.document),
    });
  }
  return json({ deliverables: [...byId.values()] }, 200, { "Set-Cookie": sess.renewed });
```
and add above it:
```ts
function docInfo(x: unknown): { filename: string; ext: string; size: number } | null {
  if (!x || typeof x !== "object") return null;
  const { filename, ext, size } = x as Record<string, unknown>;
  if (typeof filename !== "string" || typeof ext !== "string" || typeof size !== "number") return null;
  return { filename, ext, size };
}
```

`components/RoomView.tsx`:
- Add `import { formatVersionDate } from "@/lib/format";`.
- Replace the `Version` and `Deliverable` types:
```tsx
export interface Version {
  id: string; version_no: number; status: string; shared_at: string | null; created_at: string | null;
  change_summary: string | null; screens: { id: string; name: string }[];
  document: { filename: string; ext: string; size: number } | null;
}
interface Deliverable { id: string; title: string; description: string | null; kind: "prototype" | "document"; welcome_message: string | null; versions: Version[] }
```
- Add:
```tsx
export function versionLabel(v: Version, timeZone?: string): string {
  const date = v.created_at ? formatVersionDate(v.created_at, timeZone) : "";
  return `v${v.version_no}${date ? ` · ${date}` : ""}${v.status === "superseded" ? " (older)" : ""}`;
}

// Plain text only: React escapes it; pre-line keeps the line breaks Brian typed.
export function WelcomeNote({ text }: { text: string }) {
  return <p style={{ whiteSpace: "pre-line", margin: "0.25rem 0 0.75rem" }}>{text}</p>;
}
```
- `PreviewFrame` style becomes `style={{ width: "100%", height: "calc(100dvh - 2rem)", minHeight: 480, border: "1px solid #d0d5dd", borderRadius: 8 }}` (sandbox, referrerPolicy and the SECURITY comment unchanged). Add above the function: `// Sized to the viewport: a sandboxed cross-origin frame cannot be measured, so a prototype taller than the window still scrolls inside the frame.`
- In `SolutionCard`: after `{d.description && <p>{d.description}</p>}` add `{d.welcome_message && <WelcomeNote text={d.welcome_message} />}`; change the option text to `{versionLabel(v)}`.
- In `RoomView`'s render, replace `{items?.map(d => <SolutionCard key={d.id} d={d} onSessionEnded={onSessionEnded} />)}` with `{items?.map(d => d.kind === "document" ? null : <SolutionCard key={d.id} d={d} onSessionEnded={onSessionEnded} />)}` (Task 12 renders documents; until then they are not shown rather than shown with a broken preview).

- [ ] **Step 4: Verify** — `npx vitest run`, `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(room): version dates, per-deliverable welcome, full-height frame

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Portal document downloads (portal repo)

**Files:**
- Modify: `lib/grant.ts`, `lib/grant.test.ts` (byte copies from Task 2)
- Modify: `lib/queries.ts`, `lib/queries.test.ts`, `lib/handlers.ts`, `lib/handlers.test.ts`, `components/RoomView.tsx`, `components/room-pages.test.tsx`
- Create: `app/api/room/versions/[id]/document-url/route.ts`

**Interfaces:**
- Consumes: `rooms.portal_document_for_download` (Task 1); `signDocGrant`, `verifyDocGrant` (Task 2); preview host `/d/<grant>` (Task 3); `requireSession(...).renewed` (Task 10); `formatBytes`, `versionLabel`, `WelcomeNote` (Task 11).
- Produces: `interface DocumentRow { storage_prefix: string; file: string; filename: string }`; `documentForDownload(q, aid, eid, cid, versionId): Promise<DocumentRow | null>`; `handleDocumentUrl(req: Request, cookie: string | undefined, versionId: string, d: Deps): Promise<Response>`; `POST /api/room/versions/[id]/document-url` -> `200 { url }` (`<previewUrl>/d/<grant>`), `401`, `403`, `404`.

- [ ] **Step 1: Copy the shared files**

```bash
cp ../dashboard/src/lib/rooms/grant.ts lib/grant.ts
cp ../dashboard/src/lib/rooms/grant.test.ts lib/grant.test.ts
cmp lib/grant.ts ../dashboard/src/lib/rooms/grant.ts && cmp lib/grant.ts ../preview-host/lib/grant.ts && echo IDENTICAL
```

- [ ] **Step 2: Write the failing tests**

Add to `lib/queries.test.ts` (extend the import with `documentForDownload`):
```ts
  it("documentForDownload binds all four ids and returns the row or null", async () => {
    const p = fake([[{ storage_prefix: "a/b/c", file: "document.pdf", filename: "P.pdf" }]]);
    expect(await documentForDownload(p.q, A, E, undefined, V)).toEqual({ storage_prefix: "a/b/c", file: "document.pdf", filename: "P.pdf" });
    expect(p.calls[0].text).toContain("rooms.portal_document_for_download(");
    expect(p.calls[0].values).toEqual([A, E, null, V]);
    expect(await documentForDownload(fake([[]]).q, A, E, C, V)).toBeNull();
  });
```

Add to `lib/handlers.test.ts` (extend imports: `handleDocumentUrl` from `./handlers`, `verifyDocGrant` from `./grant`):
```ts
describe("handleDocumentUrl", () => {
  const U = "4fad5042-6b7e-4f90-8ab2-3d4e5f607182";
  const prefix = `${E}/${A}/${U}`;
  const withContact = (t: string) => (t.includes("portal_session") ? [{ ...header, contact_id: C }] : undefined);
  const req = (h: Record<string, string> = { origin: ORIGIN, "content-type": "application/json" }) =>
    new Request(`${ORIGIN}/api/room/versions/${V}/document-url`, { method: "POST", headers: h, body: "{}" });

  it("rejects cross-origin requests and bad ids before any database call", async () => {
    const { d, calls } = deps(() => []);
    expect((await handleDocumentUrl(req({ origin: "https://evil.example", "content-type": "application/json" }), goodCookie({ cid: C }), V, d)).status).toBe(403);
    expect((await handleDocumentUrl(req(), goodCookie({ cid: C }), "not-a-uuid", d)).status).toBe(404);
    expect(calls).toEqual([]);
  });
  it("requires a session with a contact", async () => {
    const { d } = deps(() => [header]);
    expect((await handleDocumentUrl(req(), goodCookie(), V, d)).status).toBe(401);
  });
  it("404s for a prototype, a draft or another engagement's version", async () => {
    const { d } = deps((t) => withContact(t) ?? []);
    const r = await handleDocumentUrl(req(), goodCookie({ cid: C }), V, d);
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "Not available." });
  });
  it("returns a preview-host /d/ URL with a short-lived document grant for exactly that file", async () => {
    const { d, calls } = deps((t) => withContact(t) ?? [{ storage_prefix: prefix, file: "document.pdf", filename: "Proposal.pdf" }]);
    const r = await handleDocumentUrl(req(), goodCookie({ cid: C }), V, d);
    expect(r.status).toBe(200);
    const { url } = await r.json();
    const m = url.match(/^https:\/\/preview\.rosably\.com\/d\/([^/]+)$/)!;
    expect(verifyDocGrant(m[1], GRANT_SECRET, NOW)).toEqual({ ok: true, path: `${prefix}/document.pdf`, filename: "Proposal.pdf", exp: NOW / 1000 + 120 });
    expect(calls.at(-1)!.values).toEqual([A, E, C, V]);
    expect(r.headers.get("set-cookie")).toContain(`${COOKIE_NAME}=`);
    expect(JSON.stringify(await (await handleDocumentUrl(req(), goodCookie({ cid: C }), V, d)).json())).not.toContain(prefix);
  });
  it("404s when the stored filename or path is unsafe, and when the database throws", async () => {
    const bad = deps((t) => withContact(t) ?? [{ storage_prefix: prefix, file: "../x.pdf", filename: "a.pdf" }]);
    expect((await handleDocumentUrl(req(), goodCookie({ cid: C }), V, bad.d)).status).toBe(404);
    const boom = deps((t) => { if (t.includes("portal_session")) return [{ ...header, contact_id: C }]; throw new Error("db"); });
    expect((await handleDocumentUrl(req(), goodCookie({ cid: C }), V, boom.d)).status).toBe(404);
  });
});
```

Add to `components/room-pages.test.tsx` (extend the RoomView import with `DocumentCard`):
```tsx
describe("document card", () => {
  it("shows the file name, type and size with a download button and no frame", () => {
    const d = { id: "d", title: "Proposal", description: null, kind: "document" as const, welcome_message: null,
      versions: [{ id: "v", version_no: 1, status: "shared", shared_at: null, created_at: "2026-10-14T12:00:00Z", change_summary: null, screens: [],
        document: { filename: "Proposal.pdf", ext: "pdf", size: 1572864 } }] };
    const html = renderToStaticMarkup(<DocumentCard d={d} onSessionEnded={() => {}} />);
    expect(html).toContain("Proposal.pdf");
    expect(html).toContain("PDF");
    expect(html).toContain("1.5 MB");
    expect(html).toMatch(/<button[^>]*>Download<\/button>/);
    expect(html).not.toContain("<iframe");
  });
});
```

- [ ] **Step 3: Run to verify failure** — `npx vitest run` -> FAIL.

- [ ] **Step 4: Implement**

`lib/queries.ts`:
```ts
export interface DocumentRow { storage_prefix: string; file: string; filename: string }

export async function documentForDownload(q: Q, aid: string, eid: string, cid: string | undefined, versionId: string): Promise<DocumentRow | null> {
  const rows = await q<DocumentRow>`select * from rooms.portal_document_for_download(${aid}::uuid, ${eid}::uuid, ${cid ?? null}::uuid, ${versionId}::uuid)`;
  return rows[0] ?? null;
}
```

`lib/handlers.ts` (add `documentForDownload, type DocumentRow` to the `./queries` import and `signDocGrant` to the `./grant` import):
```ts
// POST — a 2-minute download URL on the preview host for a shared document. The portal never touches
// Storage; the preview host verifies the document grant and streams the file as an attachment.
export async function handleDocumentUrl(req: Request, cookie: string | undefined, versionId: string, d: Deps): Promise<Response> {
  if (!isSameOriginJson(req, d.portalOrigin)) return json({ error: "Not allowed." }, 403);
  if (!UUID.test(versionId)) return json({ error: "Not available." }, 404);
  const sess = await requireSession(cookie, d);
  if (!sess || !sess.row.contact_id) return json({ error: "Session expired." }, 401);
  const renew = { "Set-Cookie": sess.renewed };
  let row: DocumentRow | null;
  try { row = await documentForDownload(d.q, sess.s.aid, sess.s.eid, sess.s.cid, versionId); } catch { return json({ error: "Not available." }, 404, renew); }
  if (!row || typeof row.file !== "string" || typeof row.storage_prefix !== "string") return json({ error: "Not available." }, 404, renew);
  let grant: string;
  try { grant = signDocGrant(`${row.storage_prefix}/${row.file}`, row.filename, d.grantSecret, nowMs(d)); } catch { return json({ error: "Not available." }, 404, renew); }
  return json({ url: `${d.previewUrl}/d/${grant}` }, 200, renew);
}
```

`app/api/room/versions/[id]/document-url/route.ts`:
```ts
import { cookies } from "next/headers";
import { handleDocumentUrl, depsFromEnv } from "@/lib/handlers";
import { COOKIE_NAME } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jar = await cookies();
  return handleDocumentUrl(req, jar.get(COOKIE_NAME)?.value, id, depsFromEnv());
}
```

`components/RoomView.tsx` (add `import { formatBytes } from "@/lib/format";`):
```tsx
// Documents are only ever downloaded (attachment from the preview host), never shown in this page.
export function DocumentCard({ d, onSessionEnded }: { d: Deliverable; onSessionEnded: () => void }) {
  const versions = sortVersions(d.versions);
  const [versionId, setVersionId] = useState(versions[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inFlight = useRef(false);
  const current = versions.find(v => v.id === versionId);

  const download = async () => {
    if (!versionId || inFlight.current) return;
    inFlight.current = true; setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/room/versions/${encodeURIComponent(versionId)}/document-url`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      if (res.status === 401) { onSessionEnded(); return; }
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (typeof data.url !== "string" || !data.url.startsWith("https://")) throw new Error("bad url");
      window.location.assign(data.url);
    } catch {
      setErr("This file isn't available right now.");
    } finally {
      inFlight.current = false; setBusy(false);
    }
  };

  return (
    <section style={card}>
      <h2 style={{ marginTop: 0 }}>{d.title}</h2>
      {d.description && <p>{d.description}</p>}
      {d.welcome_message && <WelcomeNote text={d.welcome_message} />}
      <label htmlFor={`ver-${d.id}`} style={{ fontWeight: 600 }}>Version </label>
      <select id={`ver-${d.id}`} value={versionId} onChange={e => setVersionId(e.target.value)}>
        {versions.map(v => <option key={v.id} value={v.id}>{versionLabel(v)}</option>)}
      </select>
      {current?.change_summary && <p>{current.change_summary}</p>}
      {current?.document && (
        <p style={{ margin: "0.75rem 0 0" }}>
          {current.document.filename} · {current.document.ext.toUpperCase()} · {formatBytes(current.document.size)}
        </p>
      )}
      {err && <p role="alert" style={{ color: "#b42318" }}>{err}</p>}
      <button type="button" disabled={busy} style={{ ...button, padding: "0.5rem 1.25rem", fontSize: "0.95rem" }} onClick={() => { void download(); }}>Download</button>
      <p style={{ fontSize: "0.85rem", color: "#475467" }}>The file downloads to your device; it is never opened inside this page.</p>
    </section>
  );
}
```
and change the list render to `{items?.map(d => d.kind === "document" ? <DocumentCard key={d.id} d={d} onSessionEnded={onSessionEnded} /> : <SolutionCard key={d.id} d={d} onSessionEnded={onSessionEnded} />)}`.

- [ ] **Step 5: Verify** — `npx vitest run`, `npx tsc --noEmit`, `rm -rf .next && npm run build` (routes now include `/api/room/versions/[id]/document-url`).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(room): document downloads via short-lived document grants on the preview host

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Deploy and end-to-end check (Brian + controller)

No new code. Each step needs Brian's explicit go-ahead.

- [ ] **Step 1: Apply the migration** with Supabase MCP `apply_migration` (name `rooms_phase3`) using the Task 1 file. Then re-run the assertion script against production inside `begin; … rollback;` and confirm:
```sql
select (select proowner::regrole::text from pg_proc where proname = 'delete_deliverable') as owner,
       has_function_privilege('anon', 'rooms.portal_document_for_download(uuid,uuid,uuid,uuid)', 'execute') as anon_can_download,
       has_function_privilege('portal_app', 'rooms.portal_list_deliverables(uuid,uuid)', 'execute') as portal_can_list,
       (select file_size_limit from storage.buckets where id = 'room-documents') as limit_bytes;
```
Expected: `postgres`, `false`, `true`, `26214400`. The live portal and dashboard keep working (the change is additive; the deployed portal ignores the new columns).
- [ ] **Step 2: Merge order** (each PR is safe alone after Step 1):
  1. `preview-host` `feat/room-documents` (new `/d/` route only). No new env vars (it already has `ROOM_GRANT_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FRAME_ANCESTORS`).
  2. `dashboard` `feat/rooms-phase3`. No new env vars. Until the portal PR is live, do not Share a document: the old portal would list it as a prototype with an unavailable preview.
  3. `portal` `feat/room-phase3`. No new env vars. Expected side effect: every visitor with a Phase 2 cookie is sent to the friendly expired page once and must re-open their link.
- [ ] **Step 3: End-to-end** (private browser window for the visitor):
  1. Dashboard: upload a small PDF as a new document "Proposal"; it appears as v1 (draft) with a date like `Oct 14, 2026` and a Download button that downloads it.
  2. Upload an `.html` file renamed to `.pdf`: refused with "contents don't match"; no new version row.
  3. Add a welcome message with two lines and `<b>x</b>`; Share v1.
  4. Refresh the room link; the old link now shows the friendly expired page; the new one opens the room.
  5. Portal: the version picker shows `v1 · Oct 14, 2026`; the welcome text shows on two lines with `<b>x</b>` literally; Download saves `Proposal.pdf` (devtools: the response is from `preview.rosably.com/d/…` with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`); the room URL does not change.
  6. Prototype card: the frame fills the window height; only the prototype scrolls inside it.
  7. Dashboard Activity shows the download, the link refresh, and the share.
  8. Session: in devtools, after loading the room, the `__Host-rooms` cookie's `Max-Age` is about 7200 and resets on each click that calls the API.
  9. Delete the "Proposal" deliverable with the inline confirm; it disappears from the portal on reload; Activity shows `Deleted “Proposal”`; in Supabase Storage `room-documents/<engagement>/<deliverable>/` is empty.
  10. A copied document URL older than 2 minutes returns `Forbidden`.

---

## Self-review

**Spec coverage:**
1. Delete deliverable: DB function and order (T1), route + cleanup + UI + inline confirm (T4), Activity line (T9). Work items untouched (no FK; T1 test checks only rooms rows). Events survive (T1 assertion).
2. Refresh link: atomic function (T1), route reusing `generateToken/hashToken/roomLink`, one-time link display (T5), Activity line (T9).
3. Sliding session: `st`, idle 2 h, 8 h cap, link expiry, fail closed for old cookies, cookie re-issued on authenticated API responses (T10; document route in T12). Shared-file check: only `grant.ts` is shared; `session.ts` is portal-only (Global Constraints).
4. Documents: kind/source CHECKs, bucket with size/MIME limits (T1); grants with purpose separation (T2); attachment-only serving (T3); signed upload URL, magic bytes, DB size/MIME check, draft until Share, Brian's download, prototype-request guard (T8); visitor download (T12). Visitors do not upload.
5. Version dates: `created_at` returned by `portal_list_deliverables` (T1), dashboard (T6), portal picker (T11), timezone-tested helpers.
6. Frame height: portal (T11), dashboard preview (T6); residual limitation documented (Decisions 8, code comment).
7. Welcome message: column (T1), PATCH + zod + editor (T7), portal rendering as text, room default stays at top (T11); returned by `portal_list_deliverables` (T1).
Deploy section: T13.

**Placeholder scan:** T8 Step 4 asks for one prototype-request test "following that file's existing stub style" with the exact assertions given, because that test file's stub is not reproduced here; the assertions are fully specified.

**Type consistency:** SQL names and parameters (`p_deliverable, p_actor`; `p_eng, p_access, p_token_hash, p_expires_at`; `p_deliverable, p_upload, p_ext, p_filename, p_change_summary`) match the RPC calls in T4, T5, T8; return columns (`bucket, object_name`; `access_id, expires_at`; `version_id, version_no`; `storage_prefix, file, filename`) match `StorageObjectRef`, the refresh route, the finalize route and `DocumentRow`. `signDocGrant/verifyDocGrant/DOC_TYPES/isSafeDocFilename` are used with the same signatures in T3, T8, T12. `requireSession(...).renewed` is defined in T10 and used in T11 and T12. `Version.created_at`/`document` are defined in T11 and used in T12.

**Review Focus:** each line has tests: disguised files (T8 `sniffDocument`, finalize route; T3 headers), hostile names (T1 SQL loop, T2, T3 `contentDisposition`, T8 sanitizer), old/odd cookies (T10), partial failure and double refresh (T4 route, T1 refresh assertions), markup-like/long welcome text (T7 schema, T11 `WelcomeNote`, T1 CHECK).
