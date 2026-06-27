"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { AgentBadge } from "@/components/AgentBadge";
import RegressionPanel from "@/components/status/RegressionPanel";
import AlignmentAuditPanel from "@/components/status/AlignmentAuditPanel";
import WebsitePanel from "@/components/status/WebsitePanel";
import PatchStatusPanel from "@/components/status/PatchStatusPanel";
import { formatDistanceToNow, parseISO } from "date-fns";
import clsx from "clsx";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "agents" | "github" | "vercel" | "supabase" | "vps" | "n8n" | "wordpress" | "audit" | "website" | "patches" | "kick";

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

const REPO_PRIORITY = ["rosenfelt-docs","jordan-agent","riley-agent","avery-agent","casey-agent","rosenfelt-dashboard","website","vps-config","docker-configs","rosenfelt-workflows"];
const HIDDEN_REPOS_STORAGE_KEY = "status_github_hidden_repos";

interface RepoInfo {
  name: string;
  description: string | null;
  html_url: string;
  pushed_at: string | null;
  archived: boolean;
  private: boolean;
  default_branch: string;
}

interface WordpressStatusData {
  configured: boolean;
  wp_url: string | null;
  fetched_at: string;
  posts: {
    pending: { id: number; title: string; status: string; date: string; modified: string; edit_url: string; view_url: string }[];
    draft:   { id: number; title: string; status: string; date: string; modified: string; edit_url: string; view_url: string }[];
    future:  { id: number; title: string; status: string; date: string; modified: string; edit_url: string; view_url: string }[];
  };
  core: { current_version: string | null; latest_version: string | null; update_available: boolean };
  themes: {
    active: { stylesheet: string; name: string; version: string; is_active: boolean } | null;
    all: { stylesheet: string; name: string; version: string; is_active: boolean }[];
  };
  plugins: {
    plugin: string; slug: string; name: string;
    current_version: string; latest_version: string | null;
    update_available: boolean; status: "active" | "inactive"; plugin_uri: string;
  }[];
  errors: string[];
}

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

  const combined = ["jordan","riley","avery","casey","sam"].map(name => ({
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
              [0,1,2,3,4].map(i => (
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
                        <AgentBadge agent={name as "jordan"|"riley"|"avery"|"casey"|"sam"} size="sm" />
                        <span className="font-medium text-brand-black capitalize">{name}</span>
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

function GearIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  );
}

function RepoSettingsModal({
  open, onClose, repos, hidden, onChange,
}: {
  open: boolean;
  onClose: () => void;
  repos: RepoInfo[];
  hidden: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  if (!open) return null;
  const toggle = (name: string) => {
    const next = new Set(hidden);
    if (next.has(name)) next.delete(name); else next.add(name);
    onChange(next);
  };
  const showAll = () => onChange(new Set());
  const hideAll = () => onChange(new Set(repos.map(r => r.name)));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-brand-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-brand-black">Visible repositories</h3>
          <button onClick={onClose} className="text-brand-muted hover:text-brand-black text-lg leading-none">×</button>
        </div>
        <div className="px-4 py-2 border-b border-brand-border flex items-center gap-3 text-xs">
          <button onClick={showAll} className="text-brand-orange hover:underline">Show all</button>
          <span className="text-brand-muted">·</span>
          <button onClick={hideAll} className="text-brand-muted hover:text-brand-black">Hide all</button>
          <span className="ml-auto text-brand-muted">{repos.length - hidden.size} of {repos.length} visible</span>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-2">
          {repos.map(r => (
            <label key={r.name} className="flex items-center gap-2 py-1.5 cursor-pointer hover:bg-brand-offwhite rounded px-1">
              <input
                type="checkbox"
                checked={!hidden.has(r.name)}
                onChange={() => toggle(r.name)}
                className="accent-brand-orange"
              />
              <span className="font-mono text-xs text-brand-black flex-1 truncate">{r.name}</span>
              {r.archived && <span className="badge text-[9px] px-1 py-0 bg-gray-100 text-gray-500">archived</span>}
              {!r.private && <span className="badge text-[9px] px-1 py-0 bg-blue-50 text-blue-700">public</span>}
            </label>
          ))}
        </div>
        <div className="px-4 py-2 border-t border-brand-border text-[10px] text-brand-muted">
          Saved per-browser. Hiding a repo removes it from the GitHub tab only.
        </div>
      </div>
    </div>
  );
}

function GitHubTab({ live: _live }: { live: boolean }) {
  const [runs, setRuns]     = useState<RunLog[]>([]);
  const [repos, setRepos]   = useState<RepoInfo[]>([]);
  const [reposError, setReposError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  // Hydrate hidden-repos preference from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(HIDDEN_REPOS_STORAGE_KEY);
      if (stored) setHidden(new Set(JSON.parse(stored)));
    } catch { /* ignore */ }
  }, []);

  const updateHidden = useCallback((next: Set<string>) => {
    setHidden(next);
    try { localStorage.setItem(HIDDEN_REPOS_STORAGE_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
  }, []);

  const load = useCallback(async () => {
    const [runsData, reposRes] = await Promise.all([
      fetch("/api/github/runs").then(r => r.json()).catch(() => []),
      fetch("/api/github/repos").then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))).catch(e => ({ __error: e instanceof Error ? e.message : String(e) })),
    ]);
    setRuns(Array.isArray(runsData) ? runsData : []);
    if (Array.isArray(reposRes)) {
      setRepos(reposRes);
      setReposError(null);
    } else {
      setRepos([]);
      setReposError(reposRes?.__error ?? reposRes?.message ?? "Failed to load repos");
    }
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

  // Merge repos + runs into one ordered list
  const cards = useMemo(() => {
    const runsByRepo = new Map<string, RunLog[]>();
    for (const run of runs) {
      const list = runsByRepo.get(run.repo) ?? [];
      list.push(run);
      runsByRepo.set(run.repo, list);
    }

    // If repos failed to load, fall back to repos derived from runs only.
    const allRepoNames = new Set<string>();
    repos.forEach(r => allRepoNames.add(r.name));
    runsByRepo.forEach((_v, k) => allRepoNames.add(k));

    const sortKey = (name: string) => {
      const i = REPO_PRIORITY.indexOf(name);
      return i === -1 ? REPO_PRIORITY.length : i;
    };

    return [...allRepoNames]
      .filter(name => !hidden.has(name))
      .sort((a, b) => {
        const ka = sortKey(a), kb = sortKey(b);
        if (ka !== kb) return ka - kb;
        return a.localeCompare(b);
      })
      .map(name => ({
        name,
        info: repos.find(r => r.name === name) ?? null,
        runs: runsByRepo.get(name) ?? [],
      }));
  }, [runs, repos, hidden]);

  if (loading) return <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{[0,1,2,3].map(i=><div key={i} className="card animate-pulse h-36"/>)}</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-brand-muted">
          {cards.length} of {repos.length || runs.length} repos
          {hidden.size > 0 && <span> · {hidden.size} hidden</span>}
          {reposError && <span className="text-red-600 ml-2">· repos: {reposError}</span>}
        </p>
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex items-center gap-1.5 text-xs text-brand-muted hover:text-brand-black px-2 py-1 rounded hover:bg-brand-offwhite"
          aria-label="Repository visibility settings"
        >
          <GearIcon size={13} />
          <span>Repos</span>
        </button>
      </div>

      {reposError && repos.length === 0 && runs.length === 0 && (
        <div className="card text-sm text-brand-muted text-center py-8 mb-4">
          <p className="text-brand-black font-medium mb-1">Repository list unavailable</p>
          <p className="text-xs">Set <code className="bg-brand-offwhite px-1 rounded">GITHUB_API_TOKEN</code> in Vercel to list all repositories. Workflow runs will still appear here when triggered.</p>
        </div>
      )}

      {cards.length === 0 ? (
        <div className="card text-sm text-brand-muted text-center py-12">No repositories to show. Open settings to enable.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cards.map(({ name, info, runs: repoRuns }) => {
            const latest = repoRuns[0] ?? null;
            const meta = latest ? runMeta(latest.status, latest.conclusion) : null;
            const history = repoRuns.slice(1, 6);
            return (
              <div key={name} className="card">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-brand-muted flex-shrink-0">
                      <circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/>
                      <path d="M18 9a9 9 0 0 1-9 9"/><path d="M6 9a9 9 0 0 0 3.6 7.2"/>
                    </svg>
                    {info ? (
                      <a href={info.html_url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-brand-black font-mono truncate hover:text-brand-orange">{name}</a>
                    ) : (
                      <h3 className="text-sm font-semibold text-brand-black font-mono truncate">{name}</h3>
                    )}
                    {info?.archived && <span className="badge text-[9px] px-1 py-0 bg-gray-100 text-gray-500 flex-shrink-0">archived</span>}
                  </div>
                  {meta ? (
                    <span className={clsx("badge text-[10px] px-1.5 py-0.5 flex-shrink-0", meta.badge)}>{meta.label}</span>
                  ) : (
                    <span className="badge text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 flex-shrink-0">No runs</span>
                  )}
                </div>

                {info?.description && (
                  <p className="text-[10px] text-brand-muted mb-1 line-clamp-1">{info.description}</p>
                )}

                {latest && meta ? (
                  <>
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
                  </>
                ) : (
                  <div className="py-3 text-center">
                    <p className="text-xs text-brand-muted">No workflow runs yet</p>
                    {info?.pushed_at && (
                      <p className="text-[10px] text-brand-muted mt-1">Last push {ago(info.pushed_at)}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <RepoSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        repos={repos}
        hidden={hidden}
        onChange={updateHidden}
      />
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

const OVH_CORE_CONTAINERS = ["jordan-agent", "riley-agent", "avery-agent", "casey-agent", "sam-agent", "traefik"];
const HOSTINGER_CORE_CONTAINERS = ["n8n-n8n-1", "wordpress-wordpress-1", "vaultwarden-vaultwarden-1", "docs-mcp", "n8n-traefik-1", "wordpress-wordpress-db-1"];

interface ServerCardProps {
  label: string;
  ip: string;
  stats: VpsStats | null;
  error: string | null;
  coreContainers: string[];
}

function ServerCard({ label, ip, stats, error, coreContainers }: ServerCardProps) {
  if (error) {
    return (
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-brand-black">{label} <span className="font-normal text-brand-muted">— {ip}</span></h2>
        <div className="card p-4 text-sm text-red-600">{error}</div>
      </div>
    );
  }
  if (!stats) {
    return (
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-brand-black">{label} <span className="font-normal text-brand-muted">— {ip}</span></h2>
        <div className="card animate-pulse h-40" />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-brand-black">{label} <span className="font-normal text-brand-muted">— {ip}</span></h2>

      {/* System metrics */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card space-y-2">
          <p className="text-xs text-brand-muted uppercase tracking-wide">CPU</p>
          <p className="text-2xl font-semibold text-brand-black">{stats.cpu_percent.toFixed(1)}%</p>
          <UsageBar percent={stats.cpu_percent} />
        </div>
        <div className="card space-y-2">
          <p className="text-xs text-brand-muted uppercase tracking-wide">Memory</p>
          <p className="text-2xl font-semibold text-brand-black">{stats.memory.percent.toFixed(1)}%</p>
          <UsageBar percent={stats.memory.percent} />
          <p className="text-xs text-brand-muted">{stats.memory.used_gb} / {stats.memory.total_gb} GB</p>
        </div>
        <div className="card space-y-2">
          <p className="text-xs text-brand-muted uppercase tracking-wide">Disk</p>
          <p className="text-2xl font-semibold text-brand-black">{stats.disk.percent}%</p>
          <UsageBar percent={stats.disk.percent} warn={75} danger={90} />
          <p className="text-xs text-brand-muted">{stats.disk.used_gb} / {stats.disk.total_gb} GB</p>
        </div>
      </div>

      {/* Uptime */}
      <p className="text-xs text-brand-muted px-0.5">
        Uptime: <span className="text-brand-black font-medium">{formatUptime(stats.uptime_seconds)}</span>
      </p>

      {/* Containers */}
      <div>
        <p className="text-xs font-medium text-brand-black mb-2">Containers</p>
        <div className="card p-0 overflow-hidden">
          {stats.containers.length === 0 ? (
            <div className="p-4 text-sm text-brand-muted text-center">No running containers found</div>
          ) : (
            stats.containers
              .slice()
              .sort((a, b) => {
                const ai = coreContainers.indexOf(a.name);
                const bi = coreContainers.indexOf(b.name);
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

function VpsTab() {
  const [ovhStats,  setOvhStats]  = useState<VpsStats | null>(null);
  const [hostStats, setHostStats] = useState<VpsStats | null>(null);
  const [ovhError,  setOvhError]  = useState<string | null>(null);
  const [hostError, setHostError] = useState<string | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = useCallback(async () => {
    const [ovhRes, hostRes] = await Promise.all([
      fetch("/api/vps/stats"),
      fetch("/api/hostinger/stats"),
    ]);
    if (ovhRes.ok)  { setOvhStats(await ovhRes.json());   setOvhError(null); }
    else            { setOvhError(`OVH: ${ovhRes.status}`); }
    if (hostRes.ok) { setHostStats(await hostRes.json()); setHostError(null); }
    else            { setHostError(`Hostinger: ${hostRes.status}`); }
    setLastRefresh(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  if (loading) return <div className="space-y-6">{[1, 2].map(i => <div key={i} className="card animate-pulse h-64" />)}</div>;

  return (
    <div className="space-y-8">
      <ServerCard label="OVH" ip="40.160.3.254" stats={ovhStats} error={ovhError} coreContainers={OVH_CORE_CONTAINERS} />
      <ServerCard label="Hostinger" ip="72.61.3.102" stats={hostStats} error={hostError} coreContainers={HOSTINGER_CORE_CONTAINERS} />

      <div className="flex items-center justify-between text-xs text-brand-muted px-0.5">
        <span />
        <div className="flex items-center gap-3">
          {lastRefresh && <span>Updated {formatDistanceToNow(lastRefresh, { addSuffix: true })}</span>}
          <button onClick={load} className="text-brand-orange hover:underline">Refresh</button>
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

// ─── WordPress Tab ────────────────────────────────────────────────────────────

// WP REST returns titles with HTML entities (e.g. "It&#8217;s"). Decode named + numeric
// entities to plain text without touching the DOM (avoids any innerHTML surface).
const HTML_NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…",
  mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  copy: "©", reg: "®", trade: "™",
};
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => HTML_NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

function WordpressTab() {
  const [data, setData] = useState<WordpressStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/wordpress/status");
      if (!res.ok) { setError(`Failed to load (HTTP ${res.status})`); setLoading(false); return; }
      const d = await res.json();
      setData(d);
      setLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch failed");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 600_000); // refresh every 10 min
    return () => clearInterval(id);
  }, [load]);

  if (loading) return <div className="card animate-pulse h-64" />;
  if (error)   return <div className="card text-sm text-red-600 py-8 text-center">{error}</div>;
  if (!data)   return <div className="card text-sm text-brand-muted text-center py-8">No data</div>;

  if (!data.configured) {
    return (
      <div className="card text-sm text-brand-muted text-center py-12">
        <p className="text-brand-black font-medium mb-2">WordPress not configured</p>
        <p className="text-xs">Set <code className="bg-brand-offwhite px-1 rounded">WP_URL</code> and <code className="bg-brand-offwhite px-1 rounded">WP_AUTH</code> in Vercel environment variables.</p>
      </div>
    );
  }

  const totalPosts = data.posts.pending.length + data.posts.draft.length + data.posts.future.length;
  const pluginUpdates = data.plugins.filter(p => p.update_available);
  const activePlugins = data.plugins.filter(p => p.status === "active").length;

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div className="card flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-brand-muted">
            <circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          <a href={data.wp_url ?? "#"} target="_blank" rel="noreferrer" className="text-sm font-semibold text-brand-black hover:text-brand-orange">
            {data.wp_url?.replace(/^https?:\/\//, "")}
          </a>
        </div>
        <span className="text-[10px] text-brand-muted">Updated {ago(data.fetched_at)}</span>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card text-center py-3">
          <p className={clsx("text-xl font-semibold", totalPosts > 0 ? "text-amber-600" : "text-brand-black")}>{totalPosts}</p>
          <p className="text-[10px] text-brand-muted mt-0.5 uppercase tracking-wide">Posts in queue</p>
        </div>
        <div className="card text-center py-3">
          <p className={clsx("text-xl font-semibold", pluginUpdates.length > 0 ? "text-amber-600" : "text-green-600")}>{pluginUpdates.length}</p>
          <p className="text-[10px] text-brand-muted mt-0.5 uppercase tracking-wide">Plugin updates</p>
        </div>
        <div className="card text-center py-3">
          <p className={clsx("text-xl font-semibold", data.core.update_available ? "text-amber-600" : "text-green-600")}>
            {data.core.current_version ?? "—"}
          </p>
          <p className="text-[10px] text-brand-muted mt-0.5 uppercase tracking-wide">WordPress core</p>
        </div>
        <div className="card text-center py-3">
          <p className="text-xl font-semibold text-brand-black">{activePlugins}</p>
          <p className="text-[10px] text-brand-muted mt-0.5 uppercase tracking-wide">Active plugins</p>
        </div>
      </div>

      {/* Errors (if any) */}
      {data.errors.length > 0 && (
        <div className="card border-amber-200 bg-amber-50">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">Fetch warnings</p>
          <ul className="text-xs text-amber-900 space-y-0.5 font-mono">
            {data.errors.map((e, i) => <li key={i}>· {e}</li>)}
          </ul>
        </div>
      )}

      {/* Posts in queue */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">Posts in queue</p>
          <span className="text-[10px] text-brand-muted">
            {data.posts.pending.length} pending · {data.posts.draft.length} drafts · {data.posts.future.length} scheduled
          </span>
        </div>
        {totalPosts === 0 ? (
          <p className="text-xs text-brand-muted text-center py-3">No posts pending, drafted, or scheduled.</p>
        ) : (
          <div className="divide-y divide-brand-border">
            {[
              { label: "pending",   list: data.posts.pending,  badge: "bg-amber-50 text-amber-700" },
              { label: "draft",     list: data.posts.draft,    badge: "bg-gray-100 text-gray-600" },
              { label: "scheduled", list: data.posts.future,   badge: "bg-blue-50 text-blue-700"  },
            ].flatMap(group => group.list.map(p => ({ ...p, _group: group.label, _badge: group.badge })))
              .map(p => (
              <div key={`${p._group}-${p.id}`} className="flex items-center gap-3 py-2 text-xs">
                <span className={clsx("badge text-[9px] px-1.5 py-0.5 capitalize flex-shrink-0", p._badge)}>{p._group}</span>
                <span className="flex-1 truncate text-brand-black">{decodeHtmlEntities(p.title)}</span>
                <span className="text-[10px] text-brand-muted flex-shrink-0">
                  {p._group === "scheduled" ? `for ${new Date(p.date).toLocaleDateString()}` : ago(p.modified)}
                </span>
                <a href={p.edit_url} target="_blank" rel="noreferrer" className="text-brand-muted hover:text-brand-orange flex-shrink-0" title="Edit in wp-admin">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </a>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Core + theme */}
      <div className="card">
        <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide mb-3">Core & theme</p>
        <div className="space-y-2">
          <div className="flex items-center gap-3 py-1.5 text-xs">
            <span className="font-mono text-brand-black flex-1">WordPress core</span>
            <span className="text-brand-muted">v{data.core.current_version ?? "unknown"}</span>
            {data.core.update_available ? (
              <span className="badge text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-700">→ {data.core.latest_version}</span>
            ) : data.core.current_version ? (
              <span className="badge text-[10px] px-1.5 py-0.5 bg-green-50 text-green-700">up to date</span>
            ) : (
              <span className="badge text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500">—</span>
            )}
          </div>
          {data.themes.active && (
            <div className="flex items-center gap-3 py-1.5 text-xs border-t border-brand-border pt-2">
              <span className="font-mono text-brand-black flex-1">{decodeHtmlEntities(data.themes.active.name)} <span className="text-brand-muted">(active theme)</span></span>
              <span className="text-brand-muted">v{data.themes.active.version}</span>
            </div>
          )}
          {data.themes.all.filter(t => !t.is_active).length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-brand-muted hover:text-brand-black py-1">
                {data.themes.all.filter(t => !t.is_active).length} inactive theme(s)
              </summary>
              <div className="divide-y divide-brand-border mt-1">
                {data.themes.all.filter(t => !t.is_active).map(t => (
                  <div key={t.stylesheet} className="flex items-center gap-3 py-1.5">
                    <span className="font-mono text-brand-black flex-1">{decodeHtmlEntities(t.name)}</span>
                    <span className="text-brand-muted">v{t.version}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>

      {/* Plugins */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">Plugins</p>
          <span className="text-[10px] text-brand-muted">{data.plugins.length} installed · {activePlugins} active</span>
        </div>
        {data.plugins.length === 0 ? (
          <p className="text-xs text-brand-muted text-center py-3">No plugins reported.</p>
        ) : (
          <div className="divide-y divide-brand-border">
            {data.plugins.map(p => (
              <div key={p.plugin} className="flex items-center gap-3 py-1.5 text-xs">
                <div className={clsx("w-1.5 h-1.5 rounded-full flex-shrink-0",
                  p.update_available ? "bg-amber-400" : p.status === "active" ? "bg-green-500" : "bg-gray-300")} />
                <span className="text-brand-black flex-1 truncate">{decodeHtmlEntities(p.name)}</span>
                <span className="text-brand-muted text-[10px] font-mono flex-shrink-0">v{p.current_version}</span>
                {p.update_available && p.latest_version ? (
                  <span className="badge text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-700 flex-shrink-0">→ {p.latest_version}</span>
                ) : p.status === "active" ? (
                  <span className="badge text-[9px] px-1 py-0 bg-green-50 text-green-700 flex-shrink-0">active</span>
                ) : (
                  <span className="badge text-[9px] px-1 py-0 bg-gray-100 text-gray-500 flex-shrink-0">inactive</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Kick Tab ─────────────────────────────────────────────────────────────────

interface KickStatus {
  configured: boolean;
  connected: boolean;
  workspace?: string | null;
  workspace_id?: string | null;
  entity_id?: number | null;
  latency_ms?: number | null;
  summary?: string | null;
  endpoint?: string | null;
  error?: string | null;
}

function parseKickSummary(summary: string | null | undefined) {
  if (!summary) return null;
  const money = summary.match(/income=\$([\d,.-]+), expenses=\$([\d,.-]+), net=\$([\d,.-]+)/);
  const period = summary.match(/\(([^,]+), ([\d-]+)\.\.([\d-]+)\)/);
  if (!money) return null;
  return {
    income: money[1],
    expenses: money[2],
    net: money[3],
    periodLabel: period?.[1] ?? null,
    start: period?.[2] ?? null,
    end: period?.[3] ?? null,
  };
}

function KickTab() {
  const [data, setData] = useState<KickStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    const d = await fetch("/api/kick/status").then(r => r.json()).catch(() => ({
      configured: false, connected: false, error: "Failed to reach dashboard API",
    }));
    setData(d);
    setCheckedAt(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 300_000); // refresh every 5 min
    return () => clearInterval(id);
  }, [load]);

  if (loading) return <div className="card animate-pulse h-48" />;
  if (!data) return <div className="card text-sm text-brand-muted text-center py-8">No data</div>;

  if (!data.configured) {
    return (
      <div className="card text-sm text-brand-muted text-center py-12">
        <p className="text-brand-black font-medium mb-2">Kick not configured</p>
        <p className="text-xs">
          Set <code className="bg-brand-offwhite px-1 rounded">KICK_API_KEY</code> in sam-agent&apos;s environment.
        </p>
        {data.error && <p className="text-[10px] text-brand-muted mt-2 font-mono">{data.error}</p>}
      </div>
    );
  }

  const pnl = parseKickSummary(data.summary);

  return (
    <div className="space-y-4">
      {/* Connectivity header */}
      <div className="card flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={clsx("w-3 h-3 rounded-full flex-shrink-0",
            data.connected ? "bg-green-500" : "bg-red-500")} />
          <div>
            <p className="text-sm font-semibold text-brand-black">
              Kick · Self-Driving Bookkeeping
            </p>
            <p className="text-[10px] text-brand-muted font-mono mt-0.5">
              {data.endpoint ?? "use.kick.co/mcp"}
            </p>
          </div>
        </div>
        <span className={clsx("badge text-xs px-2 py-0.5",
          data.connected ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700")}>
          {data.connected ? "Connected" : "Disconnected"}
        </span>
      </div>

      {/* Connection detail strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="card text-center py-3">
          <p className="text-sm font-semibold text-brand-black truncate">{data.workspace ?? "—"}</p>
          <p className="text-[10px] text-brand-muted mt-0.5 uppercase tracking-wide">Workspace</p>
        </div>
        <div className="card text-center py-3">
          <p className="text-sm font-semibold text-brand-black tabular-nums">{data.entity_id ?? "—"}</p>
          <p className="text-[10px] text-brand-muted mt-0.5 uppercase tracking-wide">Entity ID</p>
        </div>
        <div className="card text-center py-3">
          <p className="text-sm font-semibold text-brand-black tabular-nums">
            {data.latency_ms != null ? `${data.latency_ms} ms` : "—"}
          </p>
          <p className="text-[10px] text-brand-muted mt-0.5 uppercase tracking-wide">Latency</p>
        </div>
      </div>

      {/* P&L snapshot */}
      {data.connected && pnl ? (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">
              Profit &amp; Loss · last 30 days
            </p>
            {pnl.start && pnl.end && (
              <span className="text-[10px] text-brand-muted">{pnl.start} → {pnl.end}</span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-brand-offwhite rounded-lg p-3 text-center">
              <p className="text-lg font-semibold text-green-600">${pnl.income}</p>
              <p className="text-[10px] text-brand-muted mt-0.5 uppercase tracking-wide">Income</p>
            </div>
            <div className="bg-brand-offwhite rounded-lg p-3 text-center">
              <p className="text-lg font-semibold text-brand-black">${pnl.expenses}</p>
              <p className="text-[10px] text-brand-muted mt-0.5 uppercase tracking-wide">Expenses</p>
            </div>
            <div className="bg-brand-offwhite rounded-lg p-3 text-center">
              <p className={clsx("text-lg font-semibold",
                pnl.net.startsWith("-") ? "text-red-600" : "text-brand-black")}>${pnl.net}</p>
              <p className="text-[10px] text-brand-muted mt-0.5 uppercase tracking-wide">Net</p>
            </div>
          </div>
        </div>
      ) : data.connected && data.summary ? (
        <div className="card text-xs text-brand-muted font-mono">{data.summary}</div>
      ) : null}

      {/* Error */}
      {!data.connected && data.error && (
        <div className="card border-red-200 bg-red-50">
          <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1">Connection error</p>
          <p className="text-xs text-red-900 font-mono break-all">{data.error}</p>
        </div>
      )}

      {checkedAt && (
        <p className="text-[11px] text-brand-muted text-right">
          Checked {checkedAt.toLocaleTimeString()} · refreshes every 5 min
        </p>
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
  { id: "wordpress",  label: "WordPress"  },
  { id: "audit",      label: "Audit"      },
  { id: "website",    label: "Website"    },
  { id: "patches",    label: "Patches"    },
  { id: "kick",       label: "Kick"       },
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
      <div className={tab === "wordpress"  ? "block" : "hidden"}><WordpressTab /></div>
      <div className={tab === "audit" ? "block" : "hidden"}>
        <div className="space-y-8">
          <AlignmentAuditPanel isAdmin={isAdmin} />
          <div>
            <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide mb-4">Regression Tests</p>
            <RegressionPanel isAdmin={isAdmin} />
          </div>
        </div>
      </div>
      <div className={tab === "website"    ? "block" : "hidden"}><WebsitePanel isAdmin={isAdmin} /></div>
      <div className={tab === "patches"    ? "block" : "hidden"}><PatchStatusPanel /></div>
      <div className={tab === "kick"       ? "block" : "hidden"}><KickTab /></div>
    </div>
  );
}
