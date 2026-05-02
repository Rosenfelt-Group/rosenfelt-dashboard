"use client";
import { useEffect, useState } from "react";
import { CRMContact, CRMBusiness } from "@/types";
import { CRMNav } from "@/components/CRMNav";

const BLANK_FORM = { firstName: "", lastName: "", email: "", phone: "", title: "", businessId: "" };

export default function ContactsPage() {
  const [contacts, setContacts] = useState<CRMContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [businesses, setBusinesses] = useState<CRMBusiness[]>([]);
  const [form, setForm] = useState(BLANK_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/crm/contacts")
      .then(r => r.json())
      .then(d => { setContacts(Array.isArray(d) ? d : []); setLoading(false); });
  }, []);

  async function openCreate() {
    if (businesses.length === 0) {
      const d = await fetch("/api/crm/businesses").then(r => r.json());
      setBusinesses(Array.isArray(d) ? d : []);
    }
    setForm(BLANK_FORM);
    setShowCreate(true);
  }

  async function createContact() {
    if (!form.firstName.trim()) return;
    setSaving(true);
    const r = await fetch("/api/crm/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        first_name: form.firstName.trim(),
        last_name: form.lastName.trim() || undefined,
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        title: form.title.trim() || undefined,
        business_id: form.businessId || undefined,
        is_primary: false,
      }),
    });
    const contact = await r.json();
    setContacts(prev => [contact, ...prev]);
    setShowCreate(false);
    setSaving(false);
  }

  const filtered = contacts.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    const name = `${c.first_name} ${c.last_name ?? ""}`.toLowerCase();
    return name.includes(q) || (c.email ?? "").toLowerCase().includes(q);
  });

  return (
    <div className="p-4 md:p-8 max-w-4xl pb-24 md:pb-8">
      <CRMNav />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-brand-black">Contacts</h1>
          <p className="text-sm text-brand-muted mt-0.5">{contacts.length} total</p>
        </div>
        <button onClick={openCreate} className="btn-primary text-xs px-3 py-1.5">
          + New contact
        </button>
      </div>

      <div className="mb-4">
        <input
          className="w-full max-w-sm border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
          placeholder="Search by name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="card animate-pulse h-40" />
      ) : filtered.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-brand-muted text-sm">{search ? "No contacts match." : "No contacts yet."}</p>
        </div>
      ) : (
        <div className="card divide-y divide-brand-border">
          {filtered.map(contact => (
            <div key={contact.id} className="py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-brand-black truncate">
                  {contact.first_name}{contact.last_name ? " " + contact.last_name : ""}
                  {contact.is_primary && (
                    <span className="ml-2 badge badge-orange text-xs">Primary</span>
                  )}
                </p>
                {contact.title && (
                  <p className="text-xs text-brand-muted">{contact.title}</p>
                )}
                {contact.email && (
                  <p className="text-xs text-brand-orange">{contact.email}</p>
                )}
              </div>
              <div className="text-right shrink-0">
                {contact.business && (
                  <p className="text-xs text-brand-muted truncate max-w-[140px]">{contact.business.name}</p>
                )}
                {contact.phone && (
                  <p className="text-xs text-brand-muted">{contact.phone}</p>
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
              <h2 className="text-base font-semibold text-brand-black">New contact</h2>
              <button onClick={() => setShowCreate(false)} className="text-brand-muted hover:text-brand-black text-lg">✕</button>
            </div>
            <div className="space-y-3">
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
                <label className="text-xs text-brand-muted mb-1 block">Title</label>
                <input
                  className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                  value={form.title}
                  onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                  placeholder="CEO"
                />
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
              <div>
                <label className="text-xs text-brand-muted mb-1 block">Phone</label>
                <input
                  type="tel"
                  className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                  value={form.phone}
                  onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                  placeholder="+1 555 000 0000"
                />
              </div>
              <div>
                <label className="text-xs text-brand-muted mb-1 block">Business</label>
                <select
                  className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                  value={form.businessId}
                  onChange={e => setForm(p => ({ ...p, businessId: e.target.value }))}
                >
                  <option value="">— none —</option>
                  {businesses.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowCreate(false)} className="btn-ghost flex-1">Cancel</button>
              <button
                onClick={createContact}
                disabled={saving || !form.firstName.trim()}
                className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? "Creating…" : "Create contact"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
