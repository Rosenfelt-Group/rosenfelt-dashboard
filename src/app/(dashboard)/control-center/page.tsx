// src/app/(dashboard)/control-center/page.tsx
"use client";
import { useEffect, useState, useCallback } from "react";
import { CollapsibleCard } from "@/components/CollapsibleCard";
import Link from "next/link";
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";
import { AgentBadge } from "@/components/AgentBadge";
import { Agent } from "@/types";

// Static cron job schedule (from APScheduler configs in each agent)
const CRON_JOBS: { agent: Agent; name: string; schedule: string; active: boolean }[] = [
  { agent: "riley",  name: "Weekly digest",        schedule: "Mon 06:00 ET",          active: true },
  { agent: "avery",  name: "Content Intel Monitor", schedule: "Wed 06:00 ET",          active: true },
  { agent: "casey",  name: "Full audit",            schedule: "Sun 07:00 ET",          active: true },
  { agent: "casey",  name: "Regression suite",      schedule: "Sun 08:00 ET",          active: true },
  { agent: "sam",    name: "Monthly financial",     schedule: "1st of month 08:00 ET", active: true },
];

// Services to health-check via the agent-status/health API
const SERVICES = [
  { id: "jordan",    label: "Jordan Agent",  type: "agent"   },
  { id: "riley",     label: "Riley Agent",   type: "agent"   },
  { id: "avery",     label: "Avery Agent",   type: "agent"   },
  { id: "casey",     label: "Casey Agent",   type: "agent"   },
  { id: "sam",       label: "Sam Agent",     type: "agent"   },
  { id: "dashboard", label: "Dashboard",     type: "web"     },
  { id: "wp",        label: "Website (WP)",  type: "web"     },
  { id: "docs-mcp",  label: "Docs MCP",      type: "service" },
];

interface ActivityLog {
  id: string;
  agent: string;
  workflow_name: string | null;
  status: string;
  created_at: string;
}

export default function ControlCenterPage() {
  const [agentHealth,   setAgentHealth]   = useState<Record<string, string>>({});
  const [activity,      setActivity]      = useState<ActivityLog[]>([]);
  const [approvalCount, setApprovalCount] = useState<number>(0);
  const [loading,       setLoading]       = useState(true);

  const load = useCallback(async () => {
    const [health, act, appr] = await Promise.all([
      fetch("/api/agent-status/health").then(r => r.json()).catch(() => ({})),
      fetch("/api/activity").then(r => r.json()).catch(() => []),
      fetch("/api/approvals").then(r => r.json()).catch(() => []),
    ]);
    setAgentHealth(typeof health === "object" && health !== null ? health : {});
    setActivity(Array.isArray(act) ? act.slice(0, 10) : []);
    setApprovalCount(Array.isArray(appr) ? appr.length : 0);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  if (loading) {
    return (
      <div className="p-4 md:p-8">
        <div className="space-y-4">
          {[1, 2, 3].map(i => <div key={i} className="card animate-pulse h-32" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl pb-24 md:pb-8">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <h1 className="text-xl font-semibold text-brand-black">Control Center</h1>
        <div className="flex gap-2 flex-wrap">
          {approvalCount > 0 && (
            <Link href="/approvals"
              className="px-3 py-1 bg-red-50 text-red-700 rounded-full text-sm font-medium hover:bg-red-100 transition-colors">
              {approvalCount} approval{approvalCount !== 1 ? "s" : ""} waiting →
            </Link>
          )}
          <Link href="/work"
            className="px-3 py-1.5 rounded-lg border border-brand-border text-sm text-brand-muted hover:bg-brand-offwhite hover:text-brand-black transition-colors">
            Work board →
          </Link>
          <Link href="/approvals"
            className="px-3 py-1.5 rounded-lg border border-brand-border text-sm text-brand-muted hover:bg-brand-offwhite hover:text-brand-black transition-colors">
            All approvals →
          </Link>
        </div>
      </div>

      <div className="space-y-4">

        {/* Infrastructure status */}
        <CollapsibleCard title="Infrastructure" badge={SERVICES.length}>
          <div className="divide-y divide-brand-border">
            {SERVICES.map(svc => {
              const health = agentHealth[svc.id];
              const status = svc.type === "agent"
                ? (health === "ok" ? "ok" : health === "error" ? "down" : "checking")
                : "ok";
              return (
                <div key={svc.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className={clsx(
                      "w-2 h-2 rounded-full flex-shrink-0",
                      status === "ok"       ? "bg-green-400" :
                      status === "down"     ? "bg-red-400"   :
                                             "bg-gray-300 animate-pulse"
                    )} />
                    <span className="text-sm text-brand-black">{svc.label}</span>
                    <span className="text-xs text-brand-muted capitalize">{svc.type}</span>
                  </div>
                  <span className={clsx(
                    "text-xs font-medium",
                    status === "ok"       ? "text-green-600"   :
                    status === "down"     ? "text-red-600"     :
                                           "text-brand-muted"
                  )}>
                    {status === "checking" ? "checking…" : status}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="px-4 py-3 border-t border-brand-border">
            <Link href="/status" className="text-xs text-brand-orange hover:underline">
              Full agent diagnostics →
            </Link>
          </div>
        </CollapsibleCard>

        {/* Scheduled jobs */}
        <CollapsibleCard title="Scheduled Jobs" badge={CRON_JOBS.length}>
          <div className="divide-y divide-brand-border">
            {CRON_JOBS.map((job, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <AgentBadge agent={job.agent} size="sm" />
                  <span className="text-sm text-brand-black">{job.name}</span>
                </div>
                <span className="text-xs text-brand-muted">{job.schedule}</span>
              </div>
            ))}
          </div>
          <div className="px-4 py-3 border-t border-brand-border">
            <div className="flex flex-wrap gap-4 text-xs text-brand-muted">
              <span>Manual triggers:</span>
              <code className="text-brand-black font-mono">POST .../digest/run</code>
              <code className="text-brand-black font-mono">POST .../monitor/run</code>
            </div>
          </div>
        </CollapsibleCard>

        {/* Recent activity */}
        <CollapsibleCard title="Recent Workflow Activity">
          {activity.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-brand-muted">No recent activity</div>
          ) : (
            <div className="divide-y divide-brand-border">
              {activity.map(log => (
                <div key={log.id} className="flex items-center gap-3 px-4 py-3">
                  <div className={clsx(
                    "w-1.5 h-1.5 rounded-full flex-shrink-0",
                    log.status === "success" ? "bg-green-400" :
                    log.status === "error"   ? "bg-red-400"   : "bg-amber-400"
                  )} />
                  <AgentBadge agent={log.agent as Agent} size="sm" />
                  <span className="flex-1 text-xs text-brand-black truncate">
                    {log.workflow_name ?? "Unknown workflow"}
                  </span>
                  <span className="text-xs text-brand-muted flex-shrink-0">
                    {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="px-4 py-3 border-t border-brand-border">
            <Link href="/agents/history" className="text-xs text-brand-orange hover:underline">
              Full history →
            </Link>
          </div>
        </CollapsibleCard>

        {/* Quick links */}
        <CollapsibleCard title="Operations Links">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4">
            {[
              { label: "Work Board",        href: "/work",                     desc: "Kanban + task queue" },
              { label: "Approvals",         href: "/approvals",                desc: "Pending agent actions" },
              { label: "Agent History",     href: "/agents/history",           desc: "Workflow execution log" },
              { label: "Agent Prompts",     href: "/agents/agent-prompts",     desc: "Live prompt editor" },
              { label: "Engineering",       href: "/engineering",              desc: "SSH terminal (Jordan)" },
              { label: "Backup",            href: "/backup",                   desc: "VPS backup tools" },
            ].map(link => (
              <Link key={link.href} href={link.href}
                className="flex flex-col gap-1 p-3 rounded-lg border border-brand-border hover:border-brand-orange/40 hover:bg-brand-offwhite/50 transition-all">
                <span className="text-sm font-medium text-brand-black">{link.label}</span>
                <span className="text-xs text-brand-muted">{link.desc}</span>
              </Link>
            ))}
          </div>
        </CollapsibleCard>

      </div>
    </div>
  );
}
