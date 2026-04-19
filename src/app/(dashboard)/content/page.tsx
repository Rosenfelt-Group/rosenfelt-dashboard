"use client";
import { useEffect, useState } from "react";
import { ContentIdea } from "@/types";
import clsx from "clsx";

const PRIORITY_COLORS = {
  high:   "bg-red-50 text-red-700",
  medium: "bg-amber-50 text-amber-700",
  low:    "bg-gray-100 text-gray-500",
};

const SIGNAL_LABELS: Record<ContentIdea["signal_type"], string> = {
  blog_topic:        "Blog topic",
  competitor_gap:    "Competitor gap",
  service_improvement: "Service improvement",
  competitive_intel: "Competitive intel",
};

export default function ContentPage() {
  const [ideas, setIdeas] = useState<ContentIdea[]>([]);
  const [loading, setLoading] = useState(true);

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

  const queued = ideas.filter(i => i.status === "queued");

  if (loading) return <div className="p-8"><div className="card animate-pulse h-64" /></div>;

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-brand-black">Content</h1>
        <p className="text-sm text-brand-muted mt-0.5">
          {queued.length} ideas queued · Content Intelligence Monitor runs daily at 6 AM
        </p>
      </div>

      {ideas.length === 0 ? (
        <div className="card text-center py-16">
          <p className="text-sm text-brand-muted">No content ideas yet</p>
          <p className="text-xs text-brand-muted mt-1">
            The Content Intelligence Monitor will populate this queue daily
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {ideas.map((idea, i) => (
            <div key={idea.id} className="card flex items-start gap-4">
              <span className="text-sm font-medium text-brand-muted w-5 flex-shrink-0 mt-0.5">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-brand-black">{idea.title}</p>
                {idea.description && (
                  <p className="text-xs text-brand-muted mt-1 line-clamp-2">{idea.description}</p>
                )}
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className={clsx("badge", PRIORITY_COLORS[idea.priority])}>
                    {idea.priority}
                  </span>
                  <span className="badge badge-neutral">
                    {SIGNAL_LABELS[idea.signal_type]}
                  </span>
                  {idea.source && (
                    <span className="text-xs text-brand-muted">Source: {idea.source}</span>
                  )}
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                {idea.status === "queued" && (
                  <>
                    <button
                      onClick={() => updateStatus(idea.id, "in_progress")}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-orange text-white
                                 hover:bg-brand-orange-dark transition-colors"
                    >
                      Write
                    </button>
                    <button
                      onClick={() => updateStatus(idea.id, "discarded")}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-50 text-brand-muted
                                 hover:bg-brand-border transition-colors"
                    >
                      Discard
                    </button>
                  </>
                )}
                {idea.status === "in_progress" && (
                  <span className="badge badge-warning">In progress</span>
                )}
                {idea.status === "published" && (
                  <span className="badge badge-success">Published</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
