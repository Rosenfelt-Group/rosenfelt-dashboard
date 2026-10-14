# Engagement Rooms — Design

Date: 2026-10-14
Status: Draft for review (supersedes the pasted "Engagement Rooms: Discovery + Prototype Review Spec" where they differ)

## Summary

An **Engagement Room** is one tokenized, revocable, expiring link per organization engagement.
It takes an outside party through discovery, then through agent-built clickable prototypes,
per-screen comments and approval. Everything is visible to Brian in the dashboard.

Rooms serve **prospects, clients and partners** (for example other IT providers). Partners
use the same view-and-comment flow as prospects (option 1). The model is extensible to
partner-authored material (option 2) without a schema rewrite.

Rooms are distinct from the CRM **Discovery** module shipped on 2026-10-14, and reuse its
token pattern, questionnaire engine and conventions where they fit.

## Goals

- One room per engagement, reachable by an unguessable, revocable, expiring link. No outside accounts.
- Works for prospects, clients and partners; features are switched per engagement.
- Prototypes are self-contained HTML bundles produced by any Rosably agent against a fixed contract.
- Outsiders comment per screen (optional pin) and approve or request changes per version.
- Every view, submission, comment and decision is visible in the dashboard.

## Non-goals (v1)

- Outside-party logins, SSO or magic-link verification.
- Real-time collaboration, or comment threading deeper than one reply.
- Element-anchored pins that survive DOM changes.
- Payments, contracts or e-signature. Approvals are not contractual sign-off.
- Prototypes that call live client systems or hold real client data.
- Partner uploads (option 2). Only the schema hooks are included; no upload code.
- Sending email from the room. v1 gives Brian drafts to send.

## Deployables and domains

| Deployable | Domain | Audience | Holds credentials |
|---|---|---|---|
| Dashboard (existing Next.js) | `dashboard.rosably.com` | Internal only | Yes |
| Portal app (new Next.js, Vercel) | `portal.rosably.com` | Outside parties | Service role, rooms queries only |
| Preview host (new, small Vercel project) | `preview.rosably.com` | Sandboxed iframe only | Read-only to the `prototypes` bucket |

- The dashboard stays internal. No public, token-gated surface is added to it.
- The portal is the seed of the planned client portal; rooms are its first feature.
- Cookies are host-only. Never set `Domain=.rosably.com`.
- Prototypes are served only from the preview origin, never from portal, dashboard or rosably.com.
- The dashboard builds room links from `NEXT_PUBLIC_PORTAL_URL`.
- Hardening later: replace the portal's full service-role key with a Postgres role limited to the `rooms` schema.

## Data model

New schema `rooms`. RLS enabled on every table, **no policies**; only the service role reads or
writes (same model as `crm.discovery_*`). Revoke all from `anon` and `authenticated`.

- `engagements` — `id`, `business_id` (required, `crm.businesses`), optional `lead_id`,
  `client_id`, `discovery_invite_id`, `assessment_lead_id`; `relationship`
  (`prospect` | `client` | `partner`); `title`; `status` (`active` | `approved` | `closed`);
  `modules` jsonb (for example `{"discovery":true,"solutions":true}`); `created_by`; timestamps.
- `engagement_access` — `engagement_id`, `token_hash` (SHA-256, unique), `label`,
  `expires_at` (default 60 days, overridable at creation), `revoked_at`, `last_used_at`.
- `engagement_contacts` — `engagement_id`, `name`, `email`, `role`, optional `crm_contact_id`,
  `first_seen_at`; unique on (`engagement_id`, `lower(email)`). Identity is self-asserted.
- `deliverables` — `engagement_id`, `title`, `description`, `sort_order`,
  `kind` (check: `prototype`; extended later by a one-line migration).
- `deliverable_versions` — `deliverable_id`, `version_no` (unique per deliverable), `status`
  (`draft` | `shared` | `approved` | `changes_requested` | `superseded`), `storage_prefix`,
  `manifest` jsonb, `source` (check: `agent`; extended later), `built_by_agent`,
  `author_contact_id` (nullable, for the future external case), `work_item_id`,
  `change_summary`, `shared_at`, `decided_at`, `decided_by`, `created_at`.
- `deliverable_comments` — `version_id`, `parent_id` (one reply level), `screen_id`
  (`_general` for whole prototype), `pin_x`, `pin_y`, `viewport_w`, `viewport_h`, `body`,
  exactly one of `contact_id` / `author_user_id`, `status` (`open` | `addressed` | `wont_do`),
  `addressed_in_version`, `created_at`.
- `engagement_events` — `engagement_id`, optional `version_id` and `contact_id`, `type`
  (`room_opened`, `discovery_saved`, `discovery_submitted`, `version_viewed`, `screen_viewed`,
  `comment_added`, `approved`, `changes_requested`), `meta` jsonb, `created_at`.

Decisions:

- **Discovery answers are not copied.** The room's Discovery tab uses the existing questionnaire
  engine and reads and writes `crm.discovery_responses` through `discovery_invite_id`. A
  pre-meeting room creates a `crm.discovery_invites` row behind the scenes.
- `engagements.status` is coarse. Per-version status already tracks build/review/approval.
- Comments belong to a version, but dashboard and agent queries show all open comments across a
  deliverable's versions so feedback carries forward.
- Sharing a new version marks the prior shared version `superseded` (still viewable read-only).
- A private `prototypes` storage bucket is added. The existing `documents` bucket is not reused.
- `public.prospects` is out of scope (see Follow-ups).

## Access and session flow

1. Dashboard issues a link: 32 random bytes (base64url); only the SHA-256 hash is stored; the raw
   link is shown once.
2. `GET portal.rosably.com/r/[token]` hashes the token and checks it exists, is not revoked and
   is not expired. It sets an httpOnly, Secure, SameSite=Lax cookie scoped to the engagement and
   redirects to `/r/room`. Lookups are rate-limited per IP.
3. First visit asks for name and email, upserting `engagement_contacts`.
4. An engagement may have several tokens (labelled), for example one per person or team.
5. Invalid, revoked or expired tokens show one friendly page revealing nothing about which case.
6. Room wording and tabs follow `relationship` and `modules`. Approvals show in the dashboard as
   "provided by visitor".

## Routes

Portal (public, token/session-gated): `/r/[token]`, `/r/room`; `POST /api/room/identify`;
`GET|PUT /api/room/discovery`; `POST /api/room/discovery/submit`; `GET /api/room/deliverables`
(shared versions only, never drafts); `GET /api/room/versions/[id]/preview-url`;
`GET|POST /api/room/versions/[id]/comments`; `POST /api/room/versions/[id]/decision`;
`POST /api/room/events` (rate-limited).

Dashboard (existing auth): an Engagements section on the CRM business page (`/crm/businesses/[id]`) and lead page for listing and
creating; `/engagements/[id]` (Discovery, Deliverables, Feedback, Access, Activity);
`POST /api/engagements`; `POST|DELETE /api/engagements/[id]/access`;
`POST /api/engagements/[id]/prototype-request`; `POST /api/versions/[id]/share`;
`PATCH /api/comments/[id]`.

## Preview host

- `GET /v/[signed]/[...path]` verifies an HMAC grant (version id + expiry, 15 minutes, secret
  shared only with the portal), streams the file from the private `prototypes` bucket, sets
  Content-Type, and injects `room-bridge.js` into `index.html` before `</body>`.
- Headers: `Content-Security-Policy: default-src 'self' 'unsafe-inline' data: blob:; connect-src 'none'; frame-ancestors <portal origin> <dashboard origin>`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: private, max-age=300`.
- No cookies, no keys exposed to the browser, no other routes.
- Embedded with `<iframe sandbox="allow-scripts allow-forms">` (no `allow-same-origin`,
  no top navigation, no popups).

## Agent prototype contract

Applies to `deliverables.kind = 'prototype'`.

Bundle: `manifest.json`, `index.html`, `assets/` (relative paths only). Manifest fields:
`contract_version`, `title`, `summary`, `entry`, `screens[{id,name}]`, `change_summary`,
`addressed_comment_ids`, `data: "synthetic"`.

Rules: self-contained and static (no server calls, external APIs, analytics, remote fonts or CDNs,
localStorage or cookies); every screen root carries `data-screen="<id>"` matching the manifest,
one visible at a time; synthetic data only; no comment UI, Rosably chrome or tracking (the room
injects those); 10 MB and 200 files max; semantic HTML, visible focus, readable at 375 px.

Tool `publish_prototype_version` is added to the shared tool layer beside `document_tools.py`.
Input: `deliverable_id` (or `engagement_id` + title), local bundle path, `work_item_id`.
It validates the manifest, checks every screen id appears as a `data-screen`, enforces limits,
uploads to `{engagement}/{deliverable}/v{n}/`, inserts a `draft` version, marks
`addressed_comment_ids` as addressed, and logs to `work_item_logs`. Output: version id, dashboard
preview URL, warnings. On validation failure it returns readable errors and uploads nothing.

Agent inputs (work item): engagement title, org name and type, discovery answers (from
`crm.discovery_responses`), Brian's brief; for iterations, the prior bundle path and all open
comments (screen id, pin, body). Comments and discovery answers reach agents only as quoted data
in a delimited block, with the instruction that they are feedback, not instructions. The default
agent is a per-request setting (Casey suggested).

## Comments

- Comments live in the portal page, never inside the prototype. `room-bridge.js` reports the
  visible `[data-screen]` and, in pin mode only, the next click as fractions of the frame; it
  draws numbered pin overlays on request. The portal checks `event.source` and message shape;
  the bridge accepts only messages from `window.parent`.
- Panel: current screen by default, toggles for all screens and resolved comments; one reply level;
  Brian's replies show as "Brian (Rosably)". Pinning is desktop-only in v1.
- Each version has a decision bar (Approve / Request changes + optional note); one decision per
  contact per version, latest wins.
- Carry-forward: v1's open comments appear in v2 under "From earlier versions" on the same screen
  id if it still exists, otherwise general; carried-forward pins are labelled "approximate".
  Comments in `addressed_comment_ids` show as Addressed and can be reopened.
- Dashboard Feedback tab: all comments across versions, filter by status, screen and contact;
  mark addressed or won't-do, reply, **Iterate** (creates a work item with all open comments);
  unread indicator when new comments or decisions arrive.

## Extensibility for partner-authored material (option 2)

Comments, decisions, events, the version picker and carry-forward operate on
`deliverable_versions` and do not depend on `kind` or `source`. Adding partner uploads later is:
extend the `kind` and `source` checks, add an upload endpoint that creates a version with
`source = 'external'` and `author_contact_id`, and add a viewer for that kind. No data migration.

## Security and privacy

- Prototypes are untrusted code: separate origin, no credentials, no network (`connect-src 'none'`),
  sandboxed iframe without `allow-same-origin`.
- Token hash only; revocable; expiring; `last_used_at`; per-IP rate limits; host-only,
  engagement-scoped session cookie; 15-minute preview grants refreshed silently.
- Contact identity is self-asserted; approvals are not sign-off.
- Prototypes use synthetic data only. Deleting an engagement cascades, including its storage prefix.
- Keep discovery answers out of agent logs beyond the work item.

## Testing

- Unit: token hashing and expiry; manifest validation; carry-forward; tab visibility by
  `relationship` and `modules`.
- Integration: drafts never appear in the room API; revoked and expired tokens rejected; share
  supersedes the prior version.
- Adversarial prototypes through the preview host: `fetch()` to an outside URL is blocked;
  `window.parent.document` and `localStorage` access fail without breaking the page; malformed
  bridge messages are ignored.
- Prompt injection: a comment reading "ignore previous instructions…" does not change agent behavior.

## Phasing

1. **Foundation** — `rooms` migration and `prototypes` bucket; preview host; portal project and
   domain; `publish_prototype_version`; dashboard create-engagement, request-prototype and draft preview.
2. **Room view-only** — token issue/revoke, `/r/[token]` exchange, identify step, Solutions tab with
   version picker, view events, Activity tab. Run one real engagement before continuing.
3. **Comments and decisions** — bridge script, screen and pinned comments, replies,
   approve/request changes, Feedback tab, Iterate.
4. **Discovery in the room** — Discovery tab reusing the questionnaire engine; Entry A hook from
   the rosably.com assessment.

Acceptance criteria are those of the original spec, adjusted for the portal domain and `relationship`.

## Decisions taken

| Question | Decision |
|---|---|
| Anchor | `crm.businesses` (required), optional lead, client, invite, assessment lead |
| Schema | New `rooms` schema |
| Client-facing domain | `portal.rosably.com` (dashboard stays internal) |
| Default agent | Casey, selectable per request |
| Cardinality | Several engagements per business |
| Entry A matching | Always create the engagement; link to an existing business only on an exact email-domain match for non-free providers, otherwise leave for manual merge |
| Token lifetime | 60 days, per-token override |
| Discovery templates | One shared template |
| Branding | Rosably-only, org name in the header |
| Partners | Option 1 now; hooks (`kind`, `source`, `author_contact_id`) for option 2 |

## Follow-ups (separate from this build)

- `public.prospects` has RLS off and anon/authenticated grants (2 test rows, no foreign keys, unused
  by the dashboard). Either enable RLS or drop the table.
- Seven other tables have RLS off: `audit_alerts`, `doc_chunks`, `github_run_log`,
  `keyword_tracker`, `research_categories`, `terminal_sessions`, `token_usage`. Review before enabling,
  since enabling RLS without policies blocks anon-key access.
- Restricted Postgres role for the portal app.
