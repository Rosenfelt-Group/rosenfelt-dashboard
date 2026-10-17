"use client";
import { Suspense, useEffect, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { CRMBusiness, CRMContact, CRMContactRole, CRMBusinessResearch, CRMClient, CRMLead, DiscoveryInvite } from "@/types";
import { EngagementsPanel } from "@/components/crm/EngagementsPanel";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { safeHref } from "@/lib/safe-url";
import { STAGES } from "@/lib/crm/stages";
import { STATUS_META } from "@/lib/discovery";
import { BUSINESS_TABS, parseBusinessTab, BusinessTab } from "@/lib/crm/business-tabs";
import { fetchJson } from "@/lib/fetch-json";
import { Button, EmptyState, ErrorState, LoadingState, PageHeader, Tabs } from "@/components/ui";

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

function BusinessDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = parseBusinessTab(searchParams.get("tab"));

  function selectTab(next: BusinessTab) {
    router.replace(`${pathname}?tab=${next}`, { scroll: false });
  }

  const [business, setBusiness] = useState<CRMBusiness | null>(null);
  const [contacts, setContacts] = useState<CRMContact[]>([]);
  const [research, setResearch] = useState<CRMBusinessResearch[]>([]);
  const [leads, setLeads] = useState<CRMLead[]>([]);
  const [clients, setClients] = useState<CRMClient[]>([]);
  const [invites, setInvites] = useState<(DiscoveryInvite & { link: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [partialError, setPartialError] = useState<string | null>(null);

  const [showAddContact, setShowAddContact] = useState(false);
  const [contactForm, setContactForm] = useState<ContactForm>(BLANK_CONTACT);
  const [savingContact, setSavingContact] = useState(false);

  const [researching, setResearching] = useState(false);
  const [researchErr, setResearchErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetchJson<CRMBusiness>(`/api/crm/businesses/${id}`),
      fetchJson<unknown>("/api/crm/contacts"),
      fetchJson<unknown>(`/api/crm/businesses/${id}/research`),
      fetchJson<unknown>("/api/crm/leads"),
      fetchJson<unknown>(`/api/crm/discovery?business_id=${id}`),
      // No server-side business filter on /api/crm/clients; filter here like contacts and leads.
      fetchJson<unknown>("/api/crm/clients"),
    ]).then(([b, allContacts, r, allLeads, inv, allClients]) => {
      if (b.ok) setBusiness(b.data?.id ? b.data : null);
      else if (b.status !== 404) setLoadError(b.error);
      if (allContacts.ok) setContacts(Array.isArray(allContacts.data) ? allContacts.data.filter((c: CRMContact) => c.business_id === id) : []);
      if (r.ok) setResearch(Array.isArray(r.data) ? r.data : []);
      if (allLeads.ok) setLeads(Array.isArray(allLeads.data) ? allLeads.data.filter((l: CRMLead) => l.business_id === id) : []);
      if (inv.ok) setInvites(Array.isArray(inv.data) ? inv.data : []);
      if (allClients.ok) setClients(Array.isArray(allClients.data) ? allClients.data.filter((c: CRMClient) => c.business_id === id) : []);
      const failed = [allContacts, r, allLeads, inv, allClients].find(x => !x.ok);
      if (failed && !failed.ok) setPartialError(failed.error);
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
    return <div className="p-8"><LoadingState /></div>;
  }
  if (!business) {
    return (
      <div className="p-8">
        {loadError
          ? <ErrorState message={`Couldn't load this business: ${loadError}`} />
          : <p className="text-brand-muted">Business not found.</p>}
        <Link href="/crm/businesses" className="text-brand-orange text-sm mt-2 block">← Back to businesses</Link>
      </div>
    );
  }

  const site = safeHref(business.website);

  return (
    <div className="p-4 md:p-8 max-w-4xl pb-24 md:pb-8">

      <div className="card mb-4">
        <PageHeader
          className="!mb-0"
          title={business.name}
          description={
            <>
              <span className="flex flex-wrap gap-3 mt-2">
                {business.industry && <span>{business.industry}</span>}
                {business.size && <span>{business.size} employees</span>}
                {site && (
                  <a href={site} target="_blank" rel="noopener noreferrer" className="text-brand-orange hover:underline">
                    {business.website}
                  </a>
                )}
              </span>
              <span className="flex flex-wrap gap-3 mt-1">
                {business.email && <span>{business.email}</span>}
                {business.phone && <span>{business.phone}</span>}
              </span>
            </>
          }
        />
      </div>

      {partialError && <ErrorState message={`Some sections couldn't load: ${partialError}`} className="mb-4" />}

      <Tabs tabs={BUSINESS_TABS} value={tab} onChange={selectTab} className="mb-4" />

      {tab === "contacts" && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-brand-black">Contacts ({contacts.length})</h2>
            <Button variant="ghost" size="sm" onClick={() => setShowAddContact(v => !v)}>
              {showAddContact ? "Cancel" : "+ Add contact"}
            </Button>
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
              <Button
                size="sm"
                className="w-full"
                onClick={addContact}
                disabled={savingContact || !contactForm.first_name.trim()}
              >
                {savingContact ? "Saving…" : "Save contact"}
              </Button>
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
      )}

      {tab === "research" && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-brand-black">Research</h2>
            <Button size="sm" onClick={runResearch} disabled={researching}>
              {researching ? "Running… (up to ~30s)" : "Run research"}
            </Button>
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
      )}

      {tab === "rooms" && <EngagementsPanel businessId={id} />}

      {tab === "discovery" && (invites.length === 0 ? (
        <EmptyState title="No discovery questionnaires for this business yet." />
      ) : (
        <div className="card p-0 overflow-hidden">
          {invites.map(r => {
            const st = STATUS_META[r.status];
            const last = r.submitted_at ?? r.last_saved_at ?? r.opened_at ?? r.sent_at ?? r.created_at;
            return (
              <Link key={r.id} href={`/crm/discovery/${r.id}`} className="flex items-center gap-3 px-4 py-3 border-b border-brand-border last:border-b-0 hover:bg-brand-offwhite">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-brand-black truncate">{r.project_title}</p>
                  <p className="text-xs text-brand-muted">{formatDistanceToNow(new Date(last), { addSuffix: true })}</p>
                </div>
                <span className={clsx("badge text-xs", st.color)}>{st.label}</span>
              </Link>
            );
          })}
        </div>
      ))}

      {tab === "leads" && (leads.length === 0 ? (
        <EmptyState title="No leads linked to this business." />
      ) : (
        <div className="card p-0 overflow-hidden">
          {leads.map(l => {
            const meta = STAGES.find(s => s.stage === l.stage);
            return (
              <Link key={l.id} href={`/crm/leads/${l.id}`} className="flex items-center gap-3 px-4 py-3 border-b border-brand-border last:border-b-0 hover:bg-brand-offwhite">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-brand-black truncate">
                    {l.contact ? `${l.contact.first_name}${l.contact.last_name ? ` ${l.contact.last_name}` : ""}` : business.name}
                  </p>
                  <p className="text-xs text-brand-muted">{formatDistanceToNow(new Date(l.created_at), { addSuffix: true })}</p>
                </div>
                {meta && <span className={clsx("badge text-xs", meta.color)}>{meta.label}</span>}
              </Link>
            );
          })}
        </div>
      ))}

      {tab === "clients" && (clients.length === 0 ? (
        <EmptyState title="No client records for this business." />
      ) : (
        <div className="card p-0 overflow-hidden">
          {clients.map(c => (
            <Link key={c.id} href={`/crm/clients/${c.id}`} className="flex items-center gap-3 px-4 py-3 border-b border-brand-border last:border-b-0 hover:bg-brand-offwhite">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-brand-black truncate">
                  {c.contact ? `${c.contact.first_name}${c.contact.last_name ? ` ${c.contact.last_name}` : ""}` : business.name}
                </p>
                <p className="text-xs text-brand-muted">
                  {c.contract_start ? `Since ${c.contract_start}` : `Added ${formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}`}
                </p>
              </div>
              <span className={clsx("badge text-xs capitalize", c.billing_status === "active" ? "badge-success" : "badge-neutral")}>{c.billing_status}</span>
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}

// useSearchParams needs a Suspense boundary during prerender.
export default function BusinessDetailPage() {
  return (
    <Suspense fallback={<div className="p-8"><LoadingState /></div>}>
      <BusinessDetail />
    </Suspense>
  );
}
