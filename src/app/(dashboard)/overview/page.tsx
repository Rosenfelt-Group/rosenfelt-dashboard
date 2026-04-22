"use client";
import { useEffect, useState, useCallback } from "react";
import { StatCard } from "@/components/StatCard";
import { AgentBadge } from "@/components/AgentBadge";
import { ApprovalCard } from "@/components/ApprovalCard";
import { DashboardStats, WorkflowLog, PendingApproval, AgentStatus } from "@/types";
import { formatDistanceToNow } from "date-fns";
import clsx from "clsx";
import Link from "next/link";

export default function OverviewPage() {
  const [stats,       setStats]       = useState<DashboardStats | null>(null);
  const [activity,    setActivity]    = useState<WorkflowLog[]>([]);
  const [approvals,   setApprovals]   = useState<PendingApproval[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentStatus[]>([]);
  const [loading,     setLoading]     = useState(true);

  const load = useCallback(async () => {
    const [s, a, ap, ag] = await Promise.all([
      fetch("/api/stats").then(r => r.json()),
      fetch("/api/activity").then(r => r.json()),
      fetch("/api/approvals").then(r => r.json()),
      fetch("/api/agent-status").then(r => r.json()),
    ]);
    setStats(s);
    setActivity(Array.isArray(a) ? a : []);
    setApprovals(Array.isArray(ap) ? ap : []);
    setAgentStatus(Array.isArray(ag) ? ag : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [load]);

  async function handleApproval(id: string, status: "approved" | "rejected") {
    await fetch("/api/approvals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    setApprovals(prev => prev.filter(a => a.id !== id));
    setStats(prev => prev
      ? { ...prev, pending_approvals: Math.max(0, prev.pending_approvals - 1) }
      : prev
    );
  }

  if (loading) {
    return (
      <div className="p-4 md:p-8">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card animate-pulse h-20" />
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          {[1,2,3].map(i => <div key={i} className="card animate-pulse h-20" />)}
        </div>
      </div>
    );
  }

  const now     = new Date();
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="p-4 md:p-8 max-w-6xl pb-24 md:pb-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold text-brand-black">Overview</h1>
          <p className="text-sm text-brand-muted mt-0.5">{dateStr}</p>
        </div>
        {stats && stats.pending_approvals > 0 && (
          <Link href="/approvals"
            className="px-3 py-1 bg-red-50 text-red-700 rounded-full text-sm font-medium hover:bg-red-100 transition-colors">
            {stats.pending_approvals} approval{stats.pending_approvals !== 1 ? "s" : ""} waiting →
          </Link>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <StatCard label="Active agents"    value="3 / 3"                        sub="all online" />
        <StatCard label="Executions today" value={stats?.executions_today ?? 0} sub={`${stats?.errors_today ?? 0} errors`}          warn={(stats?.errors_today ?? 0) > 0} />
        <StatCard label="Open tasks"       value={stats?.open_tasks ?? 0}        sub={stats?.overdue_tasks ? `${stats.overdue_tasks} overdue` : "none overdue"} alert={(stats?.overdue_tasks ?? 0) > 0} />
        <StatCard label="Approvals"        value={stats?.pending_approvals ?? 0} sub="waiting"                                       alert={(stats?.pending_approvals ?? 0) > 0} />
        <StatCard label="Content queue"    value={stats?.content_queue ?? 0}     sub="ideas queued" />
        <StatCard label="API cost today"   value="$0.00"                         sub="connect LiteLLM" />
      </div>

      {/* Agent status row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {agentStatus.map(a => (
          <div key={a.agent} className="card flex items-center gap-3">
            <AgentBadge agent={a.agent} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-brand-black capitalize">{a.agent}</p>
              <p className="text-xs text-brand-muted truncate">
                {a.executions_24h} executions · {a.errors_24h} errors (24h)
              </p>
            </div>
            <div className={clsx(
              "w-2 h-2 rounded-full flex-shrink-0",
              a.errors_24h > 0 ? "bg-amber-400" : "bg-green-400"
            )} />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending approvals */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-brand-black">
              Needs your approval
              {approvals.length > 0 && (
                <span className="ml-2 text-xs text-brand-muted font-normal">{approvals.length} pending</span>
              )}
            </h2>
            {approvals.length > 0 && (
              <Link href="/approvals" className="text-xs text-brand-orange hover:underline">View all →</Link>
            )}
          </div>
          {approvals.length === 0 ? (
            <div className="card text-center py-8">
              <p className="text-sm text-brand-muted">No pending approvals</p>
              <p className="text-xs text-brand-muted mt-1">Agents are running autonomously</p>
            </div>
          ) : (
            <div className="space-y-3">
              {approvals.slice(0, 3).map(a => (
                <ApprovalCard key={a.id} approval={a} onAction={handleApproval} />
              ))}
              {approvals.length > 3 && (
                <Link href="/approvals"
                  className="block text-center text-xs text-brand-orange py-2 hover:underline">
                  +{approvals.length - 3} more waiting →
                </Link>
              )}
            </div>
          )}
        </div>

        {/* Recent activity */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-brand-black">Recent activity</h2>
            <Link href="/agents/history" className="text-xs text-brand-orange hover:underline">View all →</Link>
          </div>
          {activity.length === 0 ? (
            <div className="card text-center py-8">
              <p className="text-sm text-brand-muted">No recent activity</p>
            </div>
          ) : (
            <div className="card p-0 overflow-hidden">
              {activity.slice(0, 8).map((log, i) => (
                <div key={log.id}
                  className={clsx(
                    "flex items-center gap-3 px-4 py-3 text-sm",
                    i !== 0 && "border-t border-brand-border"
                  )}>
                  <div className={clsx(
                    "w-1.5 h-1.5 rounded-full flex-shrink-0",
                    log.status === "success" ? "bg-green-400" :
                    log.status === "error"   ? "bg-red-400"   : "bg-amber-400"
                  )} />
                  <AgentBadge agent={log.agent} size="sm" />
                  <span className="flex-1 text-brand-black truncate text-xs md:text-sm">
                    {log.workflow_name ?? "Unknown workflow"}
                    {log.status === "error" && log.error_message && (
                      <span className="text-red-600 ml-1 text-xs">— {log.error_message.slice(0, 40)}</span>
                    )}
                  </span>
                  <span className="text-xs text-brand-muted flex-shrink-0">
                    {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
