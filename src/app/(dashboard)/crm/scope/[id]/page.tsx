"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import clsx from "clsx";
import { fetchJson } from "@/lib/fetch-json";
import { Button, EmptyState, ErrorState, LoadingState, PageHeader, Tabs } from "@/components/ui";
import { SamMarkdown } from "@/components/SamMarkdown";
import { diffSections } from "@/lib/crm/scope-diff";
import { clientView, type ScopeSection } from "@/lib/crm/scope-client-view";

type Version = {
  id: string; version_no: number; sections: ScopeSection[]; status: "current" | "proposed" | "rejected" | "superseded";
  source: string; change_note: string | null; created_by: string | null; created_at: string; based_on_version_id: string | null;
};
type Doc = { id: string; title: string; current_version_id: string | null; engagement_type: string | null; delivery_model: string | null };
type Tab = "edit" | "client" | "history";

function DiffView({ prev, next }: { prev: ScopeSection[] | null; next: ScopeSection[] }) {
  const diffs = diffSections(prev, next).filter((d) => d.status !== "unchanged");
  if (diffs.length === 0) return <p className="text-xs text-brand-muted">No changes to section text.</p>;
  return (
    <div className="space-y-3">
      {diffs.map((d) => (
        <div key={d.key} className="border border-brand-border rounded-lg">
          <div className="px-3 py-1.5 text-xs font-medium bg-brand-cream rounded-t-lg">{d.title || d.key} <span className="text-brand-muted">({d.status})</span></div>
          <pre className="text-xs p-2 whitespace-pre-wrap font-mono">
            {d.lines.map((l, i) => (
              <div key={i} className={clsx(l.type === "add" && "bg-green-100 text-green-900", l.type === "del" && "bg-red-100 text-red-900")}>
                {l.type === "add" ? "+ " : l.type === "del" ? "- " : "  "}{l.text}
              </div>
            ))}
          </pre>
        </div>
      ))}
    </div>
  );
}

export default function ScopePage() {
  const { id } = useParams<{ id: string }>();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("edit");
  const [draft, setDraft] = useState<ScopeSection[]>([]);
  const [note, setNote] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [rejectNote, setRejectNote] = useState<Record<string, string>>({});
  const [openVersion, setOpenVersion] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetchJson<{ document: Doc; versions: Version[] }>(`/api/crm/scope/${id}`);
    if (!r.ok) { setLoadError(r.error); setLoading(false); return; }
    setDoc(r.data.document);
    setVersions(r.data.versions);
    const cur = r.data.versions.find((v) => v.id === r.data.document.current_version_id);
    setDraft(cur?.sections ?? []);
    setDirty(false);
    setLoadError(null);
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-4 md:p-8"><LoadingState /></div>;
  if (loadError || !doc) return <div className="p-4 md:p-8"><ErrorState message={loadError ?? "Not found"} onRetry={load} /></div>;

  const current = versions.find((v) => v.id === doc.current_version_id) ?? null;
  const proposals = versions.filter((v) => v.status === "proposed");
  const prevOf = (v: Version) => versions.filter((x) => x.version_no < v.version_no).sort((a, b) => b.version_no - a.version_no)[0] ?? null;

  const update = (i: number, patch: Partial<ScopeSection>) => {
    setDraft((d) => d.map((s, j) => (j === i ? { ...s, ...patch } : s)));
    setDirty(true);
  };

  async function save() {
    setBusy("save"); setError("");
    const r = await fetchJson(`/api/crm/scope/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sections: draft, change_note: note || undefined }),
    });
    setBusy("");
    if (!r.ok) { setError(r.error); return; }
    setNote("");
    await load();
  }

  async function decide(v: Version, decision: "accept" | "reject") {
    setBusy(v.id); setError("");
    const r = await fetchJson(`/api/crm/scope/versions/${v.id}/decide`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, note: decision === "reject" ? rejectNote[v.id] || undefined : undefined }),
    });
    setBusy("");
    if (!r.ok) setError(r.error);
    await load();
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl pb-24 md:pb-8">
      <PageHeader
        title={doc.title}
        description={[current ? `v${current.version_no}` : "no current version", doc.engagement_type, doc.delivery_model].filter(Boolean).join(" · ")}
      />
      {error && <ErrorState message={error} className="mb-3" />}

      {proposals.length > 0 && (
        <div className="card mb-4 border-brand-orange">
          <h2 className="text-sm font-semibold mb-2">Pending proposals ({proposals.length})</h2>
          {proposals.map((v) => {
            const stale = v.based_on_version_id !== doc.current_version_id;
            return (
              <div key={v.id} className="mb-4 last:mb-0">
                <p className="text-xs text-brand-muted mb-1">
                  v{v.version_no} from {v.source}{v.created_by ? ` (${v.created_by})` : ""} · {new Date(v.created_at).toLocaleString()}
                  {stale && <span className="badge badge-error ml-2">Stale</span>}
                </p>
                {v.change_note && <p className="text-sm mb-2">{v.change_note}</p>}
                <DiffView prev={current?.sections ?? null} next={v.sections} />
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <Button size="sm" disabled={busy === v.id || stale} onClick={() => decide(v, "accept")}>Accept</Button>
                  <input
                    className="input text-xs flex-1 min-w-40" placeholder="Reason (optional)"
                    value={rejectNote[v.id] ?? ""} onChange={(e) => setRejectNote({ ...rejectNote, [v.id]: e.target.value })}
                  />
                  <Button size="sm" variant="danger" disabled={busy === v.id} onClick={() => decide(v, "reject")}>Reject</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Tabs
        tabs={[{ id: "edit", label: "Edit" }, { id: "client", label: "Client view" }, { id: "history", label: `History (${versions.length})` }] as const}
        value={tab}
        onChange={setTab}
      />

      {tab === "edit" && (
        <div className="space-y-4 mt-4">
          {draft.length === 0 && <EmptyState title="No sections yet" />}
          {draft.map((s, i) => (
            <div key={i} className="card">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <input className="input flex-1 min-w-40 font-medium" value={s.title} aria-label="Section title"
                  onChange={(e) => update(i, { title: e.target.value })} />
                <select className="input w-auto text-xs" value={s.visibility} aria-label="Visibility"
                  onChange={(e) => update(i, { visibility: e.target.value as ScopeSection["visibility"] })}>
                  <option value="client">Client sees</option>
                  <option value="internal">Internal only</option>
                </select>
                <Button size="sm" variant="ghost" onClick={() => { setDraft(draft.filter((_, j) => j !== i)); setDirty(true); }}>Remove</Button>
              </div>
              <textarea className="input w-full font-mono text-xs" rows={8} value={s.body_md} aria-label="Section body (Markdown)"
                onChange={(e) => update(i, { body_md: e.target.value })} />
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={() => {
            const n = draft.length + 1;
            setDraft([...draft, { key: `section-${Date.now().toString(36)}`, title: `Section ${n}`, body_md: "", visibility: "internal" }]);
            setDirty(true);
          }}>Add section</Button>
          <div className="flex items-center gap-2 flex-wrap">
            <input className="input flex-1 min-w-48" placeholder="What changed? (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button disabled={!dirty || busy === "save"} onClick={save}>{busy === "save" ? "Saving…" : "Save as new version"}</Button>
          </div>
        </div>
      )}

      {tab === "client" && (
        <div className="card mt-4">
          <p className="text-xs text-brand-muted mb-3">Preview of the client-visible sections{dirty ? " (including unsaved edits)" : ""}. Nothing is published.</p>
          {clientView(draft).length === 0 ? <p className="text-sm text-brand-muted">No client-visible sections.</p> :
            clientView(draft).map((s) => (
              <section key={s.key} className="mb-5">
                <h2 className="text-base font-semibold mb-1">{s.title}</h2>
                <SamMarkdown content={s.body_md} />
              </section>
            ))}
        </div>
      )}

      {tab === "history" && (
        <div className="space-y-2 mt-4">
          {versions.map((v) => (
            <div key={v.id} className="card">
              <button className="w-full text-left flex items-center gap-2 flex-wrap" onClick={() => setOpenVersion(openVersion === v.id ? null : v.id)}>
                <span className="font-medium text-sm">v{v.version_no}</span>
                <span className="badge badge-neutral">{v.status}</span>
                <span className="text-xs text-brand-muted">{v.source}{v.created_by ? ` · ${v.created_by}` : ""} · {new Date(v.created_at).toLocaleString()}</span>
              </button>
              {v.change_note && <p className="text-xs mt-1 whitespace-pre-line">{v.change_note}</p>}
              {openVersion === v.id && <div className="mt-2"><DiffView prev={prevOf(v)?.sections ?? null} next={v.sections} /></div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
