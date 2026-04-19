"use client";
import { useEffect, useState } from "react";
import { Lead } from "@/types";
import { formatDistanceToNow } from "date-fns";
import clsx from "clsx";

const STAGES: { status: Lead["status"]; label: string; color: string }[] = [
  { status: "new",       label: "New",       color: "bg-blue-50 text-blue-700" },
  { status: "qualified", label: "Qualified",  color: "bg-amber-50 text-amber-700" },
  { status: "proposal",  label: "Proposal",   color: "bg-purple-50 text-purple-700" },
  { status: "client",    label: "Client",     color: "bg-green-50 text-green-700" },
  { status: "lost",      label: "Lost",       color: "bg-gray-100 text-gray-500" },
];

export default function CRMPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Lead | null>(null);

  useEffect(() => {
    fetch("/api/leads")
      .then(r => r.json())
      .then(d => { setLeads(Array.isArray(d) ? d : []); setLoading(false); });
  }, []);

  async function moveStage(id: string, status: Lead["status"]) {
    await fetch("/api/leads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    setLeads(prev => prev.map(l => l.id === id ? { ...l, status } : l));
    if (selected?.id === id) setSelected(prev => prev ? { ...prev, status } : null);
  }

  const byStatus = (s: Lead["status"]) => leads.filter(l => l.status === s);

  if (loading) {
    return <div className="p-8"><div className="card animate-pulse h-64" /></div>;
  }

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-brand-black">CRM</h1>
        <p className="text-sm text-brand-muted mt-0.5">
          {leads.filter(l => l.status !== "lost").length} active leads ·{" "}
          {leads.filter(l => l.status === "client").length} clients
        </p>
      </div>

      {leads.length === 0 ? (
        <div className="card text-center py-16">
          <p className="text-brand-muted text-sm">No leads yet</p>
          <p className="text-brand-muted text-xs mt-1">
            Riley will populate this when leads come in through the website widget
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-5 gap-3">
          {STAGES.map(stage => (
            <div key={stage.status}>
              <div className="flex items-center justify-between mb-3">
                <span className={clsx("badge text-xs", stage.color)}>{stage.label}</span>
                <span className="text-xs text-brand-muted">{byStatus(stage.status).length}</span>
              </div>
              <div className="space-y-2">
                {byStatus(stage.status).map(lead => (
                  <button
                    key={lead.id}
                    onClick={() => setSelected(lead)}
                    className="w-full text-left card p-3 hover:border-brand-orange transition-colors"
                  >
                    <p className="text-xs font-medium text-brand-black truncate">
                      {lead.org_name ?? "Unknown org"}
                    </p>
                    <p className="text-xs text-brand-muted truncate mt-0.5">
                      {lead.contact_name ?? "—"}
                    </p>
                    <p className="text-xs text-brand-muted mt-1">
                      {formatDistanceToNow(new Date(lead.created_at), { addSuffix: true })}
                    </p>
                  </button>
                ))}
                {byStatus(stage.status).length === 0 && (
                  <div className="border-2 border-dashed border-brand-border rounded-lg p-3 text-center">
                    <p className="text-xs text-brand-muted">—</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lead detail panel */}
      {selected && (
        <div className="fixed inset-y-0 right-0 w-96 bg-white border-l border-brand-border
                        shadow-xl p-6 overflow-y-auto z-20">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-base font-semibold text-brand-black">Lead detail</h2>
            <button
              onClick={() => setSelected(null)}
              className="text-brand-muted hover:text-brand-black"
            >
              ✕
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <p className="text-xs text-brand-muted mb-1">Organization</p>
              <p className="text-sm font-medium">{selected.org_name ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-brand-muted mb-1">Contact</p>
              <p className="text-sm">{selected.contact_name ?? "—"} {selected.title ? `· ${selected.title}` : ""}</p>
            </div>
            {selected.email && (
              <div>
                <p className="text-xs text-brand-muted mb-1">Email</p>
                <p className="text-sm text-brand-orange">{selected.email}</p>
              </div>
            )}
            {selected.stated_need && (
              <div>
                <p className="text-xs text-brand-muted mb-1">Stated need</p>
                <p className="text-sm">{selected.stated_need}</p>
              </div>
            )}
            {selected.budget_signal && (
              <div>
                <p className="text-xs text-brand-muted mb-1">Budget signal</p>
                <p className="text-sm">{selected.budget_signal}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-brand-muted mb-1">Source</p>
              <p className="text-sm">{selected.source ?? "—"}</p>
            </div>
            {selected.notes && (
              <div>
                <p className="text-xs text-brand-muted mb-1">Notes</p>
                <p className="text-sm text-brand-muted">{selected.notes}</p>
              </div>
            )}

            <div className="pt-4 border-t border-brand-border">
              <p className="text-xs text-brand-muted mb-2">Move to stage</p>
              <div className="flex flex-wrap gap-2">
                {STAGES.filter(s => s.status !== selected.status).map(s => (
                  <button
                    key={s.status}
                    onClick={() => moveStage(selected.id, s.status)}
                    className={clsx("badge cursor-pointer hover:opacity-80", s.color)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
