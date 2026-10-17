"use client";
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader, Tabs } from "@/components/ui";
import { OverviewPanel }     from "@/components/finance/OverviewPanel";
import { BookkeepingPanel }  from "@/components/finance/BookkeepingPanel";
import { BillingPanel }      from "@/components/finance/BillingPanel";
import { CostPanel }         from "@/components/finance/CostPanel";

const TABS = [
  { id: "overview",     label: "Overview"     },
  { id: "bookkeeping",  label: "Bookkeeping"  },
  { id: "stripe",       label: "Stripe"       },
  { id: "cost",         label: "AI Cost"      },
] as const;

type Tab = typeof TABS[number]["id"];
const VALID_TABS: readonly Tab[] = TABS.map(t => t.id);

function FinanceShell() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const rawTab       = searchParams.get("tab");
  const activeTab: Tab = VALID_TABS.includes(rawTab as Tab) ? (rawTab as Tab) : "overview";

  // The old "Sam Actions" tab now lives on the Approvals page, filtered to Sam.
  useEffect(() => {
    if (rawTab === "sam-actions") router.replace("/approvals?agent=sam");
  }, [rawTab, router]);

  function setTab(id: Tab) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", id);
    router.replace(`?${params.toString()}`);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="px-4 md:px-8 pt-6">
        <PageHeader title="Finance" />
        <Tabs tabs={TABS} value={activeTab} onChange={setTab} />
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "overview"    && <OverviewPanel />}
        {activeTab === "bookkeeping" && <BookkeepingPanel />}
        {activeTab === "stripe"      && <BillingPanel />}
        {activeTab === "cost"        && <CostPanel />}
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
