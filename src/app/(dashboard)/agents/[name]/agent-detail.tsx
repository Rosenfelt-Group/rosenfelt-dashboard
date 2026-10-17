"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AgentBadge } from "@/components/AgentBadge";
import { LoadingState, PageHeader, Tabs } from "@/components/ui";
import { AgentStatusPanel } from "@/components/agents/AgentStatusPanel";
import { AgentHistory } from "@/components/agents/AgentHistory";
import { AgentChat } from "@/components/agents/AgentChat";
import { AgentPromptsAndMemory } from "@/components/agents/AgentPromptsAndMemory";
import { usePermissions } from "@/components/agents/use-permissions";
import { AGENT_DETAIL_TABS, getAgentInfo, parseTab, type AgentDetailTab, type AgentName } from "@/lib/agents";

const ALL_TABS: { id: AgentDetailTab; label: string }[] = [
  { id: "status",  label: "Status" },
  { id: "history", label: "History" },
  { id: "chat",    label: "Chat" },
  { id: "prompts", label: "Prompts & memory" },
];

// Tabs with in-progress state (chat transcript, unsaved prompt draft) stay
// mounted once opened so switching tabs doesn't throw that state away.
// (See `visited` below.)

function AgentDetailInner({ agent }: { agent: AgentName }) {
  const info = getAgentInfo(agent);
  const searchParams = useSearchParams();
  const router = useRouter();
  const permissions = usePermissions();
  const canChat = permissions?.includes("use_chat") ?? false;

  const requested = parseTab(searchParams.get("tab"), AGENT_DETAIL_TABS);
  // Until permissions load, a ?tab=chat link shows a loader rather than
  // bouncing to Status; without use_chat it falls back to Status.
  const tab: AgentDetailTab = requested === "chat" && permissions !== null && !canChat ? "status" : requested;
  const tabs = ALL_TABS.filter(t => t.id !== "chat" || canChat);

  const [visited, setVisited] = useState<ReadonlySet<AgentDetailTab>>(() => new Set([tab]));
  useEffect(() => {
    setVisited(prev => (prev.has(tab) ? prev : new Set(prev).add(tab)));
  }, [tab]);

  function setTab(id: AgentDetailTab) {
    const params = new URLSearchParams(searchParams.toString());
    if (id === AGENT_DETAIL_TABS[0]) params.delete("tab");
    else params.set("tab", id);
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : `/agents/${agent}`, { scroll: false });
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl pb-24 md:pb-8">
      <Link href="/agents" className="text-xs text-brand-muted hover:text-brand-black">← All agents</Link>
      <PageHeader
        className="mt-2"
        title={
          <span className="flex items-center gap-2.5">
            <span aria-hidden="true"><AgentBadge agent={agent} /></span>
            {info.label}
          </span>
        }
        description={info.role}
      />
      <Tabs tabs={tabs} value={tab} onChange={setTab} className="mb-5" />

      {tab === "status" && <AgentStatusPanel agent={agent} />}
      {tab === "history" && <AgentHistory agent={agent} />}
      {tab === "chat" && permissions === null && <LoadingState />}
      {canChat && visited.has("chat") && (
        <div hidden={tab !== "chat"}><AgentChat agent={agent} /></div>
      )}
      {visited.has("prompts") && (
        <div hidden={tab !== "prompts"}>
          <AgentPromptsAndMemory agent={agent} />
        </div>
      )}
    </div>
  );
}

export function AgentDetail({ agent }: { agent: AgentName }) {
  return (
    <Suspense fallback={<div className="p-4 md:p-8"><LoadingState /></div>}>
      {/* key: navigating between agents resets per-agent tab state */}
      <AgentDetailInner key={agent} agent={agent} />
    </Suspense>
  );
}
