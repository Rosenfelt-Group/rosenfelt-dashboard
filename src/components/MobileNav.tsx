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
