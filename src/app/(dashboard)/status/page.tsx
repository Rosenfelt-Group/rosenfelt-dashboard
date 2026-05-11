"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { AgentBadge } from "@/components/AgentBadge";
import { formatDistanceToNow, parseISO } from "date-fns";
import clsx from "clsx";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "agents" | "github" | "vercel" | "supabase";

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

  const combined = ["jordan","riley","avery"].map(name => ({
    health: health.find(h => h.agent === name),
    stat:   stats.find(s => s.agent === name),
    name,
  }));

  if (loading) return <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{[0,1,2].map(i => <div key={i} className="card animate-pulse h-40"/>)}</div>;

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-2">
        {combined.map(({ name, health: h, stat: s }) => {
          const up = h?.status === "up";
          const down = h?.status === "down";
          return (
            <div key={name} className="card">
              <div className="flex items-center gap-3 mb-4">
                <AgentBadge agent={name as "jordan"|"riley"|"avery"} />
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
      {checkedAt && (
        <p className="text-[11px] text-brand-muted text-right">
          Checked {checkedAt.toLocaleTimeString()} · refreshes every 60s
        </p>
      )}
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

// ─── Supabase Tab ─────────────────────────────────────────────────────────────

const CORE_COMPONENTS = ["Database","API","Auth","Realtime","Storage","Edge Functions","Supabase Dashboard"];

function SupabaseTab() {
  const [data, setData]     = useState<SupabaseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/supabase/status");
    if (!res.ok) { setError("Could not reach Supabase status API"); setLoading(false); return; }
    setData(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 300_000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) return <div className="card animate-pulse h-64" />;
  if (error || !data) return <div className="card text-sm text-red-600 py-8 text-center">{error ?? "No data"}</div>;

  const indicator = supabaseIndicatorMeta(data.status.indicator);
  const coreComponents = data.components.filter(c =>
    CORE_COMPONENTS.some(name => c.name.toLowerCase().includes(name.toLowerCase())) && c.name !== "Supabase"
  );
  const activeIncidents = data.incidents.filter(i => i.status !== "resolved");
  const upcomingMaint   = data.scheduled_maintenances.filter(m => m.status !== "completed");

  return (
    <div className="space-y-4">
      {/* Overall status */}
      <div className={clsx("card flex items-center gap-3", indicator.cls)}>
        <div className={clsx("w-3 h-3 rounded-full flex-shrink-0", indicator.dot)} />
        <p className="text-sm font-semibold">{indicator.label}</p>
      </div>

      {/* Component grid */}
      <div className="card">
        <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide mb-3">Components</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {(coreComponents.length > 0 ? coreComponents : data.components.slice(0, 12)).map(c => (
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
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string }[] = [
  { id: "agents",   label: "Agents"   },
  { id: "github",   label: "GitHub"   },
  { id: "vercel",   label: "Vercel"   },
  { id: "supabase", label: "Supabase" },
];

export default function StatusPage() {
  const [tab, setTab] = useState<Tab>("agents");
  const [live, setLive] = useState(false);

  // Single Realtime connection shared across the page lifetime
  useEffect(() => {
    const ch = supabase.channel("status-page-liveness")
      .subscribe(s => setLive(s === "SUBSCRIBED"));
    return () => { supabase.removeChannel(ch); };
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
      <div className={tab === "agents"   ? "block" : "hidden"}><AgentsTab /></div>
      <div className={tab === "github"   ? "block" : "hidden"}><GitHubTab live={live} /></div>
      <div className={tab === "vercel"   ? "block" : "hidden"}><VercelTab /></div>
      <div className={tab === "supabase" ? "block" : "hidden"}><SupabaseTab /></div>
    </div>
  );
}
