"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchJson } from "@/lib/fetch-json";
import { Button, ErrorState, Modal } from "@/components/ui";
import { CreateLeadModal } from "@/components/crm/CreateLeadModal";
import { NewDiscoveryModal } from "@/components/crm/NewDiscoveryModal";
import { NewRoomForm } from "@/components/crm/NewRoomForm";
import { LogHoursModal } from "@/components/crm/client/LogHoursModal";
import type { ClientService, CRMBusiness, CRMClient, CRMContact } from "@/types";
import type { NewKind } from "./palette";

const INPUT = "w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange";
const LABEL = "text-xs text-brand-muted mb-1 block";

/** The + New menu's dialogs. Each reuses the existing modal or API and opens the new record. */
export function NewRecordModal({ kind, onClose }: { kind: NewKind; onClose: () => void }) {
  const router = useRouter();
  switch (kind) {
    case "lead":
      return <CreateLeadModal onClose={onClose} onCreate={lead => { onClose(); router.push(`/crm/leads/${lead.id}`); }} />;
    case "discovery":
      return <NewDiscoveryModal onClose={onClose} />;
    case "room":
      return (
        <Modal open onClose={onClose} title="New engagement room">
          <NewRoomForm onCancel={onClose} />
        </Modal>
      );
    case "organization":
      return <NewOrganizationModal onClose={onClose} />;
    case "person":
      return <NewPersonModal onClose={onClose} />;
    case "hours":
      return <LogHoursLauncher onClose={onClose} />;
  }
}

async function postJson<T>(url: string, body: unknown) {
  return fetchJson<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

function NewOrganizationModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", website: "", industry: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true); setErr(null);
    const r = await postJson<CRMBusiness>("/api/crm/businesses", {
      name: form.name.trim(),
      website: form.website.trim() || null,
      industry: form.industry.trim() || null,
      source: "manual",
    });
    if (!r.ok) { setSaving(false); setErr(r.error); return; }
    onClose();
    router.push(`/crm/organizations/${r.data.id}`);
  }

  return (
    <Modal
      open
      onClose={onClose}
      preventClose={saving}
      title="New organization"
      footer={
        <>
          <Button variant="ghost" className="flex-1" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button className="flex-1" onClick={save} disabled={saving || !form.name.trim()}>{saving ? "Creating…" : "Create organization"}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className={LABEL} htmlFor="new-org-name">Name *</label>
          <input id="new-org-name" autoFocus className={INPUT} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Harbor Light Food Pantry" />
        </div>
        <div>
          <label className={LABEL} htmlFor="new-org-site">Website</label>
          <input id="new-org-site" type="url" className={INPUT} value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} placeholder="https://…" />
        </div>
        <div>
          <label className={LABEL} htmlFor="new-org-industry">Industry</label>
          <input id="new-org-industry" className={INPUT} value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))} placeholder="e.g. Food security" />
        </div>
        <p className="text-xs text-brand-muted">Add people, deals and research from the organization page.</p>
        {err && <ErrorState message={err} />}
      </div>
    </Modal>
  );
}

function NewPersonModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [orgs, setOrgs] = useState<CRMBusiness[] | null>(null);
  const [orgErr, setOrgErr] = useState<string | null>(null);
  const [form, setForm] = useState({ first_name: "", last_name: "", email: "", title: "", business_id: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<CRMBusiness[]>("/api/crm/businesses").then(r => {
      if (!r.ok) { setOrgErr(r.error); return; }
      setOrgs((Array.isArray(r.data) ? r.data : []).slice().sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")));
    });
  }, []);

  async function save() {
    setSaving(true); setErr(null); setExistingId(null);
    const res = await fetch("/api/crm/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim() || null,
        email: form.email.trim() || null,
        title: form.title.trim() || null,
        business_id: form.business_id || null,
      }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as (CRMContact & { error?: string; existing_contact_id?: string | null }) | null;
    if (!res?.ok || !data) {
      setSaving(false);
      setErr(data?.error ?? (res ? `Request failed (HTTP ${res.status})` : "Network error"));
      setExistingId(data?.existing_contact_id ?? null);
      return;
    }
    onClose();
    router.push(`/crm/people/${data.id}`);
  }

  return (
    <Modal
      open
      onClose={onClose}
      preventClose={saving}
      title="New person"
      footer={
        <>
          <Button variant="ghost" className="flex-1" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button className="flex-1" onClick={save} disabled={saving || !form.first_name.trim()}>{saving ? "Creating…" : "Create person"}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={LABEL} htmlFor="new-person-first">First name *</label>
            <input id="new-person-first" autoFocus className={INPUT} value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} />
          </div>
          <div>
            <label className={LABEL} htmlFor="new-person-last">Last name</label>
            <input id="new-person-last" className={INPUT} value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} />
          </div>
        </div>
        <div>
          <label className={LABEL} htmlFor="new-person-email">Email</label>
          <input id="new-person-email" type="email" className={INPUT} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
        </div>
        <div>
          <label className={LABEL} htmlFor="new-person-title">Title</label>
          <input id="new-person-title" className={INPUT} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Executive director" />
        </div>
        <div>
          <label className={LABEL} htmlFor="new-person-org">Organization</label>
          {orgErr ? (
            <p className="text-xs text-red-700">Couldn&apos;t load organizations: {orgErr}</p>
          ) : (
            <select id="new-person-org" className={INPUT} value={form.business_id} disabled={!orgs} onChange={e => setForm(f => ({ ...f, business_id: e.target.value }))}>
              <option value="">{orgs ? "No organization" : "Loading…"}</option>
              {orgs?.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
        </div>
        {err && (
          <div role="alert" className="text-xs text-red-700">
            {err}
            {existingId && <> · <Link className="underline" href={`/crm/people/${existingId}`} onClick={onClose}>Open the existing person</Link></>}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Log hours needs a client's active T&M service, so pick the client first. */
function LogHoursLauncher({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [clients, setClients] = useState<CRMClient[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [services, setServices] = useState<ClientService[] | null>(null);
  const [svcErr, setSvcErr] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<CRMClient[]>("/api/crm/clients?status=active").then(r => {
      if (!r.ok) { setLoadErr(r.error); return; }
      setClients((Array.isArray(r.data) ? r.data : []).slice().sort((a, b) => (a.business?.name ?? "").localeCompare(b.business?.name ?? "")));
    });
  }, []);

  async function next() {
    setSvcErr(null);
    const r = await fetchJson<ClientService[]>(`/api/crm/clients/${clientId}/services`);
    if (!r.ok) { setSvcErr(r.error); return; }
    setServices((Array.isArray(r.data) ? r.data : []).filter(s => s.service_template?.billing_type === "tm" && s.status === "active"));
  }

  const client = clients?.find(c => c.id === clientId);
  if (services && client) {
    return (
      <LogHoursModal
        services={services}
        onClose={onClose}
        onLogged={() => { onClose(); router.push(`/crm/organizations/${client.business_id}?tab=time`); }}
      />
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Log hours"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={next} disabled={!clientId}>Next</Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className={LABEL} htmlFor="log-hours-client">Client</label>
        {loadErr ? (
          <ErrorState message={`Couldn't load clients: ${loadErr}`} />
        ) : (
          <select id="log-hours-client" autoFocus className={INPUT} value={clientId} disabled={!clients} onChange={e => setClientId(e.target.value)}>
            <option value="">{clients ? (clients.length ? "Choose a client…" : "No active clients") : "Loading…"}</option>
            {clients?.map(c => <option key={c.id} value={c.id}>{c.business?.name ?? c.id}</option>)}
          </select>
        )}
        {svcErr && <p role="alert" className="text-xs text-red-700">Couldn&apos;t load services: {svcErr}</p>}
      </div>
    </Modal>
  );
}
