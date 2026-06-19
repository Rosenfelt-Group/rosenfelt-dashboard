"use client";

import { useCallback, useEffect, useState } from "react";
import { AgentBadge } from "@/components/AgentBadge";
import { formatDistanceToNow } from "date-fns";
import clsx from "clsx";
import type { Agent } from "@/types";

interface CronRow {
  agent: string;
  job_id: string;
  cron: string;
  enabled: boolean;
  min_interval_seconds: number;
  updated_by: string | null;
  updated_at: string | null;
}

interface JobRunInfo {
  job_id: string;
  next_run_time: string | null;
}

const CRON_LABELS: Record<string, string> = {
  "*/5 * * * *":  "Every 5 min",
  "*/10 * * * *": "Every 10 min",
  "*/30 * * * *": "Every 30 min",
  "0 * * * *":    "Hourly",
  "0 4 * * *":    "Daily 4am ET",
  "0 6 * * *":    "Daily 6am ET",
  "0 7 * * sun":  "Weekly Sun 7am ET",
  "0 8 * * sun":  "Weekly Sun 8am ET",
  "0 6 * * mon":  "Weekly Mon 6am ET",
  "0 6 * * tue":  "Weekly Tue 6am ET",
  "0 6 * * wed":  "Weekly Wed 6am ET",
};

const JOB_LABELS: Record<string, string> = {
  weekly_audit:               "Full audit",
  weekly_regression_run:      "Regression suite",
  daily_indexer_health_check: "Indexer health check",
  memory_maintenance:         "Memory maintenance",
  weekly_gsc_sync:            "GSC keyword sync",
};

const PRESETS = [
  { label: "Every 10 min", cron: "*/10 * * * *" },
  { label: "Every 30 min", cron: "*/30 * * * *" },
  { label: "Hourly",       cron: "0 * * * *"    },
  { label: "Daily 4am ET", cron: "0 4 * * *"    },
  { label: "Daily 6am ET", cron: "0 6 * * *"    },
  { label: "Weekly Sun 7am ET", cron: "0 7 * * sun" },
  { label: "Weekly Tue 6am ET", cron: "0 6 * * tue" },
];

function humanCron(cron: string): string {
  return CRON_LABELS[cron] ?? cron;
}

export function CronConfigPanel() {
  const [rows, setRows]         = useState<CronRow[]>([]);
  const [jobRuns, setJobRuns]   = useState<Record<string, string | null>>({});
  const [loading, setLoading]   = useState(true);
  const [editKey, setEditKey]   = useState<string | null>(null);
  const [editCron, setEditCron] = useState("");
  const [editEnabled, setEditEnabled] = useState(true);
  const [confirming, setConfirming]   = useState(false);
  const [saving, setSaving]           = useState(false);
  const [statusMsg, setStatusMsg]     = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const [config, jobs] = await Promise.all([
      fetch("/api/cron-config").then(r => r.json()).catch(() => []),
      fetch("/api/cron-config/jobs").then(r => r.json()).catch(() => ({ jobs: [] })),
    ]);
    setRows(Array.isArray(config) ? config : []);
    const runMap: Record<string, string | null> = {};
    ((jobs?.jobs ?? []) as JobRunInfo[]).forEach(j => {
      runMap[j.job_id] = j.next_run_time;
    });
    setJobRuns(runMap);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const getRow = (): CronRow | null => {
    if (!editKey) return null;
    const [agent, ...rest] = editKey.split(":");
    const job_id = rest.join(":");
    return rows.find(r => r.agent === agent && r.job_id === job_id) ?? null;
  };

  const startEdit = (row: CronRow) => {
    setEditKey(`${row.agent}:${row.job_id}`);
    setEditCron(row.cron);
    setEditEnabled(row.enabled);
    setConfirming(false);
    setStatusMsg(null);
  };

  const cancelEdit = () => {
    setEditKey(null);
    setConfirming(false);
    setStatusMsg(null);
  };

  const applySave = async () => {
    const row = getRow();
    if (!row) return;
    setSaving(true);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/cron-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: row.agent,
          job_id: row.job_id,
          cron: editCron,
          enabled: editEnabled,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setStatusMsg({ type: "error", text: data.error ?? `HTTP ${res.status}` });
        setConfirming(false);
      } else if (data.status === "db_updated_reschedule_failed") {
        setStatusMsg({ type: "error", text: `Saved to DB but live reschedule failed: ${data.detail}` });
        setEditKey(null);
        setConfirming(false);
        load();
      } else {
        setStatusMsg({ type: "ok", text: `Rescheduled to "${humanCron(editCron)}"` });
        setEditKey(null);
        setConfirming(false);
        load();
      }
    } catch (err) {
      setStatusMsg({ type: "error", text: String(err) });
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="px-4 py-6 text-sm text-brand-muted animate-pulse">
        Loading schedules…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="px-4 py-6 text-sm text-brand-muted">
        No scheduled jobs configured.
      </div>
    );
  }

  const currentRow = getRow();

  return (
    <div>
      {statusMsg && (
        <div className={clsx(
          "mx-4 mt-3 px-3 py-2 rounded-lg text-sm",
          statusMsg.type === "ok"
            ? "bg-green-50 text-green-700 border border-green-200"
            : "bg-red-50 text-red-700 border border-red-200",
        )}>
          {statusMsg.text}
        </div>
      )}

      <div className="divide-y divide-brand-border">
        {rows.map(row => {
          const key = `${row.agent}:${row.job_id}`;
          const isEditing = editKey === key;
          const nextRun = jobRuns[row.job_id];

          return (
            <div key={key}>
              {/* Job row */}
              <div className="flex items-center justify-between px-4 py-3 gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <AgentBadge agent={row.agent as Agent} size="sm" />
                  <div className="min-w-0">
                    <div className="text-sm text-brand-black truncate">
                      {JOB_LABELS[row.job_id] ?? row.job_id}
                    </div>
                    {nextRun && (
                      <div className="text-xs text-brand-muted">
                        next: {formatDistanceToNow(new Date(nextRun), { addSuffix: true })}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className={clsx(
                    "text-xs font-mono px-2 py-0.5 rounded",
                    row.enabled
                      ? "bg-brand-offwhite text-brand-black"
                      : "bg-gray-100 text-brand-muted line-through",
                  )}>
                    {humanCron(row.cron)}
                  </span>
                  <button
                    onClick={() => isEditing ? cancelEdit() : startEdit(row)}
                    className={clsx(
                      "text-xs px-2 py-1 rounded border transition-colors",
                      isEditing
                        ? "border-brand-orange/40 text-brand-orange bg-orange-50"
                        : "border-brand-border text-brand-muted hover:border-brand-orange/40 hover:text-brand-orange",
                    )}
                  >
                    {isEditing ? "Cancel" : "Edit"}
                  </button>
                </div>
              </div>

              {/* Inline editor */}
              {isEditing && (
                <div className="mx-4 mb-3 p-3 bg-brand-offwhite rounded-lg border border-brand-border space-y-3">
                  {/* Preset buttons */}
                  <div>
                    <div className="text-xs text-brand-muted mb-2">Presets</div>
                    <div className="flex flex-wrap gap-1.5">
                      {PRESETS.map(p => (
                        <button
                          key={p.cron}
                          onClick={() => {
                            setEditCron(p.cron);
                            setConfirming(false);
                            setStatusMsg(null);
                          }}
                          className={clsx(
                            "text-xs px-2.5 py-1 rounded-full border transition-colors",
                            editCron === p.cron
                              ? "bg-brand-orange text-white border-brand-orange"
                              : "border-brand-border text-brand-black bg-white hover:border-brand-orange/40",
                          )}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Raw cron input */}
                  <div>
                    <div className="text-xs text-brand-muted mb-1">Custom cron (MIN HOUR DOM MON DOW)</div>
                    <input
                      type="text"
                      value={editCron}
                      onChange={e => {
                        setEditCron(e.target.value);
                        setConfirming(false);
                        setStatusMsg(null);
                      }}
                      placeholder="*/10 * * * *"
                      spellCheck={false}
                      className="w-full font-mono text-sm px-3 py-1.5 rounded border border-brand-border bg-white focus:outline-none focus:border-brand-orange"
                    />
                    <div className="text-xs text-brand-muted mt-1">
                      America/New_York timezone · minimum interval: {row.min_interval_seconds}s
                    </div>
                  </div>

                  {/* Enabled toggle */}
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={editEnabled}
                      onChange={e => {
                        setEditEnabled(e.target.checked);
                        setConfirming(false);
                      }}
                      className="rounded"
                    />
                    <span className="text-xs text-brand-black">Enabled</span>
                  </label>

                  {/* Save / confirm */}
                  {!confirming ? (
                    <button
                      onClick={() => setConfirming(true)}
                      disabled={editCron === currentRow?.cron && editEnabled === currentRow?.enabled}
                      className="px-3 py-1.5 bg-brand-orange text-white text-xs rounded hover:bg-brand-orange/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Save changes…
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <div className="text-xs text-brand-black bg-amber-50 border border-amber-200 rounded px-3 py-2">
                        Change <strong>{JOB_LABELS[currentRow?.job_id ?? ""] ?? currentRow?.job_id}</strong> from{" "}
                        <code className="font-mono bg-white px-1 rounded">{humanCron(currentRow?.cron ?? "")}</code>{" "}
                        to{" "}
                        <code className="font-mono bg-white px-1 rounded">{humanCron(editCron)}</code>?
                        {!editEnabled && " (will be disabled)"}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={applySave}
                          disabled={saving}
                          className="px-3 py-1.5 bg-brand-orange text-white text-xs rounded hover:bg-brand-orange/90 disabled:opacity-40 transition-colors"
                        >
                          {saving ? "Applying…" : "Confirm"}
                        </button>
                        <button
                          onClick={() => setConfirming(false)}
                          className="px-3 py-1.5 border border-brand-border text-xs text-brand-muted rounded hover:bg-white transition-colors"
                        >
                          Go back
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="px-4 py-2.5 border-t border-brand-border">
        <span className="text-xs text-brand-muted">
          Changes apply live — no container restart needed.
        </span>
      </div>
    </div>
  );
}
