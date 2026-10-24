"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { AgentBadge } from "@/components/AgentBadge";
import { ago } from "./helpers";

interface AgentHealth {
  agent: string;
  status: "up" | "down" | "unknown";
  latency_ms: number | null;
  detail: Record<string, unknown> | null;
  error: string | null;
}

interface AgentStat {
  agent: string;
  executions_24h: number;
  errors_24h: number;
  last_execution: string | null;
}

export function AgentsTab() {
  const [health, setHealth]       = useState<AgentHealth[]>([]);
  const [stats, setStats]         = useState<AgentStat[]>([]);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [loading, setLoading]     = useState(true);

  const load = useCallback(async () => {
    const [h, s] = await Promise.all([
      fetch("/api/agent-status/health").then(r => r.json()).catch(() => []),
      fetch("/api/agent-status").then(r => r.json()).catch(() => []),
    ]);
    setHealth(Array.isArray(h) ? h : []);
    setStats(Array.isArray(s) ? s : []);
    setCheckedAt(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  // "checks" is the scheduled checks service, not an agent: health only (its runs are not agent executions).
  const combined = ["jordan","riley","avery","casey","sam","checks"].map(name => ({
    health: health.find(h => h.agent === name),
    stat:   stats.find(s => s.agent === name),
    name,
  }));

  return (
    <div>
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-brand-border bg-brand-offwhite">
              <th className="text-left px-4 py-3 text-xs font-medium text-brand-muted">Agent</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-brand-muted">Status</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-brand-muted">Latency</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-brand-muted">24h Runs</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-brand-muted">Errors</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-brand-muted hidden sm:table-cell">Last Active</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [0,1,2,3,4,5].map(i => (
                <tr key={i} className="border-b border-brand-border last:border-0">
                  <td className="px-4 py-3"><div className="animate-pulse h-4 w-24 bg-brand-offwhite rounded"/></td>
                  <td className="px-4 py-3"><div className="animate-pulse h-4 w-12 bg-brand-offwhite rounded"/></td>
                  <td className="px-4 py-3"><div className="animate-pulse h-4 w-12 bg-brand-offwhite rounded ml-auto"/></td>
                  <td className="px-4 py-3"><div className="animate-pulse h-4 w-8 bg-brand-offwhite rounded ml-auto"/></td>
                  <td className="px-4 py-3"><div className="animate-pulse h-4 w-8 bg-brand-offwhite rounded ml-auto"/></td>
                  <td className="px-4 py-3 hidden sm:table-cell"><div className="animate-pulse h-4 w-16 bg-brand-offwhite rounded ml-auto"/></td>
                </tr>
              ))
            ) : (
              combined.map(({ name, health: h, stat: s }) => {
                const up   = h?.status === "up";
                const down = h?.status === "down";
                return (
                  <tr key={name} className="border-b border-brand-border last:border-0 hover:bg-brand-offwhite/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        {name === "checks" ? (
                          <span className="inline-flex items-center justify-center rounded-full font-medium w-5 h-5 text-xs bg-gray-100 text-gray-600">CK</span>
                        ) : (
                          <AgentBadge agent={name as "jordan"|"riley"|"avery"|"casey"|"sam"} size="sm" />
                        )}
                        <span className="font-medium text-brand-black capitalize">{name === "checks" ? "Checks service" : name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={clsx(
                        "badge text-xs px-2 py-0.5",
                        up ? "bg-green-50 text-green-700" : down ? "bg-red-50 text-red-700" : "bg-gray-100 text-gray-500"
                      )}>
                        {up ? "Up" : down ? "Down" : "Unknown"}
                      </span>
                      {h?.error && <span className="ml-2 text-[10px] text-red-500 truncate max-w-[160px] inline-block align-middle">{h.error}</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-brand-black tabular-nums">
                      {h?.latency_ms != null ? `${h.latency_ms} ms` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-brand-black tabular-nums">
                      {s?.executions_24h ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={clsx((s?.errors_24h ?? 0) > 0 ? "text-red-600 font-medium" : "text-brand-black")}>
                        {s?.errors_24h ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-brand-muted text-xs hidden sm:table-cell">
                      {s?.last_execution ? ago(s.last_execution) : "—"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between mt-2">
        <Link href="/agents?tab=activity" className="text-xs text-brand-orange hover:underline">
          View full execution history →
        </Link>
        {checkedAt && (
          <p className="text-[11px] text-brand-muted">
            Checked {checkedAt.toLocaleTimeString()} · refreshes every 60s
          </p>
        )}
      </div>
    </div>
  );
}
