"use client";
import { useEffect, useState } from "react";
import { CRMLead, CRMStage, CRMSource } from "@/types";
import { CRMNav } from "@/components/CRMNav";
import Link from "next/link";
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";
import { AgentBadge } from "@/components/AgentBadge";
import { Agent } from "@/types";
import { CreateLeadModal } from "@/components/crm/CreateLeadModal";

const STAGES: { stage: CRMStage; label: string; color: string }[] = [
  { stage: "new",           label: "New",           color: "bg-blue-50 text-blue-700" },
  { stage: "qualification", label: "Qualification",  color: "bg-amber-50 text-amber-700" },
  { stage: "engaged",       label: "Engaged",        color: "bg-purple-50 text-purple-700" },
  { stage: "proposal",      label: "Proposal",       color: "bg-orange-50 text-brand-orange" },
  { stage: "won",           label: "Won",            color: "bg-green-50 text-green-700" },
  { stage: "lost",          label: "Lost",           color: "bg-gray-100 text-gray-500" },
];

const AGENTS: Agent[] = ["jordan", "riley", "avery", "brian"];

const BLANK_EDIT = {
  stage: "new" as CRMStage,
  source: "manual" as CRMSource,
  assigned_agent: "" as Agent | "",
  estimated_value: "",
  close_date: "",
  lost_reason: "",
};

export default function LeadsPage() {
  const [leads, setLeads] = useState<CRMLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<CRMStage | "">("");
  const [selected, setSelected] = useState<CRMLead | null>(null);
  const [edit, setEdit] = useState(BLANK_EDIT);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    fetch("/api/crm/leads")
      .then(r => r.json())
      .then(d => { setLeads(Array.isArray(d) ? d : []); setLoading(false); });
  }, []);

  function openEdit(lead: CRMLead) {
    setSelected(lead);
    setEdit({
      stage: lead.stage,
      source: (lead.source ?? "manual") as CRMSource,
      assigned_agent: (lead.assigned_agent ?? "") as Agent | "",
      estimated_value: lead.estimated_value?.toString() ?? "",
      close_date: lead.close_date ?? "",
      lost_reason: lead.lost_reason ?? "",
    });
  }

  async function saveEdit() {
    if (!selected) return;
    setSaving(true);
    const payload: Record<string, unknown> = {
      stage: edit.stage,
      source: edit.source || null,
      assigned_agent: edit.assigned_agent || null,
      estimated_value: edit.estimated_value ? parseFloat(edit.estimated_value) : null,
      close_date: edit.close_date || null,
      lost_reason: edit.lost_reason || null,
    };
    const res = await fetch(`/api/crm/leads/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const updated = await res.json();
    setLeads(prev => prev.map(l => l.id === selected.id ? updated : l));
    setSelected(updated);
    setSaving(false);
  }

  const filtered = leads.filter(l => {
    if (stageFilter && l.stage !== stageFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    const bizName = (l.business?.name ?? "").toLowerCase();
    const contactName = `${l.contact?.first_name ?? ""} ${l.contact?.last_name ?? ""}`.toLowerCase();
    const email = (l.contact?.email ?? "").toLowerCase();
    return bizName.includes(q) || contactName.includes(q) || email.includes(q);
  });

  const stageMeta = (s: CRMStage) => STAGES.find(x => x.stage === s);

  return (
    <div className="p-4 md:p-8 pb-24 md:pb-8">
      <CRMNav />
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-brand-black">Leads</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-brand-muted">{filtered.length} of {leads.length}</span>
          <button onClick={() => setShowCreate(true)} className="btn-primary text-xs px-3 py-1.5">
            + New lead
          </button>
        </div>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        <input
          className="border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange w-full max-w-xs"
          placeholder="Search business, contact, email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          className="border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
          value={stageFilter}
          onChange={e => setStageFilter(e.target.value as CRMStage | "")}
        >
          <option value="">All stages</option>
          {STAGES.map(s => <option key={s.stage} value={s.stage}>{s.label}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="card animate-pulse h-40" />
      ) : filtered.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-brand-muted text-sm">{search || stageFilter ? "No leads match." : "No leads yet."}</p>
        </div>
      ) : (
        <div className="card divide-y divide-brand-border">
          {filtered.map(lead => {
            const sm = stageMeta(lead.stage);
            const contactName = lead.contact
              ? `${lead.contact.first_name}${lead.contact.last_name ? " " + lead.contact.last_name : ""}`
              : "—";
            return (
              <button
                key={lead.id}
                onClick={() => openEdit(lead)}
                className="w-full text-left py-3 px-1 flex items-center justify-between gap-4 hover:bg-brand-offwhite transition-colors rounded"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-brand-black truncate">
                    {lead.business?.name ?? "—"}
                  </p>
                  <p className="text-xs text-brand-muted truncate mt-0.5">{contactName}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                  {sm && <span className={clsx("badge text-xs", sm.color)}>{sm.label}</span>}
                  {lead.estimated_value && (
                    <span className="text-xs text-brand-muted">${lead.estimated_value.toLocaleString()}</span>
                  )}
                  {lead.assigned_agent && (
                    <AgentBadge agent={lead.assigned_agent as Agent} size="sm" />
                  )}
                  <span className="text-xs text-brand-muted">
                    {formatDistanceToNow(new Date(lead.created_at), { addSuffix: true })}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Edit drawer */}
      {selected && (
        <div className="fixed inset-y-0 right-0 w-full max-w-sm bg-white border-l border-brand-border shadow-xl z-30 flex flex-col">
          <div className="flex items-center justify-between p-5 border-b border-brand-border">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-brand-black truncate">{selected.business?.name ?? "Lead"}</h2>
              <p className="text-xs text-brand-muted truncate">
                {selected.contact?.first_name}{selected.contact?.last_name ? " " + selected.contact.last_name : ""}
              </p>
            </div>
            <button onClick={() => setSelected(null)} className="text-brand-muted hover:text-brand-black ml-3 text-lg shrink-0">✕</button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <div>
              <label className="text-xs text-brand-muted mb-1 block">Stage</label>
              <select
                className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                value={edit.stage}
                onChange={e => setEdit(p => ({ ...p, stage: e.target.value as CRMStage }))}
              >
                {STAGES.map(s => <option key={s.stage} value={s.stage}>{s.label}</option>)}
              </select>
            </div>

            <div>
              <label className="text-xs text-brand-muted mb-1 block">Source</label>
              <select
                className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                value={edit.source}
                onChange={e => setEdit(p => ({ ...p, source: e.target.value as CRMSource }))}
              >
                <option value="manual">Manual</option>
                <option value="referral">Referral</option>
                <option value="website_contact">Contact form</option>
                <option value="website_assessment">Assessment</option>
              </select>
            </div>

            <div>
              <label className="text-xs text-brand-muted mb-1 block">Assigned agent</label>
              <select
                className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                value={edit.assigned_agent}
                onChange={e => setEdit(p => ({ ...p, assigned_agent: e.target.value as Agent | "" }))}
              >
                <option value="">— unassigned —</option>
                {AGENTS.map(a => <option key={a} value={a} className="capitalize">{a}</option>)}
              </select>
            </div>

            <div>
              <label className="text-xs text-brand-muted mb-1 block">Est. value ($/mo)</label>
              <input
                type="number"
                className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                value={edit.estimated_value}
                onChange={e => setEdit(p => ({ ...p, estimated_value: e.target.value }))}
                placeholder="2500"
              />
            </div>

            <div>
              <label className="text-xs text-brand-muted mb-1 block">Target close date</label>
              <input
                type="date"
                className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                value={edit.close_date}
                onChange={e => setEdit(p => ({ ...p, close_date: e.target.value }))}
              />
            </div>

            {edit.stage === "lost" && (
              <div>
                <label className="text-xs text-brand-muted mb-1 block">Lost reason</label>
                <textarea
                  className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange h-20 resize-none"
                  value={edit.lost_reason}
                  onChange={e => setEdit(p => ({ ...p, lost_reason: e.target.value }))}
                  placeholder="Why was this lead lost?"
                />
              </div>
            )}

            <div className="pt-2">
              <Link
                href={`/crm/leads/${selected.id}`}
                className="text-xs text-brand-orange hover:underline"
              >
                View full detail & activity →
              </Link>
            </div>
          </div>

          <div className="p-5 border-t border-brand-border flex gap-2">
            <button onClick={() => setSelected(null)} className="btn-ghost flex-1">Cancel</button>
            <button onClick={saveEdit} disabled={saving} className="btn-primary flex-1 disabled:opacity-50">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
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
