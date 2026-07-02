"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import NotificationBell from "./NotificationBell";
import {
  Icon,
  RosablyIcon,
  NavItem,
  NAV_GROUPS,
  ALL_NAV_ITEMS,
  SUB_PAGES,
  isActiveSection,
  isActiveSubPage,
} from "./nav-config";

/** Pending-approvals count for the Approvals nav badge. Polls the same
 * endpoint every other page on the dashboard already uses. */
function usePendingApprovalsCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch("/api/approvals");
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled) setCount(Array.isArray(j) ? j.length : 0);
      } catch {}
    }
    load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return count;
}

function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-brand-orange text-white text-[10px] font-semibold leading-[18px] text-center flex-shrink-0">
      {count > 99 ? "99+" : count}
    </span>
  );
}

// ── Desktop: persistent sidebar ────────────────────────────────────────────────

function DesktopGroup({
  items,
  pathname,
  approvalsCount,
  muted,
}: {
  items: NavItem[];
  pathname: string;
  approvalsCount: number;
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {items.map(item => {
        const active = isActiveSection(item, pathname);
        const subPages = SUB_PAGES[item.id];
        return (
          <div key={item.id}>
            <Link
              href={item.href}
              className={clsx(
                "flex items-center gap-2.5 px-3 h-9 rounded-lg text-[13px] transition-colors",
                active
                  ? "bg-orange-50 text-brand-orange font-semibold"
                  : muted
                    ? "text-brand-muted/80 hover:text-brand-black hover:bg-brand-cream"
                    : "text-brand-black hover:bg-brand-cream"
              )}
            >
              <Icon name={item.icon} size={muted ? 14 : 16} />
              <span className="truncate">{item.label}</span>
              {item.id === "approvals" && <NavBadge count={approvalsCount} />}
            </Link>
            {active && subPages && (
              <div className="mt-0.5 mb-1 ml-4 pl-3 border-l border-brand-border flex flex-col gap-0.5">
                {subPages.map(page => {
                  const subActive = isActiveSubPage(page.href, pathname);
                  return (
                    <Link
                      key={page.href}
                      href={page.href}
                      className={clsx(
                        "px-2.5 h-7 flex items-center rounded-md text-[12px] transition-colors",
                        subActive
                          ? "text-brand-orange font-medium"
                          : "text-brand-muted hover:text-brand-black"
                      )}
                    >
                      {page.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DesktopSidebar({ pathname, approvalsCount, onLogout }: {
  pathname: string;
  approvalsCount: number;
  onLogout: () => void;
}) {
  return (
    <aside
      className="hidden min-[900px]:flex flex-col w-[248px] shrink-0 h-screen sticky top-0 bg-white border-r border-brand-border"
      aria-label="Primary"
    >
      <div className="flex items-center gap-2 px-5 py-5 shrink-0">
        <RosablyIcon size={28} />
        <span className="font-urbanist text-[17px] font-bold text-brand-black tracking-wide">Rosably</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 flex flex-col gap-4 min-h-0">
        <DesktopGroup items={NAV_GROUPS.operations} pathname={pathname} approvalsCount={approvalsCount} />
        <DesktopGroup items={NAV_GROUPS.growth} pathname={pathname} approvalsCount={approvalsCount} />
      </nav>

      {/* Workspace — anchored to bottom, de-emphasized (lower-frequency pages) */}
      <div className="shrink-0 px-3 pt-3 border-t border-brand-border">
        <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-brand-muted/60">
          Workspace
        </p>
        <DesktopGroup items={NAV_GROUPS.workspace} pathname={pathname} approvalsCount={approvalsCount} muted />
      </div>

      <div className="flex items-center justify-between px-4 py-3 border-t border-brand-border shrink-0">
        <NotificationBell />
        <button
          onClick={onLogout}
          title="Sign out"
          className="p-1.5 rounded-md text-brand-muted hover:text-brand-black hover:bg-brand-cream transition-colors"
        >
          <Icon name="logOut" size={16} />
        </button>
      </div>
    </aside>
  );
}

// ── Tablet/mobile: horizontal scroll strip ─────────────────────────────────────

function NavStrip({ pathname, approvalsCount, onLogout }: {
  pathname: string;
  approvalsCount: number;
  onLogout: () => void;
}) {
  return (
    <header
      className="min-[900px]:hidden fixed top-0 inset-x-0 z-20 h-14 bg-white border-b border-brand-border flex items-center"
      aria-label="Primary"
    >
      <div className="flex items-center gap-2 pl-4 pr-2 shrink-0">
        <RosablyIcon size={24} />
      </div>
      <nav className="flex-1 min-w-0 h-full flex items-center gap-1 overflow-x-auto no-scrollbar px-1">
        {ALL_NAV_ITEMS.map(item => {
          const active = isActiveSection(item, pathname);
          return (
            <Link
              key={item.id}
              href={item.href}
              className={clsx(
                "flex items-center gap-1.5 px-3 h-10 rounded-lg text-[13px] whitespace-nowrap shrink-0 transition-colors",
                active
                  ? "bg-orange-50 text-brand-orange font-semibold"
                  : "text-brand-muted hover:text-brand-black hover:bg-brand-cream"
              )}
            >
              <Icon name={item.icon} size={15} />
              {item.label}
              {item.id === "approvals" && <NavBadge count={approvalsCount} />}
            </Link>
          );
        })}
      </nav>
      <div className="flex items-center gap-1 pl-2 pr-3 shrink-0">
        <NotificationBell />
        <button
          onClick={onLogout}
          aria-label="Sign out"
          className="w-10 h-10 flex items-center justify-center rounded-lg text-brand-muted hover:text-brand-black hover:bg-brand-cream transition-colors"
        >
          <Icon name="logOut" size={18} />
        </button>
      </div>
    </header>
  );
}

// ── Entry point ─────────────────────────────────────────────────────────────────

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const approvalsCount = usePendingApprovalsCount();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <>
      <DesktopSidebar pathname={pathname} approvalsCount={approvalsCount} onLogout={handleLogout} />
      <NavStrip pathname={pathname} approvalsCount={approvalsCount} onLogout={handleLogout} />
    </>
  );
}
