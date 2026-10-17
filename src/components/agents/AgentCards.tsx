"use client";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { AgentBadge } from "@/components/AgentBadge";
import { ErrorState } from "@/components/ui";
import { AGENT_LIST } from "@/lib/agents";
import { AgentHealthPill } from "./AgentHealthPill";
import { useAgentOverview, type AgentHealthRow } from "./use-agent-overview";

const UNKNOWN_HEALTH = (agent: string): AgentHealthRow =>
  ({ agent, status: "unknown", latency_ms: null, detail: null, error: "No health result" });

/** One card per agent: reachability, 24h runs/errors, link to /agents/[name]. */
export function AgentCards() {
  const { loading, error, reload, statusFor, healthFor, healthLoaded } = useAgentOverview();

  return (
    <div>
      {error && (
        <ErrorState message={`Couldn't load agent status: ${error}`} onRetry={reload} className="mb-4" />
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {AGENT_LIST.map(a => <div key={a.name} className="card animate-pulse h-36" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {AGENT_LIST.map(a => {
            const s = statusFor(a.name);
            const h = healthLoaded ? healthFor(a.name) ?? UNKNOWN_HEALTH(a.name) : undefined;
            return (
              <Link
                key={a.name}
                href={`/agents/${a.name}`}
                className="card p-4 flex flex-col gap-3 hover:border-brand-orange/60 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <AgentBadge agent={a.name} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-brand-black">{a.label}</p>
                      <p className="text-xs text-brand-muted">port {a.port} · {a.tools} tools</p>
                    </div>
                  </div>
                  <AgentHealthPill health={h} />
                </div>

                <p className="text-xs text-brand-muted">{a.role}</p>

                <div className="flex gap-4 text-xs flex-wrap">
                  <span className="text-brand-muted">
                    <span className="text-brand-black font-medium">{s?.executions_24h ?? 0}</span> runs (24h)
                  </span>
                  <span className={(s?.errors_24h ?? 0) > 0 ? "text-red-600" : "text-brand-muted"}>
                    <span className="font-medium">{s?.errors_24h ?? 0}</span> errors
                  </span>
                  {h?.latency_ms != null && h.status === "up" && (
                    <span className="text-brand-muted">{h.latency_ms}ms</span>
                  )}
                </div>

                <div className="flex items-center justify-between mt-auto pt-1 text-[11px] text-brand-muted">
                  <span>
                    {s?.last_execution
                      ? `Last run ${formatDistanceToNow(new Date(s.last_execution), { addSuffix: true })}`
                      : "No runs in 24h"}
                  </span>
                  <span className="text-brand-orange font-medium">Open →</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
