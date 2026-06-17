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
