"use client";
// "New client" and "Send payment link", formerly on /crm/clients.
import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import { Button, ErrorState, Modal } from "@/components/ui";
import type { CRMBusiness, CRMClient, CRMContact } from "@/types";

const INPUT = "w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange";

/**
 * Creates a crm.clients row. billing_status starts 'cancelled' until a client_service activates
 * (the crm.update_client_billing_status() trigger rolls it up). `businessId` preselects and locks the business.
 */
export function NewClientModal({ businessId, onClose, onCreated }: {
  businessId?: string; onClose: () => void; onCreated: (client: CRMClient) => void;
}) {
  const [businesses, setBusinesses] = useState<CRMBusiness[]>([]);
  const [contacts, setContacts] = useState<CRMContact[]>([]);
  const [form, setForm] = useState({ businessId: businessId ?? "", contactId: "", contractStart: "" });
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchJson<unknown>("/api/crm/businesses"), fetchJson<unknown>("/api/crm/contacts")]).then(([b, c]) => {
      if (b.ok) setBusinesses(Array.isArray(b.data) ? b.data : []);
      if (c.ok) setContacts(Array.isArray(c.data) ? c.data : []);
      setOptionsError(!b.ok ? b.error : !c.ok ? c.error : null);
    });
  }, []);

  const businessContacts = contacts.filter((c) => c.business_id === form.businessId);

  async function create() {
    if (!form.businessId) return;
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch("/api/crm/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: form.businessId,
          contact_id: form.contactId || undefined,
          billing_status: "cancelled",
          contract_start: form.contractStart || undefined,
        }),
      });
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        throw new Error(`HTTP ${r.status}: ${body.slice(0, 200)}`);
      }
      onCreated(await r.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Create failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New client"
      footer={
        <>
          <Button variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" onClick={create} disabled={saving || !form.businessId}>
            {saving ? "Creating…" : "Create client"}
          </Button>
        </>
      }
    >
      {optionsError && <ErrorState message={`Couldn't load businesses and contacts: ${optionsError}`} className="mb-3" />}
      <div className="space-y-3">
        <div>
          <label className="text-xs text-brand-muted mb-1 block">Organization *</label>
          <select className={INPUT} value={form.businessId} disabled={!!businessId}
            onChange={(e) => setForm((p) => ({ ...p, businessId: e.target.value, contactId: "" }))}>
            <option value="">— select organization —</option>
            {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-brand-muted mb-1 block">Contact</label>
          <select className={INPUT} value={form.contactId} disabled={!form.businessId}
            onChange={(e) => setForm((p) => ({ ...p, contactId: e.target.value }))}>
            <option value="">— none —</option>
            {businessContacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.first_name}{c.last_name ? " " + c.last_name : ""}{c.email ? ` (${c.email})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-brand-muted mb-1 block">Contract start (optional)</label>
          <input type="date" className={INPUT} value={form.contractStart}
            onChange={(e) => setForm((p) => ({ ...p, contractStart: e.target.value }))} />
        </div>
        <p className="text-[11px] text-brand-muted">
          Services and billing are set up on the organization&apos;s Billing tab. After saving you&apos;ll be taken there.
        </p>
        {err && <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded px-3 py-2">{err}</div>}
      </div>
    </Modal>
  );
}

/** POST /api/stripe/checkout for a client, then shows the link. Legacy path: it needs crm.clients.monthly_value. */
export function useStripePaymentLink() {
  const [link, setLink] = useState<{ url: string; businessName: string } | null>(null);
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);

  async function generate(client: Pick<CRMClient, "id" | "monthly_value">, businessName: string): Promise<string | null> {
    if (!client.monthly_value) {
      alert("Set a monthly value on this client before generating a payment link.");
      return null;
    }
    setGeneratingFor(client.id);
    try {
      const r = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id }),
      });
      const data = await r.json();
      if (!r.ok) { alert(data.error ?? "Failed to generate link"); return null; }
      setLink({ url: data.url, businessName });
      return data.customerId ?? null;
    } finally {
      setGeneratingFor(null);
    }
  }

  const modal = (
    <Modal
      open={!!link}
      onClose={() => setLink(null)}
      title="Payment link ready"
      footer={link && (
        <>
          <Button className="flex-1" onClick={() => { navigator.clipboard.writeText(link.url); }}>Copy link</Button>
          <a href={link.url} target="_blank" rel="noopener noreferrer" className="btn-ghost flex-1 text-sm text-center">Preview</a>
        </>
      )}
    >
      {link && (
        <>
          <p className="text-sm text-brand-muted mb-3">
            Send this link to <span className="font-medium text-brand-black">{link.businessName}</span> to set up their monthly subscription.
          </p>
          <div className="bg-gray-50 border border-brand-border rounded-lg px-3 py-2 text-xs text-brand-black font-mono break-all">{link.url}</div>
        </>
      )}
    </Modal>
  );

  return { generate, generatingFor, modal };
}
