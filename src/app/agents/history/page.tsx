"use client";
import { useEffect, useState } from "react";
import { WorkflowLog, Agent } from "@/types";
import clsx from "clsx";
import { formatDistanceToNow, parseISO } from "date-fns";

// Extend WorkflowLog locally to include actions_summary
type WorkflowLogExtended = WorkflowLog & { actions_summary?: string };

const AGENTS: Agent[] = ["riley", "jordan", "avery"];

const AGENT_COLORS: Record<string, string> = {
  riley:  "bg-purple-50 text-purple-700 border-purple-200",
  jordan: "bg-blue-50 text-blue-700 border-blue-200",
  avery:  "bg-green-50 text-green-700 border-green-200",
  brian:  "bg-orange-50 text-brand-orange border-orange-200",
  sam:    "bg-gray-50 text-gray-600 border-gray-200",
};

const STATUS_STYLES = {
  success: "bg-green-50 text-green-700",
  error:   "bg-red-50 text-red-700",
  pending: "bg-amber-50 text-amber-700",
};

const STATUS_DOT = {
  success: "bg-green-500",
  error:   "bg-red-500",
  pending: "bg-amber-400",
};

// Parse actions_summary into structured parts
function parseActionsSummary(summary?: string): { tools: string[]; response: string } {
  if (!summary) return { tools: [], response: "" };
  const toolMatch = summary.match(/Tools: ([^|]+)/);
  const responseMatch = summary.match(/Response: (.+)/);
  const tools = toolMatch
    ? toolMatch[1].split(",").map(t => t.trim()).filter(Boolean)
    : [];
  const response = responseMatch ? responseMatch[1].trim() : "";
  return { tools, response };
}

// Tool badge colors
function toolColor(tool: string): string {
  if (tool.startsWith("SSH") || tool.startsWith("Docker")) return "bg-slate-100 text-slate-700";
  if (tool.startsWith("n8n")) return "bg-violet-50 text-violet-700";
  if (tool.startsWith("WP")) return "bg-sky-50 text-sky-700";
  if (tool.startsWith("Supabase")) return "bg-emerald-50 text-emerald-700";
  return "bg-gray-100 text-gray-600";
}

function AgentChip({ agent }: { agent: string }) {
  return (
    <span className={clsx(
      "inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium capitalize",
      AGENT_COLORS[agent] ?? "bg-gray-50 text-gray-600 border-gray-200"
    )}>
      {agent}
    </span>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card py-4 px-5">
      <p className="text-xs text-brand-muted mb-1">{label}</p>
      <p className="text-2xl font-semibold text-brand-black">{value}</p>
      {sub && <p className="text-xs text-brand-muted mt-0.5">{sub}</p>}
    </div>
  );
}

function LogRow({ log }: { log: WorkflowLogExtended }) {
  const [expanded, setExpanded] = useState(false);
  const ago = formatDistanceToNow(parseISO(log.created_at), { addSuffix: true });
  const { tools, response } = parseActionsSummary(log.actions_summary);

  return (
    <div className="border-b border-brand-border last:border-0">
      <button
        className="w-full text-left px-4 py-3 hover:bg-brand-offwhite transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          {/* Status dot */}
          <span className={clsx("w-2 h-2 rounded-full flex-shrink-0", STATUS_DOT[log.status])} />

          {/* Workflow name + trigger */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-brand-black truncate">
                {log.trigger_text ?? "Unknown trigger"}
              </span>
            </div>
            {/* Tool badges inline */}
            {tools.length > 0 && (
              <div className="flex gap-1 flex-wrap mt-1">
                {tools.map((t, i) => (
                  <span key={i} className={clsx("text-[10px] px-1.5 py-0.5 rounded font-medium", toolColor(t))}>
                    {t}
                  </span>
                ))}
              </div>
            )}
            {/* Response snippet */}
            {response && !expanded && (
              <p className="text-xs text-brand-muted truncate mt-0.5">{response}</p>
            )}
          </div>

          {/* Agent chip */}
          <AgentChip agent={log.agent} />

          {/* Status badge */}
          <span className={clsx("text-xs px-2 py-0.5 rounded font-medium hidden sm:inline-flex", STATUS_STYLES[log.status])}>
            {log.status}
          </span>

          {/* Duration */}
          {log.duration_ms && (
            <span className="text-xs text-brand-muted hidden md:inline flex-shrink-0">
              {log.duration_ms < 1000 ? `${log.duration_ms}ms` : `${(log.duration_ms / 1000).toFixed(1)}s`}
            </span>
          )}

          {/* Time */}
          <span className="text-xs text-brand-muted flex-shrink-0">{ago}</span>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2 bg-brand-offwhite">
          {/* Full response */}
          {response && (
            <div>
              <p className="text-xs font-medium text-brand-muted mb-0.5">Response</p>
              <p className="text-xs text-brand-black bg-white rounded px-3 py-2 border border-brand-border">
                {response}
              </p>
            </div>
          )}
          {/* Tools detail */}
          {tools.length > 0 && (
            <div>
              <p className="text-xs font-medium text-brand-muted mb-1">Tools used</p>
              <div className="flex gap-1.5 flex-wrap">
                {tools.map((t, i) => (
                  <span key={i} className={clsx("text-xs px-2 py-1 rounded font-medium border", toolColor(t))}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
          {/* Error */}
          {log.error_message && (
            <div>
              <p className="text-xs font-medium text-red-600 mb-0.5">Error</p>
              <p className="text-xs text-red-700 bg-red-50 rounded px-3 py-2 border border-red-200 font-mono">
                {log.error_message}
              </p>
            </div>
          )}
          {/* Meta */}
          <div className="flex gap-4 text-xs text-brand-muted">
            {log.workflow_id  && <span>Workflow: <code className="text-brand-black">{log.workflow_id}</code></span>}
            {log.execution_id && <span>Execution: <code className="text-brand-black">{log.execution_id}</code></span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AgentHistoryPage() {
  const [logs,         setLogs]         = useState<WorkflowLogExtended[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [agentTab,     setAgentTab]     = useState<Agent | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "success" | "error">("all");

  useEffect(() => {
    fetch("/api/agent-history")
      .then(r => r.json())
      .then(d => { setLogs(d); setLoading(false); });
  }, []);

  const total       = logs.length;
  const errors      = logs.filter(l => l.status === "error").length;
  const successRate = total > 0 ? Math.round(((total - errors) / total) * 100) : 0;
  const avgDuration = logs.filter(l => l.duration_ms).length > 0
    ? Math.round(logs.filter(l => l.duration_ms).reduce((a, l) => a + (l.duration_ms ?? 0), 0) / logs.filter(l => l.duration_ms).length)
    : 0;

  const agentStats = AGENTS.map(a => {
    const al = logs.filter(l => l.agent === a);
    const ae = al.filter(l => l.status === "error").length;
    const last = al[0];
    return { agent: a, total: al.length, errors: ae, last };
  });

  const filtered = logs
    .filter(l => agentTab     === "all" || l.agent  === agentTab)
    .filter(l => statusFilter === "all" || l.status === statusFilter);

  if (loading) {
    return (
      <div className="p-4 md:p-8 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="card animate-pulse h-20" />)}
        </div>
        <div className="card animate-pulse h-64" />
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="p-4 md:p-8">
        <h1 className="text-xl font-semibold text-brand-black mb-1">Agent History</h1>
        <p className="text-sm text-brand-muted mb-8">Execution logs from all agents</p>
        <div className="card flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-full bg-brand-offwhite flex items-center justify-center mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="1.5" strokeLinecap="round" className="text-brand-muted">
              <path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="9"/>
            </svg>
          </div>
          <p className="text-sm font-medium text-brand-black mb-1">No logs yet</p>
          <p className="text-xs text-brand-muted max-w-xs">
            Logs will appear here once your agents are wired to write to Supabase.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 space-y-6 pb-24 md:pb-8">
      <div>
        <h1 className="text-xl font-semibold text-brand-black">Agent History</h1>
        <p className="text-sm text-brand-muted mt-0.5">Execution logs from all agents</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total executions" value={total} />
        <StatCard label="Success rate"     value={`${successRate}%`} sub={`${errors} error${errors !== 1 ? "s" : ""}`} />
        <StatCard label="Avg duration"     value={avgDuration > 0 ? `${(avgDuration/1000).toFixed(1)}s` : "—"} />
        <StatCard label="Errors"           value={errors} sub={errors > 0 ? "tap to filter" : "all clear"} />
      </div>

      {/* Per-agent summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {agentStats.map(({ agent, total: t, errors: e, last }) => (
          <div key={agent} className="card py-3 px-4">
            <div className="flex items-center justify-between mb-2">
              <AgentChip agent={agent} />
              {last && <span className={clsx("w-2 h-2 rounded-full", STATUS_DOT[last.status])} />}
            </div>
            <p className="text-2xl font-semibold text-brand-black">{t}</p>
            <p className="text-xs text-brand-muted">
              {e > 0 ? <span className="text-red-600">{e} error{e !== 1 ? "s" : ""}</span> : "no errors"}
              {last && <> · {formatDistanceToNow(parseISO(last.created_at), { addSuffix: true })}</>}
            </p>
          </div>
        ))}
      </div>

      {/* Log feed */}
      <div>
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <div className="flex gap-1">
            {(["all", ...AGENTS] as (Agent | "all")[]).map(a => (
              <button key={a} onClick={() => setAgentTab(a)}
                className={clsx(
                  "px-2.5 py-1 rounded-full text-xs transition-colors capitalize",
                  agentTab === a ? "bg-brand-orange text-white" : "bg-brand-offwhite text-brand-muted hover:bg-brand-border"
                )}>
                {a}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {(["all","success","error"] as const).map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={clsx(
                  "px-2.5 py-1 rounded-full text-xs transition-colors capitalize",
                  statusFilter === s ? "bg-brand-orange text-white" : "bg-brand-offwhite text-brand-muted hover:bg-brand-border"
                )}>
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="card p-0 overflow-hidden">
          {filtered.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm text-brand-muted">No logs match this filter</p>
            </div>
          ) : (
            filtered.map(log => <LogRow key={log.id} log={log} />)
          )}
        </div>
        <p className="text-xs text-brand-muted mt-2 text-right">
          Showing {filtered.length} of {total} executions
        </p>
      </div>
    </div>
  );
}