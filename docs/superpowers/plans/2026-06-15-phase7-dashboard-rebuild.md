# Phase 7 Dashboard IA Rebuild — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current flat ~22-item sidebar with 7 module workspace pages (Dashboard launcher, Control Center, Documents, Sales & Marketing, Agent Central, Finance, Tools), keeping all existing route pages intact as deep links.

**Architecture:** `Sidebar.tsx` flattens to 7 top-level workspace links; all existing routes (/crm, /status, /cost, etc.) remain fully functional. Each new workspace page is a compositing page that surfaces data from existing API routes and links to existing deep pages. No existing routes are removed or redirected.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind + clsx, Supabase client via `@/lib/supabase-admin`, date-fns, React hooks.

**No test runner is configured.** Verification for every task = `npm run build` (TypeScript compile) followed by a manual browser check at `http://localhost:3000`. Run `npm run dev` once and keep it running.

**Work items:** These tasks map to Phase 7 work items #1219–1226 in Supabase. Log completions there when done.

---

## File Map

| Action | File |
|--------|------|
| Modify | `src/components/Sidebar.tsx` — flatten to 7 workspace modules |
| Modify | `src/components/DashboardShell.tsx` — update sidebar sub-label |
| Create | `src/components/CollapsibleCard.tsx` — shared collapsible section card |
| Modify | `src/app/(dashboard)/overview/page.tsx` — launcher redesign |
| Create | `src/app/(dashboard)/control-center/page.tsx` — new workspace |
| Modify | `src/app/(dashboard)/documents/page.tsx` — images category added |
| Create | `src/app/(dashboard)/sales/page.tsx` — new workspace |
| Create | `src/app/api/research/briefs/route.ts` — list research_briefs |
| Create | `src/app/api/research/run/route.ts` — trigger Avery research |
| Create | `src/app/(dashboard)/agent-central/page.tsx` — new workspace |
| Create | `src/app/(dashboard)/finance/page.tsx` — new workspace |
| Create | `src/app/(dashboard)/tools/page.tsx` — new workspace |

---

## Task 1: Sidebar — Flatten to 7 Workspace Modules

**Files:**
- Modify: `src/components/Sidebar.tsx:21-67` (MODULES + NAV arrays)
- Modify: `src/components/Sidebar.tsx:131-155` (remove collapsedModules state)
- Modify: `src/components/Sidebar.tsx:163-174` (isActive + modulesWithItems)
- Modify: `src/components/Sidebar.tsx:222-275` (desktop nav render)
- Modify: `src/components/Sidebar.tsx:358` (mobile drawer sub-label)
- Modify: `src/components/Sidebar.tsx:371-405` (mobile drawer nav)

- [ ] **Step 1: Replace the MODULES and NAV arrays (lines 21–67) with a flat WORKSPACE_MODULES array**

```typescript
// Replace lines 21–67 entirely with:

const WORKSPACE_MODULES = [
  {
    id: "dashboard", label: "Dashboard",
    href: "/overview", icon: "grid",
    active: ["/overview"],
  },
  {
    id: "control", label: "Control Center",
    href: "/control-center", icon: "activity",
    active: ["/control-center", "/status", "/work", "/backup", "/sql", "/engineering", "/approvals"],
  },
  {
    id: "documents", label: "Documents",
    href: "/documents", icon: "folder",
    active: ["/documents", "/images"],
  },
  {
    id: "sales", label: "Sales & Marketing",
    href: "/sales", icon: "trendingUp",
    active: ["/sales", "/crm", "/quiz", "/content", "/analytics"],
  },
  {
    id: "agents", label: "Agent Central",
    href: "/agent-central", icon: "brain",
    active: ["/agent-central", "/agents", "/chat"],
  },
  {
    id: "finance", label: "Finance",
    href: "/finance", icon: "dollar",
    active: ["/finance", "/cost", "/billing"],
  },
  {
    id: "tools", label: "Tools",
    href: "/tools", icon: "wrench",
    active: ["/tools", "/users", "/rbac"],
  },
];
```

- [ ] **Step 2: Remove the `collapsedModules` state, `toggleModule` function, and `modulesWithItems` computation**

In the `Sidebar` function body, remove:
- The `collapsedModules` useState (lines ~131–137)
- The `toggleModule` function (lines ~149–155)
- The `modulesWithItems` computation (lines ~172–174)
- The old `isActive` function (lines ~163–166) — replace it with the new one below

- [ ] **Step 3: Add new `isActive` helper using the WORKSPACE_MODULES active lists**

```typescript
// Replace old isActive (which was just pathname prefix) with:
function isActive(mod: typeof WORKSPACE_MODULES[number]): boolean {
  return mod.active.some(r =>
    r === "/overview"
      ? pathname === r
      : pathname === r || pathname.startsWith(r + "/")
  );
}
```

- [ ] **Step 4: Replace the desktop nav render (lines ~222–275)**

Replace the entire `{modulesWithItems.map(...)}` block inside `<nav>` with:

```tsx
<nav className="flex-1 overflow-y-auto py-2">
  <div className={clsx("space-y-0.5", collapsed ? "px-1.5" : "px-2 py-1")}>
    {WORKSPACE_MODULES.map(mod => {
      const active = isActive(mod);
      return (
        <Link
          key={mod.href}
          href={mod.href}
          title={collapsed ? mod.label : undefined}
          className={clsx(
            "flex items-center gap-2.5 rounded-lg transition-colors",
            collapsed ? "justify-center p-2" : "px-3 py-2",
            active
              ? "bg-orange-50 text-brand-orange"
              : "text-brand-muted hover:bg-brand-offwhite hover:text-brand-black"
          )}
        >
          <Icon name={mod.icon} size={collapsed ? 20 : 18} />
          {!collapsed && (
            <span className={clsx("text-sm truncate", active && "font-medium text-brand-orange")}>
              {mod.label}
            </span>
          )}
        </Link>
      );
    })}
  </div>
</nav>
```

- [ ] **Step 5: Update the desktop sidebar sub-label from "Control Center" to "Workspace"**

In the expanded desktop sidebar header block (~line 205):
```tsx
// Change:
<p className="text-xs text-brand-muted leading-tight whitespace-nowrap">Control Center</p>
// To:
<p className="text-xs text-brand-muted leading-tight whitespace-nowrap">Workspace</p>
```

- [ ] **Step 6: Replace the mobile drawer nav (lines ~371–405) to use WORKSPACE_MODULES**

```tsx
{/* Drawer nav */}
<nav className="flex-1 overflow-y-auto py-3 px-3">
  <div className="space-y-1">
    {WORKSPACE_MODULES.map(mod => {
      const active = isActive(mod);
      return (
        <Link
          key={mod.href}
          href={mod.href}
          className={clsx(
            "flex items-center gap-3.5 px-3 py-3 rounded-xl transition-colors",
            active
              ? "bg-orange-50 text-brand-orange"
              : "text-brand-black hover:bg-brand-offwhite"
          )}
        >
          <div className={clsx(
            "p-2 rounded-lg shrink-0",
            active ? "bg-orange-100" : "bg-brand-offwhite"
          )}>
            <Icon name={mod.icon} size={20} />
          </div>
          <span className={clsx("text-[15px]", active ? "font-semibold text-brand-orange" : "font-medium")}>
            {mod.label}
          </span>
        </Link>
      );
    })}
  </div>
</nav>
```

Also update the mobile drawer sub-label (~line 358):
```tsx
// Change:
<p className="text-xs text-brand-muted leading-tight">Control Center</p>
// To:
<p className="text-xs text-brand-muted leading-tight">Workspace</p>
```

- [ ] **Step 7: Verify**

```bash
cd /opt/rosenfelt/rosenfelt-dashboard
npm run build
```

Expected: Build succeeds with no TypeScript errors. Any error about `collapsedModules` or `modulesWithItems` means step 2 was incomplete.

Open http://localhost:3000 — sidebar should show 7 flat links. Navigate to /crm — "Sales & Marketing" should highlight. Navigate to /cost — "Finance" should highlight.

- [ ] **Step 8: Commit**

```bash
cd /opt/rosenfelt/rosenfelt-dashboard
git add src/components/Sidebar.tsx
git commit -m "feat(7.1): sidebar — flatten to 7 module workspace links"
```

---

## Task 2: CollapsibleCard Shared Component

Used on Control Center, Finance, and Agent Central pages to group related content with a toggle.

**Files:**
- Create: `src/components/CollapsibleCard.tsx`

- [ ] **Step 1: Create the component**

```typescript
// src/components/CollapsibleCard.tsx
"use client";
import { useState } from "react";
import clsx from "clsx";

interface Props {
  title: string;
  badge?: string | number;
  defaultOpen?: boolean;
  children: React.ReactNode;
  action?: React.ReactNode;
}

export function CollapsibleCard({ title, badge, defaultOpen = true, children, action }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="card p-0 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-brand-offwhite/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-brand-black">{title}</span>
          {badge !== undefined && (
            <span className="px-1.5 py-0.5 rounded-full bg-brand-offwhite text-xs text-brand-muted font-medium">
              {badge}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {action && <span onClick={e => e.stopPropagation()}>{action}</span>}
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={clsx("text-brand-muted transition-transform duration-150", open ? "rotate-180" : "")}
          >
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
      </button>
      {open && <div className="border-t border-brand-border">{children}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run build
```

Expected: No errors for the new file.

- [ ] **Step 3: Commit**

```bash
git add src/components/CollapsibleCard.tsx
git commit -m "feat(7.2): add CollapsibleCard shared component"
```

---

## Task 3: Overview Launcher Redesign

Replace the current stats-heavy overview page with a launcher: agent status strip at top, 6 module tiles in a grid, then a compact pending-approvals + recent-activity section below.

**Files:**
- Modify: `src/app/(dashboard)/overview/page.tsx` — full rewrite

The current page fetches stats, activity, approvals, agentStatus, costToday. Keep those fetches — they power the module tiles (approval count, activity count, cost). Keep the Realtime channel for live updates.

- [ ] **Step 1: Rewrite the return JSX in overview/page.tsx**

Keep all existing `useState`, `useCallback`, `useEffect`, and `handleApproval` logic unchanged. Replace only the `return (...)` block (the JSX starting after the loading guard):

```tsx
return (
  <div className="p-4 md:p-8 max-w-6xl pb-24 md:pb-8">
    {/* Header */}
    <div className="mb-6">
      <h1 className="text-xl font-semibold text-brand-black">Good morning</h1>
      <p className="text-sm text-brand-muted mt-0.5">
        {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
      </p>
    </div>

    {/* Agent status strip */}
    <div className="card p-3 mb-6">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-medium text-brand-muted uppercase tracking-wider pr-1">Agents</span>
        {agentStatus.map(a => (
          <div key={a.agent} className="flex items-center gap-1.5">
            <div className={clsx(
              "w-1.5 h-1.5 rounded-full",
              a.errors_24h > 0 ? "bg-amber-400" : "bg-green-400"
            )} />
            <span className="text-xs capitalize text-brand-black">{a.agent}</span>
            <span className="text-xs text-brand-muted">
              {a.executions_24h}x · {a.errors_24h} err
            </span>
          </div>
        ))}
        {costToday !== null && (
          <>
            <div className="flex-1" />
            <span className="text-xs text-brand-muted">API cost today: ${costToday.toFixed(4)}</span>
          </>
        )}
      </div>
    </div>

    {/* Module tiles */}
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
      {[
        {
          label: "Control Center",
          href: "/control-center",
          icon: "M22 12h-4l-3 9L9 3l-3 9H2",
          desc: "System status · Work items",
          badge: (stats?.errors_today ?? 0) > 0 ? `${stats?.errors_today} errors` : null,
          badgeColor: "text-red-600 bg-red-50",
        },
        {
          label: "Documents",
          href: "/documents",
          icon: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z",
          desc: "Docs · Images · Reports",
          badge: null,
          badgeColor: "",
        },
        {
          label: "Sales & Marketing",
          href: "/sales",
          icon: "M23 6 13.5 15.5 8.5 10.5 1 18M17 6h6v6",
          desc: "CRM · Content · Research",
          badge: null,
          badgeColor: "",
        },
        {
          label: "Agent Central",
          href: "/agent-central",
          icon: "M9.5 2a2.5 2.5 0 0 1 5 0M12 6v6M9 9h6",
          desc: "5 agents · Chat · History",
          badge: null,
          badgeColor: "",
        },
        {
          label: "Finance",
          href: "/finance",
          icon: "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
          desc: "AI cost · Transactions",
          badge: null,
          badgeColor: "",
        },
        {
          label: "Tools",
          href: "/tools",
          icon: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.8 2.8-2.4-2.4z",
          desc: "Backup · Users · SQL",
          badge: null,
          badgeColor: "",
        },
      ].map(tile => (
        <Link
          key={tile.href}
          href={tile.href}
          className="card flex flex-col gap-2 p-4 hover:border-brand-orange/40 hover:shadow-sm transition-all group"
        >
          <div className="flex items-start justify-between">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
                 className="text-brand-orange mt-0.5">
              <path d={tile.icon}/>
            </svg>
            {tile.badge && (
              <span className={clsx("text-[10px] font-medium px-1.5 py-0.5 rounded-full", tile.badgeColor)}>
                {tile.badge}
              </span>
            )}
          </div>
          <div>
            <p className="text-sm font-semibold text-brand-black group-hover:text-brand-orange transition-colors">
              {tile.label}
            </p>
            <p className="text-xs text-brand-muted mt-0.5">{tile.desc}</p>
          </div>
        </Link>
      ))}
    </div>

    {/* Approvals + Activity — compact two-column */}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Pending approvals */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-brand-black">
            Needs your approval
            {approvals.length > 0 && (
              <span className="ml-2 text-xs text-brand-muted font-normal">{approvals.length} pending</span>
            )}
          </h2>
          {approvals.length > 0 && (
            <Link href="/approvals" className="text-xs text-brand-orange hover:underline">View all →</Link>
          )}
        </div>
        {approvals.length === 0 ? (
          <div className="card text-center py-6">
            <p className="text-sm text-brand-muted">No pending approvals</p>
          </div>
        ) : (
          <div className="space-y-3">
            {approvals.slice(0, 2).map(a => (
              <ApprovalCard key={a.id} approval={a} onAction={handleApproval} />
            ))}
            {approvals.length > 2 && (
              <Link href="/approvals"
                className="block text-center text-xs text-brand-orange py-2 hover:underline">
                +{approvals.length - 2} more →
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Recent activity */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-brand-black">Recent activity</h2>
          <Link href="/agents/history" className="text-xs text-brand-orange hover:underline">View all →</Link>
        </div>
        {activity.length === 0 ? (
          <div className="card text-center py-6">
            <p className="text-sm text-brand-muted">No recent activity</p>
          </div>
        ) : (
          <div className="card p-0 overflow-hidden">
            {activity.slice(0, 6).map((log, i) => (
              <div key={log.id}
                className={clsx(
                  "flex items-center gap-3 px-4 py-2.5 text-sm",
                  i !== 0 && "border-t border-brand-border"
                )}>
                <div className={clsx(
                  "w-1.5 h-1.5 rounded-full flex-shrink-0",
                  log.status === "success" ? "bg-green-400" :
                  log.status === "error"   ? "bg-red-400"   : "bg-amber-400"
                )} />
                <AgentBadge agent={log.agent} size="sm" />
                <span className="flex-1 text-brand-black truncate text-xs">
                  {log.workflow_name ?? "Unknown workflow"}
                </span>
                <span className="text-xs text-brand-muted flex-shrink-0">
                  {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  </div>
);
```

- [ ] **Step 2: Build and verify**

```bash
npm run build
```

Expected: Clean compile. Open `/overview` — should show agent strip at top, 6 module tiles, compact approvals + activity below. Check that the "Control Center" tile shows an error badge when there are workflow errors today.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/overview/page.tsx
git commit -m "feat(7.3): overview launcher — agent strip + module tiles"
```

---

## Task 4: Control Center Workspace

New page at `/control-center`. Shows: infrastructure status table (8 services), cron jobs schedule, and quick links to Approvals/Work/Engineering.

**Files:**
- Create: `src/app/(dashboard)/control-center/page.tsx`

- [ ] **Step 1: Create the page**

```typescript
// src/app/(dashboard)/control-center/page.tsx
"use client";
import { useEffect, useState, useCallback } from "react";
import { CollapsibleCard } from "@/components/CollapsibleCard";
import Link from "next/link";
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";
import { AgentBadge } from "@/components/AgentBadge";

// Static cron job schedule (from APScheduler configs in each agent)
const CRON_JOBS = [
  { agent: "riley",  name: "Weekly digest",       schedule: "Mon 06:00 ET", active: true },
  { agent: "avery",  name: "Content Intel Monitor",schedule: "Wed 06:00 ET", active: true },
  { agent: "casey",  name: "Full audit",           schedule: "Sun 07:00 ET", active: true },
  { agent: "casey",  name: "Regression suite",     schedule: "Sun 08:00 ET", active: true },
  { agent: "sam",    name: "Monthly financial",    schedule: "1st of month 08:00 ET", active: true },
];

// Services to health-check
const SERVICES = [
  { id: "jordan",    label: "Jordan Agent",    url: "https://jordan.rosably.com/health", type: "agent" },
  { id: "riley",     label: "Riley Agent",     url: "https://riley.rosably.com/health",  type: "agent" },
  { id: "avery",     label: "Avery Agent",     url: "https://avery.rosably.com/health",  type: "agent" },
  { id: "casey",     label: "Casey Agent",     url: "https://casey.rosably.com/health",  type: "agent" },
  { id: "sam",       label: "Sam Agent",       url: "https://sam.rosably.com/health",    type: "agent" },
  { id: "dashboard", label: "Dashboard",       url: "https://dashboard.rosably.com",     type: "web" },
  { id: "wp",        label: "Website (WP)",    url: "https://rosenfeltgroup.com",        type: "web" },
  { id: "docs-mcp",  label: "Docs MCP",        url: "https://docs-mcp.rosably.com/ping", type: "service" },
];

type ServiceStatus = {
  id: string;
  status: "ok" | "degraded" | "down" | "checking";
  latencyMs?: number;
};

export default function ControlCenterPage() {
  const [agentHealth, setAgentHealth] = useState<Record<string, "ok" | "error" | "checking">>({});
  const [activity,    setActivity]    = useState<{ agent: string; workflow_name: string; status: string; created_at: string; id: string }[]>([]);
  const [approvalCount, setApprovalCount] = useState<number>(0);
  const [loading,     setLoading]     = useState(true);

  const load = useCallback(async () => {
    const [health, act, appr] = await Promise.all([
      fetch("/api/agent-status/health").then(r => r.json()).catch(() => ({})),
      fetch("/api/activity").then(r => r.json()).catch(() => []),
      fetch("/api/approvals").then(r => r.json()).catch(() => []),
    ]);
    setAgentHealth(health ?? {});
    setActivity(Array.isArray(act) ? act.slice(0, 10) : []);
    setApprovalCount(Array.isArray(appr) ? appr.length : 0);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  if (loading) {
    return (
      <div className="p-4 md:p-8">
        <div className="space-y-4">
          {[1,2,3].map(i => <div key={i} className="card animate-pulse h-32" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl pb-24 md:pb-8">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <h1 className="text-xl font-semibold text-brand-black">Control Center</h1>
        <div className="flex gap-2 flex-wrap">
          {approvalCount > 0 && (
            <Link href="/approvals"
              className="px-3 py-1 bg-red-50 text-red-700 rounded-full text-sm font-medium hover:bg-red-100 transition-colors">
              {approvalCount} approval{approvalCount !== 1 ? "s" : ""} waiting →
            </Link>
          )}
          <Link href="/work" className="btn-secondary text-sm px-3 py-1.5">Work board →</Link>
          <Link href="/approvals" className="btn-secondary text-sm px-3 py-1.5">All approvals →</Link>
        </div>
      </div>

      <div className="space-y-4">

        {/* Infrastructure status */}
        <CollapsibleCard title="Infrastructure" badge={SERVICES.length}>
          <div className="divide-y divide-brand-border">
            {SERVICES.map(svc => {
              const health = agentHealth[svc.id];
              const isAgent = svc.type === "agent";
              const status = isAgent
                ? (health === "ok" ? "ok" : health === "error" ? "down" : "checking")
                : "ok"; // non-agent services: show as ok (no direct client-side check to avoid CORS)
              return (
                <div key={svc.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className={clsx(
                      "w-2 h-2 rounded-full flex-shrink-0",
                      status === "ok"       ? "bg-green-400" :
                      status === "down"     ? "bg-red-400"   :
                      status === "degraded" ? "bg-amber-400" : "bg-gray-300 animate-pulse"
                    )} />
                    <span className="text-sm text-brand-black">{svc.label}</span>
                    <span className="text-xs text-brand-muted capitalize">{svc.type}</span>
                  </div>
                  <span className={clsx(
                    "text-xs font-medium",
                    status === "ok"       ? "text-green-600" :
                    status === "down"     ? "text-red-600"   :
                    status === "checking" ? "text-brand-muted" : "text-amber-600"
                  )}>
                    {status === "checking" ? "checking…" : status}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="px-4 py-3 border-t border-brand-border">
            <Link href="/status" className="text-xs text-brand-orange hover:underline">
              Full agent diagnostics →
            </Link>
          </div>
        </CollapsibleCard>

        {/* Scheduled jobs */}
        <CollapsibleCard title="Scheduled Jobs" badge={CRON_JOBS.length}>
          <div className="divide-y divide-brand-border">
            {CRON_JOBS.map((job, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <AgentBadge agent={job.agent} size="sm" />
                  <span className="text-sm text-brand-black">{job.name}</span>
                </div>
                <span className="text-xs text-brand-muted">{job.schedule}</span>
              </div>
            ))}
          </div>
          <div className="px-4 py-3 border-t border-brand-border">
            <div className="flex gap-4 text-xs text-brand-muted">
              <span>Manual triggers:</span>
              <code className="text-brand-black">curl -X POST .../digest/run</code>
              <code className="text-brand-black">curl -X POST .../monitor/run</code>
            </div>
          </div>
        </CollapsibleCard>

        {/* Recent activity */}
        <CollapsibleCard title="Recent Workflow Activity">
          {activity.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-brand-muted">No recent activity</div>
          ) : (
            <div className="divide-y divide-brand-border">
              {activity.map((log, i) => (
                <div key={log.id} className="flex items-center gap-3 px-4 py-3">
                  <div className={clsx(
                    "w-1.5 h-1.5 rounded-full flex-shrink-0",
                    log.status === "success" ? "bg-green-400" :
                    log.status === "error"   ? "bg-red-400"   : "bg-amber-400"
                  )} />
                  <AgentBadge agent={log.agent} size="sm" />
                  <span className="flex-1 text-xs text-brand-black truncate">{log.workflow_name}</span>
                  <span className="text-xs text-brand-muted flex-shrink-0">
                    {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="px-4 py-3 border-t border-brand-border">
            <Link href="/agents/history" className="text-xs text-brand-orange hover:underline">
              Full history →
            </Link>
          </div>
        </CollapsibleCard>

        {/* Quick links */}
        <CollapsibleCard title="Operations Links">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4">
            {[
              { label: "Work Board",       href: "/work",        desc: "Kanban + task queue" },
              { label: "Approvals",        href: "/approvals",   desc: "Pending agent actions" },
              { label: "Agent History",    href: "/agents/history", desc: "Workflow execution log" },
              { label: "Agent Prompts",    href: "/agents/agent-prompts", desc: "Live prompt editor" },
              { label: "Engineering",      href: "/engineering", desc: "SSH terminal (Jordan)" },
              { label: "Backup",           href: "/backup",      desc: "VPS backup tools" },
            ].map(link => (
              <Link key={link.href} href={link.href}
                className="flex flex-col gap-1 p-3 rounded-lg border border-brand-border hover:border-brand-orange/40 hover:bg-brand-offwhite/50 transition-all">
                <span className="text-sm font-medium text-brand-black">{link.label}</span>
                <span className="text-xs text-brand-muted">{link.desc}</span>
              </Link>
            ))}
          </div>
        </CollapsibleCard>

      </div>
    </div>
  );
}
```

Note: `btn-secondary` class may or may not exist in globals.css. If it doesn't, replace with:
`"px-3 py-1.5 rounded-lg border border-brand-border text-sm text-brand-muted hover:bg-brand-offwhite hover:text-brand-black transition-colors"`

- [ ] **Step 2: Create the page directory and verify**

```bash
mkdir -p src/app/\(dashboard\)/control-center
npm run build
```

Expected: Clean compile. Open `/control-center` — should show infrastructure table with 8 services, cron jobs table, recent activity, quick links.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/control-center
git commit -m "feat(7.4): control center workspace — infra status, cron jobs, ops links"
```

---

## Task 5: Documents Browser — Add Images Category

The existing `/documents` page is a rich browser with search and `doc_type` filtering. The `/images` page is a separate route. For Phase 7, we want Documents to be the canonical browser. Two things to check:

**Files:**
- Modify: `src/app/(dashboard)/documents/page.tsx` — add `image` to the doc_type filter
- Read: `src/app/(dashboard)/images/page.tsx` — understand what it shows to decide whether to merge

- [ ] **Step 1: Read the images page**

```bash
cat src/app/\(dashboard\)/images/page.tsx | head -60
```

If images are fetched from Supabase Storage (`audit-reports` bucket) and NOT registered in `doc_registry`, the documents page can't filter them. In that case: add a "Media" tab to the documents page that calls a new `/api/images/list` route that fetches from Storage. If images ARE in `doc_registry` with `doc_type = "image"`, just verify the filter is already there.

- [ ] **Step 2: Ensure the documents page shows all file types**

Check the existing `DOC_TYPES` filter array in `documents/page.tsx`. If `"image"` is not in the type filter options, add it. Look for the filter UI near the top of the file.

If images come from a different source (Storage vs doc_registry), add a tab toggle at the top of the documents page:
```tsx
// Tab state: "docs" | "media"
const [tab, setTab] = useState<"docs" | "media">("docs");
```

And conditionally render either the existing doc list or the images grid based on the tab.

- [ ] **Step 3: Add a note in the sidebar active mapping**

The `/images` route is already in WORKSPACE_MODULES under documents' `active` list — so navigating to `/images` will highlight "Documents" in the sidebar. No redirect needed.

- [ ] **Step 4: Build and verify**

```bash
npm run build
```

Open `/documents` — should show all document types including images in the filter.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(dashboard\)/documents/page.tsx
git commit -m "feat(7.5): documents browser — ensure images category visible"
```

---

## Task 6: Research API Routes

Create the two API routes for the Research section (used in the Sales workspace, Task 7).

**Files:**
- Create: `src/app/api/research/briefs/route.ts`
- Create: `src/app/api/research/run/route.ts`

The `research_briefs` table has at minimum: `id`, `title`, `topic`, `status`, `agent`, `created_at`, `summary`. Verify by checking the Supabase schema if needed.

- [ ] **Step 1: Create the briefs route**

```typescript
// src/app/api/research/briefs/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("research_briefs")
    .select("id, title, topic, status, agent, created_at, summary")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("research_briefs fetch error:", error);
    return NextResponse.json([], { status: 500 });
  }
  return NextResponse.json(data ?? []);
}
```

- [ ] **Step 2: Create the research trigger route**

```typescript
// src/app/api/research/run/route.ts
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const topic = (body.topic as string | undefined)?.trim();
  if (!topic) {
    return NextResponse.json({ error: "topic is required" }, { status: 400 });
  }

  const AVERY_URL = process.env.AVERY_API_URL;
  if (!AVERY_URL) {
    return NextResponse.json({ error: "AVERY_API_URL not configured" }, { status: 503 });
  }

  try {
    const res = await fetch(`${AVERY_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Run research brief on: ${topic}`,
        session_id: "dashboard_research_brian",
      }),
    });
    if (!res.ok) throw new Error(`Avery responded ${res.status}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("research trigger error:", err);
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
```

- [ ] **Step 3: Build and verify**

```bash
npm run build
```

Test with curl:
```bash
curl http://localhost:3000/api/research/briefs
# Expected: JSON array (empty [] if no briefs yet — not an error)

curl -X POST http://localhost:3000/api/research/run \
  -H "Content-Type: application/json" \
  -d '{"topic": "test"}'
# Expected: {"ok":true} or {"error":"AVERY_API_URL not configured"} if env not set in dev
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/research/
git commit -m "feat(7.6a): research API routes — briefs list + trigger"
```

---

## Task 7: Sales & Marketing Workspace

New tabbed workspace at `/sales` with five sections: Overview, CRM, Content, Quiz Pipeline, Research.

**Files:**
- Create: `src/app/(dashboard)/sales/page.tsx`

- [ ] **Step 1: Create the page**

```typescript
// src/app/(dashboard)/sales/page.tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";

type Tab = "overview" | "crm" | "content" | "quiz" | "research";

interface Brief {
  id: string;
  title: string;
  topic: string;
  status: string;
  created_at: string;
  summary?: string;
}

export default function SalesPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [researchTopic, setResearchTopic] = useState("");
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState("");

  useEffect(() => {
    if (tab === "research") {
      fetch("/api/research/briefs")
        .then(r => r.json())
        .then(d => setBriefs(Array.isArray(d) ? d : []))
        .catch(() => setBriefs([]));
    }
  }, [tab]);

  async function runResearch() {
    if (!researchTopic.trim() || running) return;
    setRunning(true);
    setRunMsg("");
    try {
      const r = await fetch("/api/research/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: researchTopic }),
      });
      const data = await r.json();
      setRunMsg(data.ok ? "Research queued — Avery is on it." : (data.error ?? "Error"));
      if (data.ok) setResearchTopic("");
    } catch {
      setRunMsg("Network error");
    }
    setRunning(false);
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: "overview",  label: "Overview" },
    { id: "crm",       label: "CRM" },
    { id: "content",   label: "Content" },
    { id: "quiz",      label: "Quiz Pipeline" },
    { id: "research",  label: "Research" },
  ];

  return (
    <div className="p-4 md:p-8 max-w-5xl pb-24 md:pb-8">
      <h1 className="text-xl font-semibold text-brand-black mb-4">Sales & Marketing</h1>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-brand-border mb-6 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              "px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors",
              tab === t.id
                ? "border-brand-orange text-brand-orange"
                : "border-transparent text-brand-muted hover:text-brand-black"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {tab === "overview" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { label: "CRM",            href: "/crm",                desc: "Leads · Clients · Contacts · Businesses",   sub: "View pipeline" },
            { label: "Services Admin", href: "/crm/admin/services", desc: "Manage service offerings",                   sub: "Edit services" },
            { label: "Content",        href: "/content",            desc: "Blog pipeline: ideas → draft → publish",     sub: "Content queue" },
            { label: "Keywords",       href: "/content/keywords",   desc: "SEO keyword tracker",                        sub: "Track rankings" },
            { label: "Analytics",      href: "/analytics",          desc: "GA4 traffic + conversion data",              sub: "View analytics" },
            { label: "Quiz Funnel",    href: "/quiz",               desc: "AI Opportunity Review quiz leads",           sub: "View leads" },
          ].map(card => (
            <Link key={card.href} href={card.href}
              className="card flex flex-col gap-2 p-4 hover:border-brand-orange/40 transition-all group">
              <p className="text-sm font-semibold text-brand-black group-hover:text-brand-orange transition-colors">
                {card.label}
              </p>
              <p className="text-xs text-brand-muted flex-1">{card.desc}</p>
              <p className="text-xs text-brand-orange">{card.sub} →</p>
            </Link>
          ))}
        </div>
      )}

      {/* CRM tab */}
      {tab === "crm" && (
        <div className="space-y-4">
          <p className="text-sm text-brand-muted">Full CRM is at <Link href="/crm" className="text-brand-orange hover:underline">/crm</Link>.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Leads",      href: "/crm/leads" },
              { label: "Clients",    href: "/crm/clients" },
              { label: "Contacts",   href: "/crm/contacts" },
              { label: "Businesses", href: "/crm/businesses" },
            ].map(l => (
              <Link key={l.href} href={l.href}
                className="card p-4 text-center hover:border-brand-orange/40 transition-all">
                <p className="text-sm font-medium text-brand-black">{l.label}</p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Content tab */}
      {tab === "content" && (
        <div className="space-y-4">
          <p className="text-sm text-brand-muted">
            Avery manages the blog pipeline. Use the Content page for the full view.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { label: "Content Pipeline", href: "/content",           desc: "Ideas → draft → approve → publish" },
              { label: "Keywords",         href: "/content/keywords",  desc: "SEO rank tracker" },
              { label: "Analytics",        href: "/analytics",         desc: "GA4 traffic & conversions" },
            ].map(c => (
              <Link key={c.href} href={c.href}
                className="card p-4 hover:border-brand-orange/40 transition-all group">
                <p className="text-sm font-semibold text-brand-black group-hover:text-brand-orange transition-colors">
                  {c.label}
                </p>
                <p className="text-xs text-brand-muted mt-1">{c.desc}</p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Quiz tab */}
      {tab === "quiz" && (
        <div className="space-y-4">
          <p className="text-sm text-brand-muted">
            AI Opportunity Review quiz captures leads via Typeform → n8n → Supabase. Avery generates the Stack Audit report.
          </p>
          <Link href="/quiz"
            className="card p-4 inline-flex flex-col gap-1 hover:border-brand-orange/40 transition-all">
            <p className="text-sm font-semibold text-brand-black">Quiz Leads</p>
            <p className="text-xs text-brand-muted">View all submitted Opportunity Reviews</p>
          </Link>
        </div>
      )}

      {/* Research tab */}
      {tab === "research" && (
        <div className="space-y-4">
          {/* Run research form */}
          <div className="card p-4">
            <p className="text-sm font-medium text-brand-black mb-3">Run a Research Brief</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={researchTopic}
                onChange={e => setResearchTopic(e.target.value)}
                onKeyDown={e => e.key === "Enter" && runResearch()}
                placeholder="e.g. AI scheduling tools for SMBs"
                className="flex-1 px-3 py-2 text-sm border border-brand-border rounded-lg focus:outline-none focus:border-brand-orange"
              />
              <button
                onClick={runResearch}
                disabled={running || !researchTopic.trim()}
                className="px-4 py-2 rounded-lg bg-brand-orange text-white text-sm font-medium disabled:opacity-50 hover:bg-brand-orange/90 transition-colors"
              >
                {running ? "Queuing…" : "Run"}
              </button>
            </div>
            {runMsg && (
              <p className={clsx("text-xs mt-2", runMsg.includes("queued") ? "text-green-600" : "text-red-600")}>
                {runMsg}
              </p>
            )}
          </div>

          {/* Briefs list */}
          {briefs.length === 0 ? (
            <div className="card text-center py-8">
              <p className="text-sm text-brand-muted">No research briefs yet</p>
              <p className="text-xs text-brand-muted mt-1">Run a brief above to get started</p>
            </div>
          ) : (
            <div className="space-y-2">
              {briefs.map(b => (
                <div key={b.id} className="card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-brand-black">{b.title || b.topic}</p>
                      {b.summary && (
                        <p className="text-xs text-brand-muted mt-1 line-clamp-2">{b.summary}</p>
                      )}
                    </div>
                    <span className={clsx(
                      "text-xs px-2 py-0.5 rounded-full flex-shrink-0",
                      b.status === "completed" ? "bg-green-50 text-green-700" :
                      b.status === "running"   ? "bg-blue-50 text-blue-700"   : "bg-brand-offwhite text-brand-muted"
                    )}>
                      {b.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create directory + build**

```bash
mkdir -p src/app/\(dashboard\)/sales
npm run build
```

Expected: Clean compile. Open `/sales` — 5 tabs visible. Research tab shows "run brief" form. If no `research_briefs` in Supabase yet, shows empty state (not an error).

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/sales/
git commit -m "feat(7.6): sales workspace — CRM/content/quiz/research tabs"
```

---

## Task 8: Agent Central Workspace

New page at `/agent-central`. Shows 5 agent cards with health indicators, chat shortcuts, and tool count; links to history and work queue.

**Files:**
- Create: `src/app/(dashboard)/agent-central/page.tsx`

- [ ] **Step 1: Create the page**

```typescript
// src/app/(dashboard)/agent-central/page.tsx
"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import clsx from "clsx";
import { AgentBadge } from "@/components/AgentBadge";
import { formatDistanceToNow } from "date-fns";

const AGENTS = [
  {
    name: "jordan",
    port: 8001,
    label: "Jordan",
    role: "Deploy · SSH · WordPress · n8n",
    tools: 61,
    chatHref: "/chat/jordan",
  },
  {
    name: "riley",
    port: 8002,
    label: "Riley",
    role: "Tasks · Memory · Weekly digest",
    tools: 30,
    chatHref: "/chat/riley",
  },
  {
    name: "avery",
    port: 8003,
    label: "Avery",
    role: "Content · Audits · Research",
    tools: 32,
    chatHref: "/chat/avery",
  },
  {
    name: "casey",
    port: 8004,
    label: "Casey",
    role: "Audit · Regression · Health checks",
    tools: 36,
    chatHref: null, // Casey has no chat UI
  },
  {
    name: "sam",
    port: 8005,
    label: "Sam",
    role: "Accounting · Legal · HR",
    tools: 25,
    chatHref: "/chat/sam",
  },
];

interface AgentStatus {
  agent: string;
  executions_24h: number;
  errors_24h: number;
  last_execution: string;
  last_status: string;
}

export default function AgentCentralPage() {
  const [agentStatus, setAgentStatus] = useState<AgentStatus[]>([]);
  const [loading, setLoading]         = useState(true);

  const load = useCallback(async () => {
    const data = await fetch("/api/agent-status")
      .then(r => r.json())
      .catch(() => []);
    setAgentStatus(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  function statusFor(name: string): AgentStatus | undefined {
    return agentStatus.find(a => a.agent === name);
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl pb-24 md:pb-8">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <h1 className="text-xl font-semibold text-brand-black">Agent Central</h1>
        <div className="flex gap-2">
          <Link href="/agents/history"     className="btn-secondary text-sm px-3 py-1.5">History →</Link>
          <Link href="/agents/intelligence" className="btn-secondary text-sm px-3 py-1.5">Intelligence →</Link>
          <Link href="/work"               className="btn-secondary text-sm px-3 py-1.5">Work board →</Link>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {AGENTS.map(a => <div key={a.name} className="card animate-pulse h-36" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {AGENTS.map(a => {
            const s = statusFor(a.name);
            const hasError = (s?.errors_24h ?? 0) > 0;
            return (
              <div key={a.name} className="card p-4 flex flex-col gap-3">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <AgentBadge agent={a.name} />
                    <div>
                      <p className="text-sm font-semibold text-brand-black">{a.label}</p>
                      <p className="text-xs text-brand-muted">port {a.port} · {a.tools} tools</p>
                    </div>
                  </div>
                  <div className={clsx(
                    "w-2 h-2 rounded-full flex-shrink-0",
                    hasError ? "bg-amber-400" : "bg-green-400"
                  )} />
                </div>

                {/* Role */}
                <p className="text-xs text-brand-muted">{a.role}</p>

                {/* 24h stats */}
                {s && (
                  <div className="flex gap-4 text-xs">
                    <span className="text-brand-muted">
                      <span className="text-brand-black font-medium">{s.executions_24h}</span> executions
                    </span>
                    {s.errors_24h > 0 && (
                      <span className="text-red-600">
                        <span className="font-medium">{s.errors_24h}</span> errors
                      </span>
                    )}
                  </div>
                )}
                {s?.last_execution && (
                  <p className="text-[10px] text-brand-muted">
                    Last: {formatDistanceToNow(new Date(s.last_execution), { addSuffix: true })}
                  </p>
                )}

                {/* Actions */}
                <div className="flex gap-2 mt-auto pt-1">
                  {a.chatHref ? (
                    <Link href={a.chatHref}
                      className="flex-1 text-center text-xs py-1.5 rounded-lg bg-brand-orange text-white hover:bg-brand-orange/90 transition-colors font-medium">
                      Chat
                    </Link>
                  ) : (
                    <span className="flex-1 text-center text-xs py-1.5 rounded-lg bg-brand-offwhite text-brand-muted">
                      No chat
                    </span>
                  )}
                  <Link href={`/agents/history?agent=${a.name}`}
                    className="flex-1 text-center text-xs py-1.5 rounded-lg border border-brand-border text-brand-muted hover:bg-brand-offwhite hover:text-brand-black transition-colors">
                    History
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Agent prompts shortcut */}
      <div className="mt-6">
        <div className="card p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-brand-black">Agent Prompts</p>
            <p className="text-xs text-brand-muted mt-0.5">Edit live system prompts — changes take effect on next message</p>
          </div>
          <Link href="/agents/agent-prompts"
            className="px-3 py-1.5 rounded-lg border border-brand-border text-sm text-brand-muted hover:bg-brand-offwhite hover:text-brand-black transition-colors flex-shrink-0">
            Edit prompts →
          </Link>
        </div>
      </div>
    </div>
  );
}
```

Note: `btn-secondary` — if that class doesn't exist, use the inline class from Task 4 note.

- [ ] **Step 2: Build and verify**

```bash
mkdir -p src/app/\(dashboard\)/agent-central
npm run build
```

Open `/agent-central` — 5 agent cards with status indicators, chat buttons, 24h stats.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/agent-central/
git commit -m "feat(7.7): agent central workspace — 5 agent cards + chat shortcuts"
```

---

## Task 9: Finance Workspace

New page at `/finance`. Shows: AI cost summary (iframe-links to /cost), Sam pending approvals filter, billing link.

**Files:**
- Create: `src/app/(dashboard)/finance/page.tsx`

- [ ] **Step 1: Create the page**

```typescript
// src/app/(dashboard)/finance/page.tsx
"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";
import { ApprovalCard } from "@/components/ApprovalCard";
import { PendingApproval } from "@/types";

export default function FinancePage() {
  const [samApprovals, setSamApprovals] = useState<PendingApproval[]>([]);
  const [usage, setUsage]               = useState<{ totalCost: number; agents: { agent: string; todayCost: number; monthCost: number }[] } | null>(null);
  const [loading, setLoading]           = useState(true);

  const load = useCallback(async () => {
    const [approvals, usageData] = await Promise.all([
      fetch("/api/approvals").then(r => r.json()).catch(() => []),
      fetch("/api/usage?days=30").then(r => r.json()).catch(() => null),
    ]);

    // Filter to Sam's action-class approvals only
    const samOnly = Array.isArray(approvals)
      ? approvals.filter((a: PendingApproval) => a.agent === "sam")
      : [];
    setSamApprovals(samOnly);

    if (usageData?.agents) {
      const agents = usageData.agents as { agent: string; todayCost: number; monthCost: number }[];
      const totalCost = agents.reduce((sum, a) => sum + (a.monthCost ?? 0), 0);
      setUsage({ totalCost, agents });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, [load]);

  async function handleApproval(id: string, status: "approved" | "rejected" | "revision_requested") {
    await fetch("/api/approvals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    setSamApprovals(prev => prev.filter(a => a.id !== id));
  }

  if (loading) {
    return (
      <div className="p-4 md:p-8 space-y-4">
        {[1,2].map(i => <div key={i} className="card animate-pulse h-32" />)}
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl pb-24 md:pb-8">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <h1 className="text-xl font-semibold text-brand-black">Finance</h1>
        <Link href="/cost" className="text-xs text-brand-orange hover:underline">
          Full AI cost report →
        </Link>
      </div>

      <div className="space-y-4">

        {/* AI cost summary */}
        <div className="card p-4">
          <p className="text-sm font-medium text-brand-black mb-3">AI Cost (30 days)</p>
          {usage ? (
            <>
              <p className="text-2xl font-semibold text-brand-black">${usage.totalCost.toFixed(4)}</p>
              <p className="text-xs text-brand-muted mt-0.5 mb-3">across all agents</p>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {usage.agents.map(a => (
                  <div key={a.agent} className="rounded-lg bg-brand-offwhite px-3 py-2">
                    <p className="text-[10px] text-brand-muted capitalize">{a.agent}</p>
                    <p className="text-sm font-medium text-brand-black">${(a.monthCost ?? 0).toFixed(4)}</p>
                    <p className="text-[10px] text-brand-muted">today ${(a.todayCost ?? 0).toFixed(4)}</p>
                  </div>
                ))}
              </div>
              <Link href="/cost" className="block mt-3 text-xs text-brand-orange hover:underline">
                View detailed cost breakdown by model and agent →
              </Link>
            </>
          ) : (
            <p className="text-sm text-brand-muted">Cost data unavailable (LiteLLM not configured)</p>
          )}
        </div>

        {/* Sam pending approvals */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-brand-black">
              Sam — Pending Actions
              {samApprovals.length > 0 && (
                <span className="ml-2 text-xs text-brand-muted font-normal">
                  {samApprovals.length} waiting
                </span>
              )}
            </h2>
            <Link href="/approvals?agent=sam" className="text-xs text-brand-orange hover:underline">
              All approvals →
            </Link>
          </div>
          {samApprovals.length === 0 ? (
            <div className="card text-center py-6">
              <p className="text-sm text-brand-muted">No pending Sam actions</p>
              <p className="text-xs text-brand-muted mt-1">Sam is running autonomously</p>
            </div>
          ) : (
            <div className="space-y-3">
              {samApprovals.slice(0, 5).map(a => (
                <ApprovalCard key={a.id} approval={a} onAction={handleApproval} />
              ))}
              {samApprovals.length > 5 && (
                <Link href="/approvals" className="block text-center text-xs text-brand-orange py-2 hover:underline">
                  +{samApprovals.length - 5} more →
                </Link>
              )}
            </div>
          )}
        </div>

        {/* Finance links */}
        <div className="card p-4">
          <p className="text-sm font-medium text-brand-black mb-3">Finance Links</p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "AI Cost Report",   href: "/cost",    desc: "LiteLLM spend by model" },
              { label: "Billing",          href: "/billing", desc: "Subscription & invoices" },
            ].map(l => (
              <Link key={l.href} href={l.href}
                className="p-3 rounded-lg border border-brand-border hover:border-brand-orange/40 hover:bg-brand-offwhite/50 transition-all">
                <p className="text-sm font-medium text-brand-black">{l.label}</p>
                <p className="text-xs text-brand-muted mt-0.5">{l.desc}</p>
              </Link>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
```

Note: `PendingApproval` type and `ApprovalCard` are imported from existing files. Verify `PendingApproval` has an `agent` field by checking `src/types/index.ts`. If not, use `(a as any).agent`.

- [ ] **Step 2: Build and verify**

```bash
mkdir -p src/app/\(dashboard\)/finance
npm run build
```

Open `/finance` — AI cost panel at top, Sam approvals section below. If no Sam approvals, shows empty state. "Finance" should be active in sidebar.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/finance/
git commit -m "feat(7.8): finance workspace — AI cost + Sam approvals"
```

---

## Task 10: Tools Workspace

New page at `/tools`. A grid of operational tool tiles linking to existing deep pages.

**Files:**
- Create: `src/app/(dashboard)/tools/page.tsx`

- [ ] **Step 1: Create the page**

```typescript
// src/app/(dashboard)/tools/page.tsx
"use client";
import Link from "next/link";

const TOOLS = [
  {
    label: "Backup",
    href: "/backup",
    icon: "M21 8 21 21 3 21 3 8M1 3h22v5H1zM10 12h4",
    desc: "VPS backup and restore",
  },
  {
    label: "Users",
    href: "/users",
    icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
    desc: "Dashboard user accounts",
  },
  {
    label: "Roles (RBAC)",
    href: "/rbac",
    icon: "M3 11V7a5 5 0 0 1 10 0v4M5 11h14v11H5z",
    desc: "Permission roles and assignments",
  },
  {
    label: "SQL Runner",
    href: "/sql",
    icon: "M12 5a3 3 0 0 0-3 3v1a3 3 0 0 0 6 0V8a3 3 0 0 0-3-3zM3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5M21 12c0 1.66-4 3-9 3s-9-1.34-9-3",
    desc: "Run queries against Supabase",
  },
  {
    label: "Terminal",
    href: "/engineering",
    icon: "M4 17 10 11 4 5M12 19h8",
    desc: "Jordan SSH terminal",
  },
  {
    label: "Agent Prompts",
    href: "/agents/agent-prompts",
    icon: "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z",
    desc: "Edit live agent system prompts",
  },
];

export default function ToolsPage() {
  return (
    <div className="p-4 md:p-8 max-w-4xl pb-24 md:pb-8">
      <h1 className="text-xl font-semibold text-brand-black mb-6">Tools</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {TOOLS.map(tool => (
          <Link
            key={tool.href}
            href={tool.href}
            className="card flex items-start gap-4 p-5 hover:border-brand-orange/40 hover:shadow-sm transition-all group"
          >
            <div className="p-2.5 rounded-xl bg-brand-offwhite group-hover:bg-orange-50 transition-colors flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
                   className="text-brand-muted group-hover:text-brand-orange transition-colors">
                <path d={tool.icon}/>
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-brand-black group-hover:text-brand-orange transition-colors">
                {tool.label}
              </p>
              <p className="text-xs text-brand-muted mt-0.5 leading-relaxed">{tool.desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build and verify**

```bash
mkdir -p src/app/\(dashboard\)/tools
npm run build
```

Open `/tools` — 6 tool tiles in a grid. Clicking each should navigate to its target route.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/tools/
git commit -m "feat(7.9): tools workspace — grid of operational tool tiles"
```

---

## Final Verification

- [ ] **Full build check**

```bash
npm run build
```

Expected: Clean compile, no TypeScript errors.

- [ ] **Smoke test navigation** (manual browser at http://localhost:3000)

Walk through each module in order:
1. `/overview` — tiles present, agent strip shows 5 agents
2. `/control-center` — infra table (8 rows), cron jobs (5 rows), activity feed
3. `/documents` — existing doc browser, images category in filter
4. `/sales` — 5 tabs (Overview/CRM/Content/Quiz/Research)
5. `/agent-central` — 5 agent cards, chat buttons
6. `/finance` — AI cost panel, Sam approvals (empty state OK)
7. `/tools` — 6 tool tiles, all clickable

Sidebar: click each module, verify correct one highlights. Navigate to `/crm/leads` — "Sales & Marketing" should highlight.

- [ ] **Push to main (auto-deploys to Vercel)**

```bash
git push origin main
```

After Vercel deploys, verify `https://dashboard.rosably.com` shows the new sidebar and all 7 module pages work in production.

---

## Known Edge Cases

- **`btn-secondary` class**: May not exist in `globals.css`. If build fails on it, replace with `px-3 py-1.5 rounded-lg border border-brand-border text-sm text-brand-muted hover:bg-brand-offwhite hover:text-brand-black transition-colors`.
- **`PendingApproval.agent` field**: If TypeScript complains in the Finance page, check `src/types/index.ts`. Add `agent?: string` to the interface if missing.
- **Research briefs table schema**: The `research_briefs` table shipped in Phase 3. If columns differ from the API route above (e.g. `topic` may be `query`), adjust the `.select(...)` string in `/api/research/briefs/route.ts`.
- **AVERY_API_URL env var**: Must be set in `.env.local` for dev and in Vercel env vars for production. Pattern: `https://avery.rosably.com`. Without it, research trigger returns 503 gracefully.
- **`/approvals?agent=sam` filter**: The `/approvals` page may not support query-string filtering yet. The Finance page still works (it filters client-side); the link just lands on the full approvals page.
