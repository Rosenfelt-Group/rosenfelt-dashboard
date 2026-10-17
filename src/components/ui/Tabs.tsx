"use client";

import clsx from "clsx";

export type TabItem<T extends string> = { id: T; label: React.ReactNode };

type TabsProps<T extends string> = {
  tabs: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
};

/** Underlined tab bar. Scrolls horizontally when it doesn't fit. */
export function Tabs<T extends string>({ tabs, value, onChange, className }: TabsProps<T>) {
  return (
    <div
      role="tablist"
      className={clsx(
        "flex gap-1 border-b border-brand-border overflow-x-auto no-scrollbar [-webkit-overflow-scrolling:touch]",
        className,
      )}
    >
      {tabs.map(t => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          onClick={() => onChange(t.id)}
          className={clsx(
            "px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors",
            t.id === value
              ? "border-brand-orange text-brand-orange"
              : "border-transparent text-brand-muted hover:text-brand-black",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
