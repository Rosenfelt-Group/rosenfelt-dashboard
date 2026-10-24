"use client";
// Engagement → Scope: status, client view and proposal decisions inline; section editing opens /crm/scope/[id].
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { fetchJson } from "@/lib/fetch-json";
import { diffSections } from "@/lib/crm/scope-diff";
import { clientView, type ScopeSection } from "@/lib/crm/scope-client-view";
import type { ScopeSummary } from "@/lib/crm/org-engagement";
import { SamMarkdown } from "@/components/SamMarkdown";
import { Button, ErrorState, LoadingState } from "@/components/ui";

type Version = {
  id: string; version_no: number; sections: ScopeSection[]; status: "current" | "proposed" | "rejected" | "superseded";
  source: string; change_note: string | null; created_by: string | null; created_at: string; based_on_version_id: string | null;
};
type Doc = { id: string; title: string; current_version_id: string | null; engagement_type: string | null; delivery_model: string | null };

function CompactDiff({ prev, next }: { prev: ScopeSection[] | null; next: ScopeSection[] }) {
  const diffs = useMemo(() => diffSections(prev, next).filter((d) => d.status !== "unchanged"), [prev, next]);
  if (diffs.length === 0) return <p className="text-xs text-brand-muted">No changes to section text.</p>;
  return (
    <div className="space-y-2 max-h-80 overflow-y-auto">
      {diffs.map((d) => (
        <div key={d.key} className="border border-brand-border rounded">
          <div className="px-2 py-1 text-xs font-medium bg-brand-cream">{d.title || d.key} <span className="text-brand-muted">({d.status})</span></div>
          {d.tooLarge ? <p className="text-xs px-2 py-1 text-brand-muted">Section too large to diff line by line</p> : (
            <pre className="text-xs p-2 whitespace-pre-wrap font-mono">
              {d.lines.filter((l) => l.type !== "same").map((l, i) => (
                <div key={i} className={clsx(l.type === "add" ? "bg-green-100 text-green-900" : "bg-red-100 text-red-900")}>
                  {l.type === "add" ? "+ " : "- "}{l.text}
                </div>
              ))}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * `researchSlot` renders under the scope (stream R's ScopeResearchInputs). It is a render prop so this
 * component doesn't depend on that one.
 */
export function ScopeStep({ scope, hasBrief, onChanged, researchSlot }: {
  scope: ScopeSummary | null; hasBrief: boolean; onChanged: () => void;
  researchSlot?: (scopeId: string) => React.ReactNode;
}) {
  if (!scope) {
    return (
      <div className="card space-y-2">
        <h3 className="text-sm font-semibold text-brand-black">Scope</h3>
        <p className="text-sm text-brand-muted">
          {hasBrief
            ? "The first scope version is drafted from the discovery brief. It appears here once Riley has written it."
            : "The scope is drafted from the discovery brief once the questionnaire is submitted and the brief is generated."}
        </p>
      </div>
    );
  }
  return <ScopeCard key={scope.id} scopeId={scope.id} onChanged={onChanged} researchSlot={researchSlot} />;
}

function ScopeCard({ scopeId, onChanged, researchSlot }: { scopeId: string; onChanged: () => void; researchSlot?: (scopeId: string) => React.ReactNode }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [showClient, setShowClient] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [rejectNote, setRejectNote] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const r = await fetchJson<{ document: Doc; versions: Version[] }>(`/api/crm/scope/${scopeId}`);
    if (!r.ok) { setLoadErr(r.error); return; }
    setDoc(r.data.document);
    setVersions(r.data.versions);
    setLoadErr(null);
  }, [scopeId]);
  useEffect(() => { load(); }, [load]);

  async function decide(v: Version, decision: "accept" | "reject") {
    setBusy(v.id); setError("");
    const r = await fetchJson(`/api/crm/scope/versions/${v.id}/decide`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, note: decision === "reject" ? rejectNote[v.id] || undefined : undefined }),
    });
    setBusy("");
    if (!r.ok) setError(r.error);
    await load();
    onChanged();
  }

  if (loadErr) return <div className="card"><ErrorState message={`Couldn't load the scope: ${loadErr}`} onRetry={load} /></div>;
  if (!doc) return <div className="card"><LoadingState rows={2} /></div>;

  const current = versions.find((v) => v.id === doc.current_version_id) ?? null;
  const proposals = versions.filter((v) => v.status === "proposed");
  const sections = current?.sections ?? [];
  const visible = clientView(sections);

  return (
    <div className="card space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-brand-black">Scope: {doc.title}</h3>
          <p className="text-xs text-brand-muted">
            {[current ? `v${current.version_no} current` : "no current version", doc.engagement_type?.replace("_", " "), doc.delivery_model].filter(Boolean).join(" · ")}
          </p>
        </div>
        <span className="flex items-center gap-2 flex-wrap">
          {proposals.length > 0 && <span className="badge badge-warning text-xs">{proposals.length} proposal{proposals.length === 1 ? "" : "s"} pending</span>}
          <Button size="sm" variant="secondary" onClick={() => setShowClient((s) => !s)}>{showClient ? "Hide client view" : "Client view"}</Button>
          <Link href={`/crm/scope/${doc.id}`} className="btn-ghost text-xs px-3 py-1.5">Edit sections →</Link>
        </span>
      </div>

      {sections.length > 0 && (
        <p className="text-xs text-brand-muted">
          Sections: {sections.map((s) => s.title).join(" · ")}
          <span className="ml-1">({visible.length} visible to the client)</span>
        </p>
      )}

      {proposals.map((v) => {
        const stale = v.based_on_version_id !== doc.current_version_id;
        return (
          <div key={v.id} className="border border-brand-orange rounded-lg p-3 space-y-2">
            <p className="text-xs text-brand-muted">
              v{v.version_no} proposed by {v.created_by ?? v.source} · {new Date(v.created_at).toLocaleString()}
              {stale && <span className="badge badge-error ml-2">Stale</span>}
            </p>
            {v.change_note && <p className="text-sm">{v.change_note}</p>}
            <CompactDiff prev={current?.sections ?? null} next={v.sections} />
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" disabled={busy === v.id || stale} onClick={() => decide(v, "accept")}>Accept</Button>
              <input className="input text-xs flex-1 min-w-40" placeholder="Reason (optional)" aria-label="Reason for rejecting"
                value={rejectNote[v.id] ?? ""} onChange={(e) => setRejectNote({ ...rejectNote, [v.id]: e.target.value })} />
              <Button size="sm" variant="danger" disabled={busy === v.id} onClick={() => decide(v, "reject")}>Reject</Button>
            </div>
          </div>
        );
      })}

      {showClient && (
        <div className="border border-brand-border rounded-lg p-3 max-h-[32rem] overflow-y-auto">
          <p className="text-xs text-brand-muted mb-2">What the client sees from the current version. Nothing is published from here.</p>
          {visible.length === 0 ? <p className="text-sm text-brand-muted">No client-visible sections.</p> : visible.map((s) => (
            <section key={s.key} className="mb-4">
              <h4 className="text-sm font-semibold mb-1">{s.title}</h4>
              <SamMarkdown content={s.body_md} />
            </section>
          ))}
        </div>
      )}

      {researchSlot?.(doc.id)}
      {error && <ErrorState message={error} />}
    </div>
  );
}
