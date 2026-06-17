"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Icon, WORKSPACE_MODULES, SUB_PAGES, isActiveSection, isActiveSubPage } from "./nav-config";

export function LeftPanel() {
  const pathname = usePathname();

  const activeSection = WORKSPACE_MODULES.find(m => isActiveSection(m, pathname)) ?? null;
  const sectionId     = activeSection?.id ?? null;
  const subPages      = sectionId ? (SUB_PAGES[sectionId] ?? []) : [];

  const [collapsed, setCollapsed] = useState(false);

  // Load per-section collapse state from localStorage
  useEffect(() => {
    if (!sectionId) return;
    setCollapsed(localStorage.getItem(`lpanel-collapsed-${sectionId}`) === "true");
  }, [sectionId]);

  function toggle() {
    setCollapsed(prev => {
      const next = !prev;
      if (sectionId) localStorage.setItem(`lpanel-collapsed-${sectionId}`, String(next));
      return next;
    });
  }

  // No panel for Overview or sections with no sub-pages defined
  if (!subPages.length) return null;

  // Single container whose width animates between the two states. The inner
  // content swaps instantly; `overflow-hidden` clips it cleanly mid-animation.
  return (
    <div
      className={clsx(
        "hidden md:flex flex-col bg-white border-r border-brand-border shrink-0 overflow-hidden transition-[width] duration-200",
        collapsed ? "w-11 items-center py-2 gap-1" : "w-[188px]"
      )}
    >
      {collapsed ? (
        <>
          {/* ── Collapsed: icon strip ──────────────────────────────────────── */}
          {subPages.map(page => {
            const active = isActiveSubPage(page.href, pathname);
            return (
              <Link
                key={page.href}
                href={page.href}
                title={page.label}
                className={clsx(
                  "w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
                  active
                    ? "bg-orange-50 text-brand-orange"
                    : "text-brand-muted hover:text-brand-black hover:bg-brand-offwhite"
                )}
              >
                <Icon name={page.icon} size={15} />
              </Link>
            );
          })}
          {/* Expand button */}
          <button
            onClick={toggle}
            title="Expand panel"
            className="mt-auto w-8 h-8 rounded-lg bg-brand-offwhite border border-brand-border flex items-center justify-center text-brand-muted hover:text-brand-black transition-colors"
          >
            <Icon name="chevronRight" size={13} />
          </button>
        </>
      ) : (
        // Fixed-width wrapper so header + rows keep their layout while the
        // outer container animates its width (content is clipped, not reflowed).
        <div className="flex flex-col flex-1 w-[188px]">
          {/* ── Expanded ───────────────────────────────────────────────────── */}
          {/* Header */}
          <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
            <span className="text-[9px] font-bold uppercase tracking-widest text-brand-border">
              {activeSection?.label}
            </span>
            <button
              onClick={toggle}
              title="Collapse panel"
              className="w-5 h-5 rounded flex items-center justify-center bg-brand-offwhite border border-brand-border text-brand-muted hover:text-brand-black transition-colors"
            >
              <Icon name="chevronLeft" size={11} />
            </button>
          </div>
          {/* Sub-pages */}
          <nav className="flex-1 py-1">
            {subPages.map(page => {
              const active = isActiveSubPage(page.href, pathname);
              return (
                <Link
                  key={page.href}
                  href={page.href}
                  className={clsx(
                    "flex items-center gap-2.5 py-1.5 text-[12px] transition-colors",
                    active
                      ? "bg-orange-50 text-brand-orange font-semibold border-l-2 border-brand-orange pl-[10px] pr-3"
                      : "text-brand-black hover:bg-brand-offwhite px-3"
                  )}
                >
                  <span className={clsx(
                    "w-1.5 h-1.5 rounded-full shrink-0",
                    active ? "bg-brand-orange" : "bg-brand-border"
                  )} />
                  {page.label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </div>
  );
}
