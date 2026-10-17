"use client";
import { useCallback, useEffect, useState } from "react";
import { ContentIdea } from "@/types";
import { can } from "@/lib/permissions";
import clsx from "clsx";
import { usePolling } from "@/lib/use-polling";
import { EmptyState, ErrorState, LoadingState, PageHeader, Tabs } from "@/components/ui";
import { EditIdeaModal } from "./_components/EditIdeaModal";
import { IdeaCard } from "./_components/IdeaCard";
import { WebsiteTab } from "./_components/WebsiteTab";

const PAGE_TABS = [
  { id: "content", label: "Content" },
  { id: "website", label: "Website" },
] as const;

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

  const [loadError, setLoadError] = useState<string | null>(null);
  const loadIdeas = useCallback(async (silent = false) => {
    try {
      const r = await fetch("/api/content-ideas");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setIdeas(Array.isArray(d) ? d : []);
      setLoadError(null);
    } catch (e) {
      if (!silent) setLoadError(e instanceof Error ? e.message : "Failed to load ideas");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadIdeas(); }, [loadIdeas]);
  // Pick up ideas added or updated by agents (Riley's research, Avery's drafts).
  usePolling(() => loadIdeas(true), 15_000);

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

  async function handleRequeue(id: string) {
    setIdeas(prev => prev.map(i => i.id === id ? { ...i, status: "queued" as const, revision_notes: null } : i));
    await fetch("/api/content-ideas", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "queued", revision_notes: null }),
    });
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

  if (loading) return <div className="p-8"><LoadingState /></div>;
  if (loadError) return <div className="p-8"><ErrorState message={`Couldn't load content ideas: ${loadError}`} /></div>;

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

      <PageHeader
        className="!mb-0"
        title="Content"
        description={`${counts.queued} queued · ${counts.in_progress} drafting · ${counts.published} published`}
      />

      <Tabs tabs={PAGE_TABS} value={tab} onChange={setTab} />

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
            <EmptyState
              title={statusF === "all" ? "No content ideas yet" : `No ${statusF.replace("_", " ")} items`}
              description={statusF === "all" ? "The Content Intelligence Monitor populates this queue automatically" : undefined}
            />
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
                  onRequeue={handleRequeue}
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
