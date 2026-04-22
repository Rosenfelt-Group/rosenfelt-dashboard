"use client";
import { useState } from "react";
import { PendingApproval } from "@/types";
import { AgentBadge } from "./AgentBadge";
import { formatDistanceToNow } from "date-fns";

interface ApprovalCardProps {
  approval: PendingApproval;
  onAction: (id: string, status: "approved" | "rejected") => Promise<void>;
  isAdmin?: boolean;
}

export function ApprovalCard({ approval, onAction, isAdmin = false }: ApprovalCardProps) {
  const [loading, setLoading] = useState<"approved" | "rejected" | null>(null);

  async function handle(status: "approved" | "rejected") {
    setLoading(status);
    await onAction(approval.id, status);
    setLoading(null);
  }

  return (
    <div className="card flex items-start gap-3 border-l-4 border-l-brand-orange">
      <AgentBadge agent={approval.agent} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-brand-black truncate">{approval.title}</p>
        {approval.description && (
          <p className="text-xs text-brand-muted mt-0.5 line-clamp-2">{approval.description}</p>
        )}
        <p className="text-xs text-brand-muted mt-1">
          {approval.agent} · {formatDistanceToNow(new Date(approval.created_at), { addSuffix: true })}
        </p>
      </div>
      {isAdmin ? (
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={() => handle("approved")}
            disabled={loading !== null}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-green-50 text-green-700
                       hover:bg-green-100 transition-colors disabled:opacity-50"
          >
            {loading === "approved" ? "..." : "Approve"}
          </button>
          <button
            onClick={() => handle("rejected")}
            disabled={loading !== null}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-700
                       hover:bg-red-100 transition-colors disabled:opacity-50"
          >
            {loading === "rejected" ? "..." : "Reject"}
          </button>
        </div>
      ) : (
        <span className="text-xs text-brand-muted flex-shrink-0 px-2 py-1 bg-brand-offwhite rounded-lg">
          Pending review
        </span>
      )}
    </div>
  );
}
