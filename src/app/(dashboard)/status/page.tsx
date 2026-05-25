"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { AgentBadge } from "@/components/AgentBadge";
import RegressionPanel from "@/components/status/RegressionPanel";
import { formatDistanceToNow, parseISO } from "date-fns";
import clsx from "clsx";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "agents" | "github" | "vercel" | "supabase" | "vps" | "n8n" | "regression";

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

interface RunLog {
  id: string; source: string; repo: string; workflow_name: string | null;
  external_id: string; status: string; conclusion: string | null;
  branch: string | null; triggered_by: string | null;
  run_url: string | null; started_at: string | null; completed_at: string | null;
}

interface VercelDeployment {
  uid: string; name: string; url: string; state: string;
  created: number; ready: number | null;
  meta: { githubCommitMessage?: string; githubCommitRef?: string; githubCommitSha?: string };
  creator?: { username?: string };
}

interface SupabaseComponent { id: string; name: string; status: string }
interface SupabaseIncident {
  id: string; name: string; status: string; updated_at: string;
  incident_updates: { body: string; updated_at: string }[];
}
interface SupabaseScheduled {
  id: string; name: string; status: string;
  scheduled_for: string; scheduled_until: string;
  incident_updates: { body: string }[];
}
interface SupabaseStatus {
  status: { indicator: string; description: string };
  components: SupabaseComponent[];
  incidents: SupabaseIncident[];
  scheduled_maintenances: SupabaseScheduled[];
}

interface SupabaseTableRow {
  table_name: string; row_count: number | null;
  size_bytes: number | null; size_pretty: string | null;
}
interface SupabaseMetrics {
  configured: boolean; tables: SupabaseTableRow[];
  db_size: { size_bytes: number; size_pretty: string } | null; error?: string;
}
interface SupabaseUsage {
  configured: boolean; plan?: string;
  egress_gb: number | null;
  cache_hit_pct: number | null;
  xact_commit: number | null; xact_rollback: number | null; deadlocks: number | null;
  tup_returned: number | null; tup_inserted: number | null;
  tup_updated: number | null; tup_deleted: number | null;
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const REPO_ORDER = ["rosenfelt-docs","jordan-agent","riley-agent","avery-agent","rosenfelt-dashboard","vps-config"];

function ago(ts: string | number | null) {
  if (!ts) return null;
  try {
    const d = typeof ts === "number" ? new Date(ts) : parseISO(ts as string);
    return formatDistanceToNow(d, { addSuffix: true });
  } catch { return null; }
}

function runMeta(status: string, conclusion: string | null) {
  if (status === "in_progress") return { label: "Running",   dot: "bg-amber-400 animate-pulse", badge: "bg-amber-50 text-amber-700"  };
  if (status === "queued")      return { label: "Queued",    dot: "bg-gray-300",                badge: "bg-gray-100 text-gray-500"   };
  if (conclusion === "success") return { label: "Success",   dot: "bg-green-500",               badge: "bg-green-50 text-green-700"  };
  if (conclusion === "failure") return { label: "Failed",    dot: "bg-red-500",                 badge: "bg-red-50 text-red-700"      };
  return                               { label: conclusion ?? status, dot: "bg-gray-300",       badge: "bg-gray-100 text-gray-500"   };
}

function vercelStateMeta(state: string) {
  if (state === "READY")    return { label: "Ready",    badge: "bg-green-50 text-green-700" };
  if (state === "ERROR")    return { label: "Error",    badge: "bg-red-50 text-red-700"     };
  if (state === "BUILDING") return { label: "Building", badge: "bg-amber-50 text-amber-700" };
  if (state === "QUEUED")   return { label: "Queued",   badge: "bg-gray-100 text-gray-500"  };
  if (state === "CANCELED") return { label: "Cancelled",badge: "bg-gray-100 text-gray-500"  };
  return                           { label: state,      badge: "bg-gray-100 text-gray-500"  };
}

function supabaseIndicatorMeta(indicator: string) {
  if (indicator === "none")     return { label: "All Systems Operational", cls: "text-green-700 bg-green-50", dot: "bg-green-500" };
  if (indicator === "minor")    return { label: "Minor Disruption",        cls: "text-amber-700 bg-amber-50", dot: "bg-amber-400" };
  if (indicator === "major")    return { label: "Major Outage",            cls: "text-red-700 bg-red-50",     dot: "bg-red-500"   };
  if (indicator === "critical") return { label: "Critical Outage",         cls: "text-red-700 bg-red-50",     dot: "bg-red-500 animate-pulse" };
  return                                { label: indicator,                cls: "text-gray-700 bg-gray-100",  dot: "bg-gray-400"  };
}

function componentStatusDot(status: string) {
  if (status === "operational")         return "bg-green-500";
  if (status === "degraded_performance") return "bg-amber-400";
  if (status === "partial_outage")      return "bg-orange-500";
  if (status === "major_outage")        return "bg-red-500";
  return "bg-gray-300";
}

// ─── Agents Tab ───────────────────────────────────────────────────────────────

function AgentsTab() {
  const [health, setHealth]     = useState<AgentHealth[]>([]);
  const [stats, setStats]       = useState<AgentStat[]>([]);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [loading, setLoading]   = useState(true);

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

  const combined = ["jordan","riley","avery","casey"].map(name => ({
    health: health.find(h => h.agent === name),
    stat:   stats.find(s => s.agent === name),
    name,
  }));

  if (loading) return <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">{[0,1,2,3].map(i => <div key={i} className="card animate-pulse h-40"/>)}</div>;

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-2">
        {combined.map(({ name, health: h, stat: s }) => {
          const up = h?.status === "up";
          const down = h?.status === "down";
          return (
            <div key={name} className="card">
              <div className="flex items-center gap-3 mb-4">
                <AgentBadge agent={name as "jordan"|"riley"|"avery"|"casey"} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-brand-black capitalize">{name}</p>
                  <p className="text-xs text-brand-muted">
                    {s?.last_execution ? `Active ${ago(s.last_execution)}` : "No recent activity"}
                  </p>
                </div>
                <span className={clsx(
                  "badge text-xs px-2 py-0.5",
                  up ? "bg-green-50 text-green-700" : down ? "bg-red-50 text-red-700" : "bg-gray-100 text-gray-500"
                )}>
                  {up ? "Up" : down ? "Down" : "Unknown"}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center mb-3">
                <div className="bg-brand-offwhite rounded-lg p-2">
                  <p className="text-base font-semibold text-brand-black">{s?.executions_24h ?? "—"}</p>
                  <p className="text-[10px] text-brand-muted">24h runs</p>
                </div>
                <div className={clsx("rounded-lg p-2", (s?.errors_24h ?? 0) > 0 ? "bg-red-50" : "bg-brand-offwhite")}>
                  <p className={clsx("text-base font-semibold", (s?.errors_24h ?? 0) > 0 ? "text-red-600" : "text-brand-black")}>
                    {s?.errors_24h ?? "—"}
                  </p>
                  <p className="text-[10px] text-brand-muted">errors</p>
                </div>
                <div className="bg-brand-offwhite rounded-lg p-2">
                  <p className="text-base font-semibold text-brand-black">
                    {h?.latency_ms != null ? `${h.latency_ms}ms` : "—"}
                  </p>
                  <p className="text-[10px] text-brand-muted">latency</p>
                </div>
              </div>
              {h?.error && (
                <p className="text-[10px] text-red-600 truncate">{h.error}</p>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between mt-2">
        <Link href="/agents/history" className="text-xs text-brand-orange hover:underline">
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

// ─── GitHub Tab ───────────────────────────────────────────────────────────────

function GitHubTab({ live }: { live: boolean }) {
  const [runs, setRuns]   = useState<RunLog[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const data = await fetch("/api/github/runs").then(r => r.json()).catch(() => []);
    setRuns(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase.channel("status-github")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "github_run_log" },
        p => setRuns(prev => [p.new as RunLog, ...prev].slice(0, 200)))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "github_run_log" },
        p => { const u = p.new as RunLog; setRuns(prev => prev.map(r => r.id === u.id ? u : r)); })
      .subscribe();
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
    for (const repo of REPO_ORDER) { if (map.has(repo)) ordered.push([repo, map.get(repo)!]); }
    for (const [repo, list] of map) { if (!REPO_ORDER.includes(repo)) ordered.push([repo, list]); }
    return ordered;
  }, [runs]);

  if (loading) return <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{[0,1,2].map(i=><div key={i} className="card animate-pulse h-36"/>)}</div>;
  if (byRepo.length === 0) return <div className="card text-sm text-brand-muted text-center py-12">No runs yet — trigger a workflow to see results.</div>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {byRepo.map(([repo, repoRuns]) => {
        const latest = repoRuns[0];
        const meta = runMeta(latest.status, latest.conclusion);
        const history = repoRuns.slice(1, 6);
        return (
          <div key={repo} className="card">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-brand-muted flex-shrink-0">
                  <circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/>
                  <path d="M18 9a9 9 0 0 1-9 9"/><path d="M6 9a9 9 0 0 0 3.6 7.2"/>
                </svg>
                <h3 className="text-sm font-semibold text-brand-black font-mono">{repo}</h3>
              </div>
              <span className={clsx("badge text-[10px] px-1.5 py-0.5", meta.badge)}>{meta.label}</span>
            </div>
            {/* Latest run */}
            <div className="flex items-center gap-3 py-2.5">
              <div className={clsx("w-2 h-2 rounded-full flex-shrink-0", meta.dot)} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-brand-black">{latest.workflow_name ?? "Workflow"}</p>
                <p className="text-[10px] text-brand-muted mt-0.5">
                  {latest.branch && <span className="font-mono">{latest.branch}</span>}
                  {latest.triggered_by && <span> · {latest.triggered_by}</span>}
                  {ago(latest.status === "completed" ? latest.completed_at : latest.started_at) && (
                    <span> · {ago(latest.status === "completed" ? latest.completed_at : latest.started_at)}</span>
                  )}
                </p>
              </div>
              {latest.run_url && (
                <a href={latest.run_url} target="_blank" rel="noreferrer" className="flex-shrink-0 text-brand-muted hover:text-brand-black">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                </a>
              )}
            </div>
            {history.length > 0 && (
              <div className="border-t border-brand-border divide-y divide-brand-border">
                {history.map(run => {
                  const m = runMeta(run.status, run.conclusion);
                  return (
                    <div key={run.id} className="flex items-center gap-3 py-2">
                      <div className={clsx("w-1.5 h-1.5 rounded-full flex-shrink-0", m.dot)} />
                      <span className="text-[10px] text-brand-muted flex-1 truncate">{run.workflow_name ?? "Workflow"}</span>
                      <span className="text-[10px] text-brand-muted flex-shrink-0">{ago(run.status === "completed" ? run.completed_at : run.started_at)}</span>
                      {run.run_url && (
                        <a href={run.run_url} target="_blank" rel="noreferrer" className="flex-shrink-0 text-brand-muted hover:text-brand-black">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                          </svg>
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Vercel Tab ───────────────────────────────────────────────────────────────

function VercelTab() {
  const [deployments, setDeployments] = useState<VercelDeployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/vercel/deployments");
    if (!res.ok) { setError(`Failed to load (${res.status})`); setLoading(false); return; }
    const data = await res.json();
    setDeployments(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 120_000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) return <div className="card animate-pulse h-64" />;
  if (error)   return <div className="card text-sm text-red-600 py-8 text-center">{error}</div>;
  if (deployments.length === 0) return <div className="card text-sm text-brand-muted text-center py-12">No deployments found.</div>;

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-brand-border flex items-center justify-between">
        <p className="text-sm font-semibold text-brand-black font-mono">rosenfelt-dashboard</p>
        <p className="text-xs text-brand-muted">dashboard.rosably.com</p>
      </div>
      {deployments.map((d, i) => {
        const meta = vercelStateMeta(d.state);
        const msg  = d.meta?.githubCommitMessage?.split("\n")[0] ?? "—";
        const ref  = d.meta?.githubCommitRef ?? "—";
        const url  = `https://${d.url}`;
        return (
          <div key={d.uid} className={clsx("flex items-center gap-3 px-4 py-3 text-sm", i !== 0 && "border-t border-brand-border")}>
            <span className={clsx("badge text-[10px] px-1.5 py-0.5 flex-shrink-0", meta.badge)}>{meta.label}</span>
            <div className="flex-1 min-w-0">
              <p className="text-brand-black truncate text-xs font-medium">{msg}</p>
              <p className="text-[10px] text-brand-muted mt-0.5 font-mono">{ref}</p>
            </div>
            <span className="text-[10px] text-brand-muted flex-shrink-0 whitespace-nowrap">{ago(d.created)}</span>
            <a href={url} target="_blank" rel="noreferrer" className="flex-shrink-0 text-brand-muted hover:text-brand-black">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </a>
          </div>
        );
      })}
    </div>
  );
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function UsageBar({ percent, warn = 70, danger = 90 }: { percent: number; warn?: number; danger?: number }) {
  const color = percent >= danger ? "bg-red-500" : percent >= warn ? "bg-amber-400" : "bg-green-500";
  return (
    <div className="w-full h-1.5 bg-brand-offwhite rounded-full overflow-hidden">
      <div className={clsx("h-full rounded-full transition-all", color)} style={{ width: `${Math.min(percent, 100)}%` }} />
    </div>
  );
}

// ─── Supabase Tab ─────────────────────────────────────────────────────────────

const CORE_COMPONENTS = ["Database","API","Auth","Realtime","Storage","Edge Functions","Supabase Dashboard"];

function SupabaseTab() {
  const [status, setStatus]   = useState<SupabaseStatus | null>(null);
  const [metrics, setMetrics] = useState<SupabaseMetrics | null>(null);
  const [usage, setUsage]     = useState<SupabaseUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    const [statusRes, metricsRes, usageRes] = await Promise.all([
      fetch("/api/supabase/status").catch(() => null),
      fetch("/api/supabase/metrics").catch(() => null),
      fetch("/api/supabase/usage").catch(() => null),
    ]);
    if (!statusRes?.ok) { setError("Could not reach Supabase status API"); setLoading(false); return; }
    setStatus(await statusRes.json());
    if (metricsRes?.ok) setMetrics(await metricsRes.json());
    if (usageRes?.ok) setUsage(await usageRes.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 300_000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) return <div className="card animate-pulse h-64" />;
  if (error || !status) return <div className="card text-sm text-red-600 py-8 text-center">{error ?? "No data"}</div>;

  const indicator     = supabaseIndicatorMeta(status.status.indicator);
  const coreComponents = status.components.filter(c =>
    CORE_COMPONENTS.some(name => c.name.toLowerCase().includes(name.toLowerCase())) && c.name !== "Supabase"
  );
  const activeIncidents = status.incidents.filter(i => i.status !== "resolved");
  const upcomingMaint   = status.scheduled_maintenances.filter(m => m.status !== "completed");

  return (
    <div className="space-y-4">
      {/* DB health panel */}
      {usage?.configured === false ? (
        <div className="card">
          <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide mb-1">Project Metrics</p>
          <p className="text-sm text-brand-muted">
            Add <code className="bg-brand-offwhite px-1 rounded text-xs">SUPABASE_ACCESS_TOKEN</code> to Vercel environment variables to see DB health and table sizes.
          </p>
        </div>
      ) : usage && !usage.error ? (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">Database Health</p>
            <div className="flex items-center gap-2">
              {usage.plan && usage.plan !== "unknown" && (
                <span className="badge text-[10px] px-1.5 py-0.5 bg-brand-offwhite text-brand-muted capitalize">{usage.plan} plan</span>
              )}
              <a href="https://supabase.com/dashboard/org/znhxpkxsrelwlxufbbtr/billing" target="_blank" rel="noreferrer"
                className="text-[10px] text-brand-orange hover:underline">Egress →</a>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-brand-offwhite rounded-lg p-2.5 text-center">
              <p className={clsx("text-lg font-semibold", (usage.cache_hit_pct ?? 100) < 90 ? "text-amber-600" : "text-green-600")}>
                {usage.cache_hit_pct !== null ? `${usage.cache_hit_pct}%` : "—"}
              </p>
              <p className="text-[10px] text-brand-muted mt-0.5">Cache hit</p>
            </div>
            <div className="bg-brand-offwhite rounded-lg p-2.5 text-center">
              <p className="text-lg font-semibold text-brand-black">
                {usage.xact_commit !== null ? (usage.xact_commit / 1000).toFixed(1) + "k" : "—"}
              </p>
              <p className="text-[10px] text-brand-muted mt-0.5">Transactions</p>
            </div>
            <div className="bg-brand-offwhite rounded-lg p-2.5 text-center">
              <p className={clsx("text-lg font-semibold", (usage.deadlocks ?? 0) > 0 ? "text-red-600" : "text-brand-black")}>
                {usage.deadlocks ?? "—"}
              </p>
              <p className="text-[10px] text-brand-muted mt-0.5">Deadlocks</p>
            </div>
            <div className="bg-brand-offwhite rounded-lg p-2.5 text-center">
              <p className="text-lg font-semibold text-brand-black">
                {usage.tup_returned !== null ? (usage.tup_returned / 1e6).toFixed(1) + "M" : "—"}
              </p>
              <p className="text-[10px] text-brand-muted mt-0.5">Rows returned</p>
            </div>
          </div>
        </div>
      ) : null}

      {/* Table health panel */}
      {metrics?.configured && !metrics.error && metrics.tables.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">Database Tables</p>
            {metrics.db_size && (
              <span className="text-xs text-brand-muted">Total: {metrics.db_size.size_pretty}</span>
            )}
          </div>
          <div className="divide-y divide-brand-border">
            {metrics.tables.map(t => (
              <div key={t.table_name} className="flex items-center gap-3 py-1.5 text-xs">
                <span className="font-mono text-brand-black flex-1 truncate">{t.table_name}</span>
                <span className="text-brand-muted w-24 text-right flex-shrink-0">
                  {t.row_count !== null ? t.row_count.toLocaleString() + " rows" : ""}
                </span>
                <span className="text-brand-muted w-16 text-right flex-shrink-0">{t.size_pretty ?? "—"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Overall status */}
      <div className={clsx("card flex items-center gap-3", indicator.cls)}>
        <div className={clsx("w-3 h-3 rounded-full flex-shrink-0", indicator.dot)} />
        <p className="text-sm font-semibold">{indicator.label}</p>
      </div>

      {/* Component grid */}
      <div className="card">
        <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide mb-3">Components</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {(coreComponents.length > 0 ? coreComponents : status.components.slice(0, 12)).map(c => (
            <div key={c.id} className="flex items-center gap-2 py-1">
              <div className={clsx("w-2 h-2 rounded-full flex-shrink-0", componentStatusDot(c.status))} />
              <span className="text-xs text-brand-black truncate">{c.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Active incidents */}
      {activeIncidents.length > 0 ? (
        <div className="card border-red-200">
          <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-3">Active Incidents</p>
          <div className="space-y-3">
            {activeIncidents.map(inc => (
              <div key={inc.id}>
                <p className="text-sm font-medium text-brand-black">{inc.name}</p>
                <p className="text-xs text-brand-muted capitalize">{inc.status.replace(/_/g, " ")}</p>
                {inc.incident_updates[0] && (
                  <p className="text-xs text-brand-muted mt-1 line-clamp-2">{inc.incident_updates[0].body}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="card text-xs text-brand-muted text-center py-4">No active incidents</div>
      )}

      {/* Scheduled maintenance */}
      {upcomingMaint.length > 0 && (
        <div className="card border-amber-200">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-3">Scheduled Maintenance</p>
          <div className="space-y-3">
            {upcomingMaint.map(m => (
              <div key={m.id}>
                <p className="text-sm font-medium text-brand-black">{m.name}</p>
                <p className="text-xs text-brand-muted">
                  {ago(m.scheduled_for)} → {ago(m.scheduled_until)}
                </p>
                {m.incident_updates[0] && (
                  <p className="text-xs text-brand-muted mt-1 line-clamp-2">{m.incident_updates[0].body}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card flex items-center justify-between">
        <p className="text-sm text-brand-muted">Run queries against the database in the dedicated SQL page.</p>
        <Link href="/sql" className="text-xs text-brand-orange hover:underline flex-shrink-0 ml-4">Open SQL →</Link>
      </div>
    </div>
  );
}

// ─── VPS Tab ──────────────────────────────────────────────────────────────────

interface VpsStats {
  cpu_percent: number;
  memory: { total_gb: number; used_gb: number; percent: number };
  disk:   { total_gb: number; used_gb: number; percent: number };
  uptime_seconds: number;
  containers: { name: string; status: string; image: string }[];
}

function formatUptime(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function VpsTab() {
  const [stats, setStats]     = useState<VpsStats | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/vps/stats");
    if (!res.ok) { setError(`Failed to load (${res.status})`); setLoading(false); return; }
    setStats(await res.json());
    setLastRefresh(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  if (loading) return <div className="card animate-pulse h-64" />;
  if (error)   return <div className="card p-6 text-sm text-red-600">{error}</div>;
  if (!stats)  return null;

  const CORE_CONTAINERS = ["jordan-agent", "riley-agent", "avery-agent", "n8n", "traefik", "wordpress"];

  return (
    <div className="space-y-4">
      {/* System metrics */}
      <div className="grid grid-cols-3 gap-4">
        {/* CPU */}
        <div className="card space-y-2">
          <p className="text-xs text-brand-muted uppercase tracking-wide">CPU</p>
          <p className="text-2xl font-semibold text-brand-black">{stats.cpu_percent.toFixed(1)}%</p>
          <UsageBar percent={stats.cpu_percent} />
        </div>
        {/* Memory */}
        <div className="card space-y-2">
          <p className="text-xs text-brand-muted uppercase tracking-wide">Memory</p>
          <p className="text-2xl font-semibold text-brand-black">{stats.memory.percent.toFixed(1)}%</p>
          <UsageBar percent={stats.memory.percent} />
          <p className="text-xs text-brand-muted">{stats.memory.used_gb} / {stats.memory.total_gb} GB</p>
        </div>
        {/* Disk */}
        <div className="card space-y-2">
          <p className="text-xs text-brand-muted uppercase tracking-wide">Disk</p>
          <p className="text-2xl font-semibold text-brand-black">{stats.disk.percent}%</p>
          <UsageBar percent={stats.disk.percent} warn={75} danger={90} />
          <p className="text-xs text-brand-muted">{stats.disk.used_gb} / {stats.disk.total_gb} GB</p>
        </div>
      </div>

      {/* Uptime + refresh */}
      <div className="flex items-center justify-between text-xs text-brand-muted px-0.5">
        <span>Uptime: <span className="text-brand-black font-medium">{formatUptime(stats.uptime_seconds)}</span></span>
        <div className="flex items-center gap-3">
          {lastRefresh && <span>Updated {formatDistanceToNow(lastRefresh, { addSuffix: true })}</span>}
          <button onClick={load} className="text-brand-orange hover:underline">Refresh</button>
        </div>
      </div>

      {/* Containers */}
      <div>
        <h2 className="text-sm font-medium text-brand-black mb-3">Containers</h2>
        <div className="card p-0 overflow-hidden">
          {stats.containers.length === 0 ? (
            <div className="p-6 text-sm text-brand-muted text-center">No running containers found</div>
          ) : (
            stats.containers
              .slice()
              .sort((a, b) => {
                const ai = CORE_CONTAINERS.indexOf(a.name);
                const bi = CORE_CONTAINERS.indexOf(b.name);
                if (ai === -1 && bi === -1) return a.name.localeCompare(b.name);
                if (ai === -1) return 1;
                if (bi === -1) return -1;
                return ai - bi;
              })
              .map((c, i) => {
                const up = c.status.toLowerCase().startsWith("up");
                return (
                  <div key={c.name} className={clsx("flex items-center gap-3 px-4 py-3 text-sm", i !== 0 && "border-t border-brand-border")}>
                    <div className={clsx("w-1.5 h-1.5 rounded-full flex-shrink-0", up ? "bg-green-500" : "bg-red-400")} />
                    <span className="font-medium text-brand-black w-40 flex-shrink-0 truncate">{c.name}</span>
                    <span className="text-brand-muted flex-1 truncate">{c.status}</span>
                    <span className="text-xs text-brand-muted flex-shrink-0 truncate max-w-[200px]">{c.image}</span>
                  </div>
                );
              })
          )}
        </div>
      </div>
    </div>
  );
}

// ─── n8n Tab ──────────────────────────────────────────────────────────────────

interface N8nWorkflowSummary {
  workflow_name: string; runs: number; errors: number;
  last_run: string; last_status: string; avg_duration_ms: number | null;
}
interface N8nRecentRun {
  id: string; created_at: string; workflow_name: string;
  agent: string | null; status: string; error_message?: string; duration_ms?: number;
}

function N8nTab() {
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

  if (loading) return <div className="space-y-4">{[1,2,3].map(i=><div key={i} className="card animate-pulse h-16"/>)}</div>;
  if (error)   return <div className="card text-sm text-red-600 py-8 text-center">{error}</div>;

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
        <div className="card text-sm text-brand-muted text-center py-12">
          No workflow executions in the last 7 days.
        </div>
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

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string }[] = [
  { id: "agents",     label: "Agents"     },
  { id: "github",     label: "GitHub"     },
  { id: "vercel",     label: "Vercel"     },
  { id: "supabase",   label: "Supabase"   },
  { id: "vps",        label: "VPS"        },
  { id: "n8n",        label: "n8n"        },
  { id: "regression", label: "Regression" },
];

export default function StatusPage() {
  const [tab, setTab] = useState<Tab>("agents");
  const [live, setLive] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // Single Realtime connection shared across the page lifetime
  useEffect(() => {
    const ch = supabase.channel("status-page-liveness")
      .subscribe(s => setLive(s === "SUBSCRIBED"));
    return () => { supabase.removeChannel(ch); };
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => (r.ok ? r.json() : null))
      .then(d => setIsAdmin(d?.role === "admin"))
      .catch(() => setIsAdmin(false));
  }, []);

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-brand-black">Status</h1>
          <p className="text-sm text-brand-muted mt-0.5">Service health and deployment history</p>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={clsx("w-2 h-2 rounded-full", live ? "bg-green-500" : "bg-gray-300")} />
          <span className="text-xs text-brand-muted">{live ? "Live" : "Connecting…"}</span>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-brand-border mb-6">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              "px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px",
              tab === t.id
                ? "border-brand-orange text-brand-orange"
                : "border-transparent text-brand-muted hover:text-brand-black"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content — all mounted, hidden when inactive to keep Realtime alive */}
      <div className={tab === "agents"     ? "block" : "hidden"}><AgentsTab /></div>
      <div className={tab === "github"     ? "block" : "hidden"}><GitHubTab live={live} /></div>
      <div className={tab === "vercel"     ? "block" : "hidden"}><VercelTab /></div>
      <div className={tab === "supabase"   ? "block" : "hidden"}><SupabaseTab /></div>
      <div className={tab === "vps"        ? "block" : "hidden"}><VpsTab /></div>
      <div className={tab === "n8n"        ? "block" : "hidden"}><N8nTab /></div>
      <div className={tab === "regression" ? "block" : "hidden"}><RegressionPanel isAdmin={isAdmin} /></div>
    </div>
  );
}
