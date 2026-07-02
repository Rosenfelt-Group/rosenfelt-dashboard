"use client";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { OverviewPanel }     from "@/components/finance/OverviewPanel";
import { BookkeepingPanel }  from "@/components/finance/BookkeepingPanel";
import { BillingPanel }      from "@/components/finance/BillingPanel";
import { CostPanel }         from "@/components/finance/CostPanel";
import { SamActionsPanel }   from "@/components/finance/SamActionsPanel";

type Tab = "overview" | "bookkeeping" | "stripe" | "cost" | "sam-actions";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview",     label: "Overview"     },
  { id: "bookkeeping",  label: "Bookkeeping"  },
  { id: "stripe",       label: "Stripe"       },
  { id: "cost",         label: "AI Cost"      },
  { id: "sam-actions",  label: "Sam Actions"  },
];

function FinanceShell() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const activeTab    = (searchParams.get("tab") as Tab | null) ?? "overview";

  function setTab(id: Tab) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", id);
    router.replace(`?${params.toString()}`);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="px-4 md:px-8 pt-6">
        <h1 className="text-xl font-semibold text-brand-black mb-4">Finance</h1>
        <div className="flex gap-0 border-b border-brand-border overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={clsx(
                "px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors",
                activeTab === t.id
                  ? "border-brand-orange text-brand-orange"
                  : "border-transparent text-brand-muted hover:text-brand-black"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "overview"    && <OverviewPanel />}
        {activeTab === "bookkeeping" && <BookkeepingPanel />}
        {activeTab === "stripe"      && <BillingPanel />}
        {activeTab === "cost"        && <CostPanel />}
        {activeTab === "sam-actions" && <SamActionsPanel />}
      </div>
    </div>
  );
}

export default function FinancePage() {
  return (
    <Suspense fallback={
      <div className="p-8">
        <div className="h-8 w-32 bg-brand-offwhite rounded animate-pulse mb-4" />
        <div className="h-10 w-full bg-brand-offwhite rounded animate-pulse" />
      </div>
    }>
      <FinanceShell />
    </Suspense>
  );
}
