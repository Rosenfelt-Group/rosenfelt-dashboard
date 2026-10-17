"use client";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LoadingState, PageHeader, Tabs } from "@/components/ui";
import { WebsiteAnalyticsPanel } from "@/components/reports/WebsiteAnalyticsPanel";
import { QuizPanel } from "@/components/reports/QuizPanel";

const TABS = [
  { id: "website", label: "Website" },
  { id: "quiz",    label: "Quiz"    },
] as const;
type Tab = typeof TABS[number]["id"];

function AnalyticsShell() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tab: Tab = searchParams.get("tab") === "quiz" ? "quiz" : "website";

  function setTab(id: Tab) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", id);
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="p-4 md:p-8 pb-24 md:pb-8">
      <PageHeader title="Analytics" />
      <Tabs tabs={TABS} value={tab} onChange={setTab} className="mb-5" />
      {tab === "website" && <WebsiteAnalyticsPanel />}
      {tab === "quiz" && <QuizPanel />}
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <Suspense fallback={<div className="p-8"><LoadingState /></div>}>
      <AnalyticsShell />
    </Suspense>
  );
}
