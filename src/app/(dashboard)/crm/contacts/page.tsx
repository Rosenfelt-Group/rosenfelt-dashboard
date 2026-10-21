"use client";
import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import { Button, EmptyState, ErrorState, LoadingState, Modal, PageHeader } from "@/components/ui";
import { CRMContact, CRMBusiness, CRMContactRole } from "@/types";

type Form = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  title: string;
  role: CRMContactRole | "";
  linkedinUrl: string;
  businessId: string;
  isPrimary: boolean;
  notes: string;
};
const BLANK_FORM: Form = {
  firstName: "", lastName: "", email: "", phone: "", title: "",
  role: "", linkedinUrl: "", businessId: "", isPrimary: false, notes: "",
};

const ROLE_OPTIONS: { value: CRMContactRole; label: string }[] = [
  { value: "decision_maker", label: "Decision maker" },
  { value: "champion", label: "Champion" },
  { value: "billing", label: "Billing" },
  { value: "influencer", label: "Influencer" },
  { value: "technical", label: "Technical" },
];
const ROLE_LABELS: Record<string, string> = Object.fromEntries(ROLE_OPTIONS.map(r => [r.value, r.label]));

function formFromContact(c: CRMContact): Form {
  return {
    firstName: c.first_name,
    lastName: c.last_name ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    title: c.title ?? "",
    role: c.role ?? "",
    linkedinUrl: c.linkedin_url ?? "",
    businessId: c.business_id ?? "",
    isPrimary: c.is_primary,
    notes: c.notes ?? "",
  };
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<CRMContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [businesses, setBusinesses] = useState<CRMBusiness[]>([]);
  const [form, setForm] = useState<Form>(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<unknown>("/api/crm/contacts").then(r => {
      if (r.ok) setContacts(Array.isArray(r.data) ? r.data : []);
      else setLoadError(r.error);
      setLoading(false);
    });
  }, []);

  async function loadBusinessesIfNeeded() {
    if (businesses.length === 0) {
      const d = await fetch("/api/crm/businesses").then(r => r.json());
      setBusinesses(Array.isArray(d) ? d : []);
    }
  }

  async function openCreate() {
    await loadBusinessesIfNeeded();
    setEditingId(null);
    setForm(BLANK_FORM);
    setErr(null);
    setShowModal(true);
  }

  async function openEdit(c: CRMContact) {
    await loadBusinessesIfNeeded();
    setEditingId(c.id);
    setForm(formFromContact(c));
    setErr(null);
    setShowModal(true);
  }

  async function saveContact() {
    if (!form.firstName.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const payload = {
        first_name: form.firstName.trim(),
        last_name: form.lastName.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        title: form.title.trim() || null,
        role: form.role || null,
        linkedin_url: form.linkedinUrl.trim() || null,
        business_id: form.businessId || null,
        is_primary: form.isPrimary,
        notes: form.notes.trim() || null,
      };
      const url = editingId ? `/api/crm/contacts/${editingId}` : "/api/crm/contacts";
      const method = editingId ? "PATCH" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        throw new Error(j?.error || `Save failed (HTTP ${r.status})`);
      }
      const contact = await r.json();
      setContacts(prev => editingId
        ? prev.map(c => c.id === contact.id ? contact : c)
        : [contact, ...prev],
      );
      setShowModal(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const filtered = contacts.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    const name = `${c.first_name} ${c.last_name ?? ""}`.toLowerCase();
    return name.includes(q) || (c.email ?? "").toLowerCase().includes(q);
  });

  return (
    <div className="p-4 md:p-8 max-w-4xl pb-24 md:pb-8">
      <PageHeader
        title="Contacts"
        description={`${contacts.length} total`}
        actions={<Button size="sm" onClick={openCreate}>+ New contact</Button>}
      />

      <div className="mb-4">
        <input
          className="w-full max-w-sm border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
          placeholder="Search by name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loadError && <ErrorState message={`Couldn't load contacts: ${loadError}`} className="mb-4" />}
      {loading ? (
        <LoadingState />
      ) : filtered.length === 0 ? (
        <EmptyState title={search ? "No contacts match." : "No contacts yet."} />
      ) : (
        <div className="card divide-y divide-brand-border">
          {filtered.map(contact => (
            <div key={contact.id} className="py-3 flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-brand-black truncate">
                  {contact.first_name}{contact.last_name ? " " + contact.last_name : ""}
                  {contact.is_primary && (
                    <span className="ml-2 badge badge-orange text-xs">Primary</span>
                  )}
                  {contact.role && (
                    <span className="ml-2 badge badge-neutral text-xs">{ROLE_LABELS[contact.role] ?? contact.role}</span>
                  )}
                </p>
                {contact.title && (
                  <p className="text-xs text-brand-muted">{contact.title}</p>
                )}
                {contact.email && (
                  <p className="text-xs text-brand-orange">{contact.email}</p>
                )}
              </div>
              <div className="text-right shrink-0 space-y-1">
                {contact.business && (
                  <p className="text-xs text-brand-muted truncate max-w-[140px]">{contact.business.name}</p>
                )}
                {contact.phone && (
                  <p className="text-xs text-brand-muted">{contact.phone}</p>
                )}
                <button
                  onClick={() => openEdit(contact)}
                  className="text-xs px-2 py-1 rounded border border-brand-border hover:bg-brand-cream block ml-auto"
                >
                  Edit
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editingId ? "Edit contact" : "New contact"}
        footer={
          <>
            <Button variant="ghost" className="flex-1" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button className="flex-1" onClick={saveContact} disabled={saving || !form.firstName.trim()}>
              {saving ? "Saving…" : editingId ? "Save changes" : "Create contact"}
            </Button>
          </>
        }
      >
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
          <div className="grid grid-cols-2 gap-2">
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
          <div>
            <label className="text-xs text-brand-muted mb-1 block">Role</label>
            <select
              className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
              value={form.role}
              onChange={e => setForm(p => ({ ...p, role: e.target.value as CRMContactRole | "" }))}
            >
              <option value="">— no role —</option>
              {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-brand-muted mb-1 block">LinkedIn URL</label>
            <input
              type="url"
              className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
              value={form.linkedinUrl}
              onChange={e => setForm(p => ({ ...p, linkedinUrl: e.target.value }))}
              placeholder="https://linkedin.com/in/..."
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-brand-black">
            <input
              type="checkbox"
              checked={form.isPrimary}
              onChange={e => setForm(p => ({ ...p, isPrimary: e.target.checked }))}
            />
            Primary contact for this business
          </label>
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
      </Modal>
    </div>
  );
}
