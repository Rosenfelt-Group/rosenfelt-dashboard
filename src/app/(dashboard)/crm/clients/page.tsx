"use client";
import { useEffect, useState } from "react";
import { CRMClient, CRMBusiness, CRMContact, CRMServiceTier, CRMBillingStatus } from "@/types";
import clsx from "clsx";
import { AgentBadge } from "@/components/AgentBadge";
import { Agent } from "@/types";
import { CRMNav } from "@/components/CRMNav";

const TIER_LABELS: Record<string, string> = {
  newsroom: "Newsroom",
  operations: "Operations",
  finance_ops: "Finance Ops",
  growth_stack: "Growth Stack",
  full_stack: "Full Stack",
};

const SERVICE_TIERS: { value: CRMServiceTier; label: string }[] = [
  { value: "newsroom",      label: "Newsroom" },
  { value: "operations",   label: "Operations" },
  { value: "finance_ops",  label: "Finance Ops" },
  { value: "growth_stack", label: "Growth Stack" },
  { value: "full_stack",   label: "Full Stack" },
];

const STATUS_COLORS: Record<string, string> = {
  active: "badge-success",
  paused: "badge-warning",
  cancelled: "badge-error",
};

const BLANK_FORM = {
  businessId: "",
  contactId: "",
  serviceTier: "newsroom" as CRMServiceTier,
  billingStatus: "active" as CRMBillingStatus,
  monthlyValue: "",
  contractStart: "",
};

export default function ClientsPage() {
  const [clients, setClients] = useState<CRMClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [availableBusinesses, setAvailableBusinesses] = useState<CRMBusiness[]>([]);
  const [availableContacts, setAvailableContacts] = useState<CRMContact[]>([]);
  const [form, setForm] = useState(BLANK_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/crm/clients")
      .then(r => r.json())
      .then(d => { setClients(Array.isArray(d) ? d : []); setLoading(false); });
  }, []);

  async function openCreate() {
    if (availableBusinesses.length === 0) {
      const [b, c] = await Promise.all([
        fetch("/api/crm/businesses").then(r => r.json()),
        fetch("/api/crm/contacts").then(r => r.json()),
      ]);
      setAvailableBusinesses(Array.isArray(b) ? b : []);
      setAvailableContacts(Array.isArray(c) ? c : []);
    }
    setForm(BLANK_FORM);
    setShowCreate(true);
  }

  const businessContacts = availableContacts.filter(c => c.business_id === form.businessId);

  async function createClient() {
    if (!form.businessId) return;
    setSaving(true);
    const r = await fetch("/api/crm/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        business_id: form.businessId,
        contact_id: form.contactId || undefined,
        service_tier: form.serviceTier,
        billing_status: form.billingStatus,
        monthly_value: form.monthlyValue ? parseFloat(form.monthlyValue) : undefined,
        contract_start: form.contractStart || undefined,
      }),
    });
    const client = await r.json();
    setClients(prev => [client, ...prev]);
    setShowCreate(false);
    setSaving(false);
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl pb-24 md:pb-8">
      <CRMNav />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-brand-black">Clients</h1>
          <p className="text-sm text-brand-muted mt-0.5">{clients.length} active retainers</p>
        </div>
        <button onClick={openCreate} className="btn-primary text-xs px-3 py-1.5">
          + New client
        </button>
      </div>

      {loading ? (
        <div className="card animate-pulse h-40" />
      ) : clients.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-brand-muted text-sm">No clients yet.</p>
          <p className="text-xs text-brand-muted mt-1">Convert a won lead or use the New client button above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {clients.map(client => (
            <div key={client.id} className="card">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-sm font-medium text-brand-black">{client.business?.name ?? "—"}</p>
                  {client.contact && (
                    <p className="text-xs text-brand-muted mt-0.5">
                      {client.contact.first_name}{client.contact.last_name ? " " + client.contact.last_name : ""}
                      {client.contact.email ? ` · ${client.contact.email}` : ""}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={clsx("badge text-xs", STATUS_COLORS[client.billing_status] ?? "badge-neutral")}>
                    {client.billing_status}
                  </span>
                  {client.service_tier && (
                    <span className="badge badge-orange text-xs">{TIER_LABELS[client.service_tier] ?? client.service_tier}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-4 mt-3 pt-3 border-t border-brand-border text-xs text-brand-muted flex-wrap">
                {client.monthly_value && (
                  <span>
                    <span className="text-brand-black font-medium">${client.monthly_value.toLocaleString()}</span>/mo
                  </span>
                )}
                {client.contract_start && (
                  <span>Started {client.contract_start}</span>
                )}
                {client.contract_end && (
                  <span>Ends {client.contract_end}</span>
                )}
                {client.assigned_agents && client.assigned_agents.length > 0 && (
                  <div className="flex items-center gap-1 ml-auto">
                    {client.assigned_agents.map(agent => (
                      <AgentBadge key={agent} agent={agent as Agent} size="sm" />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-end md:items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-6 shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-brand-black">New client</h2>
              <button onClick={() => setShowCreate(false)} className="text-brand-muted hover:text-brand-black text-lg">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-brand-muted mb-1 block">Business *</label>
                <select
                  className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                  value={form.businessId}
                  onChange={e => setForm(p => ({ ...p, businessId: e.target.value, contactId: "" }))}
                >
                  <option value="">— select business —</option>
                  {availableBusinesses.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-brand-muted mb-1 block">Contact</label>
                <select
                  className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                  value={form.contactId}
                  onChange={e => setForm(p => ({ ...p, contactId: e.target.value }))}
                  disabled={!form.businessId}
                >
                  <option value="">— none —</option>
                  {businessContacts.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.first_name}{c.last_name ? " " + c.last_name : ""}
                      {c.email ? ` (${c.email})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-brand-muted mb-1 block">Service tier</label>
                  <select
                    className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                    value={form.serviceTier}
                    onChange={e => setForm(p => ({ ...p, serviceTier: e.target.value as CRMServiceTier }))}
                  >
                    {SERVICE_TIERS.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-brand-muted mb-1 block">Billing status</label>
                  <select
                    className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                    value={form.billingStatus}
                    onChange={e => setForm(p => ({ ...p, billingStatus: e.target.value as CRMBillingStatus }))}
                  >
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-brand-muted mb-1 block">Monthly value ($)</label>
                  <input
                    type="number"
                    className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                    value={form.monthlyValue}
                    onChange={e => setForm(p => ({ ...p, monthlyValue: e.target.value }))}
                    placeholder="2500"
                  />
                </div>
                <div>
                  <label className="text-xs text-brand-muted mb-1 block">Contract start</label>
                  <input
                    type="date"
                    className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                    value={form.contractStart}
                    onChange={e => setForm(p => ({ ...p, contractStart: e.target.value }))}
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowCreate(false)} className="btn-ghost flex-1">Cancel</button>
              <button
                onClick={createClient}
                disabled={saving || !form.businessId}
                className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? "Creating…" : "Create client"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
