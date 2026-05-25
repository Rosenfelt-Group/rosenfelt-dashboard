"use client";
import { useState } from "react";
import { PendingApproval } from "@/types";
import { AgentBadge } from "./AgentBadge";
import { formatDistanceToNow } from "date-fns";

interface ApprovalCardProps {
  approval: PendingApproval;
  onAction: (id: string, status: "approved" | "rejected" | "revision_requested", revisionNotes?: string) => Promise<void>;
  isAdmin?: boolean;
}

export function ApprovalCard({ approval, onAction, isAdmin = false }: ApprovalCardProps) {
  const [loading,       setLoading]       = useState<"approved" | "rejected" | "revision_requested" | "send_audit" | null>(null);
  const [showRevise,    setShowRevise]    = useState(false);
  const [revisionNotes, setRevisionNotes] = useState("");
  const [sendError,     setSendError]     = useState<string | null>(null);

  async function handle(status: "approved" | "rejected" | "revision_requested", notes?: string) {
    setLoading(status);
    await onAction(approval.id, status, notes);
    setLoading(null);
    setShowRevise(false);
    setRevisionNotes("");
  }

  async function handleSendAudit() {
    setLoading("send_audit");
    setSendError(null);
    try {
      const res = await fetch("/api/audit/deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approval_id: approval.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.ok) {
        setSendError(body?.error ?? body?.detail ?? `HTTP ${res.status}`);
      }
      // On success Realtime will move the row to history via the UPDATE handler.
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "send failed");
    } finally {
      setLoading(null);
    }
  }

  const isStackAudit = approval.action_type === "stack_audit_report";
  const editUrl = approval.payload?.edit_url as string | undefined;
  const auditClient = approval.payload?.company_name as string | undefined;
  const auditEmail = approval.payload?.contact_email as string | undefined;
  const auditWords = approval.payload?.word_count as number | undefined;

  return (
    <div className="card border-l-4 border-l-brand-orange space-y-3">
      {/* Header row */}
      <div className="flex items-start gap-3">
        <AgentBadge agent={approval.agent} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-brand-black">{approval.title}</p>
          {approval.description && (
            <p className="text-xs text-brand-muted mt-0.5 line-clamp-2">{approval.description}</p>
          )}
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-xs text-brand-muted">
              {approval.agent} · {formatDistanceToNow(new Date(approval.created_at), { addSuffix: true })}
            </span>
            {editUrl && (
              <a
                href={editUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-brand-orange hover:underline flex items-center gap-1"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
                View draft in WordPress
              </a>
            )}
          </div>
        </div>

        {/* Action buttons — hidden when revise form is open */}
        {isAdmin && !showRevise && (
          <div className="flex gap-1.5 flex-shrink-0">
            {isStackAudit ? (
              <>
                <button
                  onClick={handleSendAudit}
                  disabled={loading !== null}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-orange text-white hover:bg-brand-orange/90 transition-colors disabled:opacity-50"
                >
                  {loading === "send_audit" ? "Sending…" : "Send Audit to Client"}
                </button>
                <button
                  onClick={() => handle("rejected")}
                  disabled={loading !== null}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50"
                >
                  {loading === "rejected" ? "…" : "Reject"}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => handle("approved")}
                  disabled={loading !== null}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-green-50 text-green-700 hover:bg-green-100 transition-colors disabled:opacity-50"
                >
                  {loading === "approved" ? "…" : "Approve"}
                </button>
                <button
                  onClick={() => setShowRevise(true)}
                  disabled={loading !== null}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-50"
                >
                  Revise
                </button>
                <button
                  onClick={() => handle("rejected")}
                  disabled={loading !== null}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50"
                >
                  {loading === "rejected" ? "…" : "Reject"}
                </button>
              </>
            )}
          </div>
        )}
        {!isAdmin && (
          <span className="text-xs text-brand-muted flex-shrink-0 px-2 py-1 bg-brand-offwhite rounded-lg">
            Pending review
          </span>
        )}
      </div>

      {/* Stack Audit recipient summary — surfaces who the PDF will go to */}
      {isStackAudit && (auditClient || auditEmail) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-brand-muted border-t border-brand-border pt-2">
          {auditClient && (
            <span>Client: <span className="text-brand-black">{auditClient}</span></span>
          )}
          {auditEmail && (
            <span>To: <span className="text-brand-black font-mono">{auditEmail}</span></span>
          )}
          {typeof auditWords === "number" && (
            <span>{auditWords} words</span>
          )}
        </div>
      )}
      {sendError && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          Send failed: {sendError}
        </div>
      )}

      {/* Inline revision form */}
      {showRevise && isAdmin && (
        <div className="border-t border-brand-border pt-3 space-y-2">
          <p className="text-xs font-medium text-brand-black">What needs to change?</p>
          <textarea
            value={revisionNotes}
            onChange={e => setRevisionNotes(e.target.value)}
            placeholder="e.g. Add more concrete examples in section 2, shorten the intro"
            rows={3}
            autoFocus
            className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm text-brand-black placeholder:text-brand-muted focus:outline-none focus:ring-2 focus:ring-brand-orange/30 resize-none"
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setShowRevise(false); setRevisionNotes(""); }}
              className="px-3 py-1.5 text-xs rounded-lg text-brand-muted hover:bg-brand-offwhite transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => handle("revision_requested", revisionNotes)}
              disabled={loading !== null || !revisionNotes.trim()}
              className="px-3 py-1.5 text-xs rounded-lg font-medium bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-50"
            >
              {loading === "revision_requested" ? "Sending…" : "Send for revision"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
