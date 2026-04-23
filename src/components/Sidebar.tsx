"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import type { Role } from "@/lib/session";

type NavItem = {
  label: string;
  href: string;
  icon: string;
  module: string;
  adminOnly?: boolean;
};

const MODULES: { key: string; label: string }[] = [
  { key: "overview",       label: "Overview" },
  { key: "content",        label: "Content" },
  { key: "salesMarketing", label: "Sales & Marketing" },
  { key: "engineering",    label: "Engineering" },
  { key: "security",       label: "Security" },
  { key: "settings",       label: "Settings" },
];

const nav: NavItem[] = [
  // Overview
  { label: "Overview",     href: "/overview",            icon: "grid",       module: "overview" },
  { label: "Approvals",    href: "/approvals",           icon: "approval",   module: "overview" },

  // Content
  { label: "Content",      href: "/content",             icon: "edit",       module: "content" },
  { label: "Documents",    href: "/documents",           icon: "folder",     module: "content" },

  // Sales & Marketing
  { label: "CRM",          href: "/crm",                 icon: "users",      module: "salesMarketing" },

  // Engineering
  { label: "Backlog",      href: "/backlog",             icon: "wrench",     module: "engineering" },
  { label: "Agents",       href: "/agents",              icon: "cpu",        module: "engineering" },
  { label: "Intelligence", href: "/agents/intelligence", icon: "brain",      module: "engineering" },
  { label: "Tasks",        href: "/tasks",               icon: "check",      module: "engineering" },
  { label: "Chat",         href: "/chat",                icon: "chat",       module: "engineering", adminOnly: true },

  // Security
  { label: "Users",        href: "/users",               icon: "shield",     module: "security", adminOnly: true },

  // Settings
  { label: "Cost",         href: "/cost",                icon: "dollar",     module: "settings" },
  { label: "Backup",       href: "/backup",              icon: "archive",    module: "settings" },
];

function Icon({ name }: { name: string }) {
  const icons: Record<string, React.ReactElement> = {
    grid:     <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    chat:     <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></>,
    check:    <><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></>,
    approval: <><path d="M9 12l2 2 4-4"/><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/></>,
    users:    <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
    edit:     <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>,
    folder:   <><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></>,
    cpu:      <><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/></>,
    brain:    <><path d="M9.5 2a2.5 2.5 0 0 1 5 0"/><path d="M9.5 2C6 2 4 5 4 7.5c0 1.5.5 2.5 1.5 3.5L4 14c0 3 2 5 5 5h6c3 0 5-2 5-5l-1.5-3c1-.9 1.5-2 1.5-3.5C20 5 18 2 14.5 2"/><path d="M12 6v6"/><path d="M9 9h6"/></>,
    dollar:   <><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></>,
    archive:  <><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></>,
    shield:   <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></>,
    wrench:   <><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.8 2.8-2.4-2.4z"/></>,
  };
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {icons[name]}
    </svg>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [role, setRole] = useState<Role>("viewer");

  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.role) setRole(data.role); })
      .catch(() => {});
  }, []);

  const visibleNav = nav.filter(item => role === "admin" || !item.adminOnly);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  const modulesWithItems = MODULES
    .map(m => ({ ...m, items: visibleNav.filter(n => n.module === m.key) }))
    .filter(m => m.items.length > 0);

  return (
    <>
      {/* ── Desktop sidebar (hidden on mobile) ── */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-52 bg-white border-r border-brand-border
                        flex-col z-10">
        {/* Brand */}
        <div className="px-5 py-5 border-b border-brand-border">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-brand-orange rounded-lg flex items-center justify-center flex-shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                   stroke="white" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="9"/>
                <path d="M12 7v5l3 1.5"/>
              </svg>
            </div>
            <div>
              <p className="text-xs font-semibold text-brand-black leading-tight">Rosenfelt Group</p>
              <p className="text-xs text-brand-muted leading-tight">Control Center</p>
            </div>
          </div>
        </div>

        {/* Nav — grouped by module */}
        <nav className="flex-1 px-3 py-3 overflow-y-auto">
          {modulesWithItems.map((mod, modIdx) => (
            <div key={mod.key} className={clsx(modIdx > 0 && "mt-5")}>
              <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-brand-muted">
                {mod.label}
              </p>
              <div className="space-y-0.5">
                {mod.items.map(item => {
                  const active = pathname === item.href || pathname.startsWith(item.href + "/");
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={clsx(
                        "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors",
                        active
                          ? "bg-orange-50 text-brand-orange font-medium"
                          : "text-brand-muted hover:bg-brand-offwhite hover:text-brand-black"
                      )}
                    >
                      <Icon name={item.icon} />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-3 py-3 border-t border-brand-border">
          <button
            onClick={handleLogout}
            className="flex items-center gap-2.5 px-3 py-2 w-full rounded-lg text-sm text-brand-muted hover:bg-brand-offwhite hover:text-brand-black transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Mobile top bar ── */}
      <header className="md:hidden fixed top-0 inset-x-0 h-12 bg-white border-b border-brand-border
                         flex items-center justify-between px-4 z-20">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-brand-orange rounded-md flex items-center justify-center flex-shrink-0">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                 stroke="white" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="9"/>
              <path d="M12 7v5l3 1.5"/>
            </svg>
          </div>
          <p className="text-sm font-semibold text-brand-black">Rosenfelt Group</p>
        </div>
        <button
          onClick={handleLogout}
          aria-label="Sign out"
          className="p-1.5 -mr-1.5 rounded-md text-brand-muted hover:bg-brand-offwhite hover:text-brand-black transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </button>
      </header>

      {/* ── Mobile bottom tab bar (flat, every page) ── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-brand-border
                      flex items-center z-20 pb-safe overflow-x-auto">
        {visibleNav.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex flex-col items-center gap-0.5 px-3 py-2 min-w-[56px] flex-shrink-0 transition-colors",
                active ? "text-brand-orange" : "text-brand-muted"
              )}
            >
              <Icon name={item.icon} />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
