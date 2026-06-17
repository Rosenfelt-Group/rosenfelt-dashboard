# Dashboard Navigation Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat left sidebar with a dark top bar (section tabs) + collapsible left panel (sub-page nav) that collapses to a 44px icon strip.

**Architecture:** Three new components (`TopBar`, `LeftPanel`, `MobileNav`) share a single `nav-config.tsx` module for data and icon helpers. `DashboardShell` is updated to compose them. `Sidebar.tsx` is deleted.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, Tailwind CSS (with brand color tokens), `clsx`, `next/navigation`

## Global Constraints

- Brand colors from `tailwind.config.ts`: `brand-orange` = `#C05621`, `brand-border` = `#E5E3DE`, `brand-muted` = `#6B6B6E`, `brand-black` = `#1C1C1E`, `brand-offwhite` = `#F0EEE9`
- Top bar height: `46px` (desktop). Mobile top bar height: `56px` (`h-14`). Both fixed.
- No test runner exists — verification is `npm run build` (type checks) + `npm run dev` visual inspection
- Desktop breakpoint: `md:` (768px). All new desktop-only elements use `hidden md:flex`. All mobile-only elements use `md:hidden`.
- `localStorage` key format: `lpanel-collapsed-{sectionId}` where `sectionId` is the `id` field from `WORKSPACE_MODULES`
- Left panel expanded width: `188px`. Collapsed icon strip width: `44px` (`w-11`).
- Working branch: `feat/nav-redesign` (off `main` — do not work on `feat/memory-management`)
- All commits go to `feat/nav-redesign`; deploy via Vercel auto-deploy after merge to `main`

---

### Task 1: Branch setup + `nav-config.tsx`

Create the shared data/helpers module that all nav components import from. Also sets up the working branch.

**Files:**
- Create: `src/components/nav-config.tsx`

**Interfaces:**
- Produces:
  - `WORKSPACE_MODULES` — `readonly` array of section descriptors
  - `SUB_PAGES` — `Partial<Record<SectionId, SubPage[]>>` mapping section id → sub-page list
  - `SectionId` — union type of all section id strings
  - `SubPage` — `{ label: string; href: string; icon: string }`
  - `Icon({ name, size? })` — SVG icon component
  - `RosablyIcon({ size })` — logo crop component
  - `isActiveSection(mod, pathname)` — returns `boolean`
  - `isActiveSubPage(href, pathname)` — returns `boolean`

- [ ] **Step 1: Create the branch**

```bash
git -C /opt/rosenfelt/rosenfelt-dashboard checkout main
git -C /opt/rosenfelt/rosenfelt-dashboard pull
git -C /opt/rosenfelt/rosenfelt-dashboard checkout -b feat/nav-redesign
```

Expected: branch `feat/nav-redesign` created and checked out.

- [ ] **Step 2: Create `src/components/nav-config.tsx`**

```tsx
import React from "react";

export const WORKSPACE_MODULES = [
  {
    id: "dashboard",
    label: "Overview",
    tabLabel: "Overview",
    href: "/overview",
    icon: "grid",
    active: ["/overview"],
  },
  {
    id: "control",
    label: "Control Center",
    tabLabel: "Control",
    href: "/control-center",
    icon: "activity",
    active: ["/control-center", "/status", "/work", "/approvals"],
  },
  {
    id: "documents",
    label: "Documents",
    tabLabel: "Docs",
    href: "/documents",
    icon: "folder",
    active: ["/documents", "/images"],
  },
  {
    id: "sales",
    label: "Sales & Marketing",
    tabLabel: "Sales",
    href: "/sales",
    icon: "trendingUp",
    active: ["/sales", "/crm", "/quiz", "/content", "/analytics"],
  },
  {
    id: "agents",
    label: "Agent Central",
    tabLabel: "Agents",
    href: "/agent-central",
    icon: "brain",
    active: ["/agent-central", "/agents", "/chat"],
  },
  {
    id: "finance",
    label: "Finance",
    tabLabel: "Finance",
    href: "/finance",
    icon: "dollar",
    active: ["/finance", "/cost", "/billing"],
  },
  {
    id: "tools",
    label: "Tools",
    tabLabel: "Tools",
    href: "/tools",
    icon: "wrench",
    active: ["/tools", "/users", "/rbac", "/backup", "/sql", "/engineering"],
  },
] as const;

export type SectionId = typeof WORKSPACE_MODULES[number]["id"];

export interface SubPage {
  label: string;
  href: string;
  icon: string;
}

export const SUB_PAGES: Partial<Record<SectionId, SubPage[]>> = {
  control: [
    { label: "Status",     href: "/status",    icon: "activity" },
    { label: "Work Board", href: "/work",       icon: "kanban"   },
    { label: "Approvals",  href: "/approvals",  icon: "check"    },
  ],
  documents: [
    { label: "Documents", href: "/documents", icon: "folder" },
    { label: "Images",    href: "/images",    icon: "image"  },
  ],
  sales: [
    { label: "Sales",     href: "/sales",     icon: "trendingUp" },
    { label: "CRM",       href: "/crm",       icon: "users"      },
    { label: "Content",   href: "/content",   icon: "edit"       },
    { label: "Analytics", href: "/analytics", icon: "barChart"   },
    { label: "Quiz",      href: "/quiz",       icon: "package"   },
  ],
  agents: [
    { label: "Agent Central", href: "/agent-central",       icon: "brain"   },
    { label: "History",       href: "/agents/history",      icon: "history" },
    { label: "Intelligence",  href: "/agents/intelligence", icon: "shield"  },
    { label: "Chat",          href: "/chat",                icon: "chat"    },
  ],
  finance: [
    { label: "Finance", href: "/finance",  icon: "dollar"     },
    { label: "Cost",    href: "/cost",     icon: "creditCard" },
    { label: "Billing", href: "/billing",  icon: "barChart"   },
  ],
  tools: [
    { label: "Tools",  href: "/tools",       icon: "wrench"   },
    { label: "Users",  href: "/users",       icon: "users"    },
    { label: "RBAC",   href: "/rbac",        icon: "lock"     },
    { label: "Backup", href: "/backup",      icon: "archive"  },
    { label: "SQL",    href: "/sql",         icon: "database" },
    { label: "SSH",    href: "/engineering", icon: "terminal" },
  ],
};

export function isActiveSection(
  mod: typeof WORKSPACE_MODULES[number],
  pathname: string
): boolean {
  return mod.active.some(r =>
    r === "/overview"
      ? pathname === r
      : pathname === r || pathname.startsWith(r + "/")
  );
}

export function isActiveSubPage(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

// ── Icon component (moved from Sidebar.tsx) ───────────────────────────────────

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const icons: Record<string, React.ReactElement> = {
    grid:        <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    activity:    <><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></>,
    wrench:      <><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.8 2.8-2.4-2.4z"/></>,
    check:       <><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></>,
    folder:      <><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></>,
    image:       <><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></>,
    archive:     <><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></>,
    terminal:    <><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></>,
    users:       <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
    edit:        <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>,
    trendingUp:  <><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></>,
    barChart:    <><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/><line x1="3" y1="20" x2="21" y2="20"/></>,
    creditCard:  <><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></>,
    dollar:      <><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></>,
    chat:        <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></>,
    brain:       <><path d="M9.5 2a2.5 2.5 0 0 1 5 0"/><path d="M9.5 2C6 2 4 5 4 7.5c0 1.5.5 2.5 1.5 3.5L4 14c0 3 2 5 5 5h6c3 0 5-2 5-5l-1.5-3c1-.9 1.5-2 1.5-3.5C20 5 18 2 14.5 2"/><path d="M12 6v6"/><path d="M9 9h6"/></>,
    history:     <><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.78"/></>,
    shield:      <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></>,
    lock:        <><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>,
    chevronLeft: <><polyline points="15 18 9 12 15 6"/></>,
    chevronRight:<><polyline points="9 18 15 12 9 6"/></>,
    menu:        <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>,
    x:           <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
    database:    <><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></>,
    kanban:      <><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="4" height="8" rx="1"/></>,
    package:     <><path d="M16.5 9.4l-9-5.19"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></>,
    logOut:      <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>,
    approval:    <><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></>,
    funnel:      <><path d="M22 3H2l8 9.46V19l4 2V12.46L22 3z"/></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {icons[name] ?? null}
    </svg>
  );
}

// ── Logo crop (moved from Sidebar.tsx) ────────────────────────────────────────

export function RosablyIcon({ size }: { size: number }) {
  const scaledWidth = Math.round(1280 * (size / 229));
  return (
    <div style={{ width: size, height: size, overflow: "hidden", flexShrink: 0 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/rosably-logo.png" alt="" style={{ display: "block", width: scaledWidth, height: size, maxWidth: "none" }} />
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
cd /opt/rosenfelt/rosenfelt-dashboard && npm run build 2>&1 | tail -20
```

Expected: build succeeds (or the only errors are pre-existing ones unrelated to this file — a new file with no consumers won't cause failures).

- [ ] **Step 4: Commit**

```bash
git -C /opt/rosenfelt/rosenfelt-dashboard add src/components/nav-config.tsx
git -C /opt/rosenfelt/rosenfelt-dashboard commit -m "feat: nav-config — shared modules, sub-pages, icons for nav redesign"
```

---

### Task 2: `TopBar.tsx` — dark desktop top bar

**Files:**
- Create: `src/components/TopBar.tsx`

**Interfaces:**
- Consumes: `Icon`, `RosablyIcon`, `WORKSPACE_MODULES`, `isActiveSection` from `./nav-config`; `NotificationBell` from `./NotificationBell`
- Produces: `TopBar` React component (no props)

- [ ] **Step 1: Create `src/components/TopBar.tsx`**

```tsx
"use client";
import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import NotificationBell from "./NotificationBell";
import { Icon, RosablyIcon, WORKSPACE_MODULES, isActiveSection } from "./nav-config";

export function TopBar() {
  const pathname = usePathname();
  const router   = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <header className="hidden md:flex fixed top-0 inset-x-0 h-[46px] bg-[#18181b] items-center px-3 gap-1 z-20">
      {/* Logo + wordmark */}
      <div className="flex items-center gap-2 mr-2 shrink-0">
        <RosablyIcon size={26} />
        <span className="text-[13px] font-bold text-white tracking-wide">Rosably</span>
      </div>
      {/* Divider */}
      <div className="w-px h-4 bg-white/10 mr-2 shrink-0" />
      {/* Section tabs */}
      <nav className="flex items-center gap-0.5 flex-1 min-w-0">
        {WORKSPACE_MODULES.map(mod => {
          const active = isActiveSection(mod, pathname);
          return (
            <Link
              key={mod.href}
              href={mod.href}
              className={clsx(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] whitespace-nowrap transition-colors",
                active
                  ? "bg-brand-orange/20 text-brand-orange font-semibold"
                  : "text-white/40 hover:text-white/70 hover:bg-white/10"
              )}
            >
              <Icon name={mod.icon} size={13} />
              {mod.tabLabel}
            </Link>
          );
        })}
      </nav>
      {/* Right: bell + sign out */}
      <div className="flex items-center gap-2 ml-2 shrink-0">
        <NotificationBell />
        <button
          onClick={handleLogout}
          title="Sign out"
          className="p-1.5 rounded-md text-white/35 hover:text-white/70 hover:bg-white/10 transition-colors"
        >
          <Icon name="logOut" size={16} />
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd /opt/rosenfelt/rosenfelt-dashboard && npm run build 2>&1 | tail -20
```

Expected: no new TypeScript errors introduced by `TopBar.tsx`.

- [ ] **Step 3: Commit**

```bash
git -C /opt/rosenfelt/rosenfelt-dashboard add src/components/TopBar.tsx
git -C /opt/rosenfelt/rosenfelt-dashboard commit -m "feat: TopBar — dark desktop top bar with section tabs"
```

---

### Task 3: `LeftPanel.tsx` — collapsible sub-page panel

**Files:**
- Create: `src/components/LeftPanel.tsx`

**Interfaces:**
- Consumes: `Icon`, `WORKSPACE_MODULES`, `SUB_PAGES`, `isActiveSection`, `isActiveSubPage` from `./nav-config`
- Produces: `LeftPanel` React component (no props). Returns `null` for Overview (no sub-pages).

- [ ] **Step 1: Create `src/components/LeftPanel.tsx`**

```tsx
"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Icon, WORKSPACE_MODULES, SUB_PAGES, isActiveSection, isActiveSubPage } from "./nav-config";

export function LeftPanel() {
  const pathname = usePathname();

  const activeSection = WORKSPACE_MODULES.find(m => isActiveSection(m, pathname)) ?? null;
  const sectionId     = activeSection?.id ?? null;
  const subPages      = sectionId ? (SUB_PAGES[sectionId] ?? []) : [];

  const [collapsed, setCollapsed] = useState(false);

  // Load per-section collapse state from localStorage
  useEffect(() => {
    if (!sectionId) return;
    setCollapsed(localStorage.getItem(`lpanel-collapsed-${sectionId}`) === "true");
  }, [sectionId]);

  function toggle() {
    setCollapsed(prev => {
      const next = !prev;
      if (sectionId) localStorage.setItem(`lpanel-collapsed-${sectionId}`, String(next));
      return next;
    });
  }

  // No panel for Overview or sections with no sub-pages defined
  if (!subPages.length) return null;

  // ── Collapsed: icon strip ─────────────────────────────────────────────────
  if (collapsed) {
    return (
      <div className="hidden md:flex flex-col items-center w-11 bg-white border-r border-brand-border shrink-0 py-2 gap-1">
        {subPages.map(page => {
          const active = isActiveSubPage(page.href, pathname);
          return (
            <Link
              key={page.href}
              href={page.href}
              title={page.label}
              className={clsx(
                "w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
                active
                  ? "bg-orange-50 text-brand-orange"
                  : "text-brand-muted hover:text-brand-black hover:bg-brand-offwhite"
              )}
            >
              <Icon name={page.icon} size={15} />
            </Link>
          );
        })}
        {/* Expand button */}
        <button
          onClick={toggle}
          title="Expand panel"
          className="mt-auto w-8 h-8 rounded-lg bg-brand-offwhite border border-brand-border flex items-center justify-center text-brand-muted hover:text-brand-black transition-colors"
        >
          <Icon name="chevronRight" size={13} />
        </button>
      </div>
    );
  }

  // ── Expanded ──────────────────────────────────────────────────────────────
  return (
    <div className="hidden md:flex flex-col w-[188px] bg-white border-r border-brand-border shrink-0 transition-[width] duration-200">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
        <span className="text-[9px] font-bold uppercase tracking-widest text-brand-border">
          {activeSection?.label}
        </span>
        <button
          onClick={toggle}
          title="Collapse panel"
          className="w-5 h-5 rounded flex items-center justify-center bg-brand-offwhite border border-brand-border text-brand-muted hover:text-brand-black transition-colors"
        >
          <Icon name="chevronLeft" size={11} />
        </button>
      </div>
      {/* Sub-pages */}
      <nav className="flex-1 py-1">
        {subPages.map(page => {
          const active = isActiveSubPage(page.href, pathname);
          return (
            <Link
              key={page.href}
              href={page.href}
              className={clsx(
                "flex items-center gap-2.5 py-1.5 text-[12px] transition-colors",
                active
                  ? "bg-orange-50 text-brand-orange font-semibold border-l-2 border-brand-orange pl-[10px] pr-3"
                  : "text-brand-black hover:bg-brand-offwhite px-3"
              )}
            >
              <span className={clsx(
                "w-1.5 h-1.5 rounded-full shrink-0",
                active ? "bg-brand-orange" : "bg-brand-border"
              )} />
              {page.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd /opt/rosenfelt/rosenfelt-dashboard && npm run build 2>&1 | tail -20
```

Expected: no new TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git -C /opt/rosenfelt/rosenfelt-dashboard add src/components/LeftPanel.tsx
git -C /opt/rosenfelt/rosenfelt-dashboard commit -m "feat: LeftPanel — collapsible sub-page nav with icon-strip collapse"
```

---

### Task 4: `MobileNav.tsx` — extract mobile nav from `Sidebar.tsx`

Extract the existing mobile hamburger + drawer verbatim from `Sidebar.tsx`, swapping its `WORKSPACE_MODULES` and `Icon`/`RosablyIcon` imports for the shared module. No behaviour changes.

**Files:**
- Create: `src/components/MobileNav.tsx`

**Interfaces:**
- Consumes: `Icon`, `RosablyIcon`, `WORKSPACE_MODULES`, `isActiveSection` from `./nav-config`; `NotificationBell` from `./NotificationBell`
- Produces: `MobileNav` React component (no props). Renders `md:hidden` elements only.

- [ ] **Step 1: Create `src/components/MobileNav.tsx`**

```tsx
"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import NotificationBell from "./NotificationBell";
import { Icon, RosablyIcon, WORKSPACE_MODULES, isActiveSection } from "./nav-config";

export function MobileNav() {
  const pathname      = usePathname();
  const router        = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(false); }, [pathname]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <>
      {/* Mobile top bar */}
      <header className="md:hidden fixed top-0 inset-x-0 h-14 bg-white border-b border-brand-border
                         flex items-center justify-between px-4 z-20">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
            className="p-1.5 -ml-1.5 rounded-md text-brand-muted hover:bg-brand-offwhite transition-colors"
          >
            <Icon name="menu" />
          </button>
          <div className="flex items-center gap-2">
            <RosablyIcon size={22} />
            <p className="text-sm font-semibold text-brand-black">Rosably</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <NotificationBell />
          <button
            onClick={handleLogout}
            aria-label="Sign out"
            className="p-1.5 -mr-1.5 rounded-md text-brand-muted hover:bg-brand-offwhite transition-colors"
          >
            <Icon name="logOut" />
          </button>
        </div>
      </header>

      {/* Backdrop */}
      <div
        className={clsx(
          "md:hidden fixed inset-0 z-20 bg-black/40 backdrop-blur-sm transition-opacity duration-200",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={() => setOpen(false)}
      />

      {/* Drawer */}
      <aside className={clsx(
        "md:hidden fixed inset-y-0 left-0 z-30 w-72 bg-white shadow-2xl flex flex-col",
        "transition-transform duration-200",
        open ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-brand-border shrink-0">
          <div className="flex items-center gap-2.5">
            <RosablyIcon size={26} />
            <div>
              <p className="text-sm font-semibold text-brand-black leading-tight">Rosably</p>
              <p className="text-xs text-brand-muted leading-tight">Workspace</p>
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
            className="p-1.5 rounded-md text-brand-muted hover:bg-brand-offwhite transition-colors"
          >
            <Icon name="x" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto py-3 px-3">
          <div className="space-y-1">
            {WORKSPACE_MODULES.map(mod => {
              const active = isActiveSection(mod, pathname);
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
        <div className="px-3 py-3 border-t border-brand-border shrink-0">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3.5 px-3 py-3 w-full rounded-xl text-brand-muted hover:bg-brand-offwhite hover:text-brand-black transition-colors"
          >
            <div className="p-2 rounded-lg bg-brand-offwhite shrink-0">
              <Icon name="logOut" size={20} />
            </div>
            <span className="text-[15px] font-medium">Sign out</span>
          </button>
        </div>
      </aside>
    </>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd /opt/rosenfelt/rosenfelt-dashboard && npm run build 2>&1 | tail -20
```

Expected: no new TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git -C /opt/rosenfelt/rosenfelt-dashboard add src/components/MobileNav.tsx
git -C /opt/rosenfelt/rosenfelt-dashboard commit -m "feat: MobileNav — extract mobile hamburger+drawer from Sidebar"
```

---

### Task 5: Update `DashboardShell.tsx` + delete `Sidebar.tsx`

Wire the three new components into the shell, remove the old sidebar, and verify the full layout works end-to-end.

**Files:**
- Modify: `src/components/DashboardShell.tsx`
- Delete: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `TopBar` from `./TopBar`; `LeftPanel` from `./LeftPanel`; `MobileNav` from `./MobileNav`
- The `SystemBanner` and `useSystemAlerts` hook stay in this file, unchanged.

- [ ] **Step 1: Replace the contents of `src/components/DashboardShell.tsx`**

Keep `useSystemAlerts` and `SystemBanner` exactly as they are — only change the `DashboardShell` function and its imports.

The full file:

```tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { TopBar }    from "./TopBar";
import { LeftPanel } from "./LeftPanel";
import { MobileNav } from "./MobileNav";

// ── System alerts ─────────────────────────────────────────────────────────────

interface Alert {
  level: "error" | "warning";
  label: string;
}

function useSystemAlerts(): Alert[] {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    async function check() {
      try {
        const [health, stats, runs] = await Promise.all([
          fetch("/api/agent-status/health").then(r => r.ok ? r.json() : []).catch(() => []),
          fetch("/api/agent-status").then(r => r.ok ? r.json() : []).catch(() => []),
          fetch("/api/github/runs").then(r => r.ok ? r.json() : []).catch(() => []),
        ]) as [
          { agent: string; status: string; error?: string }[],
          { agent: string; errors_24h: number }[],
          { repo: string; status: string; conclusion: string | null }[],
        ];

        const next: Alert[] = [];

        for (const h of health) {
          if (h.status === "down") {
            next.push({ level: "error", label: `${h.agent} agent is down` });
          }
        }

        for (const s of stats) {
          if (s.errors_24h > 0 && !next.some(a => a.label.includes(s.agent))) {
            next.push({ level: "warning", label: `${s.agent}: ${s.errors_24h} error${s.errors_24h !== 1 ? "s" : ""} in 24h` });
          }
        }

        const seenRepos = new Set<string>();
        for (const run of runs) {
          if (seenRepos.has(run.repo)) continue;
          seenRepos.add(run.repo);
          if (run.conclusion === "failure") {
            next.push({ level: "warning", label: `${run.repo}: CI failed` });
          }
        }

        setAlerts(next);
      } catch {}
    }

    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, []);

  return alerts;
}

// ── Banner ────────────────────────────────────────────────────────────────────

function SystemBanner() {
  const alerts              = useSystemAlerts();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || alerts.length === 0) return null;

  const isError = alerts.some(a => a.level === "error");
  const primary = alerts[0];
  const rest    = alerts.length - 1;

  return (
    <div className={clsx(
      "flex items-center gap-2 px-4 py-2.5 text-xs border-b",
      isError
        ? "bg-red-50 border-red-200 text-red-800"
        : "bg-amber-50 border-amber-200 text-amber-800"
    )}>
      <span className={clsx(
        "w-1.5 h-1.5 rounded-full flex-shrink-0",
        isError ? "bg-red-500 animate-pulse" : "bg-amber-400"
      )} />
      <span className="font-semibold flex-shrink-0">{isError ? "System issue:" : "Warning:"}</span>
      <span className="truncate">{primary.label}</span>
      {rest > 0 && <span className="flex-shrink-0 opacity-70">+{rest} more</span>}
      <Link
        href="/status"
        className={clsx("flex-shrink-0 underline font-medium ml-1", isError ? "text-red-700" : "text-amber-700")}
      >
        View status →
      </Link>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className={clsx(
          "ml-auto flex-shrink-0 p-0.5 rounded hover:bg-black/10 transition-colors",
          isError ? "text-red-600" : "text-amber-600"
        )}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────────────

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-brand-offwhite">
      <TopBar />
      <MobileNav />
      {/* Offset for fixed top bars: mobile h-14 (56px), desktop h-[46px] */}
      <div className="flex min-h-screen pt-14 md:pt-[46px]">
        <LeftPanel />
        <main className="flex-1 min-h-screen">
          <SystemBanner />
          {children}
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Delete `Sidebar.tsx`**

```bash
rm /opt/rosenfelt/rosenfelt-dashboard/src/components/Sidebar.tsx
```

- [ ] **Step 3: Verify build — expect it to pass cleanly**

```bash
cd /opt/rosenfelt/rosenfelt-dashboard && npm run build 2>&1 | tail -30
```

Expected: build succeeds with no TypeScript errors. If there are import errors referencing `Sidebar`, find them with:

```bash
grep -r "from.*Sidebar" /opt/rosenfelt/rosenfelt-dashboard/src --include="*.tsx" --include="*.ts"
```

Fix any remaining imports (should only be `DashboardShell.tsx`, which no longer imports it).

- [ ] **Step 4: Visual verification — start dev server**

```bash
cd /opt/rosenfelt/rosenfelt-dashboard && npm run dev
```

Open http://localhost:3000 and verify:
1. Dark top bar visible at top with all 7 section tabs
2. Active section tab has orange pill highlight
3. Left panel visible with sub-pages for the active section
4. Clicking a section tab switches the active tab + updates the left panel
5. Clicking a sub-page item highlights it with orange left-border
6. Collapse button (‹) shrinks panel to icon strip (44px)
7. Icon strip shows active page icon in orange
8. Expand button (›) at bottom of strip restores full panel
9. Overview has no left panel (full-width content)
10. Mobile (resize to <768px): dark top bar hidden, white mobile header shown, hamburger opens drawer

- [ ] **Step 5: Commit**

```bash
git -C /opt/rosenfelt/rosenfelt-dashboard add src/components/DashboardShell.tsx
git -C /opt/rosenfelt/rosenfelt-dashboard rm src/components/Sidebar.tsx
git -C /opt/rosenfelt/rosenfelt-dashboard commit -m "feat: wire TopBar + LeftPanel + MobileNav into DashboardShell, delete Sidebar"
```

---

### Task 6: Push and open PR

- [ ] **Step 1: Push branch**

```bash
git -C /opt/rosenfelt/rosenfelt-dashboard push -u origin feat/nav-redesign
```

- [ ] **Step 2: Open PR**

```bash
gh pr create \
  --repo Rosenfelt-Group/rosenfelt-dashboard \
  --base main \
  --head feat/nav-redesign \
  --title "feat: dashboard nav redesign — dark top bar + collapsible left panel" \
  --body "$(cat <<'EOF'
## Summary

- Replaces the flat left sidebar with a two-level nav: dark top bar (section tabs) + collapsible left panel (sub-pages)
- Left panel collapses to a 44px icon strip; collapse state persists per-section in localStorage
- Backup, SQL, and SSH (Engineering) moved from Control Center to Tools section
- Mobile nav unchanged (extracted from Sidebar into MobileNav.tsx with no behaviour change)
- Sidebar.tsx deleted; replaced by TopBar.tsx + LeftPanel.tsx + MobileNav.tsx + nav-config.tsx

## Test plan

- [ ] All 7 section tabs visible in dark top bar on desktop
- [ ] Active section tab has orange pill highlight
- [ ] Left panel shows correct sub-pages per section
- [ ] Active sub-page has orange left-border indicator
- [ ] Panel collapses to 44px icon strip via ‹ button
- [ ] Icon strip shows active page in orange; expand › button restores panel
- [ ] Collapse state persists across page reloads (localStorage)
- [ ] Overview section renders full-width (no left panel)
- [ ] Mobile hamburger + drawer still works correctly
- [ ] SystemBanner (agent alerts) still appears when agents are down
- [ ] `npm run build` passes with no TypeScript errors

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Share with Brian for review before merging to main (Vercel auto-deploys on merge).
