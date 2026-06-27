"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { supabase } from "@/lib/supabase";
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

const ALIGNMENT_PATTERNS = [
  "%tool count drift%",
  "%phantom table in docs%",
  "%undocumented table: public%",
  "%phantom endpoint in docs%",
];

export default function AlignmentAuditPanel({ isAdmin }: { isAdmin: boolean }) {
  const [findings, setFindings] = useState<AlignmentFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const orFilter = ALIGNMENT_PATTERNS.map(p => `title.ilike.${p}`).join(",");
    const { data } = await supabase
      .from("work_items")
      .select("id, ref, title, description, priority, status, created_at")
      .or(orFilter)
      .order("created_at", { ascending: false })
      .limit(50);
    setFindings(data ?? []);
    setLoading(false);
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
          <button
            onClick={handleRunNow}
            disabled={triggering}
            className="btn-primary text-sm px-4 py-2 disabled:opacity-60"
          >
            {triggering ? "Starting…" : "▶ Run Now"}
          </button>
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
        <div className="card animate-pulse h-32" />
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
