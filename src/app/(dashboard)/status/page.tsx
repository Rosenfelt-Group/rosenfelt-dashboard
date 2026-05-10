"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { formatDistanceToNow, parseISO } from "date-fns";
import clsx from "clsx";

interface RunLog {
  id: string;
  source: string;
  repo: string;
  workflow_name: string | null;
  external_id: string;
  status: string;
  conclusion: string | null;
  branch: string | null;
  triggered_by: string | null;
  run_url: string | null;
  started_at: string | null;
  completed_at: string | null;
}

const REPO_ORDER = [
  "rosenfelt-docs",
  "jordan-agent",
  "riley-agent",
  "avery-agent",
  "rosenfelt-dashboard",
  "vps-config",
];

function conclusionMeta(status: string, conclusion: string | null) {
  if (status === "in_progress") return { label: "Running",   dot: "bg-amber-400 animate-pulse", badge: "bg-amber-50 text-amber-700" };
  if (status === "queued")      return { label: "Queued",    dot: "bg-gray-300",                badge: "bg-gray-100 text-gray-500"  };
  if (conclusion === "success") return { label: "Success",   dot: "bg-green-500",               badge: "bg-green-50 text-green-700" };
  if (conclusion === "failure") return { label: "Failed",    dot: "bg-red-500",                 badge: "bg-red-50 text-red-700"     };
  return                               { label: conclusion ?? status, dot: "bg-gray-300",       badge: "bg-gray-100 text-gray-500"  };
}

function timeAgo(ts: string | null) {
  if (!ts) return null;
  try { return formatDistanceToNow(parseISO(ts), { addSuffix: true }); } catch { return null; }
}

function RunRow({ run, latest }: { run: RunLog; latest: boolean }) {
  const meta = conclusionMeta(run.status, run.conclusion);
  const ago  = timeAgo(run.status === "completed" ? run.completed_at : run.started_at);

  return (
    <div className={clsx("flex items-center gap-3 py-2.5", latest && "py-3")}>
      <div className={clsx("w-2 h-2 rounded-full flex-shrink-0", meta.dot)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={clsx(
            "text-xs font-medium",
            latest ? "text-brand-black" : "text-brand-muted"
          )}>
            {run.workflow_name ?? "Workflow"}
          </span>
          {latest && (
            <span className={clsx("badge text-[10px] px-1.5 py-0.5", meta.badge)}>
              {meta.label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {run.branch && (
            <span className="text-[10px] text-brand-muted font-mono">{run.branch}</span>
          )}
          {run.triggered_by && (
            <>
              <span className="text-[10px] text-brand-border">·</span>
              <span className="text-[10px] text-brand-muted">{run.triggered_by}</span>
            </>
          )}
          {ago && (
            <>
              <span className="text-[10px] text-brand-border">·</span>
              <span className="text-[10px] text-brand-muted">{ago}</span>
            </>
          )}
        </div>
      </div>
      {!latest && (
        <span className={clsx("w-1.5 h-1.5 rounded-full flex-shrink-0", meta.dot)} />
      )}
      {run.run_url && (
        <a
          href={run.run_url}
          target="_blank"
          rel="noreferrer"
          className="flex-shrink-0 text-brand-muted hover:text-brand-black transition-colors"
          title="View run"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </a>
      )}
    </div>
  );
}

function RepoCard({ repo, runs }: { repo: string; runs: RunLog[] }) {
  const latest = runs[0];
  if (!latest) return null;
  const meta = conclusionMeta(latest.status, latest.conclusion);
  const history = runs.slice(1, 6);

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-brand-muted flex-shrink-0">
            <circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/>
            <path d="M18 9a9 9 0 0 1-9 9"/><path d="M6 9a9 9 0 0 0 3.6 7.2"/>
          </svg>
          <h3 className="text-sm font-semibold text-brand-black font-mono">{repo}</h3>
        </div>
        <span className={clsx("badge text-[10px] px-1.5 py-0.5", meta.badge)}>
          {meta.label}
        </span>
      </div>

      <RunRow run={latest} latest />

      {history.length > 0 && (
        <div className="mt-1 border-t border-brand-border divide-y divide-brand-border">
          {history.map(run => (
            <RunRow key={run.id} run={run} latest={false} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function StatusPage() {
  const [runs, setRuns]       = useState<RunLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive]       = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/github/runs");
    const data = await res.json();
    setRuns(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();

    const channel = supabase
      .channel("github-run-log-changes")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "github_run_log" },
        payload => {
          setRuns(prev => [payload.new as RunLog, ...prev].slice(0, 200));
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "github_run_log" },
        payload => {
          const updated = payload.new as RunLog;
          setRuns(prev => prev.map(r => r.id === updated.id ? updated : r));
        }
      )
      .subscribe(status => setLive(status === "SUBSCRIBED"));

    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const byRepo = useMemo(() => {
    const map = new Map<string, RunLog[]>();
    for (const run of runs) {
      const list = map.get(run.repo) ?? [];
      list.push(run);
      map.set(run.repo, list);
    }
    const ordered: [string, RunLog[]][] = [];
    for (const repo of REPO_ORDER) {
      if (map.has(repo)) ordered.push([repo, map.get(repo)!]);
    }
    for (const [repo, list] of map) {
      if (!REPO_ORDER.includes(repo)) ordered.push([repo, list]);
    }
    return ordered;
  }, [runs]);

  const activeCount = runs.filter(r =>
    r.status === "in_progress" && !byRepo.some(([, list]) => list.indexOf(r) > 0)
  ).length;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-brand-black">Deploy Status</h1>
          <p className="text-sm text-brand-muted mt-0.5">
            GitHub Actions runs across all repos
            {activeCount > 0 && (
              <span className="ml-2 text-amber-600 font-medium">
                · {activeCount} running
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={clsx(
            "w-2 h-2 rounded-full",
            live ? "bg-green-500" : "bg-gray-300"
          )} />
          <span className="text-xs text-brand-muted">{live ? "Live" : "Connecting…"}</span>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-brand-muted">Loading…</div>
      ) : byRepo.length === 0 ? (
        <div className="card text-sm text-brand-muted text-center py-12">
          No runs yet — trigger a workflow to see results here.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {byRepo.map(([repo, repoRuns]) => (
            <RepoCard key={repo} repo={repo} runs={repoRuns} />
          ))}
        </div>
      )}
    </div>
  );
}
