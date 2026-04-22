"use client";
import { useEffect, useState } from "react";
import { ContentIdea } from "@/types";
import clsx from "clsx";
import { formatDistanceToNow, parseISO } from "date-fns";

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

// ─── Ideas tab ────────────────────────────────────────────────────────────────

function IdeasTab({ ideas, onUpdate }: {
  ideas: ContentIdea[];
  onUpdate: (id: string, status: ContentIdea["status"]) => void;
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
          <div className="flex gap-2 flex-shrink-0">
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

function BlogsTab({ ideas }: { ideas: ContentIdea[] }) {
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
                <div className="flex gap-2 mt-1.5 flex-wrap">
                  <span className={clsx("badge", PRIORITY_COLORS[blog.priority])}>{blog.priority}</span>
                  {blog.source    && <span className="text-xs text-brand-muted">Source: {blog.source}</span>}
                  {blog.post_id   && <span className="text-xs text-brand-muted">Post #{blog.post_id}</span>}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <span className={clsx("badge", STATUS_STYLES[blog.status] ?? "badge-neutral")}>
                  {blog.status === "in_progress" ? "In progress" : blog.status}
                </span>
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

function WebsiteTab() {
  return (
    <div className="card text-center py-16">
      <div className="w-12 h-12 bg-brand-offwhite rounded-xl flex items-center justify-center mx-auto mb-4">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="text-brand-muted">
          <circle cx="12" cy="12" r="10"/>
          <line x1="2" y1="12" x2="22" y2="12"/>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        </svg>
      </div>
      <p className="text-sm font-medium text-brand-black mb-2">Website pages</p>
      <p className="text-xs text-brand-muted max-w-xs mx-auto">
        Live page inventory from WordPress will appear here once the WP integration is connected.
      </p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ContentPage() {
  const [ideas,   setIdeas]   = useState<ContentIdea[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab,     setTab]     = useState<"ideas" | "blogs" | "website">("ideas");

  useEffect(() => {
    fetch("/api/content-ideas")
      .then(r => r.json())
      .then(d => { setIdeas(Array.isArray(d) ? d : []); setLoading(false); });
  }, []);

  async function updateStatus(id: string, status: ContentIdea["status"]) {
    await fetch("/api/content-ideas", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    setIdeas(prev => prev.map(i => i.id === id ? { ...i, status } : i));
  }

  if (loading) return <div className="p-8"><div className="card animate-pulse h-64" /></div>;

  const queued    = ideas.filter(i => i.status === "queued").length;
  const published = ideas.filter(i => i.status === "published").length;
  const blogCount = ideas.filter(i => i.signal_type === "blog_topic" || ["in_progress","published"].includes(i.status)).length;

  return (
    <div className="p-4 md:p-8 pb-24 md:pb-8 max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-brand-black">Content</h1>
        <p className="text-sm text-brand-muted mt-0.5">
          {queued} queued · {published} published · Monitor runs daily at 6 AM
        </p>
      </div>

      {/* Sub-tabs */}
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

      {tab === "ideas"   && <IdeasTab ideas={ideas} onUpdate={updateStatus} />}
      {tab === "blogs"   && <BlogsTab ideas={ideas} />}
      {tab === "website" && <WebsiteTab />}
    </div>
  );
}
