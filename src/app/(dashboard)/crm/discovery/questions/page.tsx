"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { DiscoveryNav } from "@/components/crm/discovery/DiscoveryNav";
import { EMPTY_QUESTION, INPUT, QuestionDraft, QuestionForm, TYPE_LABEL } from "@/components/crm/discovery/QuestionForm";
import { fetchJson } from "@/lib/fetch-json";
import { Button, EmptyState, ErrorState, LoadingState, Modal, PageHeader } from "@/components/ui";
import { DiscoveryQuestion } from "@/types";
import { questionSearchText } from "@/lib/discovery/bank";

function toDraft(q: DiscoveryQuestion): QuestionDraft {
  return { label: q.label, help: q.help ?? "", type: q.type, required: q.required, options: q.options ?? [], config: q.config ?? {}, section: q.section };
}

export default function QuestionBankPage() {
  const [rows, setRows] = useState<DiscoveryQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<DiscoveryQuestion | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    fetchJson<unknown>(`/api/crm/discovery/questions${showArchived ? "?archived=1" : ""}`).then(r => {
      if (r.ok) { setRows(Array.isArray(r.data) ? r.data : []); setLoadError(null); }
      else setLoadError(r.error);
      setLoading(false);
    });
  }, [showArchived]);
  useEffect(load, [load]);

  const sections = useMemo(() => [...new Set(rows.map(r => r.section))], [rows]);
  const grouped = useMemo(() => {
    const term = search.trim().toLowerCase();
    const hits = term ? rows.filter(r => questionSearchText(r).includes(term)) : rows;
    const map = new Map<string, DiscoveryQuestion[]>();
    for (const r of hits) map.set(r.section, [...(map.get(r.section) ?? []), r]);
    return [...map.entries()];
  }, [rows, search]);

  async function save(q: QuestionDraft) {
    setBusy(true); setError("");
    const isNew = editing === "new";
    const res = await fetch(isNew ? "/api/crm/discovery/questions" : `/api/crm/discovery/questions/${(editing as DiscoveryQuestion).id}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...q, help: q.help || null, options: q.options.length ? q.options : null }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(data.error ?? "Could not save"); return; }
    setEditing(null);
    load();
  }

  async function archive(q: DiscoveryQuestion) {
    const res = await fetch(`/api/crm/discovery/questions/${q.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archived: !q.archived_at }),
    });
    if (res.ok) load();
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl pb-24 md:pb-8">
      <PageHeader
        title="Question bank"
        description={`Reusable questions for templates and drafts · ${rows.filter(r => !r.archived_at).length} active`}
        actions={<Button onClick={() => { setError(""); setEditing("new"); }}>+ New question</Button>}
      />
      <DiscoveryNav />

      <div className="flex gap-3 items-center mb-4 flex-wrap">
        <input className={clsx(INPUT, "max-w-sm")} placeholder="Search questions…" value={search} onChange={e => setSearch(e.target.value)} />
        <label className="flex items-center gap-2 text-xs text-brand-muted">
          <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> Show archived
        </label>
      </div>

      {loadError && <ErrorState message={`Couldn't load the question bank: ${loadError}`} onRetry={load} className="mb-4" />}
      {loading ? <LoadingState /> : grouped.length === 0 ? (
        loadError ? null : <EmptyState title={rows.length ? "No questions match." : "The bank is empty."} />
      ) : (
        <div className="space-y-4">
          {grouped.map(([section, qs]) => (
            <div key={section} className="card p-0 overflow-hidden">
              <h2 className="text-xs font-semibold text-brand-muted uppercase tracking-wide px-4 pt-3 pb-2">{section}</h2>
              {qs.map(q => (
                <div key={q.id} className={clsx("flex items-start gap-3 px-4 py-3 border-t border-brand-border", q.archived_at && "opacity-50")}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-brand-black">{q.label}{q.required && <span className="text-brand-orange ml-1">*</span>}</p>
                    <p className="text-xs text-brand-muted mt-0.5">
                      <span className="font-mono">{q.key}</span>
                      {q.options?.length ? ` · ${q.options.slice(0, 4).join(", ")}${q.options.length > 4 ? "…" : ""}` : ""}
                    </p>
                  </div>
                  <span className="badge badge-neutral text-xs whitespace-nowrap">{TYPE_LABEL[q.type] ?? q.type}</span>
                  <Button variant="ghost" size="sm" onClick={() => { setError(""); setEditing(q); }}>Edit</Button>
                  <Button variant="ghost" size="sm" onClick={() => archive(q)}>{q.archived_at ? "Restore" : "Archive"}</Button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <Modal open size="lg" title={editing === "new" ? "New question" : "Edit question"} onClose={() => setEditing(null)}>
          {editing !== "new" && (
            <p className="text-xs text-brand-muted mb-4">
              Changes apply to templates and new drafts. Questionnaires already sent keep the wording they were sent with.
            </p>
          )}
          <QuestionForm
            initial={editing === "new" ? { ...EMPTY_QUESTION, section: "General" } : toDraft(editing)}
            sections={sections}
            submitLabel={editing === "new" ? "Add to bank" : "Save"}
            busy={busy}
            error={error}
            onSubmit={save}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}
    </div>
  );
}
