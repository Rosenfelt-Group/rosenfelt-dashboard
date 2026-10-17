"use client";
import clsx from "clsx";
import { formatDistanceToNow, parseISO } from "date-fns";
import { ContentIdea } from "@/types";
import { Button } from "@/components/ui";

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

export function IdeaCard({ idea, isAdmin, writing, onWrite, onDiscard, onEdit, onRequeue }: {
  idea: ContentIdea;
  isAdmin: boolean;
  writing: boolean;
  onWrite: (idea: ContentIdea) => void;
  onDiscard: (id: string) => void;
  onEdit: (idea: ContentIdea) => void;
  onRequeue: (id: string) => void;
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

          {/* Drafting: pulsing indicator + reset button */}
          {isDrafting && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-blue-600 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse inline-block" />
                Avery is drafting…
              </p>
              {isAdmin && (
                <button
                  onClick={() => onRequeue(idea.id)}
                  className="text-xs text-brand-muted hover:text-brand-black underline"
                >
                  Reset to queue
                </button>
              )}
            </div>
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
            <Button size="sm" onClick={() => onWrite(idea)} disabled={writing}>
              {writing ? "Starting…" : "Write"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onDiscard(idea.id)}>
              Discard
            </Button>
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
