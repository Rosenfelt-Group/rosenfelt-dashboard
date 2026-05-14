"use client";
import { useEffect, useState } from "react";
import { ContentIdea } from "@/types";
import { can } from "@/lib/permissions";
import clsx from "clsx";
import { formatDistanceToNow, parseISO } from "date-fns";
import { supabase } from "@/lib/supabase";

// ─── Styles ───────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<ContentIdea["status"], string> = {
  queued:          "bg-gray-100 text-gray-600",
  in_progress:     "bg-blue-50 text-blue-700",
  revision_needed: "bg-amber-50 text-amber-700",
  published:       "bg-green-50 text-green-700",
  discarded:       "bg-gray-100 text-gray-400",
};

const BORDER: Record<ContentIdea["status"], string> = {
  queued:          "border-l-gray-200",
  in_progress:     "border-l-blue-400",
  revision_needed: "border-l-amber-400",
  published:       "border-l-green-500",
  discarded:       "border-l-gray-200",
};

const PRIORITY_COLORS = {
  high:   "bg-red-50 text-red-700",
  medium: "bg-amber-50 text-amber-700",
  low:    "bg-gray-100 text-gray-500",
};

const SIGNAL_LABELS: Record<ContentIdea["signal_type"], string> = {
  blog_topic:          "Blog",
  competitor_gap:      "Competitor gap",
  service_improvement: "Service",
  competitive_intel:   "Intel",
};

// ─── Edit modal ───────────────────────────────────────────────────────────────

function EditIdeaModal({ idea, onSave, onClose }: {
  idea: ContentIdea;
  onSave: (id: string, updates: Partial<ContentIdea>) => Promise<void>;
  onClose: () => void;
}) {
  const [title,       setTitle]       = useState(idea.title);
  const [description, setDescription] = useState(idea.description ?? "");
  const [priority,    setPriority]    = useState(idea.priority);
  const [signalType,  setSignalType]  = useState(idea.signal_type);
  const [source,      setSource]      = useState(idea.source ?? "");
  const [saving,      setSaving]      = useState(false);

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    await onSave(idea.id, {
      title:       title.trim(),
      description: description.trim() || undefined,
      priority,
      signal_type: signalType,
      source:      source.trim() || undefined,
    });
    setSaving(false);
    onClose();
  }

  const inputCls = "w-full border border-brand-border rounded-lg px-3 py-2 text-sm text-brand-black focus:outline-none focus:ring-2 focus:ring-brand-orange/30 bg-white";

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-xl shadow-lg w-full max-w-md p-6 space-y-4">
        <h2 className="text-base font-semibold text-brand-black">Edit idea</h2>
        <div>
          <label className="block text-xs font-medium text-brand-muted mb-1">Title</label>
          <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-brand-muted mb-1">Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
            className={`${inputCls} resize-none`} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-brand-muted mb-1">Priority</label>
            <select value={priority} onChange={e => setPriority(e.target.value as ContentIdea["priority"])} className={inputCls}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-brand-muted mb-1">Type</label>
            <select value={signalType} onChange={e => setSignalType(e.target.value as ContentIdea["signal_type"])} className={inputCls}>
              <option value="blog_topic">Blog topic</option>
              <option value="competitor_gap">Competitor gap</option>
              <option value="service_improvement">Service improvement</option>
              <option value="competitive_intel">Competitive intel</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-brand-muted mb-1">Source</label>
          <input value={source} onChange={e => setSource(e.target.value)} className={inputCls}
            placeholder="e.g. Reddit, competitor site…" />
        </div>
        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium bg-brand-offwhite text-brand-muted hover:bg-brand-border transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving || !title.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-brand-orange text-white hover:bg-orange-700 transition-colors disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Idea card ────────────────────────────────────────────────────────────────

function IdeaCard({ idea, isAdmin, writing, onWrite, onDiscard, onEdit }: {
  idea: ContentIdea;
  isAdmin: boolean;
  writing: boolean;
  onWrite: (idea: ContentIdea) => void;
  onDiscard: (id: string) => void;
  onEdit: (idea: ContentIdea) => void;
}) {
  const hasDraft    = idea.status === "in_progress" && !!idea.post_id;
  const isDrafting  = idea.status === "in_progress" && !idea.post_id;
  const wpEditUrl   = idea.post_id
    ? `https://rosably.com/wp-admin/post.php?post=${idea.post_id}&action=edit`
    : null;
  const wpLiveUrl   = idea.post_id ? `https://rosably.com/?p=${idea.post_id}` : null;

  function statusLabel() {
    if (idea.status === "in_progress") return hasDraft ? "In Review" : "Drafting";
    if (idea.status === "revision_needed") return "Needs Revision";
    if (idea.status === "queued")    return "Queued";
    if (idea.status === "published") return "Published";
    return "Discarded";
  }

  return (
    <div className={clsx("card border-l-4", BORDER[idea.status])}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0 space-y-1.5">

          {/* Title + meta */}
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-brand-black leading-snug">{idea.title}</p>
            <span className={clsx("badge text-xs flex-shrink-0", STATUS_BADGE[idea.status])}>
              {statusLabel()}
            </span>
          </div>

          {idea.description && (
            <p className="text-xs text-brand-muted line-clamp-2">{idea.description}</p>
          )}

          {/* Queued: show priority / type / source */}
          {idea.status === "queued" && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className={clsx("badge", PRIORITY_COLORS[idea.priority])}>{idea.priority}</span>
              <span className="badge badge-neutral">{SIGNAL_LABELS[idea.signal_type]}</span>
              {idea.source && <span className="text-xs text-brand-muted">Source: {idea.source}</span>}
            </div>
          )}

          {/* Drafting: pulsing indicator */}
          {isDrafting && (
            <p className="text-xs text-blue-600 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse inline-block" />
              Avery is drafting…
            </p>
          )}

          {/* Draft ready: WP link + approval link */}
          {hasDraft && (
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs text-blue-600">Draft ready</span>
              <a href={wpEditUrl!} target="_blank" rel="noopener noreferrer"
                className="text-xs text-brand-orange hover:underline">
                WP #{idea.post_id} ↗
              </a>
              <a href="/approvals" className="text-xs text-brand-muted hover:text-brand-black">
                Pending approval →
              </a>
            </div>
          )}

          {/* Revision needed */}
          {idea.status === "revision_needed" && (
            <div className="space-y-1">
              {idea.revision_notes && (
                <div className="text-xs bg-amber-50 border border-amber-100 rounded-md px-2.5 py-1.5 text-amber-800">
                  <span className="font-medium">Revision: </span>{idea.revision_notes}
                </div>
              )}
              <p className="text-xs text-amber-600 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse inline-block" />
                Avery will rewrite shortly
              </p>
            </div>
          )}

          {/* Published */}
          {idea.status === "published" && idea.post_id && (
            <div className="flex items-center gap-3 flex-wrap">
              <a href={wpEditUrl!} target="_blank" rel="noopener noreferrer"
                className="text-xs text-brand-orange hover:underline">
                WP #{idea.post_id} ↗
              </a>
              <a href={wpLiveUrl!} target="_blank" rel="noopener noreferrer"
                className="text-xs text-brand-muted hover:text-brand-black">
                View article →
              </a>
            </div>
          )}

          {/* Footer timestamp */}
          <p className="text-[10px] text-brand-muted">
            {formatDistanceToNow(parseISO(idea.created_at), { addSuffix: true })}
          </p>
        </div>

        {/* Action buttons */}
        {isAdmin && idea.status === "queued" && (
          <div className="flex flex-col gap-1.5 flex-shrink-0">
            <button
              onClick={() => onWrite(idea)}
              disabled={writing}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-orange text-white hover:bg-orange-700 disabled:opacity-50 transition-colors"
            >
              {writing ? "Starting…" : "Write"}
            </button>
            <button
              onClick={() => onDiscard(idea.id)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-50 text-brand-muted hover:bg-brand-border transition-colors"
            >
              Discard
            </button>
          </div>
        )}
        {isAdmin && (
          <button
            onClick={() => onEdit(idea)}
            className="p-1.5 rounded-lg text-brand-muted hover:bg-brand-offwhite transition-colors flex-shrink-0"
            title="Edit"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Website tab (unchanged) ──────────────────────────────────────────────────

type WpEntry = {
  id: number; title: string; status: string;
  type: "page" | "post"; url: string; editUrl: string; modified: string;
};

const WP_STATUS_STYLES: Record<string, string> = {
  publish: "bg-green-50 text-green-700",
  draft:   "bg-amber-50 text-amber-700",
  private: "bg-blue-50 text-blue-700",
};

function WebsiteTab() {
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

  if (loading) return <div className="card animate-pulse h-64" />;
  if (error)   return (
    <div className="card text-center py-16">
      <p className="text-sm font-medium text-brand-black mb-1">Could not load pages</p>
      <p className="text-xs text-brand-muted">WordPress connection failed.</p>
    </div>
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
        <div className="card py-12 text-center"><p className="text-sm text-brand-muted">No pages match</p></div>
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

// ─── Main page ────────────────────────────────────────────────────────────────

type StatusFilter = "all" | "queued" | "in_progress" | "revision_needed" | "published";

export default function ContentPage() {
  const [ideas,       setIdeas]       = useState<ContentIdea[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [tab,         setTab]         = useState<"content" | "website">("content");
  const [statusF,     setStatusF]     = useState<StatusFilter>("all");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [editing,     setEditing]     = useState<ContentIdea | null>(null);
  const [writing,     setWriting]     = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.permissions) setPermissions(d.permissions); }).catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/content-ideas").then(r => r.json())
      .then(d => { setIdeas(Array.isArray(d) ? d : []); setLoading(false); });

    const channel = supabase
      .channel("content-ideas-changes")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "content_ideas" }, (payload) => {
        const row = payload.new as ContentIdea;
        if (row.status !== "discarded") setIdeas(prev => [row, ...prev]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "content_ideas" }, (payload) => {
        const updated = payload.new as ContentIdea;
        setIdeas(prev => prev.map(i => i.id === updated.id ? { ...i, ...updated } : i));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  async function handleWrite(idea: ContentIdea) {
    setWriting(prev => new Set([...prev, idea.id]));
    // Optimistic update so card flips to Drafting immediately
    setIdeas(prev => prev.map(i => i.id === idea.id ? { ...i, status: "in_progress" } : i));

    const res = await fetch("/api/content-ideas/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea_id: idea.id, title: idea.title, description: idea.description }),
    });
    if (!res.ok) {
      // Revert on failure
      setIdeas(prev => prev.map(i => i.id === idea.id ? { ...i, status: "queued" } : i));
      alert("Failed to start draft. Please try again.");
    }
    setWriting(prev => { const s = new Set(prev); s.delete(idea.id); return s; });
  }

  async function handleDiscard(id: string) {
    await fetch("/api/content-ideas", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "discarded" }),
    });
    setIdeas(prev => prev.filter(i => i.id !== id));
  }

  async function updateIdea(id: string, updates: Partial<ContentIdea>) {
    const res = await fetch("/api/content-ideas", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...updates }),
    });
    if (res.ok) {
      const updated = await res.json();
      setIdeas(prev => prev.map(i => i.id === id ? { ...i, ...updated } : i));
    }
  }

  if (loading) return <div className="p-8"><div className="card animate-pulse h-64" /></div>;

  const isAdmin = can(permissions, "manage_approvals");

  // Counts for filter pills (exclude discarded from All)
  const visible = ideas.filter(i => i.status !== "discarded");
  const counts: Record<StatusFilter, number> = {
    all:             visible.length,
    queued:          ideas.filter(i => i.status === "queued").length,
    in_progress:     ideas.filter(i => i.status === "in_progress").length,
    revision_needed: ideas.filter(i => i.status === "revision_needed").length,
    published:       ideas.filter(i => i.status === "published").length,
  };

  const filtered = statusF === "all"
    ? visible
    : ideas.filter(i => i.status === statusF);

  const FILTERS: { key: StatusFilter; label: string }[] = [
    { key: "all",             label: `All (${counts.all})` },
    { key: "queued",          label: `Queue (${counts.queued})` },
    { key: "in_progress",     label: `Drafting (${counts.in_progress})` },
    { key: "revision_needed", label: `Needs Revision (${counts.revision_needed})` },
    { key: "published",       label: `Published (${counts.published})` },
  ];

  return (
    <div className="p-4 md:p-8 pb-24 md:pb-8 max-w-4xl space-y-5">
      {editing && (
        <EditIdeaModal
          idea={editing}
          onSave={updateIdea}
          onClose={() => setEditing(null)}
        />
      )}

      <div>
        <h1 className="text-xl font-semibold text-brand-black">Content</h1>
        <p className="text-sm text-brand-muted mt-0.5">
          {counts.queued} queued · {counts.in_progress} drafting · {counts.published} published
        </p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 border-b border-brand-border">
        {([
          { key: "content", label: "Content" },
          { key: "website", label: "Website" },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={clsx(
              "px-4 py-2 text-sm font-medium transition-colors relative",
              tab === t.key ? "text-brand-black" : "text-brand-muted hover:text-brand-black"
            )}>
            {t.label}
            {tab === t.key && <span className="absolute bottom-0 inset-x-0 h-0.5 bg-brand-orange rounded-full" />}
          </button>
        ))}
      </div>

      {/* ── Content tab ── */}
      {tab === "content" && (
        <div className="space-y-4">
          {/* Status filter pills */}
          <div className="flex gap-1.5 flex-wrap">
            {FILTERS.map(f => (
              <button key={f.key} onClick={() => setStatusF(f.key)}
                className={clsx(
                  "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                  statusF === f.key
                    ? "bg-brand-orange text-white"
                    : "bg-brand-offwhite text-brand-muted hover:text-brand-black",
                )}>
                {f.label}
              </button>
            ))}
          </div>

          {/* Cards */}
          {filtered.length === 0 ? (
            <div className="card text-center py-16">
              <p className="text-sm text-brand-muted">
                {statusF === "all" ? "No content ideas yet" : `No ${statusF.replace("_", " ")} items`}
              </p>
              {statusF === "all" && (
                <p className="text-xs text-brand-muted mt-1">
                  The Content Intelligence Monitor populates this queue automatically
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(idea => (
                <IdeaCard
                  key={idea.id}
                  idea={idea}
                  isAdmin={isAdmin}
                  writing={writing.has(idea.id)}
                  onWrite={handleWrite}
                  onDiscard={handleDiscard}
                  onEdit={setEditing}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "website" && <WebsiteTab />}
    </div>
  );
}
