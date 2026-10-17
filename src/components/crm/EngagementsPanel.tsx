"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { fetchJson } from "@/lib/fetch-json";
import { Button, EmptyState, ErrorState } from "@/components/ui";

type Eng = { id: string; title: string; relationship: string; status: string; created_at: string };

export function EngagementsPanel({ businessId }: { businessId: string }) {
  const [rows, setRows] = useState<Eng[]>([]);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [relationship, setRelationship] = useState("prospect");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [loadErr, setLoadErr] = useState<string | null>(null);

  const load = async () => {
    const r = await fetchJson<Eng[]>(`/api/engagements?business_id=${businessId}`);
    if (r.ok) { setRows(Array.isArray(r.data) ? r.data : []); setLoadErr(null); }
    else setLoadErr(r.error);
  };
  useEffect(() => { load(); }, [businessId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function create() {
    if (busy) return;
    setBusy(true); setErr(null);
    const r = await fetchJson("/api/engagements", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_id: businessId, relationship, title }),
    });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setOpen(false); setTitle(""); load();
  }

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-brand-black">Engagement rooms</h2>
        <button onClick={() => setOpen(o => !o)} className="text-sm text-brand-orange">
          {open ? "Cancel" : "New room"}
        </button>
      </div>

      {open && (
        <div className="border border-brand-border rounded p-3 mb-3 space-y-2">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Room title (e.g. Volunteer intake)"
            className="w-full border border-brand-border rounded px-2 py-1.5 text-sm" />
          <select value={relationship} onChange={e => setRelationship(e.target.value)}
            className="border border-brand-border rounded px-2 py-1.5 text-sm">
            <option value="prospect">Prospect</option>
            <option value="client">Client</option>
            <option value="partner">Partner</option>
          </select>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <Button size="sm" disabled={busy || !title.trim()} onClick={create}>
            Create room
          </Button>
        </div>
      )}

      {loadErr ? (
        <ErrorState message={`Couldn't load rooms: ${loadErr}`} onRetry={load} />
      ) : rows.length === 0 ? (
        <EmptyState title="No rooms yet." />
      ) : (
        <ul className="divide-y divide-brand-border border border-brand-border rounded">
          {rows.map(r => (
            <li key={r.id}>
              <Link href={`/engagements/${r.id}`} className="flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-50">
                <span>{r.title} <span className="text-brand-muted">· {r.relationship}</span></span>
                <span className="text-brand-muted">{formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
