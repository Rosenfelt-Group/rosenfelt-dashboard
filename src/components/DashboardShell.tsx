"use client";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { Sidebar } from "./Sidebar";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (localStorage.getItem("sidebar-collapsed") === "true") setCollapsed(true);
  }, []);

  function toggle() {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
  }

  return (
    <div className="flex min-h-screen bg-brand-offwhite">
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <main className={clsx(
        "flex-1 min-h-screen transition-[margin-left] duration-200",
        "pt-14 md:pt-0",
        collapsed ? "md:ml-14" : "md:ml-56"
      )}>
        {children}
      </main>
    </div>
  );
}
