"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Sidebar } from "./Sidebar";

// ── System alerts ─────────────────────────────────────────────────────────────

interface Alert {
  level: "error" | "warning";
  label: string;
}

function useSystemAlerts(): Alert[] {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    async function check() {
      try {
        const [health, stats, runs] = await Promise.all([
          fetch("/api/agent-status/health").then(r => r.ok ? r.json() : []).catch(() => []),
          fetch("/api/agent-status").then(r => r.ok ? r.json() : []).catch(() => []),
          fetch("/api/github/runs").then(r => r.ok ? r.json() : []).catch(() => []),
        ]) as [
          { agent: string; status: string; error?: string }[],
          { agent: string; errors_24h: number }[],
          { repo: string; status: string; conclusion: string | null }[],
        ];

        const next: Alert[] = [];

        // Agent down → error
        for (const h of health) {
          if (h.status === "down") {
            next.push({ level: "error", label: `${h.agent} agent is down` });
          }
        }

        // Agent errors in last 24h → warning (skip if already flagged as down)
        for (const s of stats) {
          if (s.errors_24h > 0 && !next.some(a => a.label.includes(s.agent))) {
            next.push({ level: "warning", label: `${s.agent}: ${s.errors_24h} error${s.errors_24h !== 1 ? "s" : ""} in 24h` });
          }
        }

        // Latest run per repo with failure → warning
        const seenRepos = new Set<string>();
        for (const run of runs) {
          if (seenRepos.has(run.repo)) continue;
          seenRepos.add(run.repo);
          if (run.conclusion === "failure") {
            next.push({ level: "warning", label: `${run.repo}: CI failed` });
          }
        }

        setAlerts(next);
      } catch {}
    }

    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, []);

  return alerts;
}

// ── Banner ────────────────────────────────────────────────────────────────────

function SystemBanner() {
  const alerts    = useSystemAlerts();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || alerts.length === 0) return null;

  const isError   = alerts.some(a => a.level === "error");
  const primary   = alerts[0];
  const rest      = alerts.length - 1;

  return (
    <div className={clsx(
      "flex items-center gap-2 px-4 py-2.5 text-xs border-b",
      isError
        ? "bg-red-50 border-red-200 text-red-800"
        : "bg-amber-50 border-amber-200 text-amber-800"
    )}>
      {/* Indicator dot */}
      <span className={clsx(
        "w-1.5 h-1.5 rounded-full flex-shrink-0",
        isError ? "bg-red-500 animate-pulse" : "bg-amber-400"
      )} />

      {/* Message */}
      <span className="font-semibold flex-shrink-0">{isError ? "System issue:" : "Warning:"}</span>
      <span className="truncate">{primary.label}</span>
      {rest > 0 && (
        <span className="flex-shrink-0 opacity-70">+{rest} more</span>
      )}
      <Link
        href="/status"
        className={clsx("flex-shrink-0 underline font-medium ml-1", isError ? "text-red-700" : "text-amber-700")}
      >
        View status →
      </Link>

      {/* Dismiss */}
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className={clsx(
          "ml-auto flex-shrink-0 p-0.5 rounded hover:bg-black/10 transition-colors",
          isError ? "text-red-600" : "text-amber-600"
        )}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────────────

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (localStorage.getItem("sidebar-collapsed") === "true") setCollapsed(true);
  }, []);

  function toggle() {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
  }

  return (
    <div className="flex min-h-screen bg-brand-offwhite">
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <main className={clsx(
        "flex-1 min-h-screen transition-[margin-left] duration-200",
        "pt-14 md:pt-0",
        collapsed ? "md:ml-14" : "md:ml-56"
      )}>
        <SystemBanner />
        {children}
      </main>
    </div>
  );
}
