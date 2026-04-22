"use client";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { formatDistanceToNow, parseISO } from "date-fns";

interface DocEntry {
  name:     string;
  path:     string;
  ext:      string;
  size:     number;
  modified: string;
  isDir:    boolean;
}

const EXT_COLORS: Record<string, string> = {
  md:   "bg-blue-50 text-blue-700",
  json: "bg-violet-50 text-violet-700",
  txt:  "bg-gray-100 text-gray-600",
  pdf:  "bg-red-50 text-red-700",
  py:   "bg-green-50 text-green-700",
  ts:   "bg-sky-50 text-sky-700",
  js:   "bg-yellow-50 text-yellow-700",
};

function extColor(ext: string) {
  return EXT_COLORS[ext] ?? "bg-gray-100 text-gray-500";
}

function formatSize(bytes: number) {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentsPage() {
  const [entries,   setEntries]   = useState<DocEntry[]>([]);
  const [root,      setRoot]      = useState("");
  const [error,     setError]     = useState<string | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState("");
  const [extFilter, setExtFilter] = useState("all");

  useEffect(() => {
    fetch("/api/documents")
      .then(r => r.json())
      .then(d => {
        if (d.error === "docs_not_found") {
          setError(d.root);
        } else {
          setRoot(d.root);
          setEntries(d.entries ?? []);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const files = entries.filter(e => !e.isDir);
  const dirs  = entries.filter(e => e.isDir);
  const exts  = Array.from(new Set(files.map(f => f.ext).filter(Boolean))).sort();

  const filtered = entries.filter(e => {
    if (search && !e.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (extFilter !== "all" && !e.isDir && e.ext !== extFilter) return false;
    return true;
  });

  if (loading) {
    return (
      <div className="p-4 md:p-8 space-y-4">
        <div className="card animate-pulse h-16" />
        <div className="card animate-pulse h-64" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 pb-24 md:pb-8 max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-brand-black">Documents</h1>
        <p className="text-sm text-brand-muted mt-0.5">
          {error
            ? "Configure DOCS_PATH to point to your docs folder"
            : `${files.length} files · ${dirs.length} folders · ${root}`}
        </p>
      </div>

      {error ? (
        <div className="card text-center py-16">
          <div className="w-12 h-12 bg-brand-offwhite rounded-xl flex items-center justify-center mx-auto mb-4">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="text-brand-muted">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <p className="text-sm font-medium text-brand-black mb-2">Directory not found</p>
          <p className="text-xs text-brand-muted max-w-sm mx-auto">
            <code className="bg-brand-offwhite px-1 rounded">{error}</code> does not exist on this server.{" "}
            Add <code className="bg-brand-offwhite px-1 rounded">DOCS_PATH=/your/path</code> to{" "}
            <code className="bg-brand-offwhite px-1 rounded">.env.local</code> to configure it.
          </p>
        </div>
      ) : (
        <>
          <div className="flex gap-2 flex-wrap">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search files…"
              className="flex-1 min-w-[180px] text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange"
            />
            <div className="flex gap-1 flex-wrap">
              <button onClick={() => setExtFilter("all")}
                className={clsx("px-2.5 py-1 rounded-full text-xs transition-colors",
                  extFilter === "all" ? "bg-brand-orange text-white" : "bg-brand-offwhite text-brand-muted hover:bg-brand-border")}>
                All
              </button>
              {exts.map(ext => (
                <button key={ext} onClick={() => setExtFilter(ext)}
                  className={clsx("px-2.5 py-1 rounded-full text-xs uppercase transition-colors",
                    extFilter === ext ? "bg-brand-orange text-white" : "bg-brand-offwhite text-brand-muted hover:bg-brand-border")}>
                  {ext}
                </button>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="card py-12 text-center">
              <p className="text-sm text-brand-muted">No files match your search</p>
            </div>
          ) : (
            <div className="card p-0 overflow-hidden">
              {filtered.map((entry, i) => (
                <div key={entry.path}
                  className={clsx(
                    "flex items-center gap-3 px-4 py-3",
                    i !== 0 && "border-t border-brand-border",
                    entry.isDir && "bg-brand-offwhite/50"
                  )}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="text-brand-muted flex-shrink-0">
                    {entry.isDir
                      ? <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                      : <><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></>}
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-brand-black font-medium truncate">{entry.name}</p>
                    <p className="text-xs text-brand-muted">{entry.path}</p>
                  </div>
                  {!entry.isDir && entry.ext && (
                    <span className={clsx("text-[10px] px-1.5 py-0.5 rounded font-medium uppercase flex-shrink-0", extColor(entry.ext))}>
                      {entry.ext}
                    </span>
                  )}
                  {!entry.isDir && (
                    <span className="text-xs text-brand-muted flex-shrink-0 hidden sm:inline">
                      {formatSize(entry.size)}
                    </span>
                  )}
                  <span className="text-xs text-brand-muted flex-shrink-0">
                    {formatDistanceToNow(parseISO(entry.modified), { addSuffix: true })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
