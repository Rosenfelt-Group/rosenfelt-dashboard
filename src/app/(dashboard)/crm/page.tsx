"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchJson } from "@/lib/fetch-json";
import { CRMLead, CRMStage } from "@/types";
import { CreateLeadModal } from "@/components/crm/CreateLeadModal";
import { LeadsBoard } from "@/components/crm/leads/LeadsBoard";
import { LeadsList } from "@/components/crm/leads/LeadsList";
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

  const [leads, setLeads] = useState<CRMLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    fetchJson<unknown>("/api/crm/leads").then(r => {
      if (r.ok) setLeads(Array.isArray(r.data) ? r.data : []);
      else setLoadError(r.error);
      setLoading(false);
    });
  }, []);

  function setView(id: View) {
    const params = new URLSearchParams(searchParams.toString());
    if (id === "board") params.delete("view");
    else params.set("view", id);
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : "/crm");
  }

  async function moveStage(leadId: string, stage: CRMStage) {
    await fetch(`/api/crm/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage }),
    });
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage } : l));
  }

  const activeCount = leads.filter(l => l.stage !== "lost").length;
  const wonCount = leads.filter(l => l.stage === "won").length;

  return (
    <div className="p-4 md:p-8 pb-24 md:pb-8">
      <PageHeader
        title="Pipeline"
        description={loading || loadError ? undefined : `${activeCount} active · ${wonCount} won`}
        actions={<Button size="sm" onClick={() => setShowCreate(true)}>+ New lead</Button>}
      />
      <Tabs tabs={VIEWS} value={view} onChange={setView} className="mb-4" />

      {loading ? (
        <LoadingState />
      ) : loadError ? (
        <ErrorState message={`Couldn't load leads: ${loadError}`} />
      ) : view === "list" ? (
        <LeadsList
          leads={leads}
          onLeadUpdated={updated => setLeads(prev => prev.map(l => l.id === updated.id ? updated : l))}
        />
      ) : (
        <LeadsBoard leads={leads} onMoveStage={moveStage} />
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
