"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { supabase } from "@/lib/supabase";

interface CheckResult {
  name: string;
  tier: number;
  category: string;
  status: "pass" | "fail" | "warn" | "skip";
  actual: string;
  expected: string;
  duration_ms: number;
  error?: string;
}

interface RegressionRun {
  id: string;
  run_at: string;
  overall_status: string;
  passed: number;
  failed: number;
  warnings: number;
  results: CheckResult[];
}

const CHECK_DOT: Record<string, string> = {
  pass: "bg-green-500",
  fail: "bg-red-500",
  warn: "bg-amber-400",
  skip: "bg-gray-300",
};

export default function WebsitePanel({ isAdmin }: { isAdmin: boolean }) {
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [latestRes, histRes] = await Promise.all([
        fetch("/api/regression/latest"),
        fetch("/api/regression/history?limit=5"),
      ]);
      const latestData: RegressionRun | null = latestRes.ok
        ? await latestRes.json()
        : null;
      const histData: RegressionRun[] = histRes.ok
        ? await histRes.json()
        : [];

      const wpChecks =
        latestData?.results?.filter((r) => r.category === "wordpress") ?? [];
      setChecks(wpChecks);

      const runs = Array.isArray(histData) ? histData : [];
      const mostRecent = runs[0]?.run_at ?? latestData?.run_at ?? null;
      setLastRunAt(mostRecent);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("website-panel")
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

  if (loading) return <div className="card animate-pulse h-64" />;

  const failCount = checks.filter((c) => c.status === "fail").length;
  const warnCount = checks.filter((c) => c.status === "warn").length;
  const hasData = checks.length > 0;

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-brand-black">Website Health</p>
          {lastRunAt && (
            <p className="text-xs text-brand-muted mt-0.5">
              Last run: {new Date(lastRunAt).toLocaleString()}
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

      {/* Status banner — always shown */}
      <div
        className={clsx(
          "rounded-lg px-4 py-3 text-sm font-medium",
          !hasData
            ? "bg-gray-50 text-gray-500 border border-gray-200"
            : failCount > 0
              ? "bg-red-50 text-red-700 border border-red-200"
              : warnCount > 0
                ? "bg-amber-50 text-amber-700 border border-amber-200"
                : "bg-green-50 text-green-700 border border-green-200",
        )}
      >
        {!hasData
          ? "No data — run a regression check to see results"
          : failCount > 0
            ? `${failCount} failure${failCount !== 1 ? "s" : ""}`
            : warnCount > 0
              ? `${warnCount} warning${warnCount !== 1 ? "s" : ""}`
              : "All checks passing"}
      </div>

      {/* Checks table */}
      {hasData && (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-brand-muted border-b border-brand-border bg-brand-offwhite">
                <th className="px-4 py-2.5 font-medium">Check</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Actual</th>
                <th className="px-4 py-2.5 font-medium">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border">
              {checks.map((check, i) => (
                <tr key={i} className="text-brand-black">
                  <td className="px-4 py-2.5 text-sm font-medium">{check.name}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div
                        className={clsx(
                          "w-2.5 h-2.5 rounded-full flex-shrink-0",
                          CHECK_DOT[check.status] ?? "bg-gray-300",
                        )}
                      />
                      <span className="text-xs text-brand-muted capitalize">
                        {check.status}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-brand-muted max-w-xs truncate">
                    {check.actual || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-brand-muted whitespace-nowrap">
                    {check.duration_ms}ms
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
