"use client";
import { useEffect, useState } from "react";
import { CRMBusiness } from "@/types";
import { CRMNav } from "@/components/CRMNav";

const SIZE_OPTIONS = ["1-10", "11-50", "51-200", "200+"] as const;
const BLANK_FORM = { name: "", industry: "", size: "", website: "" };

export default function BusinessesPage() {
  const [businesses, setBusinesses] = useState<CRMBusiness[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(BLANK_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/crm/businesses")
      .then(r => r.json())
      .then(d => { setBusinesses(Array.isArray(d) ? d : []); setLoading(false); });
  }, []);

  async function createBusiness() {
    if (!form.name.trim()) return;
    setSaving(true);
    const r = await fetch("/api/crm/businesses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name.trim(),
        industry: form.industry.trim() || undefined,
        size: form.size || undefined,
        website: form.website.trim() || undefined,
      }),
    });
    const biz = await r.json();
    setBusinesses(prev => [biz, ...prev]);
    setShowCreate(false);
    setForm(BLANK_FORM);
    setSaving(false);
  }

  const filtered = businesses.filter(b =>
    !search || b.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-4 md:p-8 max-w-4xl pb-24 md:pb-8">
      <CRMNav />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-brand-black">Businesses</h1>
          <p className="text-sm text-brand-muted mt-0.5">{businesses.length} total</p>
        </div>
        <button onClick={() => { setForm(BLANK_FORM); setShowCreate(true); }} className="btn-primary text-xs px-3 py-1.5">
          + New business
        </button>
      </div>

      <div className="mb-4">
        <input
          className="w-full max-w-sm border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
          placeholder="Search by name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="card animate-pulse h-40" />
      ) : filtered.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-brand-muted text-sm">{search ? "No businesses match." : "No businesses yet."}</p>
        </div>
      ) : (
        <div className="card divide-y divide-brand-border">
          {filtered.map(biz => (
            <div key={biz.id} className="py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-brand-black">{biz.name}</p>
                {biz.industry && <p className="text-xs text-brand-muted">{biz.industry}</p>}
                {biz.website && (
                  <a href={biz.website} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-brand-orange hover:underline">{biz.website}</a>
                )}
              </div>
              <div className="text-right shrink-0 space-y-1">
                {biz.size && <p className="text-xs text-brand-muted">{biz.size} employees</p>}
                {biz.source && (
                  <span className="badge badge-neutral text-xs capitalize">
                    {biz.source.replace("_", " ")}
                  </span>
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
              <h2 className="text-base font-semibold text-brand-black">New business</h2>
              <button onClick={() => setShowCreate(false)} className="text-brand-muted hover:text-brand-black text-lg">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-brand-muted mb-1 block">Business name *</label>
                <input
                  className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Acme Corp"
                />
              </div>
              <div>
                <label className="text-xs text-brand-muted mb-1 block">Industry</label>
                <input
                  className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                  value={form.industry}
                  onChange={e => setForm(p => ({ ...p, industry: e.target.value }))}
                  placeholder="e.g. Healthcare, Retail…"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-brand-muted mb-1 block">Size</label>
                  <select
                    className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                    value={form.size}
                    onChange={e => setForm(p => ({ ...p, size: e.target.value }))}
                  >
                    <option value="">— unknown —</option>
                    {SIZE_OPTIONS.map(s => (
                      <option key={s} value={s}>{s} employees</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-brand-muted mb-1 block">Website</label>
                  <input
                    type="url"
                    className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                    value={form.website}
                    onChange={e => setForm(p => ({ ...p, website: e.target.value }))}
                    placeholder="https://acme.com"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowCreate(false)} className="btn-ghost flex-1">Cancel</button>
              <button
                onClick={createBusiness}
                disabled={saving || !form.name.trim()}
                className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? "Creating…" : "Create business"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
