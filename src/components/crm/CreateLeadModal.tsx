"use client";
import { useEffect, useState } from "react";
import { CRMLead, CRMBusiness, CRMContact, CRMSource } from "@/types";
import { fetchJson } from "@/lib/fetch-json";
import { Button, ErrorState, Modal } from "@/components/ui";

interface Props {
  onClose: () => void;
  onCreate: (lead: CRMLead) => void;
}

const SOURCE_OPTIONS: { value: CRMSource; label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "referral", label: "Referral" },
  { value: "pro_bono", label: "Pro bono" },
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetchJson<unknown>("/api/crm/businesses"),
      fetchJson<unknown>("/api/crm/contacts"),
    ]).then(([b, c]) => {
      if (b.ok) setBusinesses(Array.isArray(b.data) ? b.data : []);
      if (c.ok) setAllContacts(Array.isArray(c.data) ? c.data : []);
      const failed = !b.ok ? b.error : !c.ok ? c.error : null;
      if (failed) setLoadError(failed);
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

  async function post(url: string, body: unknown): Promise<unknown> {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((data as { error?: string }).error || `Request failed (HTTP ${r.status})`);
    return data;
  }

  async function handleCreate() {
    if (!bizQuery.trim() || (!contactSelected && !firstName.trim())) return;
    setSaving(true);
    setCreateError(null);
    try {
      const leadFields = {
        stage: "new",
        source,
        estimated_value: estimatedValue ? parseFloat(estimatedValue) : undefined,
      };
      // Existing contact: link by id. New contact: the server matches or creates the
      // contact and business by email (crm.intake_lead), so nothing is created here.
      const body = contactSelected
        ? { business_id: bizSelected?.id, contact_id: contactSelected.id, ...leadFields }
        : {
            email: email.trim(),
            first_name: firstName.trim(),
            last_name: lastName.trim() || undefined,
            org: bizSelected?.name ?? bizQuery.trim(),
            ...leadFields,
          };
      const lead = (await post("/api/crm/leads", body)) as CRMLead;

      if (notes.trim()) {
        await post(`/api/crm/leads/${lead.id}/activities`, { activity_type: "note", content: notes.trim(), logged_by: "brian" });
      }

      onCreate(lead);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Couldn't create the lead");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New lead"
      footer={
        <>
          <Button variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button
            className="flex-1"
            onClick={handleCreate}
            disabled={saving || !bizQuery.trim() || (!contactSelected && (!firstName.trim() || !email.trim()))}
          >
            {saving ? "Creating…" : "Create lead"}
          </Button>
        </>
      }
    >
      {loadError && <ErrorState message={`Couldn't load businesses and contacts: ${loadError}`} className="mb-4" />}
      {createError && <ErrorState message={createError} className="mb-4" />}
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
                  <label className="text-xs text-brand-muted mb-1 block">Email *</label>
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
    </Modal>
  );
}
