# LinkedIn Carousel API Posting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing `linkedin_carousel` approval pipeline to generate a branded 8-slide PDF and post it to LinkedIn as a native document post when approved in the dashboard.

**Architecture:** Approving a `linkedin_carousel` row in the dashboard calls Avery `POST /linkedin/post`, which fetches the carousel payload, renders a WeasyPrint PDF, uploads it to LinkedIn, creates the post, adds a first-comment URL, and writes the post URL back to the approval row. The dashboard then shows a "View on LinkedIn" link in the History tab.

**Tech Stack:** Python/FastAPI (Avery), WeasyPrint ≥63.0, httpx, pytest + respx (tests), Next.js/TypeScript (dashboard).

## Global Constraints

- LinkedIn REST API version header: `LinkedIn-Version: 202306` on every request
- All LinkedIn REST requests also require: `X-Restli-Protocol-Version: 2.0.0`
- Document upload endpoint: `POST /rest/documents?action=initializeUpload` (the `?action=` is required)
- Post URN is returned in `x-restli-id` response header (not `Location`)
- Comment body requires `"object": "urn:li:activity:{numeric_id}"` where numeric_id is the last `:` segment of the post URN
- PDF generated in-memory via `WeasyHTML(string=html).write_pdf()` — returns bytes, never writes to disk
- Slide format: 1080×1350px portrait (4:5 ratio), 8 pages; slide 1 font 60px (hook), slides 2–8 font 52px
- Brand colours: background `#F9F7F4`, orange `#E8621A`, text `#1A1A1A`
- Logo: `/app/static/rosably-logo-tagline.png` embedded as base64 data URI (same as audit reports)
- No Jinja2 — use Python f-strings for HTML (matches existing audit PDF pattern)
- Token stored in `agent_memory`: `agent='avery'`, `memory_text LIKE 'linkedin_oauth:%'`, `pinned=True`, `is_core=True`
- No automatic token refresh — warn 7 days before expiry, log instructions to re-run setup script
- Tests use `respx` for HTTP mocking (matches existing avery test suite)
- Avery tool count assert: currently `assert len(ALL_TOOLS) == 34` — `linkedin_post.py` adds NO LangChain tools, assert unchanged
- Dashboard changes go in `rosenfelt-dashboard` repo; Avery changes go in `avery-agent` repo (OVH only — use `gh` to push)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `avery-agent/scripts/linkedin_oauth.py` | One-time token setup: Portal Token Generator shortcut + full OAuth fallback |
| Create | `avery-agent/tools/linkedin_post.py` | PDF generation + LinkedIn API calls + `post_linkedin_carousel` orchestrator |
| Create | `avery-agent/tests/test_linkedin_post.py` | Unit tests for HTML builder, URL encoding, activity URN derivation, API helpers |
| Modify | `avery-agent/tools/linkedin_tools.py` | Add `get_linkedin_token()` async helper |
| Modify | `avery-agent/main.py` | Add `POST /linkedin/post` endpoint |
| Modify | `dashboard/src/app/api/approvals/route.ts` | Add `linkedin_carousel` executor branch after `isStackAudit` block |
| Modify | `dashboard/src/components/ApprovalCard.tsx` | Add "View on LinkedIn" link in `LinkedInCarouselDetail` |

---

## Task 1: OAuth Setup Script

**Files:**
- Create: `avery-agent/scripts/linkedin_oauth.py`

**Interfaces:**
- Produces: token JSON written to `agent_memory` row (`memory_text = "linkedin_oauth: {...}"`)
- Consumed by: Task 2 (`get_linkedin_token()`)

- [ ] **Step 1: Create the scripts directory and file**

```bash
# On OVH in /opt/avery-agent:
mkdir -p scripts
```

Create `scripts/linkedin_oauth.py`:

```python
#!/usr/bin/env python3
"""
One-time LinkedIn token setup for Avery.

Usage (recommended — paste token from LinkedIn Developer Portal Token Generator):
  python3 scripts/linkedin_oauth.py --token <access_token>

Usage (full OAuth flow — spins up local callback server on port 8080):
  python3 scripts/linkedin_oauth.py
"""
import argparse
import http.server
import json
import logging
import os
import sys
import threading
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "") or os.getenv("SUPABASE_ANON_KEY", "")
CLIENT_ID = os.getenv("LINKEDIN_CLIENT_ID", "")
CLIENT_SECRET = os.getenv("LINKEDIN_CLIENT_SECRET", "")

REDIRECT_URI = "http://localhost:8080/callback"
SCOPES = "openid profile w_member_social"
LI_VERSION = "202306"


def _sb_headers() -> dict:
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }


def _get_person_urn(access_token: str) -> str:
    r = httpx.get(
        "https://api.linkedin.com/v2/userinfo",
        headers={"Authorization": f"Bearer {access_token}", "LinkedIn-Version": LI_VERSION},
        timeout=10,
    )
    r.raise_for_status()
    sub = r.json().get("sub", "")
    if not sub:
        raise ValueError("Could not retrieve 'sub' from /v2/userinfo")
    return f"urn:li:person:{sub}"


def _store_token(access_token: str, expires_in: int, refresh_token: str = "") -> None:
    expires_at = (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat()
    data = {"access_token": access_token, "refresh_token": refresh_token, "expires_at": expires_at}
    memory_text = f"linkedin_oauth: {json.dumps(data)}"

    # Upsert: patch if row exists, insert if not
    r = httpx.get(
        f"{SUPABASE_URL}/rest/v1/agent_memory",
        headers=_sb_headers(),
        params={"agent": "eq.avery", "memory_text": "like.linkedin_oauth:%", "select": "id"},
        timeout=10,
    )
    r.raise_for_status()
    existing = r.json()

    if existing:
        row_id = existing[0]["id"]
        httpx.patch(
            f"{SUPABASE_URL}/rest/v1/agent_memory?id=eq.{row_id}",
            headers=_sb_headers(),
            json={"memory_text": memory_text},
            timeout=10,
        ).raise_for_status()
        logger.info("Updated existing linkedin_oauth row (id=%s)", row_id)
    else:
        httpx.post(
            f"{SUPABASE_URL}/rest/v1/agent_memory",
            headers={**_sb_headers(), "Prefer": "return=representation"},
            json={"agent": "avery", "memory_text": memory_text, "is_core": True, "pinned": True},
            timeout=10,
        ).raise_for_status()
        logger.info("Created new linkedin_oauth row in agent_memory")


def _exchange_code(code: str) -> dict:
    r = httpx.post(
        "https://www.linkedin.com/oauth/v2/accessToken",
        content=urllib.parse.urlencode({
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
        }),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()


def _run_oauth_flow() -> dict:
    captured: dict = {}

    class _Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            code = params.get("code", [None])[0]
            if code:
                captured["code"] = code
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"<h1>Authorized! You can close this tab.</h1>")
            else:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"<h1>No code in redirect.</h1>")
        def log_message(self, *args): pass  # suppress access log

    server = http.server.HTTPServer(("localhost", 8080), _Handler)
    t = threading.Thread(target=server.serve_forever)
    t.daemon = True
    t.start()

    params = urllib.parse.urlencode({
        "response_type": "code",
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPES,
        "state": "avery-linkedin-setup",
    })
    logger.info("\nOpen this URL in your browser and click Allow:\n\n  https://www.linkedin.com/oauth/v2/authorization?%s\n", params)
    logger.info("Waiting up to 60 seconds for the redirect...")

    for _ in range(60):
        if "code" in captured:
            break
        time.sleep(1)
    server.shutdown()

    if "code" not in captured:
        logger.info("\nTimed out. Paste the full redirect URL here:")
        redirect_url = input("> ").strip()
        params_dict = urllib.parse.parse_qs(urllib.parse.urlparse(redirect_url).query)
        captured["code"] = params_dict["code"][0]

    return _exchange_code(captured["code"])


def main() -> None:
    parser = argparse.ArgumentParser(description="Store LinkedIn OAuth token for Avery")
    parser.add_argument("--token", help="Access token from LinkedIn Developer Portal Token Generator")
    args = parser.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        logger.error("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env")
        sys.exit(1)

    if args.token:
        access_token = args.token
        expires_in = 60 * 24 * 3600  # Portal tokens are 60-day TTL
        refresh_token = ""
    else:
        if not CLIENT_ID or not CLIENT_SECRET:
            logger.error("ERROR: LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET must be set for OAuth flow")
            sys.exit(1)
        token_data = _run_oauth_flow()
        access_token = token_data["access_token"]
        expires_in = token_data.get("expires_in", 5184000)
        refresh_token = token_data.get("refresh_token", "")

    person_urn = _get_person_urn(access_token)
    _store_token(access_token, expires_in, refresh_token)

    expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
    logger.info("\n✓ Token stored in agent_memory")
    logger.info("  Person URN : %s", person_urn)
    logger.info("  Expires    : %s (%d days)", expires_at.strftime("%Y-%m-%d"), expires_in // 86400)
    logger.info("\nAdd to /opt/avery-agent/.env on OVH:")
    logger.info("  LINKEDIN_PERSON_URN=%s", person_urn)
    logger.info("\nThen: docker compose up --force-recreate -d avery-agent")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Verify the script runs (dry-run with a fake token)**

SSH to OVH, then:
```bash
cd /opt/avery-agent
source .env  # confirm SUPABASE_URL is set
python3 scripts/linkedin_oauth.py --token FAKE_TOKEN_FOR_STRUCTURE_CHECK 2>&1 | head -5
```
Expected: fails at `_get_person_urn` with an HTTP error (401 from LinkedIn) — that's correct; the script structure is valid. It would not fail on missing env vars.

- [ ] **Step 3: Commit**

```bash
cd /opt/avery-agent
git add scripts/linkedin_oauth.py
git commit -m "feat: linkedin oauth setup script"
```

---

## Task 2: Token Retrieval Helper

**Files:**
- Modify: `avery-agent/tools/linkedin_tools.py`

**Interfaces:**
- Produces: `async def get_linkedin_token() -> str` — returns access token string; raises `ValueError` if no row exists; logs warning if <7 days to expiry
- Consumed by: Task 4 (`linkedin_post.py`)

- [ ] **Step 1: Add imports to `linkedin_tools.py`**

At the top of `tools/linkedin_tools.py`, after the existing imports, add:
```python
from datetime import datetime, timezone
```
(Check first — `datetime` may already be imported without `timezone`.)

- [ ] **Step 2: Add `get_linkedin_token()` to `linkedin_tools.py`**

Append to the bottom of `tools/linkedin_tools.py`:

```python
async def get_linkedin_token() -> str:
    """
    Retrieve the LinkedIn access token from agent_memory.

    Raises ValueError if no linkedin_oauth row exists.
    Logs a warning (does not raise) if the token expires within 7 days.
    """
    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"{SUPABASE_URL}/rest/v1/agent_memory",
            headers=_sb_headers(),
            params={
                "agent": "eq.avery",
                "memory_text": "like.linkedin_oauth:%",
                "select": "memory_text",
                "limit": "1",
            },
            timeout=10,
        )
        r.raise_for_status()
        rows = r.json()

    if not rows:
        raise ValueError(
            "LinkedIn token not found in agent_memory. "
            "Run: python3 scripts/linkedin_oauth.py --token <token>"
        )

    prefix = "linkedin_oauth: "
    memory_text = rows[0]["memory_text"]
    data = json.loads(memory_text[len(prefix):])
    access_token = data["access_token"]

    expires_at_str = data.get("expires_at", "")
    if expires_at_str:
        expires_at = datetime.fromisoformat(expires_at_str.replace("Z", "+00:00"))
        days_left = (expires_at - datetime.now(timezone.utc)).days
        if days_left <= 7:
            logger.warning(
                "LinkedIn token expires in %d day(s). "
                "Re-run: python3 scripts/linkedin_oauth.py --token <new_token>",
                days_left,
            )

    return access_token
```

- [ ] **Step 3: Write the test**

Create `tests/test_linkedin_post.py` with this first test block:

```python
import json
import pytest
import respx
import httpx
from datetime import datetime, timedelta, timezone

# Guard import for environments without WeasyPrint
try:
    import tools.linkedin_tools as lt
    import tools.linkedin_post as lp
    _available = True
except (ImportError, OSError):
    _available = False

pytestmark = pytest.mark.skipif(not _available, reason="linkedin modules not importable")

SB = "https://sb.test"


@pytest.fixture(autouse=True)
def _patch_env(monkeypatch):
    if _available:
        monkeypatch.setattr(lt, "SUPABASE_URL", SB)
        monkeypatch.setattr(lt, "SUPABASE_KEY", "svc-key")


def _make_token_row(days_until_expiry: int = 30, access_token: str = "tok-abc") -> dict:
    expires_at = (datetime.now(timezone.utc) + timedelta(days=days_until_expiry)).isoformat()
    data = json.dumps({"access_token": access_token, "refresh_token": "", "expires_at": expires_at})
    return {"memory_text": f"linkedin_oauth: {data}"}


@respx.mock
@pytest.mark.asyncio
async def test_get_linkedin_token_returns_access_token():
    respx.get(f"{SB}/rest/v1/agent_memory").mock(
        return_value=httpx.Response(200, json=[_make_token_row(access_token="my-token")])
    )
    token = await lt.get_linkedin_token()
    assert token == "my-token"


@respx.mock
@pytest.mark.asyncio
async def test_get_linkedin_token_raises_when_no_row():
    respx.get(f"{SB}/rest/v1/agent_memory").mock(
        return_value=httpx.Response(200, json=[])
    )
    with pytest.raises(ValueError, match="LinkedIn token not found"):
        await lt.get_linkedin_token()


@respx.mock
@pytest.mark.asyncio
async def test_get_linkedin_token_warns_when_expiring_soon(caplog):
    import logging
    respx.get(f"{SB}/rest/v1/agent_memory").mock(
        return_value=httpx.Response(200, json=[_make_token_row(days_until_expiry=3)])
    )
    with caplog.at_level(logging.WARNING, logger="tools.linkedin_tools"):
        await lt.get_linkedin_token()
    assert "expires in 3 day(s)" in caplog.text
```

- [ ] **Step 4: Run the tests**

```bash
cd /opt/avery-agent
python -m pytest tests/test_linkedin_post.py::test_get_linkedin_token_returns_access_token \
    tests/test_linkedin_post.py::test_get_linkedin_token_raises_when_no_row \
    tests/test_linkedin_post.py::test_get_linkedin_token_warns_when_expiring_soon -v
```
Expected: 3 PASSED

- [ ] **Step 5: Commit**

```bash
git add tools/linkedin_tools.py tests/test_linkedin_post.py
git commit -m "feat: add get_linkedin_token() helper and tests"
```

---

## Task 3: PDF Slide Generation

**Files:**
- Create: `avery-agent/tools/linkedin_post.py` (PDF side only — API functions added in Task 4)

**Interfaces:**
- Produces:
  - `_build_slides_html(slides: list[str]) -> str` — full HTML document string
  - `generate_carousel_pdf(slides: list[str]) -> bytes` — in-memory PDF bytes
- Consumed by: Task 4 (`post_linkedin_carousel`)

- [ ] **Step 1: Write the failing tests for HTML generation**

Add to `tests/test_linkedin_post.py`:

```python
# ── PDF generation tests ─────────────────────────────────────────────────────

def test_build_slides_html_produces_8_slides():
    slides = [f"Slide {i}" for i in range(8)]
    html = lp._build_slides_html(slides)
    assert html.count('class="slide"') == 8


def test_build_slides_html_slide_1_has_hook_class():
    slides = ["Hook text"] + [f"Slide {i}" for i in range(1, 8)]
    html = lp._build_slides_html(slides)
    assert 'class="slide-text hook"' in html


def test_build_slides_html_escapes_html_entities():
    slides = ["<script>alert('xss')</script>"] + ["x"] * 7
    html = lp._build_slides_html(slides)
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_build_slides_html_embeds_slide_numbers():
    slides = ["A"] * 8
    html = lp._build_slides_html(slides)
    for n in range(1, 9):
        assert f"<div class=\"slide-num\">{n}</div>" in html


def test_generate_carousel_pdf_returns_pdf_bytes():
    slides = [f"Slide {i}" for i in range(8)]
    pdf_bytes = lp.generate_carousel_pdf(slides)
    assert isinstance(pdf_bytes, bytes)
    assert pdf_bytes[:4] == b"%PDF"
```

- [ ] **Step 2: Run to confirm they fail**

```bash
python -m pytest tests/test_linkedin_post.py -k "test_build_slides" -v
```
Expected: `ModuleNotFoundError` (file doesn't exist yet) or `ImportError`

- [ ] **Step 3: Create `tools/linkedin_post.py` with PDF generation**

```python
"""
linkedin_post.py — PDF slide generation and LinkedIn API calls for Avery.

Not a LangChain tool — not registered in ALL_TOOLS.
Called by the /linkedin/post endpoint in main.py.
"""
import base64
import logging
import os
import urllib.parse
from pathlib import Path

import httpx
from weasyprint import HTML as WeasyHTML

from tools.linkedin_tools import get_linkedin_token

logger = logging.getLogger(__name__)

LINKEDIN_API = "https://api.linkedin.com"
LI_VERSION = "202306"

# Load logo at module level (same pattern as audit_tools.py)
_LOGO_DATA_URI = ""
try:
    _logo_path = Path("/app/static/rosably-logo-tagline.png")
    if _logo_path.exists():
        _b64 = base64.b64encode(_logo_path.read_bytes()).decode("ascii")
        _LOGO_DATA_URI = f"data:image/png;base64,{_b64}"
except Exception as _e:
    logger.warning("Could not load Rosably logo: %s", _e)

_SLIDE_CSS = """
@page { margin: 0; size: 1080px 1350px; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; }
.slide {
    width: 1080px; height: 1350px; background: #F9F7F4;
    display: flex; flex-direction: column; position: relative;
    page-break-after: always;
}
.top-bar {
    display: flex; justify-content: space-between; align-items: center;
    padding: 48px 60px 0 60px;
}
.logo { height: 36px; width: auto; }
.slide-num {
    width: 52px; height: 52px; border-radius: 50%;
    background: #E8621A; color: white;
    display: flex; align-items: center; justify-content: center;
    font-size: 22px; font-weight: 700;
}
.slide-body {
    flex: 1; display: flex; align-items: center; justify-content: center;
    padding: 80px 120px; text-align: center;
}
.slide-text { color: #1A1A1A; font-size: 52px; font-weight: 500; line-height: 1.3; letter-spacing: -0.5px; }
.slide-text.hook { font-size: 60px; font-weight: 600; }
.bottom-bar { height: 8px; background: #E8621A; flex-shrink: 0; }
"""


def _build_slides_html(slides: list[str]) -> str:
    """Build a full HTML document for all 8 carousel slides."""
    logo_img = f'<img class="logo" src="{_LOGO_DATA_URI}" alt="Rosably">' if _LOGO_DATA_URI else ""
    divs = []
    for i, text in enumerate(slides):
        safe = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        text_class = "slide-text hook" if i == 0 else "slide-text"
        divs.append(f"""<div class="slide">
  <div class="top-bar">{logo_img}<div class="slide-num">{i + 1}</div></div>
  <div class="slide-body"><p class="{text_class}">{safe}</p></div>
  <div class="bottom-bar"></div>
</div>""")
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>{_SLIDE_CSS}</style></head>
<body>{"".join(divs)}</body></html>"""


def generate_carousel_pdf(slides: list[str]) -> bytes:
    """Render carousel slides as an in-memory PDF. Returns raw bytes."""
    return WeasyHTML(string=_build_slides_html(slides)).write_pdf()
```

- [ ] **Step 4: Run the tests**

```bash
python -m pytest tests/test_linkedin_post.py -k "build_slides or generate_carousel" -v
```
Expected: 5 PASSED (note: `test_generate_carousel_pdf_returns_pdf_bytes` may be slow — WeasyPrint renders real PDF)

- [ ] **Step 5: Commit**

```bash
git add tools/linkedin_post.py tests/test_linkedin_post.py
git commit -m "feat: linkedin carousel PDF slide generation"
```

---

## Task 4: LinkedIn API Functions + Orchestrator

**Files:**
- Modify: `avery-agent/tools/linkedin_post.py` (append API functions after PDF section)

**Interfaces:**
- Produces:
  - `_li_headers(token: str) -> dict`
  - `_activity_urn_from_post_urn(post_urn: str) -> str`
  - `async _register_document_upload(token, person_urn) -> tuple[str, str]`
  - `async _upload_document(upload_url, pdf_bytes) -> None`
  - `async _create_post(token, person_urn, document_urn, caption, title) -> str`
  - `async _post_comment(token, person_urn, post_urn, comment_text) -> None`
  - `async post_linkedin_carousel(approval_id: str, payload: dict) -> dict`
- Consumed by: Task 5 (`main.py` endpoint)

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_linkedin_post.py`:

```python
# ── LinkedIn API helper tests ─────────────────────────────────────────────────

def test_activity_urn_from_share_urn():
    result = lp._activity_urn_from_post_urn("urn:li:share:6844785523593134080")
    assert result == "urn:li:activity:6844785523593134080"


def test_activity_urn_from_ugcpost_urn():
    result = lp._activity_urn_from_post_urn("urn:li:ugcPost:68447855235931240")
    assert result == "urn:li:activity:68447855235931240"


def test_li_headers_contains_required_fields():
    headers = lp._li_headers("my-token")
    assert headers["Authorization"] == "Bearer my-token"
    assert headers["LinkedIn-Version"] == "202306"
    assert headers["X-Restli-Protocol-Version"] == "2.0.0"
    assert headers["Content-Type"] == "application/json"


@respx.mock
@pytest.mark.asyncio
async def test_register_document_upload_returns_url_and_urn():
    respx.post("https://api.linkedin.com/rest/documents").mock(
        return_value=httpx.Response(200, json={
            "value": {
                "uploadUrl": "https://uploads.li.com/abc",
                "uploadUrlExpiresAt": 9999999999,
                "document": "urn:li:document:D5510ABC",
            }
        })
    )
    upload_url, doc_urn = await lp._register_document_upload("tok", "urn:li:person:123")
    assert upload_url == "https://uploads.li.com/abc"
    assert doc_urn == "urn:li:document:D5510ABC"


@respx.mock
@pytest.mark.asyncio
async def test_create_post_returns_post_urn_from_header():
    respx.post("https://api.linkedin.com/rest/posts").mock(
        return_value=httpx.Response(201, headers={"x-restli-id": "urn:li:share:111222333"}, json={})
    )
    post_urn = await lp._create_post("tok", "urn:li:person:123", "urn:li:document:abc", "Caption", "Title")
    assert post_urn == "urn:li:share:111222333"


@respx.mock
@pytest.mark.asyncio
async def test_post_comment_sends_correct_body():
    post_urn = "urn:li:share:111222333"
    encoded_urn = urllib.parse.quote(post_urn, safe="")
    route = respx.post(f"https://api.linkedin.com/rest/socialActions/{encoded_urn}/comments").mock(
        return_value=httpx.Response(201, json={})
    )
    await lp._post_comment("tok", "urn:li:person:123", post_urn, "Full post: https://rosably.com/x")
    body = json.loads(route.calls.last.request.content)
    assert body["actor"] == "urn:li:person:123"
    assert body["object"] == "urn:li:activity:111222333"
    assert body["message"]["text"] == "Full post: https://rosably.com/x"
```

- [ ] **Step 2: Run to confirm they fail**

```bash
python -m pytest tests/test_linkedin_post.py -k "test_activity_urn or test_li_headers or test_register or test_create_post or test_post_comment" -v
```
Expected: failures (functions not yet defined)

- [ ] **Step 3: Append API functions to `tools/linkedin_post.py`**

Add after the `generate_carousel_pdf` function:

```python
def _li_headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "LinkedIn-Version": LI_VERSION,
        "X-Restli-Protocol-Version": "2.0.0",
        "Content-Type": "application/json",
    }


def _activity_urn_from_post_urn(post_urn: str) -> str:
    """Derive activity URN from a share or ugcPost URN by replacing the type prefix."""
    numeric_id = post_urn.rsplit(":", 1)[-1]
    return f"urn:li:activity:{numeric_id}"


async def _register_document_upload(token: str, person_urn: str) -> tuple[str, str]:
    """Register a LinkedIn document upload. Returns (upload_url, document_urn)."""
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{LINKEDIN_API}/rest/documents?action=initializeUpload",
            headers=_li_headers(token),
            json={"initializeUploadRequest": {"owner": person_urn}},
            timeout=20,
        )
        r.raise_for_status()
    value = r.json()["value"]
    return value["uploadUrl"], value["document"]


async def _upload_document(upload_url: str, pdf_bytes: bytes) -> None:
    """PUT PDF bytes to the LinkedIn upload URL."""
    async with httpx.AsyncClient() as client:
        r = await client.put(
            upload_url,
            content=pdf_bytes,
            headers={"Content-Type": "application/octet-stream"},
            timeout=60,
        )
        r.raise_for_status()


async def _create_post(
    token: str,
    person_urn: str,
    document_urn: str,
    caption: str,
    title: str,
) -> str:
    """Create a LinkedIn document post. Returns the post URN from x-restli-id header."""
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{LINKEDIN_API}/rest/posts",
            headers=_li_headers(token),
            json={
                "author": person_urn,
                "commentary": caption,
                "visibility": "PUBLIC",
                "distribution": {
                    "feedDistribution": "MAIN_FEED",
                    "targetEntities": [],
                    "thirdPartyDistributionChannels": [],
                },
                "content": {"media": {"id": document_urn, "title": title}},
                "lifecycleState": "PUBLISHED",
                "isReshareDisabledByAuthor": False,
            },
            timeout=20,
        )
        r.raise_for_status()
    return r.headers["x-restli-id"]


async def _post_comment(token: str, person_urn: str, post_urn: str, comment_text: str) -> None:
    """Post the first comment (URL) on a LinkedIn post."""
    encoded_post_urn = urllib.parse.quote(post_urn, safe="")
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{LINKEDIN_API}/rest/socialActions/{encoded_post_urn}/comments",
            headers=_li_headers(token),
            json={
                "actor": person_urn,
                "object": _activity_urn_from_post_urn(post_urn),
                "message": {"text": comment_text},
            },
            timeout=20,
        )
        r.raise_for_status()


async def post_linkedin_carousel(approval_id: str, payload: dict) -> dict:
    """
    Full LinkedIn posting flow for one carousel approval.

    Args:
        approval_id: Supabase approval row ID (used for the PDF title).
        payload: The approval's payload dict with keys:
            carousel_slides, caption, comment_text, post_title.

    Returns:
        {"post_urn": "urn:li:share:...", "post_url": "https://www.linkedin.com/feed/update/..."}

    Raises:
        ValueError: if LINKEDIN_PERSON_URN env var is missing or token not in agent_memory.
        RuntimeError: with the failed step name prefix (e.g. "document_upload: HTTP 401").
    """
    person_urn = os.getenv("LINKEDIN_PERSON_URN", "")
    if not person_urn:
        raise ValueError("LINKEDIN_PERSON_URN not set in env — run scripts/linkedin_oauth.py first")

    slides = payload.get("carousel_slides", [])
    caption = payload.get("caption", "")
    comment_text = payload.get("comment_text", "")
    post_title = payload.get("post_title") or f"linkedin-carousel-{approval_id}.pdf"

    token = await get_linkedin_token()

    try:
        pdf_bytes = generate_carousel_pdf(slides)
    except Exception as e:
        raise RuntimeError(f"pdf_generation: {e}") from e

    try:
        upload_url, document_urn = await _register_document_upload(token, person_urn)
    except Exception as e:
        raise RuntimeError(f"document_register: {e}") from e

    try:
        await _upload_document(upload_url, pdf_bytes)
    except Exception as e:
        raise RuntimeError(f"document_upload: {e}") from e

    try:
        post_urn = await _create_post(token, person_urn, document_urn, caption, post_title)
    except Exception as e:
        raise RuntimeError(f"post_create: {e}") from e

    if comment_text:
        try:
            await _post_comment(token, person_urn, post_urn, comment_text)
        except Exception as e:
            logger.warning("post_comment failed (post is live, comment not added): %s", e)

    post_url = f"https://www.linkedin.com/feed/update/{post_urn}/"
    return {"post_urn": post_urn, "post_url": post_url}
```

- [ ] **Step 4: Run all tests**

```bash
python -m pytest tests/test_linkedin_post.py -v
```
Expected: all tests PASSED

- [ ] **Step 5: Commit**

```bash
git add tools/linkedin_post.py tests/test_linkedin_post.py
git commit -m "feat: linkedin API functions and post_linkedin_carousel orchestrator"
```

---

## Task 5: Avery `/linkedin/post` Endpoint

**Files:**
- Modify: `avery-agent/main.py`

**Interfaces:**
- Consumes: `post_linkedin_carousel(approval_id, payload)` from `tools/linkedin_post`
- Produces: `POST /linkedin/post` → `{ ok: true, post_url: "..." }` or HTTP 500

- [ ] **Step 1: Add the import**

In `main.py`, find the block of `from tools.*` imports and add:

```python
from tools.linkedin_post import post_linkedin_carousel
```

- [ ] **Step 2: Add the endpoint**

In `main.py`, after the `/linkedin/repurpose` endpoint (around line 388), add:

```python
@app.post("/linkedin/post")
async def linkedin_post_endpoint(request: Request):
    """
    Called by the dashboard PATCH /api/approvals when a linkedin_carousel
    approval is approved. Generates the PDF carousel and posts to LinkedIn.
    Body: { "approval_id": "<uuid>" }
    Returns: { "ok": true, "post_url": "https://www.linkedin.com/feed/update/..." }
    """
    _check_secret(request)
    body = await request.json()
    approval_id = body.get("approval_id")
    if not approval_id:
        raise HTTPException(status_code=400, detail="approval_id required")

    # Fetch the approval row
    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"{SUPABASE_URL}/rest/v1/pending_approvals",
            headers=_sb_headers(),
            params={"id": f"eq.{approval_id}", "select": "id,payload,title"},
            timeout=10,
        )
        r.raise_for_status()
        rows = r.json()

    if not rows:
        raise HTTPException(status_code=404, detail=f"Approval {approval_id} not found")

    payload = rows[0].get("payload") or {}

    try:
        result = await post_linkedin_carousel(approval_id, payload)
    except Exception as e:
        logger.error("linkedin_post failed for approval %s: %s", approval_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

    # Write the live post URL back to the approval payload
    updated_payload = {**payload, "linkedin_post_url": result["post_url"]}
    async with httpx.AsyncClient() as client:
        await client.patch(
            f"{SUPABASE_URL}/rest/v1/pending_approvals?id=eq.{approval_id}",
            headers=_sb_headers(),
            json={"payload": updated_payload},
            timeout=10,
        )

    logger.info("linkedin_post: posted approval %s → %s", approval_id, result["post_url"])
    return {"ok": True, "post_url": result["post_url"]}
```

Note: `_sb_headers()` and `SUPABASE_URL` are already defined in `main.py`'s module scope via the existing `log_to_supabase` helper. Confirm they exist before adding; if not, add:
```python
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "") or os.getenv("SUPABASE_ANON_KEY", "")

def _sb_headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
```

- [ ] **Step 3: Verify health endpoint still works**

```bash
# On OVH after docker compose build && up -d:
curl -s https://avery.rosably.com/health
```
Expected: `{"status":"ok","agent":"avery"}`

- [ ] **Step 4: Smoke-test the endpoint (requires a real approval_id)**

```bash
# Pick any linkedin_carousel approval_id from Supabase
APPROVAL_ID="<paste-uuid-here>"
curl -X POST https://avery.rosably.com/linkedin/post \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $WEBHOOK_SECRET" \
  -d "{\"approval_id\": \"$APPROVAL_ID\"}"
```
Expected: `{"ok":true,"post_url":"https://www.linkedin.com/feed/update/..."}` (requires real LinkedIn credentials in `.env`)

If LinkedIn creds not yet set up, expected: `{"detail":"LINKEDIN_PERSON_URN not set in env ..."}` with HTTP 500 — correct behavior, env not yet configured.

- [ ] **Step 5: Commit**

```bash
git add main.py
git commit -m "feat: POST /linkedin/post endpoint"
```

---

## Task 6: Dashboard Executor Branch

**Files:**
- Modify: `dashboard/src/app/api/approvals/route.ts`

**Interfaces:**
- Consumes: Avery `POST /linkedin/post`
- Produces: `{ success: true, post: { ok, detail, post_url? } }` in PATCH response

- [ ] **Step 1: Add the executor block**

In `route.ts`, find the `isStackAudit` block (ends around line 166) and add immediately after its closing brace:

```typescript
// ── APPROVED → post LinkedIn carousel ───────────────────────────────────────
if (status === "approved" && approval?.agent === "avery" && approval?.action_type === "linkedin_carousel") {
  if (!reviewer) {
    return NextResponse.json(
      { error: "LinkedIn post blocked: no human reviewer on record" },
      { status: 403 },
    );
  }
  if (!avUrl || !secret) {
    await supabaseAdmin.from("workflow_logs").insert({
      workflow_name: "Dashboard LinkedIn Post Gate",
      agent: "avery",
      trigger_text: approval.title ?? `approval ${id}`,
      status: "error",
      error_message: "Missing AVERY_AGENT_URL or webhook secret",
    });
    return NextResponse.json({ success: true, post: { ok: false, detail: "config missing" } });
  }

  let postResult: { ok: boolean; detail: string; post_url?: string };
  try {
    const res = await fetch(`${avUrl}/linkedin/post`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret },
      body: JSON.stringify({ approval_id: approval.id }),
    });
    const resBody = await res.json().catch(() => ({}));
    postResult = {
      ok: res.ok,
      detail: res.ok
        ? `posted by ${reviewer}`
        : `avery returned HTTP ${res.status}: ${(resBody as { detail?: string }).detail ?? ""}`,
      post_url: (resBody as { post_url?: string }).post_url,
    };
  } catch (e) {
    postResult = { ok: false, detail: e instanceof Error ? e.message : "linkedin/post call failed" };
  }

  await supabaseAdmin.from("workflow_logs").insert({
    workflow_name: "Dashboard LinkedIn Post Gate",
    agent: "avery",
    trigger_text: approval.title ?? `approval ${id}`,
    status: postResult.ok ? "success" : "error",
    ...(postResult.ok ? {} : { error_message: postResult.detail }),
  });

  return NextResponse.json({ success: true, post: postResult });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /opt/rosenfelt/rosenfelt-dashboard
npm run build 2>&1 | tail -20
```
Expected: build completes with no TypeScript errors

- [ ] **Step 3: Commit**

```bash
git add src/app/api/approvals/route.ts
git commit -m "feat: linkedin_carousel executor branch in approvals route"
```

---

## Task 7: Dashboard UI — View on LinkedIn Link

**Files:**
- Modify: `dashboard/src/components/ApprovalCard.tsx`

**Interfaces:**
- Consumes: `approval.payload.linkedin_post_url` (string, set by Avery after posting)
- Produces: "View on LinkedIn ↗" link in `LinkedInCarouselDetail` metadata row

- [ ] **Step 1: Add the link to `LinkedInCarouselDetail`**

In `ApprovalCard.tsx`, find the `LinkedInCarouselDetail` component (line ~92). Locate the `const day = ...` line and add after it:

```tsx
const postLiveUrl = (payload?.linkedin_post_url as string) ?? "";
```

Then in the metadata row (the `<div className="flex flex-wrap ...">` containing the day badge and source post link), add before the closing `</div>`:

```tsx
{postLiveUrl && (
  <a
    href={postLiveUrl}
    target="_blank"
    rel="noopener noreferrer"
    className="text-[11px] font-medium text-green-700 bg-green-50 px-1.5 py-0.5 rounded hover:underline flex items-center gap-1"
  >
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
    </svg>
    View on LinkedIn
  </a>
)}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /opt/rosenfelt/rosenfelt-dashboard
npm run build 2>&1 | tail -10
```
Expected: no errors

- [ ] **Step 3: Commit and push (triggers Vercel deploy)**

```bash
git add src/components/ApprovalCard.tsx
git commit -m "feat: view on LinkedIn link in carousel approval card"
git push origin main
```

- [ ] **Step 4: Verify the link appears**

1. In Supabase SQL editor, find a `linkedin_carousel` approval that has been posted and check its `payload.linkedin_post_url` is set
2. Open `dashboard.rosably.com/approvals?history=true`
3. Locate the carousel card in the History tab
4. Confirm the green "View on LinkedIn" link is visible and opens the correct URL

---

## Post-Setup: Configure LinkedIn Credentials

After all tasks are merged and deployed, complete the one-time setup:

1. Create a LinkedIn Developer App at `linkedin.com/developers/apps`
   - Add `http://localhost:8080/callback` as a redirect URI
   - Enable the **Share on LinkedIn** product (grants `w_member_social`)
   - Also enable **Sign In with LinkedIn using OpenID Connect** (grants `openid`, `profile`)

2. Add to `/opt/avery-agent/.env` on OVH:
   ```
   LINKEDIN_CLIENT_ID=<your-client-id>
   LINKEDIN_CLIENT_SECRET=<your-client-secret>
   ```

3. Get a token from the LinkedIn Developer Portal Token Generator:
   - Visit `linkedin.com/developers/tools/oauth/token-generator`
   - Select your app, choose scopes: `openid`, `profile`, `w_member_social`
   - Copy the generated token

4. Run the setup script on OVH:
   ```bash
   cd /opt/avery-agent
   python3 scripts/linkedin_oauth.py --token <paste-token-here>
   ```
   Copy the printed `LINKEDIN_PERSON_URN` and add it to `.env`

5. Force-recreate Avery to pick up the new env vars:
   ```bash
   docker compose up --force-recreate -d avery-agent
   curl https://avery.rosably.com/health
   ```

6. Test end-to-end: approve a `linkedin_carousel` row in the dashboard and verify the post appears on LinkedIn.

**Token renewal (every 60 days):** repeat steps 3–4 only.
