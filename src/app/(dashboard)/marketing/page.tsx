"use client";
import { useState } from "react";
import clsx from "clsx";
import DirectoriesTab from "./DirectoriesTab";
import AdvertisingTab from "./AdvertisingTab";

const TABS = [
  { id: "directories", label: "Directories" },
  { id: "advertising", label: "Advertising" },
] as const;

type TabId = typeof TABS[number]["id"];

export default function MarketingPage() {
  const [tab, setTab] = useState<TabId>("directories");

  return (
    <div className="p-4 md:p-8 pt-16 md:pt-8 pb-24 md:pb-8">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-brand-black">Marketing</h1>
        <p className="text-sm text-brand-muted mt-0.5">Directory submissions and advertising channels</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-5 border-b border-brand-border">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              "px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px",
              tab === t.id
                ? "border-brand-orange text-brand-orange"
                : "border-transparent text-brand-muted hover:text-brand-black"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "directories" && <DirectoriesTab />}
      {tab === "advertising" && <AdvertisingTab />}
    </div>
  );
}
