"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { supabase } from "@/lib/supabase";

// Casey Phase 1 security patch DETECTION — read-only view of the patch_runs table.
// DETECTION ONLY: this panel surfaces what needs patching; it triggers nothing.

type PatchStatus = "clean" | "needs_attention" | "error";

interface DetectedItem {
  item: string;
  current?: string;
  available?: string;
  severity?: string;
  source?: string;
}

interface PatchRow {
  id: string;
  run_at: string;
  triggered_by: string;
  host: string;
  category: string;
  status: PatchStatus;
  detected: DetectedItem[] | null;
  summary: string | null;
  duration_ms: number | null;
}

interface PatchScan {
  run_at: string;
  triggered_by: string;
  rows: PatchRow[];
  overall: PatchStatus;
  counts: { clean: number; needs_attention: number; error: number };
}

const STATUS_BADGE: Record<PatchStatus, string> = {
  clean: "badge-success",
  needs_attention: "badge-warning",
  error: "badge-error",
};

const STATUS_DOT: Record<PatchStatus, string> = {
  clean: "bg-green-500",
  needs_attention: "bg-amber-400",
  error: "bg-red-500",
};

const STATUS_LABEL: Record<PatchStatus, string> = {
  clean: "clean",
  needs_attention: "needs attention",
  error: "error",
};

// Mirrors _DEFER_PREFIXES in casey-agent/tools/patch_remediation_tools.py.
// Packages matching these prefixes are never auto-applied (restart/reboot risk).
const DEFER_PREFIXES = ["docker", "containerd", "linux-image", "linux-headers", "linux-generic"];

function isDeferred(item: string): boolean {
  const lower = item.toLowerCase();
  return DEFER_PREFIXES.some((p) => lower === p || lower.startsWith(p + "-") || lower.startsWith(p + "."));
}

// Worst-status precedence: error > needs_attention > clean
function worst(a: PatchStatus, b: PatchStatus): PatchStatus {
  const rank: Record<PatchStatus, number> = { clean: 0, needs_attention: 1, error: 2 };
  return rank[a] >= rank[b] ? a : b;
}

// Cluster run_at-desc rows into scans: a gap > 5 min between consecutive rows
// starts a new scan (one scan writes ~5 rows within a few seconds).
function groupScans(rows: PatchRow[]): PatchScan[] {
  const scans: PatchScan[] = [];
  let current: PatchRow[] = [];
  let prevT: number | null = null;

  const flush = () => {
    if (!current.length) return;
    // Rapid back-to-back scans can fall in the same time window; keep one row
    // per host/category (the most recent — input is run_at-desc).
    const seen = new Set<string>();
    const deduped: PatchRow[] = [];
    for (const r of current) {
      const k = `${r.host}/${r.category}`;
      if (seen.has(k)) continue;
      seen.add(k);
      deduped.push(r);
    }
    let overall: PatchStatus = "clean";
    const counts = { clean: 0, needs_attention: 0, error: 0 };
    for (const r of deduped) {
      overall = worst(overall, r.status);
      counts[r.status] += 1;
    }
    scans.push({
      run_at: deduped[0].run_at,
      triggered_by: deduped[0].triggered_by,
      rows: deduped,
      overall,
      counts,
    });
  };

  for (const r of rows) {
    const t = new Date(r.run_at).getTime();
    if (prevT !== null && prevT - t > 5 * 60 * 1000) {
      flush();
      current = [];
    }
    current.push(r);
    prevT = t;
  }
  flush();
  return scans;
}

const CATEGORY_ORDER = ["wp_plugins", "os_packages", "reboot", "wordfence"];

function rowLabel(row: PatchRow): string {
  const host =
    row.host === "ovh" ? "OVH" : row.host === "hostinger" ? "Hostinger" : "WordPress";
  switch (row.category) {
    case "wp_plugins":
      return "WordPress plugins";
    case "os_packages":
      return `OS packages — ${host}`;
    case "reboot":
      return `Reboot required — ${host}`;
    case "wordfence":
      return "Wordfence";
    default:
      return `${row.category} — ${host}`;
  }
}

function sortRows(rows: PatchRow[]): PatchRow[] {
  return [...rows].sort((a, b) => {
    const ca = CATEGORY_ORDER.indexOf(a.category);
    const cb = CATEGORY_ORDER.indexOf(b.category);
    if (ca !== cb) return (ca === -1 ? 99 : ca) - (cb === -1 ? 99 : cb);
    return a.host.localeCompare(b.host);
  });
}

function severityBadge(sev?: string): string {
  if (sev === "major") return "bg-red-50 text-red-700";
  if (sev === "minor") return "bg-amber-50 text-amber-700";
  return "bg-gray-100 text-gray-500";
}

interface RemApproval {
  id: string;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  payload: { host?: string; category?: string } | null;
}

const REM_BADGE: Record<string, { label: string; cls: string }> = {
  pending: { label: "approval pending", cls: "bg-amber-50 text-amber-700" },
  approved: { label: "approved", cls: "bg-green-50 text-green-700" },
  rejected: { label: "rejected", cls: "bg-red-50 text-red-700" },
  revision_requested: { label: "revision", cls: "bg-amber-50 text-amber-700" },
  expired: { label: "expired", cls: "bg-gray-100 text-gray-500" },
};

export default function PatchStatusPanel({ isAdmin }: { isAdmin: boolean }) {
  const [rows, setRows] = useState<PatchRow[]>([]);
  const [rems, setRems] = useState<RemApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const [runsRes, remsRes] = await Promise.all([
        fetch("/api/patch/runs?limit=80"),
        fetch("/api/patch/remediations"),
      ]);
      const runsData = runsRes.ok ? await runsRes.json() : [];
      const remsData = remsRes.ok ? await remsRes.json() : [];
      setRows(Array.isArray(runsData) ? runsData : []);
      setRems(Array.isArray(remsData) ? remsData : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("patch-status-panel")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "patch_runs" },
        () => {
          // A scan inserts several rows in quick succession — coalesce refetches.
          if (debounce.current) clearTimeout(debounce.current);
          debounce.current = setTimeout(() => load(), 800);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pending_approvals" },
        () => {
          // Remediation approvals filed/approved/rejected → refresh badges.
          if (debounce.current) clearTimeout(debounce.current);
          debounce.current = setTimeout(() => load(), 800);
        },
      )
      .subscribe();
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
      supabase.removeChannel(channel);
    };
  }, [load]);

  const handleRescan = async () => {
    setScanning(true);
    setScanMsg(null);
    try {
      const res = await fetch("/api/patch/detect/run", { method: "POST" });
      if (res.ok) {
        setScanMsg("Scan started — results refresh automatically when complete (~15s).");
      } else {
        const body = await res.json().catch(() => ({}));
        setScanMsg(`Error: ${body.error ?? res.status}`);
      }
    } catch (err) {
      setScanMsg(`Error: ${String(err)}`);
    } finally {
      setScanning(false);
    }
  };

  const toggle = (id: string) => setExpanded((p) => ({ ...p, [id]: !p[id] }));

  if (loading) return <div className="card animate-pulse h-64" />;

  const scans = groupScans(rows);
  const latest = scans[0];
  const history = scans.slice(1, 11);

  // Most-recent remediation approval keyed by host/category (rems are created_at desc).
  const remByKey: Record<string, RemApproval> = {};
  for (const r of rems) {
    const k = `${r.payload?.host}/${r.payload?.category}`;
    if (!remByKey[k]) remByKey[k] = r;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-brand-black">Security Patches</p>
          {latest ? (
            <p className="text-xs text-brand-muted mt-0.5">
              Last scan: {new Date(latest.run_at).toLocaleString()} · {latest.triggered_by}
            </p>
          ) : (
            <p className="text-xs text-brand-muted mt-0.5">No scans recorded yet.</p>
          )}
        </div>
        {isAdmin ? (
          <button
            onClick={handleRescan}
            disabled={scanning}
            className="btn-primary text-sm px-4 py-2 disabled:opacity-60"
          >
            {scanning ? "Scanning…" : "▶ Rescan"}
          </button>
        ) : (
          <span className="text-[11px] text-brand-muted">Detection only — applies nothing</span>
        )}
      </div>

      {scanMsg && (
        <div className={clsx(
          "card text-sm",
          scanMsg.startsWith("Error") ? "border-red-200 text-red-600" : "border-amber-200 text-amber-700"
        )}>
          {scanMsg}
        </div>
      )}

      {!latest ? (
        <div className="card text-sm text-brand-muted">
          No patch scans recorded yet. Casey runs detection weekly (Mon 07:00 ET).
        </div>
      ) : (
        <div className="card space-y-3">
          {/* Overall summary */}
          <div className="flex items-center gap-3">
            <span className={clsx("uppercase text-xs font-semibold", STATUS_BADGE[latest.overall])}>
              {STATUS_LABEL[latest.overall]}
            </span>
            <span className="text-xs text-brand-muted">
              {latest.counts.clean} clean · {latest.counts.needs_attention} need attention ·{" "}
              {latest.counts.error} errored
            </span>
          </div>

          {/* Per-source rows */}
          {sortRows(latest.rows).map((row) => {
            const items = row.detected ?? [];
            const isOpen = expanded[row.id] ?? row.status !== "clean";
            return (
              <div key={row.id} className="border border-brand-border rounded-lg overflow-hidden">
                <button
                  onClick={() => toggle(row.id)}
                  className="w-full flex items-center justify-between px-4 py-2.5 bg-brand-offwhite hover:bg-gray-100 text-left"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={clsx("flex-shrink-0 w-2.5 h-2.5 rounded-full", STATUS_DOT[row.status])} />
                    <span className="font-medium text-sm text-brand-black truncate">{rowLabel(row)}</span>
                    {items.length > 0 && (
                      <span className="text-xs text-brand-muted flex-shrink-0">{items.length} item{items.length === 1 ? "" : "s"}</span>
                    )}
                    {(() => {
                      // If every detected package is deferred, flag it — no approval will be filed.
                      if (
                        row.category === "os_packages" &&
                        row.status === "needs_attention" &&
                        items.length > 0 &&
                        items.every((it) => isDeferred(it.item))
                      ) {
                        return (
                          <span className="badge text-[10px] px-1.5 py-0.5 flex-shrink-0 bg-purple-50 text-purple-700">
                            deferred
                          </span>
                        );
                      }
                      const rem = remByKey[`${row.host}/${row.category}`];
                      if (!rem) return null;
                      const b = REM_BADGE[rem.status] ?? { label: rem.status, cls: "bg-gray-100 text-gray-500" };
                      return <span className={clsx("badge text-[10px] px-1.5 py-0.5 flex-shrink-0", b.cls)}>{b.label}</span>;
                    })()}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={clsx("uppercase text-[10px] font-semibold", STATUS_BADGE[row.status])}>
                      {STATUS_LABEL[row.status]}
                    </span>
                    <span className="text-xs text-brand-muted">{isOpen ? "▲" : "▼"}</span>
                  </div>
                </button>

                {isOpen && (
                  <div className="px-4 py-2.5 space-y-2">
                    {row.summary && (
                      <p className="text-xs text-brand-muted leading-relaxed">{row.summary}</p>
                    )}
                    {items.length > 0 &&
                      row.category === "os_packages" &&
                      items.every((it) => isDeferred(it.item)) && (
                        <p className="text-xs text-purple-700 bg-purple-50 rounded px-2 py-1">
                          All updates are deferred — docker/containerd/kernel packages require a manual maintenance window and are never auto-applied.
                        </p>
                      )}
                    {items.length > 0 && row.category !== "reboot" && (
                      <div className="divide-y divide-brand-border">
                        {items.map((it, i) => (
                          <div key={i} className="py-1.5 flex items-center gap-2 flex-wrap text-xs">
                            <span className="font-mono text-brand-black">{it.item}</span>
                            {(it.current || it.available) && (
                              <span className="text-brand-muted font-mono">
                                {it.current || "—"} → <span className="text-brand-black">{it.available || "—"}</span>
                              </span>
                            )}
                            {isDeferred(it.item) && (
                              <span className="badge text-[9px] px-1 py-0 bg-purple-50 text-purple-700">deferred</span>
                            )}
                            {it.severity && it.severity !== "os" && !isDeferred(it.item) && (
                              <span className={clsx("badge text-[9px] px-1 py-0", severityBadge(it.severity))}>
                                {it.severity}
                              </span>
                            )}
                            {it.source && <span className="text-brand-muted ml-auto">{it.source}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Scan history */}
      {history.length > 0 && (
        <div className="card">
          <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide mb-3">Scan History</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-brand-muted border-b border-brand-border">
                <th className="pb-2 font-medium">When</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Sources</th>
                <th className="pb-2 font-medium">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border">
              {history.map((scan) => (
                <tr key={scan.run_at} className="text-brand-black">
                  <td className="py-2 text-xs">{new Date(scan.run_at).toLocaleString()}</td>
                  <td className="py-2">
                    <span className={clsx("uppercase text-[10px] font-semibold", STATUS_BADGE[scan.overall])}>
                      {STATUS_LABEL[scan.overall]}
                    </span>
                  </td>
                  <td className="py-2 text-xs text-brand-muted">
                    {scan.counts.clean} clean · {scan.counts.needs_attention} attn · {scan.counts.error} err
                  </td>
                  <td className="py-2 text-xs text-brand-muted">{scan.triggered_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
