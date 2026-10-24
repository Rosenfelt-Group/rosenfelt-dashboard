"use client";
// Create or edit an organization (crm.businesses) through the existing /api/crm/businesses routes.
import { useState } from "react";
import { Button, Modal } from "@/components/ui";
import { ORG_STATUSES, ORG_STATUS_META } from "@/lib/crm/org-status";
import type { CRMBusiness } from "@/types";

const SIZE_OPTIONS = ["1-10", "11-50", "51-200", "200+"] as const;
const INPUT = "w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange";
const LABEL = "text-xs text-brand-muted mb-1 block";

export type OrgFormBusiness = {
  id: string; name: string; industry?: string | null; size?: string | null; website?: string | null; address?: string | null;
  phone?: string | null; email?: string | null; notes?: string | null; relationship?: string | null;
};

type Form = { name: string; industry: string; size: string; website: string; address: string; phone: string; email: string; notes: string; relationship: string };

const toForm = (b?: OrgFormBusiness | null): Form => ({
  name: b?.name ?? "", industry: b?.industry ?? "", size: b?.size ?? "", website: b?.website ?? "", address: b?.address ?? "",
  phone: b?.phone ?? "", email: b?.email ?? "", notes: b?.notes ?? "", relationship: b?.relationship ?? "",
});

/**
 * `business` null → create. The relationship select is the manual override of the derived status;
 * "Automatic" clears it. `derivedLabel` says what Automatic currently resolves to.
 */
export function OrgFormModal({ business, derivedLabel, onClose, onSaved }: {
  business: OrgFormBusiness | null; derivedLabel?: string; onClose: () => void; onSaved: (b: CRMBusiness) => void;
}) {
  const [form, setForm] = useState<Form>(() => toForm(business));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((p) => ({ ...p, [k]: e.target.value }));

  async function save() {
    if (!form.name.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        industry: form.industry.trim() || null,
        size: form.size || null,
        website: form.website.trim() || null,
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        notes: form.notes.trim() || null,
      };
      if (business || form.relationship) payload.relationship = form.relationship || null;
      const r = await fetch(business ? `/api/crm/businesses/${business.id}` : "/api/crm/businesses", {
        method: business ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      onSaved(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={business ? "Edit organization" : "New organization"}
      footer={
        <>
          <Button variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" onClick={save} disabled={saving || !form.name.trim()}>
            {saving ? "Saving…" : business ? "Save changes" : "Create organization"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className={LABEL}>Name *</label>
          <input className={INPUT} value={form.name} onChange={set("name")} placeholder="Acme Corp" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={LABEL}>Industry</label>
            <input className={INPUT} value={form.industry} onChange={set("industry")} placeholder="e.g. Healthcare, Retail…" />
          </div>
          <div>
            <label className={LABEL}>Relationship</label>
            <select className={INPUT} value={form.relationship} onChange={set("relationship")}>
              <option value="">Automatic{derivedLabel ? ` (${derivedLabel})` : ""}</option>
              {ORG_STATUSES.map((s) => <option key={s} value={s}>{ORG_STATUS_META[s].label}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={LABEL}>Size</label>
            <select className={INPUT} value={form.size} onChange={set("size")}>
              <option value="">— unknown —</option>
              {SIZE_OPTIONS.map((s) => <option key={s} value={s}>{s} employees</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL}>Website</label>
            <input type="url" className={INPUT} value={form.website} onChange={set("website")} placeholder="https://acme.com" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={LABEL}>Email</label>
            <input type="email" className={INPUT} value={form.email} onChange={set("email")} placeholder="hello@acme.com" />
          </div>
          <div>
            <label className={LABEL}>Phone</label>
            <input type="tel" className={INPUT} value={form.phone} onChange={set("phone")} placeholder="+1 555 555 5555" />
          </div>
        </div>
        <div>
          <label className={LABEL}>Address</label>
          <textarea rows={2} className={INPUT} value={form.address} onChange={set("address")} placeholder="123 Main St, City, State ZIP" />
        </div>
        <div>
          <label className={LABEL}>Notes</label>
          <textarea rows={2} className={INPUT} value={form.notes} onChange={set("notes")} />
        </div>
        {err && <div className="text-xs text-red-700">{err}</div>}
      </div>
    </Modal>
  );
}
