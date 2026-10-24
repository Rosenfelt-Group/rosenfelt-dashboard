"use client";
import { useState } from "react";
import Link from "next/link";
import { fetchJson } from "@/lib/fetch-json";
import type { LibraryBrief } from "@/lib/research/types";
import { Button, ErrorState, LoadingState } from "@/components/ui";
import { UseInScope } from "./UseInScope";
import { fmtDate, itemSource, TYPE_LABEL, useOrgResearch } from "./useOrgResearch";

/**
 * An organization's Research tab: Avery's research and Brian's notes ("About this organization"), plus the
 * library briefs linked to it. Each item has a "Use in scope" tick; nothing is ticked by default.
 */
export function OrgResearchTab({ businessId }: { businessId: string }) {
  const { data, loadError, saveError, load, toggle } = useOrgResearch(businessId);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [running, setRunning] = useState(false);
  const [runErr, setRunErr] = useState<string | null>(null);

  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteErr, setNoteErr] = useState<string | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [library, setLibrary] = useState<LibraryBrief[] | null>(null);
  const [libErr, setLibErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [linkErr, setLinkErr] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState<string | null>(null);

  async function runResearch() {
    if (running) return;
    setRunning(true); setRunErr(null);
    const r = await fetchJson("/api/research/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_id: businessId }),
    });
    setRunning(false);
    if (!r.ok) { setRunErr(r.error); return; }
    load();
  }

  async function saveNote() {
    const note = noteText.trim();
    if (!note || noteBusy) return;
    setNoteBusy(true); setNoteErr(null);
    const r = await fetchJson(`/api/crm/businesses/${businessId}/research`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }),
    });
    setNoteBusy(false);
    if (!r.ok) { setNoteErr(r.error); return; }
    setNoteText(""); setNoteOpen(false); load();
  }

  async function openPicker() {
    setPickerOpen(o => !o);
    if (library) return;
    const r = await fetchJson<LibraryBrief[]>("/api/research/briefs");
    if (r.ok) setLibrary(Array.isArray(r.data) ? r.data : []);
    else setLibErr(r.error);
  }

  async function setLink(briefId: string, link: boolean) {
    setLinkBusy(briefId); setLinkErr(null);
    const r = await fetchJson(`/api/research/briefs/${briefId}/links`, {
      method: link ? "POST" : "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_id: businessId }),
    });
    setLinkBusy(null);
    if (!r.ok) { setLinkErr(r.error); return; }
    setLibrary(null);
    if (link) setPickerOpen(false);
    load();
  }

  if (loadError) return <ErrorState message={`Couldn't load research: ${loadError}`} onRetry={load} />;
  if (!data) return <LoadingState />;

  const linkedIds = new Set(data.briefs.map(b => b.id));
  const q = query.trim().toLowerCase();
  const candidates = (library ?? [])
    .filter(b => b.research_type !== "business" && !linkedIds.has(b.id))
    .filter(b => !q || b.topic.toLowerCase().includes(q));

  const toggleExpand = (id: string) => setExpanded(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  return (
    <div className="space-y-4">
      {saveError && <p className="text-xs text-red-700">Couldn&apos;t save: {saveError}</p>}

      <div className="card">
        <h2 className="text-sm font-medium text-brand-black">About this organization</h2>
        <p className="text-xs text-brand-muted mt-1 mb-3">Avery&apos;s research and your own notes: website, Form 990, the tools they use, news.</p>
        {data.notes.length === 0 ? (
          <p className="text-xs text-brand-muted">No research yet.</p>
        ) : (
          <ul className="divide-y divide-brand-border">
            {data.notes.map(n => {
              const open = expanded.has(n.id);
              return (
                <li key={n.id} className="py-2.5 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <button type="button" onClick={() => toggleExpand(n.id)}
                      className={`text-left text-sm text-brand-black whitespace-pre-line ${open ? "" : "line-clamp-3"}`}>
                      {n.summary || "(empty note)"}
                    </button>
                    <p className="text-xs text-brand-muted mt-0.5">
                      {itemSource(n)}
                      {typeof n.details?.storage_path === "string" && n.details.storage_path && (
                        <> · <a href={`/documents?path=${encodeURIComponent(n.details.storage_path)}`} target="_blank" rel="noreferrer"
                          className="text-brand-orange hover:underline">Full report</a></>
                      )}
                    </p>
                  </div>
                  <UseInScope checked={n.selected} onChange={v => toggle("note", n.id, v)} />
                </li>
              );
            })}
          </ul>
        )}

        {noteOpen && (
          <div className="mt-3 space-y-2">
            <textarea value={noteText} onChange={e => setNoteText(e.target.value)} rows={3} maxLength={10000}
              placeholder="e.g. Board wants parent text reminders before fall"
              className="w-full px-3 py-2 text-sm border border-brand-border rounded-lg focus:outline-none focus:border-brand-orange" />
            {noteErr && <p className="text-xs text-red-700">{noteErr}</p>}
            <div className="flex gap-2">
              <Button size="sm" onClick={saveNote} disabled={noteBusy || !noteText.trim()}>{noteBusy ? "Saving…" : "Save note"}</Button>
              <Button size="sm" variant="ghost" onClick={() => { setNoteOpen(false); setNoteErr(null); }}>Cancel</Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 mt-3">
          <Button size="sm" onClick={runResearch} disabled={running}>
            {running ? "Running… (up to ~30s)" : "Run research on this organization"}
          </Button>
          {!noteOpen && <Button size="sm" variant="secondary" onClick={() => setNoteOpen(true)}>+ Add note</Button>}
        </div>
        {runErr && <p className="text-xs text-red-700 mt-2">{runErr}</p>}
      </div>

      <div className="card">
        <h2 className="text-sm font-medium text-brand-black">
          From the research library <span className="text-xs font-normal text-brand-muted">{data.briefs.length} linked</span>
        </h2>
        <p className="text-xs text-brand-muted mt-1 mb-3">Market research on products, competitors and trends that applies to this organization.</p>
        {data.briefs.length === 0 ? (
          <p className="text-xs text-brand-muted">Nothing linked yet.</p>
        ) : (
          <ul className="divide-y divide-brand-border">
            {data.briefs.map(b => (
              <li key={b.id} className="py-2.5 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-brand-black">{b.topic}</p>
                  <p className="text-xs text-brand-muted mt-0.5">
                    {[TYPE_LABEL[b.research_type] ?? b.research_type, fmtDate(b.created_at)].filter(Boolean).join(" · ")}
                    {b.storage_path && (
                      <> · <a href={`/documents?path=${encodeURIComponent(b.storage_path)}`} target="_blank" rel="noreferrer"
                        className="text-brand-orange hover:underline">Open</a></>
                    )}
                  </p>
                </div>
                <UseInScope checked={b.selected} onChange={v => toggle("brief", b.id, v)} />
                <Button size="sm" variant="ghost" disabled={linkBusy === b.id} onClick={() => setLink(b.id, false)}>Unlink</Button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-3 mt-3">
          <Button size="sm" variant="secondary" onClick={openPicker}>{pickerOpen ? "Close" : "+ Link a library brief"}</Button>
          <Link href="/content/research" className="text-xs text-brand-orange hover:underline">Open the library →</Link>
        </div>
        {linkErr && <p className="text-xs text-red-700 mt-2">{linkErr}</p>}

        {pickerOpen && (
          <div className="mt-3 border border-brand-border rounded-lg p-3 space-y-2">
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search the library…" autoFocus
              className="w-full px-3 py-1.5 text-sm border border-brand-border rounded-lg focus:outline-none focus:border-brand-orange" />
            {libErr ? (
              <p className="text-xs text-red-700">{libErr}</p>
            ) : !library ? (
              <p className="text-xs text-brand-muted">Loading…</p>
            ) : candidates.length === 0 ? (
              <p className="text-xs text-brand-muted">{q ? "No matching briefs." : "Everything is already linked."}</p>
            ) : (
              <ul className="max-h-64 overflow-y-auto divide-y divide-brand-border">
                {candidates.map(b => (
                  <li key={b.id}>
                    <button type="button" disabled={linkBusy === b.id} onClick={() => setLink(b.id, true)}
                      className="w-full text-left px-2 py-2 text-sm hover:bg-brand-offwhite disabled:opacity-50">
                      {b.topic}
                      <span className="block text-xs text-brand-muted">
                        {[TYPE_LABEL[b.research_type ?? ""] ?? b.research_type, fmtDate(b.created_at)].filter(Boolean).join(" · ")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <p className="text-xs text-brand-muted">Riley only gets the checked items when drafting the scope or proposing changes. Nothing is checked by default.</p>
    </div>
  );
}
