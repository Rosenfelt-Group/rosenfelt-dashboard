"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { AgentBadge } from "@/components/AgentBadge";
import { AgentStatusCard, deriveAgentStatus } from "@/components/AgentStatusCard";
import { ApprovalCard } from "@/components/ApprovalCard";
import { StatCard } from "@/components/StatCard";
import { CollapsibleCard } from "@/components/CollapsibleCard";
import { DashboardStats, WorkflowLog, PendingApproval, AgentStatus, Agent } from "@/types";
import { formatDistanceToNow } from "date-fns";
import clsx from "clsx";
import Link from "next/link";
import { usePolling } from "@/lib/use-polling";
import { ErrorState, PageHeader } from "@/components/ui";

interface RawNote {
  id: string;
  agent: string | null;
  message: string;
  urgency: string;
  read_at: string | null;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

type AlertNote = {
  id: string;
  agent: string | null;
  message: string;
  urgency: string;
};

export default function OverviewPage() {
  const [stats,       setStats]       = useState<DashboardStats | null>(null);
  const [activity,    setActivity]    = useState<WorkflowLog[]>([]);
  const [approvals,   setApprovals]   = useState<PendingApproval[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentStatus[]>([]);
  const [costToday,   setCostToday]   = useState<number | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [alerts,      setAlerts]      = useState<AlertNote[]>([]);
  const [loadError,   setLoadError]   = useState(false);
  const dismissedIdsRef = useRef<Set<string>>(new Set());
  const loadedOnceRef   = useRef(false);

  const load = useCallback(async () => {
    try {
      await loadAll();
    } catch (e) {
      // Keep whatever is already on screen; the next poll retries.
      console.error("Overview load failed:", e);
      // Nothing on screen yet: say so instead of rendering empty cards.
      if (!loadedOnceRef.current) setLoadError(true);
      setLoading(false);
    }

    async function loadAll() {
    const [s, a, ap, ag, usage, notifRes] = await Promise.all([
      fetch("/api/stats").then(r => r.json()),
      fetch("/api/activity").then(r => r.json()),
      fetch("/api/approvals").then(r => r.json()),
      fetch("/api/agent-status").then(r => r.json()),
      fetch("/api/usage?days=1").then(r => r.json()).catch(() => null),
      fetch("/api/notifications").then(r => r.json()).catch(() => ({ notifications: [] })),
    ]);
    setStats(s);
    setActivity(Array.isArray(a) ? a : []);
    setApprovals(Array.isArray(ap) ? ap : []);
    setAgentStatus(Array.isArray(ag) ? ag : []);
    if (usage?.agents) {
      const total = (usage.agents as { todayCost: number }[]).reduce((sum, ag) => sum + ag.todayCost, 0);
      setCostToday(total);
    }
    loadedOnceRef.current = true;
    setLoadError(false);
    setLoading(false);
    const rawNotes: RawNote[] = notifRes.notifications ?? [];
    setAlerts(
      rawNotes
        .filter(n => n.urgency === "high" && !n.read_at && !dismissedIdsRef.current.has(n.id))
        .map(({ id, agent, message, urgency }) => ({ id, agent, message, urgency }))
        .slice(0, 3)
    );
    }
  }, []);

  // Everything on this page comes from server routes; refresh it all on a
  // short interval while the tab is visible.
  useEffect(() => { load(); }, [load]);
  usePolling(load, 30_000);

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

  async function dismissAlert(id: string) {
    dismissedIdsRef.current.add(id);
    setAlerts(prev => prev.filter(n => n.id !== id));
    await fetch(`/api/notifications/${id}`, { method: "PATCH" });
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

  const header = (
    <PageHeader
      title={greeting}
      description={new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
    />
  );

  if (loadError) {
    return (
      <div className="p-4 md:p-8 max-w-6xl pb-24 md:pb-8">
        {header}
        <ErrorState
          message="Couldn't load the overview. It will retry automatically."
          onRetry={() => { setLoading(true); load(); }}
        />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl pb-24 md:pb-8">
      {header}

      {/* Global alert banners */}
      {alerts.length > 0 && (
        <div className="space-y-2 mb-4">
          {alerts.map(alert => (
            <div
              key={alert.id}
              className="flex items-start gap-3 px-4 py-3 rounded-lg border border-red-200 bg-red-50 text-sm"
            >
              {alert.agent && (
                <AgentBadge agent={alert.agent as Agent} size="sm" />
              )}
              <span className="flex-1 text-red-800">
                {stripTags(alert.message)}
              </span>
              <button
                onClick={() => dismissAlert(alert.id)}
                className="text-red-400 hover:text-red-600 flex-shrink-0 mt-0.5"
                aria-label="Dismiss"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Active agents"
          value={`${agentStatus.filter(a => deriveAgentStatus(a) !== "idle").length}/${agentStatus.length || 5}`}
        />
        <StatCard
          label="Pending approvals"
          value={stats?.pending_approvals ?? 0}
          warn={(stats?.pending_approvals ?? 0) > 0}
        />
        <StatCard
          label="Leads this week"
          value={stats?.leads_this_week ?? 0}
        />
        <StatCard
          label="Content published"
          value={stats?.content_published_this_week ?? 0}
          sub="last 7 days"
        />
      </div>

      {/* Agent status at a glance */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="text-sm font-semibold text-brand-black">Agents</h2>
          {costToday !== null && (
            <span className="text-xs text-brand-muted">API cost today: ${costToday.toFixed(4)}</span>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          {agentStatus.map(a => <AgentStatusCard key={a.agent} status={a} />)}
        </div>
      </div>

      {/* Approvals + Activity — compact two-column */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CollapsibleCard
          title="Needs your approval"
          badge={approvals.length > 0 ? approvals.length : undefined}
          defaultOpen={true}
          action={
            approvals.length > 0
              ? <Link href="/approvals" className="text-xs text-brand-orange hover:underline">View all →</Link>
              : undefined
          }
        >
          <div className="p-4">
            {approvals.length === 0 ? (
              <p className="text-sm text-brand-muted text-center py-2">No pending approvals</p>
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
        </CollapsibleCard>

        <CollapsibleCard
          title="Recent activity"
          defaultOpen={true}
          action={
            <Link href="/agents/history" className="text-xs text-brand-orange hover:underline">View all →</Link>
          }
        >
          {activity.length === 0 ? (
            <div className="p-4 text-center">
              <p className="text-sm text-brand-muted">No recent activity</p>
            </div>
          ) : (
            <div className="overflow-hidden">
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
        </CollapsibleCard>
      </div>
    </div>
  );
}
