# Portal Room (Phase 2) — Design

Date: 2026-10-14
Status: Draft for review
Parent: `2026-10-14-engagement-rooms-design.md` (Phase 2 "Room v1, view only"). This spec makes `https://portal.rosably.com/r/<link>` work: an outside party opens a room link, introduces themselves once, and views the prototypes Brian has shared.

## Problem

Dashboard room links point at `portal.rosably.com/r/<token>`, but the portal only has a home page, a health check and a not-found page, so every link currently ends on "We couldn't find that page". Phase 2 delivers the room itself.

## Goals

- A valid link opens the room; an invalid, expired or revoked link shows one friendly page that does not say which.
- The link secret leaves the address bar immediately (exchanged for a session cookie).
- A visitor identifies themselves once (name, email) and then sees a landing page and a **Solutions** view: each deliverable's shared versions, a version picker, the prototype in a sandboxed frame.
- **Drafts are never visible** to the room. Brian publishes to the room with an explicit **Share** action in the dashboard.
- Every open, introduction and view appears in an **Activity** tab in the dashboard.
- **The portal can reach nothing except what the room needs**, even if its code has a bug.

## Non-goals (later phases)

Comments and approval (Phase 3), the Discovery tab (Phase 4), email sending, magic-link verification, rate limiting beyond the platform firewall rule.

## Decision: a dedicated limited database role (Brian, 2026-10-14)

The portal does **not** use the service-role key. It connects as a new Postgres role, `portal_app`, through the Supabase connection pooler (transaction mode, port 6543). That role has **no privileges on any table**. Its only privilege is `EXECUTE` on a small set of `SECURITY DEFINER` functions in the `rooms` schema. Each function takes the caller's `access_id` / `engagement_id` (from the verified session), **re-checks in SQL** that the link is neither revoked nor expired and belongs to that engagement, and returns only the columns the room needs. The access model is therefore enforced by the database, not only by portal code.

Why functions rather than table grants: the `rooms` tables have RLS enabled with no policies. A non-superuser role cannot bypass RLS, so table access would require per-role policies *and* row filters in portal code. Functions give one reviewable place that states exactly what an outside visitor may see and do.

Consequences and rules:
- All functions: `SECURITY DEFINER`, `SET search_path = rooms, pg_temp`, fully schema-qualified references, owned by the migration role.
- **`EXECUTE` is revoked from `PUBLIC`, `anon` and `authenticated` and granted only to `portal_app` and `service_role`.** `rooms` is exposed through the Supabase REST API, so a function left callable by `anon` would be callable with the public key. A migration-time test asserts this.
- `portal_app`: `LOGIN`, `NOBYPASSRLS`, `NOINHERIT`, `CONNECTION LIMIT 20`, `statement_timeout = 5s`, `idle_in_transaction_session_timeout = 5s`; no `CREATE` anywhere; `USAGE` on schema `rooms` only. Brian sets its password in the Supabase dashboard; the connection string lives only in the portal's Vercel environment.
- The portal's database client (`postgres` npm package, `prepare: false`, `max: 1`, SSL required) is the only new dependency.

## Database functions (migration `docs/migrations/2026-10-14_rooms_portal.sql`)

| Function | Purpose |
|---|---|
| `portal_open_room(token_hash text)` | Looks up the hash. If the access exists, is not revoked and not expired: sets `last_used_at`, logs `room_opened`, returns `access_id`, `engagement_id`, `expires_at`, room title, organization name, relationship, modules. Otherwise returns no row. |
| `portal_session(access_id, engagement_id)` | Re-validates on every request (revocation takes effect immediately); returns the header row above plus the visitor's contact if one exists for this session. |
| `portal_identify(access_id, engagement_id, name, email)` | Validates (name 1-100 chars, plausible email, <= 254 chars), upserts the contact (unique per engagement by lower(email)), logs `discovery_saved`-free event `contact_identified`, returns `contact_id`. |
| `portal_list_deliverables(access_id, engagement_id)` | Deliverables of the engagement with **only** versions in status `shared`, `superseded`, `approved`, `changes_requested`; returns ids, titles, version number, status, shared date, change summary, screens (names only from the manifest). Never returns `draft` rows, `storage_prefix` or the raw manifest. |
| `portal_version_for_preview(access_id, engagement_id, version_id)` | Verifies the version belongs to this engagement and is not a draft; returns `storage_prefix` and the manifest `entry` for the server to sign a preview grant; logs `version_viewed` (deduplicated per contact per version per 10 minutes). |
| `portal_log_event(access_id, engagement_id, contact_id, version_id, type, meta)` | Only types `screen_viewed`; validates the contact belongs to the engagement; DB-level throttle of 60 events per access per minute (excess dropped silently); `meta` limited to 1 KB. |

All functions return a generic "no result" for any validation failure; none returns an error message that reveals why.

## Portal behavior

**Routes** (all in the portal app; no other public surface):
- `GET /r/[token]` (route handler): the token must match `^[A-Za-z0-9_-]{43}$` before anything else. Hash it (SHA-256), call `portal_open_room`. No row -> redirect to `/link-expired` (identical for malformed, unknown, revoked, expired). Row -> set the session cookie and `303` redirect to `/room`. The raw token is never logged, never put in a page, never stored.
- `GET /room`: server-rendered. Reads and verifies the cookie, calls `portal_session`. Invalid -> `/link-expired`. No contact yet -> the introduction form. Otherwise the room.
- `GET /link-expired`: friendly page ("This link isn't working. It may have expired or been replaced. Please ask your Rosably contact for a new one." with the home-page button). Same content for every failure.
- `POST /api/room/identify`, `GET /api/room/deliverables`, `GET /api/room/versions/[id]/preview-url`, `POST /api/room/events`: each requires a valid session; mutating calls also require `Origin` to equal the portal origin and `Content-Type: application/json`.

**Session cookie:** name `__Host-rooms`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`. Contents: `{ aid, eid, cid?, exp }` signed with HMAC-SHA256 using a new secret `ROOM_SESSION_SECRET`; `exp` = the earlier of the link's expiry and 8 hours. A valid signature is **not enough**: every request also calls `portal_session`, so a revoked link stops working immediately and a forged or replayed cookie for another engagement is rejected by the database.

**Preview grants:** the portal signs grants with `ROOM_GRANT_SECRET` (the same value as the dashboard and preview host) for the prefix returned by `portal_version_for_preview`. 15-minute TTL; the page refreshes the frame's URL every 10 minutes. The prototype is embedded as `<iframe sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer">` pointing only at `NEXT_PUBLIC_PREVIEW_URL`, with the "untrusted prototype content" label. Never `allow-same-origin`, top-navigation, popups, modals or downloads. `lib/grant.ts` is a third byte-identical copy of the shared grant module.

**Room UI:** a landing view (room title, organization, a relationship-aware welcome, what is waiting: "N prototypes to review" or "Nothing shared yet - we'll let you know") and a Solutions view: deliverable cards, version picker (newest first; older versions labelled "superseded", read-only), the frame, change summary. Mobile-friendly. Plain, calm Rosably styling.

**Security headers (portal):** existing `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `nosniff`; add `Content-Security-Policy: frame-ancestors 'none'; frame-src <preview origin>; base-uri 'none'; object-src 'none'; form-action 'self'`; `Cache-Control: private, no-store` on all room pages and APIs.

**Abuse:** a Vercel Firewall rate-limit rule on `/r/*` and `/api/room/*` per IP (configuration step for Brian). Token guessing (256-bit) is infeasible; failed lookups return identical responses.

## Dashboard changes (Phase 2)

- `POST /api/versions/[id]/share`: draft -> `shared`, `shared_at = now()`, and the engagement's previously shared version of the same deliverable becomes `superseded`, in one transaction. Refuses non-drafts. UI: a **Share with room** button on a draft version (with a confirm step stating who can see it) and an **Unshare** (back to draft) for the latest unviewed version is *out of scope*; sharing is one-way in v1.
- **Activity tab** on the engagement page: reverse-chronological events (room opened, introduced, version viewed) with contact name/email labelled "provided by visitor", plus a contacts list.
- Room link wording on the Access tab: note that the room opens at `/room` after the link is used once; shows `last_used_at`.

## Deployment (Brian)

1. Approve and apply the migration (I write it and dry-run it in a rolled-back transaction with assertions).
2. In Supabase set the password of role `portal_app`; copy the **pooler** connection string, user `portal_app.<project ref>`, port 6543, as `PORTAL_DATABASE_URL`.
3. Portal Vercel (Production only): `PORTAL_DATABASE_URL`, `ROOM_SESSION_SECRET` (new random value), `ROOM_GRANT_SECRET` (same as dashboard), `NEXT_PUBLIC_PREVIEW_URL=https://preview.rosably.com`.
4. Firewall rate-limit rule on the portal for `/r/*` and `/api/room/*`.

## Testing and acceptance

- **Database (dry run in a rolled-back transaction):** each function with valid, revoked, expired, wrong-engagement, wrong-access and draft inputs; assertions that `anon` and `authenticated` cannot execute any function, that `portal_app` cannot `SELECT` any `rooms` or `crm` table, cannot `INSERT/UPDATE/DELETE`, and cannot create objects; throttle and size limits.
- **Portal unit tests:** token shape validation, cookie sign/verify (tampered, expired, wrong engagement), request guards (origin, content type), view-model mapping, error pages identical for all failure kinds (snapshot of status and body).
- **Acceptance (matches the parent spec):** revoked or expired link -> the friendly page; drafts never visible in the room; the dashboard Activity tab shows who opened which version and when.
- Manual end to end: create a room, share a version, open the link in a private window, introduce yourself, view the prototype, revoke the link, reload (expired page).

## Phasing

1. Migration and database tests (needs Brian's approval to apply).
2. Portal: database client, cookie/session, `/r/[token]`, `/room`, identify, Solutions view, expired page, headers.
3. Dashboard: Share action, Activity tab.
4. End-to-end manual test (the comprehensive test).

## Decisions taken

| Question | Decision |
|---|---|
| Portal database access | Dedicated limited role through the pooler, `EXECUTE`-only on `SECURITY DEFINER` functions (Brian) |
| Room path after the exchange | `/room` (the parent spec's `/r/room` would collide with the dynamic route) |
| Publishing to the room | Explicit one-way **Share** in the dashboard |
| Session | Signed host-only cookie plus database re-validation on every request |
| Visitor identity | Self-asserted name and email, labelled as such |
| New dependency | `postgres` (porsager) in the portal only |
