"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { fetchJson } from "@/lib/fetch-json";
import { Button, EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/ui";

type Room = {
  id: string;
  title: string;
  relationship: string;
  status: string;
  created_at: string;
  business_id: string;
  business: { id: string; name: string } | null;
};
type Org = { id: string; name: string };

const RELATIONSHIPS = [
  { value: "prospect", label: "Prospect" },
  { value: "client", label: "Client" },
  { value: "partner", label: "Partner" },
];
const relLabel = (v: string) => RELATIONSHIPS.find(r => r.value === v)?.label ?? v;

function NewRoomPanel({ onCancel }: { onCancel: () => void }) {
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
    <div className="card mb-4 space-y-3">
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
            Add a business first.{" "}
            <Link href="/crm/businesses" className="text-brand-orange underline">Go to Businesses</Link>
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

export default function RoomsPage() {
  const [rows, setRows] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const r = await fetchJson<Room[]>("/api/engagements");
    if (r.ok) setRows(Array.isArray(r.data) ? r.data : []);
    else setError(r.error);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-4 md:p-8 max-w-5xl pb-24 md:pb-8">
      <PageHeader
        title="Rooms"
        description={`Engagement rooms · ${rows.length} total`}
        actions={
          <Button onClick={() => setShowNew(s => !s)}>
            {showNew ? "Close" : "New room"}
          </Button>
        }
      />

      {showNew && <NewRoomPanel onCancel={() => setShowNew(false)} />}

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={`Couldn't load rooms: ${error}`} onRetry={load} />
      ) : rows.length === 0 ? (
        <EmptyState title="No rooms yet. Create one for an organization to share prototypes and gather feedback." />
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-brand-muted border-b border-brand-border">
                <th className="px-4 py-2 font-medium">Room</th>
                <th className="px-4 py-2 font-medium">Organization</th>
                <th className="px-4 py-2 font-medium">Relationship</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-brand-border last:border-b-0 hover:bg-brand-offwhite">
                  <td className="px-4 py-3">
                    <Link href={`/engagements/${r.id}`} className="font-medium text-brand-black hover:text-brand-orange">{r.title}</Link>
                  </td>
                  <td className="px-4 py-3">
                    {r.business
                      ? <Link href={`/crm/businesses/${r.business_id}`} className="text-brand-black hover:text-brand-orange">{r.business.name}</Link>
                      : <span className="text-brand-muted">—</span>}
                  </td>
                  <td className="px-4 py-3 text-brand-muted">{relLabel(r.relationship)}</td>
                  <td className="px-4 py-3 text-brand-muted capitalize">{r.status}</td>
                  <td className="px-4 py-3 text-brand-muted whitespace-nowrap">
                    {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
