"use client";
import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { LoadingState, PageHeader, Tabs } from "@/components/ui";
import { AgentCards } from "@/components/agents/AgentCards";
import { AgentHistory } from "@/components/agents/AgentHistory";
import { AGENTS_INDEX_TABS, parseTab, type AgentsIndexTab } from "@/lib/agents";

const TABS: { id: AgentsIndexTab; label: string }[] = [
  { id: "agents",   label: "Agents" },
  { id: "activity", label: "All activity" },
];

function AgentsIndex() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tab = parseTab(searchParams.get("tab"), AGENTS_INDEX_TABS);

  function setTab(id: AgentsIndexTab) {
    const params = new URLSearchParams(searchParams.toString());
    if (id === AGENTS_INDEX_TABS[0]) params.delete("tab");
    else params.set("tab", id);
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : "/agents", { scroll: false });
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl pb-24 md:pb-8">
      <PageHeader
        title="Agents"
        className="flex-wrap"
        description="Health, activity, chat and prompts for each agent"
        actions={
          <Link href="/work"
            className="px-3 py-1.5 rounded-lg border border-brand-border text-sm text-brand-muted hover:bg-brand-offwhite hover:text-brand-black transition-colors">
            Work board →
          </Link>
        }
      />
      <Tabs tabs={TABS} value={tab} onChange={setTab} className="mb-5" />
      {tab === "agents" && <AgentCards />}
      {tab === "activity" && <AgentHistory />}
    </div>
  );
}

export default function AgentsPage() {
  return (
    <Suspense fallback={<div className="p-4 md:p-8"><LoadingState /></div>}>
      <AgentsIndex />
    </Suspense>
  );
}
