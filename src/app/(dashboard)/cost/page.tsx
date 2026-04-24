"use client";
import { useCallback, useEffect, useState } from "react";
import { AgentBadge } from "@/components/AgentBadge";
import clsx from "clsx";

type Agent = "jordan" | "riley" | "avery";

interface AgentSummary {
  agent: Agent;
  todayCost: number;
  todayTokens: number;
  weekCost: number;
  weekTokens: number;
  callsToday: number;
  dailyBudget: number;
}

interface DailyRow {
  date: string;
  agent: Agent;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
}

function fmt(n: number, decimals = 4) {
  return `$${n.toFixed(decimals)}`;
}

function fmtTokens(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function SpendBar({ spend, budget }: { spend: number; budget: number }) {
  const pct = budget > 0 ? Math.min((spend / budget) * 100, 100) : 0;
  return (
    <div className="mt-2">
      <div className="flex justify-between text-[10px] text-brand-muted mb-1">
        <span>{fmt(spend)} spent</span>
        <span>{fmt(budget, 2)} cap</span>
      </div>
      <div className="h-1.5 bg-brand-offwhite rounded-full overflow-hidden">
        <div
          className={clsx(
            "h-full rounded-full transition-all",
            pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-400" : "bg-green-500"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function BudgetInput({ agent, current, onSave }: { agent: Agent; current: number; onSave: (v: number) => Promise<void> }) {
  const [val, setVal] = useState(current.toFixed(2));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setVal(current.toFixed(2)); }, [current]);

  async function handleSave() {
    const parsed = parseFloat(val);
    if (isNaN(parsed) || parsed < 0) return;
    setSaving(true);
    await onSave(parsed);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="flex items-center gap-2 mt-3">
      <span className="text-xs text-brand-muted">Daily cap</span>
      <div className="flex items-center border border-brand-border rounded-lg overflow-hidden">
        <span className="px-2 text-xs text-brand-muted bg-brand-offwhite border-r border-brand-border">$</span>
        <input
          type="number"
          min="0"
          step="0.50"
          value={val}
          onChange={e => setVal(e.target.value)}
          className="w-20 px-2 py-1.5 text-xs text-brand-black focus:outline-none"
        />
      </div>
      <button
        onClick={handleSave}
        disabled={saving}
        className={clsx(
          "text-xs px-3 py-1.5 rounded-lg font-medium transition-colors",
          saved
            ? "bg-green-100 text-green-700"
            : "bg-brand-orange text-white hover:bg-brand-orange/90 disabled:opacity-50"
        )}
      >
        {saved ? "Saved ✓" : saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

export default function CostPage() {
  const [agents,  setAgents]  = useState<AgentSummary[]>([]);
  const [daily,   setDaily]   = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res  = await fetch("/api/usage?days=7");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAgents(data.agents ?? []);
      setDaily(data.daily ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [load]);

  async function updateBudget(agent: Agent, value: number) {
    await fetch("/api/usage/budget", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent, daily_budget_usd: value }),
    });
    setAgents(prev =>
      prev.map(a => a.agent === agent ? { ...a, dailyBudget: value } : a)
    );
  }

  const totalWeekCost  = agents.reduce((s, a) => s + a.weekCost, 0);
  const totalTodayCost = agents.reduce((s, a) => s + a.todayCost, 0);

  return (
    <div className="p-4 md:p-8 pb-24 md:pb-8 max-w-5xl">
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-brand-black">Cost</h1>
          <p className="text-sm text-brand-muted mt-0.5">
            API usage and spend — today &amp; last 7 days
          </p>
        </div>
        {!loading && !error && (
          <div className="text-right">
            <p className="text-xs text-brand-muted">Today</p>
            <p className="text-lg font-semibold text-brand-black">{fmt(totalTodayCost)}</p>
            <p className="text-xs text-brand-muted mt-0.5">7-day: {fmt(totalWeekCost, 2)}</p>
          </div>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {[1, 2, 3].map(i => <div key={i} className="card animate-pulse h-44" />)}
        </div>
      ) : error ? (
        <div className="card p-6 text-sm text-red-600 bg-red-50 mb-8">{error}</div>
      ) : (
        <>
          {/* ── Per-agent cards ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            {agents.map(a => (
              <div key={a.agent} className="card">
                <div className="flex items-center gap-2 mb-3">
                  <AgentBadge agent={a.agent} size="sm" />
                  <span className="text-sm font-medium text-brand-black capitalize">{a.agent}</span>
                  <span className="ml-auto text-xs text-brand-muted">{a.callsToday} calls today</span>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="bg-brand-offwhite rounded-lg p-2 text-center">
                    <p className="text-base font-semibold text-brand-black">{fmt(a.todayCost)}</p>
                    <p className="text-[10px] text-brand-muted">today</p>
                  </div>
                  <div className="bg-brand-offwhite rounded-lg p-2 text-center">
                    <p className="text-base font-semibold text-brand-black">{fmt(a.weekCost, 2)}</p>
                    <p className="text-[10px] text-brand-muted">7 days</p>
                  </div>
                  <div className="bg-brand-offwhite rounded-lg p-2 text-center">
                    <p className="text-base font-semibold text-brand-black">{fmtTokens(a.todayTokens)}</p>
                    <p className="text-[10px] text-brand-muted">tokens today</p>
                  </div>
                  <div className="bg-brand-offwhite rounded-lg p-2 text-center">
                    <p className="text-base font-semibold text-brand-black">{fmtTokens(a.weekTokens)}</p>
                    <p className="text-[10px] text-brand-muted">tokens 7d</p>
                  </div>
                </div>

                <SpendBar spend={a.todayCost} budget={a.dailyBudget} />
                <BudgetInput agent={a.agent} current={a.dailyBudget} onSave={v => updateBudget(a.agent, v)} />
              </div>
            ))}
          </div>

          {/* ── Daily breakdown table ── */}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-brand-border">
              <h2 className="text-sm font-medium text-brand-black">Daily breakdown — last 7 days</h2>
            </div>
            {daily.length === 0 ? (
              <p className="text-xs text-brand-muted text-center py-10">No usage recorded yet</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-brand-border bg-brand-offwhite">
                      <th className="text-left px-4 py-2 text-brand-muted font-medium">Date</th>
                      <th className="text-left px-4 py-2 text-brand-muted font-medium">Agent</th>
                      <th className="text-right px-4 py-2 text-brand-muted font-medium">Calls</th>
                      <th className="text-right px-4 py-2 text-brand-muted font-medium">Prompt</th>
                      <th className="text-right px-4 py-2 text-brand-muted font-medium">Completion</th>
                      <th className="text-right px-4 py-2 text-brand-muted font-medium">Total</th>
                      <th className="text-right px-4 py-2 text-brand-muted font-medium">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {daily.map((row, i) => (
                      <tr key={i} className="border-b border-brand-border last:border-0 hover:bg-brand-offwhite/50">
                        <td className="px-4 py-2.5 text-brand-black">{row.date}</td>
                        <td className="px-4 py-2.5">
                          <AgentBadge agent={row.agent} size="sm" />
                        </td>
                        <td className="px-4 py-2.5 text-right text-brand-black">{row.calls}</td>
                        <td className="px-4 py-2.5 text-right text-brand-muted">{fmtTokens(row.prompt_tokens)}</td>
                        <td className="px-4 py-2.5 text-right text-brand-muted">{fmtTokens(row.completion_tokens)}</td>
                        <td className="px-4 py-2.5 text-right text-brand-black">{fmtTokens(row.total_tokens)}</td>
                        <td className="px-4 py-2.5 text-right font-medium text-brand-black">{fmt(row.cost_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
