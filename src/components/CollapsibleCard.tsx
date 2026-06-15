// src/components/CollapsibleCard.tsx
"use client";
import { useState } from "react";
import clsx from "clsx";

interface Props {
  title: string;
  badge?: string | number;
  defaultOpen?: boolean;
  children: React.ReactNode;
  action?: React.ReactNode;
}

export function CollapsibleCard({ title, badge, defaultOpen = true, children, action }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="card p-0 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-brand-offwhite/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-brand-black">{title}</span>
          {badge !== undefined && (
            <span className="px-1.5 py-0.5 rounded-full bg-brand-offwhite text-xs text-brand-muted font-medium">
              {badge}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {action && <span onClick={e => e.stopPropagation()}>{action}</span>}
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true"
            className={clsx("text-brand-muted transition-transform duration-150", open ? "rotate-180" : "")}
          >
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
      </button>
      {open && <div className="border-t border-brand-border">{children}</div>}
    </div>
  );
}
