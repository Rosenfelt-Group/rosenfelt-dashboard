"use client";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui";
import { ago } from "./helpers";

interface N8nWorkflowSummary {
  workflow_name: string; runs: number; errors: number;
  last_run: string; last_status: string; avg_duration_ms: number | null;
}
interface N8nRecentRun {
  id: string; created_at: string; workflow_name: string;
  agent: string | null; status: string; error_message?: string; duration_ms?: number;
}

export function N8nTab() {
  const [workflows, setWorkflows] = useState<N8nWorkflowSummary[]>([]);
  const [recent,    setRecent]    = useState<N8nRecentRun[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [expanded,  setExpanded]  = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/n8n/workflows");
    if (!res.ok) { setError(`Failed (${res.status})`); setLoading(false); return; }
    const data = await res.json();
    setWorkflows(data.workflows ?? []);
    setRecent(data.recent ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  if (loading) return <LoadingState />;
  if (error)   return <ErrorState message={error} />;

  return (
    <div className="space-y-4">
      {/* Quick link to n8n UI */}
      <div className="card flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-brand-black">n8n Workflow Editor</p>
          <p className="text-xs text-brand-muted mt-0.5">Showing last 7 days of executions</p>
        </div>
        <a
          href="https://n8n.rosably.com"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-offwhite border border-brand-border
                     rounded-lg text-xs font-medium text-brand-black hover:bg-white transition-colors"
        >
          Open n8n
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </a>
      </div>

      {workflows.length === 0 ? (
        <EmptyState title="No workflow executions in the last 7 days." />
      ) : (
        <>
          {/* Workflow summary table */}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-brand-border">
              <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">
                Workflow Summary · last 7 days
              </p>
            </div>
            <div className="divide-y divide-brand-border">
              {workflows.map(wf => {
                const errorRate = wf.runs > 0 ? wf.errors / wf.runs : 0;
                const isExpanded = expanded === wf.workflow_name;
                const wfRecent = recent.filter(r => r.workflow_name === wf.workflow_name);
                return (
                  <div key={wf.workflow_name}>
                    <button
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-brand-offwhite transition-colors"
                      onClick={() => setExpanded(isExpanded ? null : wf.workflow_name)}
                    >
                      {/* Status dot */}
                      <div className={clsx("w-2 h-2 rounded-full flex-shrink-0",
                        wf.last_status === "error" ? "bg-red-500" :
                        wf.last_status === "success" ? "bg-green-500" : "bg-amber-400"
                      )} />
                      {/* Name */}
                      <p className="text-sm font-medium text-brand-black flex-1 truncate text-left">
                        {wf.workflow_name}
                      </p>
                      {/* Stats */}
                      <div className="flex items-center gap-3 flex-shrink-0 text-[11px]">
                        <span className="text-brand-muted">{wf.runs} runs</span>
                        {wf.errors > 0 && (
                          <span className={clsx("font-medium", errorRate > 0.5 ? "text-red-600" : "text-amber-600")}>
                            {wf.errors} err
                          </span>
                        )}
                        {wf.avg_duration_ms && (
                          <span className="text-brand-muted hidden sm:inline">
                            ~{wf.avg_duration_ms < 1000
                              ? `${wf.avg_duration_ms}ms`
                              : `${(wf.avg_duration_ms / 1000).toFixed(1)}s`}
                          </span>
                        )}
                        <span className="text-brand-muted">{ago(wf.last_run)}</span>
                        {/* Chevron */}
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                          className={clsx("text-brand-muted transition-transform", isExpanded && "rotate-180")}>
                          <polyline points="6 9 12 15 18 9"/>
                        </svg>
                      </div>
                    </button>

                    {/* Expanded recent runs */}
                    {isExpanded && wfRecent.length > 0 && (
                      <div className="bg-brand-offwhite border-t border-brand-border">
                        {wfRecent.map((r, i) => (
                          <div key={r.id} className={clsx(
                            "flex items-center gap-3 px-6 py-2 text-xs",
                            i !== 0 && "border-t border-brand-border"
                          )}>
                            <div className={clsx("w-1.5 h-1.5 rounded-full flex-shrink-0",
                              r.status === "error" ? "bg-red-500" :
                              r.status === "success" ? "bg-green-500" : "bg-amber-400"
                            )} />
                            <span className={clsx("font-medium flex-shrink-0",
                              r.status === "error" ? "text-red-700" :
                              r.status === "success" ? "text-green-700" : "text-amber-700"
                            )}>{r.status}</span>
                            {r.agent && (
                              <span className="text-brand-muted flex-shrink-0">{r.agent}</span>
                            )}
                            {r.error_message && (
                              <span className="text-red-600 truncate flex-1">{r.error_message}</span>
                            )}
                            {!r.error_message && r.duration_ms && (
                              <span className="text-brand-muted flex-1">
                                {r.duration_ms < 1000 ? `${r.duration_ms}ms` : `${(r.duration_ms / 1000).toFixed(1)}s`}
                              </span>
                            )}
                            <span className="text-brand-muted flex-shrink-0">{ago(r.created_at)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
