"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import { can } from "@/lib/permissions";

// ── Types ──────────────────────────────────────────────────────────────────────

type NavItem = {
  label: string;
  href: string;
  icon: string;
  module: string;
  requiredPermission?: string;
};

// ── Navigation map ─────────────────────────────────────────────────────────────

const MODULES = [
  { key: "overview",       label: "Overview" },
  { key: "systems",        label: "Systems" },
  { key: "salesMarketing", label: "Sales & Marketing" },
  { key: "accounting",     label: "Accounting" },
  { key: "agents",         label: "Agents" },
  { key: "documentation",  label: "Documentation" },
  { key: "security",       label: "Security" },
];

const NAV: NavItem[] = [
  // Overview
  { label: "Overview",     href: "/overview",            icon: "grid",       module: "overview" },
  { label: "Approvals",    href: "/approvals",           icon: "approval",   module: "overview" },

  // Systems
  { label: "Status",       href: "/status",              icon: "activity",   module: "systems" },
  { label: "Work",         href: "/work",                icon: "kanban",     module: "systems" },
  { label: "Backup",       href: "/backup",              icon: "archive",    module: "systems" },
  { label: "SQL",          href: "/sql",                 icon: "database",   module: "systems",       requiredPermission: "manage_users" },
  { label: "Terminal",     href: "/engineering",         icon: "terminal",   module: "systems",       requiredPermission: "manage_users" },

  // Sales & Marketing
  { label: "CRM",          href: "/crm",                 icon: "users",      module: "salesMarketing" },
  { label: "Content",      href: "/content",             icon: "edit",       module: "salesMarketing" },
  { label: "Keywords",     href: "/content/keywords",    icon: "trendingUp", module: "salesMarketing" },
  { label: "Analytics",    href: "/analytics",           icon: "barChart",   module: "salesMarketing" },

  // Accounting
  { label: "Billing",      href: "/billing",             icon: "creditCard", module: "accounting" },
  { label: "Cost",         href: "/cost",                icon: "dollar",     module: "accounting" },

  // Agents
  { label: "Chat",         href: "/chat",                icon: "chat",       module: "agents",  requiredPermission: "use_chat" },
  { label: "Intelligence", href: "/agents/intelligence", icon: "brain",      module: "agents" },
  { label: "History",      href: "/agents/history",      icon: "history",    module: "agents" },

  // Documentation
  { label: "Documents",    href: "/documents",           icon: "folder",     module: "documentation" },
  { label: "Images",       href: "/images",              icon: "image",      module: "documentation" },

  // Security
  { label: "Users",        href: "/users",               icon: "shield",     module: "security", requiredPermission: "manage_users" },
  { label: "Roles",        href: "/rbac",                icon: "lock",       module: "security", requiredPermission: "manage_rbac" },
];

// ── Icons ─────────────────────────────────────────────────────────────────────

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const icons: Record<string, React.ReactElement> = {
    grid:         <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    approval:     <><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></>,
    activity:     <><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></>,
    wrench:       <><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.8 2.8-2.4-2.4z"/></>,
    check:        <><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></>,
    folder:       <><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></>,
    image:        <><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></>,
    archive:      <><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></>,
    terminal:     <><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></>,
    users:        <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
    edit:         <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>,
    trendingUp:   <><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></>,
    barChart:     <><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/><line x1="3" y1="20" x2="21" y2="20"/></>,
    creditCard:   <><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></>,
    dollar:       <><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></>,
    chat:         <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></>,
    brain:        <><path d="M9.5 2a2.5 2.5 0 0 1 5 0"/><path d="M9.5 2C6 2 4 5 4 7.5c0 1.5.5 2.5 1.5 3.5L4 14c0 3 2 5 5 5h6c3 0 5-2 5-5l-1.5-3c1-.9 1.5-2 1.5-3.5C20 5 18 2 14.5 2"/><path d="M12 6v6"/><path d="M9 9h6"/></>,
    history:      <><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.78"/></>,
    shield:       <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></>,
    lock:         <><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>,
    chevronDown:  <><polyline points="6 9 12 15 18 9"/></>,
    chevronLeft:  <><polyline points="15 18 9 12 15 6"/></>,
    chevronRight: <><polyline points="9 18 15 12 9 6"/></>,
    menu:         <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>,
    x:            <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
    database:     <><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></>,
    kanban:       <><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="4" height="8" rx="1"/></>,
    logOut:       <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {icons[name] ?? null}
    </svg>
  );
}

// Rosably rose-mark icon (crops just the logomark from the full logo PNG)
function RosablyIcon({ size }: { size: number }) {
  const scaledWidth = Math.round(1280 * (size / 229));
  return (
    <div style={{ width: size, height: size, overflow: "hidden", flexShrink: 0 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/rosably-logo.png" alt="" style={{ display: "block", width: scaledWidth, height: size, maxWidth: "none" }} />
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const pathname = usePathname();
  const router   = useRouter();

  const [permissions,      setPermissions]      = useState<string[]>([]);
  const [isMobileOpen,     setIsMobileOpen]     = useState(false);
  const [collapsedModules, setCollapsedModules] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const stored = localStorage.getItem("sidebar-modules-collapsed");
      return stored ? new Set<string>(JSON.parse(stored)) : new Set<string>();
    } catch { return new Set<string>(); }
  });

  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.permissions) setPermissions(data.permissions); })
      .catch(() => {});
  }, []);

  // Close mobile drawer on navigation
  useEffect(() => { setIsMobileOpen(false); }, [pathname]);

  function toggleModule(key: string) {
    setCollapsedModules(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem("sidebar-modules-collapsed", JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  function isActive(href: string) {
    if (href === "/overview") return pathname === href;
    return pathname === href || pathname.startsWith(href + "/");
  }

  const visibleNav = NAV.filter(
    item => !item.requiredPermission || can(permissions, item.requiredPermission),
  );

  const modulesWithItems = MODULES
    .map(m => ({ ...m, items: visibleNav.filter(n => n.module === m.key) }))
    .filter(m => m.items.length > 0);

  // ── Desktop sidebar ────────────────────────────────────────────────────────

  const desktopSidebar = (
    <aside className={clsx(
      "hidden md:flex fixed inset-y-0 left-0 flex-col z-10 bg-white border-r border-brand-border",
      "transition-[width] duration-200 overflow-hidden",
      collapsed ? "w-14" : "w-56"
    )}>
      {/* Brand + collapse toggle */}
      <div className={clsx(
        "flex items-center shrink-0 border-b border-brand-border",
        collapsed ? "flex-col gap-2 px-2 py-3" : "justify-between px-4 py-4"
      )}>
        {collapsed ? (
          <>
            <RosablyIcon size={26} />
            <button
              onClick={onToggle}
              title="Expand sidebar"
              className="p-1.5 rounded-md text-brand-muted hover:bg-brand-offwhite hover:text-brand-black transition-colors"
            >
              <Icon name="chevronRight" size={15} />
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2.5 min-w-0">
              <RosablyIcon size={26} />
              <div className="min-w-0 overflow-hidden">
                <p className="text-sm font-semibold text-brand-black leading-tight whitespace-nowrap">Rosably</p>
                <p className="text-xs text-brand-muted leading-tight whitespace-nowrap">Control Center</p>
              </div>
            </div>
            <button
              onClick={onToggle}
              title="Collapse sidebar"
              className="p-1.5 rounded-md text-brand-muted hover:bg-brand-offwhite hover:text-brand-black transition-colors shrink-0"
            >
              <Icon name="chevronLeft" size={15} />
            </button>
          </>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2">
        {modulesWithItems.map((mod, idx) => {
          const isSectionCollapsed = !collapsed && collapsedModules.has(mod.key);
          return (
            <div key={mod.key} className={clsx(idx > 0 && "mt-1")}>
              {/* Section header — expanded mode only */}
              {!collapsed && (
                <button
                  onClick={() => toggleModule(mod.key)}
                  className="flex items-center justify-between w-full px-4 py-1.5 group"
                >
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted group-hover:text-brand-black transition-colors">
                    {mod.label}
                  </span>
                  <span className={clsx(
                    "text-brand-muted group-hover:text-brand-black transition-transform duration-150",
                    isSectionCollapsed ? "rotate-0" : "rotate-180"
                  )}>
                    <Icon name="chevronDown" size={12} />
                  </span>
                </button>
              )}

              {/* Items — hidden when section collapsed (but always visible in icon-only mode) */}
              {!isSectionCollapsed && (
                <div className={clsx("space-y-0.5", collapsed ? "px-1.5 pb-2" : "px-2 pb-1")}>
                  {mod.items.map(item => {
                    const active = isActive(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        title={collapsed ? item.label : undefined}
                        className={clsx(
                          "flex items-center gap-2.5 rounded-lg transition-colors",
                          collapsed ? "justify-center p-2" : "px-3 py-2",
                          active
                            ? "bg-orange-50 text-brand-orange"
                            : "text-brand-muted hover:bg-brand-offwhite hover:text-brand-black"
                        )}
                      >
                        <Icon name={item.icon} size={collapsed ? 20 : 18} />
                        {!collapsed && (
                          <span className={clsx("text-sm truncate", active && "font-medium text-brand-orange")}>
                            {item.label}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Sign out */}
      <div className={clsx("border-t border-brand-border py-2", collapsed ? "px-1.5" : "px-2")}>
        <button
          onClick={handleLogout}
          title={collapsed ? "Sign out" : undefined}
          className={clsx(
            "flex items-center rounded-lg text-sm text-brand-muted hover:bg-brand-offwhite hover:text-brand-black transition-colors w-full",
            collapsed ? "justify-center p-2" : "gap-2.5 px-3 py-2"
          )}
        >
          <Icon name="logOut" size={collapsed ? 20 : 18} />
          {!collapsed && "Sign out"}
        </button>
      </div>
    </aside>
  );

  // ── Mobile nav ─────────────────────────────────────────────────────────────

  const mobileNav = (
    <>
      {/* Top bar */}
      <header className="md:hidden fixed top-0 inset-x-0 h-14 bg-white border-b border-brand-border
                         flex items-center justify-between px-4 z-20">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsMobileOpen(true)}
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
        <button
          onClick={handleLogout}
          aria-label="Sign out"
          className="p-1.5 -mr-1.5 rounded-md text-brand-muted hover:bg-brand-offwhite transition-colors"
        >
          <Icon name="logOut" />
        </button>
      </header>

      {/* Backdrop */}
      <div
        className={clsx(
          "md:hidden fixed inset-0 z-20 bg-black/40 backdrop-blur-sm transition-opacity duration-200",
          isMobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={() => setIsMobileOpen(false)}
      />

      {/* Drawer */}
      <aside className={clsx(
        "md:hidden fixed inset-y-0 left-0 z-30 w-72 bg-white shadow-2xl flex flex-col",
        "transition-transform duration-200",
        isMobileOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        {/* Drawer header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-brand-border shrink-0">
          <div className="flex items-center gap-2.5">
            <RosablyIcon size={26} />
            <div>
              <p className="text-sm font-semibold text-brand-black leading-tight">Rosably</p>
              <p className="text-xs text-brand-muted leading-tight">Control Center</p>
            </div>
          </div>
          <button
            onClick={() => setIsMobileOpen(false)}
            aria-label="Close navigation"
            className="p-1.5 rounded-md text-brand-muted hover:bg-brand-offwhite transition-colors"
          >
            <Icon name="x" />
          </button>
        </div>

        {/* Drawer nav — large card style */}
        <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-5">
          {modulesWithItems.map(mod => (
            <div key={mod.key}>
              <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-brand-muted">
                {mod.label}
              </p>
              <div className="space-y-1">
                {mod.items.map(item => {
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
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
                        <Icon name={item.icon} size={20} />
                      </div>
                      <span className={clsx("text-[15px]", active ? "font-semibold text-brand-orange" : "font-medium")}>
                        {item.label}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Drawer sign out */}
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

  return (
    <>
      {desktopSidebar}
      {mobileNav}
    </>
  );
}
