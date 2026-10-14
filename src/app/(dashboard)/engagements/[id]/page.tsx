"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { formatDistanceToNow } from "date-fns";

type Version = { id: string; version_no: number; status: string; change_summary: string | null; built_by_agent: string | null; created_at: string };
type Deliverable = { id: string; title: string; versions: Version[] };
type Access = { id: string; label: string | null; expires_at: string; revoked_at: string | null; last_used_at: string | null };
type Detail = { engagement: { id: string; title: string; relationship: string; status: string }; business: { name: string } | null; deliverables: Deliverable[] };

export default function EngagementPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<"deliverables" | "access">("deliverables");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [access, setAccess] = useState<Access[]>([]);
  const [newLink, setNewLink] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [brief, setBrief] = useState("");
  const [delivTitle, setDelivTitle] = useState("");
  const [delivId, setDelivId] = useState("");
  const [label, setLabel] = useState("");

  const load = useCallback(async () => {
    const [d, a] = await Promise.all([
      fetch(`/api/engagements/${id}`).then(r => r.json()),
      fetch(`/api/engagements/${id}/access`).then(r => r.json()),
    ]);
    setDetail(d.engagement ? d : null);
    setAccess(Array.isArray(a) ? a : []);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function requestPrototype() {
    setMsg(null);
    const res = await fetch(`/api/engagements/${id}/prototype-request`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent: "casey", brief,
        ...(delivId ? { deliverable_id: delivId } : { deliverable_title: delivTitle }),
      }),
    });
    const body = await res.json();
    if (!res.ok) { setMsg(body.error ?? "Failed"); return; }
    setMsg(`Work item created (${body.work_item_id}). Casey will pick it up from the inbox.`);
    setBrief(""); setDelivTitle(""); setDelivId(""); load();
  }

  async function preview(versionId: string) {
    const res = await fetch(`/api/versions/${versionId}/preview`);
    const body = await res.json();
    setPreviewUrl(res.ok ? body.url : null);
    if (!res.ok) setMsg(body.error ?? "Preview failed");
  }

  async function issue() {
    const res = await fetch(`/api/engagements/${id}/access`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: label || undefined }),
    });
    const body = await res.json();
    if (res.ok) { setNewLink(body.link); setLabel(""); load(); } else setMsg(body.error ?? "Failed");
  }

  async function revoke(accessId: string) {
    await fetch(`/api/engagements/${id}/access?access_id=${accessId}`, { method: "DELETE" });
    load();
  }

  if (!detail) return <p className="p-6 text-sm text-brand-muted">Loading…</p>;
  const { engagement, business, deliverables } = detail;

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-lg font-semibold text-brand-black">{engagement.title}</h1>
      <p className="text-sm text-brand-muted mb-4">{business?.name} · {engagement.relationship} · {engagement.status}</p>

      <div className="flex gap-4 border-b border-brand-border mb-4">
        {(["deliverables", "access"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`pb-2 text-sm capitalize ${tab === t ? "border-b-2 border-brand-orange text-brand-orange" : "text-brand-muted"}`}>
            {t}
          </button>
        ))}
      </div>

      {msg && <p className="text-sm mb-3">{msg}</p>}

      {tab === "deliverables" && (
        <div className="space-y-6">
          <div className="border border-brand-border rounded p-3 space-y-2">
            <h2 className="text-sm font-semibold">Request prototype</h2>
            <select value={delivId} onChange={e => setDelivId(e.target.value)} className="border border-brand-border rounded px-2 py-1.5 text-sm">
              <option value="">New deliverable…</option>
              {deliverables.map(d => <option key={d.id} value={d.id}>New version of: {d.title}</option>)}
            </select>
            {!delivId && (
              <input value={delivTitle} onChange={e => setDelivTitle(e.target.value)} placeholder="Deliverable title"
                className="w-full border border-brand-border rounded px-2 py-1.5 text-sm" />
            )}
            <textarea value={brief} onChange={e => setBrief(e.target.value)} rows={5} placeholder="What should the prototype show?"
              className="w-full border border-brand-border rounded px-2 py-1.5 text-sm" />
            <button disabled={!brief.trim() || (!delivId && !delivTitle.trim())} onClick={requestPrototype}
              className="px-3 py-1.5 text-sm rounded bg-brand-orange text-white disabled:opacity-50">
              Send to Casey
            </button>
          </div>

          {deliverables.map(d => (
            <div key={d.id}>
              <h3 className="text-sm font-semibold mb-1">{d.title}</h3>
              {d.versions.length === 0 ? <p className="text-sm text-brand-muted">No versions yet.</p> : (
                <ul className="divide-y divide-brand-border border border-brand-border rounded">
                  {d.versions.map(v => (
                    <li key={v.id} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span>v{v.version_no} · {v.status}{v.change_summary ? ` · ${v.change_summary}` : ""}
                        <span className="text-brand-muted"> · {formatDistanceToNow(new Date(v.created_at), { addSuffix: true })}</span>
                      </span>
                      <button onClick={() => preview(v.id)} className="text-brand-orange">Preview</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          {previewUrl && (
            <iframe src={previewUrl} sandbox="allow-scripts allow-forms" title="Prototype preview"
              className="w-full h-[70vh] border border-brand-border rounded" />
          )}
        </div>
      )}

      {tab === "access" && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Label (e.g. ED + board chair)"
              className="border border-brand-border rounded px-2 py-1.5 text-sm flex-1" />
            <button onClick={issue} className="px-3 py-1.5 text-sm rounded bg-brand-orange text-white">Create link</button>
          </div>
          {newLink && (
            <div className="border border-amber-300 bg-amber-50 rounded p-3 text-sm break-all">
              <p className="font-medium mb-1">Copy this link now — it will not be shown again.</p>
              <code>{newLink}</code>
            </div>
          )}
          <ul className="divide-y divide-brand-border border border-brand-border rounded">
            {access.map(a => (
              <li key={a.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>{a.label ?? "Unlabelled"} · expires {new Date(a.expires_at).toLocaleDateString()}
                  {a.revoked_at ? " · revoked" : ""}{a.last_used_at ? ` · last used ${formatDistanceToNow(new Date(a.last_used_at), { addSuffix: true })}` : ""}
                </span>
                {!a.revoked_at && <button onClick={() => revoke(a.id)} className="text-red-600">Revoke</button>}
              </li>
            ))}
            {access.length === 0 && <li className="px-3 py-2 text-sm text-brand-muted">No links yet.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
