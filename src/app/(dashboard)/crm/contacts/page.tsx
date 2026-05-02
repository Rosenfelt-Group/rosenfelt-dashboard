"use client";
import { useEffect, useState } from "react";
import { CRMContact } from "@/types";
import Link from "next/link";

export default function ContactsPage() {
  const [contacts, setContacts] = useState<CRMContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/crm/contacts")
      .then(r => r.json())
      .then(d => { setContacts(Array.isArray(d) ? d : []); setLoading(false); });
  }, []);

  const filtered = contacts.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    const name = `${c.first_name} ${c.last_name ?? ""}`.toLowerCase();
    return name.includes(q) || (c.email ?? "").toLowerCase().includes(q);
  });

  return (
    <div className="p-4 md:p-8 max-w-4xl pb-24 md:pb-8">
      <div className="flex items-center gap-3 mb-2">
        <Link href="/crm" className="text-xs text-brand-muted hover:text-brand-black">← Pipeline</Link>
      </div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-brand-black">Contacts</h1>
          <p className="text-sm text-brand-muted mt-0.5">{contacts.length} total</p>
        </div>
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
    </div>
  );
}
