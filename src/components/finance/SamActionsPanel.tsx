"use client";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { ApprovalCard } from "@/components/ApprovalCard";
import { PendingApproval } from "@/types";

type HistoryRow = PendingApproval & { status: "approved" | "rejected" | "revision_requested" };

const STATUS_STYLES: Record<string, string> = {
  approved:           "bg-green-50 text-green-700",
  rejected:           "bg-red-50 text-red-700",
  revision_requested: "bg-amber-50 text-amber-700",
};

const STATUS_LABELS: Record<string, string> = {
  approved:           "Approved",
  rejected:           "Rejected",
  revision_requested: "Revision",
};

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-3 py-2">
      <span className="w-2 h-2 rounded-full bg-brand-muted animate-bounce" style={{ animationDelay: "0ms" }} />
      <span className="w-2 h-2 rounded-full bg-brand-muted animate-bounce" style={{ animationDelay: "150ms" }} />
      <span className="w-2 h-2 rounded-full bg-brand-muted animate-bounce" style={{ animationDelay: "300ms" }} />
    </div>
  );
}

export function SamActionsPanel() {
  const [pending, setPending]               = useState<PendingApproval[]>([]);
  const [history, setHistory]               = useState<HistoryRow[]>([]);
  const [loading, setLoading]               = useState(true);
  const [compose, setCompose]               = useState("");
  const [composeSending, setComposeSending] = useState(false);
  const [composeReply, setComposeReply]     = useState<string | null>(null);
  const [composeError, setComposeError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    const [pendingRes, historyRes] = await Promise.allSettled([
      fetch("/api/approvals").then(r => r.json()),
      fetch("/api/approvals?history=true").then(r => r.json()),
    ]);

    const allPending = pendingRes.status === "fulfilled" && Array.isArray(pendingRes.value)
      ? pendingRes.value : [];
    const allHistory = historyRes.status === "fulfilled" && Array.isArray(historyRes.value)
      ? historyRes.value : [];

    setPending(allPending.filter((a: PendingApproval) => a.agent === "sam" && a.status === "pending"));
    setHistory(
      allHistory
        .filter((a: PendingApproval) => a.agent === "sam" && a.status !== "pending")
        .slice(0, 30) as HistoryRow[]
    );
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleApproval(id: string, status: "approved" | "rejected" | "revision_requested", revisionNotes?: string) {
    const r = await fetch("/api/approvals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, revision_notes: revisionNotes }),
    });
    if (r.ok) {
      setPending(prev => prev.filter(a => a.id !== id));
      load();
    } else {
      console.error('Approval action failed', r.status);
      load();
    }
  }

  async function sendCompose() {
    const text = compose.trim();
    if (!text || composeSending) return;
    setComposeSending(true);
    setComposeReply(null);
    setComposeError(null);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, agent: "sam", chatId: "finance_sam_actions" }),
      });
      const d = await r.json();
      if (d.error) { setComposeError(d.error); }
      else { setComposeReply(d.response ?? "Done."); setCompose(""); }
    } catch {
      setComposeError("Failed to reach Sam.");
    } finally {
      setComposeSending(false);
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl pb-24 md:pb-8">

      {/* Quick-compose */}
      <div className="card mb-6 p-4">
        <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide mb-3">Ask Sam to…</p>
        <div className="flex gap-2 items-start">
          <textarea
            value={compose}
            onChange={e => setCompose(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), sendCompose())}
            placeholder="Draft an invoice for Acme Corp $2,500  ·  Record AWS expense $142  ·  Send Q2 summary…"
            rows={2}
            className="flex-1 border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange resize-none"
          />
          <button
            onClick={sendCompose}
            disabled={composeSending || !compose.trim()}
            className="btn-primary disabled:opacity-50 px-4 py-2"
          >
            {composeSending ? "Sending…" : "Send"}
          </button>
        </div>

        {/* Typing indicator while awaiting Sam's response */}
        {composeSending && (
          <div className="mt-3 rounded-lg bg-brand-offwhite border border-brand-border">
            <TypingIndicator />
          </div>
        )}

        {/* Sam's response bubble */}
        {composeReply && !composeSending && (
          <div className="mt-3 p-3 rounded-lg bg-brand-offwhite border border-brand-border text-sm text-brand-black leading-relaxed">
            <div className="flex items-start justify-between gap-2">
              <p className="whitespace-pre-wrap flex-1">{composeReply}</p>
              <button onClick={() => setComposeReply(null)} className="text-brand-muted hover:text-brand-black text-lg flex-shrink-0 leading-none">✕</button>
            </div>
          </div>
        )}

        {composeError && (
          <p className="mt-2 text-xs text-red-500">{composeError}</p>
        )}
      </div>

      {/* Pending approvals */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-brand-black">
          Pending Actions
          {pending.length > 0 && (
            <span className="ml-2 text-xs text-brand-muted font-normal">{pending.length} waiting</span>
          )}
        </h2>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map(i => <div key={i} className="card animate-pulse h-28" />)}
        </div>
      ) : pending.length === 0 ? (
        <div className="card text-center py-6 mb-6">
          <p className="text-sm text-brand-muted">No pending Sam actions</p>
        </div>
      ) : (
        <div className="space-y-3 mb-6">
          {pending.map(a => (
            <ApprovalCard key={a.id} approval={a} onAction={handleApproval} isAdmin />
          ))}
        </div>
      )}

      {/* History */}
      <div className="border-t border-brand-border pt-5">
        <h2 className="text-sm font-medium text-brand-black mb-3">History</h2>
        {history.length === 0 ? (
          <p className="text-sm text-brand-muted">No history yet.</p>
        ) : (
          <div className="border border-brand-border rounded-xl overflow-hidden">
            {history.map(row => (
              <div
                key={row.id}
                className="flex items-center gap-3 px-4 py-3 border-b border-brand-border last:border-b-0 bg-white hover:bg-brand-offwhite transition-colors"
              >
                <span className="text-[10px] text-brand-muted w-28 flex-shrink-0">{fmtDate(row.reviewed_at ?? row.created_at)}</span>
                <span className="text-xs text-brand-muted w-24 flex-shrink-0 capitalize">{row.action_type.replace(/_/g, " ")}</span>
                <span className="flex-1 text-sm text-brand-black truncate">{row.title}</span>
                <span className={clsx("text-[10px] font-semibold px-2 py-0.5 rounded", STATUS_STYLES[row.status] ?? "bg-brand-offwhite text-brand-muted")}>
                  {STATUS_LABELS[row.status] ?? row.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
