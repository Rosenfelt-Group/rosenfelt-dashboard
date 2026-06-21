"use client";
import { useEffect, useState, useCallback } from "react";
import { AgentBadge } from "@/components/AgentBadge";
import { ApprovalCard } from "@/components/ApprovalCard";
import { StatCard } from "@/components/StatCard";
import { DashboardStats, WorkflowLog, PendingApproval, AgentStatus } from "@/types";
import { formatDistanceToNow } from "date-fns";
import clsx from "clsx";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function OverviewPage() {
  const [stats,       setStats]       = useState<DashboardStats | null>(null);
  const [activity,    setActivity]    = useState<WorkflowLog[]>([]);
  const [approvals,   setApprovals]   = useState<PendingApproval[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentStatus[]>([]);
  const [costToday,   setCostToday]   = useState<number | null>(null);
  const [loading,     setLoading]     = useState(true);

  const load = useCallback(async () => {
    const [s, a, ap, ag, usage] = await Promise.all([
      fetch("/api/stats").then(r => r.json()),
      fetch("/api/activity").then(r => r.json()),
      fetch("/api/approvals").then(r => r.json()),
      fetch("/api/agent-status").then(r => r.json()),
      fetch("/api/usage?days=1").then(r => r.json()).catch(() => null),
    ]);
    setStats(s);
    setActivity(Array.isArray(a) ? a : []);
    setApprovals(Array.isArray(ap) ? ap : []);
    setAgentStatus(Array.isArray(ag) ? ag : []);
    if (usage?.agents) {
      const total = (usage.agents as { todayCost: number }[]).reduce((sum, ag) => sum + ag.todayCost, 0);
      setCostToday(total);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // Stats are multi-table aggregates — keep polling for those.
    // Approvals and activity are handled by Realtime below.
    const interval = setInterval(load, 120_000);

    const channel = supabase
      .channel("overview-changes")
      // New approval from an agent → add to list and bump count
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "pending_approvals" },
        (payload) => {
          const row = payload.new as PendingApproval;
          if (row.status !== "pending") return;
          setApprovals(prev => [row, ...prev]);
          setStats(prev => prev
            ? { ...prev, pending_approvals: prev.pending_approvals + 1 }
            : prev
          );
        }
      )
      // Approval resolved (approved/rejected/expired) → remove from list and decrement count
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "pending_approvals" },
        (payload) => {
          const row = payload.new as PendingApproval;
          if (row.status === "pending") return;
          setApprovals(prev => {
            const wasPresent = prev.some(a => a.id === row.id);
            if (!wasPresent) return prev;
            setStats(s => s
              ? { ...s, pending_approvals: Math.max(0, s.pending_approvals - 1) }
              : s
            );
            return prev.filter(a => a.id !== row.id);
          });
        }
      )
      // New token usage row → add cost to today's running total
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "token_usage" },
        (payload) => {
          const row = payload.new as { cost_usd: string; created_at: string };
          const todayDate = new Date().toISOString().slice(0, 10);
          if (row.created_at.slice(0, 10) === todayDate) {
            setCostToday(prev => (prev ?? 0) + Number(row.cost_usd ?? 0));
          }
        }
      )
      // New workflow execution → prepend to activity feed and update agent stats + counters
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "workflow_logs" },
        (payload) => {
          const row = payload.new as WorkflowLog;
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          const isToday = new Date(row.created_at) >= todayStart;

          setActivity(prev => [row, ...prev].slice(0, 20));

          if (isToday) {
            setStats(prev => prev ? {
              ...prev,
              executions_today: prev.executions_today + 1,
              errors_today: prev.errors_today + (row.status === "error" ? 1 : 0),
            } : prev);
          }

          setAgentStatus(prev => prev.map(a => {
            if (a.agent !== row.agent) return a;
            const isRecent = new Date(row.created_at) >= new Date(Date.now() - 24 * 60 * 60 * 1000);
            if (!isRecent) return a;
            return {
              ...a,
              executions_24h: a.executions_24h + 1,
              errors_24h:     a.errors_24h + (row.status === "error" ? 1 : 0),
              last_execution: row.created_at,
              last_status:    row.status,
            };
          }));
        }
      )
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [load]);

  async function handleApproval(id: string, status: "approved" | "rejected" | "revision_requested", revisionNotes?: string) {
    await fetch("/api/approvals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, revision_notes: revisionNotes }),
    });
    setApprovals(prev => prev.filter(a => a.id !== id));
    setStats(prev => prev
      ? { ...prev, pending_approvals: Math.max(0, prev.pending_approvals - 1) }
      : prev
    );
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  if (loading) {
    return (
      <div className="p-4 md:p-8">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card animate-pulse h-20" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl pb-24 md:pb-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-brand-black">{greeting}</h1>
        <p className="text-sm text-brand-muted mt-0.5">
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </p>
      </div>

      {/* Agent status strip */}
      <div className="card p-3 mb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-medium text-brand-muted uppercase tracking-wider pr-1">Agents</span>
          {agentStatus.map(a => (
            <div key={a.agent} className="flex items-center gap-1.5">
              <div className={clsx(
                "w-1.5 h-1.5 rounded-full",
                a.errors_24h > 0 ? "bg-amber-400" : "bg-green-400"
              )} />
              <span className="text-xs capitalize text-brand-black">{a.agent}</span>
              <span className="text-xs text-brand-muted">
                {a.executions_24h}x · {a.errors_24h} err
              </span>
            </div>
          ))}
          {costToday !== null && (
            <>
              <div className="flex-1" />
              <span className="text-xs text-brand-muted">API cost today: ${costToday.toFixed(4)}</span>
            </>
          )}
        </div>
      </div>

      {/* Stats summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Open work items"
          value={stats?.open_tasks ?? 0}
          warn={(stats?.overdue_tasks ?? 0) > 0}
        />
        <StatCard
          label="Overdue"
          value={stats?.overdue_tasks ?? 0}
          alert={(stats?.overdue_tasks ?? 0) > 0}
        />
        <StatCard
          label="Runs today"
          value={stats?.executions_today ?? 0}
        />
        <StatCard
          label="Errors today"
          value={stats?.errors_today ?? 0}
          alert={(stats?.errors_today ?? 0) > 0}
        />
      </div>

      {/* Module tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        {[
          {
            label: "Control Center",
            href: "/control-center",
            iconPath: "M22 12h-4l-3 9L9 3l-3 9H2",
            desc: "System status · Work items",
            badge: (stats?.errors_today ?? 0) > 0 ? `${stats?.errors_today} errors` : null,
            badgeColor: "text-red-600 bg-red-50",
          },
          {
            label: "Documents",
            href: "/documents",
            iconPath: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z",
            desc: "Docs · Images · Reports",
            badge: null,
            badgeColor: "",
          },
          {
            label: "Sales & Marketing",
            href: "/sales",
            iconPath: "M23 6 13.5 15.5 8.5 10.5 1 18M17 6h6v6",
            desc: "CRM · Content · Research",
            badge: null,
            badgeColor: "",
          },
          {
            label: "Agent Central",
            href: "/agent-central",
            iconPath: "M9.5 2a2.5 2.5 0 0 1 5 0M12 6v6M9 9h6",
            desc: "5 agents · Chat · History",
            badge: null,
            badgeColor: "",
          },
          {
            label: "Finance",
            href: "/finance",
            iconPath: "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
            desc: "AI cost · Transactions",
            badge: null,
            badgeColor: "",
          },
          {
            label: "Tools",
            href: "/tools",
            iconPath: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.8 2.8-2.4-2.4z",
            desc: "Backup · Users · SQL",
            badge: null,
            badgeColor: "",
          },
        ].map(tile => (
          <Link
            key={tile.href}
            href={tile.href}
            className="card flex flex-col gap-2 p-4 hover:border-brand-orange/40 hover:shadow-sm transition-all group"
          >
            <div className="flex items-start justify-between">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
                   className="text-brand-orange mt-0.5"
                   aria-hidden="true">
                <path d={tile.iconPath}/>
              </svg>
              {tile.badge && (
                <span className={clsx("text-[10px] font-medium px-1.5 py-0.5 rounded-full", tile.badgeColor)}>
                  {tile.badge}
                </span>
              )}
            </div>
            <div>
              <p className="text-sm font-semibold text-brand-black group-hover:text-brand-orange transition-colors">
                {tile.label}
              </p>
              <p className="text-xs text-brand-muted mt-0.5">{tile.desc}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Approvals + Activity — compact two-column */}
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
            <div className="card text-center py-6">
              <p className="text-sm text-brand-muted">No pending approvals</p>
            </div>
          ) : (
            <div className="space-y-3">
              {approvals.slice(0, 2).map(a => (
                <ApprovalCard key={a.id} approval={a} onAction={handleApproval} />
              ))}
              {approvals.length > 2 && (
                <Link href="/approvals"
                  className="block text-center text-xs text-brand-orange py-2 hover:underline">
                  +{approvals.length - 2} more →
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
            <div className="card text-center py-6">
              <p className="text-sm text-brand-muted">No recent activity</p>
            </div>
          ) : (
            <div className="card p-0 overflow-hidden">
              {activity.slice(0, 6).map((log, i) => (
                <div key={log.id}
                  className={clsx(
                    "flex items-center gap-3 px-4 py-2.5 text-sm",
                    i !== 0 && "border-t border-brand-border"
                  )}>
                  <div className={clsx(
                    "w-1.5 h-1.5 rounded-full flex-shrink-0",
                    log.status === "success" ? "bg-green-400" :
                    log.status === "error"   ? "bg-red-400"   : "bg-amber-400"
                  )} />
                  <AgentBadge agent={log.agent} size="sm" />
                  <span className="flex-1 text-brand-black truncate text-xs">
                    {log.workflow_name ?? "Unknown workflow"}
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
