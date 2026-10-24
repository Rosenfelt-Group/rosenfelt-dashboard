"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchJson } from "@/lib/fetch-json";
import { Button } from "@/components/ui";

type Org = { id: string; name: string };

export const RELATIONSHIPS = [
  { value: "prospect", label: "Prospect" },
  { value: "client", label: "Client" },
  { value: "partner", label: "Partner" },
];

/** Create a room for an organization, then open it. Used by the Rooms page and the + New menu. */
export function NewRoomForm({ onCancel, className = "space-y-3" }: { onCancel: () => void; className?: string }) {
  const router = useRouter();
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [orgErr, setOrgErr] = useState<string | null>(null);
  const [businessId, setBusinessId] = useState("");
  const [title, setTitle] = useState("");
  const [relationship, setRelationship] = useState("prospect");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [err, setErr] = useState<string | null>(null);

  const loadOrgs = useCallback(async () => {
    setOrgs(null); setOrgErr(null);
    const r = await fetchJson<Org[]>("/api/crm/businesses");
    if (!r.ok) { setOrgErr(r.error); return; }
    const list = (Array.isArray(r.data) ? r.data : [])
      .map(b => ({ id: b.id, name: b.name }))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    setOrgs(list);
  }, []);
  useEffect(() => { loadOrgs(); }, [loadOrgs]);

  async function create() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setErr(null);
    const r = await fetchJson<{ id: string }>("/api/engagements", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_id: businessId, relationship, title: title.trim() }),
    });
    if (!r.ok) { inFlight.current = false; setBusy(false); setErr(r.error); return; }
    router.push(`/engagements/${r.data.id}`);
  }

  const canSubmit = !busy && Boolean(businessId) && title.trim().length > 0 && title.length <= 200;

  return (
    <div className={className}>
      <div>
        <label className="block text-xs font-medium text-brand-muted mb-1" htmlFor="room-org">Organization</label>
        {orgErr ? (
          <p className="text-sm text-red-600">
            Couldn&apos;t load organizations: {orgErr}{" "}
            <button onClick={loadOrgs} className="underline">Retry</button>
          </p>
        ) : orgs === null ? (
          <p className="text-sm text-brand-muted">Loading organizations…</p>
        ) : orgs.length === 0 ? (
          <p className="text-sm text-brand-muted">
            Add an organization first.{" "}
            <Link href="/crm/organizations" className="text-brand-orange underline">Go to Organizations</Link>
          </p>
        ) : (
          <select id="room-org" value={businessId} onChange={e => setBusinessId(e.target.value)}
            className="w-full border border-brand-border rounded px-2 py-1.5 text-sm">
            <option value="">Select an organization…</option>
            {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
      </div>
      <div>
        <label className="block text-xs font-medium text-brand-muted mb-1" htmlFor="room-title">Title</label>
        <input id="room-title" value={title} maxLength={200} onChange={e => setTitle(e.target.value)}
          placeholder="Room title (e.g. Volunteer intake)"
          className="w-full border border-brand-border rounded px-2 py-1.5 text-sm" />
      </div>
      <div>
        <label className="block text-xs font-medium text-brand-muted mb-1" htmlFor="room-rel">Relationship</label>
        <select id="room-rel" value={relationship} onChange={e => setRelationship(e.target.value)}
          className="border border-brand-border rounded px-2 py-1.5 text-sm">
          {RELATIONSHIPS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="flex gap-2">
        <Button disabled={!canSubmit} onClick={create}>
          {busy ? "Creating…" : "Create room"}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </div>
  );
}
