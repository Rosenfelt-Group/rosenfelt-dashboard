"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";

type Eng = { id: string; title: string; relationship: string; status: string; created_at: string };

export function EngagementsPanel({ businessId }: { businessId: string }) {
  const [rows, setRows] = useState<Eng[]>([]);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [relationship, setRelationship] = useState("prospect");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () =>
    fetch(`/api/engagements?business_id=${businessId}`)
      .then(r => r.json()).then(d => setRows(Array.isArray(d) ? d : []));
  useEffect(() => { load(); }, [businessId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function create() {
    setBusy(true); setErr(null);
    const res = await fetch("/api/engagements", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_id: businessId, relationship, title }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) { setErr(body.error ?? "Failed"); return; }
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
          <button disabled={busy || !title.trim()} onClick={create}
            className="px-3 py-1.5 text-sm rounded bg-brand-orange text-white disabled:opacity-50">
            Create room
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-brand-muted">No rooms yet.</p>
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
