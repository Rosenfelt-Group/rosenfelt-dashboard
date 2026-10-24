"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { EmptyState, LoadingState, PageHeader, Tabs } from "@/components/ui";
import { ServiceCatalog } from "@/components/crm/settings/ServiceCatalog";
import { QuestionBank } from "@/components/crm/settings/QuestionBank";
import { DiscoveryTemplates } from "@/components/crm/settings/DiscoveryTemplates";

const TABS = [
  { id: "services",  label: "Service catalog" },
  { id: "questions", label: "Question bank" },
  { id: "templates", label: "Discovery templates" },
  { id: "trash",     label: "Trash" },
] as const;
type Tab = typeof TABS[number]["id"];

function parseTab(raw: string | null): Tab {
  return TABS.some(t => t.id === raw) ? (raw as Tab) : "services";
}

function CrmSettings() {
  const searchParams = useSearchParams();
  const tab = parseTab(searchParams.get("tab"));

  // The native history API (which Next keeps useSearchParams in sync with) rather than
  // router.replace: switching tabs needs no server round trip, and router.replace with only a new
  // query stayed on the old URL after a page was loaded with ?tab= (seen on Next 16.2.4).
  function setTab(id: Tab) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", id);
    window.history.replaceState(null, "", `?${params.toString()}`);
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl pb-24 md:pb-8">
      <PageHeader title="CRM settings" description="Things you set up once and reuse." />
      <Tabs tabs={TABS} value={tab} onChange={setTab} className="mb-4" />
      {tab === "services" && <ServiceCatalog />}
      {tab === "questions" && <QuestionBank />}
      {tab === "templates" && <DiscoveryTemplates />}
      {tab === "trash" && (
        <EmptyState
          title="Trash is coming soon."
          description="Deleted organizations, people and deals will stay here for 30 days so you can restore them."
        />
      )}
    </div>
  );
}

export default function CrmSettingsPage() {
  return (
    <Suspense fallback={<div className="p-8"><LoadingState /></div>}>
      <CrmSettings />
    </Suspense>
  );
}
