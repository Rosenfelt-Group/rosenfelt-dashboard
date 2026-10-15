# Document preview and "Preview room" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Brian preview an uploaded document in the dashboard, and open a "Preview room" that shows the real portal room page (drafts included) before anything is shared.

**Architecture:** The preview host gets a second, inline-serving document route (`/dp/<grant>`) that reuses the existing document grant. The dashboard mints a short-lived signed preview token; the portal exchanges it for a separate preview cookie and serves the same `RoomView` component in `mode="preview"` from separate `/api/preview/*` endpoints backed by three new read-only database functions that write no events.

**Tech Stack:** Next.js 16 / React 19 / TypeScript / vitest on Vercel; Supabase Postgres (schema `rooms`, SECURITY DEFINER functions, role `portal_app`); private Storage bucket `room-documents`.

**Spec:** `docs/superpowers/specs/2026-10-15-rooms-preview-design.md` (dashboard repo, branch `feat/rooms-preview`).

## Setup (three checkouts, one new branch each, all from `origin/main`)

| Repo | Checkout | New branch |
|---|---|---|
| dashboard | `/home/brian/work/discovery/dashboard-p3` | `feat/rooms-preview` (already created; the spec is committed on it) |
| portal | `/home/brian/work/discovery/portal-p3` | `feat/room-preview` |
| preview-host | `/home/brian/work/discovery/preview-host-docs` | `feat/room-doc-inline` |

For portal and preview-host: `git fetch origin && git checkout -b <branch> origin/main` before Task 2. Each checkout has `node_modules` available; run `npx vitest run` and `npx tsc --noEmit` there.

## Global Constraints

- **`grant.ts` and `grant.test.ts` are byte-identical in all three repos** (`dashboard-p3/src/lib/rooms/`, `portal-p3/lib/`, `preview-host-docs/lib/`). Edit the dashboard copy, then `cp` to the other two and verify with `cmp`. Never edit a copy by hand.
- No new environment variables. Preview tokens use `ROOM_GRANT_SECRET` (already on dashboard, portal, preview-host); the preview cookie uses `ROOM_SESSION_SECRET` (portal).
- Secrets, grants, tokens, signed URLs, file names and paths are never logged. Error strings returned to the browser are fixed strings, never database or Storage text.
- The prototype iframe sandbox stays exactly `allow-scripts allow-forms` (dashboard and portal). Document iframes in the dashboard have **no `sandbox` attribute** (it would disable the PDF viewer) but always `referrerPolicy="no-referrer"`.
- Visitors still only download documents (attachment, `/d/<grant>`); inline viewing is staff-only.
- Preview endpoints and database functions write **no** rows (no `engagement_events`).
- Commit messages end with: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Test-first: write the failing test, see it fail, then implement.

## Review Focus

1. **Cookie confusion:** a visitor cookie must never work on `/api/preview/*`, and the preview cookie must never work on `/api/room/*` or `/room` (tests in Task 6).
2. **Token abuse:** expired, tampered, wrong-kind (prototype grant, document grant) and unknown-engagement tokens must end at `/link-expired` with **no** `Set-Cookie` (Task 2, Task 6).
3. **Inline content safety:** `.md`/`.csv`/`.txt` are served `text/plain; charset=utf-8` with `nosniff`, never HTML; docx/xlsx/pptx get 415 on `/dp`; an HTML file renamed `.pdf` is still sent as `application/pdf` (Task 3).
4. **Zero side effects:** opening a preview, listing, and fetching URLs create no event rows (Task 1 SQL test, Task 6 handler test).
5. **Empty and odd rooms:** a room with no deliverables, a deliverable with no versions, and a draft-only room render a clear message, not a blank page (Task 7).

---

### Task 1: Database — three preview read functions

**Files:**
- Create: `docs/migrations/2026-10-15_rooms_preview.sql`
- Create: `docs/migrations/2026-10-15_rooms_preview_test.sql`

**Interfaces:**
- Produces (all `security definer`, `set search_path = rooms, pg_temp`, EXECUTE for `portal_app` and `service_role` only):
  - `rooms.preview_room(p_eng uuid) returns table (engagement_id uuid, title text, relationship text, org_name text, status text)`
  - `rooms.preview_list_deliverables(p_eng uuid) returns table (deliverable_id uuid, deliverable_title text, description text, kind text, welcome_message text, version_id uuid, version_no int, status text, shared_at timestamptz, created_at timestamptz, change_summary text, screens jsonb, document jsonb)` — same columns as `portal_list_deliverables`, but every status including `draft`
  - `rooms.preview_version(p_eng uuid, p_version uuid) returns table (kind text, storage_prefix text, entry text, file text, filename text)` — prototypes and `source='upload'` documents of that engagement, any status

- [ ] **Step 1: Write the migration**

```sql
-- Engagement Rooms: Preview room read functions (staff preview, drafts included). Additive only:
-- three new functions, no table changes. They take only an engagement id, so the portal (which verifies
-- a signed preview cookie before calling them) is the trust boundary. They never write rows.

create or replace function rooms.preview_room(p_eng uuid)
returns table (engagement_id uuid, title text, relationship text, org_name text, status text)
language plpgsql security definer set search_path = rooms, pg_temp as $$
#variable_conflict use_column
begin
  if p_eng is null then return; end if;
  return query
    select e.id, e.title, e.relationship, b.name, e.status
      from rooms.engagements e
      join crm.businesses b on b.id = e.business_id
     where e.id = p_eng;
end $$;

create or replace function rooms.preview_list_deliverables(p_eng uuid)
returns table (deliverable_id uuid, deliverable_title text, description text, kind text, welcome_message text,
               version_id uuid, version_no int, status text, shared_at timestamptz, created_at timestamptz,
               change_summary text, screens jsonb, document jsonb)
language plpgsql security definer set search_path = rooms, pg_temp as $$
#variable_conflict use_column
begin
  if p_eng is null then return; end if;
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
     order by d.sort_order, d.created_at, v.version_no desc;
end $$;

create or replace function rooms.preview_version(p_eng uuid, p_version uuid)
returns table (kind text, storage_prefix text, entry text, file text, filename text)
language plpgsql security definer set search_path = rooms, pg_temp as $$
#variable_conflict use_column
begin
  if p_eng is null or p_version is null then return; end if;
  return query
    select d.kind, v.storage_prefix,
           case when d.kind = 'prototype' then coalesce(v.manifest->>'entry', 'index.html') end,
           case when d.kind = 'document' then v.manifest->>'file' end,
           case when d.kind = 'document' then v.manifest->>'filename' end
      from rooms.deliverable_versions v
      join rooms.deliverables d on d.id = v.deliverable_id
     where v.id = p_version and d.engagement_id = p_eng
       and (d.kind = 'prototype' or (d.kind = 'document' and v.source = 'upload'));
end $$;

revoke all on function rooms.preview_room(uuid) from public, anon, authenticated;
revoke all on function rooms.preview_list_deliverables(uuid) from public, anon, authenticated;
revoke all on function rooms.preview_version(uuid, uuid) from public, anon, authenticated;

grant execute on function rooms.preview_room(uuid) to portal_app, service_role;
grant execute on function rooms.preview_list_deliverables(uuid) to portal_app, service_role;
grant execute on function rooms.preview_version(uuid, uuid) to portal_app, service_role;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Write the assertion script.** It must start with the SAFETY header, end with the sentinel `raise exception`, and use only ASCII (no invisible characters).

```sql
-- SAFETY: run only as:  begin;  <2026-10-15_rooms_preview.sql>;  <this script>;  rollback;
-- This script writes test data and always ends by raising an exception, so it can never commit.
do $$
declare
  v_biz uuid; v_eng uuid; v_eng2 uuid; v_proto uuid; v_doc uuid; v_pv uuid; v_dv uuid;
  v_prefix text; r record; n int; n_before int; n_after int;
begin
  select id into v_biz from crm.businesses limit 1;
  insert into rooms.engagements (business_id, relationship, title) values (v_biz, 'prospect', 'PV-a') returning id into v_eng;
  insert into rooms.engagements (business_id, relationship, title) values (v_biz, 'client', 'PV-b') returning id into v_eng2;
  insert into rooms.deliverables (engagement_id, title, kind, welcome_message) values (v_eng, 'Proposal', 'document', 'Hi') returning id into v_doc;
  insert into rooms.deliverables (engagement_id, title) values (v_eng, 'App') returning id into v_proto;
  insert into rooms.deliverable_versions (deliverable_id, version_no, status, storage_prefix, manifest)
    values (v_proto, 1, 'draft', v_eng::text || '/' || v_proto::text || '/v1', '{"entry":"app.html","screens":[{"id":"s1","name":"One"}]}') returning id into v_pv;
  v_prefix := v_eng::text || '/' || v_doc::text || '/' || gen_random_uuid()::text;
  insert into rooms.deliverable_versions (deliverable_id, version_no, status, source, storage_prefix, manifest)
    values (v_doc, 1, 'draft', 'upload', v_prefix, '{"kind":"document","file":"document.pdf","filename":"Proposal.pdf","ext":"pdf","size":10}') returning id into v_dv;

  select count(*) into n_before from rooms.engagement_events where engagement_id in (v_eng, v_eng2);

  -- preview_room
  select * into r from rooms.preview_room(v_eng);
  if not found or r.title <> 'PV-a' or r.relationship <> 'prospect' or r.org_name is null or r.status is null then raise exception 'FAIL preview_room header'; end if;
  select count(*) into n from rooms.preview_room(gen_random_uuid());
  if n <> 0 then raise exception 'FAIL preview_room unknown engagement returns rows'; end if;
  select count(*) into n from rooms.preview_room(null);
  if n <> 0 then raise exception 'FAIL preview_room null returns rows'; end if;

  -- preview_list_deliverables: drafts included, scoped to the engagement
  select count(*) into n from rooms.preview_list_deliverables(v_eng);
  if n <> 2 then raise exception 'FAIL list expected 2 rows, got %', n; end if;
  select count(*) into n from rooms.preview_list_deliverables(v_eng) where status = 'draft';
  if n <> 2 then raise exception 'FAIL list must include drafts'; end if;
  select * into r from rooms.preview_list_deliverables(v_eng) where kind = 'document';
  if r.document->>'filename' <> 'Proposal.pdf' or r.welcome_message <> 'Hi' then raise exception 'FAIL list document info'; end if;
  select * into r from rooms.preview_list_deliverables(v_eng) where kind = 'prototype';
  if jsonb_array_length(r.screens) <> 1 or r.document is not null then raise exception 'FAIL list prototype screens'; end if;
  select count(*) into n from rooms.preview_list_deliverables(v_eng2);
  if n <> 0 then raise exception 'FAIL list leaks another engagement'; end if;
  select count(*) into n from rooms.preview_list_deliverables(null);
  if n <> 0 then raise exception 'FAIL list null returns rows'; end if;

  -- preview_version
  select * into r from rooms.preview_version(v_eng, v_pv);
  if not found or r.kind <> 'prototype' or r.entry <> 'app.html' or r.file is not null or r.storage_prefix <> v_eng::text || '/' || v_proto::text || '/v1' then raise exception 'FAIL preview_version prototype'; end if;
  select * into r from rooms.preview_version(v_eng, v_dv);
  if not found or r.kind <> 'document' or r.file <> 'document.pdf' or r.filename <> 'Proposal.pdf' or r.entry is not null or r.storage_prefix <> v_prefix then raise exception 'FAIL preview_version document'; end if;
  select count(*) into n from rooms.preview_version(v_eng2, v_pv);
  if n <> 0 then raise exception 'FAIL preview_version crosses engagements'; end if;
  select count(*) into n from rooms.preview_version(v_eng, gen_random_uuid());
  if n <> 0 then raise exception 'FAIL preview_version unknown version'; end if;
  select count(*) into n from rooms.preview_version(null, v_pv);
  if n <> 0 then raise exception 'FAIL preview_version null engagement'; end if;

  -- no side effects
  select count(*) into n_after from rooms.engagement_events where engagement_id in (v_eng, v_eng2);
  if n_after <> n_before then raise exception 'FAIL preview functions wrote events (% -> %)', n_before, n_after; end if;

  -- privileges
  if not has_function_privilege('portal_app', 'rooms.preview_room(uuid)', 'execute')
     or not has_function_privilege('portal_app', 'rooms.preview_list_deliverables(uuid)', 'execute')
     or not has_function_privilege('portal_app', 'rooms.preview_version(uuid, uuid)', 'execute')
  then raise exception 'FAIL portal_app lacks execute'; end if;
  if has_function_privilege('anon', 'rooms.preview_room(uuid)', 'execute')
     or has_function_privilege('authenticated', 'rooms.preview_list_deliverables(uuid)', 'execute')
     or has_function_privilege('anon', 'rooms.preview_version(uuid, uuid)', 'execute')
  then raise exception 'FAIL anon/authenticated can execute'; end if;

  raise exception 'ALL PREVIEW ASSERTIONS PASSED (rolled back)';
end $$;
```

- [ ] **Step 3: Check the files are ASCII and well-formed.**

Run: `cd /home/brian/work/discovery/dashboard-p3 && grep -nP '[^\x00-\x7F]' docs/migrations/2026-10-15_rooms_preview*.sql; echo "exit $?"`
Expected: no matches (`exit 1`).

- [ ] **Step 4: Build the combined dry-run file (do NOT commit it).**

Run: `cd docs/migrations && { echo "begin;"; cat 2026-10-15_rooms_preview.sql; echo; cat 2026-10-15_rooms_preview_test.sql; echo "rollback;"; } > preview_dry_run.sql`
Expected: file created; it is untracked (listed in `git status` as `??`). The SQL cannot be executed by the agent (the Supabase tool cancels large DDL); Brian runs it in the SQL editor and expects the error `ALL PREVIEW ASSERTIONS PASSED (rolled back)`.

- [ ] **Step 5: Commit**

```bash
git add docs/migrations/2026-10-15_rooms_preview.sql docs/migrations/2026-10-15_rooms_preview_test.sql
git commit -m "feat(rooms): preview read functions for staff room preview

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Preview token in the shared `grant.ts` (all three repos) and the dashboard link helper

**Files:**
- Modify: `src/lib/rooms/grant.ts` (dashboard; then copy to `portal-p3/lib/grant.ts` and `preview-host-docs/lib/grant.ts`)
- Modify: `src/lib/rooms/grant.test.ts` (dashboard; then copy to `portal-p3/lib/grant.test.ts` and `preview-host-docs/lib/grant.test.ts`)
- Modify: `src/lib/rooms/token.ts`, `src/lib/rooms/token.test.ts`

**Interfaces:**
- Produces in `grant.ts`: `PREVIEW_TOKEN_TTL_SEC = 300`; `signPreviewToken(eid: string, secret: string, nowMs?: number, ttlSec?: number): string`; `verifyPreviewToken(token: string, secret: string, nowMs?: number): PreviewTokenResult` where `PreviewTokenResult = { ok: true; eid: string; exp: number } | { ok: false; reason: "malformed" | "bad_signature" | "expired" }`.
- Produces in `token.ts`: `previewRoomLink(token: string): string` → `<portal base>/preview/<token>` (same base resolution as `roomLink`).

- [ ] **Step 1: Write failing tests.** Append to the dashboard `grant.test.ts` (extend its import list with `signPreviewToken, verifyPreviewToken, PREVIEW_TOKEN_TTL_SEC`):

```ts
describe("preview token", () => {
  const EID = "0b6f1c0e-2d3a-4b5c-8d7e-9f0a1b2c3d4e";
  it("round-trips the engagement id", () => {
    const t = signPreviewToken(EID, SECRET, NOW);
    expect(t.startsWith("p1.")).toBe(true);
    expect(verifyPreviewToken(t, SECRET, NOW + 1000)).toEqual({ ok: true, eid: EID, exp: NOW / 1000 + PREVIEW_TOKEN_TTL_SEC });
  });
  it("expires after the ttl", () => {
    const t = signPreviewToken(EID, SECRET, NOW);
    expect(verifyPreviewToken(t, SECRET, NOW + (PREVIEW_TOKEN_TTL_SEC + 1) * 1000)).toEqual({ ok: false, reason: "expired" });
  });
  it("rejects the wrong secret and any tampering", () => {
    const t = signPreviewToken(EID, SECRET, NOW);
    expect(verifyPreviewToken(t, "other", NOW)).toEqual({ ok: false, reason: "bad_signature" });
    const [p, e, x, sig] = t.split(".");
    const other = Buffer.from("1c7a2d1f-3e4b-4c6d-9e8f-0a1b2c3d4e5f").toString("base64url");
    expect(verifyPreviewToken([p, other, x, sig].join("."), SECRET, NOW)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyPreviewToken([p, e, String(Number(x) + 100), sig].join("."), SECRET, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });
  it("is domain-separated from prototype and document grants in both directions", () => {
    const t = signPreviewToken(EID, SECRET, NOW);
    expect(verifyGrant(t, SECRET, NOW).ok).toBe(false);
    expect(verifyDocGrant(t, SECRET, NOW).ok).toBe(false);
    const proto = signGrant(PREVIEW_PREFIX, SECRET, NOW);
    const doc = signDocGrant(`${E}/${D}/${E}/document.pdf`, "a.pdf", SECRET, NOW);
    expect(verifyPreviewToken(proto, SECRET, NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyPreviewToken(doc, SECRET, NOW)).toEqual({ ok: false, reason: "malformed" });
  });
  it("rejects a MAC computed without the domain prefix", () => {
    const payload = `p1.${Buffer.from(EID).toString("base64url")}.${NOW / 1000 + 100}`;
    const bare = createHmac("sha256", SECRET).update(payload).digest("base64url");
    expect(verifyPreviewToken(`${payload}.${bare}`, SECRET, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });
  it("rejects malformed input and refuses to sign bad input", () => {
    for (const bad of ["", "p1", "p1.a.b", "p2.a.1.c", "x".repeat(600), "p1..1.c"]) expect(verifyPreviewToken(bad, SECRET, NOW).ok).toBe(false);
    expect(() => signPreviewToken("not-a-uuid", SECRET, NOW)).toThrow();
    expect(() => signPreviewToken(EID, "", NOW)).toThrow();
    expect(() => signPreviewToken(EID, SECRET, NOW, 0)).toThrow();
    expect(() => signPreviewToken(EID, SECRET, NOW, PREVIEW_TOKEN_TTL_SEC + 1)).toThrow();
  });
});
```
Add `const PREVIEW_PREFIX = PREFIX;` near the other constants (or reuse `PREFIX` directly). Also append to `token.test.ts`:

```ts
describe("previewRoomLink", () => {
  it("uses the portal base and strips a trailing slash", () => {
    process.env.NEXT_PUBLIC_PORTAL_URL = "https://portal.example.com/";
    expect(previewRoomLink("p1.abc.1.sig")).toBe("https://portal.example.com/preview/p1.abc.1.sig");
    delete process.env.NEXT_PUBLIC_PORTAL_URL;
    expect(previewRoomLink("t")).toBe("https://portal.rosably.com/preview/t");
  });
});
```
(import `previewRoomLink` in `token.test.ts`.)

- [ ] **Step 2: Run to verify failure.** Run: `npx vitest run src/lib/rooms/grant.test.ts src/lib/rooms/token.test.ts`. Expected: FAIL (missing exports).

- [ ] **Step 3: Implement in the dashboard `grant.ts`** (append at the end; it reuses the file's existing `UUID`, `b64`, `unb64`, `mac`, `timingSafeEqual`):

```ts
// ---- Preview-room tokens ----
// Shape: "p1" . base64url(engagement id) . expiry . MAC (4 parts), MAC over a domain-prefixed string.
// A prototype grant (3 parts) and a document grant (5 parts, "d1") can never verify as a preview
// token, and a preview token can never verify as either of them.
export const PREVIEW_TOKEN_TTL_SEC = 300;
const PREVIEW_MAC_DOMAIN = "rooms-preview-v1\n";
const UUID_RE = new RegExp(`^${UUID}$`);

export type PreviewTokenResult =
  | { ok: true; eid: string; exp: number }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function signPreviewToken(
  eid: string,
  secret: string,
  nowMs: number = Date.now(),
  ttlSec: number = PREVIEW_TOKEN_TTL_SEC,
): string {
  if (!UUID_RE.test(eid)) throw new Error("invalid engagement id");
  if (!secret) throw new Error("grant secret missing");
  if (!Number.isFinite(nowMs)) throw new Error("invalid nowMs");
  if (!Number.isInteger(ttlSec) || ttlSec < 1 || ttlSec > PREVIEW_TOKEN_TTL_SEC) throw new Error("invalid ttlSec");
  const exp = Math.floor(nowMs / 1000) + ttlSec;
  const payload = `p1.${b64(eid)}.${exp}`;
  return `${payload}.${mac(secret, PREVIEW_MAC_DOMAIN + payload)}`;
}

export function verifyPreviewToken(token: string, secret: string, nowMs: number = Date.now()): PreviewTokenResult {
  if (typeof token !== "string" || token.length === 0 || token.length > 512) return { ok: false, reason: "malformed" };
  if (typeof secret !== "string" || secret.length === 0) return { ok: false, reason: "malformed" };
  if (!Number.isFinite(nowMs)) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "p1") return { ok: false, reason: "malformed" };
  const [, p, expStr, sig] = parts;
  if (!p || !sig || !/^\d{1,12}$/.test(expStr)) return { ok: false, reason: "malformed" };

  const a = Buffer.from(sig);
  const b = Buffer.from(mac(secret, `${PREVIEW_MAC_DOMAIN}p1.${p}.${expStr}`));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad_signature" };

  const exp = Number(expStr);
  if (exp * 1000 <= nowMs) return { ok: false, reason: "expired" };

  const eid = unb64(p);
  if (!UUID_RE.test(eid)) return { ok: false, reason: "malformed" };
  return { ok: true, eid, exp };
}
```
If the file already has a top-level identifier named `UUID_RE`, rename the new one `PREVIEW_UUID_RE` (do not change existing names). And in `token.ts`:

```ts
export function previewRoomLink(token: string): string {
  const base = (process.env.NEXT_PUBLIC_PORTAL_URL ?? "https://portal.rosably.com").replace(/\/$/, "");
  return `${base}/preview/${token}`;
}
```

- [ ] **Step 4: Run to verify pass.** `npx vitest run src/lib/rooms && npx tsc --noEmit`. Expected: all pass.

- [ ] **Step 5: Copy to the other repos and verify byte-identity.**

```bash
cd /home/brian/work/discovery
cp dashboard-p3/src/lib/rooms/grant.ts portal-p3/lib/grant.ts
cp dashboard-p3/src/lib/rooms/grant.ts preview-host-docs/lib/grant.ts
cp dashboard-p3/src/lib/rooms/grant.test.ts portal-p3/lib/grant.test.ts
cp dashboard-p3/src/lib/rooms/grant.test.ts preview-host-docs/lib/grant.test.ts
cmp dashboard-p3/src/lib/rooms/grant.ts portal-p3/lib/grant.ts && cmp dashboard-p3/src/lib/rooms/grant.ts preview-host-docs/lib/grant.ts && cmp dashboard-p3/src/lib/rooms/grant.test.ts portal-p3/lib/grant.test.ts && cmp dashboard-p3/src/lib/rooms/grant.test.ts preview-host-docs/lib/grant.test.ts && echo IDENTICAL
(cd portal-p3 && git checkout -b feat/room-preview origin/main 2>/dev/null || git checkout feat/room-preview; npx vitest run lib/grant.test.ts && npx tsc --noEmit)
(cd preview-host-docs && git checkout -b feat/room-doc-inline origin/main 2>/dev/null || git checkout feat/room-doc-inline; npx vitest run lib/grant.test.ts && npx tsc --noEmit)
```
(Create the portal and preview-host branches **before** copying; the commands above show the branch step after the copy only for brevity — do the checkout first.) Expected: `IDENTICAL`, tests pass in both.

- [ ] **Step 6: Commit in each repo** (message `feat(rooms): preview-room token in shared grant lib`, with the trailer).

---

### Task 3: Preview host — inline document route `/dp/<grant>`

**Files (repo `preview-host-docs`, branch `feat/room-doc-inline`):**
- Modify: `lib/docs.ts`
- Create: `app/dp/[grant]/route.ts`
- Create: `lib/docs-inline.test.ts`

**Interfaces:**
- Consumes: `verifyDocGrant`, `DOC_TYPES`, `DocExt` from `./grant`; `StorageError` from `./storage`; `DocDeps` and `contentDisposition` in `lib/docs.ts`; `parseFrameAncestors` from `lib/ancestors`; `streamDocument` from `lib/storage`.
- Produces: `makeInlineDocHandler(deps: DocDeps & { frameAncestors: string[] }): (grant: string) => Promise<Response>`; `contentDisposition(filename: string, disposition?: "attachment" | "inline")` (default `"attachment"`, so existing callers and tests are unchanged).

- [ ] **Step 1: Write the failing tests** (`lib/docs-inline.test.ts`):

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { makeInlineDocHandler, contentDisposition } from "./docs";
import { signDocGrant } from "./grant";
import { StorageError } from "./storage";

const E = "0b6f1c0e-2d3a-4b5c-8d7e-9f0a1b2c3d4e";
const D = "1c7a2d1f-3e4b-4c6d-9e8f-0a1b2c3d4e5f";
const U = "2d8b3e20-4f5c-4d7e-8f90-1b2c3d4e5f60";
const SECRET = "s".repeat(32);
const NOW = 1_800_000_000_000;
const path = (ext: string) => `${E}/${D}/${U}/document.${ext}`;
const grant = (ext: string, name = `Doc.${ext}`) => signDocGrant(path(ext), name, SECRET, NOW);
const body = (s = "hello") => new Response(s).body!;
const ANC = ["https://dashboard.rosably.com"];
const handler = (stream: (p: string) => Promise<{ body: ReadableStream<Uint8Array>; length: string | null } | null>) =>
  makeInlineDocHandler({ secret: SECRET, streamDocument: stream, now: () => NOW + 1000, frameAncestors: ANC });

afterEach(() => vi.restoreAllMocks());

describe("makeInlineDocHandler", () => {
  it("serves a PDF inline with the viewer-friendly CSP (no sandbox, no default-src)", async () => {
    const stream = vi.fn(async () => ({ body: body("%PDF-1.7"), length: "8" }));
    const r = await handler(stream)(grant("pdf", "Proposal.pdf"));
    expect(r.status).toBe(200);
    expect(stream).toHaveBeenCalledWith(path("pdf"));
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(r.headers.get("content-disposition")).toMatch(/^inline; filename="Proposal\.pdf"/);
    const csp = r.headers.get("content-security-policy")!;
    expect(csp).toBe("frame-ancestors https://dashboard.rosably.com");
    expect(csp).not.toContain("sandbox");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("content-length")).toBe("8");
    expect(r.headers.get("x-frame-options")).toBeNull();
  });
  it("serves images with their type and a locked-down CSP", async () => {
    for (const [ext, type] of [["png", "image/png"], ["jpg", "image/jpeg"]] as const) {
      const r = await handler(async () => ({ body: body("x"), length: null }))(grant(ext));
      expect(r.headers.get("content-type")).toBe(type);
      expect(r.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors https://dashboard.rosably.com");
    }
  });
  it("always serves txt, csv and md as text/plain utf-8, never html or markdown", async () => {
    for (const ext of ["txt", "csv", "md"]) {
      const r = await handler(async () => ({ body: body("<script>alert(1)</script>"), length: null }))(grant(ext));
      expect(r.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });
  it("sends an HTML payload named .pdf as application/pdf (type comes from the extension map)", async () => {
    const r = await handler(async () => ({ body: body("<html><script>alert(1)</script>"), length: null }))(grant("pdf"));
    expect(r.headers.get("content-type")).toBe("application/pdf");
  });
  it("415s office formats without touching Storage", async () => {
    const stream = vi.fn();
    for (const ext of ["docx", "xlsx", "pptx"]) expect((await handler(stream)(grant(ext))).status).toBe(415);
    expect(stream).not.toHaveBeenCalled();
  });
  it("403s a bad, expired or wrong-kind grant without touching Storage", async () => {
    const stream = vi.fn();
    const h = handler(stream);
    expect((await h("garbage")).status).toBe(403);
    expect((await h(grant("pdf").slice(0, -2) + "xx")).status).toBe(403);
    const old = signDocGrant(path("pdf"), "a.pdf", SECRET, NOW - 600_000);
    expect((await h(old)).status).toBe(403);
    expect(stream).not.toHaveBeenCalled();
  });
  it("404s a missing object and 502s a storage failure with a fixed log line", async () => {
    expect((await handler(async () => null)(grant("pdf"))).status).toBe(404);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await handler(async () => { throw new StorageError(500); })(grant("pdf", "Secret Name.pdf"));
    expect(r.status).toBe(502);
    const logged = JSON.stringify(err.mock.calls);
    expect(logged).not.toContain("Secret Name");
    expect(logged).not.toContain(E);
  });
  it("error pages may still be framed by the dashboard, and use 'none' when no ancestors are configured", async () => {
    const r = await handler(async () => null)(grant("pdf"));
    expect(r.headers.get("content-security-policy")).toContain("frame-ancestors https://dashboard.rosably.com");
    const none = await makeInlineDocHandler({ secret: SECRET, streamDocument: async () => null, now: () => NOW + 1000, frameAncestors: [] })("garbage");
    expect(none.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
});

describe("contentDisposition", () => {
  it("defaults to attachment and supports inline", () => {
    expect(contentDisposition("a.pdf")).toMatch(/^attachment; /);
    expect(contentDisposition("a.pdf", "inline")).toMatch(/^inline; filename="a\.pdf"; filename\*=UTF-8''a\.pdf$/);
  });
});
```

- [ ] **Step 2: Run to verify failure.** `npx vitest run lib/docs-inline.test.ts` → FAIL (`makeInlineDocHandler` not exported).

- [ ] **Step 3: Implement.** In `lib/docs.ts` change `contentDisposition` and add the handler:

```ts
export function contentDisposition(filename: string, disposition: "attachment" | "inline" = "attachment"): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\;]/g, "_");
  const utf8 = encodeURIComponent(filename).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

// Inline viewing for the dashboard (staff): the types a browser can show safely. Office formats are
// never served inline. Text types are always text/plain (a .md is NOT rendered, a .csv is not HTML).
const INLINE_TYPES: Partial<Record<DocExt, string>> = {
  pdf: DOC_TYPES.pdf, png: DOC_TYPES.png, jpg: DOC_TYPES.jpg,
  txt: "text/plain; charset=utf-8", csv: "text/plain; charset=utf-8", md: "text/plain; charset=utf-8",
};

export function makeInlineDocHandler(deps: DocDeps & { frameAncestors: string[] }) {
  const ancestors = deps.frameAncestors.length > 0 ? deps.frameAncestors.join(" ") : "'none'";
  // Errors may be framed by the same origins as the file, so the dashboard shows them instead of a blank frame.
  const plainFramed = (status: number, text: string) =>
    new Response(text, {
      status,
      headers: { ...DOC_HEADERS, "Content-Type": "text/plain; charset=utf-8", "Content-Security-Policy": `default-src 'none'; frame-ancestors ${ancestors}` },
    });
  return async function handle(grant: string): Promise<Response> {
    const g = verifyDocGrant(grant, deps.secret, deps.now ? deps.now() : Date.now());
    if (!g.ok) return plainFramed(403, "Forbidden");
    // safe: verifyDocGrant's anchored path regex guarantees the extension is a DocExt
    const ext = g.path.slice(g.path.lastIndexOf(".") + 1) as DocExt;
    const type = INLINE_TYPES[ext];
    if (!type) return plainFramed(415, "This file type can't be previewed.");
    let obj: { body: ReadableStream<Uint8Array>; length: string | null } | null;
    try {
      obj = await deps.streamDocument(g.path);
    } catch (e) {
      // Fixed strings only: never log e.message, the grant, path or filename.
      const what = e instanceof StorageError ? `HTTP ${e.status}` : e instanceof Error ? e.constructor.name : "unknown";
      console.error(`preview-host: inline document storage failure (${what})`);
      return plainFramed(502, "Bad gateway");
    }
    if (!obj) return plainFramed(404, "Not found");
    const headers: Record<string, string> = {
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      // A PDF needs the browser's own viewer, which a restrictive default-src or a sandbox can break;
      // every other inline type is inert data under default-src 'none'.
      "Content-Security-Policy": ext === "pdf" ? `frame-ancestors ${ancestors}` : `default-src 'none'; frame-ancestors ${ancestors}`,
      "Content-Type": type,
      "Content-Disposition": contentDisposition(g.filename, "inline"),
    };
    if (obj.length && /^\d{1,9}$/.test(obj.length)) headers["Content-Length"] = obj.length;
    return new Response(obj.body, { status: 200, headers });
  };
}
```
Create `app/dp/[grant]/route.ts`:

```ts
import { makeInlineDocHandler } from "@/lib/docs";
import { parseFrameAncestors } from "@/lib/ancestors";
import { streamDocument } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ grant: string }> }) {
  const { grant } = await params;
  const secret = process.env.ROOM_GRANT_SECRET ?? "";
  if (!secret) console.error("preview-host: ROOM_GRANT_SECRET is not configured");
  const { origins } = parseFrameAncestors(process.env.FRAME_ANCESTORS);
  if (origins.length === 0) console.error("preview-host: FRAME_ANCESTORS is empty or invalid; embedding will be refused");
  return makeInlineDocHandler({ secret, streamDocument, frameAncestors: origins })(grant);
}
```
Check `next.config.ts` / `app/layout` / any global header rules so `/dp/*` does not inherit a blanket `X-Frame-Options: DENY` or sandbox CSP; if it does, scope those rules to exclude `/dp/*` (add a test or note in the report).

- [ ] **Step 4: Run to verify pass.** `npx vitest run && npx tsc --noEmit`. Expected: all pass (92 existing + new).

- [ ] **Step 5: Commit** (`feat(preview-host): inline document route /dp for staff preview`, with trailer).

---

### Task 4: Dashboard — document Preview button and inline viewer

**Files (dashboard-p3, branch `feat/rooms-preview`):**
- Modify: `src/lib/rooms/doc-limits.ts`, `src/lib/rooms/doc-limits.test.ts`
- Create: `src/app/api/versions/[id]/doc-preview/route.ts`, `src/app/api/versions/[id]/doc-preview/route.test.ts`
- Modify: `src/app/(dashboard)/engagements/[id]/page.tsx`

**Interfaces:**
- Produces: `PREVIEWABLE_DOC_EXTS`, `canPreviewDoc(ext: unknown): boolean` in `doc-limits.ts` (no imports there; it is used by a client component). `GET /api/versions/[id]/doc-preview` → `{ url: string }` (`<preview>/dp/<grant>`) or `{ error }` with 400/404/500.
- Consumes: `signDocGrant`, `DOC_EXTS`, `isSafeDocFilename` from `@/lib/rooms/grant`; `docExt` from `@/lib/rooms/documents`.

- [ ] **Step 1: Failing tests.** `doc-limits.test.ts`:

```ts
describe("canPreviewDoc", () => {
  it("allows pdf, png, jpg, txt, csv, md (any case) and refuses office formats and junk", () => {
    for (const e of ["pdf", "PNG", "jpg", "txt", "csv", "md"]) expect(canPreviewDoc(e)).toBe(true);
    for (const e of ["docx", "xlsx", "pptx", "html", "", undefined, null, 5]) expect(canPreviewDoc(e)).toBe(false);
  });
});
```
`doc-preview/route.test.ts` (mock style identical to `download/route.test.ts`; stub `process.env.ROOM_GRANT_SECRET = "s".repeat(32)` and `NEXT_PUBLIC_PREVIEW_URL = "https://preview.test"` in `beforeEach`):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { verifyDocGrant } from "@/lib/rooms/grant";

const s = vi.hoisted(() => ({ row: { data: null as unknown, error: null as unknown } }));
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: { schema: () => ({ from: () => { const b: Record<string, unknown> = {}; b.select = () => b; b.eq = () => b; b.maybeSingle = async () => s.row; return b; } }) },
}));
import { GET } from "./route";

const V = "44444444-4444-4444-8444-444444444444";
const PREFIX = "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333";
const SECRET = "s".repeat(32);
const call = (id = V) => GET(new NextRequest(`https://d.test/api/versions/${id}/doc-preview`), { params: Promise.resolve({ id }) });
const row = (file: string, filename: string, source = "upload") => ({ data: { storage_prefix: PREFIX, source, manifest: { file, filename } }, error: null });

beforeEach(() => {
  process.env.ROOM_GRANT_SECRET = SECRET;
  process.env.NEXT_PUBLIC_PREVIEW_URL = "https://preview.test/";
  s.row = row("document.pdf", "Proposal.pdf");
});

describe("GET versions/[id]/doc-preview", () => {
  it("returns a /dp URL whose grant is bound to the object path and display name", async () => {
    const r = await call();
    expect(r.status).toBe(200);
    const { url } = await r.json();
    expect(url.startsWith("https://preview.test/dp/")).toBe(true);
    const g = verifyDocGrant(url.slice("https://preview.test/dp/".length), SECRET);
    expect(g).toMatchObject({ ok: true, path: `${PREFIX}/document.pdf`, filename: "Proposal.pdf" });
  });
  it("falls back to the stored file name when the manifest name is unsafe", async () => {
    s.row = row("document.pdf", 'a"\r\nb.pdf');
    const { url } = await (await call()).json();
    expect(verifyDocGrant(url.split("/dp/")[1], SECRET)).toMatchObject({ ok: true, filename: "document.pdf" });
  });
  it("refuses office formats with a helpful message", async () => {
    s.row = row("document.docx", "Plan.docx");
    const r = await call();
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/can't be previewed/i);
  });
  it("404s a missing version, a non-upload version, a bad id and a bad manifest file", async () => {
    s.row = { data: null, error: null };
    expect((await call()).status).toBe(404);
    s.row = row("document.pdf", "x.pdf", "agent");
    expect((await call()).status).toBe(404);
    expect((await call("nope")).status).toBe(400);
    s.row = row("../../etc/passwd", "x.pdf");
    expect((await call()).status).toBe(404);
  });
  it("500s with a fixed message when the grant secret is missing", async () => {
    delete process.env.ROOM_GRANT_SECRET;
    const r = await call();
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("SECRET=");
  });
});
```

- [ ] **Step 2: Run to verify failure** (`npx vitest run src/lib/rooms/doc-limits.test.ts "src/app/api/versions/[id]/doc-preview"`).

- [ ] **Step 3: Implement.** `doc-limits.ts` (append):

```ts
// Types the dashboard can show inline (served by the preview host /dp route). Office formats are download-only.
export const PREVIEWABLE_DOC_EXTS = ["pdf", "png", "jpg", "txt", "csv", "md"] as const;
export const canPreviewDoc = (ext: unknown): boolean =>
  typeof ext === "string" && (PREVIEWABLE_DOC_EXTS as readonly string[]).includes(ext.toLowerCase());
```
`doc-preview/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { docExt } from "@/lib/rooms/documents";
import { DOC_EXTS, isSafeDocFilename, signDocGrant } from "@/lib/rooms/grant";
import { canPreviewDoc } from "@/lib/rooms/doc-limits";

const FILE_RE = new RegExp(`^document\\.(?:${DOC_EXTS.join("|")})$`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET — a preview URL (120 s grant on the preview host's inline /dp route) for a document version of any
// status. Dashboard only (the middleware requires a session). Office formats are download-only.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid version id." }, { status: 400 });
  const secret = process.env.ROOM_GRANT_SECRET;
  if (!secret) return NextResponse.json({ error: "ROOM_GRANT_SECRET is not configured" }, { status: 500 });
  const { data: v } = await supabaseAdmin.schema("rooms").from("deliverable_versions")
    .select("storage_prefix, source, manifest").eq("id", id).maybeSingle();
  const file = v?.manifest?.file;
  if (!v || v.source !== "upload" || typeof file !== "string" || !FILE_RE.test(file)) return NextResponse.json({ error: "Document not found." }, { status: 404 });
  const ext = docExt(file);
  if (!ext || !canPreviewDoc(ext)) return NextResponse.json({ error: "This file type can't be previewed. Download it instead." }, { status: 400 });
  const name = isSafeDocFilename(v.manifest.filename) && docExt(v.manifest.filename) === ext ? v.manifest.filename : file;
  let grant: string;
  try { grant = signDocGrant(`${v.storage_prefix}/${file}`, name, secret); }
  catch { return NextResponse.json({ error: "Could not create a preview link." }, { status: 500 }); }
  const base = (process.env.NEXT_PUBLIC_PREVIEW_URL ?? "https://preview.rosably.com").replace(/\/$/, "");
  return NextResponse.json({ url: `${base}/dp/${grant}` });
}
```
`page.tsx`: (a) add `ext?: string` to `Version.manifest`; import `canPreviewDoc` from `@/lib/rooms/doc-limits`; (b) add state `const [docPreview, setDocPreview] = useState<{ versionId: string; url: string } | null>(null);` next to `previewUrl`; (c) add the handler beside `preview`:

```tsx
const docPreviewOpen = (versionId: string) => guarded("docpreview", async () => {
  const r = await fetchJson<{ url: string }>(`/api/versions/${versionId}/doc-preview`);
  if (r.ok) { setPreviewUrl(null); setDocPreview({ versionId, url: r.data.url }); }
  else setMsg(r.error);
});
```
(d) in `preview` set `setDocPreview(null)` on success, and in `deleteDeliverable` call `setDocPreview(null)` where `setPreviewUrl(null)` is called; (e) in the version row, replace the upload/Download branch with:

```tsx
{v.source === "upload" ? (
  <>
    {canPreviewDoc(v.manifest?.ext) && (
      <button disabled={!!pending} onClick={() => docPreviewOpen(v.id)} className="text-brand-orange disabled:opacity-50">Preview</button>
    )}
    <button disabled={!!pending} onClick={() => download(v.id)} className="text-brand-orange disabled:opacity-50">Download</button>
  </>
) : <button disabled={!!pending} onClick={() => preview(v.id)} className="text-brand-orange disabled:opacity-50">Preview</button>}
```
(f) below the existing prototype `previewUrl` block add:

```tsx
{docPreview && (
  <>
    <div className="flex flex-wrap items-center gap-3 mb-1">
      <p className="text-xs text-brand-muted">Document preview. The link lasts about two minutes; use Reload if it stops loading.</p>
      <button disabled={!!pending} onClick={() => docPreviewOpen(docPreview.versionId)} className="text-xs text-brand-orange disabled:opacity-50">Reload preview</button>
      <button onClick={() => setDocPreview(null)} className="text-xs text-brand-muted">Close</button>
    </div>
    {/* No sandbox attribute: it would disable the browser's PDF viewer. The frame is a separate,
        cookie-less origin that only this site may embed. */}
    <iframe src={docPreview.url} referrerPolicy="no-referrer" title="Document preview"
      className="w-full h-[calc(100dvh-8rem)] min-h-[480px] border border-brand-border rounded" />
  </>
)}
```
Verify the engagement GET already returns `manifest` whole (it selects `manifest` in `versions:deliverable_versions(...)`; `ext` is written to the manifest by `rooms.add_document_version`). Check `next.config.ts`/`src/middleware.ts` for any `frame-src`/CSP that would block `https://preview.rosably.com` in a frame; the prototype iframe already loads from there, so none is expected.

- [ ] **Step 4: Verify.** `npx vitest run && npx tsc --noEmit && npx next lint` if a lint script exists. Expected: all pass.

- [ ] **Step 5: Commit** (`feat(rooms): preview uploaded documents in the dashboard`, with trailer).

---

### Task 5: Dashboard — "Preview room" API and button

**Files (dashboard-p3):**
- Create: `src/app/api/engagements/[id]/room-preview/route.ts`, `src/app/api/engagements/[id]/room-preview/route.test.ts`
- Modify: `src/app/(dashboard)/engagements/[id]/page.tsx`

**Interfaces:**
- Consumes: `signPreviewToken` (Task 2, `@/lib/rooms/grant`), `previewRoomLink` (Task 2, `@/lib/rooms/token`).
- Produces: `POST /api/engagements/[id]/room-preview` → `200 { url }` where `url` is `<portal>/preview/<token>`; 400 bad id, 404 unknown engagement, 500 missing secret.

- [ ] **Step 1: Failing test** (`room-preview/route.test.ts`):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { verifyPreviewToken } from "@/lib/rooms/grant";

const s = vi.hoisted(() => ({ eng: { data: null as unknown, error: null as unknown } }));
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: { schema: () => ({ from: () => { const b: Record<string, unknown> = {}; b.select = () => b; b.eq = () => b; b.maybeSingle = async () => s.eng; return b; } }) },
}));
import { POST } from "./route";

const ENG = "11111111-1111-4111-8111-111111111111";
const SECRET = "s".repeat(32);
const call = (id = ENG) => POST(new NextRequest(`https://d.test/api/engagements/${id}/room-preview`, { method: "POST" }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  process.env.ROOM_GRANT_SECRET = SECRET;
  process.env.NEXT_PUBLIC_PORTAL_URL = "https://portal.test";
  s.eng = { data: { id: ENG }, error: null };
});

describe("POST engagements/[id]/room-preview", () => {
  it("returns a portal /preview URL with a 5-minute token bound to the engagement", async () => {
    const r = await call();
    expect(r.status).toBe(200);
    const { url } = await r.json();
    expect(url.startsWith("https://portal.test/preview/p1.")).toBe(true);
    expect(verifyPreviewToken(url.split("/preview/")[1], SECRET)).toMatchObject({ ok: true, eid: ENG });
  });
  it("404s an unknown engagement, 400s a bad id, 500s without the secret", async () => {
    s.eng = { data: null, error: null };
    expect((await call()).status).toBe(404);
    expect((await call("nope")).status).toBe(400);
    s.eng = { data: { id: ENG }, error: null };
    delete process.env.ROOM_GRANT_SECRET;
    expect((await call()).status).toBe(500);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** `room-preview/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { signPreviewToken } from "@/lib/rooms/grant";
import { previewRoomLink } from "@/lib/rooms/token";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// POST — mint a 5-minute link that opens the portal's staff preview of this room (drafts included).
// Dashboard only (the middleware requires a session). The token is never logged or stored.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  const secret = process.env.ROOM_GRANT_SECRET;
  if (!secret) return NextResponse.json({ error: "ROOM_GRANT_SECRET is not configured" }, { status: 500 });
  const { data: eng } = await supabaseAdmin.schema("rooms").from("engagements").select("id").eq("id", id).maybeSingle();
  if (!eng) return NextResponse.json({ error: "Engagement not found" }, { status: 404 });
  let token: string;
  try { token = signPreviewToken(id, secret); }
  catch { return NextResponse.json({ error: "Could not create the preview link." }, { status: 500 }); }
  return NextResponse.json({ url: previewRoomLink(token) }, { headers: { "Cache-Control": "private, no-store" } });
}
```
(The UUID regex here is lowercase-only on purpose: `signPreviewToken` requires lowercase.)

In `page.tsx`, add next to the other handlers and put a "Preview room" button in the page header next to the engagement title (search for where `detail.engagement.title` is rendered):

```tsx
// window.open must run synchronously inside the click, or the browser blocks it as a pop-up.
const openRoomPreview = () => {
  const w = window.open("", "_blank");
  if (!w) { setMsg("Your browser blocked the new tab. Allow pop-ups for this site and try again."); return; }
  w.opener = null;
  void guarded("room-preview", async () => {
    const r = await fetchJson<{ url: string }>(`/api/engagements/${id}/room-preview`, { method: "POST" });
    if (!r.ok) { w.close(); setMsg(r.error); return; }
    w.location.href = r.data.url;
  });
};
```
```tsx
<button disabled={!!pending} onClick={openRoomPreview} className="px-3 py-1.5 text-sm rounded border border-brand-border disabled:opacity-50">Preview room</button>
```

- [ ] **Step 4: Verify.** `npx vitest run && npx tsc --noEmit`. Expected: all pass.

- [ ] **Step 5: Commit** (`feat(rooms): Preview room button and token API`, with trailer).

---

### Task 6: Portal — preview session, queries, handlers and routes

**Files (repo `portal-p3`, branch `feat/room-preview`):**
- Create: `lib/preview.ts`, `lib/preview.test.ts`, `lib/preview-handlers.ts`, `lib/preview-handlers.test.ts`
- Modify: `lib/queries.ts`, `lib/handlers.ts`
- Create: `app/preview/[token]/route.ts`, `app/api/preview/deliverables/route.ts`, `app/api/preview/versions/[id]/preview-url/route.ts`, `app/api/preview/versions/[id]/document-url/route.ts`

**Interfaces:**
- Consumes: `verifyPreviewToken`, `signGrant`, `signDocGrant` (grant.ts, Task 2); `Deps`, `depsFromEnv` from `lib/handlers.ts`; database functions from Task 1.
- Produces:
  - `lib/preview.ts`: `PREVIEW_COOKIE = "__Host-rooms-preview"`, `PREVIEW_SESSION_SEC = 3600`, `interface PreviewSession { eid: string; exp: number }`, `signPreviewSession(p, secret): string`, `verifyPreviewSession(value: string | undefined, secret: string, nowMs?: number): PreviewSession | null`, `previewCookieHeader(value: string, maxAgeSec: number): string`.
  - `lib/queries.ts`: `interface PreviewRoomRow { engagement_id: string; title: string; relationship: string; org_name: string; status: string }`, `interface PreviewVersionRow { kind: "prototype" | "document"; storage_prefix: string; entry: string | null; file: string | null; filename: string | null }`, `previewRoom(q, eid)`, `previewListDeliverables(q, eid): Promise<DeliverableRow[]>`, `previewVersion(q, eid, versionId)`.
  - `lib/handlers.ts` (refactor, behavior unchanged): export `json`, `expired`, `nowMs`, `entryPath`, `downloadName`, and a new `groupDeliverables(rows: DeliverableRow[])` extracted from `handleDeliverables` (which then calls it).
  - `lib/preview-handlers.ts`: `handlePreviewOpen(token, d)`, `requirePreview(cookie, d): Promise<{ eid: string; row: PreviewRoomRow } | null>`, `handlePreviewDeliverables(cookie, d)`, `handlePreviewUrl(cookie, versionId, d)`, `handlePreviewDocumentUrl(req, cookie, versionId, d)`.

- [ ] **Step 1: Failing tests for the session lib** (`lib/preview.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { signPreviewSession, verifyPreviewSession, previewCookieHeader, PREVIEW_COOKIE, PREVIEW_SESSION_SEC } from "./preview";
import { signSession, verifySession } from "./session";

const E = "1c7a2d1f-3e4b-4c6d-9e8f-0a1b2c3d4e5f";
const A = "0b6f1c0e-2d3a-4b5c-8d7e-9f0a1b2c3d4e";
const SECRET = "s".repeat(32);
const NOW = 1_800_000_000_000;

describe("preview session", () => {
  it("round-trips and expires", () => {
    const v = signPreviewSession({ eid: E, exp: NOW / 1000 + 100 }, SECRET);
    expect(verifyPreviewSession(v, SECRET, NOW)).toEqual({ eid: E, exp: NOW / 1000 + 100 });
    expect(verifyPreviewSession(v, SECRET, NOW + 101_000)).toBeNull();
  });
  it("rejects tampering, the wrong secret, junk, and an exp beyond one hour", () => {
    const v = signPreviewSession({ eid: E, exp: NOW / 1000 + 100 }, SECRET);
    expect(verifyPreviewSession(v, "other", NOW)).toBeNull();
    expect(verifyPreviewSession(v.slice(0, -2) + "xx", SECRET, NOW)).toBeNull();
    for (const bad of [undefined, "", "a", "a.b.c", "x".repeat(2000)]) expect(verifyPreviewSession(bad, SECRET, NOW)).toBeNull();
    const long = signPreviewSession({ eid: E, exp: NOW / 1000 + PREVIEW_SESSION_SEC + 60 }, SECRET);
    expect(verifyPreviewSession(long, SECRET, NOW)).toBeNull();
  });
  it("is not interchangeable with a visitor session, in either direction", () => {
    const pv = signPreviewSession({ eid: E, exp: NOW / 1000 + 100 }, SECRET);
    expect(verifySession(pv, SECRET, NOW)).toBeNull();
    const visitor = signSession({ aid: A, eid: E, st: NOW / 1000 - 10, exp: NOW / 1000 + 100 }, SECRET);
    expect(verifyPreviewSession(visitor, SECRET, NOW)).toBeNull();
  });
  it("builds a __Host- cookie header", () => {
    const h = previewCookieHeader("val", 3600);
    expect(h).toBe(`${PREVIEW_COOKIE}=val; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax`);
    expect(PREVIEW_COOKIE.startsWith("__Host-")).toBe(true);
  });
});
```

- [ ] **Step 2: Implement `lib/preview.ts`:**

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export const PREVIEW_COOKIE = "__Host-rooms-preview";
export const PREVIEW_SESSION_SEC = 3600; // fixed lifetime from the token exchange; never renewed

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Domain-separated from the visitor session MAC, so neither cookie can verify as the other.
const DOMAIN = "rooms-preview-session-v1\n";

export interface PreviewSession { eid: string; exp: number }

const mac = (secret: string, body: string) => createHmac("sha256", secret).update(DOMAIN + body).digest("base64url");

export function signPreviewSession(p: PreviewSession, secret: string): string {
  if (!secret) throw new Error("session secret missing");
  const body = Buffer.from(JSON.stringify({ eid: p.eid, exp: p.exp }), "utf8").toString("base64url");
  return `${body}.${mac(secret, body)}`;
}

export function verifyPreviewSession(value: string | undefined, secret: string, nowMs: number = Date.now()): PreviewSession | null {
  if (typeof value !== "string" || !secret || value.length > 512) return null;
  const parts = value.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(mac(secret, parts[0]));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let p: unknown;
  try { p = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { return null; }
  if (!p || typeof p !== "object") return null;
  const { eid, exp } = p as Record<string, unknown>;
  if (typeof eid !== "string" || !UUID.test(eid)) return null;
  if (typeof exp !== "number" || !Number.isInteger(exp) || exp * 1000 <= nowMs) return null;
  if (exp * 1000 > nowMs + (PREVIEW_SESSION_SEC + 60) * 1000) return null;
  return { eid, exp };
}

export function previewCookieHeader(value: string, maxAgeSec: number): string {
  return `${PREVIEW_COOKIE}=${value}; Path=/; Max-Age=${Math.max(0, Math.floor(maxAgeSec))}; HttpOnly; Secure; SameSite=Lax`;
}
```

- [ ] **Step 3: Queries and handler refactor.** Append to `lib/queries.ts`:

```ts
export interface PreviewRoomRow { engagement_id: string; title: string; relationship: string; org_name: string; status: string }
export interface PreviewVersionRow { kind: "prototype" | "document"; storage_prefix: string; entry: string | null; file: string | null; filename: string | null }

export async function previewRoom(q: Q, eid: string): Promise<PreviewRoomRow | null> {
  const rows = await q<PreviewRoomRow>`select * from rooms.preview_room(${eid}::uuid)`;
  return rows[0] ?? null;
}
export async function previewListDeliverables(q: Q, eid: string): Promise<DeliverableRow[]> {
  return q<DeliverableRow>`select * from rooms.preview_list_deliverables(${eid}::uuid)`;
}
export async function previewVersion(q: Q, eid: string, versionId: string): Promise<PreviewVersionRow | null> {
  const rows = await q<PreviewVersionRow>`select * from rooms.preview_version(${eid}::uuid, ${versionId}::uuid)`;
  return rows[0] ?? null;
}
```
In `lib/handlers.ts` (no behavior change; the existing tests must stay green): export the existing `nowMs`, `json`, `expired`, `entryPath`, `downloadName` (add `export` to the existing declarations) and move the `byId` grouping loop out of `handleDeliverables` into

```ts
export function groupDeliverables(rows: DeliverableRow[]) {
  const byId = new Map<string, { id: string; title: string; description: string | null; kind: string; welcome_message: string | null; versions: unknown[] }>();
  for (const r of rows) {
    /* the existing loop body, unchanged */
  }
  return [...byId.values()];
}
```
so `handleDeliverables` ends with `return json({ deliverables: groupDeliverables(rows) }, 200, { "Set-Cookie": sess.renewed });`.

- [ ] **Step 4: Failing tests for handlers** (`lib/preview-handlers.test.ts`). Reuse the style of `handlers.test.ts` (copy its `deps()` helper that records SQL text; script by function name):

```ts
import { describe, it, expect } from "vitest";
import { handlePreviewOpen, requirePreview, handlePreviewDeliverables, handlePreviewUrl, handlePreviewDocumentUrl } from "./preview-handlers";
import { requireSession, handleDeliverables, type Deps } from "./handlers";
import { signPreviewToken, signGrant, signDocGrant, verifyGrant, verifyDocGrant } from "./grant";
import { signPreviewSession, PREVIEW_COOKIE } from "./preview";
import { signSession, COOKIE_NAME } from "./session";
import type { Q } from "./queries";

const E = "1c7a2d1f-3e4b-4c6d-9e8f-0a1b2c3d4e5f";
const A = "0b6f1c0e-2d3a-4b5c-8d7e-9f0a1b2c3d4e";
const D = "2d8b3e20-4f5c-4d7e-8f90-1b2c3d4e5f60";
const V = "3e9c4f31-5a6d-4e8f-9aa1-2c3d4e5f6071";
const NOW = 1_800_000_000_000;
const SESSION_SECRET = "s".repeat(32);
const GRANT_SECRET = "g".repeat(32);
const ORIGIN = "https://portal.rosably.com";
const room = { engagement_id: E, title: "Intake", relationship: "prospect", org_name: "Her Promise Circle", status: "active" };

function deps(script: (text: string, values: unknown[]) => unknown[] | undefined) {
  const calls: { text: string; values: unknown[] }[] = [];
  const q = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?"); calls.push({ text, values }); return script(text, values) ?? [];
  }) as unknown as Q;
  const d: Deps = { q, sessionSecret: SESSION_SECRET, grantSecret: GRANT_SECRET, previewUrl: "https://preview.rosably.com", portalOrigin: ORIGIN, now: () => NOW };
  return { d, calls };
}
const okDb = (text: string) => (text.includes("preview_room") ? [room] : undefined);
const previewCookie = () => signPreviewSession({ eid: E, exp: NOW / 1000 + 600 }, SESSION_SECRET);
const token = (over: { eid?: string; secret?: string; now?: number } = {}) => signPreviewToken(over.eid ?? E, over.secret ?? GRANT_SECRET, over.now ?? NOW);

describe("handlePreviewOpen", () => {
  it("exchanges a good token for the preview cookie and redirects to /preview", async () => {
    const { d, calls } = deps(okDb);
    const r = await handlePreviewOpen(token(), d);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/preview");
    const c = r.headers.get("set-cookie")!;
    expect(c.startsWith(`${PREVIEW_COOKIE}=`)).toBe(true);
    expect(c).toContain("HttpOnly"); expect(c).toContain("Secure"); expect(c).toContain("Max-Age=3600");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(calls[0].values).toContain(E);
  });
  it("sends bad, expired, wrong-kind and unknown-engagement tokens to /link-expired with no cookie", async () => {
    const { d } = deps(okDb);
    const proto = signGrant(`${E}/${D}/v1`, GRANT_SECRET, NOW);
    const doc = signDocGrant(`${E}/${D}/${V}/document.pdf`, "a.pdf", GRANT_SECRET, NOW);
    for (const t of ["", "garbage", token({ secret: "x".repeat(32) }), token({ now: NOW - 600_000 }), proto, doc, token().slice(0, -2) + "xx"]) {
      const r = await handlePreviewOpen(t, d);
      expect(r.status).toBe(303);
      expect(r.headers.get("location")).toBe("/link-expired");
      expect(r.headers.get("set-cookie")).toBeNull();
    }
    const none = deps(() => []);
    const r2 = await handlePreviewOpen(token(), none.d);
    expect(r2.headers.get("location")).toBe("/link-expired");
    expect(r2.headers.get("set-cookie")).toBeNull();
    const boom = deps(() => { throw new Error("db down"); });
    expect((await handlePreviewOpen(token(), boom.d)).headers.get("location")).toBe("/link-expired");
  });
  it("fails closed when a secret is missing", async () => {
    const { d } = deps(okDb);
    expect((await handlePreviewOpen(token(), { ...d, sessionSecret: "" })).headers.get("location")).toBe("/link-expired");
    expect((await handlePreviewOpen(token(), { ...d, grantSecret: "" })).headers.get("location")).toBe("/link-expired");
  });
});

describe("cookie separation", () => {
  it("a visitor cookie is refused by every preview endpoint, with no draft query run", async () => {
    const visitor = signSession({ aid: A, eid: E, cid: A, st: NOW / 1000 - 10, exp: NOW / 1000 + 600 }, SESSION_SECRET);
    const { d, calls } = deps(okDb);
    expect(await requirePreview(visitor, d)).toBeNull();
    expect((await handlePreviewDeliverables(visitor, d)).status).toBe(401);
    expect((await handlePreviewUrl(visitor, V, d)).status).toBe(401);
    const req = new Request("https://portal.rosably.com/x", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: "{}" });
    expect((await handlePreviewDocumentUrl(req, visitor, V, d)).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
  it("the preview cookie is refused by the visitor session check and visitor deliverables handler", async () => {
    const { d, calls } = deps(okDb);
    expect(await requireSession(previewCookie(), d)).toBeNull();
    expect((await handleDeliverables(previewCookie(), d)).status).toBe(401);
    expect(calls).toHaveLength(0);
    expect(COOKIE_NAME).not.toBe(PREVIEW_COOKIE);
  });
});

describe("handlePreviewDeliverables", () => {
  it("lists drafts in the visitor payload shape and writes nothing", async () => {
    const row = { deliverable_id: D, deliverable_title: "App", description: null, kind: "prototype", welcome_message: "Hi", version_id: V, version_no: 1, status: "draft", shared_at: null, created_at: new Date(NOW).toISOString(), change_summary: null, screens: [{ id: "s1", name: "One" }], document: null };
    const { d, calls } = deps(t => (t.includes("preview_room") ? [room] : t.includes("preview_list_deliverables") ? [row] : undefined));
    const r = await handlePreviewDeliverables(previewCookie(), d);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    const body = await r.json();
    expect(body.deliverables[0]).toMatchObject({ id: D, kind: "prototype", welcome_message: "Hi" });
    expect(body.deliverables[0].versions[0]).toMatchObject({ id: V, status: "draft" });
    expect(calls.some(c => /insert|update|delete/i.test(c.text))).toBe(false);
    expect(r.headers.get("set-cookie")).toBeNull(); // the preview session is never renewed
  });
  it("500s with a fixed message when the database fails", async () => {
    const { d } = deps(t => { if (t.includes("preview_list")) throw new Error("secret_table"); return [room]; });
    const r = await handlePreviewDeliverables(previewCookie(), d);
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("secret_table");
  });
});

describe("handlePreviewUrl and handlePreviewDocumentUrl", () => {
  const proto = { kind: "prototype", storage_prefix: `${E}/${D}/v2`, entry: "app.html", file: null, filename: null };
  const docRow = { kind: "document", storage_prefix: `${E}/${D}/${V}`, entry: null, file: "document.pdf", filename: "Proposal.pdf" };
  const dbWith = (vr: unknown) => deps(t => (t.includes("preview_room") ? [room] : t.includes("preview_version") ? [vr] : undefined));
  const post = () => new Request("https://portal.rosably.com/x", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: "{}" });

  it("returns a prototype grant URL for a draft prototype", async () => {
    const { d } = dbWith(proto);
    const r = await handlePreviewUrl(previewCookie(), V, d);
    expect(r.status).toBe(200);
    const { url } = await r.json();
    expect(url).toMatch(/^https:\/\/preview\.rosably\.com\/v\/[^/]+\/app\.html$/);
    expect(verifyGrant(url.split("/v/")[1].split("/")[0], GRANT_SECRET, NOW)).toMatchObject({ ok: true, prefix: `${E}/${D}/v2` });
  });
  it("returns a document download grant for a draft document", async () => {
    const { d } = dbWith(docRow);
    const r = await handlePreviewDocumentUrl(post(), previewCookie(), V, d);
    expect(r.status).toBe(200);
    const { url } = await r.json();
    expect(verifyDocGrant(url.split("/d/")[1], GRANT_SECRET, NOW)).toMatchObject({ ok: true, path: `${E}/${D}/${V}/document.pdf`, filename: "Proposal.pdf" });
  });
  it("404s the wrong kind, an unknown version and a malformed id; 403s a cross-origin POST", async () => {
    expect((await handlePreviewUrl(previewCookie(), V, dbWith(docRow).d)).status).toBe(404);
    expect((await handlePreviewDocumentUrl(post(), previewCookie(), V, dbWith(proto).d)).status).toBe(404);
    const none = deps(t => (t.includes("preview_room") ? [room] : []));
    expect((await handlePreviewUrl(previewCookie(), V, none.d)).status).toBe(404);
    expect((await handlePreviewUrl(previewCookie(), "nope", dbWith(proto).d)).status).toBe(404);
    const cross = new Request("https://portal.rosably.com/x", { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" });
    expect((await handlePreviewDocumentUrl(cross, previewCookie(), V, dbWith(docRow).d)).status).toBe(403);
  });
});
```

- [ ] **Step 5: Run to verify failure,** then implement `lib/preview-handlers.ts`:

```ts
import { verifyPreviewToken, signGrant, signDocGrant, GRANT_TTL_SEC } from "./grant";
import { PREVIEW_SESSION_SEC, previewCookieHeader, signPreviewSession, verifyPreviewSession } from "./preview";
import { previewRoom, previewListDeliverables, previewVersion, type PreviewRoomRow, type DeliverableRow } from "./queries";
import { groupDeliverables, entryPath, downloadName, json, expired, nowMs, type Deps } from "./handlers";
import { isSameOriginJson } from "./guards";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// GET /preview/<token>: exchange a dashboard-signed token for the separate preview cookie.
export async function handlePreviewOpen(token: string, d: Deps): Promise<Response> {
  if (!d.sessionSecret || !d.grantSecret) return expired();
  const t = verifyPreviewToken(token, d.grantSecret, nowMs(d));
  if (!t.ok) return expired();
  let row: PreviewRoomRow | null;
  try { row = await previewRoom(d.q, t.eid); } catch { return expired(); }
  if (!row) return expired();
  const exp = Math.floor(nowMs(d) / 1000) + PREVIEW_SESSION_SEC;
  const cookie = previewCookieHeader(signPreviewSession({ eid: t.eid, exp }, d.sessionSecret), PREVIEW_SESSION_SEC);
  return new Response(null, {
    status: 303,
    headers: { Location: "/preview", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "Set-Cookie": cookie },
  });
}

export async function requirePreview(cookie: string | undefined, d: Deps): Promise<{ eid: string; row: PreviewRoomRow } | null> {
  const s = verifyPreviewSession(cookie, d.sessionSecret, nowMs(d));
  if (!s) return null;
  try {
    const row = await previewRoom(d.q, s.eid);
    return row ? { eid: s.eid, row } : null;
  } catch { return null; }
}

const ended = () => json({ error: "Preview ended." }, 401);

export async function handlePreviewDeliverables(cookie: string | undefined, d: Deps): Promise<Response> {
  const sess = await requirePreview(cookie, d);
  if (!sess) return ended();
  let rows: DeliverableRow[];
  try { rows = await previewListDeliverables(d.q, sess.eid); } catch { return json({ error: "Not available." }, 500); }
  return json({ deliverables: groupDeliverables(rows) }, 200);
}

export async function handlePreviewUrl(cookie: string | undefined, versionId: string, d: Deps): Promise<Response> {
  if (!UUID.test(versionId)) return json({ error: "Not available." }, 404);
  const sess = await requirePreview(cookie, d);
  if (!sess) return ended();
  let row;
  try { row = await previewVersion(d.q, sess.eid, versionId); } catch { return json({ error: "Not available." }, 404); }
  if (!row || row.kind !== "prototype") return json({ error: "Not available." }, 404);
  let grant: string;
  try { grant = signGrant(row.storage_prefix, d.grantSecret, nowMs(d)); } catch { return json({ error: "Not available." }, 404); }
  return json({ url: `${d.previewUrl}/v/${grant}/${entryPath(row.entry)}`, expiresInSec: GRANT_TTL_SEC }, 200);
}

export async function handlePreviewDocumentUrl(req: Request, cookie: string | undefined, versionId: string, d: Deps): Promise<Response> {
  if (!isSameOriginJson(req, d.portalOrigin)) return json({ error: "Not allowed." }, 403);
  if (!UUID.test(versionId)) return json({ error: "Not available." }, 404);
  const sess = await requirePreview(cookie, d);
  if (!sess) return ended();
  let row;
  try { row = await previewVersion(d.q, sess.eid, versionId); } catch { return json({ error: "Not available." }, 404); }
  if (!row || row.kind !== "document" || typeof row.file !== "string") return json({ error: "Not available." }, 404);
  let grant: string;
  try { grant = signDocGrant(`${row.storage_prefix}/${row.file}`, downloadName(row.file, row.filename), d.grantSecret, nowMs(d)); } catch { return json({ error: "Not available." }, 404); }
  return json({ url: `${d.previewUrl}/d/${grant}` }, 200);
}
```
The exported helpers in `handlers.ts` keep their current signatures (`json(body, status, extra?)`, `expired()`, `nowMs(d)`). Routes (each file follows the existing `app/api/room/...` route pattern: `export const dynamic = "force-dynamic"`, read the cookie with `cookies()`):

`app/preview/[token]/route.ts`:
```ts
import { handlePreviewOpen } from "@/lib/preview-handlers";
import { depsFromEnv } from "@/lib/handlers";
export const dynamic = "force-dynamic";
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handlePreviewOpen(token, depsFromEnv());
}
```
`app/api/preview/deliverables/route.ts`:
```ts
import { cookies } from "next/headers";
import { handlePreviewDeliverables } from "@/lib/preview-handlers";
import { depsFromEnv } from "@/lib/handlers";
import { PREVIEW_COOKIE } from "@/lib/preview";
export const dynamic = "force-dynamic";
export async function GET() {
  const jar = await cookies();
  return handlePreviewDeliverables(jar.get(PREVIEW_COOKIE)?.value, depsFromEnv());
}
```
`app/api/preview/versions/[id]/preview-url/route.ts` (GET → `handlePreviewUrl(cookie, id, depsFromEnv())`) and `.../document-url/route.ts` (POST → `handlePreviewDocumentUrl(req, cookie, id, depsFromEnv())`), same shape as the existing visitor routes with `PREVIEW_COOKIE`.

Check whether the portal has a `middleware.ts` or `next.config` header rules that restrict paths; `/preview/*` and `/api/preview/*` must be reachable and get the same security headers as `/room`.

- [ ] **Step 6: Verify.** `npx vitest run && npx tsc --noEmit`. Expected: all 118 existing tests plus the new ones pass.

- [ ] **Step 7: Commit** (`feat(portal): staff room preview session, endpoints and queries`, with trailer).

---

### Task 7: Portal — `RoomView` preview mode and the `/preview` page

**Files (portal-p3):**
- Modify: `components/RoomView.tsx`
- Create: `app/preview/page.tsx`
- Modify: `components/room-pages.test.tsx` (add tests; keep the existing ones green)

**Interfaces:**
- Consumes: `requirePreview` (Task 6), `PREVIEW_COOKIE`, `depsFromEnv`.
- Produces: `RoomView` gains optional `mode?: "visitor" | "preview"` (default `"visitor"`); `SolutionCard`, `DocumentCard` and `DeliverableList` gain optional `api?: string` (default `"/api/room"`) and `DeliverableList` gains `preview?: boolean`. `versionLabel` appends ` (draft)` for `status === "draft"`.

- [ ] **Step 1: Read `components/room-pages.test.tsx`** and follow its rendering/fetch-mock style. Add failing tests (adapt helper names to the file's existing ones):
  - preview mode fetches `/api/preview/deliverables` (never `/api/room/...`), shows the banner text `Preview — this is what visitors will see once drafts are shared`, and does **not** render "Hello,";
  - a prototype card in preview mode fetches `/api/preview/versions/<id>/preview-url`; a document card POSTs to `/api/preview/versions/<id>/document-url`;
  - `versionLabel` returns `v2 · …(draft)` for a draft and is unchanged for shared/superseded;
  - preview mode with `[]` shows `No deliverables have been added yet.` (visitor mode keeps `Nothing has been shared yet…`); a deliverable whose `versions` is `[]` is not rendered and does not crash;
  - a 401 in preview mode shows `Your preview ended. Use “Preview room” in the dashboard to open it again.` and visitor mode keeps the existing session-ended text.

- [ ] **Step 2: Implement.** In `RoomView.tsx`:
  - `export function versionLabel(...)`: add `${v.status === "draft" ? " (draft)" : ""}` after the superseded suffix.
  - `SolutionCard({ d, onSessionEnded, api = "/api/room" })`: change the fetch to `` `${api}/versions/${encodeURIComponent(versionId)}/preview-url` `` and add `api` to the effect's dependency array.
  - `DocumentCard({ d, onSessionEnded, api = "/api/room" })`: change the fetch to `` `${api}/versions/${encodeURIComponent(versionId)}/document-url` ``.
  - `DeliverableList({ items, onSessionEnded, api = "/api/room", preview = false })`: pass `api` to both cards; empty message: `preview ? "No deliverables have been added yet." : "Nothing has been shared yet. We'll let you know when there's something to review."` (keep the existing apostrophe escaping style).
  - `RoomView({ title, orgName, relationship, contactName, mode = "visitor" })`: `const api = mode === "preview" ? "/api/preview" : "/api/room";` use `` `${api}/deliverables` `` in `load`; render, above the org line when `mode === "preview"`:

```tsx
{mode === "preview" && (
  <p role="status" style={{ background: "#fffaeb", border: "1px solid #fec84b", borderRadius: 8, padding: "0.5rem 0.75rem", margin: "0 0 1rem", color: "#7a2e0e", fontSize: "0.9rem" }}>
    Preview — this is what visitors will see once drafts are shared. Draft versions are marked “(draft)”. Nothing you do here is recorded.
  </p>
)}
```
  show `Hello, {contactName}` only when `contactName` is non-empty (already the case); render the expired message by mode (visitor text unchanged; preview text as above); pass `api` and `preview={mode === "preview"}` to `DeliverableList`.
  Create `app/preview/page.tsx`:

```tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { depsFromEnv } from "@/lib/handlers";
import { requirePreview } from "@/lib/preview-handlers";
import { PREVIEW_COOKIE } from "@/lib/preview";
import { RoomView } from "@/components/RoomView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rosably preview", robots: { index: false, follow: false } };

export default async function PreviewPage() {
  const jar = await cookies();
  const sess = await requirePreview(jar.get(PREVIEW_COOKIE)?.value, depsFromEnv());
  if (!sess) redirect("/link-expired");
  return (
    <RoomView mode="preview" title={sess.row.title} orgName={sess.row.org_name}
      relationship={sess.row.relationship} contactName="" />
  );
}
```
  Do not change the prototype iframe `sandbox` or the document download flow.

- [ ] **Step 3: Verify.** `npx vitest run && npx tsc --noEmit`. Expected: all pass. If `next build` can run in this worktree, run it; otherwise note the symlinked-`node_modules` limitation in the report.

- [ ] **Step 4: Commit** (`feat(portal): preview mode for the room page`, with trailer).

---

### Task 9: Dashboard — Refresh button and "Casey is working" build status

**Files (dashboard-p3, branch `feat/rooms-preview`):**
- Create: `src/lib/rooms/builds.ts`, `src/lib/rooms/builds.test.ts`
- Create: `src/app/api/engagements/[id]/builds/route.ts`, `src/app/api/engagements/[id]/builds/route.test.ts`
- Modify: `src/app/(dashboard)/engagements/[id]/page.tsx`

**Interfaces:**
- Produces in `builds.ts` (no imports, safe for client components):
  - `export const BUILD_CLOSED_STATUSES = ["done", "cancelled", "rejected", "deferred"] as const`
  - `export const BUILD_STALL_MS = 10 * 60 * 1000`
  - `export const BUILD_LOG_LIMIT = 5`
  - `export interface BuildLog { at: string; author: string; type: string; message: string }`
  - `export interface Build { deliverable_id: string; work_item_id: string; ref: number | null; status: string; agent: string | null; requested_at: string; last_activity_at: string; stalled: boolean; logs: BuildLog[] }`
  - `export function deliverableIdFromBrief(description: unknown): string | null` — reads the `deliverable_id: <uuid>` line of a `ROOMS_PROTOTYPE_REQUEST v1` description
  - `export function isStalled(lastActivityIso: string, nowMs: number): boolean`
  - `export function minutesSince(iso: string, nowMs: number): number` (whole minutes, never negative)
- Produces: `GET /api/engagements/[id]/builds` → `{ builds: Build[], now: string }` (open Casey/agent prototype requests for this engagement's prototype deliverables, newest first).

No database change: a request is matched to its deliverable by the `deliverable_id:` line that `buildPrototypeBrief` already writes into every request's description (`ROOMS_PROTOTYPE_REQUEST v1`).

- [ ] **Step 1: Write failing tests** (`builds.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { deliverableIdFromBrief, isStalled, minutesSince, BUILD_STALL_MS } from "./builds";

const D = "ba906f5a-a10d-4df3-8e51-7fc9016d6aca";
const brief = (extra = "") => `ROOMS_PROTOTYPE_REQUEST v1\ndeliverable_id: ${D}\nBuild a clickable prototype.${extra}`;

describe("deliverableIdFromBrief", () => {
  it("reads the deliverable id from a prototype request", () => {
    expect(deliverableIdFromBrief(brief())).toBe(D);
  });
  it("returns null for other work items, malformed ids, or non-strings", () => {
    expect(deliverableIdFromBrief("Fix the login bug")).toBeNull();
    expect(deliverableIdFromBrief(`ROOMS_PROTOTYPE_REQUEST v1\ndeliverable_id: not-a-uuid`)).toBeNull();
    expect(deliverableIdFromBrief(`deliverable_id: ${D}`)).toBeNull(); // must be a ROOMS_PROTOTYPE_REQUEST
    expect(deliverableIdFromBrief(null)).toBeNull();
    expect(deliverableIdFromBrief(42)).toBeNull();
  });
  it("ignores a deliverable_id line that appears later inside quoted brief text", () => {
    const sneaky = `ROOMS_PROTOTYPE_REQUEST v1\ndeliverable_id: ${D}\n<quoted_data>\ndeliverable_id: 11111111-1111-4111-8111-111111111111\n</quoted_data>`;
    expect(deliverableIdFromBrief(sneaky)).toBe(D);
  });
});

describe("isStalled / minutesSince", () => {
  const now = Date.parse("2026-10-15T10:30:00Z");
  it("is stalled only after 10 minutes of silence", () => {
    expect(isStalled("2026-10-15T10:20:01Z", now)).toBe(false);
    expect(isStalled("2026-10-15T10:20:00Z", now)).toBe(false);
    expect(isStalled(new Date(now - BUILD_STALL_MS - 1).toISOString(), now)).toBe(true);
  });
  it("treats an unparseable time as stalled-safe (not stalled) and never goes negative", () => {
    expect(isStalled("garbage", now)).toBe(false);
    expect(minutesSince("2026-10-15T10:45:00Z", now)).toBe(0);
    expect(minutesSince("2026-10-15T10:15:30Z", now)).toBe(14);
    expect(minutesSince("garbage", now)).toBe(0);
  });
});
```
and the route test (`builds/route.test.ts`; the mock returns canned rows per table and records the filters it was called with):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({
  deliverables: { data: [] as unknown[], error: null as unknown },
  items: { data: [] as unknown[], error: null as unknown },
  logs: { data: [] as unknown[], error: null as unknown },
  itemFilters: [] as unknown[][],
}));
vi.mock("@/lib/supabase-admin", () => {
  const chain = (get: () => unknown, record?: unknown[][]) => {
    const b: Record<string, unknown> = {};
    for (const k of ["select", "eq", "like", "not", "in", "order", "limit"]) {
      b[k] = (...a: unknown[]) => { record?.push([k, ...a]); return b; };
    }
    b.then = (res: (v: unknown) => unknown) => Promise.resolve(get()).then(res);
    return b;
  };
  return {
    supabaseAdmin: {
      schema: () => ({ from: () => chain(() => s.deliverables) }),
      from: (t: string) => (t === "work_items" ? chain(() => s.items, s.itemFilters) : chain(() => s.logs)),
    },
  };
});
import { GET } from "./route";

const ENG = "11111111-1111-4111-8111-111111111111";
const D1 = "ba906f5a-a10d-4df3-8e51-7fc9016d6aca";
const D2 = "22222222-2222-4222-8222-222222222222";
const W1 = "563fc43f-f6d6-478a-8478-158f5b09d313";
const call = (id = ENG) => GET(new NextRequest(`https://d.test/api/engagements/${id}/builds`), { params: Promise.resolve({ id }) });
const item = (id: string, did: string, over: Record<string, unknown> = {}) => ({
  id, ref: 1297, title: "Prototype", status: "in_progress", assigned_agent: "casey",
  description: `ROOMS_PROTOTYPE_REQUEST v1\ndeliverable_id: ${did}\nBuild it`, created_at: new Date(Date.now() - 120_000).toISOString(),
  updated_at: new Date(Date.now() - 60_000).toISOString(), ...over,
});
const log = (wid: string, minsAgo: number, message: string) => ({
  work_item_id: wid, created_at: new Date(Date.now() - minsAgo * 60_000).toISOString(), author: "casey", entry_type: "progress", message,
});

beforeEach(() => {
  s.deliverables = { data: [{ id: D1 }], error: null };
  s.items = { data: [item(W1, D1)], error: null };
  s.logs = { data: [log(W1, 1, "Prototype iteration started.")], error: null };
  s.itemFilters = [];
});

describe("GET engagements/[id]/builds", () => {
  it("returns the open request for a prototype deliverable with its latest log and not stalled", async () => {
    const r = await call();
    expect(r.status).toBe(200);
    const { builds, now } = await r.json();
    expect(typeof now).toBe("string");
    expect(builds).toHaveLength(1);
    expect(builds[0]).toMatchObject({ deliverable_id: D1, work_item_id: W1, ref: 1297, status: "in_progress", agent: "casey", stalled: false });
    expect(builds[0].logs[0]).toMatchObject({ author: "casey", type: "progress", message: "Prototype iteration started." });
  });
  it("asks the database only for open prototype requests (closed statuses excluded)", async () => {
    await call();
    const flat = JSON.stringify(s.itemFilters);
    expect(flat).toContain("ROOMS_PROTOTYPE_REQUEST v1");
    for (const st of ["done", "cancelled", "rejected", "deferred"]) expect(flat).toContain(st);
  });
  it("ignores requests for other engagements' deliverables and non-request work items", async () => {
    s.items = { data: [item(W1, D2), item("w3", D1, { description: "Fix the login bug" })], error: null };
    const { builds } = await (await call()).json();
    expect(builds).toEqual([]);
  });
  it("flags a request with no activity for over 10 minutes as stalled, using the latest log time", async () => {
    s.items = { data: [item(W1, D1, { created_at: new Date(Date.now() - 30 * 60_000).toISOString(), updated_at: new Date(Date.now() - 25 * 60_000).toISOString() })], error: null };
    s.logs = { data: [log(W1, 20, "Working on screens")], error: null };
    const { builds } = await (await call()).json();
    expect(builds[0].stalled).toBe(true);
  });
  it("falls back to the work item's own timestamps when it has no logs, and keeps only the latest 5 logs newest first", async () => {
    s.logs = { data: [], error: null };
    expect((await (await call()).json()).builds[0].logs).toEqual([]);
    s.logs = { data: Array.from({ length: 8 }, (_, i) => log(W1, 8 - i, `m${i}`)), error: null };
    const { builds } = await (await call()).json();
    expect(builds[0].logs).toHaveLength(5);
    expect(builds[0].logs[0].message).toBe("m7");
  });
  it("truncates a long log message", async () => {
    s.logs = { data: [log(W1, 1, "x".repeat(2000))], error: null };
    const { builds } = await (await call()).json();
    expect(builds[0].logs[0].message.length).toBeLessThanOrEqual(300);
  });
  it("returns an empty list when there are no prototype deliverables, 400 for a bad id, and a fixed 500 on database errors", async () => {
    s.deliverables = { data: [], error: null };
    expect((await (await call()).json()).builds).toEqual([]);
    expect((await call("nope")).status).toBe(400);
    s.deliverables = { data: [{ id: D1 }], error: null };
    s.items = { data: [], error: { message: "secret_table" } };
    const r = await call();
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("secret_table");
  });
});
```

- [ ] **Step 2: Run to verify failure.** `npx vitest run src/lib/rooms/builds.test.ts "src/app/api/engagements/[id]/builds"` → FAIL (modules missing).

- [ ] **Step 3: Implement `builds.ts`:**

```ts
// No imports: safe to use from client components.
export const BUILD_CLOSED_STATUSES = ["done", "cancelled", "rejected", "deferred"] as const;
export const BUILD_STALL_MS = 10 * 60 * 1000;
export const BUILD_LOG_LIMIT = 5;

export interface BuildLog { at: string; author: string; type: string; message: string }
export interface Build {
  deliverable_id: string; work_item_id: string; ref: number | null; status: string; agent: string | null;
  requested_at: string; last_activity_at: string; stalled: boolean; logs: BuildLog[];
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const HEADER_RE = new RegExp(`^ROOMS_PROTOTYPE_REQUEST v1\\ndeliverable_id: (${UUID})(?:\\n|$)`);

// The id is only read from the line right under the header, never from the quoted brief text further down.
export function deliverableIdFromBrief(description: unknown): string | null {
  if (typeof description !== "string") return null;
  const m = HEADER_RE.exec(description);
  return m ? m[1] : null;
}

export function isStalled(lastActivityIso: string, nowMs: number): boolean {
  const t = Date.parse(lastActivityIso);
  return Number.isFinite(t) && nowMs - t > BUILD_STALL_MS;
}

export function minutesSince(iso: string, nowMs: number): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.floor((nowMs - t) / 60_000)) : 0;
}
```
(Adjust the regex flags only if a listed test needs it; the UUID in the header regex is lowercase because ids come from the database.)

- [ ] **Step 4: Implement the route** (`builds/route.ts`):

```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { BUILD_CLOSED_STATUSES, BUILD_LOG_LIMIT, deliverableIdFromBrief, isStalled, type Build, type BuildLog } from "@/lib/rooms/builds";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MSG_MAX = 300;
const fail = () => NextResponse.json({ error: "Could not load build status." }, { status: 500 });

// GET — open agent prototype requests (work items) for this engagement's prototype deliverables, with
// the agent's latest log lines. Read-only. Dashboard session required by the middleware.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  const nowMs = Date.now();

  const { data: dels, error: dErr } = await supabaseAdmin.schema("rooms").from("deliverables")
    .select("id").eq("engagement_id", id).eq("kind", "prototype");
  if (dErr) return fail();
  const ids = new Set((dels ?? []).map((d: { id: string }) => d.id));
  if (ids.size === 0) return NextResponse.json({ builds: [], now: new Date(nowMs).toISOString() });

  const { data: items, error: wErr } = await supabaseAdmin.from("work_items")
    .select("id, ref, status, assigned_agent, description, created_at, updated_at")
    .eq("work_type", "deliverable")
    .like("description", "ROOMS_PROTOTYPE_REQUEST v1%")
    .not("status", "in", `(${BUILD_CLOSED_STATUSES.join(",")})`)
    .order("created_at", { ascending: false })
    .limit(50);
  if (wErr) return fail();

  const mine = (items ?? [])
    .map((w: Record<string, unknown>) => ({ w, did: deliverableIdFromBrief(w.description) }))
    .filter((x): x is { w: Record<string, unknown>; did: string } => x.did !== null && ids.has(x.did));
  if (mine.length === 0) return NextResponse.json({ builds: [], now: new Date(nowMs).toISOString() });

  const { data: logs, error: lErr } = await supabaseAdmin.from("work_item_logs")
    .select("work_item_id, created_at, author, entry_type, message")
    .in("work_item_id", mine.map(x => x.w.id as string))
    .order("created_at", { ascending: false })
    .limit(200);
  if (lErr) return fail();

  const byItem = new Map<string, BuildLog[]>();
  for (const l of (logs ?? []) as Record<string, unknown>[]) {
    const key = l.work_item_id as string;
    const list = byItem.get(key) ?? [];
    if (list.length < BUILD_LOG_LIMIT) {
      list.push({ at: String(l.created_at), author: String(l.author ?? ""), type: String(l.entry_type ?? ""), message: String(l.message ?? "").slice(0, MSG_MAX) });
      byItem.set(key, list);
    }
  }

  const builds: Build[] = mine.map(({ w, did }) => {
    const wid = w.id as string;
    const lg = byItem.get(wid) ?? [];
    const last = lg[0]?.at ?? String(w.updated_at ?? w.created_at);
    return {
      deliverable_id: did, work_item_id: wid, ref: typeof w.ref === "number" ? w.ref : null,
      status: String(w.status), agent: typeof w.assigned_agent === "string" ? w.assigned_agent : null,
      requested_at: String(w.created_at), last_activity_at: last, stalled: isStalled(last, nowMs), logs: lg,
    };
  });
  return NextResponse.json({ builds, now: new Date(nowMs).toISOString() }, { headers: { "Cache-Control": "private, no-store" } });
}
```

- [ ] **Step 5: Page changes** (`page.tsx`, follow the file's existing patterns and class names):
  1. State: `const [builds, setBuilds] = useState<Build[]>([]); const [updatedAt, setUpdatedAt] = useState<Date | null>(null);` and a loader beside `load`:

```tsx
const loadBuilds = useCallback(async () => {
  const r = await fetchJson<{ builds: Build[] }>(`/api/engagements/${id}/builds`);
  if (r.ok) setBuilds(Array.isArray(r.data.builds) ? r.data.builds : []);
}, [id]);
useEffect(() => { void loadBuilds(); }, [loadBuilds]);
```
  2. Refresh handler used by the button: reloads the deliverables (`load()`), the builds, and the access and activity data using whichever existing loaders the page has; then `setUpdatedAt(new Date())`. Disable the button while running (reuse `guarded`).
  3. Auto-refresh: while `builds.length > 0`, poll every 15 s (only when `document.visibilityState === "visible"`) calling `load()` and `loadBuilds()`; clear the interval in the effect cleanup and when `builds` becomes empty.

```tsx
useEffect(() => {
  if (builds.length === 0) return;
  const t = setInterval(() => {
    if (document.visibilityState === "visible") { void load(); void loadBuilds(); setUpdatedAt(new Date()); }
  }, 15_000);
  return () => clearInterval(t);
}, [builds.length, load, loadBuilds]);
```
  4. Header: a **Refresh** button next to the **Preview room** button and a small `Updated hh:mm:ss` text (`updatedAt?.toLocaleTimeString()`), muted.
  5. Per deliverable (prototype kind only), above its versions list, render one panel per build for that deliverable:

```tsx
{builds.filter(b => b.deliverable_id === d.id).map(b => (
  <div key={b.work_item_id} role="status" className="mb-2 border border-blue-200 bg-blue-50 rounded p-2 text-sm">
    <p>
      <strong>{b.agent ? b.agent.charAt(0).toUpperCase() + b.agent.slice(1) : "The agent"} is working on a new version</strong>
      {" · "}requested {formatVersionDate(b.requested_at)}{" · "}{b.status.replace(/_/g, " ")}
      {b.ref !== null && <>{" · "}<a href={`/work/${b.ref}`} className="underline">work item #{b.ref}</a></>}
    </p>
    {b.stalled && (
      <p className="text-amber-700">No update for {minutesSince(b.last_activity_at, Date.now())} minutes. The agent may be stuck; open the work item to check.</p>
    )}
    {b.logs.length === 0
      ? <p className="text-xs text-brand-muted">No progress notes yet.</p>
      : <ul className="mt-1 space-y-0.5 text-xs">{b.logs.map((l, i) => (
          <li key={i}><span className="text-brand-muted">{formatVersionDate(l.at)}</span> · {l.message}</li>))}</ul>}
  </div>
))}
```
  (`formatVersionDate` is already imported in the page; import `minutesSince` and the `Build` type from `@/lib/rooms/builds`.) Log messages are plain text in React (escaped); never use `dangerouslySetInnerHTML`.

- [ ] **Step 6: Verify.** `npx vitest run && npx tsc --noEmit`. Expected: all pass. The panel and polling are UI-only (no component test harness in this repo); the helper and route tests above are the automated coverage.

- [ ] **Step 7: Commit** (`feat(rooms): Refresh button and Casey build status panel`, with trailer).

---

### Task 8: Deploy and verify (needs Brian's explicit approval for each step)

**Files:** none (operations). The agent never runs the production migration, merges, or deploys without Brian saying so.

- [ ] **Step 1: Dry run (Brian).** Brian pastes `docs/migrations/preview_dry_run.sql` into the Supabase SQL editor. Expected error: `ALL PREVIEW ASSERTIONS PASSED (rolled back)`. Any `FAIL …` message goes back to the Task 1 implementer.
- [ ] **Step 2: Apply the migration (Brian runs `docs/migrations/2026-10-15_rooms_preview.sql` alone in the SQL editor),** then the agent verifies with `execute_sql`: the three functions exist, are executable by `portal_app` and `service_role`, and by neither `anon` nor `authenticated`.
- [ ] **Step 3: Push the three branches and open PRs** (only on Brian's go-ahead). PR bodies state the deploy order and end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- [ ] **Step 4: Merge in this order, each after the previous deploy shows `success`:** preview-host (`/dp`), portal (`/preview`), dashboard (buttons). Merging is Brian's call or needs his explicit instruction. Check each deploy with `gh api repos/Rosenfelt-Group/<repo>/commits/main/status`.
- [ ] **Step 5: Smoke test (Brian, with the agent checking logs):**
  1. Upload a PDF, a PNG, a TXT and a DOCX to a document deliverable. PDF/PNG/TXT show a **Preview** button; the DOCX shows **Download** only.
  2. Click Preview on the PDF: it renders in the frame (if Chrome shows a blank frame or a download, report it; the fallback is an "Open in new tab" button, to be planned separately).
  3. Click **Preview room**: a new tab opens on the portal with the banner, the draft items marked "(draft)", the prototype loads in its frame, and the document's Download works. The dashboard Activity tab shows **no** new events from this.
  4. Open the preview URL again after 5+ minutes: it shows the link-expired page. In the same browser, `/room` still shows the visitor view only after the visitor link is opened (the preview cookie does not grant it).
  5. A visitor link still shows only shared versions.
  6. **Refresh and build status:** request a new prototype version; a blue "is working" panel appears with progress notes and the work-item link, updates every ~15 s, and clears after the new draft version appears; the header **Refresh** button reloads everything and shows "Updated hh:mm:ss".
- [ ] **Step 6: Clean up.** Remove the combined `preview_dry_run.sql`, the extra worktrees, and the SDD workspace once merged and deployed.
