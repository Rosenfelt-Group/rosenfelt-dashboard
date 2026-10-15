# Engagement Rooms: document preview and "Preview room" — design

Status: draft for review (2026-10-15). Repos: rosenfelt-dashboard, portal, preview-host.

## Goal
1. In the dashboard, view an uploaded document (any version, drafts included) without downloading it,
   the way prototypes already have a Preview button.
2. Before sharing anything, open a **Preview room**: the real portal room page showing exactly what a
   visitor will see, including draft versions, without a visitor link and without logging activity.

## Decisions already made (Brian, 2026-10-15)
- Word, Excel and PowerPoint cannot be previewed in a browser; they show "Download to view".
- Room preview = the real portal view in a new tab with a banner; drafts shown and labelled.
- Visitors still only download documents (attachment); inline viewing is dashboard/staff only.

## Part 1 — Document preview (dashboard)

**What previews inline:** pdf, png, jpg (browser viewers); txt, csv, md as plain text (md is NOT rendered).
docx/xlsx/pptx: no preview button, a "Download" button only (the existing download route).

**Preview host: new route `GET /dp/<grant>`** serving the same private-bucket object as `/d/<grant>` but inline:
- Reuses the existing 5-part document grant (`d1…`, 120 s TTL, path/filename bound); no new secret.
  (A visitor download grant opened on `/dp` shows a file they could already download.)
- `Content-Disposition: inline`; Content-Type only from our extension map, except txt/csv/md are always
  `text/plain; charset=utf-8` (never html); `nosniff`, `private, no-store`, `Referrer-Policy: no-referrer`.
- CSP: `default-src 'none'; frame-ancestors <FRAME_ANCESTORS>` for images and text; PDFs get only `frame-ancestors <FRAME_ANCESTORS>` (plan ruling: a restrictive `default-src` can also break the PDF viewer). Deliberately **no `sandbox`**, because a
  sandboxed frame disables Chrome's PDF viewer. The preview host is a separate, cookie-less origin and
  only the dashboard may frame it, so an inline PDF cannot reach dashboard data.
- Same error handling as `/d`: 403 bad grant, 404 missing, 502 storage failure; redirects refused.

**Dashboard:** `GET /api/versions/[id]/doc-preview` (session required by middleware) returns
`{ url: <preview>/dp/<grant> }` for a document version of any status. The versions list shows a
Preview button for previewable types and Download for all. The viewer is an iframe below the list
(`referrerPolicy="no-referrer"`, no `sandbox` attribute, same height as the prototype frame) with a
"Reload preview" button, because the grant expires after 120 s (a long PDF may need a reload).

## Part 2 — Preview room

**Entry:** a "Preview room" button on the engagement page. It POSTs
`/api/engagements/[id]/room-preview` (dashboard session required) which returns a portal URL
`https://portal.rosably.com/preview/<token>`; the click handler opens the tab first, then sets its location
(avoids popup blocking).

**Token:** `p1.<b64 engagement id>.<exp>.<mac>`, HMAC-SHA256 with `ROOM_GRANT_SECRET` (already on dashboard
and portal) under a distinct domain prefix `rooms-preview-v1\n`; TTL 5 minutes. It can never verify as a
prototype grant (3 parts), a document grant (`d1`, 5 parts) or a visitor session. `grant.ts` stays
byte-identical in the three repos (a copy is added to preview-host to keep that invariant).

**Portal:**
- `GET /preview/[token]`: verify, then set cookie `__Host-rooms-preview` (HttpOnly, Secure, SameSite=Lax,
  signed with `ROOM_SESSION_SECRET`, payload `{ eid, exp }`, 1 hour, not renewed) and 303 to `/preview`.
  Bad/expired token → the existing link-expired page.
- A **separate cookie and separate endpoints** (`/api/preview/deliverables`,
  `/api/preview/versions/[id]/preview-url`, `…/document-url`). Visitor endpoints keep accepting only the
  visitor cookie, so a preview cookie can never act as a visitor and vice versa.
- `/preview` renders the same `RoomView`/`DeliverableList` components in `mode="preview"`: banner
  "Preview — visitors can't see this yet", contact shown as "Preview", draft versions labelled "(draft)",
  `noindex`. Everything else (welcome text, dates, frame sizing, Download) is the visitor code path.
- Preview endpoints write **no events** (no `version_viewed` / `document_downloaded`), and require
  no contact/intro form.

**Database (one migration, `portal_app` EXECUTE only, service_role also):**
- `rooms.preview_room(p_eng uuid)` → same columns as `portal_session` (title, relationship, org_name…).
- `rooms.preview_list_deliverables(p_eng uuid)` → same shape as `portal_list_deliverables` but all
  statuses (draft included), plus `status`.
- `rooms.preview_version(p_eng uuid, p_version uuid)` → storage_prefix, entry, file, filename, kind, for
  prototypes and documents of that engagement, any status. No event inserts.
- Access model: these take only an engagement id; the trust boundary is the portal verifying the signed
  preview cookie. This matches how existing portal functions trust the portal's verified cookie, but it
  does mean `portal_app` can read draft metadata of any engagement it names by uuid (uuids are unguessable;
  accepted).

## Out of scope
Visitor inline viewing; Office-format conversion; markdown rendering; renewing the preview cookie;
previewing as a specific contact; commenting/approval.

## Deploy order
Migration → preview-host (`/dp`, grant copy) → dashboard (buttons, two API routes) → portal (preview
routes, banner). The dashboard buttons ship before the portal route exists only if deployed out of order,
so the order is migration, preview-host, portal, then dashboard. The Preview-room button is always shown and
uses the same portal base URL as link sharing (default `https://portal.rosably.com`; plan ruling).

## Risks / things verified at smoke test
- Chrome renders a PDF in an unsandboxed cross-origin iframe under `default-src 'none'` (must be checked
  on the real deploy; fallback is "Open in new tab").
- 120 s grant vs. long PDFs → Reload preview.
- Preview cookie replay: bounded by 1 h expiry and engagement scope; no write capability.

## Tests
Grant/token: sign/verify, domain separation (all four grant kinds cross-rejected), expiry, tamper.
Preview host `/dp`: headers (inline, no sandbox, text → text/plain), 403/404/502. Portal: preview cookie
accepted only by preview endpoints and visitor cookie only by visitor endpoints; no event rows written;
drafts present; banner. DB test script: the three functions, drafts included, zero rows in
`engagement_events` after calls, grants (portal_app yes; anon/authenticated no).
