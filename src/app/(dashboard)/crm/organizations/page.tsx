"use client";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchJson } from "@/lib/fetch-json";
import { STAGES } from "@/lib/crm/stages";
import { ORG_STATUSES, ORG_STATUS_META, parseOrgStatusFilter, type OrgStatusFilter } from "@/lib/crm/org-status";
import { Button, EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/ui";
import { OrgFormModal } from "@/components/crm/org/OrgFormModal";
import { NewClientModal } from "@/components/crm/client/NewClientModal";
import type { OrgListRow } from "@/lib/crm/org-detail";

type ListResponse = { organizations: OrgListRow[]; counts: Record<OrgStatusFilter, number> };
type SavedFilter = { name: string; status: OrgStatusFilter; q: string; open: boolean };

const PILLS: { id: OrgStatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  ...ORG_STATUSES.map((s) => ({ id: s, label: ORG_STATUS_META[s].plural })),
];
// Built-in views; the ones Brian saves are kept in this browser only.
const BUILT_IN: SavedFilter[] = [
  { name: "Open deals", status: "all", q: "", open: true },
  { name: "Prospects with open deals", status: "prospect", q: "", open: true },
];
const SAVED_KEY = "crm.organizations.savedFilters";

function readSaved(): SavedFilter[] {
  try {
    const raw = window.localStorage.getItem(SAVED_KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((f) => f && typeof f.name === "string") : [];
  } catch { return []; }
}
function writeSaved(list: SavedFilter[]) {
  try { window.localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
}
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default function OrganizationsPage() {
  return (
    <Suspense fallback={<div className="p-4 md:p-8"><LoadingState /></div>}>
      <OrganizationsInner />
    </Suspense>
  );
}

function OrganizationsInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const status = parseOrgStatusFilter(sp.get("status"));
  const q = sp.get("q") ?? "";
  const openOnly = sp.get("open") === "1";

  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(q);
  const [saved, setSaved] = useState<SavedFilter[]>([]);
  const [showNewOrg, setShowNewOrg] = useState(false);
  const [showNewClient, setShowNewClient] = useState(false);

  useEffect(() => { setSaved(readSaved()); }, []);
  useEffect(() => { setSearch(q); }, [q]);

  const setParams = useCallback((next: Partial<{ status: OrgStatusFilter; q: string; open: boolean }>) => {
    const p = new URLSearchParams(Array.from(sp.entries()));
    const s = next.status ?? status;
    const qq = next.q ?? q;
    const o = next.open ?? openOnly;
    if (s === "all") p.delete("status"); else p.set("status", s);
    if (qq) p.set("q", qq); else p.delete("q");
    if (o) p.set("open", "1"); else p.delete("open");
    const qs = p.toString();
    router.replace(qs ? `/crm/organizations?${qs}` : "/crm/organizations", { scroll: false });
  }, [router, sp, status, q, openOnly]);

  // Debounce typing into ?q=.
  useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => setParams({ q: search.trim() }), 250);
    return () => clearTimeout(t);
  }, [search, q, setParams]);

  const load = useCallback(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    fetchJson<ListResponse>(`/api/crm/organizations?${p}`).then((r) => {
      if (r.ok) { setData(r.data); setError(null); } else setError(r.error);
    });
  }, [q]);
  useEffect(() => { load(); }, [load]);

  // Status and the open-deal toggle filter here, so the pill counts stay those of the search.
  const rows = useMemo(() => (data?.organizations ?? [])
    .filter((o) => status === "all" || o.status === status)
    .filter((o) => !openOnly || o.open_deals > 0), [data, status, openOnly]);
  const counts = data?.counts;

  const current: SavedFilter = { name: "", status, q, open: openOnly };
  const isCurrent = (f: SavedFilter) => f.status === status && f.q === q && f.open === openOnly;

  function saveCurrent() {
    const name = prompt("Name this filter:")?.trim();
    if (!name) return;
    const next = [...saved.filter((f) => f.name !== name), { ...current, name }];
    setSaved(next);
    writeSaved(next);
  }
  function removeSaved(name: string) {
    const next = saved.filter((f) => f.name !== name);
    setSaved(next);
    writeSaved(next);
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl pb-24 md:pb-8">
      <PageHeader
        title="Organizations"
        description="Prospects, clients and partners in one list. The status follows the client record unless you set it."
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={() => setShowNewClient(true)}>+ New client</Button>
            <Button size="sm" onClick={() => setShowNewOrg(true)}>+ New organization</Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-3" role="group" aria-label="Relationship status">
        {PILLS.map((p) => (
          <button key={p.id} type="button" aria-pressed={status === p.id} onClick={() => setParams({ status: p.id })}
            className={clsx("text-xs px-3 py-1 rounded-full border transition-colors",
              status === p.id ? "bg-brand-orange text-white border-brand-orange" : "border-brand-border text-brand-muted hover:bg-brand-cream")}>
            {p.label}{counts ? <span className="ml-1 opacity-80">{counts[p.id]}</span> : null}
          </button>
        ))}
        <label className="flex items-center gap-1.5 text-xs text-brand-muted ml-1">
          <input type="checkbox" checked={openOnly} onChange={(e) => setParams({ open: e.target.checked })} />
          Has an open deal
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          className="w-full max-w-sm border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
          placeholder="Search organizations and people…"
          aria-label="Search organizations"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-brand-muted">Saved:</span>
          {[...BUILT_IN, ...saved].map((f) => (
            <span key={f.name} className={clsx("inline-flex items-center rounded border", isCurrent(f) ? "border-brand-orange text-brand-orange" : "border-brand-border text-brand-black")}>
              <button type="button" className="px-2 py-0.5 hover:bg-brand-cream" onClick={() => setParams({ status: f.status, q: f.q, open: f.open })}>{f.name}</button>
              {saved.includes(f) && (
                <button type="button" aria-label={`Remove saved filter ${f.name}`} className="px-1 text-brand-muted hover:text-red-600" onClick={() => removeSaved(f.name)}>×</button>
              )}
            </span>
          ))}
          <button type="button" className="text-brand-orange hover:underline" onClick={saveCurrent}>Save current…</button>
        </div>
      </div>

      {error && <ErrorState message={`Couldn't load organizations: ${error}`} onRetry={load} className="mb-4" />}
      {!data && !error ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <EmptyState title={q || status !== "all" || openOnly ? "No organizations match." : "No organizations yet."} />
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-brand-muted border-b border-brand-border">
                <th className="px-4 py-2 font-medium">Organization</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Open deal</th>
                <th className="px-3 py-2 font-medium text-right">People</th>
                <th className="px-3 py-2 font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const stage = o.open_deal ? STAGES.find((s) => s.stage === o.open_deal!.stage) : null;
                return (
                  <tr key={o.id} className="border-b border-brand-border last:border-0 hover:bg-brand-offwhite">
                    <td className="px-4 py-2.5 min-w-48">
                      <Link href={`/crm/organizations/${o.id}`} className="font-medium text-brand-black hover:text-brand-orange hover:underline">{o.name}</Link>
                      <p className="text-xs text-brand-muted">{[o.industry, o.website?.replace(/^https?:\/\//, "")].filter(Boolean).join(" · ") || " "}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={clsx("badge text-xs", ORG_STATUS_META[o.status].badge)}>{ORG_STATUS_META[o.status].label}</span>
                    </td>
                    <td className="px-3 py-2.5 min-w-36">
                      {o.open_deal ? (
                        <>
                          {stage && <span className={clsx("badge text-xs", stage.color)}>{stage.label}</span>}
                          <p className="text-xs text-brand-muted mt-0.5">
                            {o.open_value ? money(o.open_value) : "No value"}{o.open_deals > 1 ? ` · ${o.open_deals} open` : ""}
                          </p>
                        </>
                      ) : <span className="text-brand-muted">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{o.people}</td>
                    <td className="px-3 py-2.5 text-xs text-brand-muted whitespace-nowrap">{formatDistanceToNow(new Date(o.last_activity_at), { addSuffix: true })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showNewOrg && (
        <OrgFormModal business={null} onClose={() => setShowNewOrg(false)}
          onSaved={(b) => { setShowNewOrg(false); router.push(`/crm/organizations/${b.id}`); }} />
      )}
      {showNewClient && (
        <NewClientModal onClose={() => setShowNewClient(false)}
          onCreated={(c) => { setShowNewClient(false); router.push(`/crm/organizations/${c.business_id}?tab=billing&client=${c.id}`); }} />
      )}
    </div>
  );
}
