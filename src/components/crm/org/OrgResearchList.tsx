"use client";
// Placeholder Research tab: crm.business_research for the organization, plus "Run research" (Avery), as on
// the old business page. Stream R's OrgResearchTab replaces it (see slots.tsx).
import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { fetchJson } from "@/lib/fetch-json";
import type { CRMBusinessResearch } from "@/types";
import { Button, ErrorState, LoadingState } from "@/components/ui";

export function OrgResearchList({ businessId, topic }: { businessId: string; topic?: string }) {
  const [rows, setRows] = useState<CRMBusinessResearch[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState(topic ?? "");

  useEffect(() => {
    fetchJson<CRMBusinessResearch[]>(`/api/crm/businesses/${businessId}/research`).then((r) => {
      if (r.ok) setRows(Array.isArray(r.data) ? r.data : []); else setLoadErr(r.error);
    });
    if (!topic) fetchJson<{ name: string }>(`/api/crm/businesses/${businessId}`).then((r) => { if (r.ok) setName(r.data.name); });
  }, [businessId, topic]);

  async function run() {
    setRunning(true); setErr(null);
    try {
      const res = await fetch(`/api/crm/businesses/${businessId}/research`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic: name }),
      });
      const row = await res.json();
      if (!res.ok) throw new Error(row.error || "Research failed");
      setRows((prev) => [row, ...(prev ?? [])]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Research failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h2 className="text-sm font-medium text-brand-black">Research about this organization</h2>
        <Button size="sm" onClick={run} disabled={running || !name}>{running ? "Running… (up to ~30s)" : "Run research"}</Button>
      </div>
      {err && <p className="text-xs text-red-700 mb-2">{err}</p>}
      {loadErr ? <ErrorState message={`Couldn't load research: ${loadErr}`} /> : !rows ? <LoadingState rows={2} /> : rows.length === 0 ? (
        <p className="text-xs text-brand-muted">No research yet.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="border-b border-brand-border last:border-0 pb-3 last:pb-0">
              <p className="text-xs text-brand-muted mb-1">
                {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                {r.researched_by && <span className="capitalize"> · {r.researched_by}</span>}
                {r.source && <span> · {r.source}</span>}
              </p>
              {r.summary && <p className="text-sm text-brand-black whitespace-pre-wrap">{r.summary}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
