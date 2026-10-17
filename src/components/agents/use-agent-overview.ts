"use client";
import { useCallback, useEffect, useState } from "react";
import type { AgentStatus } from "@/types";
import { fetchJson } from "@/lib/fetch-json";
import { usePolling } from "@/lib/use-polling";

/** One row of GET /api/agent-status/health. */
export type AgentHealthRow = {
  agent: string;
  status: "up" | "down" | "unknown";
  latency_ms: number | null;
  detail: unknown;
  error: string | null;
};

/**
 * 24h run/error counts (/api/agent-status) plus a reachability probe
 * (/api/agent-status/health) for every agent, refreshed every minute.
 */
export function useAgentOverview() {
  const [statuses, setStatuses] = useState<AgentStatus[]>([]);
  const [health,   setHealth]   = useState<AgentHealthRow[] | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, h] = await Promise.all([
      fetchJson<unknown>("/api/agent-status"),
      fetchJson<unknown>("/api/agent-status/health"),
    ]);
    // On failure keep the last good data rather than blanking the cards.
    if (s.ok) setStatuses(Array.isArray(s.data) ? (s.data as AgentStatus[]) : []);
    if (h.ok) setHealth(Array.isArray(h.data) ? (h.data as AgentHealthRow[]) : []);
    setError(!s.ok ? s.error : !h.ok ? `health check failed: ${h.error}` : null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  usePolling(load, 60_000);

  return {
    loading,
    error,
    reload: load,
    statusFor: (name: string) => statuses.find(a => a.agent === name),
    healthFor: (name: string) => health?.find(a => a.agent === name),
    healthLoaded: health !== null,
  };
}
