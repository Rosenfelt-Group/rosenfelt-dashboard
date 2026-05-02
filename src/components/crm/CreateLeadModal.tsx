"use client";
import { useEffect, useState } from "react";
import { CRMLead, CRMBusiness, CRMContact, CRMSource } from "@/types";

interface Props {
  onClose: () => void;
  onCreate: (lead: CRMLead) => void;
}

const SOURCE_OPTIONS: { value: CRMSource; label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "referral", label: "Referral" },
  { value: "website_contact", label: "Contact form" },
  { value: "website_assessment", label: "Assessment" },
];

export function CreateLeadModal({ onClose, onCreate }: Props) {
  const [businesses, setBusinesses] = useState<CRMBusiness[]>([]);
  const [allContacts, setAllContacts] = useState<CRMContact[]>([]);

  // Business combobox
  const [bizQuery, setBizQuery] = useState("");
  const [bizSelected, setBizSelected] = useState<CRMBusiness | null>(null);
  const [bizOpen, setBizOpen] = useState(false);

  // Contact fields
  const [contactSelected, setContactSelected] = useState<CRMContact | null>(null);
  const [contactQuery, setContactQuery] = useState("");
  const [contactOpen, setContactOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");

  // Lead fields
  const [source, setSource] = useState<CRMSource>("manual");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/crm/businesses").then(r => r.json()),
      fetch("/api/crm/contacts").then(r => r.json()),
    ]).then(([b, c]) => {
      setBusinesses(Array.isArray(b) ? b : []);
      setAllContacts(Array.isArray(c) ? c : []);
    });
  }, []);

  const filteredBizzes = !bizSelected && bizQuery.length > 0
    ? businesses.filter(b => b.name.toLowerCase().includes(bizQuery.toLowerCase()))
    : [];

  const bizContacts = bizSelected
    ? allContacts.filter(c => c.business_id === bizSelected.id)
    : [];

  const filteredContacts = bizSelected && !contactSelected
    ? contactQuery.length > 0
      ? bizContacts.filter(c =>
          `${c.first_name} ${c.last_name ?? ""}`.toLowerCase().includes(contactQuery.toLowerCase()) ||
          (c.email ?? "").toLowerCase().includes(contactQuery.toLowerCase())
        )
      : bizContacts
    : [];

  function selectBiz(b: CRMBusiness) {
    setBizSelected(b);
    setBizQuery(b.name);
    setBizOpen(false);
    setContactSelected(null);
    setContactQuery("");
    setFirstName("");
    setLastName("");
    setEmail("");
  }

  function clearBiz() {
    setBizSelected(null);
    setBizQuery("");
    setBizOpen(false);
    setContactSelected(null);
    setContactQuery("");
    setFirstName("");
    setLastName("");
    setEmail("");
  }

  function selectContact(c: CRMContact) {
    setContactSelected(c);
    setContactQuery(`${c.first_name}${c.last_name ? " " + c.last_name : ""}`);
    setFirstName(c.first_name);
    setLastName(c.last_name ?? "");
    setEmail(c.email ?? "");
    setContactOpen(false);
  }

  function clearContact() {
    setContactSelected(null);
    setContactQuery("");
    setFirstName("");
    setLastName("");
    setEmail("");
  }

  async function handleCreate() {
    if (!bizQuery.trim() || (!contactSelected && !firstName.trim())) return;
    setSaving(true);
    try {
      let biz = bizSelected;
      if (!biz) {
        const r = await fetch("/api/crm/businesses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: bizQuery.trim(), source }),
        });
        biz = await r.json();
      }

      let contact = contactSelected;
      if (!contact) {
        const r = await fetch("/api/crm/contacts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            business_id: biz!.id,
            first_name: firstName.trim(),
            last_name: lastName.trim() || undefined,
            email: email.trim() || undefined,
            is_primary: true,
          }),
        });
        contact = await r.json();
      }

      const lr = await fetch("/api/crm/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: biz!.id,
          contact_id: contact!.id,
          stage: "new",
          source,
          estimated_value: estimatedValue ? parseFloat(estimatedValue) : undefined,
        }),
      });
      const lead: CRMLead = await lr.json();

      if (notes.trim()) {
        await fetch(`/api/crm/leads/${lead.id}/activities`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ activity_type: "note", content: notes.trim(), logged_by: "brian" }),
        });
      }

      onCreate(lead);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-40 flex items-end md:items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-md p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-brand-black">New lead</h2>
          <button onClick={onClose} className="text-brand-muted hover:text-brand-black text-lg">✕</button>
        </div>

        <div className="space-y-4">
          {/* Business combobox */}
          <div>
            <label className="text-xs text-brand-muted mb-1 block">Business *</label>
            {bizSelected ? (
              <div className="flex items-center gap-2 border border-brand-border rounded-lg px-3 py-2 bg-brand-offwhite">
                <span className="text-sm text-brand-black flex-1">{bizSelected.name}</span>
                <span className="text-xs text-brand-muted">existing</span>
                <button onClick={clearBiz} className="text-brand-muted hover:text-brand-black text-sm leading-none">✕</button>
              </div>
            ) : (
              <div className="relative">
                <input
                  className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                  value={bizQuery}
                  onChange={e => { setBizQuery(e.target.value); setBizOpen(true); }}
                  onFocus={() => setBizOpen(true)}
                  onBlur={() => setTimeout(() => setBizOpen(false), 150)}
                  placeholder="Type to search or enter new name…"
                />
                {bizOpen && filteredBizzes.length > 0 && (
                  <ul className="absolute z-10 w-full mt-1 bg-white border border-brand-border rounded-lg shadow-md max-h-40 overflow-y-auto">
                    {filteredBizzes.map(b => (
                      <li
                        key={b.id}
                        onMouseDown={() => selectBiz(b)}
                        className="px-3 py-2 text-sm text-brand-black hover:bg-brand-offwhite cursor-pointer flex items-center justify-between"
                      >
                        <span>{b.name}</span>
                        <span className="text-xs text-brand-muted ml-2">existing</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Contact section */}
          <div className="border-t border-brand-border pt-4">
            <label className="text-xs text-brand-muted mb-2 block">Contact *</label>

            {contactSelected ? (
              <div className="flex items-center gap-2 border border-brand-border rounded-lg px-3 py-2 bg-brand-offwhite mb-2">
                <span className="text-sm text-brand-black flex-1">
                  {contactSelected.first_name}{contactSelected.last_name ? " " + contactSelected.last_name : ""}
                  {contactSelected.email ? ` · ${contactSelected.email}` : ""}
                </span>
                <span className="text-xs text-brand-muted">existing</span>
                <button onClick={clearContact} className="text-brand-muted hover:text-brand-black text-sm leading-none">✕</button>
              </div>
            ) : (
              <>
                {bizSelected && bizContacts.length > 0 && (
                  <div className="relative mb-3">
                    <input
                      className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                      value={contactQuery}
                      onChange={e => { setContactQuery(e.target.value); setContactOpen(true); }}
                      onFocus={() => setContactOpen(true)}
                      onBlur={() => setTimeout(() => setContactOpen(false), 150)}
                      placeholder={`Search ${bizContacts.length} existing contact${bizContacts.length !== 1 ? "s" : ""}…`}
                    />
                    {contactOpen && filteredContacts.length > 0 && (
                      <ul className="absolute z-10 w-full mt-1 bg-white border border-brand-border rounded-lg shadow-md max-h-32 overflow-y-auto">
                        {filteredContacts.map(c => (
                          <li
                            key={c.id}
                            onMouseDown={() => selectContact(c)}
                            className="px-3 py-2 text-sm text-brand-black hover:bg-brand-offwhite cursor-pointer flex items-center justify-between"
                          >
                            <span>{c.first_name}{c.last_name ? " " + c.last_name : ""}</span>
                            {c.email && <span className="text-xs text-brand-muted ml-2">{c.email}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="text-xs text-brand-muted mt-1">Or fill in below to create new</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-brand-muted mb-1 block">First name *</label>
                    <input
                      className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                      value={firstName}
                      onChange={e => setFirstName(e.target.value)}
                      placeholder="Jane"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-brand-muted mb-1 block">Last name</label>
                    <input
                      className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                      value={lastName}
                      onChange={e => setLastName(e.target.value)}
                      placeholder="Smith"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-brand-muted mb-1 block">Email</label>
                    <input
                      type="email"
                      className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="jane@acme.com"
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Lead fields */}
          <div className="border-t border-brand-border pt-4 grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-brand-muted mb-1 block">Source</label>
              <select
                className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                value={source}
                onChange={e => setSource(e.target.value as CRMSource)}
              >
                {SOURCE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-brand-muted mb-1 block">Est. value ($/mo)</label>
              <input
                type="number"
                className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                value={estimatedValue}
                onChange={e => setEstimatedValue(e.target.value)}
                placeholder="2500"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs text-brand-muted mb-1 block">Notes</label>
            <textarea
              className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange h-20 resize-none"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Initial context, how they were found, next steps…"
            />
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button
            onClick={handleCreate}
            disabled={saving || !bizQuery.trim() || (!contactSelected && !firstName.trim())}
            className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Creating…" : "Create lead"}
          </button>
        </div>
      </div>
    </div>
  );
}
