"use client";
import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import {
  Icon,
  RosablyIcon,
  WORKSPACE_MODULES,
  NAV_GROUPS,
  isActiveSection,
} from "./nav-config";
import NotificationBell from "./NotificationBell";

export function Sidebar() {
  const pathname = usePathname();
  const router   = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <aside className="hidden md:flex flex-col w-[220px] min-w-[220px] bg-brand-black h-screen fixed top-0 left-0 z-20">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-white/10">
        <RosablyIcon size={24} />
        <div>
          <div className="text-[13px] font-bold text-white tracking-wide leading-none">Rosably</div>
          <div className="text-[9px] uppercase tracking-widest text-white/30 mt-0.5">AI Operations</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-4 [&::-webkit-scrollbar]:hidden">
        {NAV_GROUPS.map(group => {
          const items = WORKSPACE_MODULES.filter(m => m.group === group);
          return (
            <div key={group}>
              <div className="px-2 mb-1 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-white/[22%]">
                {group}
              </div>
              {items.map(mod => {
                const active = isActiveSection(mod, pathname);
                return (
                  <Link
                    key={mod.id}
                    href={mod.href}
                    className={clsx(
                      "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12.5px] font-medium transition-colors mb-0.5",
                      active
                        ? "bg-brand-orange/20 text-brand-orange-light"
                        : "text-white/60 hover:text-white/90 hover:bg-white/10"
                    )}
                  >
                    <span className={clsx("shrink-0", active ? "text-brand-orange" : "opacity-60")}>
                      <Icon name={mod.icon} size={15} />
                    </span>
                    {mod.label}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-white/10 flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-full bg-brand-orange flex items-center justify-center text-[11px] font-bold text-white shrink-0">
          BR
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold text-white/90 truncate">Brian Rosenfelt</div>
          <div className="text-[10px] text-white/40">Owner</div>
        </div>
        <NotificationBell />
        <button
          onClick={handleLogout}
          title="Sign out"
          className="p-1 rounded text-white/40 hover:text-white/70 hover:bg-white/10 transition-colors"
        >
          <Icon name="logOut" size={15} />
        </button>
      </div>
    </aside>
  );
}
