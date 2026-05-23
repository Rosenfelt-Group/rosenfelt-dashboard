"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { supabase } from "@/lib/supabase";
import { Sidebar } from "./Sidebar";

// ── Audit alerts (Casey) ──────────────────────────────────────────────────────

interface AuditAlert {
  id: string;
  title: string;
  description: string;
  severity: string;
  created_at: string;
}

function useAuditAlerts(): { alerts: AuditAlert[]; dismiss: (id: string) => Promise<void> } {
  const [alerts, setAlerts] = useState<AuditAlert[]>([]);

  useEffect(() => {
    let mounted = true;

    async function fetchAlerts() {
      try {
        const { data, error } = await supabase
          .from("audit_alerts")
          .select("id,title,description,severity,created_at")
          .is("resolved_at", null)
          .order("created_at", { ascending: false });
        if (!error && mounted) setAlerts((data as AuditAlert[]) ?? []);
      } catch {}
    }

    fetchAlerts();

    const channel = supabase
      .channel("audit-alerts-banner")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "audit_alerts" },
        (payload) => {
          const row = payload.new as AuditAlert & { resolved_at: string | null };
          if (row.resolved_at) return;
          setAlerts(prev => prev.some(a => a.id === row.id) ? prev : [row, ...prev]);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "audit_alerts" },
        (payload) => {
          const row = payload.new as AuditAlert & { resolved_at: string | null };
          if (row.resolved_at) {
            setAlerts(prev => prev.filter(a => a.id !== row.id));
          } else {
            setAlerts(prev => prev.map(a => a.id === row.id ? { ...a, ...row } : a));
          }
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  async function dismiss(id: string): Promise<void> {
    setAlerts(prev => prev.filter(a => a.id !== id));
    try {
      await fetch(`/api/audit-alerts/${id}/resolve`, { method: "PATCH" });
    } catch {}
  }

  return { alerts, dismiss };
}

function AuditAlertBanners() {
  const { alerts, dismiss } = useAuditAlerts();
  if (alerts.length === 0) return null;
  return (
    <>
      {alerts.map(alert => (
        <div
          key={alert.id}
          className="flex items-center gap-2 px-4 py-2.5 text-xs border-b bg-red-50 border-red-200 text-red-800"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span className="font-bold flex-shrink-0">⚠ AUDIT ALERT</span>
          <span className="font-semibold flex-shrink-0 text-red-700">{alert.title}</span>
          <span className="truncate opacity-80">{alert.description}</span>
          <button
            onClick={() => dismiss(alert.id)}
            aria-label="Dismiss audit alert"
            className="ml-auto flex-shrink-0 px-2 py-0.5 rounded text-red-700 hover:bg-red-100 transition-colors font-medium"
          >
            Dismiss
          </button>
        </div>
      ))}
    </>
  );
}

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
        <AuditAlertBanners />
        <SystemBanner />
        {children}
      </main>
    </div>
  );
}
