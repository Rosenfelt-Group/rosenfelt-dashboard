"use client";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui";
import { ago, decodeHtmlEntities } from "./helpers";

interface WordpressStatusData {
  configured: boolean;
  wp_url: string | null;
  fetched_at: string;
  posts: {
    pending: { id: number; title: string; status: string; date: string; modified: string; edit_url: string; view_url: string }[];
    draft:   { id: number; title: string; status: string; date: string; modified: string; edit_url: string; view_url: string }[];
    future:  { id: number; title: string; status: string; date: string; modified: string; edit_url: string; view_url: string }[];
  };
  core: { current_version: string | null; latest_version: string | null; update_available: boolean };
  themes: {
    active: { stylesheet: string; name: string; version: string; is_active: boolean } | null;
    all: { stylesheet: string; name: string; version: string; is_active: boolean }[];
  };
  plugins: {
    plugin: string; slug: string; name: string;
    current_version: string; latest_version: string | null;
    update_available: boolean; status: "active" | "inactive"; plugin_uri: string;
  }[];
  errors: string[];
}

export function WordpressTab() {
  const [data, setData] = useState<WordpressStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/wordpress/status");
      if (!res.ok) { setError(`Failed to load (HTTP ${res.status})`); setLoading(false); return; }
      const d = await res.json();
      setData(d);
      setLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch failed");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 600_000); // refresh every 10 min
    return () => clearInterval(id);
  }, [load]);

  if (loading) return <LoadingState />;
  if (error)   return <ErrorState message={error} />;
  if (!data)   return <EmptyState title="No data" />;

  if (!data.configured) {
    return (
      <div className="card text-sm text-brand-muted text-center py-12">
        <p className="text-brand-black font-medium mb-2">WordPress not configured</p>
        <p className="text-xs">Set <code className="bg-brand-offwhite px-1 rounded">WP_URL</code> and <code className="bg-brand-offwhite px-1 rounded">WP_AUTH</code> in Vercel environment variables.</p>
      </div>
    );
  }

  const totalPosts = data.posts.pending.length + data.posts.draft.length + data.posts.future.length;
  const pluginUpdates = data.plugins.filter(p => p.update_available);
  const activePlugins = data.plugins.filter(p => p.status === "active").length;

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div className="card flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-brand-muted">
            <circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          <a href={data.wp_url ?? "#"} target="_blank" rel="noreferrer" className="text-sm font-semibold text-brand-black hover:text-brand-orange">
            {data.wp_url?.replace(/^https?:\/\//, "")}
          </a>
        </div>
        <span className="text-[10px] text-brand-muted">Updated {ago(data.fetched_at)}</span>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card text-center py-3">
          <p className={clsx("text-xl font-semibold", totalPosts > 0 ? "text-amber-600" : "text-brand-black")}>{totalPosts}</p>
          <p className="text-[10px] text-brand-muted mt-0.5 uppercase tracking-wide">Posts in queue</p>
        </div>
        <div className="card text-center py-3">
          <p className={clsx("text-xl font-semibold", pluginUpdates.length > 0 ? "text-amber-600" : "text-green-600")}>{pluginUpdates.length}</p>
          <p className="text-[10px] text-brand-muted mt-0.5 uppercase tracking-wide">Plugin updates</p>
        </div>
        <div className="card text-center py-3">
          <p className={clsx("text-xl font-semibold", data.core.update_available ? "text-amber-600" : "text-green-600")}>
            {data.core.current_version ?? "—"}
          </p>
          <p className="text-[10px] text-brand-muted mt-0.5 uppercase tracking-wide">WordPress core</p>
        </div>
        <div className="card text-center py-3">
          <p className="text-xl font-semibold text-brand-black">{activePlugins}</p>
          <p className="text-[10px] text-brand-muted mt-0.5 uppercase tracking-wide">Active plugins</p>
        </div>
      </div>

      {/* Errors (if any) */}
      {data.errors.length > 0 && (
        <div className="card border-amber-200 bg-amber-50">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">Fetch warnings</p>
          <ul className="text-xs text-amber-900 space-y-0.5 font-mono">
            {data.errors.map((e, i) => <li key={i}>· {e}</li>)}
          </ul>
        </div>
      )}

      {/* Posts in queue */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">Posts in queue</p>
          <span className="text-[10px] text-brand-muted">
            {data.posts.pending.length} pending · {data.posts.draft.length} drafts · {data.posts.future.length} scheduled
          </span>
        </div>
        {totalPosts === 0 ? (
          <p className="text-xs text-brand-muted text-center py-3">No posts pending, drafted, or scheduled.</p>
        ) : (
          <div className="divide-y divide-brand-border">
            {[
              { label: "pending",   list: data.posts.pending,  badge: "bg-amber-50 text-amber-700" },
              { label: "draft",     list: data.posts.draft,    badge: "bg-gray-100 text-gray-600" },
              { label: "scheduled", list: data.posts.future,   badge: "bg-blue-50 text-blue-700"  },
            ].flatMap(group => group.list.map(p => ({ ...p, _group: group.label, _badge: group.badge })))
              .map(p => (
              <div key={`${p._group}-${p.id}`} className="flex items-center gap-3 py-2 text-xs">
                <span className={clsx("badge text-[9px] px-1.5 py-0.5 capitalize flex-shrink-0", p._badge)}>{p._group}</span>
                <span className="flex-1 truncate text-brand-black">{decodeHtmlEntities(p.title)}</span>
                <span className="text-[10px] text-brand-muted flex-shrink-0">
                  {p._group === "scheduled" ? `for ${new Date(p.date).toLocaleDateString()}` : ago(p.modified)}
                </span>
                <a href={p.edit_url} target="_blank" rel="noreferrer" className="text-brand-muted hover:text-brand-orange flex-shrink-0" title="Edit in wp-admin">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </a>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Core + theme */}
      <div className="card">
        <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide mb-3">Core & theme</p>
        <div className="space-y-2">
          <div className="flex items-center gap-3 py-1.5 text-xs">
            <span className="font-mono text-brand-black flex-1">WordPress core</span>
            <span className="text-brand-muted">v{data.core.current_version ?? "unknown"}</span>
            {data.core.update_available ? (
              <span className="badge text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-700">→ {data.core.latest_version}</span>
            ) : data.core.current_version ? (
              <span className="badge text-[10px] px-1.5 py-0.5 bg-green-50 text-green-700">up to date</span>
            ) : (
              <span className="badge text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500">—</span>
            )}
          </div>
          {data.themes.active && (
            <div className="flex items-center gap-3 py-1.5 text-xs border-t border-brand-border pt-2">
              <span className="font-mono text-brand-black flex-1">{decodeHtmlEntities(data.themes.active.name)} <span className="text-brand-muted">(active theme)</span></span>
              <span className="text-brand-muted">v{data.themes.active.version}</span>
            </div>
          )}
          {data.themes.all.filter(t => !t.is_active).length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-brand-muted hover:text-brand-black py-1">
                {data.themes.all.filter(t => !t.is_active).length} inactive theme(s)
              </summary>
              <div className="divide-y divide-brand-border mt-1">
                {data.themes.all.filter(t => !t.is_active).map(t => (
                  <div key={t.stylesheet} className="flex items-center gap-3 py-1.5">
                    <span className="font-mono text-brand-black flex-1">{decodeHtmlEntities(t.name)}</span>
                    <span className="text-brand-muted">v{t.version}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>

      {/* Plugins */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">Plugins</p>
          <span className="text-[10px] text-brand-muted">{data.plugins.length} installed · {activePlugins} active</span>
        </div>
        {data.plugins.length === 0 ? (
          <p className="text-xs text-brand-muted text-center py-3">No plugins reported.</p>
        ) : (
          <div className="divide-y divide-brand-border">
            {data.plugins.map(p => (
              <div key={p.plugin} className="flex items-center gap-3 py-1.5 text-xs">
                <div className={clsx("w-1.5 h-1.5 rounded-full flex-shrink-0",
                  p.update_available ? "bg-amber-400" : p.status === "active" ? "bg-green-500" : "bg-gray-300")} />
                <span className="text-brand-black flex-1 truncate">{decodeHtmlEntities(p.name)}</span>
                <span className="text-brand-muted text-[10px] font-mono flex-shrink-0">v{p.current_version}</span>
                {p.update_available && p.latest_version ? (
                  <span className="badge text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-700 flex-shrink-0">→ {p.latest_version}</span>
                ) : p.status === "active" ? (
                  <span className="badge text-[9px] px-1 py-0 bg-green-50 text-green-700 flex-shrink-0">active</span>
                ) : (
                  <span className="badge text-[9px] px-1 py-0 bg-gray-100 text-gray-500 flex-shrink-0">inactive</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
