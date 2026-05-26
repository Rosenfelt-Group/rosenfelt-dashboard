"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CRMClient, CRMBusiness, CRMContact } from "@/types";
import clsx from "clsx";
import { AgentBadge } from "@/components/AgentBadge";
import { Agent } from "@/types";
import { CRMNav } from "@/components/CRMNav";

type StatusFilter = "active" | "inactive" | "all";
const STATUS_FILTERS: StatusFilter[] = ["active", "inactive", "all"];

function parseStatusFilter(raw: string | null): StatusFilter {
  if (raw === "inactive" || raw === "all") return raw;
  return "active";
}

const STRIPE_STATUS_STYLES: Record<string, string> = {
  active:   "badge-success",
  trialing: "badge-warning",
  past_due: "badge-error",
  canceled: "badge-neutral",
  unpaid:   "badge-error",
};

const TIER_LABELS: Record<string, string> = {
  newsroom: "Newsroom",
  operations: "Operations",
  finance_ops: "Finance Ops",
  growth_stack: "Growth Stack",
  full_stack: "Full Stack",
};

const STATUS_COLORS: Record<string, string> = {
  active: "badge-success",
  paused: "badge-warning",
  cancelled: "badge-error",
};

// Note: service_tier + monthly_value columns were dropped from crm.clients in
// the 2026-05-26 migration. Services + billing are now managed per-row in
// crm.client_services and surfaced via /crm/clients/[id]. Don't reintroduce
// those fields here.
const BLANK_FORM = {
  businessId: "",
  contactId: "",
  contractStart: "",
};

export default function ClientsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-brand-muted">Loading…</div>}>
      <ClientsPageInner />
    </Suspense>
  );
}

function ClientsPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const statusFilter: StatusFilter = parseStatusFilter(sp.get("status"));

  const [clients, setClients] = useState<CRMClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [availableBusinesses, setAvailableBusinesses] = useState<CRMBusiness[]>([]);
  const [availableContacts, setAvailableContacts] = useState<CRMContact[]>([]);
  const [form, setForm] = useState(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [paymentLink, setPaymentLink] = useState<{ url: string; businessName: string } | null>(null);
  const [generatingLinkFor, setGeneratingLinkFor] = useState<string | null>(null);

  const setStatusFilter = useCallback((next: StatusFilter) => {
    const params = new URLSearchParams(Array.from(sp.entries()));
    if (next === "active") params.delete("status");
    else params.set("status", next);
    const qs = params.toString();
    router.replace(qs ? `/crm/clients?${qs}` : "/crm/clients", { scroll: false });
  }, [router, sp]);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/crm/clients?status=${statusFilter}`)
      .then(r => r.json())
      .then(d => { setClients(Array.isArray(d) ? d : []); setLoading(false); });
  }, [statusFilter]);

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

  async function generatePaymentLink(client: CRMClient) {
    if (!client.monthly_value) return alert("Set a monthly value on this client before generating a payment link.");
    setGeneratingLinkFor(client.id);
    try {
      const r = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id }),
      });
      const data = await r.json();
      if (!r.ok) return alert(data.error ?? "Failed to generate link");
      setPaymentLink({ url: data.url, businessName: client.business?.name ?? "client" });
      // Refresh the customer ID on the card without a full reload
      setClients(prev => prev.map(c => c.id === client.id ? { ...c, stripe_customer_id: data.customerId } : c));
    } finally {
      setGeneratingLinkFor(null);
    }
  }

  async function createClient() {
    if (!form.businessId) return;
    setSaving(true);
    setCreateErr(null);
    try {
      const r = await fetch("/api/crm/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: form.businessId,
          contact_id: form.contactId || undefined,
          // billing_status defaults to 'cancelled' until a client_service activates;
          // the crm.update_client_billing_status() trigger rolls it up automatically.
          billing_status: "cancelled",
          contract_start: form.contractStart || undefined,
        }),
      });
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        throw new Error(`HTTP ${r.status}: ${body.slice(0, 200)}`);
      }
      const client = await r.json();
      setShowCreate(false);
      // Take the user to the new client's detail page where they can add services.
      // (Brand-new clients don't appear under the default 'Active' filter — they
      // have no client_services rows yet.)
      router.push(`/crm/clients/${client.id}`);
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : "Create failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl pb-24 md:pb-8">
      <CRMNav />
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-brand-black">Clients</h1>
          <p className="text-sm text-brand-muted mt-0.5">
            {clients.length} {statusFilter === "all" ? "total" : statusFilter}
          </p>
        </div>
        <button onClick={openCreate} className="btn-primary text-xs px-3 py-1.5">
          + New client
        </button>
      </div>

      <div className="inline-flex items-center gap-1 rounded border border-brand-border bg-white p-0.5 mb-6">
        {STATUS_FILTERS.map((opt) => {
          const active = statusFilter === opt;
          return (
            <button
              key={opt}
              onClick={() => setStatusFilter(opt)}
              className={clsx(
                "text-xs px-3 py-1 rounded capitalize transition-colors",
                active ? "bg-brand-orange text-white" : "text-brand-muted hover:bg-brand-cream",
              )}
            >
              {opt}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="card animate-pulse h-40" />
      ) : clients.length === 0 ? (
        <div className="card text-center py-12">
          {statusFilter === "active" ? (
            <>
              <p className="text-brand-muted text-sm">No active clients.</p>
              <p className="text-xs text-brand-muted mt-1">
                Brand-new clients land here only after at least one of their services flips to <strong>active</strong>.{" "}
                <button onClick={() => setStatusFilter("all")} className="text-brand-orange hover:underline">
                  Show all clients
                </button> to see clients still in setup.
              </p>
            </>
          ) : (
            <>
              <p className="text-brand-muted text-sm">No clients yet.</p>
              <p className="text-xs text-brand-muted mt-1">Convert a won lead or use the New client button above.</p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {clients.map(client => (
            <div key={client.id} className="card">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <Link
                    href={`/crm/clients/${client.id}`}
                    className="text-sm font-medium text-brand-black hover:text-brand-orange hover:underline"
                  >
                    {client.business?.name ?? "—"}
                  </Link>
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
                  {client.stripe_subscription_status && (
                    <span className={clsx("badge text-xs", STRIPE_STATUS_STYLES[client.stripe_subscription_status] ?? "badge-neutral")}>
                      stripe: {client.stripe_subscription_status}
                    </span>
                  )}
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
                <div className="ml-auto flex items-center gap-2">
                  {client.assigned_agents && client.assigned_agents.length > 0 && (
                    <div className="flex items-center gap-1">
                      {client.assigned_agents.map(agent => (
                        <AgentBadge key={agent} agent={agent as Agent} size="sm" />
                      ))}
                    </div>
                  )}
                  {!client.stripe_subscription_id && (
                    <button
                      onClick={() => generatePaymentLink(client)}
                      disabled={generatingLinkFor === client.id}
                      className="text-xs text-brand-orange underline underline-offset-2 hover:opacity-70 disabled:opacity-40 whitespace-nowrap"
                    >
                      {generatingLinkFor === client.id ? "Generating…" : "Send payment link"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {paymentLink && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-end md:items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-brand-black">Payment link ready</h2>
              <button onClick={() => setPaymentLink(null)} className="text-brand-muted hover:text-brand-black text-lg">✕</button>
            </div>
            <p className="text-sm text-brand-muted mb-3">
              Send this link to <span className="font-medium text-brand-black">{paymentLink.businessName}</span> to set up their monthly subscription.
            </p>
            <div className="bg-gray-50 border border-brand-border rounded-lg px-3 py-2 text-xs text-brand-black font-mono break-all mb-4">
              {paymentLink.url}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { navigator.clipboard.writeText(paymentLink.url); }}
                className="btn-primary flex-1 text-sm"
              >
                Copy link
              </button>
              <a
                href={paymentLink.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-ghost flex-1 text-sm text-center"
              >
                Preview
              </a>
            </div>
          </div>
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
              <div>
                <label className="text-xs text-brand-muted mb-1 block">Contract start (optional)</label>
                <input
                  type="date"
                  className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                  value={form.contractStart}
                  onChange={e => setForm(p => ({ ...p, contractStart: e.target.value }))}
                />
              </div>
              <p className="text-[11px] text-brand-muted">
                Services + billing are configured per-client on the detail page. After save you&apos;ll be taken there.
              </p>
              {createErr && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded px-3 py-2">
                  {createErr}
                </div>
              )}
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
