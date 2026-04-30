"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import clsx from "clsx";
import { formatDistanceToNow, parseISO } from "date-fns";

interface DocEntry {
  id:               string;
  name:             string;
  path:             string;
  description?:     string;
  category?:        string;
  updated_at?:      string;
  headings?:        string[];
  last_indexed_at?: string;
  chunk_count?:     number;
}

interface SearchResult {
  doc_path: string;
  doc_name: string;
  category: string;
  heading:  string | null;
  excerpt:  string;
  rank:     number;
}

// ── Utilities ────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
}

function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  return "";
}

// ── Icons ────────────────────────────────────────────────────────────────────

function FileIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" className="text-brand-muted flex-shrink-0">
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
      <polyline points="13 2 13 9 20 9"/>
    </svg>
  );
}

// ── Heading components for ReactMarkdown (adds id anchors) ────────────────────

function makeHeading(Tag: "h1" | "h2" | "h3" | "h4") {
  return function Heading({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
    const id = slugify(extractText(children as React.ReactNode));
    return <Tag id={id} {...props}>{children}</Tag>;
  };
}

const MD_COMPONENTS = {
  h1: makeHeading("h1"),
  h2: makeHeading("h2"),
  h3: makeHeading("h3"),
  h4: makeHeading("h4"),
};

// ── Sub-components ────────────────────────────────────────────────────────────

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

function DocListPanel({ docs, selected, category, onSelect }: {
  docs: DocEntry[];
  selected: DocEntry | null;
  category: string;
  onSelect: (doc: DocEntry) => void;
}) {
  const filtered = category ? docs.filter(d => d.category === category) : docs;
  const categories = useMemo(
    () => Array.from(new Set(filtered.map(d => d.category).filter(Boolean))).sort() as string[],
    [filtered]
  );

  if (filtered.length === 0) {
    return <div className="p-6 text-center"><p className="text-xs text-brand-muted">No documents found</p></div>;
  }

  return (
    <>
      {categories.length > 0
        ? categories.map(cat => {
            const catDocs = filtered.filter(d => d.category === cat);
            if (!catDocs.length) return null;
            return (
              <div key={cat}>
                <div className="px-3 pt-3 pb-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">{cat}</p>
                </div>
                {catDocs.map(doc => <DocRow key={doc.id} doc={doc} selected={selected} onSelect={onSelect} />)}
              </div>
            );
          })
        : filtered.map(doc => <DocRow key={doc.id} doc={doc} selected={selected} onSelect={onSelect} />)
      }
    </>
  );
}

function SearchResultsPanel({ results, loading, docs, selected, onSelect }: {
  results: SearchResult[] | null;
  loading: boolean;
  docs: DocEntry[];
  selected: DocEntry | null;
  onSelect: (doc: DocEntry, heading?: string) => void;
}) {
  const grouped = useMemo(() => {
    if (!results) return [];
    const map = new Map<string, { doc_name: string; chunks: SearchResult[] }>();
    for (const r of results) {
      if (!map.has(r.doc_path)) map.set(r.doc_path, { doc_name: r.doc_name, chunks: [] });
      map.get(r.doc_path)!.chunks.push(r);
    }
    return Array.from(map.entries()).map(([doc_path, v]) => ({ doc_path, ...v }));
  }, [results]);

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="animate-pulse h-16 bg-brand-offwhite rounded-lg" />)}
      </div>
    );
  }

  if (results && results.length === 0) {
    return <div className="p-6 text-center"><p className="text-xs text-brand-muted">No results found</p></div>;
  }

  return (
    <>
      {grouped.map(group => {
        const doc = docs.find(d => d.path === group.doc_path);
        return (
          <div key={group.doc_path} className="border-b border-brand-border last:border-0">
            <button
              className={clsx(
                "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-brand-offwhite transition-colors",
                selected?.path === group.doc_path && "bg-brand-orange/5"
              )}
              onClick={() => doc && onSelect(doc)}
            >
              <FileIcon size={12} />
              <p className="text-[11px] font-semibold text-brand-black truncate">{group.doc_name}</p>
            </button>
            {group.chunks.map((chunk, i) => (
              <button
                key={i}
                onClick={() => doc && onSelect(doc, chunk.heading ?? undefined)}
                className="w-full text-left px-4 py-2 hover:bg-brand-offwhite transition-colors border-t border-brand-border/50"
              >
                {chunk.heading && (
                  <p className="text-[11px] font-medium text-brand-orange truncate mb-0.5">{chunk.heading}</p>
                )}
                <p
                  className="text-[11px] text-brand-muted leading-relaxed line-clamp-2
                             [&_b]:font-semibold [&_b]:text-brand-black"
                  dangerouslySetInnerHTML={{ __html: chunk.excerpt }}
                />
              </button>
            ))}
          </div>
        );
      })}
    </>
  );
}

function TOCPanel({ headings, onClickHeading }: {
  headings: string[];
  onClickHeading: (h: string) => void;
}) {
  if (!headings.length) return null;
  return (
    <div className="w-44 flex-shrink-0 hidden xl:block">
      <div className="sticky top-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted mb-2 px-1">
          On this page
        </p>
        <div className="space-y-0.5 max-h-[calc(100vh-12rem)] overflow-y-auto">
          {headings.map(h => (
            <button
              key={h}
              onClick={() => onClickHeading(h)}
              className="w-full text-left text-[11px] text-brand-muted hover:text-brand-orange
                         px-1 py-0.5 truncate transition-colors"
            >
              {h}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DocumentsPage() {
  return (
    <Suspense fallback={<div className="p-4 md:p-8" />}>
      <DocumentsPageInner />
    </Suspense>
  );
}

function DocumentsPageInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const initialPath  = searchParams.get("path");
  const initialCat   = searchParams.get("category") ?? "";

  const [docs,          setDocs]          = useState<DocEntry[]>([]);
  const [selected,      setSelected]      = useState<DocEntry | null>(null);
  const [content,       setContent]       = useState<string | null>(null);
  const [listError,     setListError]     = useState<string | null>(null);
  const [contentError,  setContentError]  = useState<string | null>(null);
  const [listLoading,   setListLoading]   = useState(true);
  const [docLoading,    setDocLoading]    = useState(false);
  const [q,             setQ]             = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [category,      setCategory]      = useState(initialCat);

  const contentRef  = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef<string | null>(null);

  // Load doc list on mount
  useEffect(() => {
    fetch("/api/docs/list")
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          setListError(data.error);
        } else {
          const list: DocEntry[] = Array.isArray(data) ? data : [];
          setDocs(list);
          if (initialPath) {
            const match = list.find(d => d.path === initialPath);
            if (match) openDoc(match);
          }
        }
        setListLoading(false);
      })
      .catch(() => {
        setListError("Could not load document registry");
        setListLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced full-text search
  useEffect(() => {
    if (!q.trim()) {
      setSearchResults(null);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q });
        if (category) params.set("category", category);
        const res  = await fetch(`/api/docs/search?${params}`);
        const data = await res.json();
        setSearchResults(Array.isArray(data) ? data : []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [q, category]);

  // Scroll to pending heading after content renders
  useEffect(() => {
    if (!content || !pendingScroll.current) return;
    const heading = pendingScroll.current;
    pendingScroll.current = null;
    setTimeout(() => {
      const id = slugify(heading);
      const el = document.getElementById(id);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }, [content]);

  function scrollToHeading(heading: string) {
    const el = document.getElementById(slugify(heading));
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function openDoc(doc: DocEntry, heading?: string) {
    if (selected?.path === doc.path) {
      if (heading) scrollToHeading(heading);
      return;
    }
    setSelected(doc);
    setContent(null);
    setContentError(null);
    setDocLoading(true);
    if (heading) pendingScroll.current = heading;
    try {
      const res  = await fetch(`/api/docs?path=${encodeURIComponent(doc.path)}`);
      const data = await res.json();
      if (!res.ok || data.error) setContentError(data.error ?? "Failed to load file");
      else setContent(data.content);
    } catch {
      setContentError("Network error loading file");
    }
    setDocLoading(false);
  }

  function handleCategoryChange(cat: string) {
    setCategory(cat);
    const params = new URLSearchParams(searchParams.toString());
    if (cat) params.set("category", cat);
    else params.delete("category");
    router.replace(`/documents?${params}`);
  }

  const allCategories = useMemo(
    () => Array.from(new Set(docs.map(d => d.category).filter(Boolean))).sort() as string[],
    [docs]
  );

  const isSearchMode = q.trim().length > 0;
  const tocHeadings  = selected?.headings ?? [];

  return (
    <div className="p-4 md:p-8 pt-16 md:pt-8 pb-24 md:pb-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-brand-black">Documents</h1>
          <p className="text-sm text-brand-muted mt-0.5">
            {listLoading
              ? "Loading…"
              : listError
              ? "Failed to load document registry"
              : `${docs.length} document${docs.length !== 1 ? "s" : ""} available`}
          </p>
        </div>
        {allCategories.length > 0 && (
          <select
            value={category}
            onChange={e => handleCategoryChange(e.target.value)}
            className="text-sm px-3 py-1.5 border border-brand-border rounded-lg bg-white
                       text-brand-black focus:outline-none focus:border-brand-orange"
          >
            <option value="">All categories</option>
            {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {/* Content area */}
      <div className="flex gap-4" style={{ height: "calc(100vh - 14rem)" }}>

        {/* Left panel */}
        <div className="w-64 flex-shrink-0 flex flex-col gap-2">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search docs…"
            className="text-sm border border-brand-border rounded-lg px-3 py-2
                       focus:outline-none focus:border-brand-orange w-full"
          />

          <div className="card p-0 overflow-y-auto flex-1">
            {listLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="animate-pulse h-10 bg-brand-offwhite rounded" />
                ))}
              </div>
            ) : listError ? (
              <div className="p-6 text-center">
                <p className="text-xs text-red-600 font-medium">{listError}</p>
              </div>
            ) : isSearchMode ? (
              <SearchResultsPanel
                results={searchResults}
                loading={searchLoading}
                docs={docs}
                selected={selected}
                onSelect={openDoc}
              />
            ) : (
              <DocListPanel
                docs={docs}
                selected={selected}
                category={category}
                onSelect={openDoc}
              />
            )}
          </div>
        </div>

        {/* Center: content viewer */}
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
              {/* Doc header */}
              <div className="px-5 py-3 border-b border-brand-border flex items-center gap-2 flex-shrink-0 flex-wrap">
                <FileIcon />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-brand-black truncate">{selected.name}</p>
                  <p className="text-[11px] text-brand-muted truncate">{selected.path}</p>
                </div>
                {selected.last_indexed_at && (
                  <span className="text-[10px] text-brand-muted bg-brand-offwhite border border-brand-border
                                   px-2 py-0.5 rounded flex-shrink-0">
                    indexed {formatDistanceToNow(parseISO(selected.last_indexed_at), { addSuffix: true })}
                  </span>
                )}
              </div>

              {/* Doc content */}
              <div ref={contentRef} className="flex-1 overflow-y-auto p-5">
                {docLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3, 5, 4].map(i => (
                      <div key={i} className="animate-pulse h-4 bg-brand-offwhite rounded"
                           style={{ width: `${60 + i * 8}%` }} />
                    ))}
                  </div>
                ) : contentError ? (
                  <div className="text-sm text-red-600 bg-red-50 rounded-lg p-4">{contentError}</div>
                ) : content !== null ? (
                  selected.path.endsWith(".md") ? (
                    <div className="prose prose-sm max-w-none
                      prose-headings:font-semibold prose-headings:text-brand-black prose-headings:mt-6 prose-headings:mb-2
                      prose-p:text-brand-black prose-p:leading-relaxed
                      prose-a:text-brand-orange prose-a:no-underline hover:prose-a:underline
                      prose-strong:text-brand-black
                      prose-code:bg-gray-200 prose-code:text-gray-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
                      prose-pre:bg-gray-200 prose-pre:text-gray-800 prose-pre:rounded-lg prose-pre:text-xs prose-pre:border prose-pre:border-gray-300
                      prose-blockquote:border-brand-orange prose-blockquote:text-brand-muted
                      prose-table:text-sm prose-th:text-brand-black prose-td:text-brand-black
                      prose-hr:border-brand-border
                      prose-li:text-brand-black">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={MD_COMPONENTS}
                      >
                        {content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <pre className="text-xs text-brand-black font-mono whitespace-pre-wrap break-words
                                    bg-brand-offwhite rounded-lg p-4">
                      {content}
                    </pre>
                  )
                ) : null}
              </div>
            </>
          )}
        </div>

        {/* Right: TOC */}
        {selected && <TOCPanel headings={tocHeadings} onClickHeading={scrollToHeading} />}
      </div>
    </div>
  );
}
