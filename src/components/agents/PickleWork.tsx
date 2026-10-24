"use client";
import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import { usePolling } from "@/lib/use-polling";

export type PickleSummary = {
  working: { id: string; ref: number; title: string }[];
  queue: number;
  approvals_pending: number;
};

/** Dr. Pickle's current job, queue size and approvals waiting, refreshed every minute. */
export function usePickleSummary(): PickleSummary | null {
  const [summary, setSummary] = useState<PickleSummary | null>(null);
  const load = useCallback(async () => {
    const r = await fetchJson<PickleSummary>("/api/agents/pickle/summary");
    if (r.ok) setSummary(r.data);
  }, []);
  useEffect(() => { load(); }, [load]);
  usePolling(load, 60_000);
  return summary;
}

export function pickleSummaryText(s: PickleSummary): string {
  const job = s.working[0];
  const parts = [job ? `Working on #${job.ref}` : "Idle"];
  parts.push(`queue ${s.queue}`);
  if (s.approvals_pending > 0) parts.push(`${s.approvals_pending} approval${s.approvals_pending === 1 ? "" : "s"} pending`);
  return parts.join(" · ");
}

/** One-line summary for the /agents card. */
export function PickleWorkLine() {
  const s = usePickleSummary();
  if (!s) return null;
  return <p className="text-xs text-brand-black" title={s.working[0]?.title}>{pickleSummaryText(s)}</p>;
}

/** Work card on /agents/pickle: current job(s) linked, queue and approvals. */
export function PickleWorkPanel() {
  const s = usePickleSummary();
  return (
    <div className="card p-4 space-y-2">
      <h2 className="text-sm font-semibold text-brand-black">Work</h2>
      {!s ? (
        <p className="text-xs text-brand-muted">Loading…</p>
      ) : (
        <>
          {s.working.length === 0 ? (
            <p className="text-sm text-brand-muted">No job in progress.</p>
          ) : (
            <ul className="space-y-1">
              {s.working.map(w => (
                <li key={w.id} className="text-sm min-w-0 truncate">
                  <a href={`/work/${w.id}`} className="text-brand-orange hover:underline">#{w.ref}</a>{" "}
                  <span className="text-brand-black">{w.title}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-brand-muted">
            {s.queue} queued (inbox, open, approved) ·{" "}
            <a href="/approvals" className="hover:underline">
              {s.approvals_pending} approval{s.approvals_pending === 1 ? "" : "s"} waiting on Brian
            </a>
          </p>
        </>
      )}
    </div>
  );
}
