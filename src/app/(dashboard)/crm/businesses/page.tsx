"use client";
import { useEffect, useState } from "react";
import { CRMBusiness } from "@/types";
import { CRMNav } from "@/components/CRMNav";

const SIZE_OPTIONS = ["1-10", "11-50", "51-200", "200+"] as const;

type Form = {
  name: string;
  industry: string;
  size: string;
  website: string;
  address: string;
  phone: string;
  email: string;
  notes: string;
};
const BLANK_FORM: Form = {
  name: "", industry: "", size: "", website: "", address: "", phone: "", email: "", notes: "",
};

function formFromBusiness(b: CRMBusiness): Form {
  return {
    name: b.name,
    industry: b.industry ?? "",
    size: b.size ?? "",
    website: b.website ?? "",
    address: b.address ?? "",
    phone: b.phone ?? "",
    email: b.email ?? "",
    notes: b.notes ?? "",
  };
}

export default function BusinessesPage() {
  const [businesses, setBusinesses] = useState<CRMBusiness[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  // editingId === null + showModal === true → create mode
  // editingId === '<uuid>' → edit mode
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<Form>(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/crm/businesses")
      .then(r => r.json())
      .then(d => { setBusinesses(Array.isArray(d) ? d : []); setLoading(false); });
  }, []);

  function openCreate() {
    setEditingId(null);
    setForm(BLANK_FORM);
    setErr(null);
    setShowModal(true);
  }

  function openEdit(b: CRMBusiness) {
    setEditingId(b.id);
    setForm(formFromBusiness(b));
    setErr(null);
    setShowModal(true);
  }

  async function saveBusiness() {
    if (!form.name.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const payload = {
        name: form.name.trim(),
        industry: form.industry.trim() || null,
        size: form.size || null,
        website: form.website.trim() || null,
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        notes: form.notes.trim() || null,
      };
      const url = editingId ? `/api/crm/businesses/${editingId}` : "/api/crm/businesses";
      const method = editingId ? "PATCH" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`);
      }
      const biz = await r.json();
      setBusinesses(prev => editingId
        ? prev.map(b => b.id === biz.id ? biz : b)
        : [biz, ...prev],
      );
      setShowModal(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
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
        <button onClick={openCreate} className="btn-primary text-xs px-3 py-1.5">
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
            <div key={biz.id} className="py-3 flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-brand-black">{biz.name}</p>
                {biz.industry && <p className="text-xs text-brand-muted">{biz.industry}</p>}
                <div className="text-xs text-brand-muted mt-1 space-y-0.5">
                  {biz.website && (
                    <div>
                      <a href={biz.website} target="_blank" rel="noopener noreferrer"
                         className="text-brand-orange hover:underline">{biz.website}</a>
                    </div>
                  )}
                  {biz.email && <div>{biz.email}</div>}
                  {biz.phone && <div>{biz.phone}</div>}
                  {biz.address && <div className="whitespace-pre-line">{biz.address}</div>}
                </div>
              </div>
              <div className="text-right shrink-0 space-y-1">
                {biz.size && <p className="text-xs text-brand-muted">{biz.size} employees</p>}
                {biz.source && (
                  <span className="badge badge-neutral text-xs capitalize">
                    {biz.source.replace("_", " ")}
                  </span>
                )}
                <button
                  onClick={() => openEdit(biz)}
                  className="text-xs px-2 py-1 rounded border border-brand-border hover:bg-brand-cream block ml-auto"
                >
                  Edit
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-end md:items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-brand-black">
                {editingId ? "Edit business" : "New business"}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-brand-muted hover:text-brand-black text-lg">✕</button>
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
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-brand-muted mb-1 block">Email</label>
                  <input
                    type="email"
                    className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                    value={form.email}
                    onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                    placeholder="hello@acme.com"
                  />
                </div>
                <div>
                  <label className="text-xs text-brand-muted mb-1 block">Phone</label>
                  <input
                    type="tel"
                    className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                    value={form.phone}
                    onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                    placeholder="+1 555 555 5555"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-brand-muted mb-1 block">Address</label>
                <textarea
                  rows={2}
                  className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                  value={form.address}
                  onChange={e => setForm(p => ({ ...p, address: e.target.value }))}
                  placeholder="123 Main St, City, State ZIP"
                />
              </div>
              <div>
                <label className="text-xs text-brand-muted mb-1 block">Notes</label>
                <textarea
                  rows={2}
                  className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                  value={form.notes}
                  onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                />
              </div>
              {err && <div className="text-xs text-red-700">{err}</div>}
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowModal(false)} className="btn-ghost flex-1">Cancel</button>
              <button
                onClick={saveBusiness}
                disabled={saving || !form.name.trim()}
                className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? "Saving…" : editingId ? "Save changes" : "Create business"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
