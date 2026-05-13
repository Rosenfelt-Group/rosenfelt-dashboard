"use client";
import { useEffect, useState } from "react";
import { ContentIdea } from "@/types";
import { can } from "@/lib/permissions";
import clsx from "clsx";
import { formatDistanceToNow, parseISO } from "date-fns";
import { supabase } from "@/lib/supabase";

const PRIORITY_COLORS = {
  high:   "bg-red-50 text-red-700",
  medium: "bg-amber-50 text-amber-700",
  low:    "bg-gray-100 text-gray-500",
};

const SIGNAL_LABELS: Record<ContentIdea["signal_type"], string> = {
  blog_topic:          "Blog topic",
  competitor_gap:      "Competitor gap",
  service_improvement: "Service improvement",
  competitive_intel:   "Competitive intel",
};

const STATUS_STYLES: Record<string, string> = {
  queued:      "bg-amber-50 text-amber-700",
  in_progress: "bg-blue-50 text-blue-700",
  published:   "bg-green-50 text-green-700",
  discarded:   "bg-gray-100 text-gray-500",
};

const STATUS_LABELS: Record<string, string> = {
  queued:      "Queued",
  in_progress: "In Progress",
  published:   "Published",
  discarded:   "Discarded",
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

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-xl shadow-lg w-full max-w-md p-6 space-y-4">
        <h2 className="text-base font-semibold text-brand-black">Edit idea</h2>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-brand-muted mb-1">Title</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm text-brand-black focus:outline-none focus:ring-2 focus:ring-brand-orange/30"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-brand-muted mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm text-brand-black focus:outline-none focus:ring-2 focus:ring-brand-orange/30 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Priority</label>
              <select
                value={priority}
                onChange={e => setPriority(e.target.value as ContentIdea["priority"])}
                className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm text-brand-black focus:outline-none focus:ring-2 focus:ring-brand-orange/30 bg-white">
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Type</label>
              <select
                value={signalType}
                onChange={e => setSignalType(e.target.value as ContentIdea["signal_type"])}
                className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm text-brand-black focus:outline-none focus:ring-2 focus:ring-brand-orange/30 bg-white">
                <option value="blog_topic">Blog topic</option>
                <option value="competitor_gap">Competitor gap</option>
                <option value="service_improvement">Service improvement</option>
                <option value="competitive_intel">Competitive intel</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-brand-muted mb-1">Source</label>
            <input
              value={source}
              onChange={e => setSource(e.target.value)}
              placeholder="e.g. Reddit, competitor site…"
              className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm text-brand-black focus:outline-none focus:ring-2 focus:ring-brand-orange/30"
            />
          </div>
        </div>

        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-brand-offwhite text-brand-muted hover:bg-brand-border transition-colors">
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

// ─── Ideas tab ────────────────────────────────────────────────────────────────

function IdeasTab({ ideas, isAdmin, onUpdate, onEdit }: {
  ideas: ContentIdea[];
  isAdmin: boolean;
  onUpdate: (id: string, status: ContentIdea["status"]) => void;
  onEdit: (idea: ContentIdea) => void;
}) {
  const queued = ideas.filter(i => i.status === "queued");
  if (ideas.length === 0) {
    return (
      <div className="card text-center py-16">
        <p className="text-sm text-brand-muted">No content ideas yet</p>
        <p className="text-xs text-brand-muted mt-1">The Content Intelligence Monitor populates this queue daily</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-brand-muted">{queued.length} queued</p>
      {ideas.map((idea, i) => (
        <div key={idea.id} className="card flex items-start gap-4">
          <span className="text-sm font-medium text-brand-muted w-5 flex-shrink-0 mt-0.5">{i + 1}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-brand-black">{idea.title}</p>
            {idea.description && (
              <p className="text-xs text-brand-muted mt-1 line-clamp-2">{idea.description}</p>
            )}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className={clsx("badge", PRIORITY_COLORS[idea.priority])}>{idea.priority}</span>
              <span className="badge badge-neutral">{SIGNAL_LABELS[idea.signal_type]}</span>
              {idea.source && <span className="text-xs text-brand-muted">Source: {idea.source}</span>}
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0 items-start">
            {isAdmin && (
              <button onClick={() => onEdit(idea)}
                className="p-1.5 rounded-lg text-brand-muted hover:bg-brand-offwhite transition-colors"
                title="Edit">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
            )}
            {idea.status === "queued" && (
              <>
                <button onClick={() => onUpdate(idea.id, "in_progress")}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-orange text-white hover:bg-orange-700 transition-colors">
                  Write
                </button>
                <button onClick={() => onUpdate(idea.id, "discarded")}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-50 text-brand-muted hover:bg-brand-border transition-colors">
                  Discard
                </button>
              </>
            )}
            {idea.status === "in_progress" && <span className={clsx("badge", STATUS_STYLES.in_progress)}>In progress</span>}
            {idea.status === "published"   && <span className={clsx("badge", STATUS_STYLES.published)}>Published</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Blogs tab ────────────────────────────────────────────────────────────────

function BlogsTab({ ideas, isAdmin, onEdit }: {
  ideas: ContentIdea[];
  isAdmin: boolean;
  onEdit: (idea: ContentIdea) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<"all" | "in_progress" | "published">("all");

  const blogs = ideas.filter(i =>
    i.signal_type === "blog_topic" || i.status === "published" || i.status === "in_progress"
  );
  const published  = blogs.filter(b => b.status === "published").length;
  const inProgress = blogs.filter(b => b.status === "in_progress").length;

  const filtered = statusFilter === "all" ? blogs : blogs.filter(b => b.status === statusFilter);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="card py-3 px-4">
          <p className="text-xs text-brand-muted mb-1">Published</p>
          <p className="text-2xl font-semibold text-brand-black">{published}</p>
        </div>
        <div className="card py-3 px-4">
          <p className="text-xs text-brand-muted mb-1">In progress</p>
          <p className="text-2xl font-semibold text-brand-black">{inProgress}</p>
        </div>
        <div className="card py-3 px-4">
          <p className="text-xs text-brand-muted mb-1">Total blog ideas</p>
          <p className="text-2xl font-semibold text-brand-black">{blogs.length}</p>
        </div>
      </div>

      <div className="flex gap-1">
        {([
          { key: "all",         label: `All (${blogs.length})` },
          { key: "in_progress", label: `In progress (${inProgress})` },
          { key: "published",   label: `Published (${published})` },
        ] as const).map(s => (
          <button key={s.key} onClick={() => setStatusFilter(s.key)}
            className={clsx("px-3 py-1 rounded-full text-xs transition-colors",
              statusFilter === s.key ? "bg-brand-orange text-white" : "bg-brand-offwhite text-brand-muted hover:bg-brand-border")}>
            {s.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card py-12 text-center">
          <p className="text-sm text-brand-muted">No blog posts match this filter</p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          {filtered.map((blog, i) => (
            <div key={blog.id}
              className={clsx("flex items-start gap-3 px-4 py-3", i !== 0 && "border-t border-brand-border")}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-brand-black">{blog.title}</p>
                {blog.description && (
                  <p className="text-xs text-brand-muted mt-0.5 line-clamp-1">{blog.description}</p>
                )}
                <div className="flex gap-2 mt-1.5 flex-wrap items-center">
                  <span className={clsx("badge", PRIORITY_COLORS[blog.priority])}>{blog.priority}</span>
                  {blog.source  && <span className="text-xs text-brand-muted">Source: {blog.source}</span>}
                  {blog.post_id && (
                    <a
                      href={`https://rosably.com/wp-admin/post.php?post=${blog.post_id}&action=edit`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-xs text-brand-orange hover:underline">
                      WP #{blog.post_id} ↗
                    </a>
                  )}
                  {blog.post_id && blog.status === "published" && (
                    <a
                      href={`https://rosably.com/?p=${blog.post_id}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-xs text-brand-muted hover:underline">
                      View article →
                    </a>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                <div className="flex items-center gap-1.5">
                  {isAdmin && (
                    <button onClick={() => onEdit(blog)}
                      className="p-1 rounded text-brand-muted hover:bg-brand-offwhite transition-colors"
                      title="Edit">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                    </button>
                  )}
                  <span className={clsx("badge", STATUS_STYLES[blog.status] ?? "badge-neutral")}>
                    {STATUS_LABELS[blog.status] ?? blog.status}
                  </span>
                </div>
                <span className="text-[10px] text-brand-muted">
                  {formatDistanceToNow(parseISO(blog.created_at), { addSuffix: true })}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Website tab ──────────────────────────────────────────────────────────────

type WpEntry = {
  id: number;
  title: string;
  status: string;
  type: "page" | "post";
  url: string;
  editUrl: string;
  modified: string;
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

  if (error) {
    return (
      <div className="card text-center py-16">
        <p className="text-sm font-medium text-brand-black mb-1">Could not load pages</p>
        <p className="text-xs text-brand-muted">WordPress connection failed. Check WP_URL and WP_AUTH env vars.</p>
      </div>
    );
  }

  const published = pages.filter(p => p.status === "publish").length;
  const drafts    = pages.filter(p => p.status === "draft").length;
  const wpPages   = pages.filter(p => p.type === "page").length;
  const wpPosts   = pages.filter(p => p.type === "post").length;

  const filtered = pages
    .filter(p => typeFilter   === "all" || p.type   === typeFilter)
    .filter(p => statusFilter === "all" || p.status === statusFilter);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card py-3 px-4">
          <p className="text-xs text-brand-muted mb-1">Published</p>
          <p className="text-2xl font-semibold text-brand-black">{published}</p>
        </div>
        <div className="card py-3 px-4">
          <p className="text-xs text-brand-muted mb-1">Drafts</p>
          <p className="text-2xl font-semibold text-brand-black">{drafts}</p>
        </div>
        <div className="card py-3 px-4">
          <p className="text-xs text-brand-muted mb-1">Pages</p>
          <p className="text-2xl font-semibold text-brand-black">{wpPages}</p>
        </div>
        <div className="card py-3 px-4">
          <p className="text-xs text-brand-muted mb-1">Posts</p>
          <p className="text-2xl font-semibold text-brand-black">{wpPosts}</p>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="flex gap-1">
          {([
            { key: "all",  label: "All" },
            { key: "page", label: "Pages" },
            { key: "post", label: "Posts" },
          ] as const).map(f => (
            <button key={f.key} onClick={() => setTypeFilter(f.key)}
              className={clsx("px-3 py-1 rounded-full text-xs transition-colors",
                typeFilter === f.key ? "bg-brand-orange text-white" : "bg-brand-offwhite text-brand-muted hover:bg-brand-border")}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {([
            { key: "all",     label: "Any status" },
            { key: "publish", label: "Published" },
            { key: "draft",   label: "Draft" },
          ] as const).map(f => (
            <button key={f.key} onClick={() => setStatusFilter(f.key)}
              className={clsx("px-3 py-1 rounded-full text-xs transition-colors",
                statusFilter === f.key ? "bg-brand-black text-white" : "bg-brand-offwhite text-brand-muted hover:bg-brand-border")}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card py-12 text-center">
          <p className="text-sm text-brand-muted">No pages match this filter</p>
        </div>
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ContentPage() {
  const [ideas,       setIdeas]       = useState<ContentIdea[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [tab,         setTab]         = useState<"ideas" | "blogs" | "website">("ideas");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [editing,     setEditing]     = useState<ContentIdea | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.permissions) setPermissions(d.permissions); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/content-ideas")
      .then(r => r.json())
      .then(d => { setIdeas(Array.isArray(d) ? d : []); setLoading(false); });

    const channel = supabase
      .channel("content-ideas-changes")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "content_ideas" },
        (payload) => {
          const updated = payload.new as ContentIdea;
          setIdeas(prev => prev.map(i => i.id === updated.id ? { ...i, ...updated } : i));
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  async function updateStatus(id: string, status: ContentIdea["status"]) {
    await fetch("/api/content-ideas", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    setIdeas(prev => prev.map(i => i.id === id ? { ...i, status } : i));
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

  const isAdmin   = can(permissions, "manage_approvals");
  const queued    = ideas.filter(i => i.status === "queued").length;
  const published = ideas.filter(i => i.status === "published").length;
  const blogCount = ideas.filter(i => i.signal_type === "blog_topic" || ["in_progress", "published"].includes(i.status)).length;

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
          {queued} queued · {published} published · Monitor runs daily at 6 AM
        </p>
      </div>

      <div className="flex gap-1 border-b border-brand-border">
        {([
          { key: "ideas",   label: `Ideas (${queued})` },
          { key: "blogs",   label: `Blogs (${blogCount})` },
          { key: "website", label: "Website" },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={clsx(
              "px-4 py-2 text-sm font-medium transition-colors relative whitespace-nowrap",
              tab === t.key ? "text-brand-black" : "text-brand-muted hover:text-brand-black"
            )}>
            {t.label}
            {tab === t.key && <span className="absolute bottom-0 inset-x-0 h-0.5 bg-brand-orange rounded-full" />}
          </button>
        ))}
      </div>

      {tab === "ideas"   && <IdeasTab ideas={ideas} isAdmin={isAdmin} onUpdate={updateStatus} onEdit={setEditing} />}
      {tab === "blogs"   && <BlogsTab ideas={ideas} isAdmin={isAdmin} onEdit={setEditing} />}
      {tab === "website" && <WebsiteTab />}
    </div>
  );
}
