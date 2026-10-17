"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ErrorState, LoadingState } from "@/components/ui";
import { ago, componentStatusDot, supabaseIndicatorMeta } from "./helpers";

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

const CORE_COMPONENTS = ["Database","API","Auth","Realtime","Storage","Edge Functions","Supabase Dashboard"];

export function SupabaseTab() {
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

  if (loading) return <LoadingState />;
  if (error || !status) return <ErrorState message={error ?? "No data"} />;

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
        <Link href="/tools?tab=sql" className="text-xs text-brand-orange hover:underline flex-shrink-0 ml-4">Open SQL →</Link>
      </div>
    </div>
  );
}
