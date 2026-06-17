# Dashboard Navigation Redesign — Design Spec

**Date:** 2026-06-17
**Status:** Approved
**Mockups:** https://mockups.rosably.com (tabs: Dashboard Nav Redesign, Option B series)

---

## Summary

Replace the current collapsible left sidebar with a two-level navigation system: a persistent dark top bar holds the 7 section tabs, and a collapsible left panel shows sub-pages for the active section. The left panel collapses to a 44px icon strip rather than disappearing entirely.

---

## Current State

- Single left sidebar, 224px expanded / 56px collapsed (icon-only)
- All 7 sections in the sidebar as flat links — no inline sub-pages
- Sub-pages only accessible by navigating to a section's landing page first
- CRM is the only section with its own secondary tab nav (`CRMNav` component)
- Mobile: hamburger button → full-height drawer

**Pain points being solved:**
- Sub-pages buried — no way to jump directly from any page
- Collapsed sidebar loses all section labels
- No clear visual separation between "which section" and "which page"

---

## Design

### 1. Dark Top Bar

A full-width persistent top bar replaces the top portion of the sidebar.

**Height:** 46px
**Background:** `#18181b`
**Left side:** Rosably logo (orange 26×26px rounded square) + wordmark "Rosably" in white, separated from tabs by a 1px vertical divider
**Tabs:** One per section (7 total). Layout: icon + abbreviated label (e.g. "◎ Control", "📁 Docs"). 
- **Inactive:** `rgba(255,255,255,0.4)` text, no background
- **Hover:** `rgba(255,255,255,0.7)` text + `rgba(255,255,255,0.07)` background
- **Active:** `rgba(249,115,22,0.22)` background (orange pill) + `#fb923c` text + `font-weight: 600`
**Right side:** Notification bell (with orange dot badge when alerts exist) + sign-out icon, `rgba(255,255,255,0.35)` color
**Replaces:** The existing `Sidebar` component's desktop layout; the logo/wordmark/sign-out currently in the sidebar footer move here

Section tab order (matches current `WORKSPACE_MODULES`):
1. ⊞ Overview
2. ◎ Control
3. 📁 Docs
4. ↗ Sales
5. 🧠 Agents
6. $ Finance
7. ⚙ Tools

### 2. Left Sub-Page Panel

A collapsible left panel that appears below the top bar and shows sub-pages for the active section.

**Expanded width:** 188px
**Background:** white
**Border:** 1px solid `#e5e7eb` on the right
**Header:** Section name in 9px uppercase muted label (`#d1d5db`) + collapse toggle button (‹) in the top-right of the panel
**Items:** One per sub-page, 12px text, `#374151`
- **Active:** `#fff7ed` background, `#f97316` text, `font-weight: 600`, 2px `#f97316` left border
- **Muted/secondary items:** `#9ca3af` text (e.g. Backup, SQL in Control Center)
- **Dot indicator:** 6px circle before each label — orange for active, light gray otherwise

**Collapsed state (icon strip):**
- Width: 44px
- Each sub-page becomes a 32×32px rounded icon tile (14px emoji/icon)
- Active tile: `#fff7ed` background + `#f97316` icon
- Inactive: `#9ca3af` icon
- Muted items: reduced opacity (0.4)
- Expand arrow (›) pinned at the bottom of the strip, restores full panel
- Hover tooltip shows the sub-page label (dark tooltip, right of icon)

**Collapse toggle:** `‹` / `›` button in the panel header. State persisted per-section in `localStorage` (key: `lpanel-collapsed-{sectionId}`). Each section remembers its own collapse state independently.

**No panel state:** Sections with only one destination (currently Overview → `/overview`) render no left panel at all. Content fills full width immediately below the top bar.

### 3. Sub-Page Maps

Sections and their left-panel items (matches current `active` arrays in `WORKSPACE_MODULES`):

| Section | Sub-pages in left panel |
|---|---|
| Overview | *(no panel — single page)* |
| Control | Status, Work Board, Approvals, Engineering, Backup\*, SQL\* |
| Documents | Documents, Images |
| Sales | Sales, CRM, Content, Analytics, Quiz |
| Agents | Agent Central, History, Intelligence, Chat |
| Finance | Finance, Cost, Billing |
| Tools | Tools, Users, RBAC |

\* Backup and SQL rendered as muted items (secondary priority).

**CRM sub-sub navigation:** The existing `CRMNav` tab component (Pipeline, Leads, Contacts, Businesses, Clients) remains as an in-page tab bar within the CRM sub-pages. It is not moved into the left panel.

### 4. Layout Shell

The `DashboardShell` layout changes:

- `collapsed` / `onToggle` state moves to per-section panel collapse, not a global sidebar toggle
- Top bar is always full-width, fixed, `z-index: 20`
- `main` content area: `padding-top` equals the top bar height (46px) + 0 left margin (no sidebar offset)
- Left panel is positioned within the content area (not fixed), part of the page flow: `flex` row with `main-content`
- `SystemBanner` (alerts) renders between the top bar and the body — spans full width

### 5. Mobile (unchanged)

The existing mobile hamburger → drawer pattern is retained without modification. The top bar renders on desktop only (`md:` breakpoint). Mobile continues to use the `header` + `aside` drawer in the current `Sidebar` component.

---

## Components to Change

| File | Change |
|---|---|
| `src/components/Sidebar.tsx` | Delete. Desktop nav moves to `TopBar` + `LeftPanel`; mobile nav moves to `MobileNav` |
| `src/components/DashboardShell.tsx` | Remove `collapsed`/`toggle` global state; adjust `main` margins; render `TopBar` above content; render `MobileNav` for mobile |
| `src/app/(dashboard)/layout.tsx` | No change (still wraps in `DashboardShell`) |
| `src/components/CRMNav.tsx` | No change |

New components:
- `src/components/TopBar.tsx` — dark top bar with section tabs, bell, sign-out. Includes the `Icon` + `RosablyIcon` helpers (moved from `Sidebar.tsx`). Desktop only (`hidden md:flex`).
- `src/components/LeftPanel.tsx` — collapsible sub-page panel with icon-strip mode. Desktop only.
- `src/components/MobileNav.tsx` — the existing mobile hamburger + drawer extracted verbatim from `Sidebar.tsx`. Mobile only (`md:hidden`).

---

## Behaviour Details

- **Active section detection:** same `isActive()` logic as current sidebar — pathname prefix matching per section's `active` array
- **Active sub-page detection:** exact match or prefix match on pathname
- **Notification bell:** `NotificationBell` component moves from sidebar footer to top bar right
- **Sign-out:** `handleLogout` moves from sidebar footer to top bar right (icon button)
- **`localStorage` keys:**
  - `lpanel-collapsed-{sectionId}` → `"true"` | `"false"` per section
- **Transition:** `transition-[width] duration-200` on the left panel for smooth collapse/expand

---

## Out of Scope

- Mobile nav changes
- Any changes to page content or existing page components
- CRM sub-sub navigation restructuring
- Keyboard navigation / accessibility improvements (future)
- Any new pages or routes
