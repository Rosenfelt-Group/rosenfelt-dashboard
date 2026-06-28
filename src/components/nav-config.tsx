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
    active: ["/sales", "/crm", "/quiz", "/content", "/analytics", "/marketing"],
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
    { label: "Sales",      href: "/sales",      icon: "trendingUp" },
    { label: "CRM",        href: "/crm",        icon: "users"      },
    { label: "Content",    href: "/content",    icon: "edit"       },
    { label: "Analytics",  href: "/analytics",  icon: "barChart"   },
    { label: "Quiz",       href: "/quiz",        icon: "package"   },
    { label: "Marketing",  href: "/marketing",  icon: "trendingUp" },
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
    chevronRight: <><polyline points="9 18 15 12 9 6"/></>,
    menu:        <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>,
    x:           <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
    database:    <><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></>,
    kanban:      <><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="4" height="8" rx="1"/></>,
    package:     <><path d="M16.5 9.4l-9-5.19"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></>,
    logOut:      <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>,
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
