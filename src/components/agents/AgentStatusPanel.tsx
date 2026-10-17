"use client";
import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { EmptyState, ErrorState } from "@/components/ui";
import { fetchJson } from "@/lib/fetch-json";
import { usePolling } from "@/lib/use-polling";
import type { AgentName } from "@/lib/agents";
import { AgentHealthPill } from "./AgentHealthPill";
import { LogRow, type WorkflowLogExtended } from "./AgentHistory";
import { useAgentOverview, type AgentHealthRow } from "./use-agent-overview";

const RECENT_RUNS = 10;

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "bad" }) {
  return (
    <div className="card py-3 px-4 min-w-0">
      <p className="text-xs text-brand-muted mb-1">{label}</p>
      <p className={tone === "bad" ? "text-xl font-semibold text-red-600" : "text-xl font-semibold text-brand-black"}>
        {value}
      </p>
    </div>
  );
}

/** Health, latency, 24h counts and the most recent runs for one agent. */
export function AgentStatusPanel({ agent }: { agent: AgentName }) {
  const overview = useAgentOverview();
  const s = overview.statusFor(agent);
  const h: AgentHealthRow | undefined = overview.healthLoaded
    ? overview.healthFor(agent) ?? { agent, status: "unknown", latency_ms: null, detail: null, error: "No health result" }
    : undefined;

  const [runs,       setRuns]       = useState<WorkflowLogExtended[]>([]);
  const [runsLoaded, setRunsLoaded] = useState(false);
  const [runsError,  setRunsError]  = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    const r = await fetchJson<WorkflowLogExtended[]>("/api/agent-history");
    if (r.ok) {
      const all = Array.isArray(r.data) ? r.data : [];
      setRuns(all.filter(l => l.agent === agent).slice(0, RECENT_RUNS));
      setRunsError(null);
    } else {
      setRunsError(r.error);
    }
    setRunsLoaded(true);
  }, [agent]);

  useEffect(() => { loadRuns(); }, [loadRuns]);
  usePolling(loadRuns, 60_000);

  return (
    <div className="space-y-5">
      {overview.error && (
        <ErrorState message={`Couldn't load agent status: ${overview.error}`} onRetry={overview.reload} />
      )}

      <div className="card p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-brand-black">Server</span>
          <AgentHealthPill health={h} />
        </div>
        <div className="text-xs text-brand-muted min-w-0 break-words">
          {h?.error ? <span className="text-red-600">{h.error}</span> : h ? "Responding to /health" : "Checking…"}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Latency" value={h?.latency_ms != null ? `${h.latency_ms}ms` : "—"} />
        <Stat label="Runs (24h)" value={overview.loading ? "…" : s?.executions_24h ?? 0} />
        <Stat
          label="Errors (24h)"
          value={overview.loading ? "…" : s?.errors_24h ?? 0}
          tone={(s?.errors_24h ?? 0) > 0 ? "bad" : undefined}
        />
        <Stat
          label="Last run"
          value={
            <span className="text-sm">
              {s?.last_execution ? formatDistanceToNow(new Date(s.last_execution), { addSuffix: true }) : "—"}
            </span>
          }
        />
      </div>

      <div>
        <h2 className="text-sm font-semibold text-brand-black mb-2">Recent runs</h2>
        {runsError && runs.length === 0 ? (
          <ErrorState message={`Couldn't load recent runs: ${runsError}`} onRetry={loadRuns} />
        ) : !runsLoaded ? (
          <div className="card animate-pulse h-32" />
        ) : runs.length === 0 ? (
          <EmptyState title="No recent runs" description="Older runs may be in the History tab." />
        ) : (
          <div className="card p-0 overflow-hidden">
            {runs.map(log => <LogRow key={log.id} log={log} showAgent={false} />)}
          </div>
        )}
      </div>
    </div>
  );
}
