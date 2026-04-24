"use client";
import { useEffect, useState } from "react";
import { PendingApproval } from "@/types";
import { can } from "@/lib/permissions";
import { ApprovalCard } from "@/components/ApprovalCard";
import { AgentBadge } from "@/components/AgentBadge";
import { formatDistanceToNow, parseISO } from "date-fns";
import clsx from "clsx";

const STATUS_STYLES = {
  approved: "bg-green-50 text-green-700",
  rejected: "bg-red-50 text-red-700",
  expired:  "bg-gray-100 text-gray-500",
  pending:  "bg-amber-50 text-amber-700",
};

function HistoryRow({ item }: { item: PendingApproval }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border-b border-brand-border last:border-0">
      <button
        className="w-full text-left px-4 py-3 hover:bg-brand-offwhite transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-3">
          <AgentBadge agent={item.agent} size="sm" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-brand-black truncate">{item.title}</p>
            {item.description && !expanded && (
              <p className="text-xs text-brand-muted truncate">{item.description}</p>
            )}
          </div>
          <span className={clsx(
            "text-xs px-2 py-0.5 rounded font-medium flex-shrink-0",
            STATUS_STYLES[item.status] ?? "bg-gray-100 text-gray-500"
          )}>
            {item.status}
          </span>
          <span className="text-xs text-brand-muted flex-shrink-0">
            {formatDistanceToNow(parseISO(item.created_at), { addSuffix: true })}
          </span>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-3 bg-brand-offwhite space-y-2">
          {item.description && <p className="text-xs text-brand-black">{item.description}</p>}
          <div className="flex gap-4 text-xs text-brand-muted">
            <span>Type: <span className="text-brand-black">{item.action_type}</span></span>
            <span>Agent: <span className="text-brand-black capitalize">{item.agent}</span></span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ApprovalsPage() {
  const [pending,      setPending]      = useState<PendingApproval[]>([]);
  const [history,      setHistory]      = useState<PendingApproval[]>([]);
  const [tab,          setTab]          = useState<"pending" | "history">("pending");
  const [loading,      setLoading]      = useState(true);
  const [agentFilter,  setAgentFilter]  = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [permissions, setPermissions] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.permissions) setPermissions(data.permissions); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/api/approvals").then(r => r.json()),
      fetch("/api/approvals?history=true").then(r => r.json()),
    ]).then(([p, h]) => {
      setPending(Array.isArray(p) ? p : []);
      setHistory(Array.isArray(h) ? h.filter((x: PendingApproval) => x.status !== "pending") : []);
      setLoading(false);
    });
  }, []);

  async function handleApproval(id: string, status: "approved" | "rejected") {
    await fetch("/api/approvals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    const updated = pending.find(a => a.id === id);
    setPending(prev => prev.filter(a => a.id !== id));
    if (updated) setHistory(prev => [{ ...updated, status }, ...prev]);
  }

  const agents = Array.from(new Set(history.map(h => h.agent)));

  const filteredHistory = history
    .filter(h => agentFilter  === "all" || h.agent  === agentFilter)
    .filter(h => statusFilter === "all" || h.status === statusFilter);

  if (loading) {
    return (
      <div className="p-4 md:p-8 space-y-4">
        <div className="card animate-pulse h-16" />
        <div className="card animate-pulse h-64" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 pb-24 md:pb-8 max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-brand-black">Approvals</h1>
        <p className="text-sm text-brand-muted mt-0.5">
          {pending.length} pending · {history.length} in history
        </p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 border-b border-brand-border">
        {(["pending", "history"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={clsx(
              "px-4 py-2 text-sm font-medium transition-colors capitalize relative",
              tab === t ? "text-brand-black" : "text-brand-muted hover:text-brand-black"
            )}>
            {t === "pending" ? `Pending (${pending.length})` : `History (${history.length})`}
            {tab === t && <span className="absolute bottom-0 inset-x-0 h-0.5 bg-brand-orange rounded-full" />}
          </button>
        ))}
      </div>

      {/* ── PENDING ── */}
      {tab === "pending" && (
        <>
          {pending.length === 0 ? (
            <div className="card flex flex-col items-center justify-center py-16 text-center">
              <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center mb-4">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/>
                </svg>
              </div>
              <p className="text-sm font-medium text-brand-black mb-1">All caught up</p>
              <p className="text-xs text-brand-muted">No approvals waiting</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pending.map(a => (
                <ApprovalCard key={a.id} approval={a} onAction={handleApproval} isAdmin={can(permissions, "manage_approvals")} />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── HISTORY ── */}
      {tab === "history" && (
        <div className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            <div className="flex gap-1 flex-wrap">
              {(["all", ...agents] as string[]).map(a => (
                <button key={a} onClick={() => setAgentFilter(a)}
                  className={clsx(
                    "px-2.5 py-1 rounded-full text-xs capitalize transition-colors",
                    agentFilter === a ? "bg-brand-orange text-white" : "bg-brand-offwhite text-brand-muted hover:bg-brand-border"
                  )}>
                  {a}
                </button>
              ))}
            </div>
            <div className="flex gap-1 flex-wrap">
              {(["all", "approved", "rejected", "expired"] as const).map(s => (
                <button key={s} onClick={() => setStatusFilter(s)}
                  className={clsx(
                    "px-2.5 py-1 rounded-full text-xs capitalize transition-colors",
                    statusFilter === s ? "bg-brand-orange text-white" : "bg-brand-offwhite text-brand-muted hover:bg-brand-border"
                  )}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {filteredHistory.length === 0 ? (
            <div className="card py-12 text-center">
              <p className="text-sm text-brand-muted">No history yet</p>
            </div>
          ) : (
            <div className="card p-0 overflow-hidden">
              {filteredHistory.map(item => <HistoryRow key={item.id} item={item} />)}
            </div>
          )}
          <p className="text-xs text-brand-muted text-right">
            Showing {filteredHistory.length} of {history.length}
          </p>
        </div>
      )}
    </div>
  );
}
