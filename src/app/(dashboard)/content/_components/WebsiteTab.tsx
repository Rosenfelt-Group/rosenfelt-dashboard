"use client";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { formatDistanceToNow, parseISO } from "date-fns";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui";

type WpEntry = {
  id: number; title: string; status: string;
  type: "page" | "post"; url: string; editUrl: string; modified: string;
};

const WP_STATUS_STYLES: Record<string, string> = {
  publish: "bg-green-50 text-green-700",
  draft:   "bg-amber-50 text-amber-700",
  private: "bg-blue-50 text-blue-700",
};

export function WebsiteTab() {
  const [pages,        setPages]        = useState<WpEntry[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(false);
  const [typeFilter,   setTypeFilter]   = useState<"all" | "page" | "post">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "publish" | "draft">("all");

  useEffect(() => {
    fetch("/api/wordpress/pages")
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => { setPages(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  if (loading) return <LoadingState />;
  if (error)   return (
    <ErrorState
      message={<><span className="font-medium">Could not load pages</span> · WordPress connection failed.</>}
    />
  );

  const published = pages.filter(p => p.status === "publish").length;
  const drafts    = pages.filter(p => p.status === "draft").length;
  const filtered  = pages
    .filter(p => typeFilter   === "all" || p.type   === typeFilter)
    .filter(p => statusFilter === "all" || p.status === statusFilter);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Published", val: published },
          { label: "Drafts",    val: drafts },
          { label: "Pages",     val: pages.filter(p => p.type === "page").length },
          { label: "Posts",     val: pages.filter(p => p.type === "post").length },
        ].map(s => (
          <div key={s.label} className="card py-3 px-4">
            <p className="text-xs text-brand-muted mb-1">{s.label}</p>
            <p className="text-2xl font-semibold text-brand-black">{s.val}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="flex gap-1">
          {([{ key: "all", label: "All" }, { key: "page", label: "Pages" }, { key: "post", label: "Posts" }] as const).map(f => (
            <button key={f.key} onClick={() => setTypeFilter(f.key)}
              className={clsx("px-3 py-1 rounded-full text-xs transition-colors",
                typeFilter === f.key ? "bg-brand-orange text-white" : "bg-brand-offwhite text-brand-muted hover:bg-brand-border")}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {([{ key: "all", label: "Any status" }, { key: "publish", label: "Published" }, { key: "draft", label: "Draft" }] as const).map(f => (
            <button key={f.key} onClick={() => setStatusFilter(f.key)}
              className={clsx("px-3 py-1 rounded-full text-xs transition-colors",
                statusFilter === f.key ? "bg-brand-black text-white" : "bg-brand-offwhite text-brand-muted hover:bg-brand-border")}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No pages match" />
      ) : (
        <div className="card p-0 overflow-hidden">
          {filtered.map((entry, i) => (
            <div key={`${entry.type}-${entry.id}`}
              className={clsx("flex items-center gap-3 px-4 py-3", i !== 0 && "border-t border-brand-border")}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-brand-black truncate">{entry.title}</p>
                <p className="text-xs text-brand-muted mt-0.5 truncate">{entry.url}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="badge badge-neutral capitalize">{entry.type}</span>
                <span className={clsx("badge", WP_STATUS_STYLES[entry.status] ?? "badge-neutral")}>
                  {entry.status === "publish" ? "Published" : entry.status}
                </span>
                <span className="text-[10px] text-brand-muted hidden sm:block">
                  {formatDistanceToNow(parseISO(entry.modified), { addSuffix: true })}
                </span>
                <a href={entry.url} target="_blank" rel="noopener noreferrer"
                  className="p-1.5 rounded text-brand-muted hover:bg-brand-offwhite transition-colors" title="View">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                    <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                </a>
                <a href={entry.editUrl} target="_blank" rel="noopener noreferrer"
                  className="p-1.5 rounded text-brand-muted hover:bg-brand-offwhite transition-colors" title="Edit in WordPress">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-brand-muted text-right">
        Showing {filtered.length} of {pages.length} · Updated every 60 s
      </p>
    </div>
  );
}
