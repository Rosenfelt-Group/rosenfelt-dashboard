"use client";
import { useEffect, useState } from "react";
import { CRMLead, CRMStage } from "@/types";
import { differenceInDays } from "date-fns";
import clsx from "clsx";
import Link from "next/link";
import { CRMNav } from "@/components/CRMNav";
import { CreateLeadModal } from "@/components/crm/CreateLeadModal";

const STAGES: { stage: CRMStage; label: string; color: string }[] = [
  { stage: "new",           label: "New",           color: "bg-blue-50 text-blue-700" },
  { stage: "qualification", label: "Qualification",  color: "bg-amber-50 text-amber-700" },
  { stage: "engaged",       label: "Engaged",        color: "bg-purple-50 text-purple-700" },
  { stage: "proposal",      label: "Proposal",       color: "bg-orange-50 text-brand-orange" },
  { stage: "won",           label: "Won",            color: "bg-green-50 text-green-700" },
  { stage: "lost",          label: "Lost",           color: "bg-gray-100 text-gray-500" },
];

const SOURCE_LABELS: Record<string, string> = {
  website_contact: "Contact form",
  website_assessment: "Assessment",
  manual: "Manual",
  referral: "Referral",
};

export default function CRMPage() {
  const [leads, setLeads] = useState<CRMLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/crm/leads")
      .then(r => r.json())
      .then(d => { setLeads(Array.isArray(d) ? d : []); setLoading(false); });
  }, []);

  async function moveStage(leadId: string, stage: CRMStage) {
    await fetch(`/api/crm/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage }),
    });
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage } : l));
  }

  const byStage = (s: CRMStage) => leads.filter(l => l.stage === s);
  const activeCount = leads.filter(l => l.stage !== "lost").length;

  if (loading) {
    return <div className="p-8"><div className="card animate-pulse h-64" /></div>;
  }

  return (
    <div className="p-4 md:p-8 pb-24 md:pb-8">
      <CRMNav />
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-brand-black">Pipeline</h1>
          <p className="text-sm text-brand-muted mt-0.5">
            {activeCount} active · {byStage("won").length} won
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary text-xs px-3 py-1.5">
          + New lead
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {STAGES.map(col => (
          <div
            key={col.stage}
            onDragOver={e => e.preventDefault()}
            onDrop={() => {
              if (dragId && leads.find(l => l.id === dragId)?.stage !== col.stage) {
                moveStage(dragId, col.stage);
              }
              setDragId(null);
            }}
            className="min-h-[200px]"
          >
            <div className="flex items-center justify-between mb-3">
              <span className={clsx("badge text-xs", col.color)}>{col.label}</span>
              <span className="text-xs text-brand-muted">{byStage(col.stage).length}</span>
            </div>
            <div className="space-y-2">
              {byStage(col.stage).map(lead => (
                <div
                  key={lead.id}
                  draggable
                  onDragStart={() => setDragId(lead.id)}
                  onDragEnd={() => setDragId(null)}
                  className="cursor-grab active:cursor-grabbing"
                >
                  <Link
                    href={`/crm/leads/${lead.id}`}
                    className="block card p-3 hover:border-brand-orange transition-colors"
                  >
                    <p className="text-xs font-medium text-brand-black truncate">
                      {lead.business?.name ?? "—"}
                    </p>
                    <p className="text-xs text-brand-muted truncate mt-0.5">
                      {lead.contact
                        ? `${lead.contact.first_name}${lead.contact.last_name ? " " + lead.contact.last_name : ""}`
                        : "—"}
                    </p>
                    {lead.source && (
                      <span className="badge badge-neutral text-xs mt-1.5 block w-fit">
                        {SOURCE_LABELS[lead.source] ?? lead.source}
                      </span>
                    )}
                    <p className="text-xs text-brand-muted mt-1.5">
                      {differenceInDays(new Date(), new Date(lead.updated_at))}d in stage
                    </p>
                  </Link>
                </div>
              ))}
              {byStage(col.stage).length === 0 && (
                <div className="border-2 border-dashed border-brand-border rounded-lg p-3 min-h-[60px] flex items-center justify-center">
                  <p className="text-xs text-brand-muted">—</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

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
