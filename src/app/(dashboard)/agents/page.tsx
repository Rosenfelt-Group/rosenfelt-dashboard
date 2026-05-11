"use client";
import { useEffect, useState } from "react";
import { WorkflowLog, Agent } from "@/types";
import { AgentBadge } from "@/components/AgentBadge";
import { formatDistanceToNow } from "date-fns";
import clsx from "clsx";
import Link from "next/link";

function ReindexButton() {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [output, setOutput] = useState<string>("");

  async function run() {
    setState("running");
    setOutput("");
    try {
      const res = await fetch("/api/tools/reindex-docs", { method: "POST" });
      const data = await res.json();
      setOutput(data.output ?? data.error ?? "No output");
      setState(data.ok === false || !res.ok ? "error" : "done");
    } catch (e) {
      setOutput(String(e));
      setState("error");
    }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-medium text-brand-black">Reindex Docs</p>
          <p className="text-xs text-brand-muted">Sync doc_chunks with current markdown files</p>
        </div>
        <button
          onClick={run}
          disabled={state === "running"}
          className={clsx(
            "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
            state === "running" ? "bg-brand-offwhite text-brand-muted cursor-not-allowed" :
            state === "done"    ? "bg-green-100 text-green-700 hover:bg-green-200" :
            state === "error"   ? "bg-red-100 text-red-700 hover:bg-red-200" :
            "bg-brand-orange text-white hover:opacity-90"
          )}
        >
          {state === "running" ? "Indexing…" : state === "done" ? "Done ✓" : state === "error" ? "Failed ✗" : "Run"}
        </button>
      </div>
      {output && (
        <pre className="mt-2 text-xs bg-brand-offwhite rounded-lg p-3 overflow-auto max-h-48 whitespace-pre-wrap text-brand-muted">
          {output}
        </pre>
      )}
    </div>
  );
}

export default function AgentsPage() {
  const [logs, setLogs]     = useState<WorkflowLog[]>([]);
  const [filter, setFilter] = useState<Agent | "all">("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/activity").then(r => r.json()).then(l => {
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
        <p className="text-sm text-brand-muted mt-0.5">
          System tools and execution log —{" "}
          <Link href="/status" className="text-brand-orange hover:underline">view live health →</Link>
        </p>
      </div>

      {/* System Tools */}
      <div className="mb-8">
        <h2 className="text-sm font-medium text-brand-black mb-3">System Tools</h2>
        <div className="grid grid-cols-3 gap-4">
          <ReindexButton />
        </div>
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
                className={clsx("flex items-center gap-3 px-4 py-3 text-sm", i !== 0 && "border-t border-brand-border")}
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
