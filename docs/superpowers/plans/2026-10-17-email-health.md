# Email Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instant Telegram pings, a weekly audit section, and a dashboard health card + Email tab with admin controls (unblock, block, dismiss, resend) for Rosably's Postmark email.

**Architecture:** Postmark webhooks → n8n "Postmark Events" workflow → Supabase `email_events` (deduped) + Telegram ping. The dashboard reads `email_events` and Postmark's API through server routes only; pure rules (`health.ts`, ping rules) are unit-tested. Every send is tagged by source so stats split by sender, and dashboard sends carry Postmark `Metadata` so a bounce can be traced back to its invite for a safe rebuild-resend.

**Tech Stack:** Next.js 16 App Router (TypeScript), vitest, Supabase (service role via `supabaseAdmin`), Postmark REST API, n8n (REST API, `$env`), WordPress mu-plugin (PHP).

**Spec:** `docs/superpowers/specs/2026-10-17-email-health-design.md`

## Global Constraints
- Browser never calls Supabase or Postmark; all Postmark calls in server code with `POSTMARK_SERVER_TOKEN`.
- Read routes: `requirePermission(req, "view_overview")`. Write/action routes: `requirePermission(req, "manage_email")` (new; admin role only, label "Manage Email").
- Resends send as `brian@rosably.com` only; refuse with 503 when `emailProvider() !== "postmark"`.
- Status colour: only **unresolved** events count; percentage rules only when 7-day sends ≥ `MIN_SENDS_FOR_RATES = 50`; `BOUNCE_WARN = 0.02`, `BOUNCE_RED = 0.05`.
- Red: unresolved spam complaint (7d) | bounce rate > 5% (≥50 sends) | Postmark unreachable/401. Amber: unresolved hard bounce (7d) | bounce rate ≥ 2% (≥50 sends) | intake stale (0 events of any kind in 7d while sends > 0). Else green.
- Never offer Unblock when suppression reason is `SpamComplaint`; show "Blocked permanently — this person marked us as spam".
- Pings: plain text, one per newly inserted event row, never on Postmark retries.
- n8n secrets via `$env` only (add to `/docker/n8n/.env` and compose `environment:`, then `docker compose up --force-recreate -d`).
- Migrations: `/opt/rosenfelt/docs/migrations/YYYY-MM-DD-*.sql`, applied with `psql service=rosably`, RLS on, `REVOKE ALL … FROM anon, authenticated`.
- Ship dashboard via branch → PR → Vercel check → merge. Checks: `npx tsc --noEmit`, `npx vitest run`, `npm run build`.

## Review Focus
1. **Postmark webhook retry / duplicate delivery** → exactly one row, one ping. Test: Task 8 dedupe key test + live double-POST in Task 9.
2. **Spam-complaint suppression with an Unblock attempt via API** (UI hidden, but a crafted POST) → 409 with the permanent-block message, no Postmark call. Test in Task 5.
3. **Resend of a room invite whose room is closed or link revoked** → 409, nothing sent, event stays unresolved. Test in Task 6.
4. **Postmark down or token rejected while loading the tab/card** → card shows red "Can't reach Postmark", tab still shows stored events. Test in Task 3 (`postmarkError` input) and Task 4.
5. **Non-admin calling action routes** → 403, no side effects. Test in Task 5.

---

## File Structure
| File | Responsibility |
|---|---|
| `/opt/rosenfelt/docs/migrations/2026-10-17-email-events.sql` | `email_events`, `email_actions` tables |
| `src/lib/email/postmark.ts` (modify) | send: add `Tag`, `Metadata` |
| `src/lib/email/gmail.ts` (modify) | `SendEmailInput` gains `tag?`, `metadata?` (ignored by Gmail) |
| `src/lib/email/postmark-api.ts` | read/manage calls: stats, suppressions, messages |
| `src/lib/email/health.ts` | pure status-colour + summary rules |
| `src/lib/email/events.ts` | `email_events` queries, resolve/dismiss, action log |
| `src/lib/email/resend.ts` | per-source resend dispatcher |
| `src/lib/rooms/send-invite.ts` | room-invite send extracted from the email route |
| `src/lib/permissions.ts` (modify) | `manage_email` |
| `src/app/api/email/health/route.ts` | GET summary for card + tab |
| `src/app/api/email/messages/route.ts`, `.../[id]/route.ts` | GET lookup / details |
| `src/app/api/email/suppressions/route.ts` | GET list, POST block, DELETE unblock |
| `src/app/api/email/events/[id]/dismiss/route.ts`, `.../resend/route.ts` | POST actions |
| `src/components/status/tabs/EmailTab.tsx` | Status → Email tab |
| `src/components/EmailHealthCard.tsx` | Overview card |
| `src/app/(dashboard)/status/page.tsx`, `overview/page.tsx` (modify) | tab + `?tab=`; card |
| `n8n: "Postmark Events"` workflow + `scripts/n8n/postmark-events.code.js` (kept in repo for review/tests) | intake, dedupe, ping |
| `/opt/website/mu-plugins/rosably-postmark-tag.php` | `X-PM-Tag: wordpress` |
| n8n Weekly Agent Audit `uFg21tiyeldNB8n3` | Email delivery section |

---

### Task 1: Database tables

**Files:** Create `/opt/rosenfelt/docs/migrations/2026-10-17-email-events.sql`

**Interfaces — Produces:**
- `public.email_events(id uuid pk default gen_random_uuid(), event_key text unique not null, record_type text not null check in ('Bounce','SpamComplaint','SubscriptionChange','Delivery'), message_id text, recipient text not null, subject text, tag text, source_group text not null default 'other', bounce_type text, description text, inactive bool, can_activate bool, metadata jsonb not null default '{}', occurred_at timestamptz not null, received_at timestamptz not null default now(), payload jsonb not null, resolved_at timestamptz, resolved_by text, resolution text check in ('unblocked','resent','dismissed'))`; indexes on `(occurred_at desc)`, `(lower(recipient))`, partial `(occurred_at) where resolved_at is null and record_type <> 'Delivery'`.
- `public.email_actions(id uuid pk, action text not null check in ('unblock','block','dismiss','resend'), recipient text, event_id uuid references email_events, detail jsonb not null default '{}', performed_by text not null, created_at timestamptz default now())`.
- `event_key` rules: Bounce → `bounce:<ID>`; SpamComplaint → `spam:<ID>`; Delivery → `delivery:<MessageID>`; SubscriptionChange → `sub:<MessageID or ''>:<Recipient lower>:<ChangedAt>`.

- [ ] **Step 1:** Write the migration (header comment, `BEGIN … COMMIT`, RLS enable + revoke as in `2026-10-17-prompt-hashes.sql`).
- [ ] **Step 2:** Apply: `psql service=rosably -v ON_ERROR_STOP=1 -f /opt/rosenfelt/docs/migrations/2026-10-17-email-events.sql` → `COMMIT`.
- [ ] **Step 3:** Verify: `psql service=rosably -c "\d public.email_events"` shows the unique index on `event_key`; `select has_table_privilege('anon','public.email_events','select')` → `f`.
- [ ] **Step 4:** Add both tables to `/opt/rosenfelt/docs/database-schema.md`.

### Task 2: Tagged sends + Postmark API client

**Files:** Modify `src/lib/email/gmail.ts`, `src/lib/email/postmark.ts`, `src/lib/email/postmark.test.ts`, `src/lib/discovery/email.ts`, `src/app/api/engagements/[id]/access/[accessId]/email/route.ts`. Create `src/lib/email/postmark-api.ts`, `src/lib/email/postmark-api.test.ts`.

**Interfaces — Produces:**
- `SendEmailInput` adds `tag?: string; metadata?: Record<string, string>`.
- `postmark-api.ts` (all throw `EmailError("not_configured")` without a token, `EmailError("auth_failed")` on 401, `EmailError("send_failed", msg, status)` otherwise):
  - `getOutboundStats(from: string, to: string, tag?: string): Promise<{ sent: number; bounced: number; spamComplaints: number }>` (`GET /stats/outbound`, fields `Sent`, `Bounced`, `SpamComplaints`; `messagestream=outbound`)
  - `listSuppressions(): Promise<Suppression[]>` with `type Suppression = { email: string; reason: "HardBounce" | "SpamComplaint" | "ManualSuppression"; origin: string; createdAt: string }`
  - `suppress(email: string): Promise<void>`; `unsuppress(email: string): Promise<void>` (both check the per-address `Status` in the response and throw `send_failed` if not `Suppressed`/`Deleted`)
  - `searchMessages(recipient: string, count?: number): Promise<MessageSummary[]>`; `getMessage(id: string): Promise<MessageDetail>` with `MessageDetail = { id; to; subject; tag?; metadata: Record<string,string>; textBody?; htmlBody?; hasAttachments: boolean; events: { type: string; at: string; detail?: string }[] }`
- Tags: discovery `dashboard-discovery-invite` + metadata `{ discovery_invite_id }`; room `dashboard-room-invite` + metadata `{ engagement_id, access_id }`.

- [ ] **Step 1: Failing tests.** In `postmark.test.ts`: `it("passes Tag and Metadata through")` → `buildPayload({...base, tag:"t", metadata:{a:"1"}}, s)` has `Tag:"t", Metadata:{a:"1"}`, and omits both when unset. In `postmark-api.test.ts` (fetch mocked): stats maps `{Sent:38,Bounced:1,SpamComplaints:0}` → `{sent:38,bounced:1,spamComplaints:0}` and the URL contains `messagestream=outbound&fromdate=2026-10-10&todate=2026-10-17`; `unsuppress` posts `{Suppressions:[{EmailAddress:"a@b.co"}]}` to `/message-streams/outbound/suppressions/delete`; 401 → `auth_failed`; `getMessage` maps `Attachments.length>0` → `hasAttachments:true`.
- [ ] **Step 2:** `npx vitest run src/lib/email` → new tests FAIL.
- [ ] **Step 3:** Implement; add `tag`/`metadata` to the two dashboard callers (values above). Gmail ignores them.
- [ ] **Step 4:** `npx vitest run src/lib/email src/app/api/engagements src/app/api/crm` → PASS.
- [ ] **Step 5:** Commit `feat(email): tag dashboard sends and add Postmark API client`.

### Task 3: Health rules (pure)

**Files:** Create `src/lib/email/health.ts`, `src/lib/email/health.test.ts`

**Interfaces — Produces:**
```ts
export const MIN_SENDS_FOR_RATES = 50, BOUNCE_WARN = 0.02, BOUNCE_RED = 0.05;
export type HealthInput = { sent: number | null; delivered: number; unresolvedHardBounces: number;
  unresolvedSpam: number; bouncedTotal: number; eventsInWindow: number; postmarkError: "unreachable" | "auth" | null };
export type Health = { level: "green" | "amber" | "red"; reasons: string[]; bounceRate: number | null; deliveredPct: number | null };
export function computeHealth(i: HealthInput): Health;
```
`reasons` are plain-English strings, first one is the headline (e.g. "A spam complaint needs attention", "Can't reach Postmark", "Email alerts may be broken: no events from Postmark this week").

- [ ] **Step 1: Failing tests** (`health.test.ts`), one `it` each:
  - all clear (sent 38, 0 problems, events 37) → green, `bounceRate≈0`.
  - one unresolved hard bounce, sent 20, bounced 1 → **amber** (not red: below 50 sends).
  - sent 60, bouncedTotal 4 (6.7%), 0 unresolved → red; sent 60, bounced 2 (3.3%) → amber.
  - unresolved spam 1 → red, reasons[0] mentions "spam".
  - resolved problems only (unresolved 0, bounced 1, sent 20) → green.
  - `postmarkError:"auth"` → red "Postmark rejected the token"; `"unreachable"` → red, `sent:null` → `bounceRate:null`.
  - sent 10, eventsInWindow 0 → amber "alerts may be broken"; sent 0, events 0 → green.
- [ ] **Step 2:** Run `npx vitest run src/lib/email/health.test.ts` → FAIL.
- [ ] **Step 3:** Implement `computeHealth`. Red checks before amber; collect all reasons, worst first.
- [ ] **Step 4:** Re-run → PASS. **Step 5:** Commit `feat(email): health rules`.

### Task 4: Events store + read routes

**Files:** Create `src/lib/email/events.ts`, `src/lib/email/events.test.ts`, `src/app/api/email/health/route.ts`, `src/app/api/email/health/route.test.ts`, `src/app/api/email/messages/route.ts`, `src/app/api/email/messages/[id]/route.ts`. Modify `src/lib/permissions.ts`, `src/lib/permissions.test.ts`.

**Interfaces:**
- Consumes: Task 2 `getOutboundStats`, `searchMessages`, `getMessage`; Task 3 `computeHealth`.
- Produces (`events.ts`):
  - `type EmailEvent` (row shape of `email_events`, camelCase not required — use column names).
  - `listProblems(opts: { since: string; includeResolved?: boolean }): Promise<EmailEvent[]>` (record_type ≠ Delivery, newest first, limit 200)
  - `windowCounts(since: string): Promise<{ delivered: number; unresolvedHardBounces: number; unresolvedSpam: number; events: number }>` (hard bounce = `record_type='Bounce' and inactive`)
  - `resolveEvents(filter: { id?: string; recipient?: string }, resolution: "unblocked"|"resent"|"dismissed", by: string): Promise<number>` (only unresolved rows; recipient match is `lower()`)
  - `logAction(a: { action; recipient?; eventId?; detail?; by }): Promise<void>` (failure logs, never throws)
- `GET /api/email/health` → `{ health: Health, window: { from, to }, stats: { sent, bounced, spamComplaints } | null, bySource: { source: string; sent: number; bounced: number; spam: number }[], problems: EmailEvent[], lastProblem: EmailEvent | null, canManage: boolean }`. `bySource` from `getOutboundStats` per tag prefix (`dashboard-*` tags, `n8n-*`, `wordpress`) — query each known tag (`KNOWN_TAGS = ["dashboard-discovery-invite","dashboard-room-invite","n8n-avery-deliver-audit","n8n-stripe-buyer","n8n-typeform-intake","n8n-weekly-audit","wordpress"]` in `postmark-api.ts`) and sum by prefix; Postmark failure → `stats:null`, `bySource:[]`, `postmarkError` set, still 200.
- `GET /api/email/messages?recipient=` (valid email required, 400 otherwise) → `MessageSummary[]`; `GET /api/email/messages/[id]` → `MessageDetail` minus bodies (bodies never sent to the browser).
- `manage_email` added to `MANAGE_PERMISSIONS` + `PERMISSION_LABELS` ("Manage Email").

- [ ] **Step 1: Failing tests.** `permissions.test.ts`: viewer lacks `manage_email`, admin has it. `health/route.test.ts` (mock `@/lib/email/postmark-api`, `@/lib/email/events`, session as in existing route tests): 401 without cookie; happy path returns `health.level` from rules and `canManage:false` for viewer / `true` for admin; Postmark throws `auth_failed` → 200 with `health.level:"red"` and `stats:null`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(email): health and lookup API`.

### Task 5: Block / unblock / dismiss routes

**Files:** Create `src/app/api/email/suppressions/route.ts` (+ `.test.ts`), `src/app/api/email/events/[id]/dismiss/route.ts` (+ `.test.ts`)

**Interfaces — Consumes:** Task 2 `listSuppressions`, `suppress`, `unsuppress`; Task 4 `resolveEvents`, `logAction`.
- `GET /api/email/suppressions` (view_overview) → `Suppression[]` with `canUnblock = reason !== "SpamComplaint"`.
- `POST /api/email/suppressions {email}` (manage_email) → block; logs `block`.
- `DELETE /api/email/suppressions {email}` (manage_email) → look up current suppression first; `SpamComplaint` → **409** `"Blocked permanently — this person marked us as spam."` without calling `unsuppress`; not suppressed → 404; else `unsuppress`, `resolveEvents({recipient}, "unblocked", user)`, log `unblock`.
- `POST /api/email/events/[id]/dismiss` (manage_email) → `resolveEvents({id}, "dismissed", user)`; 0 rows → 404; log `dismiss`.

- [ ] **Step 1: Failing tests:** viewer gets 403 on POST/DELETE/dismiss and the Postmark mocks are not called; spam-complaint DELETE → 409 and `unsuppress` not called; hard-bounce DELETE → 200, `resolveEvents` called with `{recipient:"a@b.co"},"unblocked","brian"`; invalid email → 400.
- [ ] **Step 2–4:** Run (FAIL) → implement → run (PASS).
- [ ] **Step 5:** Commit `feat(email): block, unblock and dismiss`.

### Task 6: Resend (per source)

**Files:** Create `src/lib/rooms/send-invite.ts`, `src/lib/email/resend.ts`, `src/lib/email/resend.test.ts`, `src/app/api/email/events/[id]/resend/route.ts` (+ `.test.ts`). Modify `src/app/api/engagements/[id]/access/[accessId]/email/route.ts` to call `sendRoomInvite`.

**Interfaces:**
- `sendRoomInvite(a: { engagementId: string; accessId: string; to: string; link: string; firstName?: string; refreshed: boolean; timeZone?: string; by: string }): Promise<{ ok: true; id: string; logged: boolean } | { ok: false; status: number; error: string }>` — the body of today's email route after input parsing (validity checks, send with tag/metadata, `lead_activities` entry). The route keeps parsing and token-hash verification and delegates. Existing route tests must still pass unchanged.
- `resendEvent(eventId: string, opts: { to?: string; unblock?: boolean; by: string }): Promise<{ ok: true; messageId: string; contactUpdated?: boolean } | { ok: false; status: number; error: string }>`, dispatch by event `tag`:
  - `dashboard-room-invite`: needs `metadata.engagement_id/access_id`; refresh the link via the same RPC as `access/[accessId]/refresh` (extract `refreshAccess(engagementId, accessId, expiresDays = 30)` into `src/lib/rooms/` and reuse from that route), then `sendRoomInvite({… refreshed: true })` to the new access id. Room closed / revoked → 409 (message from the existing route).
  - `dashboard-discovery-invite`: `emailInvite(metadata.discovery_invite_id, { to })` (its existing 409 for closed/expired).
  - `n8n-stripe-buyer`, `n8n-typeform-intake`: `getMessage(event.message_id)` → `sendEmail({ to, subject, text: textBody, html: htmlBody, tag, fromName: "Brian Rosenfelt", replyTo: "brian@rosably.com" })`; `hasAttachments` → 422.
  - anything else (incl. `n8n-avery-deliver-audit`, `n8n-weekly-audit`, `wordpress`, untagged) → 422 `"This email can't be resent from the dashboard."` (`n8n-avery-deliver-audit` text: "Re-run the delivery from n8n (avery-deliver-audit).")
  - Before sending: `emailProvider() !== "postmark"` → 503; if recipient is suppressed: spam → 409 permanent; otherwise 409 "still blocked" unless `opts.unblock === true`, in which case `unsuppress` first.
  - Corrected address (`opts.to` differs from event recipient, case-insensitive): for dashboard sources, update `crm.contacts.email` for the lead's `contact_id` (lead from engagement.lead_id or discovery invite lead_id); no contact → skip and return `contactUpdated:false`.
  - On success: `resolveEvents({id}, "resent", by)`, `logAction({action:"resend", detail:{from_tag, to, new_message_id, contactUpdated}})`.
- `POST /api/email/events/[id]/resend {to?, unblock?}` (manage_email) → result as JSON with its status.

- [ ] **Step 1: Failing tests** (`resend.test.ts`, mocking `postmark-api`, `email`, `events`, `supabase-admin`, rooms helpers): room invite with closed room → 409 and `sendEmail` not called and `resolveEvents` not called; room invite happy path → refresh called then send with `refreshed:true`, event resolved `resent`; discovery happy path with corrected address → contact email updated, `contactUpdated:true`; n8n stripe → copies subject/body, tag preserved; `n8n-avery-deliver-audit` → 422 with the n8n guidance text; Gmail provider → 503; spam-suppressed → 409; hard-bounce suppressed without `unblock` → 409 "still blocked", with `unblock:true` → `unsuppress` then send. Route test: viewer → 403.
- [ ] **Step 2–4:** FAIL → implement → PASS, and `npx vitest run src/app/api/engagements` still PASS.
- [ ] **Step 5:** Commit `feat(email): resend bounced email by source`.

### Task 7: Dashboard UI

**Files:** Create `src/components/EmailHealthCard.tsx`, `src/components/status/tabs/EmailTab.tsx`. Modify `src/app/(dashboard)/status/page.tsx`, `src/app/(dashboard)/overview/page.tsx`, `src/components/status/tabs/helpers.ts` (+ test).

**Interfaces — Consumes:** Task 4 `GET /api/email/health`, `/api/email/messages`; Task 5 routes; Task 6 resend route.
- Status page: add `"email"` to `Tab`/`TABS` (label "Email", after WordPress); initial tab from `useSearchParams().get("tab")` when it's a valid `Tab`; `selectTab` updates `?tab=` via `router.replace` (no scroll). Wrap in `Suspense` as Next requires for `useSearchParams`.
- Card on Overview, directly above the "Agents" section: dot + level word ("Healthy"/"Needs attention"/"Problem") + `health.reasons[0]` when not green + "N sent · N bounces · N spam (7 days)" + "Last problem: <day>, <type> to <recipient>" + `Link` "Details →" to `/status?tab=email`. Loads once, then `usePolling(load, 60_000)`. Fetch failure → card shows "Email status unavailable" (not red).
- Tab sections in order: verdict line + "checked X ago" (`ago` helper); four `StatCard`s (Sent, Delivered, Bounce rate with `sub="warn at 2%"` and `warn` when ≥ 2% at ≥50 sends, Spam complaints with `alert` when > 0); **Needs attention** table (when, to, subject, sender, reason) with actions shown only when `canManage`: Resend (opens small modal: address prefilled, editable; checkbox "Unblock first" when blocked; posts to resend route and shows the server's error text), Dismiss; "Show resolved" toggle; **By sender** table; **Blocked addresses** (from suppressions route) with Unblock (confirm) or the permanent-spam text, plus a "Block an address" input (confirm); **Look up** input → results list → expandable event timeline.
- `helpers.ts`: add `sourceLabel(tag: string | null): string` (`dashboard-room-invite`→"Dashboard · room invite", `dashboard-discovery-invite`→"Dashboard · discovery invite", `n8n-<slug>`→"n8n · <slug>", `wordpress`→"WordPress", null→"Other") and `problemLabel(e: EmailEvent): string` ("Hard bounce: <description>", "Spam complaint", "Blocked").

- [ ] **Step 1: Failing tests** in `helpers.test.ts` for `sourceLabel` (all five cases) and `problemLabel` (three cases).
- [ ] **Step 2–4:** FAIL → implement helpers + components → PASS.
- [ ] **Step 5:** `npx tsc --noEmit && npm run build` pass. Smoke test per the dashboard dev notes (`npx next start -p 3100`, minted admin + viewer sessions, Playwright): admin sees action buttons; viewer sees none; `/status?tab=email` opens the Email tab; screenshot card + tab.
- [ ] **Step 6:** Commit `feat(email): overview card and status email tab`.

### Task 8: n8n intake workflow "Postmark Events"

**Files:** Create `scripts/n8n/postmark-events.code.js` (the Code-node logic, exported for tests) and `scripts/n8n/postmark-events.code.test.ts`; n8n workflow created via API from a script in the scratchpad.

**Interfaces — Produces:**
- `normalize(body): { row: EmailEventInsert; ping: string | null }` where `EmailEventInsert` matches Task 1 columns, `source_group` = tag prefix before `-` (`dashboard`|`n8n`|`wordpress`) else `other`, and `ping` per spec rules (Bounce with `Inactive:true`; every SpamComplaint; SubscriptionChange with `SuppressSending:true` — dedupe against recent pings is done in the workflow by querying `email_events` for a Bounce/SpamComplaint for the same recipient in the last 10 minutes). Delivery → `ping:null`.
- Ping text (exact shape): `📧 Bounce — {recipient} didn't get "{subject}" ({sourceLabel}). Reason: {description}. Postmark has blocked this address. https://dashboard.rosably.com/status?tab=email` ; spam: `🚨 Spam complaint — {recipient} marked "{subject}" ({sourceLabel}) as spam. They're permanently blocked. …link`; block: `⛔ Blocked — Postmark will no longer send to {recipient} ({reason}). …link`.
- Workflow nodes: Webhook `POST /webhook/postmark-events` (raw body) → Code "Check secret" (compare header `x-rosably-webhook-secret` to `$env.POSTMARK_WEBHOOK_SECRET`, constant-time; mismatch → respond 401 and stop) → Code "Normalize" (`normalize`) → HTTP Supabase insert `POST /rest/v1/email_events?on_conflict=event_key` with `Prefer: resolution=ignore-duplicates,return=representation` (service key from `$env`) → IF inserted row returned and `ping` set (and, for SubscriptionChange, no recent bounce/spam) → HTTP Telegram `bot{{$env.RILEY_BOT_TOKEN}}/sendMessage` to `$env.BRIAN_CHAT_ID` → Respond 200. Error workflow = Global Error Handler.

- [ ] **Step 1: Failing tests** with Postmark's documented sample payloads (Bounce HardBounce Inactive true, Bounce SoftBounce Inactive false, SpamComplaint, SubscriptionChange, Delivery): event_key per Task 1 rules; soft bounce → `ping:null`; hard bounce ping equals the exact text for a sample with `Tag:"n8n-avery-deliver-audit"`; Delivery → `ping:null`, `source_group` from tag.
- [ ] **Step 2–4:** `npx vitest run scripts/n8n` FAIL → implement → PASS.
- [ ] **Step 5:** Generate secret (`openssl rand -hex 32`), store it as field `Webhook Secret` on vault item `Postmark` (ask Brian to add it if the CLI can't write; never print it), add `POSTMARK_WEBHOOK_SECRET` to `/docker/n8n/.env` + compose, recreate n8n. Confirm `SUPABASE_*` env names the other workflows use and reuse them.
- [ ] **Step 6:** Create + activate the workflow via n8n API (Code node bodies inlined from the `.code.js` file).
- [ ] **Step 7:** Commit the code + tests `feat(n8n): postmark events intake`.

### Task 9: Wire Postmark + tag every source

**Files:** n8n workflows `aeSKXAC5lsy5BlGl`, `mQAKHvzdmoy5lczF`, `u7PbrqnKu50xSqmj`, `uFg21tiyeldNB8n3`; create `/opt/website/mu-plugins/rosably-postmark-tag.php`.

- [ ] **Step 1:** Create the Postmark webhook (Postmark API `POST /webhooks`, server token): URL `https://n8n.rosably.com/webhook/postmark-events`, `MessageStream: "outbound"`, `HttpHeaders: [{Name:"X-Rosably-Webhook-Secret", Value:<secret>}]`, triggers Bounce (IncludeContent false), SpamComplaint, SubscriptionChange, Delivery enabled. Record the webhook ID in infrastructure.md.
- [ ] **Step 2:** Verify: Postmark `POST /bounces/...` isn't available for test, so send to `HardBounce@bounce-testing.postmarkapp.com` (Postmark's bounce-testing address; the local part picks the bounce type) from n8n's credential and confirm: one `email_events` row (`record_type='Bounce'`), one Telegram ping. Re-POST the same captured payload to the webhook → still one row, no second ping. POST without the header → 401, no row.
- [ ] **Step 3:** Add header `X-PM-Tag` to the four n8n Send Email nodes (`n8n-avery-deliver-audit`, `n8n-stripe-buyer`, `n8n-typeform-intake`, `n8n-weekly-audit`) via the SMTP node's custom headers option; back up each workflow JSON first. Verify by sending through a temp workflow as in the Postmark setup and checking the message's `Tag` in Postmark `/messages/outbound`.
- [ ] **Step 4:** WordPress mu-plugin: `add_filter('wp_mail', …)` appends `X-PM-Tag: wordpress` to `headers`. Send a `wp_mail` test (as in setup) and confirm the Tag in Postmark; if WP Mail SMTP's Postmark mailer drops it, set the tag through that mailer's documented filter instead, and note which in the doc.
- [ ] **Step 5:** Resolve the test bounce row (dismiss via the dashboard once Task 7 ships, or SQL `update … set resolution='dismissed'`) so the card isn't left amber; unblock `HardBounce@bounce-testing.postmarkapp.com` in Postmark.

### Task 10: Weekly Agent Audit section

**Files:** n8n workflow `uFg21tiyeldNB8n3`.

- [ ] **Step 1:** Back up the workflow JSON. Add before "Format Report": HTTP "Postmark: Weekly Stats" (`GET https://api.postmarkapp.com/stats/outbound?messagestream=outbound&fromdate=…&todate=…` from "Set Audit Window", header `X-Postmark-Server-Token: {{$env.POSTMARK_SERVER_TOKEN}}` — add that env var like the webhook secret) and HTTP "Query: Email Problems" (Supabase `email_events` where `record_type in (Bounce,SpamComplaint)` and `occurred_at` in window, select recipient, subject, tag, record_type, description, inactive, resolution). Both `continueOnFail`.
- [ ] **Step 2:** In "Format Report" add an **Email delivery** section: `Sent N · Delivered X% · Bounce rate Y% · Spam complaints Z`, one line per problem (`{type} — {recipient} — "{subject}" ({source}){resolved ? " — fixed: "+resolution : ""}`), and `⚠️` warning line when bounce ≥ 2% at ≥ 50 sends, or any hard bounce at < 50, or complaints > 0. If Postmark stats failed: "Email delivery: couldn't reach Postmark this week."
- [ ] **Step 3:** Verify with a manual run using the n8n "execute workflow" API on a copy with Telegram/email nodes disabled, or by temporarily pointing them at Brian only (they already go only to Brian) — confirm the section renders with the test bounce from Task 9.

### Task 11: Docs and ship

- [ ] **Step 1:** Update `/opt/rosenfelt/docs/infrastructure.md` (webhook ID, workflow ID, env vars, tags table), `dashboard.md` (Email tab, card, routes, `manage_email`, `?tab=`), `database-schema.md` (Task 1).
- [ ] **Step 2:** Full checks: `npx tsc --noEmit && npx vitest run && npm run build` → all pass.
- [ ] **Step 3:** Push branch, open PR (summary + test evidence), wait for Vercel check, merge per Brian's go-ahead, confirm production deploy Ready and `/status?tab=email` loads.
