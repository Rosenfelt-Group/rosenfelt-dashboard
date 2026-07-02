"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CRMBusiness, CRMContact, CRMContactRole, CRMBusinessResearch } from "@/types";
import { CRMNav } from "@/components/CRMNav";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { safeHref } from "@/lib/safe-url";

const ROLE_OPTIONS: { value: CRMContactRole; label: string }[] = [
  { value: "decision_maker", label: "Decision maker" },
  { value: "champion", label: "Champion" },
  { value: "billing", label: "Billing" },
  { value: "influencer", label: "Influencer" },
  { value: "technical", label: "Technical" },
];
const ROLE_LABELS: Record<string, string> = Object.fromEntries(ROLE_OPTIONS.map(r => [r.value, r.label]));

type ContactForm = {
  first_name: string; last_name: string; email: string; phone: string;
  title: string; role: CRMContactRole | ""; is_primary: boolean; linkedin_url: string;
};
const BLANK_CONTACT: ContactForm = {
  first_name: "", last_name: "", email: "", phone: "", title: "", role: "", is_primary: false, linkedin_url: "",
};

export default function BusinessDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [business, setBusiness] = useState<CRMBusiness | null>(null);
  const [contacts, setContacts] = useState<CRMContact[]>([]);
  const [research, setResearch] = useState<CRMBusinessResearch[]>([]);
  const [loading, setLoading] = useState(true);

  const [showAddContact, setShowAddContact] = useState(false);
  const [contactForm, setContactForm] = useState<ContactForm>(BLANK_CONTACT);
  const [savingContact, setSavingContact] = useState(false);

  const [researching, setResearching] = useState(false);
  const [researchErr, setResearchErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/crm/businesses/${id}`).then(r => r.json()),
      fetch("/api/crm/contacts").then(r => r.json()),
      fetch(`/api/crm/businesses/${id}/research`).then(r => r.json()),
    ]).then(([b, allContacts, r]) => {
      setBusiness(b?.id ? b : null);
      setContacts(Array.isArray(allContacts) ? allContacts.filter((c: CRMContact) => c.business_id === id) : []);
      setResearch(Array.isArray(r) ? r : []);
      setLoading(false);
    });
  }, [id]);

  async function addContact() {
    if (!contactForm.first_name.trim()) return;
    setSavingContact(true);
    try {
      const res = await fetch("/api/crm/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: id,
          first_name: contactForm.first_name.trim(),
          last_name: contactForm.last_name.trim() || undefined,
          email: contactForm.email.trim() || undefined,
          phone: contactForm.phone.trim() || undefined,
          title: contactForm.title.trim() || undefined,
          role: contactForm.role || undefined,
          is_primary: contactForm.is_primary,
          linkedin_url: contactForm.linkedin_url.trim() || undefined,
        }),
      });
      const contact = await res.json();
      setContacts(prev => [contact, ...prev]);
      setContactForm(BLANK_CONTACT);
      setShowAddContact(false);
    } finally {
      setSavingContact(false);
    }
  }

  async function runResearch() {
    if (!business) return;
    setResearching(true);
    setResearchErr(null);
    try {
      const res = await fetch(`/api/crm/businesses/${id}/research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: business.name }),
      });
      const row = await res.json();
      if (!res.ok) throw new Error(row.error || "Research failed");
      setResearch(prev => [row, ...prev]);
    } catch (e) {
      setResearchErr(e instanceof Error ? e.message : "Research failed");
    } finally {
      setResearching(false);
    }
  }

  if (loading) {
    return <div className="p-8"><div className="card animate-pulse h-64" /></div>;
  }
  if (!business) {
    return (
      <div className="p-8">
        <p className="text-brand-muted">Business not found.</p>
        <Link href="/crm/businesses" className="text-brand-orange text-sm mt-2 block">← Back to businesses</Link>
      </div>
    );
  }

  const site = safeHref(business.website);

  return (
    <div className="p-4 md:p-8 max-w-4xl pb-24 md:pb-8">
      <CRMNav />

      <div className="card mb-4">
        <h1 className="text-lg font-semibold text-brand-black">{business.name}</h1>
        <div className="flex flex-wrap gap-3 mt-2 text-sm text-brand-muted">
          {business.industry && <span>{business.industry}</span>}
          {business.size && <span>{business.size} employees</span>}
          {site && (
            <a href={site} target="_blank" rel="noopener noreferrer" className="text-brand-orange hover:underline">
              {business.website}
            </a>
          )}
        </div>
        <div className="flex flex-wrap gap-3 mt-1 text-sm text-brand-muted">
          {business.email && <span>{business.email}</span>}
          {business.phone && <span>{business.phone}</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-brand-black">Contacts ({contacts.length})</h2>
            <button onClick={() => setShowAddContact(v => !v)} className="btn-ghost text-xs px-3 py-1.5">
              {showAddContact ? "Cancel" : "+ Add contact"}
            </button>
          </div>

          {showAddContact && (
            <div className="border border-brand-border rounded-lg p-3 mb-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                  placeholder="First name *"
                  value={contactForm.first_name}
                  onChange={e => setContactForm(p => ({ ...p, first_name: e.target.value }))}
                />
                <input
                  className="border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                  placeholder="Last name"
                  value={contactForm.last_name}
                  onChange={e => setContactForm(p => ({ ...p, last_name: e.target.value }))}
                />
              </div>
              <input
                type="email"
                className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                placeholder="Email"
                value={contactForm.email}
                onChange={e => setContactForm(p => ({ ...p, email: e.target.value }))}
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="tel"
                  className="border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                  placeholder="Phone"
                  value={contactForm.phone}
                  onChange={e => setContactForm(p => ({ ...p, phone: e.target.value }))}
                />
                <input
                  className="border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                  placeholder="Title"
                  value={contactForm.title}
                  onChange={e => setContactForm(p => ({ ...p, title: e.target.value }))}
                />
              </div>
              <select
                className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                value={contactForm.role}
                onChange={e => setContactForm(p => ({ ...p, role: e.target.value as CRMContactRole | "" }))}
              >
                <option value="">— no role —</option>
                {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <input
                type="url"
                className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                placeholder="LinkedIn URL"
                value={contactForm.linkedin_url}
                onChange={e => setContactForm(p => ({ ...p, linkedin_url: e.target.value }))}
              />
              <label className="flex items-center gap-2 text-xs text-brand-muted">
                <input
                  type="checkbox"
                  checked={contactForm.is_primary}
                  onChange={e => setContactForm(p => ({ ...p, is_primary: e.target.checked }))}
                />
                Primary contact
              </label>
              <button
                onClick={addContact}
                disabled={savingContact || !contactForm.first_name.trim()}
                className="btn-primary text-xs px-3 py-1.5 w-full disabled:opacity-50"
              >
                {savingContact ? "Saving…" : "Save contact"}
              </button>
            </div>
          )}

          {contacts.length === 0 ? (
            <p className="text-xs text-brand-muted">No contacts yet.</p>
          ) : (
            <div className="space-y-2">
              {contacts.map(c => {
                const linkedin = safeHref(c.linkedin_url);
                return (
                  <div key={c.id} className="border-b border-brand-border last:border-0 pb-2 last:pb-0">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-brand-black">
                        {c.first_name}{c.last_name ? ` ${c.last_name}` : ""}
                        {c.is_primary && <span className="badge badge-orange text-xs ml-2">Primary</span>}
                      </p>
                      {c.role && <span className="badge badge-neutral text-xs">{ROLE_LABELS[c.role] ?? c.role}</span>}
                    </div>
                    {c.title && <p className="text-xs text-brand-muted">{c.title}</p>}
                    {c.email && <p className="text-xs text-brand-orange">{c.email}</p>}
                    {c.phone && <p className="text-xs text-brand-muted">{c.phone}</p>}
                    {linkedin && (
                      <a href={linkedin} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-orange hover:underline block">
                        LinkedIn ↗
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-brand-black">Research</h2>
            <button onClick={runResearch} disabled={researching} className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50">
              {researching ? "Running… (up to ~30s)" : "Run research"}
            </button>
          </div>
          {researchErr && <p className="text-xs text-red-700 mb-2">{researchErr}</p>}
          {research.length === 0 ? (
            <p className="text-xs text-brand-muted">No research yet.</p>
          ) : (
            <div className="space-y-3">
              {research.map(r => (
                <div key={r.id} className="border-b border-brand-border last:border-0 pb-3 last:pb-0">
                  <p className="text-xs text-brand-muted mb-1">
                    {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                    {r.researched_by && <span className="capitalize"> · {r.researched_by}</span>}
                  </p>
                  {r.summary && <p className="text-sm text-brand-black">{r.summary}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
