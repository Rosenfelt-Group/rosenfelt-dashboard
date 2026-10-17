"use client";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { EmptyState, LoadingState } from "@/components/ui";
import { parseKickSummary } from "./helpers";

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

export function KickTab() {
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

  if (loading) return <LoadingState />;
  if (!data) return <EmptyState title="No data" />;

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
