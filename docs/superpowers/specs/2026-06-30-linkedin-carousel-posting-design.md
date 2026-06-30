# LinkedIn Carousel API Posting — Design Spec
**Date:** 2026-06-30  
**Status:** Approved, pending implementation  
**Scope:** Avery agent + rosenfelt-dashboard

---

## Overview

Wire actual LinkedIn API posting into the existing carousel approval pipeline. Currently Avery generates carousel content → `pending_approvals` row → dashboard shows Mark ready/Revise/Reject buttons → approval records intent only, posting is manual copy-paste. This spec wires a real executor: approving a `linkedin_carousel` row generates a branded 8-slide PDF and posts it to LinkedIn as a native document/carousel post, then adds the URL as the first comment.

---

## Architecture

```
[Dashboard "Mark ready" button]
        │
        ▼
PATCH /api/approvals  (route.ts)
  → detects action_type='linkedin_carousel', agent='avery'
  → requires human reviewer (same gate as publish_post)
        │
        ▼
Avery  POST /linkedin/post  { approval_id }
  1. Fetch approval row (payload: slides, caption, comment_text, post_title)
  2. Get LinkedIn access token from agent_memory (refresh if expiring within 7 days)
  3. Generate 8-slide PDF via WeasyPrint
  4. Register document upload with LinkedIn REST API
  5. PUT PDF bytes to upload URL
  6. Create ugcPost (caption + document URN)
  7. Post first comment (URL) to post URN
  8. Write linkedin_post_url back to approval payload
  9. Log result to workflow_logs
        │
        ▼
Dashboard: History tab shows "View on LinkedIn ↗" link
```

---

## New Files

| File | Purpose |
|---|---|
| `avery-agent/tools/linkedin_post.py` | PDF generation + LinkedIn API calls |
| `avery-agent/scripts/linkedin_oauth.py` | One-time OAuth setup script |

## Modified Files

| File | Change |
|---|---|
| `avery-agent/tools/linkedin_tools.py` | Add `get_linkedin_token()` helper |
| `avery-agent/main.py` | Add `POST /linkedin/post` endpoint |
| `dashboard/src/app/api/approvals/route.ts` | Add `linkedin_carousel` executor branch |
| `dashboard/src/components/ApprovalCard.tsx` | Show post URL after approval |

---

## Slide PDF Generation

**Format:** Portrait 1080×1350px (4:5 ratio, native LinkedIn carousel). 8 pages = 8 slides.

**Layout per slide:**
```
┌─────────────────────────────┐
│  [Rosably logo]    [● N]    │  ← top bar: logo left, slide number right (orange circle)
│                             │
│                             │
│    Slide text here,         │
│    large, centered,         │
│    brand-black, wrapping    │
│                             │
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│  ← 8px orange accent bar at bottom
└─────────────────────────────┘
```

**Style:**
- Background: off-white `#F9F7F4`
- Logo: `/app/static/` PNG bundled in Avery image, embedded as base64 data URI (same pattern as audit reports)
- Slide number: orange `#E8621A` filled circle, white numeral, top-right
- Slide text: system sans-serif, ~52px, brand black `#1A1A1A`, centered vertically, 120px horizontal padding
- Slide 1 (hook): slightly larger text (~60px) for emphasis
- Accent bar: 8px orange stripe pinned to bottom

**Implementation:** Single Jinja2 HTML template with `{{ slide_text }}`, `{{ slide_num }}`, `{{ is_hook }}` variables. Rendered 8 times with `page-break-after: always`. WeasyPrint produces a single multi-page PDF. PDF is generated in-memory (bytes) — never written to disk. Filename: `linkedin-carousel-{approval_id}.pdf` (used as the document title on LinkedIn).

---

## LinkedIn API Flow

Uses the LinkedIn **REST API (LinkedIn-Version: 202306)**.

**Required OAuth scopes:** `openid`, `profile`, `w_member_social`

Note: `r_member_social` is a restricted scope (approved users only) and is not needed for posting — `w_member_social` is sufficient for uploading documents, creating posts, and commenting.

All requests require both `LinkedIn-Version: {YYYYMM}` and `X-Restli-Protocol-Version: 2.0.0` headers.

### Step 1 — Register document upload
```
POST https://api.linkedin.com/rest/documents?action=initializeUpload
Headers:
  LinkedIn-Version: 202306
  X-Restli-Protocol-Version: 2.0.0
  Authorization: Bearer {token}
  Content-Type: application/json

Body:
{
  "initializeUploadRequest": {
    "owner": "urn:li:person:{LINKEDIN_PERSON_URN}"
  }
}

Response:
{ "value": { "uploadUrl": "...", "uploadUrlExpiresAt": 1650567510704, "document": "urn:li:document:..." } }
```

### Step 2 — Upload PDF bytes
```
PUT {uploadUrl}
Content-Type: application/octet-stream
Body: <pdf_bytes>

Response: 201 Created (no body)
```

### Step 3 — Create post
```
POST https://api.linkedin.com/rest/posts
Headers:
  LinkedIn-Version: 202306
  X-Restli-Protocol-Version: 2.0.0
  Authorization: Bearer {token}
  Content-Type: application/json

Body:
{
  "author": "urn:li:person:{LINKEDIN_PERSON_URN}",
  "commentary": "{caption}",
  "visibility": "PUBLIC",
  "distribution": {
    "feedDistribution": "MAIN_FEED",
    "targetEntities": [],
    "thirdPartyDistributionChannels": []
  },
  "content": {
    "media": {
      "id": "urn:li:document:...",
      "title": "{post_title}"
    }
  },
  "lifecycleState": "PUBLISHED",
  "isReshareDisabledByAuthor": false
}

Response: 201 Created
  x-restli-id header contains the post URN (e.g. "urn:li:share:6844785523593134080")
```

### Step 4 — Post first comment (URL)

The activity URN for the comment `object` field is derived from the post URN: take the numeric ID from `x-restli-id` and prefix with `urn:li:activity:`.

```
POST https://api.linkedin.com/rest/socialActions/{url_encoded_post_urn}/comments
Headers:
  LinkedIn-Version: 202306
  X-Restli-Protocol-Version: 2.0.0
  Authorization: Bearer {token}
  Content-Type: application/json

Body:
{
  "actor": "urn:li:person:{LINKEDIN_PERSON_URN}",
  "object": "urn:li:activity:{numeric_id_from_post_urn}",
  "message": { "text": "{comment_text}" }
}
```

The post URN from `x-restli-id` is URL-encoded before use in the comment endpoint URL (`:` → `%3A`).

**Return value:** `https://www.linkedin.com/feed/update/{post_urn}/` — written to `approval.payload.linkedin_post_url`.

---

## Token Management

### Storage
A single pinned row in Supabase `agent_memory` (no schema change):
```json
{
  "agent": "avery",
  "memory_text": "linkedin_oauth: {\"access_token\": \"...\", \"refresh_token\": \"...\", \"expires_at\": \"2026-08-28T00:00:00Z\"}",
  "is_core": true,
  "pinned": true
}
```
Identified by `agent='avery'` + `memory_text LIKE 'linkedin_oauth:%'`.

### Retrieval logic (`get_linkedin_token()`)
1. Fetch the `linkedin_oauth` memory row from Supabase
2. Parse JSON from the value after the `linkedin_oauth: ` prefix
3. If `expires_at` is within 7 days → call refresh endpoint, update the row
4. Return `access_token`

### Refresh endpoint
```
POST https://www.linkedin.com/oauth/v2/accessToken
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&refresh_token={refresh_token}
&client_id={LINKEDIN_CLIENT_ID}
&client_secret={LINKEDIN_CLIENT_SECRET}

Response: { access_token, refresh_token, expires_in }
```

### New env vars (Avery `.env` on OVH)
- `LINKEDIN_CLIENT_ID`
- `LINKEDIN_CLIENT_SECRET`
- `LINKEDIN_PERSON_URN` (full URN string, e.g. `urn:li:person:AaBbCcDdEe` — printed by the OAuth setup script)

---

## OAuth Setup Script (`scripts/linkedin_oauth.py`)

Run once on OVH after LinkedIn Developer App is created and env vars are set:
```bash
cd /opt/avery-agent && python3 scripts/linkedin_oauth.py
```

**Simpler alternative — LinkedIn Developer Portal Token Generator:**
LinkedIn provides a built-in token generator at `linkedin.com/developers/tools/oauth/token-generator`. Select your app, choose scopes, click Allow — it issues a token with a 60-day TTL directly. Copy the token and run `python3 scripts/linkedin_oauth.py --token <token>` to store it in `agent_memory` without the OAuth dance. Use this for initial setup and each 60-day renewal.

**Full OAuth flow (fallback):**
1. Loads `/opt/avery-agent/.env` via `python-dotenv` (so it can run standalone without `source .env`); reads `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
2. Spins up a temporary `http.server` on port 8080 for ~60 seconds
3. Prints the LinkedIn auth URL — Brian opens it in browser, clicks Allow
4. LinkedIn redirects to `http://localhost:8080/callback?code=...` — script captures `code` automatically (falls back to manual paste if server times out)
5. Exchanges `code` for tokens via `POST /oauth/v2/accessToken`
6. Calls `GET /v2/userinfo` to retrieve `sub` (the person URN ID)
7. Stores token JSON in `agent_memory` via Supabase REST (upsert on `linkedin_oauth` row)
8. Prints: token stored, person URN to add to `.env`, expiry date, next refresh due

**Token refresh note:** Programmatic server-side refresh token exchange is restricted to LinkedIn Marketing Developer Platform (MDP) partners. For a standard `w_member_social` app, the simplest approach is to re-run the Token Generator every 60 days (or trigger the OAuth flow again). The `get_linkedin_token()` helper checks expiry and logs a warning with instructions when the token is within 7 days of expiry rather than attempting an automated refresh.

**Redirect URI to register in LinkedIn app:** `http://localhost:8080/callback`

---

## Executor Wiring

### Dashboard `route.ts`
New branch after the `isStackAudit` block:
```typescript
const isLinkedInCarousel = approval?.agent === "avery" && approval?.action_type === "linkedin_carousel";

if (status === "approved" && isLinkedInCarousel) {
  if (!reviewer) return 403  // human gate
  // POST avUrl/linkedin/post { approval_id }
  // Log to workflow_logs ("Dashboard LinkedIn Post Gate")
  // Return { success: true, post: { ok, detail, post_url? } }
}
```

### Avery `POST /linkedin/post`
- Secret-gated (`X-Webhook-Secret`)
- Accepts `{ approval_id: string }`
- Fetches approval row, generates PDF, posts to LinkedIn
- On success: returns `{ ok: true, post_url: "https://www.linkedin.com/feed/update/..." }`
- On failure: returns HTTP 500 `{ ok: false, detail: "<step that failed>: <error>" }`

### `ApprovalCard.tsx`
In the History tab view of a `linkedin_carousel` card: if `payload.linkedin_post_url` is set, render a "View on LinkedIn ↗" link below the slide list.

---

## Error Handling

| Failure | Behaviour |
|---|---|
| PDF generation fails | Avery returns 500, dashboard logs error to `workflow_logs`, approval status already written as `approved` |
| LinkedIn upload/post/comment fails | Avery returns 500 with which step failed (e.g. `"document_upload: HTTP 401"`), logged to `workflow_logs` |
| Token expired, refresh fails | Error message: `"LinkedIn token expired — re-run scripts/linkedin_oauth.py"`, logged to `workflow_logs` |
| Missing env vars | Caught at startup of `/linkedin/post` handler, returns 500 with config gap named |

**No automatic retry.** Failures are visible in the dashboard `workflow_logs` tab. Brian can re-trigger via `POST /linkedin/repurpose {post_id}` (re-generates the approval row) then approve again.

---

## Out of Scope

- Scheduling posts for `suggested_post_day` — approval fires the post immediately on approval
- Analytics / post performance tracking
- Multiple LinkedIn accounts
- Image-based carousels (non-PDF) — LinkedIn document posts (PDF) are used
