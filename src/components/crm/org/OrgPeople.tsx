"use client";
// Left column: the organization's facts and people (with Add person), from the old business page.
import { useState } from "react";
import Link from "next/link";
import type { CRMContactRole } from "@/types";
import { safeHref } from "@/lib/safe-url";
import type { OrgBusiness, OrgPerson } from "@/lib/crm/org-detail";
import { Button, ErrorState } from "@/components/ui";

const ROLE_OPTIONS: { value: CRMContactRole; label: string }[] = [
  { value: "decision_maker", label: "Decision maker" },
  { value: "champion", label: "Champion" },
  { value: "billing", label: "Billing" },
  { value: "influencer", label: "Influencer" },
  { value: "technical", label: "Technical" },
];
const ROLE_LABELS: Record<string, string> = Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r.label]));
const INPUT = "w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange";

type ContactForm = { first_name: string; last_name: string; email: string; phone: string; title: string; role: CRMContactRole | ""; is_primary: boolean; linkedin_url: string };
const BLANK: ContactForm = { first_name: "", last_name: "", email: "", phone: "", title: "", role: "", is_primary: false, linkedin_url: "" };

export function OrgFacts({ business, source }: { business: OrgBusiness; source: string | null }) {
  const site = safeHref(business.website);
  const facts: [string, React.ReactNode][] = [
    ["Industry", business.industry],
    ["Size", business.size ? `${business.size} employees` : null],
    ["Website", site ? <a href={site} target="_blank" rel="noopener noreferrer" className="text-brand-orange hover:underline break-all">{business.website}</a> : null],
    ["Email", business.email],
    ["Phone", business.phone],
    ["Address", business.address ? <span className="whitespace-pre-line">{business.address}</span> : null],
    ["Source", source?.replace(/_/g, " ") ?? null],
    ["Added", new Date(business.created_at).toLocaleDateString()],
  ];
  return (
    <div className="card">
      <h2 className="text-sm font-medium text-brand-black mb-2">About</h2>
      <dl className="space-y-1.5 text-sm">
        {facts.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="grid grid-cols-3 gap-2">
            <dt className="text-xs text-brand-muted pt-0.5">{k}</dt>
            <dd className="col-span-2 text-brand-black break-words">{v}</dd>
          </div>
        ))}
      </dl>
      {business.notes && <p className="text-xs text-brand-muted mt-3 whitespace-pre-wrap">{business.notes}</p>}
    </div>
  );
}

export function OrgPeople({ businessId, people, onAdded }: { businessId: string; people: OrgPerson[]; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ContactForm>(BLANK);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof ContactForm) => (e: { target: { value: string } }) => setForm((p) => ({ ...p, [k]: e.target.value }));

  async function add() {
    if (!form.first_name.trim()) return;
    setSaving(true); setErr(null);
    try {
      const res = await fetch("/api/crm/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim() || undefined,
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          title: form.title.trim() || undefined,
          role: form.role || undefined,
          is_primary: form.is_primary,
          linkedin_url: form.linkedin_url.trim() || undefined,
        }),
      });
      const contact = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(contact.error || `Couldn't add the person (HTTP ${res.status})`);
      setForm(BLANK); setOpen(false);
      onAdded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't add the person");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium text-brand-black">People <span className="text-brand-muted font-normal">{people.length}</span></h2>
        <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>{open ? "Cancel" : "+ Add person"}</Button>
      </div>
      {open && (
        <div className="border border-brand-border rounded-lg p-3 mb-3 space-y-2">
          {err && <ErrorState message={err} />}
          <div className="grid grid-cols-2 gap-2">
            <input className={INPUT} placeholder="First name *" aria-label="First name" value={form.first_name} onChange={set("first_name")} />
            <input className={INPUT} placeholder="Last name" aria-label="Last name" value={form.last_name} onChange={set("last_name")} />
          </div>
          <input type="email" className={INPUT} placeholder="Email" aria-label="Email" value={form.email} onChange={set("email")} />
          <div className="grid grid-cols-2 gap-2">
            <input type="tel" className={INPUT} placeholder="Phone" aria-label="Phone" value={form.phone} onChange={set("phone")} />
            <input className={INPUT} placeholder="Title" aria-label="Title" value={form.title} onChange={set("title")} />
          </div>
          <select className={INPUT} aria-label="Role" value={form.role} onChange={set("role")}>
            <option value="">— no role —</option>
            {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <input type="url" className={INPUT} placeholder="LinkedIn URL" aria-label="LinkedIn URL" value={form.linkedin_url} onChange={set("linkedin_url")} />
          <label className="flex items-center gap-2 text-xs text-brand-muted">
            <input type="checkbox" checked={form.is_primary} onChange={(e) => setForm((p) => ({ ...p, is_primary: e.target.checked }))} />
            Primary contact
          </label>
          <Button size="sm" className="w-full" onClick={add} disabled={saving || !form.first_name.trim()}>{saving ? "Saving…" : "Save person"}</Button>
        </div>
      )}
      {people.length === 0 ? <p className="text-xs text-brand-muted">No people yet.</p> : (
        <ul className="space-y-2">
          {people.map((c) => {
            const linkedin = safeHref(c.linkedin_url);
            return (
              <li key={c.id} className="border-b border-brand-border last:border-0 pb-2 last:pb-0">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/crm/people/${c.id}`} className="text-sm font-medium text-brand-black hover:text-brand-orange hover:underline">
                    {c.first_name}{c.last_name ? ` ${c.last_name}` : ""}
                  </Link>
                  <span className="flex gap-1">
                    {c.is_primary && <span className="badge badge-orange text-xs">Primary</span>}
                    {c.role && <span className="badge badge-neutral text-xs">{ROLE_LABELS[c.role] ?? c.role}</span>}
                  </span>
                </div>
                {c.title && <p className="text-xs text-brand-muted">{c.title}</p>}
                {c.email && <p className="text-xs text-brand-orange break-all">{c.email}</p>}
                {c.phone && <p className="text-xs text-brand-muted">{c.phone}</p>}
                {linkedin && <a href={linkedin} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-orange hover:underline block">LinkedIn ↗</a>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
