"use client";
import { useEffect, useState } from "react";
import { CRMLead, CRMStage, CRMSource } from "@/types";
import { differenceInDays } from "date-fns";
import clsx from "clsx";
import Link from "next/link";
import { CRMNav } from "@/components/CRMNav";

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

const BLANK_FORM = {
  businessName: "", firstName: "", lastName: "",
  email: "", source: "manual" as CRMSource, estimatedValue: "",
};

export default function CRMPage() {
  const [leads, setLeads] = useState<CRMLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK_FORM);

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

  async function createLead() {
    if (!form.businessName || !form.firstName) return;
    setSaving(true);
    const bizRes = await fetch("/api/crm/businesses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.businessName, source: form.source }),
    });
    const biz = await bizRes.json();
    const conRes = await fetch("/api/crm/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        business_id: biz.id,
        first_name: form.firstName,
        last_name: form.lastName || undefined,
        email: form.email || undefined,
        is_primary: true,
      }),
    });
    const con = await conRes.json();
    const leadRes = await fetch("/api/crm/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        business_id: biz.id,
        contact_id: con.id,
        stage: "new",
        source: form.source,
        estimated_value: form.estimatedValue ? parseFloat(form.estimatedValue) : undefined,
      }),
    });
    const lead = await leadRes.json();
    setLeads(prev => [lead, ...prev]);
    setShowCreate(false);
    setForm(BLANK_FORM);
    setSaving(false);
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
        <div className="fixed inset-0 bg-black/40 z-40 flex items-end md:items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-6 shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-brand-black">New lead</h2>
              <button onClick={() => setShowCreate(false)} className="text-brand-muted hover:text-brand-black text-lg">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-brand-muted mb-1 block">Business name *</label>
                <input
                  className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                  value={form.businessName}
                  onChange={e => setForm(p => ({ ...p, businessName: e.target.value }))}
                  placeholder="Acme Corp"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-brand-muted mb-1 block">First name *</label>
                  <input
                    className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                    value={form.firstName}
                    onChange={e => setForm(p => ({ ...p, firstName: e.target.value }))}
                    placeholder="Jane"
                  />
                </div>
                <div>
                  <label className="text-xs text-brand-muted mb-1 block">Last name</label>
                  <input
                    className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                    value={form.lastName}
                    onChange={e => setForm(p => ({ ...p, lastName: e.target.value }))}
                    placeholder="Smith"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-brand-muted mb-1 block">Email</label>
                <input
                  type="email"
                  className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                  value={form.email}
                  onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                  placeholder="jane@acme.com"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-brand-muted mb-1 block">Source</label>
                  <select
                    className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                    value={form.source}
                    onChange={e => setForm(p => ({ ...p, source: e.target.value as CRMSource }))}
                  >
                    <option value="manual">Manual</option>
                    <option value="referral">Referral</option>
                    <option value="website_contact">Contact form</option>
                    <option value="website_assessment">Assessment</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-brand-muted mb-1 block">Est. value ($/mo)</label>
                  <input
                    type="number"
                    className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                    value={form.estimatedValue}
                    onChange={e => setForm(p => ({ ...p, estimatedValue: e.target.value }))}
                    placeholder="2500"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowCreate(false)} className="btn-ghost flex-1">Cancel</button>
              <button
                onClick={createLead}
                disabled={saving || !form.businessName || !form.firstName}
                className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? "Creating…" : "Create lead"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
