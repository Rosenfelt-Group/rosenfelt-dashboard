"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { supabase } from "@/lib/supabase";

type CheckStatus = "pass" | "fail" | "warn" | "skip";
type OverallStatus = "pass" | "degraded" | "fail" | "pending";

interface CheckResult {
  name: string;
  tier: number;
  category: string;
  target: string;
  status: CheckStatus;
  expected: string;
  actual: string;
  duration_ms: number;
  error?: string;
}

interface RegressionRun {
  id: string;
  run_at: string;
  triggered_by: string;
  triggered_by_user: string | null;
  overall_status: OverallStatus;
  passed: number;
  failed: number;
  warnings: number;
  total_checks: number;
  duration_ms: number;
  summary: string | null;
  results: CheckResult[] | null;
}

const OVERALL_BADGE: Record<OverallStatus, string> = {
  pass: "badge-success",
  degraded: "badge-warning",
  fail: "badge-error",
  pending: "badge-neutral",
};

const CHECK_DOT: Record<CheckStatus, string> = {
  pass: "bg-green-500",
  fail: "bg-red-500",
  warn: "bg-amber-400",
  skip: "bg-gray-300",
};

const CATEGORY_ORDER = [
  "agent",
  "dashboard",
  "dashboard_api",
  "wordpress",
  "n8n",
  "supabase",
  "config",
];

function groupByCategory(results: CheckResult[]): Record<string, CheckResult[]> {
  const groups: Record<string, CheckResult[]> = {};
  for (const r of results) {
    if (!groups[r.category]) groups[r.category] = [];
    groups[r.category].push(r);
  }
  return groups;
}

export default function RegressionPanel({ isAdmin }: { isAdmin: boolean }) {
  const [latest, setLatest] = useState<RegressionRun | null>(null);
  const [history, setHistory] = useState<RegressionRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const [latestRes, histRes] = await Promise.all([
        fetch("/api/regression/latest"),
        fetch("/api/regression/history?limit=10"),
      ]);
      const latestData = latestRes.ok ? await latestRes.json() : null;
      const histData = histRes.ok ? await histRes.json() : [];
      setLatest(latestData);
      setHistory(Array.isArray(histData) ? histData : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("regression-panel")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "regression_runs" },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  const handleRunNow = async () => {
    setRunning(true);
    setRunError(null);
    try {
      const res = await fetch("/api/regression/run", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setRunError(body.error ?? `Error ${res.status}`);
      }
    } catch (err) {
      setRunError(String(err));
    } finally {
      setRunning(false);
    }
  };

  const toggleCategory = (cat: string) =>
    setExpanded((prev) => ({ ...prev, [cat]: !prev[cat] }));

  if (loading) return <div className="card animate-pulse h-64" />;

  const grouped = latest?.results ? groupByCategory(latest.results) : {};
  const sortedCategories = CATEGORY_ORDER.filter((c) => grouped[c]).concat(
    Object.keys(grouped).filter((c) => !CATEGORY_ORDER.includes(c)),
  );

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-brand-black">Regression Tests</p>
          {latest && (
            <p className="text-xs text-brand-muted mt-0.5">
              Last run: {new Date(latest.run_at).toLocaleString()} by {latest.triggered_by}
              {latest.triggered_by_user ? ` (${latest.triggered_by_user})` : ""}
            </p>
          )}
        </div>
        {isAdmin && (
          <button
            onClick={handleRunNow}
            disabled={running}
            className="btn-primary text-sm px-4 py-2 disabled:opacity-60"
          >
            {running ? "Starting…" : "▶ Run Now"}
          </button>
        )}
      </div>

      {runError && (
        <div className="card border-red-200 text-sm text-red-600">
          Failed to trigger run: {runError}
        </div>
      )}

      {running && (
        <div className="card border-amber-200 text-sm text-amber-700">
          ⏳ Regression suite is running — results refresh automatically when the run finishes (~5–60s).
        </div>
      )}

      {/* Latest summary */}
      {latest ? (
        <div className="card space-y-3">
          <div className="flex items-center gap-3">
            <span className={clsx("uppercase text-xs font-semibold", OVERALL_BADGE[latest.overall_status] ?? "badge-neutral")}>
              {latest.overall_status}
            </span>
            <span className="text-xs text-brand-muted">
              {latest.passed}/{latest.total_checks} passed · {latest.failed} failed · {latest.warnings} warnings
              {latest.duration_ms ? ` · ${(latest.duration_ms / 1000).toFixed(1)}s` : ""}
            </span>
          </div>

          {sortedCategories.map((cat) => {
            const checks = grouped[cat] ?? [];
            const catFails = checks.filter((c) => c.status === "fail").length;
            const catWarns = checks.filter((c) => c.status === "warn").length;
            const allPass = catFails === 0 && catWarns === 0;
            const isOpen = expanded[cat] ?? !allPass;

            return (
              <div key={cat} className="border border-brand-border rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleCategory(cat)}
                  className="w-full flex items-center justify-between px-4 py-2.5 bg-brand-offwhite hover:bg-gray-100 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm capitalize text-brand-black">
                      {cat.replace(/_/g, " ")}
                    </span>
                    <span className="text-xs text-brand-muted">
                      {checks.filter((c) => c.status === "pass").length}/{checks.length}
                    </span>
                    {catFails > 0 && <span className="badge-error text-xs">{catFails} failed</span>}
                    {catWarns > 0 && <span className="badge-warning text-xs">{catWarns} warn</span>}
                  </div>
                  <span className="text-xs text-brand-muted">{isOpen ? "▲" : "▼"}</span>
                </button>

                {isOpen && (
                  <div className="divide-y divide-brand-border">
                    {checks.map((check, i) => (
                      <div key={i} className="px-4 py-2 flex items-start gap-3">
                        <div className={clsx("mt-1.5 flex-shrink-0 w-2.5 h-2.5 rounded-full", CHECK_DOT[check.status])} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-brand-black">{check.name}</span>
                            <span className="text-xs text-brand-muted">
                              T{check.tier} · {check.duration_ms}ms
                            </span>
                          </div>
                          {check.status !== "pass" && (
                            <div className="mt-0.5 text-xs text-brand-muted space-y-0.5">
                              <div>
                                Expected: <span className="text-brand-black">{check.expected}</span>
                              </div>
                              <div>
                                Actual: <span className="text-brand-black">{check.actual}</span>
                              </div>
                              {check.error && (
                                <div className="text-red-600 font-mono truncate">{check.error}</div>
                              )}
                            </div>
                          )}
                          {check.target && (
                            <div className="text-xs text-brand-muted font-mono truncate mt-0.5">
                              {check.target}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card text-sm text-brand-muted">
          No regression runs yet.{isAdmin ? " Click \"Run Now\" to start the first one." : ""}
        </div>
      )}

      {/* Run history */}
      {history.length > 1 && (
        <div className="card">
          <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide mb-3">Run History</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-brand-muted border-b border-brand-border">
                <th className="pb-2 font-medium">When</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Results</th>
                <th className="pb-2 font-medium">Duration</th>
                <th className="pb-2 font-medium">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border">
              {history.map((run) => (
                <tr key={run.id} className="text-brand-black">
                  <td className="py-2 text-xs">{new Date(run.run_at).toLocaleString()}</td>
                  <td className="py-2">
                    <span className={clsx("uppercase text-[10px] font-semibold", OVERALL_BADGE[run.overall_status] ?? "badge-neutral")}>
                      {run.overall_status}
                    </span>
                  </td>
                  <td className="py-2 text-xs text-brand-muted">
                    {run.passed}/{run.total_checks} · {run.failed} fail · {run.warnings} warn
                  </td>
                  <td className="py-2 text-xs text-brand-muted">
                    {run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)}s` : "—"}
                  </td>
                  <td className="py-2 text-xs text-brand-muted">
                    {run.triggered_by}
                    {run.triggered_by_user ? ` (${run.triggered_by_user})` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
