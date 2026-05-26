"use client";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { CRMNav } from "@/components/CRMNav";
import type { ServiceTemplate, ServiceBillingType, ServiceBillingInterval } from "@/types";

const BILLING_TYPES: ServiceBillingType[] = ["recurring", "one_time", "tm"];
const BILLING_INTERVALS: ServiceBillingInterval[] = ["month", "quarter", "year"];

const BLANK_FORM = {
  name: "",
  description: "",
  billing_type: "recurring" as ServiceBillingType,
  billing_interval: "month" as ServiceBillingInterval,
  is_taxable: false,
};

export default function ServiceCatalogPage() {
  const [templates, setTemplates] = useState<ServiceTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/crm/service-templates");
      const d = await r.json();
      setTemplates(Array.isArray(d) ? d : []);
    } catch {
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setIsAdmin(d?.role === "admin"))
      .catch(() => {});
    load();
  }, [load]);

  async function toggleActive(t: ServiceTemplate) {
    const r = await fetch(`/api/crm/service-templates/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !t.is_active }),
    });
    if (r.ok) {
      const updated = await r.json();
      setTemplates((prev) => prev.map((x) => (x.id === t.id ? updated : x)));
    } else {
      setErr(`Failed to toggle ${t.name}: HTTP ${r.status}`);
    }
  }

  async function save() {
    if (!form.name.trim()) {
      setErr("Name is required");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        billing_type: form.billing_type,
        is_taxable: form.is_taxable,
      };
      if (form.billing_type === "recurring") body.billing_interval = form.billing_interval;

      const r = await fetch("/api/crm/service-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const bodyText = await r.text().catch(() => "");
        throw new Error(`HTTP ${r.status}: ${bodyText.slice(0, 200)}`);
      }
      setShowAdd(false);
      setForm(BLANK_FORM);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Create failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl pb-24 md:pb-8">
      <CRMNav />
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-brand-black">Service catalog</h1>
          <p className="text-sm text-brand-muted mt-0.5">
            Service templates available for client billing. {templates.length} defined.
          </p>
        </div>
        {isAdmin && (
          <button onClick={() => { setForm(BLANK_FORM); setErr(null); setShowAdd(true); }} className="btn-primary text-xs px-3 py-1.5">
            + Add service
          </button>
        )}
      </div>

      {err && !showAdd && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded px-3 py-2 mb-3">
          {err}
        </div>
      )}

      {loading ? (
        <div className="card animate-pulse h-40" />
      ) : templates.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-brand-muted text-sm">No service templates yet.</p>
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-xs">
            <thead className="bg-brand-cream/40 text-brand-muted uppercase tracking-wide">
              <tr>
                <th className="text-left py-2 px-3 font-medium">Name</th>
                <th className="text-left py-2 px-3 font-medium">Billing</th>
                <th className="text-left py-2 px-3 font-medium">Interval</th>
                <th className="text-left py-2 px-3 font-medium">Taxable</th>
                <th className="text-left py-2 px-3 font-medium">Active</th>
                <th className="text-left py-2 px-3 font-medium">Stripe product</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className="border-t border-brand-border">
                  <td className="py-2 px-3">
                    <div className="font-medium text-brand-black">{t.name}</div>
                    {t.description && (
                      <div className="text-[11px] text-brand-muted mt-0.5">{t.description}</div>
                    )}
                  </td>
                  <td className="py-2 px-3 capitalize">{t.billing_type}</td>
                  <td className="py-2 px-3">{t.billing_interval ?? "—"}</td>
                  <td className="py-2 px-3">{t.is_taxable ? "Yes" : "No"}</td>
                  <td className="py-2 px-3">
                    <button
                      disabled={!isAdmin}
                      onClick={() => toggleActive(t)}
                      className={clsx(
                        "text-[11px] px-2 py-0.5 rounded",
                        t.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600",
                        isAdmin ? "cursor-pointer hover:opacity-80" : "cursor-default",
                      )}
                      title={isAdmin ? "Click to toggle" : "Admin only"}
                    >
                      {t.is_active ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="py-2 px-3 font-mono text-[11px] text-brand-muted">
                    {t.stripe_product_id ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg w-full max-w-md shadow-xl">
            <div className="px-4 py-3 border-b border-brand-border flex items-center justify-between">
              <h3 className="font-semibold text-brand-black text-sm">Add service</h3>
              <button onClick={() => setShowAdd(false)} className="text-brand-muted hover:text-brand-black text-lg leading-none">×</button>
            </div>
            <div className="p-4 space-y-3">
              <input
                autoFocus
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="Service name"
                className="w-full rounded border border-brand-border px-2 py-1.5 text-sm"
              />
              <textarea
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                rows={3}
                placeholder="Short description"
                className="w-full rounded border border-brand-border px-2 py-1.5 text-xs"
              />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] uppercase text-brand-muted mb-1">Billing type</div>
                  <select
                    value={form.billing_type}
                    onChange={(e) => setForm((p) => ({ ...p, billing_type: e.target.value as ServiceBillingType }))}
                    className="w-full rounded border border-brand-border px-2 py-1 text-xs"
                  >
                    {BILLING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                {form.billing_type === "recurring" && (
                  <div>
                    <div className="text-[10px] uppercase text-brand-muted mb-1">Interval</div>
                    <select
                      value={form.billing_interval}
                      onChange={(e) => setForm((p) => ({ ...p, billing_interval: e.target.value as ServiceBillingInterval }))}
                      className="w-full rounded border border-brand-border px-2 py-1 text-xs"
                    >
                      {BILLING_INTERVALS.map((i) => <option key={i} value={i}>{i}</option>)}
                    </select>
                  </div>
                )}
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={form.is_taxable}
                  onChange={(e) => setForm((p) => ({ ...p, is_taxable: e.target.checked }))}
                />
                Taxable
              </label>
              <p className="text-[11px] text-brand-muted">
                Stripe product is created automatically when you save.
              </p>
              {err && <div className="text-xs text-red-700">{err}</div>}
            </div>
            <div className="px-4 py-3 border-t border-brand-border flex justify-end gap-2">
              <button onClick={() => setShowAdd(false)} className="text-xs px-3 py-1 hover:bg-brand-cream rounded">Cancel</button>
              <button
                onClick={save}
                disabled={!form.name.trim() || saving}
                className={clsx("btn-primary text-xs px-3 py-1.5", saving && "opacity-60")}
              >
                {saving ? "Saving…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
