"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchJson } from "@/lib/fetch-json";
import { CRMLead, CRMStage } from "@/types";
import { isOpenDeal, money, type EngagementProgress, type PipelineLead } from "@/lib/crm/pipeline";
import { CreateLeadModal } from "@/components/crm/CreateLeadModal";
import { LeadsList } from "@/components/crm/leads/LeadsList";
import { PipelineBoard } from "@/components/crm/pipeline/PipelineBoard";
import { DealDrawer } from "@/components/crm/pipeline/DealDrawer";
import { Button, ErrorState, LoadingState, PageHeader, Tabs } from "@/components/ui";

const VIEWS = [
  { id: "board", label: "Board" },
  { id: "list",  label: "List"  },
] as const;
type View = typeof VIEWS[number]["id"];

function CRMPipeline() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const view: View = searchParams.get("view") === "list" ? "list" : "board";
  // ?deal=<lead id> opens the deal drawer (Today links here).
  const dealId = searchParams.get("deal");

  const [leads, setLeads] = useState<PipelineLead[]>([]);
  const [progress, setProgress] = useState<Record<string, EngagementProgress>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    fetchJson<unknown>("/api/crm/leads").then(r => {
      if (r.ok) setLeads(Array.isArray(r.data) ? r.data : []);
      else setLoadError(r.error);
      setLoading(false);
    });
    fetchJson<{ progress: Record<string, EngagementProgress> }>("/api/crm/pipeline").then(r => {
      if (r.ok) setProgress(r.data.progress ?? {});
    });
  }, []);

  const setParam = useCallback((key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === null) params.delete(key);
    else params.set(key, value);
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : "/crm", { scroll: false });
  }, [router, searchParams]);

  const closeDrawer = useCallback(() => setParam("deal", null), [setParam]);

  async function moveStage(leadId: string, stage: CRMStage) {
    setMoveError(null);
    const r = await fetchJson<PipelineLead>(`/api/crm/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage }),
    });
    if (!r.ok) { setMoveError(`Couldn't move the deal: ${r.error}`); return; }
    setLeads(prev => prev.map(l => l.id === leadId ? r.data : l));
  }

  const replaceLead = (updated: CRMLead) => setLeads(prev => prev.map(l => l.id === updated.id ? updated : l));

  const open = leads.filter(l => isOpenDeal(l.stage));
  const openValue = open.reduce((a, l) => a + (l.estimated_value ?? 0), 0);
  const wonCount = leads.filter(l => l.stage === "won").length;
  const selected = dealId ? leads.find(l => l.id === dealId) ?? null : null;

  return (
    <div className="p-4 md:p-8 pb-24 md:pb-8">
      <PageHeader
        title="Pipeline"
        description={loading || loadError ? undefined : `${open.length} open · ${money(openValue)} · ${wonCount} won`}
        actions={<Button size="sm" onClick={() => setShowCreate(true)}>+ New lead</Button>}
      />
      <Tabs tabs={VIEWS} value={view} onChange={id => setParam("view", id === "board" ? null : id)} className="mb-4" />
      {moveError && <ErrorState message={moveError} className="mb-4" />}

      {loading ? (
        <LoadingState />
      ) : loadError ? (
        <ErrorState message={`Couldn't load leads: ${loadError}`} />
      ) : view === "list" ? (
        <LeadsList leads={leads} onLeadUpdated={replaceLead} />
      ) : (
        <PipelineBoard leads={leads} progress={progress} onMoveStage={moveStage} onOpen={l => setParam("deal", l.id)} />
      )}

      {selected && (
        <DealDrawer
          lead={selected}
          progress={progress[selected.id]}
          onClose={closeDrawer}
          onUpdated={replaceLead}
        />
      )}

      {showCreate && (
        <CreateLeadModal
          onClose={() => setShowCreate(false)}
          onCreate={lead => {
            setLeads(prev => [lead, ...prev]);
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}

export default function CRMPage() {
  return (
    <Suspense fallback={<div className="p-8"><LoadingState /></div>}>
      <CRMPipeline />
    </Suspense>
  );
}
