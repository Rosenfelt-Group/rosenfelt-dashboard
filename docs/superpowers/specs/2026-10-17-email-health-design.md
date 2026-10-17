# Email health: Postmark alerts, weekly summary and dashboard control — design

Status: ready for Brian's review (2026-10-17; builder-reviewed, questions answered). Repos/systems: rosenfelt-dashboard, n8n (Hostinger), WordPress (`/opt/website`), Supabase, Postmark.

## Why
As of 2026-10-17 all Rosably outbound email goes through Postmark (server `Rosably_Postmark1`, stream `outbound`):
dashboard invites (`src/lib/email/postmark.ts`), four n8n workflows (credential "Postmark SMTP"), and WordPress (WP Mail SMTP, Postmark mailer).
Most of that mail goes to prospects and buyers (discovery invites, AI Opportunity Review emails). Brian wants to **know email is
arriving**, and to hear immediately when it isn't, so a bounced or spam-flagged email never goes unnoticed until a confused prospect
asks. He also wants to **act on problems from the dashboard** rather than logging into Postmark.

## Goals
1. **Telegram ping right away** on every bounce, spam complaint, and Postmark-side block of a recipient.
2. **Weekly summary** in the Monday Weekly Agent Audit (n8n `uFg21tiyeldNB8n3`).
3. **Dashboard health view**: a card on `/overview` linking to a full **Email** tab on `/status` (Brian chose option C, "both").
4. **Dashboard control** (admin only): unblock an address, resend a bounced message, block an address, and look up any message.

## Non-goals
- Managing the Postmark account from the dashboard: billing, servers, streams, tokens, DNS/domain settings stay in Postmark.
- Open/click tracking (tracking stays off; this is about delivery, not engagement).
- Inbound mail and the `broadcast` stream (unused).
- Fixing the Wordfence monitor's Gmail read access (separate issue).

## Anti-goals (would be a failure even if it "works")
- A bounce or complaint that produces **no** ping (silent failure), or a ping storm (duplicate pings for one event, e.g. on webhook retries).
- Pings or pages full of raw JSON. Everything reads in plain English: who, which email, which system, why.
- Any non-admin able to unblock, block or resend. Any Postmark token reaching the browser.
- Offering "unblock" on an address that marked us as spam (Postmark forbids it; the UI must say so instead of failing).

## Decisions made by Brian (2026-10-17)
- Alerts: Telegram immediately + weekly summary in the audit.
- Dashboard: Overview card + full Status → Email tab, linked.
- Control: full control from the dashboard, scoped to the four actions above; account administration stays in Postmark.
- Resend of a dashboard invite **rebuilds it through the invite's own send path** (same validity checks and CRM timeline entry); a corrected address **also updates the contact's email**.
- Fixed problems **clear automatically** after a successful unblock or resend, and can also be **dismissed** manually; cleared items stop counting toward the colour but stay in history.
- Bounce-rate percentages only apply at **50+ sends in the 7-day window**; below that, any hard bounce = amber and any spam complaint = red.

## Design

### 1. Sender tagging (so "by sender" is accurate)
Every message carries a Postmark **Tag** naming its source:
- Dashboard: `dashboard-<purpose>` (`dashboard-discovery-invite`, `dashboard-room-invite`) — add an optional `tag` to `SendEmailInput`, set by callers; Postmark payload `Tag`.
- n8n: header `X-PM-Tag: n8n-<workflow-slug>` (`n8n-avery-deliver-audit`, `n8n-stripe-buyer`, `n8n-typeform-intake`, `n8n-weekly-audit`) on the four Send Email nodes (SMTP node "Custom headers" option, or `options.headers`, whichever the node version supports).
- WordPress: `X-PM-Tag: wordpress` via a small mu-plugin in `/opt/website/mu-plugins` hooking `wp_mail` headers (WP Mail SMTP's Postmark mailer forwards it as the Tag; builder verifies, else use the `wp_mail_smtp_providers_mailer_...` filter).
The **source group** shown in the UI is the tag prefix: `dashboard`, `n8n`, `wordpress`; untagged = "other".

### 2. Event intake: Postmark webhooks → n8n
- Postmark server webhook (one, on stream `outbound`) for **Bounce**, **SpamComplaint**, **SubscriptionChange**, and **Delivery**
  (Delivery is needed for the delivered % and the per-message lookup; it is not pinged).
- Target: new n8n workflow **"Postmark Events"**, webhook path `postmark-events`. Auth: a custom HTTP header `X-Rosably-Webhook-Secret`
  configured on the Postmark webhook; the value lives in n8n `.env` (`POSTMARK_WEBHOOK_SECRET`) per the hardcoded-credential rule, and
  in Vaultwarden item `Postmark` (new field). Requests without it get 401 and nothing is stored.
- n8n upserts each event into Supabase `email_events` (below) with `on conflict do nothing` on Postmark's event identity, so Postmark
  retries never create duplicates or duplicate pings. **Only newly inserted rows trigger a ping.**
- Ping rules (sent from the Riley bot to Brian, same as "Alert Brian" in Global Error Handler):
  - Bounce where Postmark sets `Inactive: true` (hard bounce / final failure) → ping. Soft bounces that Postmark will retry → stored, not pinged.
  - SpamComplaint → ping, always, marked as the urgent one.
  - SubscriptionChange with `SuppressSending: true` (a block from any cause, including manual/API) → ping only if not already covered by a bounce/complaint ping for the same recipient in the last 10 minutes.
- Ping format (plain text):
  `📧 Bounce — j.doe@acme.co didn't get "Your AI Opportunity Review — Acme" (n8n · avery-deliver-audit). Reason: mailbox doesn't exist. Postmark has blocked this address. Dashboard: <link to Status → Email>`
- Failures in this workflow go through the existing Global Error Handler (so a broken intake shows in the dashboard SystemBanner).

### 3. Storage: Supabase `email_events`
One row per Postmark webhook event. Columns (builder finalises types):
`id` (uuid), `postmark_event_id` (text, unique — bounce `ID`; for other types a deterministic key of `RecordType+MessageID+timestamp`),
`record_type` (`Bounce|SpamComplaint|SubscriptionChange|Delivery`), `message_id`, `recipient`, `subject`, `tag`, `source_group`,
`bounce_type`, `description` (Postmark's human text), `inactive` (bool), `can_activate` (bool), `occurred_at`, `received_at`, `payload` (jsonb, raw), plus resolution: `resolved_at`, `resolved_by` (dashboard username), `resolution` (`unblocked|resent|dismissed`).
Only unresolved rows feed "Needs attention" and the status colour; resolved rows stay as history (shown under a "Resolved" toggle).
Service-role only (RLS on, no anon/auth policies — the browser never talks to Supabase). Migration goes in `/opt/rosenfelt/docs/migrations` per the usual flow.
History therefore outlives Postmark's 45-day message retention.

### 4. Dashboard: Overview card
- Uses the existing card style on `/overview`, placed near agent health. One line: status word + "N sent · N bounces · N spam (7d)" + "Details →" to `/status?tab=email`.
- **Status colour** (my thresholds; constants in one place so they're easy to change):
  - Only **unresolved** problems count. Percentage rules apply only when 7-day sends ≥ 50 (`MIN_SENDS_FOR_RATES`).
  - **Red:** any unresolved spam complaint in 7 days, bounce rate > 5% (at 50+ sends), or Postmark unreachable / rejecting the token.
  - **Amber:** any unresolved hard bounce in 7 days, or bounce rate ≥ 2% (at 50+ sends), or the event intake looks stale (no events of any kind for 7 days while Postmark reports sends — means the webhook is broken).
  - **Green:** otherwise.
- Shows "Last problem: <day>, <type> to <recipient>" when there is one.
- Polls with `usePolling` like the rest of Overview.

### 5. Dashboard: Status → Email tab
New `EmailTab` in `src/components/status/tabs`, added to `TABS` in `/status` (mounts on first visit like the others).
- **Verdict** line (same rules as the card) + "checked <time> ago".
- **Four numbers, last 7 days:** Sent, Delivered %, Bounce rate (warn at 2%), Spam complaints. Sent/bounce counts from Postmark
  `GET /stats/outbound` (server token, `fromdate`/`todate`, `messagestream=outbound`); delivered from `email_events` Delivery count ÷ sent.
- **Needs attention:** hard bounces, complaints and blocks (from `email_events`), newest first, with when / to / subject / sender / plain reason and the row's actions.
- **By sender:** sent, bounced, spam per source group (Postmark stats per tag via `GET /stats/outbound?tag=` or `/messages/outbound` counts; builder chooses — a few tags, so per-tag stats calls are fine).
- **Blocked addresses:** current Postmark suppression list for `outbound` (`GET /message-streams/outbound/suppressions/dump`), with reason, date, and action.
- **Look up a message:** search by recipient (and optionally subject) over the last 45 days via `GET /messages/outbound?recipient=`; open one to see its event timeline (`/messages/outbound/{id}/details`).

### 6. Dashboard: actions (admin only)
- New permission **`manage_email`** in `src/lib/permissions.ts` (label "Manage Email"), held by the admin role only, same pattern as `manage_intelligence`. Viewing the tab and card needs an existing read permission (builder picks the one Status already uses).
- All Postmark calls happen in server routes with `POSTMARK_SERVER_TOKEN`; nothing Postmark-side reaches the client except results.
- **Unblock:** `POST /message-streams/outbound/suppressions/delete` for one address; on success, that address's unresolved events are marked resolved (`unblocked`). Only offered when the suppression reason is
  `HardBounce` or `ManualSuppression`; for `SpamComplaint` the row shows "Blocked permanently — this person marked us as spam" and no button.
- **Block:** `POST /message-streams/outbound/suppressions` with one address (reason becomes ManualSuppression). Confirmation step.
- **Resend**, per source:
  - **Dashboard invites:** rebuild through the invite's own path — room invites via the `access/[accessId]/email` logic (refuses revoked/expired links or closed rooms; may need to refresh the link, which that route already supports), discovery via `emailInvite()` (open, unexpired only). Both write the `crm.lead_activities` entry as today. If Brian enters a corrected address, it is used for the send **and saved to the contact** (the lead/contact the invite belongs to), recorded in the activity entry.
  - **n8n customer emails** (Stripe buyer, Typeform intake): copy subject/body from Postmark `/messages/outbound/{id}/details` and send to the same or a corrected address, same tag. No CRM update (no record to tie it to).
  - **avery-deliver-audit** (had a PDF attachment, which Postmark doesn't return): no Resend button; the row says to re-run the delivery from n8n.
  - **Weekly Agent Audit** and **WordPress** mail: no Resend.
  - If the address is still blocked, the UI offers "Unblock and resend" (only when unblock is allowed). A successful resend marks the event resolved (`resent`).
- **Dismiss:** marks an event resolved (`dismissed`) without other action. Allowed for anyone with `manage_email`.
- Every action is recorded (who, what, when, address) in an audit row — reuse an existing activity/audit table if one fits, else a small `email_actions` table.

### 7. Weekly summary in the Weekly Agent Audit
Add nodes to `uFg21tiyeldNB8n3` before "Format Report": one HTTP call to Postmark `GET /stats/outbound` (7-day window, server token from n8n env)
plus a Supabase query for the week's hard bounces/complaints from `email_events`. Add an **Email delivery** section to the report:
sent, delivered %, bounce rate, complaints, the list of problems, and a warning line when bounce ≥ 2% or complaints > 0. It appears in
both the Telegram and email versions of the report.

## Constraints
- Dashboard browser never talks to Supabase or Postmark directly; server routes only. Tokens from env (`POSTMARK_SERVER_TOKEN` exists in Vercel Production + Preview).
- n8n workflows use `$env` for secrets (no plaintext), added to `/docker/n8n/.env` and the compose `environment:` block.
- Dashboard ships via branch → PR → Vercel check → merge. Checks: `tsc --noEmit`, `vitest run`, `next build`.
- Update `/opt/rosenfelt/docs/{infrastructure,dashboard,database-schema}.md`.

## Calls made by Claude (2026-10-17, after builder review; Brian to check)
- **Resend sender:** resends always go out as `brian@rosably.com` (the existing `ALLOWED_SENDERS`; not widened). Resend refuses when Postmark isn't configured (no Gmail fallback for resends), so every resend is tagged and tracked.
- **WordPress mail is not resendable** (password resets/admin notices are better re-triggered on the site).
- **`/status` gains `?tab=` support** so "Details →" and Telegram links land on the Email tab.

## Left to the builder
- Exact component structure, query shapes and API route names.
- Whether n8n writes to Supabase via REST or the Postgres node.
- Test strategy (unit tests for status-colour rules, ping rules/dedupe, and permission gating are expected).
