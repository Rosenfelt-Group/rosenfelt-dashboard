"use client";
import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import clsx from "clsx";
import { ErrorState, LoadingState } from "@/components/ui";
import { formatUptime } from "./helpers";

interface VpsStats {
  cpu_percent: number;
  memory: { total_gb: number; used_gb: number; percent: number };
  disk:   { total_gb: number; used_gb: number; percent: number };
  uptime_seconds: number;
  containers: { name: string; status: string; image: string }[];
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

function UsageBar({ percent, warn = 70, danger = 90 }: { percent: number; warn?: number; danger?: number }) {
  const color = percent >= danger ? "bg-red-500" : percent >= warn ? "bg-amber-400" : "bg-green-500";
  return (
    <div className="w-full h-1.5 bg-brand-offwhite rounded-full overflow-hidden">
      <div className={clsx("h-full rounded-full transition-all", color)} style={{ width: `${Math.min(percent, 100)}%` }} />
    </div>
  );
}

function ServerCard({ label, ip, stats, error, coreContainers }: ServerCardProps) {
  if (error) {
    return (
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-brand-black">{label} <span className="font-normal text-brand-muted">— {ip}</span></h2>
        <ErrorState message={error} />
      </div>
    );
  }
  if (!stats) {
    return (
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-brand-black">{label} <span className="font-normal text-brand-muted">— {ip}</span></h2>
        <LoadingState rows={1} />
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

export function VpsTab() {
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

  if (loading) return <LoadingState rows={2} />;

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
