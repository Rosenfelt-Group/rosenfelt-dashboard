# Finance UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/finance` as a 5-tab unified hub (Overview · Bookkeeping · Stripe · AI Cost · Sam Actions) by extracting existing page content into shared panel components, adding a Kick transactions endpoint on sam-agent, and wiring everything together.

**Architecture:** Extract `BillingPanel` and `CostPanel` from their current pages so `/billing` and `/cost` keep working as one-liner wrappers. Build three new panels (`OverviewPanel`, `BookkeepingPanel`, `SamActionsPanel`). Rebuild `/finance/page.tsx` as a tabbed shell using `?tab=` query param routing. Add `GET /kick/transactions` to sam-agent and proxy it through the dashboard API.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS (brand utility classes), `clsx`, Supabase client, `useSearchParams` / `useRouter`. No test runner — verification is browser-based.

## Global Constraints

- Node.js 20.x only — do not bump to 22+
- Brand utility classes: `text-brand-black`, `text-brand-muted`, `text-brand-orange`, `bg-brand-offwhite`, `border-brand-border`, `card` (base card style). No raw Tailwind colors for brand values.
- Default branch is `main` for every repo
- Dashboard auto-deploys to Vercel on push to `main`
- Sam-agent deploys on OVH: `cd /opt/sam-agent && git pull && docker compose build && docker compose up -d`
- No Supabase schema changes in this feature
- Tab query param values: `overview` (default), `bookkeeping`, `stripe`, `cost`, `sam-actions`
- `/api/approvals?history=true` returns up to 200 rows all statuses — filter client-side to `agent === "sam"`
- `/api/chat` returns `{ response: string, agent: string }` synchronously — not SSE streaming
- `useSearchParams()` in Next.js 14 requires the component to be wrapped in a `<Suspense>` boundary

---

## File Map

| Status | Path | Responsibility |
|---|---|---|
| **Extract** | `src/components/finance/BillingPanel.tsx` | All content from `/billing/page.tsx`; named export; drops `<h1>` |
| **Extract** | `src/components/finance/CostPanel.tsx` | All content from `/cost/page.tsx`; named export; drops `<h1>` |
| **Thin wrapper** | `src/app/(dashboard)/billing/page.tsx` | `return <BillingPanel />` |
| **Thin wrapper** | `src/app/(dashboard)/cost/page.tsx` | `return <CostPanel />` |
| **New** | `src/components/finance/OverviewPanel.tsx` | Stat row (4 cards) + Sam pending inbox |
| **New** | `src/components/finance/BookkeepingPanel.tsx` | P&L strip + transaction ledger + inline Sam chat |
| **New** | `src/components/finance/SamActionsPanel.tsx` | Quick-compose bar + full pending queue + history |
| **Rebuild** | `src/app/(dashboard)/finance/page.tsx` | 5-tab shell with `?tab=` routing |
| **New (dashboard)** | `src/app/api/kick/transactions/route.ts` | Proxy `GET /kick/transactions` on sam-agent |
| **New (sam-agent)** | `tools/kick_tools.py` | `get_kick_transactions(limit)` helper |
| **Modify (sam-agent)** | `main.py` | `GET /kick/transactions` endpoint |

---

## Task 1: Extract BillingPanel

**Files:**
- Create: `src/components/finance/BillingPanel.tsx`
- Modify: `src/app/(dashboard)/billing/page.tsx`

**Interfaces:**
- Produces: `export function BillingPanel(): JSX.Element`

- [ ] **Step 1: Copy billing page content into BillingPanel**

Create `src/components/finance/BillingPanel.tsx`. Copy the **entire** content of `src/app/(dashboard)/billing/page.tsx` verbatim, then make these three targeted changes:

1. Change `export default function BillingPage()` → `export function BillingPanel()`
2. Inside the return JSX, find the header `<div className="flex items-center justify-between mb-6 flex-wrap gap-3">`. Remove the first child `<div>` that contains the `<h1>` and the subtitle `<p>` (two lines). Change the outer flex div's class from `justify-between` to `justify-end`. The toggle and "Open Stripe ↗" link stay.

Before (the header div's first child — remove this):
```tsx
<div>
  <h1 className="text-xl font-semibold text-brand-black">Stripe Billing</h1>
  <p className="text-sm text-brand-muted mt-0.5">Subscriptions, invoices, and customers</p>
</div>
```

After (outer flex div class change):
```tsx
<div className="flex items-center justify-end mb-6 flex-wrap gap-3">
```

- [ ] **Step 2: Replace billing/page.tsx with a thin wrapper**

Replace the entire content of `src/app/(dashboard)/billing/page.tsx` with:

```tsx
import { BillingPanel } from "@/components/finance/BillingPanel";
export default function BillingPage() {
  return <BillingPanel />;
}
```

- [ ] **Step 3: Verify in browser**

Push to `main`. Once Vercel deploys, open `https://dashboard.rosably.com/billing` and confirm:
- Stripe billing data still loads (Live/Test toggle works)
- No `<h1>Stripe Billing</h1>` visible (header now shows only toggle + Stripe link)
- Subscriptions / invoices / customers / refunds tabs still work
- Refund modal still works

- [ ] **Step 4: Commit**

```bash
cd /opt/rosenfelt/rosenfelt-dashboard
git add src/components/finance/BillingPanel.tsx src/app/\(dashboard\)/billing/page.tsx
git commit -m "refactor: extract BillingPanel component, billing page becomes thin wrapper"
git push origin main
```

---

## Task 2: Extract CostPanel

**Files:**
- Create: `src/components/finance/CostPanel.tsx`
- Modify: `src/app/(dashboard)/cost/page.tsx`

**Interfaces:**
- Produces: `export function CostPanel(): JSX.Element`

- [ ] **Step 1: Copy cost page content into CostPanel**

Create `src/components/finance/CostPanel.tsx`. Copy the **entire** content of `src/app/(dashboard)/cost/page.tsx` verbatim, then make these two targeted changes:

1. Change `export default function CostPage()` → `export function CostPanel()`
2. Inside the return JSX, find and remove the `<h1>` element (it renders "AI Cost" or similar heading). The outer page padding div stays.

Find the heading element — it will look like:
```tsx
<h1 className="text-xl font-semibold text-brand-black">AI Cost</h1>
```
Delete that line only.

- [ ] **Step 2: Replace cost/page.tsx with a thin wrapper**

Replace the entire content of `src/app/(dashboard)/cost/page.tsx` with:

```tsx
import { CostPanel } from "@/components/finance/CostPanel";
export default function CostPage() {
  return <CostPanel />;
}
```

- [ ] **Step 3: Verify in browser**

Open `https://dashboard.rosably.com/cost` and confirm:
- Agent cost cards load with 7-day data
- Daily breakdown table renders
- No duplicate heading visible

- [ ] **Step 4: Commit**

```bash
git add src/components/finance/CostPanel.tsx src/app/\(dashboard\)/cost/page.tsx
git commit -m "refactor: extract CostPanel component, cost page becomes thin wrapper"
git push origin main
```

---

## Task 3: Add /kick/transactions to sam-agent (OVH deploy)

**Files (sam-agent repo on OVH at `/opt/sam-agent`):**
- Modify: `tools/kick_tools.py`
- Modify: `main.py`

**Interfaces:**
- Produces: `GET /kick/transactions` → `200 { transactions: KickTransaction[] }` where `KickTransaction = { date: string, description: string, amount: number, type: "income" | "expense", category: string }`

> **Note:** Sam-agent source lives on OVH at `/opt/sam-agent`. SSH to `brian@40.160.3.254` before these steps. The GitHub remote is `Rosenfelt-Group/sam-agent` — check live branch with `git status` before pulling.

- [ ] **Step 1: SSH to OVH and check live branch**

```bash
ssh brian@40.160.3.254
cd /opt/sam-agent
git status
git branch
```

Expected: on `main` (or note whatever branch is live — do NOT pull if on a feature branch).

- [ ] **Step 2: Add get_kick_transactions helper to kick_tools.py**

Open `tools/kick_tools.py`. Add this function after `get_kick_summary` (mirror its `_run_report` pattern — look at how `get_kick_summary` calls the Kick MCP and adapt for transactions):

```python
async def get_kick_transactions(limit: int = 50) -> list[dict]:
    """Fetch recent transactions from Kick bookkeeping."""
    import os
    import json
    import httpx

    endpoint = "https://use.kick.co/mcp"
    api_key = os.environ.get("KICK_API_KEY", "")
    workspace_id = os.environ.get("KICK_WORKSPACE_ID", "")
    entity_id = os.environ.get("KICK_ENTITY_ID", "")
    ledger_id = os.environ.get("KICK_LEDGER_ID", "")

    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "transactions_list",
            "arguments": {
                "params": {
                    "workspaceId": workspace_id,
                    "entityId": entity_id,
                    "ledgerId": ledger_id,
                    "limit": limit,
                }
            }
        }
    }

    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.post(
            endpoint,
            json=payload,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        )
        res.raise_for_status()
        data = res.json()

    raw = data.get("result", {}).get("content", [{}])[0].get("text", "[]")
    try:
        items = json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        items = []

    transactions = []
    for item in (items if isinstance(items, list) else []):
        amount = float(item.get("amount", 0))
        transactions.append({
            "date": item.get("date", ""),
            "description": item.get("description", item.get("memo", "")),
            "amount": abs(amount),
            "type": "income" if amount > 0 else "expense",
            "category": item.get("category", item.get("accountName", "")),
        })

    return transactions
```

> **Important:** The exact field names from Kick (`date`, `description`, `amount`, `category`) depend on what Kick's `transactions_list` action returns. Check the actual response shape by running a manual test in Step 4 — adjust field names if needed.

- [ ] **Step 3: Add GET /kick/transactions endpoint to main.py**

Open `main.py`. Find the `GET /kick/status` endpoint and add the new endpoint right after it:

```python
@app.get("/kick/transactions")
async def kick_transactions(request: Request):
    secret = request.headers.get("X-Webhook-Secret", "")
    if secret != os.environ.get("WEBHOOK_SECRET", ""):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    try:
        from tools.kick_tools import get_kick_transactions
        transactions = await get_kick_transactions(limit=50)
        return JSONResponse({"transactions": transactions})
    except Exception as e:
        logger.error(f"kick_transactions error: {e}")
        return JSONResponse({"transactions": [], "error": str(e)}, status_code=200)
```

> Error returns 200 (not 500) with an empty list so the dashboard shows a graceful fallback rather than a hard error.

- [ ] **Step 4: Deploy and verify**

```bash
cd /opt/sam-agent
git add tools/kick_tools.py main.py
git commit -m "feat: add GET /kick/transactions endpoint"
git push origin main
docker compose build && docker compose up -d
```

Wait ~30 seconds, then test:

```bash
WEBHOOK_SECRET=$(grep WEBHOOK_SECRET /opt/sam-agent/.env | cut -d= -f2)
curl -s -H "X-Webhook-Secret: $WEBHOOK_SECRET" https://sam.rosably.com/kick/transactions | python3 -m json.tool | head -40
```

Expected: `{"transactions": [...]}` — a list of objects with `date`, `description`, `amount`, `type`, `category`. If the list is empty, check field name mapping in `get_kick_transactions` against the raw Kick response and adjust.

- [ ] **Step 5: Log off OVH**

```bash
exit
```

---

## Task 4: Add /api/kick/transactions to dashboard

**Files:**
- Create: `src/app/api/kick/transactions/route.ts`

**Interfaces:**
- Consumes: `GET https://sam.rosably.com/kick/transactions` (Task 3)
- Produces: `GET /api/kick/transactions` → `{ transactions: KickTransaction[] }`

- [ ] **Step 1: Create the proxy route**

Create `src/app/api/kick/transactions/route.ts`:

```typescript
import { NextResponse } from "next/server";

export const maxDuration = 20;

export interface KickTransaction {
  date: string;
  description: string;
  amount: number;
  type: "income" | "expense";
  category: string;
}

export async function GET() {
  const baseUrl = process.env.SAM_AGENT_URL;
  const secret = process.env.SAM_WEBHOOK_SECRET ?? process.env.JORDAN_WEBHOOK_SECRET ?? "";

  if (!baseUrl) {
    return NextResponse.json({ transactions: [], error: "SAM_AGENT_URL not configured" });
  }

  try {
    const res = await fetch(`${baseUrl}/kick/transactions`, {
      headers: { "X-Webhook-Secret": secret },
      signal: AbortSignal.timeout(18000),
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { transactions: [], error: `sam-agent HTTP ${res.status}` },
        { status: 200 },
      );
    }

    return NextResponse.json(await res.json());
  } catch (e: unknown) {
    return NextResponse.json(
      { transactions: [], error: e instanceof Error ? e.message : "sam-agent unreachable" },
      { status: 200 },
    );
  }
}
```

- [ ] **Step 2: Verify the route**

Push to `main`, then after Vercel deploys:

```bash
curl -s "https://dashboard.rosably.com/api/kick/transactions" | python3 -m json.tool | head -30
```

Expected: `{"transactions": [...]}` matching what sam-agent returned in Task 3.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/kick/transactions/route.ts"
git commit -m "feat: add /api/kick/transactions dashboard proxy route"
git push origin main
```

---

## Task 5: Build OverviewPanel

**Files:**
- Create: `src/components/finance/OverviewPanel.tsx`

**Interfaces:**
- Consumes: `GET /api/kick/status`, `GET /api/stripe/dashboard?mode=live`, `GET /api/usage`, `GET /api/approvals` (client-side filter: `agent === "sam"` and `status === "pending"`)
- Consumes: `PATCH /api/approvals` for approval actions
- Produces: `export function OverviewPanel(): JSX.Element`

- [ ] **Step 1: Create OverviewPanel.tsx**

Create `src/components/finance/OverviewPanel.tsx`:

```tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ApprovalCard } from "@/components/ApprovalCard";
import { PendingApproval } from "@/types";

interface StatCard {
  label: string;
  value: string | null;
  sub: string;
  error: boolean;
  href?: string;
}

function parseKickNet(summary: string | null | undefined): string | null {
  if (!summary) return null;
  const m = summary.match(/net=\$([\d,.-]+)/);
  return m ? `$${m[1]}` : null;
}

export function OverviewPanel() {
  const [stats, setStats] = useState<StatCard[]>([
    { label: "Business Net (MTD)", value: null, sub: "via Kick", error: false },
    { label: "Stripe MRR",         value: null, sub: "live subscriptions", error: false },
    { label: "AI Cost (7d)",       value: null, sub: "across all agents", error: false },
    { label: "Sam Pending",        value: null, sub: "actions awaiting review", error: false },
  ]);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [kickRes, stripeRes, usageRes, approvalsRes] = await Promise.allSettled([
      fetch("/api/kick/status").then(r => r.json()),
      fetch("/api/stripe/dashboard?mode=live", { signal: AbortSignal.timeout(10000) }).then(r => r.json()),
      fetch("/api/usage").then(r => r.json()),
      fetch("/api/approvals").then(r => r.json()),
    ]);

    const kick    = kickRes.status    === "fulfilled" ? kickRes.value    : null;
    const stripe  = stripeRes.status  === "fulfilled" ? stripeRes.value  : null;
    const usage   = usageRes.status   === "fulfilled" ? usageRes.value   : null;
    const allApps = approvalsRes.status === "fulfilled" ? approvalsRes.value : [];

    const samPending: PendingApproval[] = Array.isArray(allApps)
      ? allApps.filter((a: PendingApproval) => a.agent === "sam" && a.status === "pending")
      : [];

    const kickNet  = kick?.connected ? parseKickNet(kick.summary) : null;
    const mrr      = stripe?.mrr != null ? `$${(stripe.mrr / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : null;
    const aiCost   = usage?.agents
      ? `$${(usage.agents as { weekCost: number }[]).reduce((s, a) => s + (a.weekCost ?? 0), 0).toFixed(4)}`
      : null;

    setStats([
      { label: "Business Net (MTD)", value: kickNet,          sub: kick?.connected ? "via Kick" : "Kick offline",   error: !kick?.connected, href: "?tab=bookkeeping" },
      { label: "Stripe MRR",         value: mrr,              sub: "live subscriptions",                             error: !stripe || !!stripe.error, href: "?tab=stripe"      },
      { label: "AI Cost (7d)",       value: aiCost,           sub: "across all agents",                              error: !usage || !!usage.error, href: "?tab=cost"        },
      { label: "Sam Pending",        value: String(samPending.length), sub: samPending.length === 1 ? "action awaiting review" : "actions awaiting review", error: false, href: "?tab=sam-actions" },
    ]);
    setApprovals(samPending);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, [load]);

  async function handleApproval(id: string, status: "approved" | "rejected" | "revision_requested", revisionNotes?: string) {
    const r = await fetch("/api/approvals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, revision_notes: revisionNotes }),
    });
    if (r.ok) {
      setApprovals(prev => prev.filter(a => a.id !== id));
      setStats(prev => prev.map(s =>
        s.label === "Sam Pending"
          ? { ...s, value: String(Math.max(0, Number(s.value) - 1)) }
          : s
      ));
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl pb-24 md:pb-8">
      {/* Stat row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {stats.map(s => (
          <div key={s.label} className="card">
            <p className="text-xs text-brand-muted mb-1">{s.label}</p>
            {loading ? (
              <div className="h-7 bg-brand-offwhite rounded animate-pulse w-20" />
            ) : (
              <p className={`text-2xl font-semibold ${s.error || s.value === null ? "text-brand-muted" : "text-brand-black"}`}>
                {s.value ?? "—"}
              </p>
            )}
            <p className="text-[10px] text-brand-muted mt-0.5">{s.sub}</p>
            {s.href && !loading && (
              <Link href={s.href} className="text-[10px] text-brand-orange hover:underline mt-1 block">
                View →
              </Link>
            )}
          </div>
        ))}
      </div>

      {/* Sam inbox */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-brand-black">
            Sam — Pending Actions
            {approvals.length > 0 && (
              <span className="ml-2 text-xs text-brand-muted font-normal">{approvals.length} waiting</span>
            )}
          </h2>
          <Link href="?tab=sam-actions" className="text-xs text-brand-orange hover:underline">
            All approvals →
          </Link>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2].map(i => <div key={i} className="card animate-pulse h-28" />)}
          </div>
        ) : approvals.length === 0 ? (
          <div className="card text-center py-6">
            <p className="text-sm text-brand-muted">No pending Sam actions</p>
            <p className="text-xs text-brand-muted mt-1">Sam is running autonomously</p>
          </div>
        ) : (
          <div className="space-y-3">
            {approvals.slice(0, 5).map(a => (
              <ApprovalCard key={a.id} approval={a} onAction={handleApproval} isAdmin />
            ))}
            {approvals.length > 5 && (
              <Link href="?tab=sam-actions" className="block text-center text-xs text-brand-orange py-2 hover:underline">
                +{approvals.length - 5} more →
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the component compiles**

```bash
cd /opt/rosenfelt/rosenfelt-dashboard
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors related to `OverviewPanel.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/finance/OverviewPanel.tsx
git commit -m "feat: add OverviewPanel — stat row + Sam inbox"
git push origin main
```

---

## Task 6: Build BookkeepingPanel

**Files:**
- Create: `src/components/finance/BookkeepingPanel.tsx`

**Interfaces:**
- Consumes: `GET /api/kick/status` (P&L summary), `GET /api/kick/transactions` (ledger — Task 4), `POST /api/chat` with `{ message, agent: "sam", chatId: "finance_bookkeeping" }`
- Produces: `export function BookkeepingPanel(): JSX.Element`

- [ ] **Step 1: Create BookkeepingPanel.tsx**

Create `src/components/finance/BookkeepingPanel.tsx`:

```tsx
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { KickTransaction } from "@/app/api/kick/transactions/route";

type PnL = { income: string; expenses: string; net: string; start: string | null; end: string | null } | null;
type FilterType = "all" | "income" | "expense";
type ChatMessage = { role: "user" | "sam"; content: string };

function parseKickPnL(summary: string | null | undefined): PnL {
  if (!summary) return null;
  const money = summary.match(/income=\$([\d,.-]+), expenses=\$([\d,.-]+), net=\$([\d,.-]+)/);
  const period = summary.match(/\(([^,]+), ([\d-]+)\.\.([\d-]+)\)/);
  if (!money) return null;
  return {
    income: money[1],
    expenses: money[2],
    net: money[3],
    start: period?.[2] ?? null,
    end: period?.[3] ?? null,
  };
}

export function BookkeepingPanel() {
  const [pnl, setPnl] = useState<PnL>(null);
  const [pnlLoading, setPnlLoading] = useState(true);
  const [pnlError, setPnlError] = useState(false);

  const [transactions, setTransactions] = useState<KickTransaction[]>([]);
  const [txLoading, setTxLoading] = useState(true);
  const [txError, setTxError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");

  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "sam", content: "Ask me about your finances, request a P&L for a custom date range, or draft an invoice." },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatBodyRef = useRef<HTMLDivElement>(null);

  // Scroll chat to bottom on new messages
  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [messages]);

  const loadPnL = useCallback(async () => {
    setPnlLoading(true);
    setPnlError(false);
    try {
      const d = await fetch("/api/kick/status").then(r => r.json());
      setPnl(parseKickPnL(d?.summary));
      if (!d?.connected) setPnlError(true);
    } catch {
      setPnlError(true);
    } finally {
      setPnlLoading(false);
    }
  }, []);

  const loadTransactions = useCallback(async () => {
    setTxLoading(true);
    setTxError(null);
    try {
      const d = await fetch("/api/kick/transactions").then(r => r.json());
      if (d.error) { setTxError(d.error); setTransactions([]); }
      else setTransactions(d.transactions ?? []);
    } catch {
      setTxError("Failed to load transactions");
    } finally {
      setTxLoading(false);
    }
  }, []);

  useEffect(() => { loadPnL(); loadTransactions(); }, [loadPnL, loadTransactions]);

  async function sendChat() {
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    setChatInput("");
    setMessages(prev => [...prev, { role: "user", content: text }]);
    setChatLoading(true);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, agent: "sam", chatId: "finance_bookkeeping" }),
      });
      const d = await r.json();
      setMessages(prev => [...prev, { role: "sam", content: d.response ?? d.error ?? "No response" }]);
    } catch {
      setMessages(prev => [...prev, { role: "sam", content: "Failed to reach Sam — try again." }]);
    } finally {
      setChatLoading(false);
    }
  }

  const visibleTx = transactions.filter(t =>
    filter === "all" ? true : t.type === filter
  );

  return (
    <div className="p-4 md:p-8 pb-24 md:pb-8">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">

        {/* Left: P&L + ledger */}
        <div className="min-w-0">

          {/* P&L strip */}
          {pnlLoading ? (
            <div className="grid grid-cols-3 gap-3 mb-5">
              {[1,2,3].map(i => <div key={i} className="card animate-pulse h-20" />)}
            </div>
          ) : pnlError || !pnl ? (
            <div className="card mb-5 text-center py-6">
              <p className="text-sm text-brand-muted">Kick is offline — ask Sam via chat for P&L data.</p>
            </div>
          ) : (
            <>
              {pnl.start && pnl.end && (
                <p className="text-xs text-brand-muted mb-2">{pnl.start} → {pnl.end}</p>
              )}
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[
                  { label: "Income",   value: `$${pnl.income}`, color: "text-green-600" },
                  { label: "Expenses", value: `$${pnl.expenses}`, color: "text-brand-black" },
                  { label: "Net",      value: `$${pnl.net}`,     color: pnl.net.startsWith("-") ? "text-red-600" : "text-green-600" },
                ].map(tile => (
                  <div key={tile.label} className="card text-center py-4">
                    <p className={`text-xl font-semibold ${tile.color}`}>{tile.value}</p>
                    <p className="text-[10px] text-brand-muted uppercase tracking-wide mt-1">{tile.label}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Filter bar */}
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-brand-black">Transactions</p>
            <div className="flex gap-1">
              {(["all", "income", "expense"] as FilterType[]).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={clsx(
                    "px-3 py-1 rounded-md text-xs font-medium capitalize transition-colors",
                    filter === f
                      ? "bg-brand-orange text-white"
                      : "text-brand-muted border border-brand-border hover:text-brand-black"
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Ledger */}
          {txLoading ? (
            <div className="card animate-pulse h-48" />
          ) : txError ? (
            <div className="card text-center py-8">
              <p className="text-sm text-brand-muted">Sam is offline — ask via chat for transaction data.</p>
            </div>
          ) : visibleTx.length === 0 ? (
            <div className="card text-center py-8">
              <p className="text-sm text-brand-muted">No transactions found.</p>
            </div>
          ) : (
            <div className="border border-brand-border rounded-xl overflow-hidden">
              {visibleTx.map((tx, i) => (
                <div
                  key={i}
                  className={clsx(
                    "flex items-center gap-3 px-4 py-3 text-sm border-b border-brand-border last:border-b-0",
                    i % 2 === 0 ? "bg-white" : "bg-brand-offwhite"
                  )}
                >
                  <span className="text-xs text-brand-muted w-20 flex-shrink-0">{tx.date}</span>
                  <span className="flex-1 text-brand-black truncate">{tx.description}</span>
                  <span className="text-[10px] text-brand-muted bg-brand-offwhite border border-brand-border px-2 py-0.5 rounded flex-shrink-0">
                    {tx.category}
                  </span>
                  <span className={clsx(
                    "text-sm font-medium w-20 text-right flex-shrink-0",
                    tx.type === "income" ? "text-green-600" : "text-brand-black"
                  )}>
                    {tx.type === "income" ? "+" : "−"}${tx.amount.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: inline Sam chat */}
        <div className="flex flex-col border border-brand-border rounded-xl overflow-hidden h-[520px] lg:h-auto lg:max-h-[640px]">
          {/* Chat header */}
          <div className="flex items-center gap-2 px-4 py-3 bg-brand-offwhite border-b border-brand-border flex-shrink-0">
            <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
            <div>
              <p className="text-xs font-semibold text-brand-black">Sam</p>
              <p className="text-[10px] text-brand-muted">Accounting · Legal · HR</p>
            </div>
          </div>

          {/* Messages */}
          <div ref={chatBodyRef} className="flex-1 overflow-y-auto p-3 space-y-2">
            {messages.map((m, i) => (
              <div
                key={i}
                className={clsx(
                  "rounded-xl px-3 py-2 text-xs leading-relaxed max-w-[90%] whitespace-pre-wrap",
                  m.role === "user"
                    ? "bg-brand-orange text-white ml-auto"
                    : "bg-brand-offwhite text-brand-black border border-brand-border"
                )}
              >
                {m.content}
              </div>
            ))}
            {chatLoading && (
              <div className="bg-brand-offwhite border border-brand-border rounded-xl px-3 py-2 max-w-[90%]">
                <div className="flex gap-1 items-center h-4">
                  {[0, 150, 300].map(d => (
                    <div
                      key={d}
                      className="w-1.5 h-1.5 rounded-full bg-brand-muted animate-bounce"
                      style={{ animationDelay: `${d}ms` }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="flex gap-2 p-3 border-t border-brand-border flex-shrink-0">
            <input
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendChat()}
              placeholder="Ask Sam about your finances…"
              className="flex-1 border border-brand-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-brand-orange"
            />
            <button
              onClick={sendChat}
              disabled={chatLoading || !chatInput.trim()}
              className="bg-brand-orange text-white rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the component compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors. Fix any type mismatches before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/components/finance/BookkeepingPanel.tsx
git commit -m "feat: add BookkeepingPanel — P&L strip, transaction ledger, inline Sam chat"
git push origin main
```

---

## Task 7: Build SamActionsPanel

**Files:**
- Create: `src/components/finance/SamActionsPanel.tsx`

**Interfaces:**
- Consumes: `GET /api/approvals` (pending, filtered to sam), `GET /api/approvals?history=true` (history, filtered to sam), `PATCH /api/approvals`, `POST /api/chat` with `{ message, agent: "sam", chatId: "finance_sam_actions" }`
- Produces: `export function SamActionsPanel(): JSX.Element`

- [ ] **Step 1: Create SamActionsPanel.tsx**

Create `src/components/finance/SamActionsPanel.tsx`:

```tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { ApprovalCard } from "@/components/ApprovalCard";
import { PendingApproval } from "@/types";

type HistoryRow = PendingApproval & { status: "approved" | "rejected" | "revision_requested" };

const STATUS_STYLES: Record<string, string> = {
  approved:           "bg-green-50 text-green-700",
  rejected:           "bg-red-50 text-red-700",
  revision_requested: "bg-amber-50 text-amber-700",
};

const STATUS_LABELS: Record<string, string> = {
  approved:           "Approved",
  rejected:           "Rejected",
  revision_requested: "Revision",
};

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

export function SamActionsPanel() {
  const [pending, setPending]         = useState<PendingApproval[]>([]);
  const [history, setHistory]         = useState<HistoryRow[]>([]);
  const [loading, setLoading]         = useState(true);
  const [compose, setCompose]         = useState("");
  const [composeSending, setComposeSending] = useState(false);
  const [composeReply, setComposeReply]     = useState<string | null>(null);
  const [composeError, setComposeError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    const [pendingRes, historyRes] = await Promise.allSettled([
      fetch("/api/approvals").then(r => r.json()),
      fetch("/api/approvals?history=true").then(r => r.json()),
    ]);

    const allPending = pendingRes.status === "fulfilled" && Array.isArray(pendingRes.value)
      ? pendingRes.value : [];
    const allHistory = historyRes.status === "fulfilled" && Array.isArray(historyRes.value)
      ? historyRes.value : [];

    setPending(allPending.filter((a: PendingApproval) => a.agent === "sam" && a.status === "pending"));
    setHistory(
      allHistory
        .filter((a: PendingApproval) => a.agent === "sam" && a.status !== "pending")
        .slice(0, 30) as HistoryRow[]
    );
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleApproval(id: string, status: "approved" | "rejected" | "revision_requested", revisionNotes?: string) {
    const r = await fetch("/api/approvals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, revision_notes: revisionNotes }),
    });
    if (r.ok) {
      setPending(prev => prev.filter(a => a.id !== id));
      load(); // refresh history
    }
  }

  async function sendCompose() {
    const text = compose.trim();
    if (!text || composeSending) return;
    setComposeSending(true);
    setComposeReply(null);
    setComposeError(null);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, agent: "sam", chatId: "finance_sam_actions" }),
      });
      const d = await r.json();
      if (d.error) { setComposeError(d.error); }
      else { setComposeReply(d.response ?? "Done."); setCompose(""); }
    } catch {
      setComposeError("Failed to reach Sam.");
    } finally {
      setComposeSending(false);
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl pb-24 md:pb-8">

      {/* Quick-compose */}
      <div className="card mb-6 p-4">
        <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide mb-3">Ask Sam to…</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={compose}
            onChange={e => setCompose(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendCompose()}
            placeholder="Draft an invoice for Acme Corp $2,500  ·  Record AWS expense $142  ·  Send Q2 summary…"
            className="flex-1 border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
          />
          <button
            onClick={sendCompose}
            disabled={composeSending || !compose.trim()}
            className="btn-primary disabled:opacity-50 px-4"
          >
            {composeSending ? "Sending…" : "Send"}
          </button>
        </div>
        {composeReply && (
          <div className="mt-3 p-3 rounded-lg bg-brand-offwhite border border-brand-border text-sm text-brand-black leading-relaxed">
            <div className="flex items-start justify-between gap-2">
              <p className="whitespace-pre-wrap flex-1">{composeReply}</p>
              <button onClick={() => setComposeReply(null)} className="text-brand-muted hover:text-brand-black text-lg flex-shrink-0 leading-none">✕</button>
            </div>
          </div>
        )}
        {composeError && (
          <p className="mt-2 text-xs text-red-500">{composeError}</p>
        )}
      </div>

      {/* Pending approvals */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-brand-black">
          Pending Actions
          {pending.length > 0 && (
            <span className="ml-2 text-xs text-brand-muted font-normal">{pending.length} waiting</span>
          )}
        </h2>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map(i => <div key={i} className="card animate-pulse h-28" />)}
        </div>
      ) : pending.length === 0 ? (
        <div className="card text-center py-6 mb-6">
          <p className="text-sm text-brand-muted">No pending Sam actions</p>
        </div>
      ) : (
        <div className="space-y-3 mb-6">
          {pending.map(a => (
            <ApprovalCard key={a.id} approval={a} onAction={handleApproval} isAdmin />
          ))}
        </div>
      )}

      {/* History */}
      <div className="border-t border-brand-border pt-5">
        <h2 className="text-sm font-medium text-brand-black mb-3">History</h2>
        {history.length === 0 ? (
          <p className="text-sm text-brand-muted">No history yet.</p>
        ) : (
          <div className="border border-brand-border rounded-xl overflow-hidden">
            {history.map(row => (
              <div
                key={row.id}
                className="flex items-center gap-3 px-4 py-3 border-b border-brand-border last:border-b-0 bg-white hover:bg-brand-offwhite transition-colors"
              >
                <span className="text-[10px] text-brand-muted w-28 flex-shrink-0">{fmtDate(row.reviewed_at ?? row.created_at)}</span>
                <span className="text-xs text-brand-muted w-24 flex-shrink-0 capitalize">{row.action_type.replace(/_/g, " ")}</span>
                <span className="flex-1 text-sm text-brand-black truncate">{row.title}</span>
                <span className={clsx("text-[10px] font-semibold px-2 py-0.5 rounded", STATUS_STYLES[row.status] ?? "bg-brand-offwhite text-brand-muted")}>
                  {STATUS_LABELS[row.status] ?? row.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the component compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/finance/SamActionsPanel.tsx
git commit -m "feat: add SamActionsPanel — compose bar, pending queue, history"
git push origin main
```

---

## Task 8: Rebuild /finance/page.tsx as 5-tab shell

**Files:**
- Modify: `src/app/(dashboard)/finance/page.tsx`

**Interfaces:**
- Consumes: All five panels from Tasks 1, 2, 5, 6, 7
- Consumes: `useSearchParams`, `useRouter` from `next/navigation`

- [ ] **Step 1: Replace finance/page.tsx with the 5-tab shell**

Replace the entire content of `src/app/(dashboard)/finance/page.tsx` with:

```tsx
"use client";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { OverviewPanel }     from "@/components/finance/OverviewPanel";
import { BookkeepingPanel }  from "@/components/finance/BookkeepingPanel";
import { BillingPanel }      from "@/components/finance/BillingPanel";
import { CostPanel }         from "@/components/finance/CostPanel";
import { SamActionsPanel }   from "@/components/finance/SamActionsPanel";

type Tab = "overview" | "bookkeeping" | "stripe" | "cost" | "sam-actions";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview",     label: "Overview"     },
  { id: "bookkeeping",  label: "Bookkeeping"  },
  { id: "stripe",       label: "Stripe"       },
  { id: "cost",         label: "AI Cost"      },
  { id: "sam-actions",  label: "Sam Actions"  },
];

function FinanceShell() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const activeTab    = (searchParams.get("tab") as Tab | null) ?? "overview";

  function setTab(id: Tab) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", id);
    router.replace(`?${params.toString()}`);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="px-4 md:px-8 pt-6">
        <h1 className="text-xl font-semibold text-brand-black mb-4">Finance</h1>
        <div className="flex gap-0 border-b border-brand-border overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={clsx(
                "px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors",
                activeTab === t.id
                  ? "border-brand-orange text-brand-orange"
                  : "border-transparent text-brand-muted hover:text-brand-black"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "overview"    && <OverviewPanel />}
        {activeTab === "bookkeeping" && <BookkeepingPanel />}
        {activeTab === "stripe"      && <BillingPanel />}
        {activeTab === "cost"        && <CostPanel />}
        {activeTab === "sam-actions" && <SamActionsPanel />}
      </div>
    </div>
  );
}

export default function FinancePage() {
  return (
    <Suspense fallback={
      <div className="p-8">
        <div className="h-8 w-32 bg-brand-offwhite rounded animate-pulse mb-4" />
        <div className="h-10 w-full bg-brand-offwhite rounded animate-pulse" />
      </div>
    }>
      <FinanceShell />
    </Suspense>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Push and verify in browser**

```bash
git add "src/app/(dashboard)/finance/page.tsx"
git commit -m "feat: rebuild /finance as 5-tab shell (Overview, Bookkeeping, Stripe, AI Cost, Sam Actions)"
git push origin main
```

After Vercel deploys, open `https://dashboard.rosably.com/finance` and check each tab:

**Overview tab:**
- [ ] 4 stat cards render (or show "—" gracefully if Kick/Stripe offline)
- [ ] Sam pending approvals load; approve/reject works and removes the card
- [ ] "View all →" navigates to `?tab=sam-actions`

**Bookkeeping tab:**
- [ ] P&L strip shows income / expenses / net
- [ ] Transaction ledger lists up to 50 rows
- [ ] Filter buttons (All / Income / Expenses) filter the list client-side
- [ ] Inline Sam chat: type a message, press Enter or Send, reply appears with typing indicator

**Stripe tab:**
- [ ] Looks identical to `/billing` — Live/Test toggle works, sub-tabs work, refund modal opens

**AI Cost tab:**
- [ ] Looks identical to `/cost` — cost cards and breakdown render

**Sam Actions tab:**
- [ ] Compose bar: type a message, send → reply card appears, dismiss with ✕
- [ ] Pending approvals list renders; approve/reject works
- [ ] History rows appear below divider with status badges

**Regression:**
- [ ] `https://dashboard.rosably.com/billing` still works (thin wrapper)
- [ ] `https://dashboard.rosably.com/cost` still works (thin wrapper)
- [ ] Finance sub-nav links in sidebar still highlight correctly for `/finance`, `/billing`, `/cost`

---

## Self-Review Notes

**Spec coverage:**
- ✅ Tab shell with `?tab=` routing
- ✅ Overview: 4 stat cards + Sam inbox with approve/reject
- ✅ Bookkeeping: P&L + ledger + inline Sam chat (sync fetch, not SSE — matches actual `/api/chat` behaviour)
- ✅ Stripe tab: BillingPanel extracted, `/billing` wrapper
- ✅ AI Cost tab: CostPanel extracted, `/cost` wrapper
- ✅ Sam Actions: compose bar + pending + history
- ✅ sam-agent: `GET /kick/transactions` endpoint
- ✅ Dashboard proxy: `GET /api/kick/transactions`
- ✅ Error handling: all stat cards independent; ledger offline fallback; chat error state
- ✅ `useSearchParams` wrapped in Suspense

**Type notes:**
- `KickTransaction` is exported from `src/app/api/kick/transactions/route.ts` and imported by `BookkeepingPanel.tsx` — both must use the same interface shape.
- `PendingApproval` is imported from `@/types` in both `OverviewPanel` and `SamActionsPanel` — the `status` field on `HistoryRow` is cast, not asserted, so TypeScript won't complain if unexpected statuses arrive.
