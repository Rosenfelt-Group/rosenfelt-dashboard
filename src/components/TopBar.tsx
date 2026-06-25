"use client";
import React from "react";
import { useRouter } from "next/navigation";
import NotificationBell from "./NotificationBell";
import { Icon, RosablyIcon } from "./nav-config";

// Desktop nav is handled by Sidebar.tsx — TopBar is mobile-only.
export function TopBar() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <header className="md:hidden fixed top-0 inset-x-0 h-14 bg-brand-black flex items-center px-4 gap-3 z-20">
      <RosablyIcon size={26} />
      <span className="text-[13px] font-bold text-white tracking-wide flex-1">Rosably</span>
      <NotificationBell />
      <button
        onClick={handleLogout}
        title="Sign out"
        className="p-1.5 rounded-md text-white/35 hover:text-white/70 transition-colors"
      >
        <Icon name="logOut" size={16} />
      </button>
    </header>
  );
}
