"use client";
import { useState } from "react";
import Link from "next/link";
import { fetchJson } from "@/lib/fetch-json";
import { Button, ErrorState, LoadingState } from "@/components/ui";
import { UseInScope } from "./UseInScope";
import { itemSource, itemTitle, useOrgResearch, type ResearchItem } from "./useOrgResearch";

type ProposeResult = { status: string; scope_version_id: string; change_note: string; research_used: number };

/**
 * "Research inputs" on the scope: everything linked to the organization with a "Use in scope" tick, and,
 * when a scope exists (`scopeId`), a button asking Riley to propose a revision with the ticked items.
 * `onProposed` runs after Riley saves the proposal (reload the scope to show it).
 */
export function ScopeResearchInputs({ businessId, scopeId, onProposed, manageHref }: {
  businessId: string;
  scopeId?: string;
  onProposed?: (versionId: string) => void;
  manageHref?: string;
}) {
  const { data, loadError, saveError, load, toggle } = useOrgResearch(businessId);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<ProposeResult | null>(null);

  async function propose() {
    if (!scopeId || busy) return;
    setBusy(true); setErr(null); setDone(null);
    const r = await fetchJson<ProposeResult>(`/api/crm/scope/${scopeId}/propose`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setDone(r.data);
    onProposed?.(r.data.scope_version_id);
  }

  if (loadError) return <ErrorState message={`Couldn't load research: ${loadError}`} onRetry={load} />;
  if (!data) return <LoadingState rows={2} />;

  const items: ResearchItem[] = [...data.notes, ...data.briefs];
  const n = data.selected_count;

  return (
    <div className="border border-brand-border rounded-lg p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-brand-black">Research inputs</h3>
        <span className="text-xs text-brand-muted">{n} of {items.length} selected</span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-brand-muted mt-2">No research for this organization yet.</p>
      ) : (
        <ul className="divide-y divide-brand-border mt-1">
          {items.map(it => (
            <li key={`${it.type}:${it.id}`} className="py-2 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-brand-black line-clamp-2">{itemTitle(it)}</p>
                <p className="text-xs text-brand-muted">{itemSource(it)}</p>
              </div>
              <UseInScope checked={it.selected} onChange={v => toggle(it.type, it.id, v)} />
            </li>
          ))}
        </ul>
      )}
      {saveError && <p className="text-xs text-red-700 mt-2">Couldn&apos;t save: {saveError}</p>}
      <div className="flex flex-wrap items-center gap-3 mt-2">
        <Link href={manageHref ?? `/crm/organizations/${businessId}?tab=research`} className="text-xs text-brand-orange hover:underline">
          Manage research →
        </Link>
        {scopeId && (
          <Button size="sm" variant="secondary" disabled={busy || n === 0} onClick={propose}
            title={n === 0 ? "Tick at least one research item first" : undefined}>
            {busy ? "Riley is revising… (up to a few minutes)" : "Ask Riley to revise with this research"}
          </Button>
        )}
      </div>
      {err && <p className="text-xs text-red-700 mt-2">{err}</p>}
      {done && (
        <p className="text-xs text-green-700 mt-2">
          Riley proposed a revision using {done.research_used} research {done.research_used === 1 ? "item" : "items"}: {done.change_note} Review it in the scope&apos;s proposals.
        </p>
      )}
    </div>
  );
}
