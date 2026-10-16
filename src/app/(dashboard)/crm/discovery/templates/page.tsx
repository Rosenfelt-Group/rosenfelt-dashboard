"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";
import { CRMNav } from "@/components/CRMNav";
import { DiscoveryNav } from "@/components/crm/discovery/DiscoveryNav";
import { INPUT, LABEL, Modal } from "@/components/crm/discovery/QuestionForm";
import { DiscoveryTemplate } from "@/types";

export default function TemplatesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<DiscoveryTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    fetch(`/api/crm/discovery/templates${showArchived ? "?archived=1" : ""}`).then(r => r.json())
      .then(d => { setRows(Array.isArray(d) ? d : []); setLoading(false); });
  }, [showArchived]);
  useEffect(load, [load]);

  async function create() {
    setBusy(true); setError("");
    const res = await fetch("/api/crm/discovery/templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, duplicate_of: copyFrom || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(data.error ?? "Could not create"); return; }
    router.push(`/crm/discovery/templates/${data.id}`);
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl pb-24 md:pb-8">
      <CRMNav />
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-brand-black">Templates</h1>
          <p className="text-sm text-brand-muted">Starting points for new discovery questionnaires</p>
        </div>
        <button onClick={() => { setName(""); setCopyFrom(""); setError(""); setCreating(true); }} className="btn-primary text-sm">+ New template</button>
      </div>
      <DiscoveryNav />

      <label className="flex items-center gap-2 text-xs text-brand-muted mb-4">
        <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> Show archived
      </label>

      {loading ? <div className="card animate-pulse h-40" /> : rows.length === 0 ? (
        <div className="card text-sm text-brand-muted">No templates yet.</div>
      ) : (
        <div className="card p-0 overflow-hidden">
          {rows.map(t => (
            <Link key={t.id} href={`/crm/discovery/templates/${t.id}`}
              className={clsx("flex items-center gap-3 px-4 py-3 border-b border-brand-border last:border-b-0 hover:bg-brand-offwhite", t.archived_at && "opacity-50")}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-brand-black truncate">{t.name}</p>
                <p className="text-xs text-brand-muted truncate">{t.description || "—"}</p>
              </div>
              {t.is_default && <span className="badge badge-success text-xs">Default</span>}
              {t.archived_at && <span className="badge badge-neutral text-xs">Archived</span>}
              <span className="text-xs text-brand-muted w-24 text-right">{t.item_count ?? 0} questions</span>
              <span className="hidden sm:block text-xs text-brand-muted w-28 text-right">{formatDistanceToNow(new Date(t.updated_at), { addSuffix: true })}</span>
            </Link>
          ))}
        </div>
      )}

      {creating && (
        <Modal title="New template" onClose={() => setCreating(false)}>
          <div className="space-y-4">
            <div>
              <label className={LABEL}>Name *</label>
              <input className={INPUT} value={name} onChange={e => setName(e.target.value)} autoFocus />
            </div>
            <div>
              <label className={LABEL}>Start from</label>
              <select className={INPUT} value={copyFrom} onChange={e => setCopyFrom(e.target.value)}>
                <option value="">Blank template</option>
                {rows.filter(t => !t.archived_at).map(t => <option key={t.id} value={t.id}>Copy of {t.name}</option>)}
              </select>
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2 pt-2">
              <button onClick={() => setCreating(false)} className="btn-ghost flex-1">Cancel</button>
              <button onClick={create} disabled={!name.trim() || busy} className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed">
                {busy ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
