"use client";
import {
  DOC_TYPES, DOC_AUDIENCES, DOC_STATUSES,
  docTypeLabel, docAudienceLabel, docStatusLabel,
  computeHealth, DOC_HEALTH_LABELS,
} from "@/lib/doc-types";
import clsx from "clsx";

export interface FacetDoc {
  id: number;
  name: string;
  path: string;
  doc_type: string;
  status: string;
  audience: string;
  client_id: string | null;
  storage_path?: string | null;
  chunk_count?: number | null;
  last_indexed_at?: string | null;
  updated_at?: string;
}

export interface ClientOption { id: string; name: string; }

export interface Filters {
  status: string;
  doc_type: string;
  audience: string;
  client: string;  // '' = all, 'unassigned' = client_id is null, else a client uuid
  health: string;  // '' = all, else a DocHealth value
}

export const EMPTY_FILTERS: Filters = { status: "", doc_type: "", audience: "", client: "", health: "" };

function matchesFilters(doc: FacetDoc, filters: Filters, q: string, skip?: keyof Filters | (keyof Filters)[]): boolean {
  const skipped = new Set(Array.isArray(skip) ? skip : skip ? [skip] : []);
  if (filters.status && !skipped.has("status") && doc.status !== filters.status) return false;
  if (filters.doc_type && !skipped.has("doc_type") && doc.doc_type !== filters.doc_type) return false;
  if (filters.audience && !skipped.has("audience") && doc.audience !== filters.audience) return false;
  if (filters.client && !skipped.has("client")) {
    if (filters.client === "unassigned" ? doc.client_id !== null : doc.client_id !== filters.client) return false;
  }
  if (filters.health && !skipped.has("health") && computeHealth(doc) !== filters.health) return false;
  if (q.trim()) {
    const needle = q.trim().toLowerCase();
    if (!doc.name.toLowerCase().includes(needle) && !doc.path.toLowerCase().includes(needle)) return false;
  }
  return true;
}

export function applyFilters(docs: FacetDoc[], filters: Filters, q: string): FacetDoc[] {
  return docs.filter((d) => matchesFilters(d, filters, q));
}

function countBy(docs: FacetDoc[], filters: Filters, q: string, key: keyof Filters, value: string): number {
  const scoped = docs.filter((d) => matchesFilters(d, filters, q, key));
  if (key === "client") {
    return scoped.filter((d) => (value === "unassigned" ? d.client_id === null : d.client_id === value)).length;
  }
  if (key === "health") {
    return scoped.filter((d) => computeHealth(d) === value).length;
  }
  return scoped.filter((d) => (d as unknown as Record<string, string>)[key] === value).length;
}

function FacetSection({ title, options, activeValue, onSelect }: {
  title: string;
  options: { value: string; label: string; count: number }[];
  activeValue: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="mb-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted mb-1.5 px-1">{title}</p>
      <div className="space-y-0.5">
        <button
          onClick={() => onSelect("")}
          className={clsx(
            "w-full flex items-center justify-between text-left text-xs px-2 py-1 rounded transition-colors",
            activeValue === "" ? "bg-brand-orange/10 text-brand-black font-medium" : "text-brand-muted hover:bg-brand-offwhite"
          )}
        >
          <span>All</span>
        </button>
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onSelect(activeValue === opt.value ? "" : opt.value)}
            className={clsx(
              "w-full flex items-center justify-between text-left text-xs px-2 py-1 rounded transition-colors",
              activeValue === opt.value ? "bg-brand-orange/10 text-brand-black font-medium" : "text-brand-muted hover:bg-brand-offwhite"
            )}
          >
            <span className="truncate">{opt.label}</span>
            <span className="text-[10px] text-brand-muted ml-2 flex-shrink-0">{opt.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function KpiCard({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex-1 min-w-[100px] rounded-lg border px-3 py-2 text-left transition-colors",
        active ? "border-brand-orange bg-brand-orange/5" : "border-brand-border bg-white hover:bg-brand-offwhite"
      )}
    >
      <p className="text-lg font-semibold text-brand-black">{count}</p>
      <p className="text-[10px] text-brand-muted uppercase tracking-wide">{label}</p>
    </button>
  );
}

export function KpiRow({ docs, filters, q, onChange }: {
  docs: FacetDoc[]; filters: Filters; q: string; onChange: (patch: Partial<Filters>) => void;
}) {
  // Scoped by every OTHER active filter/search term, same as the facet-rail
  // counts (countBy) — each card skips only the dimension(s) it itself
  // controls, so e.g. selecting a doc_type in the left rail narrows these
  // counts too, without a card's own filter excluding itself from its count.
  const statusScoped = docs.filter((d) => matchesFilters(d, filters, q, "status"));
  const healthScoped = docs.filter((d) => matchesFilters(d, filters, q, "health"));
  const totalScoped = docs.filter((d) => matchesFilters(d, filters, q, ["status", "health"]));

  const total = totalScoped.length;
  const active = statusScoped.filter((d) => d.status === "active").length;
  const drafts = statusScoped.filter((d) => d.status === "draft").length;
  const archived = statusScoped.filter((d) => d.status === "archived").length;
  const issues = healthScoped.filter((d) => {
    const h = computeHealth(d);
    return h === "stale" || h === "not_indexed";
  }).length;

  return (
    <div className="flex gap-2 flex-wrap mb-4">
      <KpiCard label="Total" count={total} active={filters.status === "" && filters.health === ""} onClick={() => onChange({ status: "", health: "" })} />
      <KpiCard label="Active" count={active} active={filters.status === "active"} onClick={() => onChange({ status: filters.status === "active" ? "" : "active" })} />
      <KpiCard label="Drafts" count={drafts} active={filters.status === "draft"} onClick={() => onChange({ status: filters.status === "draft" ? "" : "draft" })} />
      <KpiCard label="Archived" count={archived} active={filters.status === "archived"} onClick={() => onChange({ status: filters.status === "archived" ? "" : "archived" })} />
      <KpiCard label="Index issues" count={issues} active={filters.health === "stale" || filters.health === "not_indexed"} onClick={() => onChange({ health: filters.health ? "" : "stale" })} />
    </div>
  );
}

export default function FacetRail({ docs, clients, filters, q, onChange }: {
  docs: FacetDoc[];
  clients: ClientOption[];
  filters: Filters;
  q: string;
  onChange: (patch: Partial<Filters>) => void;
}) {
  const statusOptions = DOC_STATUSES.map((s: string) => ({ value: s, label: docStatusLabel(s), count: countBy(docs, filters, q, "status", s) }));
  const typeOptions = DOC_TYPES.map((t: string) => ({ value: t, label: docTypeLabel(t), count: countBy(docs, filters, q, "doc_type", t) }));
  const audienceOptions = DOC_AUDIENCES.map((a: string) => ({ value: a, label: docAudienceLabel(a), count: countBy(docs, filters, q, "audience", a) }));
  const clientOptions = [
    { value: "unassigned", label: "Rosably (unassigned)", count: countBy(docs, filters, q, "client", "unassigned") },
    ...clients.map((c) => ({ value: c.id, label: c.name, count: countBy(docs, filters, q, "client", c.id) })),
  ];
  const healthOptions = (["indexed", "stale", "not_indexed"] as const).map((h) => ({
    value: h, label: DOC_HEALTH_LABELS[h], count: countBy(docs, filters, q, "health", h),
  }));

  return (
    <div className="w-52 flex-shrink-0 overflow-y-auto">
      <FacetSection title="Status" options={statusOptions} activeValue={filters.status} onSelect={(v) => onChange({ status: v })} />
      <FacetSection title="Doc type" options={typeOptions} activeValue={filters.doc_type} onSelect={(v) => onChange({ doc_type: v })} />
      <FacetSection title="Audience" options={audienceOptions} activeValue={filters.audience} onSelect={(v) => onChange({ audience: v })} />
      <FacetSection title="Client scope" options={clientOptions} activeValue={filters.client} onSelect={(v) => onChange({ client: v })} />
      <FacetSection title="Index health" options={healthOptions} activeValue={filters.health} onSelect={(v) => onChange({ health: v })} />
    </div>
  );
}
