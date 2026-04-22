"use client";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { formatDistanceToNow, parseISO } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SpendLog {
  request_id:         string;
  call_type:          string;
  model:              string;
  spend:              number;
  total_tokens:       number;
  prompt_tokens:      number;
  completion_tokens:  number;
  user?:              string;
  startTime:          string;
  tags?:              string[];
}

interface TagSpend {
  individual_request_tag: string;
  log_count:              number;
  total_spend:            number;
}

interface DailySpend {
  date:        string;
  total_spend: number;
}

interface CostData {
  logs:  SpendLog[];
  tags:  TagSpend[];
  daily: DailySpend[];
}

const AGENTS = ["jordan", "riley", "avery"] as const;
type Agent = typeof AGENTS[number];

const AGENT_COLORS: Record<string, string> = {
  jordan: "bg-blue-50 text-blue-700 border-blue-200",
  riley:  "bg-purple-50 text-purple-700 border-purple-200",
  avery:  "bg-green-50 text-green-700 border-green-200",
};

const MODEL_SHORT: Record<string, string> = {
  "claude-3-5-sonnet-20241022": "Sonnet 3.5",
  "claude-3-5-haiku-20241022":  "Haiku 3.5",
  "claude-3-opus-20240229":     "Opus 3",
  "claude-sonnet-4-5":          "Sonnet 4.5",
  "claude-opus-4-5":            "Opus 4.5",
  "claude-haiku-4-5":           "Haiku 4.5",
};

function shortModel(m: string) {
  return MODEL_SHORT[m] ?? m.split("/").pop() ?? m;
}

function fmt$(n: number) {
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function fmtK(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// ─── Micro bar chart ──────────────────────────────────────────────────────────

function SparkBar({ daily, days }: { daily: DailySpend[]; days: number }) {
  if (daily.length === 0) return null;
  const max = Math.max(...daily.map(d => d.total_spend), 0.0001);
  // pad to `days` buckets
  const today = new Date();
  const buckets: number[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().split("T")[0];
    const found = daily.find(x => x.date === iso);
    buckets.push(found?.total_spend ?? 0);
  }

  return (
    <div className="flex items-end gap-0.5 h-10 w-full">
      {buckets.map((v, i) => (
        <div
          key={i}
          className="flex-1 bg-brand-orange rounded-sm opacity-80 min-h-[2px] transition-all"
          style={{ height: `${Math.max((v / max) * 100, 4)}%` }}
          title={`${fmt$(v)}`}
        />
      ))}
    </div>
  );
}

// ─── Agent spend bar ─────────────────────────────────────────────────────────

function AgentBar({ agent, spend, total }: { agent: string; spend: number; total: number }) {
  const pct = total > 0 ? (spend / total) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className={clsx(
          "inline-flex items-center px-2 py-0.5 rounded border font-medium capitalize",
          AGENT_COLORS[agent] ?? "bg-gray-50 text-gray-600 border-gray-200"
        )}>{agent}</span>
        <span className="text-brand-black font-medium">{fmt$(spend)}</span>
      </div>
      <div className="h-1.5 bg-brand-offwhite rounded-full overflow-hidden">
        <div
          className={clsx(
            "h-full rounded-full transition-all",
            agent === "jordan" ? "bg-blue-400"   :
            agent === "riley"  ? "bg-purple-400" :
            agent === "avery"  ? "bg-green-400"  : "bg-gray-400"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[10px] text-brand-muted">{pct.toFixed(1)}% of total</p>
    </div>
  );
}

// ─── Not configured placeholder ──────────────────────────────────────────────

function NotConfigured() {
  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-brand-black">Cost</h1>
        <p className="text-sm text-brand-muted mt-0.5">API usage and cost tracking</p>
      </div>
      <div className="card text-center py-16">
        <div className="w-10 h-10 bg-brand-offwhite rounded-xl flex items-center justify-center mx-auto mb-4">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
               stroke="#C05621" strokeWidth="2" strokeLinecap="round">
            <line x1="12" y1="1" x2="12" y2="23"/>
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
        </div>
        <p className="text-sm font-medium text-brand-black">LiteLLM not yet connected</p>
        <p className="text-xs text-brand-muted mt-2 max-w-sm mx-auto">
          Add <code className="bg-brand-offwhite px-1 rounded">LITELLM_BASE_URL</code> and{" "}
          <code className="bg-brand-offwhite px-1 rounded">LITELLM_MASTER_KEY</code> to{" "}
          <code className="bg-brand-offwhite px-1 rounded">.env.local</code> to activate cost tracking.
        </p>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CostPage() {
  const [data,    setData]    = useState<CostData | null>(null);
  const [days,    setDays]    = useState(30);
  const [loading, setLoading] = useState(true);
  const [notConfigured, setNotConfigured] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/cost?days=${days}`)
      .then(r => {
        if (r.status === 503) { setNotConfigured(true); setLoading(false); return null; }
        return r.json();
      })
      .then(d => {
        if (d) { setData(d); setLoading(false); }
      })
      .catch(() => setLoading(false));
  }, [days]);

  if (notConfigured) return <NotConfigured />;

  // ── Derived stats ──────────────────────────────────────────────────────────

  const logs  = data?.logs  ?? [];
  const tags  = data?.tags  ?? [];
  const daily = data?.daily ?? [];

  const totalSpend  = logs.reduce((s, l) => s + (l.spend ?? 0), 0);
  const totalTokens = logs.reduce((s, l) => s + (l.total_tokens ?? 0), 0);
  const totalCalls  = logs.length;

  // Today's spend
  const todayStr   = new Date().toISOString().split("T")[0];
  const todaySpend = daily.find(d => d.date === todayStr)?.total_spend ?? 0;

  // Per-agent spend — match by `user` field or tags
  const agentSpend: Record<string, number> = {};
  for (const agent of AGENTS) agentSpend[agent] = 0;
  for (const log of logs) {
    const agent = (log.user ?? "").toLowerCase();
    if (agent in agentSpend) agentSpend[agent] += log.spend ?? 0;
  }
  // Also sum from tag spend if user field not populated
  const taggedTotal = tags.reduce((s, t) => s + t.total_spend, 0);
  const useTagFallback = taggedTotal > 0 && Object.values(agentSpend).every(v => v === 0);
  if (useTagFallback) {
    for (const t of tags) {
      const agent = t.individual_request_tag.toLowerCase();
      if (agent in agentSpend) agentSpend[agent] = t.total_spend;
    }
  }

  // Per-model breakdown
  const modelSpend: Record<string, { spend: number; calls: number; tokens: number }> = {};
  for (const log of logs) {
    const m = log.model ?? "unknown";
    if (!modelSpend[m]) modelSpend[m] = { spend: 0, calls: 0, tokens: 0 };
    modelSpend[m].spend  += log.spend ?? 0;
    modelSpend[m].calls  += 1;
    modelSpend[m].tokens += log.total_tokens ?? 0;
  }
  const modelRows = Object.entries(modelSpend)
    .sort((a, b) => b[1].spend - a[1].spend)
    .slice(0, 8);

  // Recent logs
  const recentLogs = [...logs]
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
    .slice(0, 50);

  if (loading) {
    return (
      <div className="p-4 md:p-8 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="card animate-pulse h-20" />)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card animate-pulse h-48" />
          <div className="card animate-pulse h-48" />
        </div>
        <div className="card animate-pulse h-64" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 pb-24 md:pb-8 space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-brand-black">Cost</h1>
          <p className="text-sm text-brand-muted mt-0.5">API usage via LiteLLM proxy</p>
        </div>
        <div className="flex gap-1">
          {([7, 30, 90] as const).map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={clsx(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                days === d ? "bg-brand-orange text-white" : "bg-brand-offwhite text-brand-muted hover:bg-brand-border"
              )}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card">
          <p className="text-xs text-brand-muted mb-1">Total spend ({days}d)</p>
          <p className="text-2xl font-semibold text-brand-black">{fmt$(totalSpend)}</p>
          <p className="text-xs text-brand-muted mt-1">Today: {fmt$(todaySpend)}</p>
        </div>
        <div className="card">
          <p className="text-xs text-brand-muted mb-1">API calls</p>
          <p className="text-2xl font-semibold text-brand-black">{totalCalls.toLocaleString()}</p>
          <p className="text-xs text-brand-muted mt-1">
            {totalCalls > 0 ? `avg ${fmt$(totalSpend / totalCalls)} / call` : "—"}
          </p>
        </div>
        <div className="card">
          <p className="text-xs text-brand-muted mb-1">Total tokens</p>
          <p className="text-2xl font-semibold text-brand-black">{fmtK(totalTokens)}</p>
          <p className="text-xs text-brand-muted mt-1">
            {totalTokens > 0 ? `$${((totalSpend / totalTokens) * 1000).toFixed(4)} / 1k` : "—"}
          </p>
        </div>
        <div className="card">
          <p className="text-xs text-brand-muted mb-1">Daily avg</p>
          <p className="text-2xl font-semibold text-brand-black">
            {fmt$(days > 0 ? totalSpend / days : 0)}
          </p>
          <p className="text-xs text-brand-muted mt-1">over {days} days</p>
        </div>
      </div>

      {/* Spark chart + agent breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Daily chart */}
        <div className="card">
          <p className="text-xs font-medium text-brand-muted mb-3">Daily spend — last {days} days</p>
          {daily.length > 0 ? (
            <SparkBar daily={daily} days={days} />
          ) : (
            <div className="h-10 flex items-center justify-center text-xs text-brand-muted">
              No data yet
            </div>
          )}
          <div className="flex justify-between text-[10px] text-brand-muted mt-1">
            <span>{days}d ago</span>
            <span>today</span>
          </div>
        </div>

        {/* Per-agent breakdown */}
        <div className="card space-y-3">
          <p className="text-xs font-medium text-brand-muted">Spend by agent</p>
          {AGENTS.map(agent => (
            <AgentBar
              key={agent}
              agent={agent}
              spend={agentSpend[agent]}
              total={totalSpend}
            />
          ))}
          {Object.values(agentSpend).every(v => v === 0) && (
            <p className="text-xs text-brand-muted pt-1">
              Per-agent breakdown requires agents to pass <code className="bg-brand-offwhite px-1 rounded">user: &quot;jordan&quot;</code> in API calls.
            </p>
          )}
        </div>
      </div>

      {/* Model breakdown */}
      {modelRows.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-brand-border bg-brand-offwhite">
            <p className="text-xs font-medium text-brand-muted">Spend by model</p>
          </div>
          <div className="divide-y divide-brand-border">
            {modelRows.map(([model, s]) => (
              <div key={model} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="flex-1 text-brand-black font-medium">{shortModel(model)}</span>
                <span className="text-xs text-brand-muted hidden md:inline">{s.calls.toLocaleString()} calls</span>
                <span className="text-xs text-brand-muted hidden md:inline">{fmtK(s.tokens)} tokens</span>
                <div className="w-24 h-1.5 bg-brand-offwhite rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand-orange rounded-full"
                    style={{ width: `${totalSpend > 0 ? (s.spend / totalSpend) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-xs font-medium text-brand-black w-14 text-right">{fmt$(s.spend)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent call log */}
      <div>
        <h2 className="text-sm font-medium text-brand-black mb-3">Recent calls</h2>
        {recentLogs.length === 0 ? (
          <div className="card py-12 text-center">
            <p className="text-sm text-brand-muted">No API calls recorded yet</p>
          </div>
        ) : (
          <div className="card p-0 overflow-hidden">
            <div className="divide-y divide-brand-border">
              {recentLogs.map((log, i) => (
                <div key={log.request_id ?? i} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-brand-offwhite">
                  {/* Agent chip */}
                  {log.user ? (
                    <span className={clsx(
                      "inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium capitalize flex-shrink-0",
                      AGENT_COLORS[log.user.toLowerCase()] ?? "bg-gray-50 text-gray-600 border-gray-200"
                    )}>
                      {log.user}
                    </span>
                  ) : (
                    <span className="text-xs text-brand-muted flex-shrink-0">—</span>
                  )}

                  {/* Model */}
                  <span className="text-xs text-brand-muted flex-shrink-0 hidden sm:inline w-24 truncate">
                    {shortModel(log.model ?? "")}
                  </span>

                  {/* Call type */}
                  <span className="text-xs text-brand-muted flex-shrink-0 hidden md:inline capitalize">
                    {log.call_type ?? "completion"}
                  </span>

                  <div className="flex-1" />

                  {/* Tokens */}
                  <span className="text-xs text-brand-muted flex-shrink-0 hidden md:inline">
                    {fmtK(log.total_tokens ?? 0)} tok
                  </span>

                  {/* Spend */}
                  <span className="text-xs font-medium text-brand-black flex-shrink-0 w-14 text-right">
                    {fmt$(log.spend ?? 0)}
                  </span>

                  {/* Time */}
                  <span className="text-xs text-brand-muted flex-shrink-0 w-20 text-right">
                    {log.startTime
                      ? formatDistanceToNow(parseISO(log.startTime), { addSuffix: true })
                      : "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
