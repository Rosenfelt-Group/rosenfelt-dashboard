"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Button, ErrorState, LoadingState } from "@/components/ui";
import { formatDistanceToNow, parseISO } from "date-fns";

interface AlignmentFinding {
  id: string;
  ref: number;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  created_at: string;
}

const PRIORITY_BADGE: Record<string, string> = {
  high: "badge-error",
  medium: "badge-warning",
  low: "badge-neutral",
};

const STATUS_BADGE: Record<string, string> = {
  inbox: "badge-neutral",
  in_progress: "badge-warning",
  done: "badge-success",
  approved: "badge-success",
  blocked: "badge-error",
  cancelled: "badge-neutral",
};

export default function AlignmentAuditPanel({ isAdmin }: { isAdmin: boolean }) {
  const [findings, setFindings] = useState<AlignmentFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/work/alignment-findings");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setFindings(Array.isArray(data) ? data : []);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load findings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRunNow = async () => {
    setTriggering(true);
    setTriggerMsg(null);
    try {
      const res = await fetch("/api/alignment/run", { method: "POST" });
      if (res.ok) {
        setTriggerMsg("Alignment audit started — findings will appear here when complete (~30–60s).");
      } else {
        const body = await res.json().catch(() => ({}));
        setTriggerMsg(`Error: ${body.error ?? res.status}`);
      }
    } catch (err) {
      setTriggerMsg(`Error: ${String(err)}`);
    } finally {
      setTriggering(false);
    }
  };

  const lastRun = findings[0]?.created_at
    ? formatDistanceToNow(parseISO(findings[0].created_at), { addSuffix: true })
    : null;

  const openCount = findings.filter(f => f.status !== "done" && f.status !== "cancelled").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-brand-black">Doc Alignment Audit</p>
          <p className="text-xs text-brand-muted mt-0.5">
            {loading
              ? "Loading…"
              : lastRun
                ? `Last finding ${lastRun} · ${openCount} open`
                : "No findings yet"}
          </p>
        </div>
        {isAdmin && (
          <Button onClick={handleRunNow} disabled={triggering}>
            {triggering ? "Starting…" : "▶ Run Now"}
          </Button>
        )}
      </div>

      {triggerMsg && (
        <div className={clsx(
          "card text-sm",
          triggerMsg.startsWith("Error") ? "border-red-200 text-red-600" : "border-amber-200 text-amber-700"
        )}>
          {triggerMsg}
        </div>
      )}

      {loading ? (
        <LoadingState />
      ) : loadError ? (
        <ErrorState message={`Couldn't load findings: ${loadError}`} onRetry={load} />
      ) : findings.length === 0 ? (
        <div className="card text-sm text-brand-muted">
          No alignment findings on record.{isAdmin ? " Click \"Run Now\" to trigger the first audit." : ""}
        </div>
      ) : (
        <div className="card divide-y divide-brand-border">
          {findings.map(f => (
            <div key={f.id} className="py-3 px-1 flex items-start gap-3">
              <span className={clsx("mt-0.5 uppercase text-[10px] font-semibold shrink-0", PRIORITY_BADGE[f.priority] ?? "badge-neutral")}>
                {f.priority}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-brand-black">{f.title}</span>
                  <span className={clsx("text-[10px] font-semibold uppercase", STATUS_BADGE[f.status] ?? "badge-neutral")}>
                    {f.status.replace(/_/g, " ")}
                  </span>
                </div>
                <p className="text-xs text-brand-muted mt-0.5">
                  #{f.ref} · {formatDistanceToNow(parseISO(f.created_at), { addSuffix: true })}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
