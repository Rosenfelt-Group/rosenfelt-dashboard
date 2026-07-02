# Finance UI Design
**Date:** 2026-07-02
**Status:** Approved

## Goal

Rebuild `/finance` as a unified, tabbed finance hub that consolidates business bookkeeping (Kick), Stripe revenue, AI cost, and Sam's action queue — replacing the current thin link-list hub. The existing `/billing` and `/cost` pages stay alive as thin wrappers so bookmarks and nav links keep working.

---

## Architecture

### Approach: Component extraction

Pull page content from `/billing/page.tsx` and `/cost/page.tsx` into shared panel components. Existing pages become one-liner wrappers. `/finance/page.tsx` is rebuilt as a 5-tab shell that imports all panels.

### Files changed

**Extracted components (no behavior change):**
- `src/components/finance/BillingPanel.tsx` — content from `/billing/page.tsx`; drops own `<h1>` and outer padding
- `src/components/finance/CostPanel.tsx` — content from `/cost/page.tsx`; drops own `<h1>` and outer padding

**Existing pages become thin wrappers:**
- `src/app/(dashboard)/billing/page.tsx` → `return <BillingPanel />`
- `src/app/(dashboard)/cost/page.tsx` → `return <CostPanel />`

**New components:**
- `src/components/finance/OverviewPanel.tsx`
- `src/components/finance/BookkeepingPanel.tsx`
- `src/components/finance/SamActionsPanel.tsx`

**Rebuilt:**
- `src/app/(dashboard)/finance/page.tsx` — 5-tab shell

**New dashboard API route:**
- `src/app/api/kick/transactions/route.ts` — proxies `GET /kick/transactions` on sam-agent (secret-gated)

**New sam-agent endpoint:**
- `GET /kick/transactions` in `main.py` — calls Kick MCP `transactions_list`, returns `[{date, description, amount, type, category}]`; secret-gated via `X-Webhook-Secret`
- Helper in `tools/kick_tools.py`: `get_kick_transactions(limit=50)`

### Tab routing

Tab state in `?tab=` query param. Valid values: `overview` (default), `bookkeeping`, `stripe`, `cost`, `sam-actions`. Browser back/forward works; tabs are bookmarkable. Implemented with `useSearchParams` + `router.replace` on tab click.

---

## Tab Designs

### Tab 1: Overview

**Stat row — 4 cards, fetched in parallel via `Promise.all`:**

| Card | Endpoint | Value |
|---|---|---|
| Business net (MTD) | `/api/kick/status` → `pnl.net` | Net P&L this month |
| Stripe MRR | `/api/stripe/dashboard?mode=live` | MRR in dollars |
| AI cost (7d) | `/api/usage` | Sum across all agents |
| Sam pending | `/api/approvals` (pending, filtered client-side to `agent === "sam"`) | Count of Sam's queued actions |

Each card has an independent skeleton/error state — one failing doesn't blank the others.

**Sam inbox (below stat row):**
- First 5 pending Sam approvals via `ApprovalCard` (existing component, same `handleApproval` flow)
- "View all →" routes to `?tab=sam-actions`
- Zero-state: "Sam is running autonomously"

No new API calls — all four endpoints already exist.

---

### Tab 2: Bookkeeping

**Layout:** Two-column on desktop (left: P&L + ledger; right: Sam chat), single-column on mobile (chat collapses below).

**Left column — P&L summary strip:**
- 3 stat tiles: Income / Expenses / Net for last 30 days
- Date range derived from `/api/kick/status` — re-fetched on Bookkeeping tab mount (independent fetch, not shared with Overview)
- Period selector (Last 30d / Last 90d / MTD) sends a natural-language request to Sam via `/api/chat` rather than a dedicated query param

**Left column — Transaction ledger:**
- Fetches `GET /api/kick/transactions` on tab mount
- Scrollable list: date, description, amount (green=income, neutral=expense), category
- Client-side filter toggle: All / Income / Expenses
- Returns last 50 transactions — no pagination
- Error/offline fallback: "Sam is offline — ask via chat" message pointing at the right panel

**Right column — Inline Sam chat:**
- POSTs to `/api/chat` with `agent: "sam"`
- Local session-only message history (not persisted)
- Pre-seeded hint: *"Ask Sam about your finances, request a report, or draft an invoice."*
- Fixed-height panel with internal scroll; input pinned to bottom
- Streaming responses via SSE (same pattern as `/chat` page)

---

### Tab 3: Stripe

Renders `<BillingPanel />` — zero behavior change from current `/billing` page.

Content: Live/Test toggle, MRR stat row, subscriptions/invoices/customers/refunds sub-tabs, refund modal.

---

### Tab 4: AI Cost

Renders `<CostPanel />` — zero behavior change from current `/cost` page.

Content: per-agent cost cards, daily breakdown table, 30-day chart, config panel.

---

### Tab 5: Sam Actions

**Quick-compose bar (top):**
- Single text input, placeholder: *"Ask Sam to…"*
- On submit: POST `/api/chat` with `agent: "sam"` and the typed message
- Sam's response displays as a temporary dismissible card below the input (not a full chat thread — just the reply to that one request)
- Clears after dismissal

**Pending actions:**
- Full list of Sam's pending approvals (no 5-item cap)
- `ApprovalCard` with same `handleApproval` flow (approve / reject / revision)

**History (below divider):**
- Fetches `/api/approvals?history=true`
- Client-side filtered to `agent === "sam"` and `status !== "pending"`
- Compact read-only rows: timestamp, action type, title, status badge
- No re-action — read-only record

---

## Error handling

- `/api/kick/status` or `/api/kick/transactions` unreachable: show inline error card on Bookkeeping tab; Overview stat card shows "—" with muted text
- `/api/stripe/dashboard` unreachable: Overview MRR card shows "—"; Stripe tab shows existing error state from `BillingPanel`
- Sam chat offline: inline error in chat panel and transaction ledger fallback message
- All panels load independently — tab shell never blocks on a failing panel

---

## What is NOT in scope

- Kick date-range queries via a dedicated API param (Period selector goes through Sam chat instead)
- Transaction pagination (50 items covers normal use; Sam chat handles longer lookups)
- Persisted Sam chat history on Bookkeeping tab (session-only; full history is in `/agents/history`)
- Any new Supabase schema changes
- Sam email send wiring (N8N webhook still not configured — no change to that gap)
