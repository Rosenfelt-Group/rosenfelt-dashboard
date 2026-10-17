"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";
import { DiscoveryNav } from "@/components/crm/discovery/DiscoveryNav";
import { INPUT, LABEL } from "@/components/crm/discovery/QuestionForm";
import { fetchJson } from "@/lib/fetch-json";
import { Button, EmptyState, ErrorState, LoadingState, Modal, PageHeader } from "@/components/ui";
import { DiscoveryTemplate } from "@/types";

export default function TemplatesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<DiscoveryTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    fetchJson<unknown>(`/api/crm/discovery/templates${showArchived ? "?archived=1" : ""}`).then(r => {
      if (r.ok) { setRows(Array.isArray(r.data) ? r.data : []); setLoadError(null); }
      else setLoadError(r.error);
      setLoading(false);
    });
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
      <PageHeader
        title="Templates"
        description="Starting points for new discovery questionnaires"
        actions={<Button onClick={() => { setName(""); setCopyFrom(""); setError(""); setCreating(true); }}>+ New template</Button>}
      />
      <DiscoveryNav />

      <label className="flex items-center gap-2 text-xs text-brand-muted mb-4">
        <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> Show archived
      </label>

      {loadError && <ErrorState message={`Couldn't load templates: ${loadError}`} onRetry={load} className="mb-4" />}
      {loading ? <LoadingState /> : rows.length === 0 ? (
        loadError ? null : <EmptyState title="No templates yet." />
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

      <Modal
        open={creating}
        title="New template"
        onClose={() => setCreating(false)}
        size="lg"
        footer={
          <>
            <Button variant="ghost" className="flex-1" onClick={() => setCreating(false)}>Cancel</Button>
            <Button className="flex-1" onClick={create} disabled={!name.trim() || busy}>
              {busy ? "Creating…" : "Create"}
            </Button>
          </>
        }
      >
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
        </div>
      </Modal>
    </div>
  );
}
