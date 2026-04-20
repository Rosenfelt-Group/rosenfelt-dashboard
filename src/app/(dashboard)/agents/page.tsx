"use client";
import { useEffect, useState } from "react";
import { WorkflowLog, AgentStatus, Agent } from "@/types";
import { AgentBadge } from "@/components/AgentBadge";
import { formatDistanceToNow } from "date-fns";
import clsx from "clsx";
import Link from "next/link";

export default function AgentsPage() {
  const [status, setStatus] = useState<AgentStatus[]>([]);
  const [logs, setLogs] = useState<WorkflowLog[]>([]);
  const [filter, setFilter] = useState<Agent | "all">("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/agent-status").then(r => r.json()),
      fetch("/api/activity").then(r => r.json()),
    ]).then(([s, l]) => {
      setStatus(s);
      setLogs(l);
      setLoading(false);
    });
  }, []);

  const filtered = filter === "all" ? logs : logs.filter(l => l.agent === filter);

  if (loading) return <div className="p-8"><div className="card animate-pulse h-64" /></div>;

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-brand-black">Agents</h1>
        <p className="text-sm text-brand-muted mt-0.5">Activity and health over the last 24 hours</p>
      </div>

      {/* Agent status cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {status.map(a => (
          <div key={a.agent} className="card">
            <div className="flex items-center gap-3 mb-3">
              <AgentBadge agent={a.agent} />
              <div>
                <p className="text-sm font-medium text-brand-black capitalize">{a.agent}</p>
                <p className="text-xs text-brand-muted">
                  {a.last_execution
                    ? `Last active ${formatDistanceToNow(new Date(a.last_execution), { addSuffix: true })}`
                    : "No recent activity"}
                </p>
              </div>
              <div className={clsx(
                "ml-auto w-2 h-2 rounded-full",
                a.errors_24h > 2 ? "bg-red-400" :
                a.errors_24h > 0 ? "bg-amber-400" : "bg-green-400"
              )} />
            </div>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="bg-brand-offwhite rounded-lg p-2">
                <p className="text-lg font-semibold text-brand-black">{a.executions_24h}</p>
                <p className="text-xs text-brand-muted">executions</p>
              </div>
              <div className={clsx("rounded-lg p-2", a.errors_24h > 0 ? "bg-red-50" : "bg-brand-offwhite")}>
                <p className={clsx("text-lg font-semibold", a.errors_24h > 0 ? "text-red-600" : "text-brand-black")}>
                  {a.errors_24h}
                </p>
                <p className="text-xs text-brand-muted">errors</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Execution log */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-brand-black">Execution log</h2>
          <div className="flex items-center gap-3">
            <Link href="/agents/history" className="text-xs text-brand-orange hover:underline">
             View full history →
            </Link>
            <div className="flex gap-1">
            {(["all", "riley", "jordan", "avery"] as const).map(a => (
              <button
                key={a}
                onClick={() => setFilter(a)}
                className={clsx(
                  "px-3 py-1 rounded-full text-xs transition-colors",
                  filter === a
                    ? "bg-brand-orange text-white"
                    : "bg-brand-offwhite text-brand-muted hover:bg-brand-border"
                )}
              >
                {a}
              </button>
            ))}
          </div>
          </div>
        </div>

        <div className="card p-0 overflow-hidden">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-brand-muted">No executions found</div>
          ) : (
            filtered.map((log, i) => (
              <div
                key={log.id}
                className={clsx(
                  "flex items-center gap-3 px-4 py-3 text-sm",
                  i !== 0 && "border-t border-brand-border"
                )}
              >
                <div className={clsx(
                  "w-1.5 h-1.5 rounded-full flex-shrink-0",
                  log.status === "success" ? "bg-green-400" :
                  log.status === "error"   ? "bg-red-400"   : "bg-amber-400"
                )} />
                <AgentBadge agent={log.agent} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-brand-black truncate">{log.workflow_name ?? "Unknown"}</p>
                  {log.status === "error" && log.error_message && (
                    <p className="text-xs text-red-600 truncate">{log.error_message}</p>
                  )}
                </div>
                {log.duration_ms && (
                  <span className="text-xs text-brand-muted flex-shrink-0">{log.duration_ms}ms</span>
                )}
                <span className="text-xs text-brand-muted flex-shrink-0">
                  {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
