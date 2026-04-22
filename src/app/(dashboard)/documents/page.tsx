"use client";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import clsx from "clsx";

interface DocEntry {
  id:          string;
  name:        string;
  path:        string;
  description?: string;
  category?:   string;
  updated_at?: string;
}

function FileIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" className="text-brand-muted flex-shrink-0">
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
      <polyline points="13 2 13 9 20 9"/>
    </svg>
  );
}

export default function DocumentsPage() {
  const [docs,         setDocs]         = useState<DocEntry[]>([]);
  const [selected,     setSelected]     = useState<DocEntry | null>(null);
  const [content,      setContent]      = useState<string | null>(null);
  const [listError,    setListError]    = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [listLoading,  setListLoading]  = useState(true);
  const [docLoading,   setDocLoading]   = useState(false);
  const [search,       setSearch]       = useState("");

  // Load doc list on mount
  useEffect(() => {
    fetch("/api/docs/list")
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          setListError(data.error);
        } else {
          setDocs(Array.isArray(data) ? data : []);
        }
        setListLoading(false);
      })
      .catch(() => {
        setListError("Could not reach Jordan agent");
        setListLoading(false);
      });
  }, []);

  // Fetch file content when a doc is selected
  async function openDoc(doc: DocEntry) {
    if (selected?.path === doc.path) return;
    setSelected(doc);
    setContent(null);
    setContentError(null);
    setDocLoading(true);
    try {
      const res = await fetch(`/api/docs?path=${encodeURIComponent(doc.path)}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        setContentError(data.error ?? "Failed to load file");
      } else {
        setContent(data.content);
      }
    } catch {
      setContentError("Network error loading file");
    }
    setDocLoading(false);
  }

  const filtered = docs.filter(d =>
    !search || d.name.toLowerCase().includes(search.toLowerCase())
  );

  const categories = Array.from(new Set(docs.map(d => d.category).filter(Boolean))).sort() as string[];

  return (
    <div className="p-4 md:p-8 pb-24 md:pb-8 max-w-6xl">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-brand-black">Documents</h1>
        <p className="text-sm text-brand-muted mt-0.5">
          {listLoading ? "Loading…" : listError ? "Failed to load document registry" : `${docs.length} document${docs.length !== 1 ? "s" : ""} available`}
        </p>
      </div>

      <div className="flex gap-4 h-[calc(100vh-14rem)]">
        {/* ── Left panel: file list ── */}
        <div className="w-72 flex-shrink-0 flex flex-col gap-2">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search docs…"
            className="text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange w-full"
          />

          <div className="card p-0 overflow-y-auto flex-1">
            {listLoading ? (
              <div className="p-4 space-y-3">
                {[1,2,3,4].map(i => (
                  <div key={i} className="animate-pulse h-10 bg-brand-offwhite rounded" />
                ))}
              </div>
            ) : listError ? (
              <div className="p-6 text-center">
                <p className="text-xs text-red-600 font-medium">{listError}</p>
                <p className="text-xs text-brand-muted mt-1">Check that Jordan is reachable and JORDAN_API_URL is set.</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center">
                <p className="text-xs text-brand-muted">No documents found</p>
              </div>
            ) : (
              <>
                {categories.length > 0
                  ? categories.map(cat => {
                      const catDocs = filtered.filter(d => d.category === cat);
                      if (catDocs.length === 0) return null;
                      return (
                        <div key={cat}>
                          <div className="px-3 pt-3 pb-1">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">{cat}</p>
                          </div>
                          {catDocs.map(doc => (
                            <DocRow key={doc.id} doc={doc} selected={selected} onSelect={openDoc} />
                          ))}
                        </div>
                      );
                    })
                  : filtered.map(doc => (
                      <DocRow key={doc.id} doc={doc} selected={selected} onSelect={openDoc} />
                    ))
                }
              </>
            )}
          </div>
        </div>

        {/* ── Right panel: content viewer ── */}
        <div className="card flex-1 overflow-hidden flex flex-col min-w-0">
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <div className="w-12 h-12 bg-brand-offwhite rounded-xl flex items-center justify-center mb-4">
                <FileIcon />
              </div>
              <p className="text-sm font-medium text-brand-black mb-1">Select a document</p>
              <p className="text-xs text-brand-muted">Choose a file from the list to view its contents</p>
            </div>
          ) : (
            <>
              <div className="px-5 py-3 border-b border-brand-border flex items-center gap-2 flex-shrink-0">
                <FileIcon />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-brand-black truncate">{selected.name}</p>
                  <p className="text-[11px] text-brand-muted truncate">{selected.path}</p>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-5">
                {docLoading ? (
                  <div className="space-y-3">
                    {[1,2,3,5,4].map(i => (
                      <div key={i} className="animate-pulse h-4 bg-brand-offwhite rounded" style={{width: `${60 + i * 8}%`}} />
                    ))}
                  </div>
                ) : contentError ? (
                  <div className="text-sm text-red-600 bg-red-50 rounded-lg p-4">{contentError}</div>
                ) : content !== null ? (
                  selected.path.endsWith(".md") ? (
                    <div className="prose prose-sm max-w-none text-brand-black
                      prose-headings:font-semibold prose-headings:text-brand-black
                      prose-a:text-brand-orange prose-a:no-underline hover:prose-a:underline
                      prose-code:bg-brand-offwhite prose-code:px-1 prose-code:rounded prose-code:text-sm
                      prose-pre:bg-brand-offwhite prose-pre:rounded-lg">
                      <ReactMarkdown>{content}</ReactMarkdown>
                    </div>
                  ) : (
                    <pre className="text-xs text-brand-black font-mono whitespace-pre-wrap break-words bg-brand-offwhite rounded-lg p-4">
                      {content}
                    </pre>
                  )
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DocRow({ doc, selected, onSelect }: {
  doc: DocEntry;
  selected: DocEntry | null;
  onSelect: (doc: DocEntry) => void;
}) {
  const isActive = selected?.path === doc.path;
  return (
    <button
      onClick={() => onSelect(doc)}
      className={clsx(
        "w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors",
        isActive
          ? "bg-brand-orange/10 border-l-2 border-brand-orange"
          : "border-l-2 border-transparent hover:bg-brand-offwhite"
      )}>
      <FileIcon />
      <div className="min-w-0 flex-1">
        <p className={clsx("text-sm truncate", isActive ? "font-medium text-brand-black" : "text-brand-black")}>
          {doc.name}
        </p>
        {doc.description && (
          <p className="text-[11px] text-brand-muted truncate">{doc.description}</p>
        )}
      </div>
    </button>
  );
}
