"use client";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { AgentBadge } from "@/components/AgentBadge";
import { EmptyState } from "@/components/ui";
import { CLOSED_STATUSES } from "@/lib/work-filters";
import type { AgentName, WorkItem, WorkStatus } from "@/types";

// ─── Search ───────────────────────────────────────────────────────────────────

export function SearchBar({
  value,
  onChange,
  searchAll,
  onToggleSearchAll,
}: {
  value: string;
  onChange: (v: string) => void;
  searchAll: boolean;
  onToggleSearchAll: () => void;
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="relative flex-1 min-w-[220px] max-w-md">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-brand-muted text-sm pointer-events-none">
          ⌕
        </span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search work items…"
          className="w-full rounded border border-brand-border bg-white pl-7 pr-7 py-1.5 text-sm focus:outline-none focus:border-brand-orange"
        />
        {value && (
          <button
            onClick={() => onChange("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-brand-muted hover:text-brand-black text-base leading-none"
          >
            ×
          </button>
        )}
      </div>
      <label
        className="inline-flex items-center gap-1.5 text-xs text-brand-muted cursor-pointer select-none"
        title="Search every status, including done/cancelled/rejected and archived items"
      >
        <input type="checkbox" checked={searchAll} onChange={onToggleSearchAll} />
        <span>Include closed &amp; archived</span>
      </label>
    </div>
  );
}

export function SearchResults({
  results,
  searching,
  query,
  searchAll,
  statusPill,
  statusLabel,
}: {
  results: WorkItem[];
  searching: boolean;
  query: string;
  searchAll: boolean;
  statusPill: (s: WorkStatus) => string;
  statusLabel: (s: WorkStatus) => string;
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs text-brand-muted">
        {searching
          ? "Searching…"
          : `${results.length} result${results.length === 1 ? "" : "s"} for “${query}”`}
        {!searchAll && <span className="ml-1">· closed &amp; archived hidden</span>}
      </div>
      {!searching && results.length === 0 ? (
        <EmptyState
          title="No matching work items."
          description={!searchAll ? "Try “Include closed & archived”." : undefined}
        />
      ) : (
        <div className="space-y-1.5">
          {results.map((item) => (
            <SearchResultRow
              key={item.id}
              item={item}
              statusPill={statusPill}
              statusLabel={statusLabel}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function SearchResultRow({
  item,
  statusPill,
  statusLabel,
}: {
  item: WorkItem;
  statusPill: (s: WorkStatus) => string;
  statusLabel: (s: WorkStatus) => string;
}) {
  const router = useRouter();
  const isClosed = CLOSED_STATUSES.includes(item.status);
  return (
    <button
      onClick={() => router.push(`/work/${item.ref}`)}
      className={clsx(
        "w-full text-left bg-white rounded border border-brand-border px-3 py-2 transition flex items-center gap-3 hover:border-brand-orange/40 hover:shadow-sm",
        isClosed && "opacity-75",
      )}
    >
      <span
        className={clsx(
          "shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium",
          statusPill(item.status),
        )}
      >
        {statusLabel(item.status)}
      </span>
      <span className="flex-1 min-w-0 truncate text-sm text-brand-black">
        <span className="text-brand-muted mr-1">#{item.ref}</span>
        {item.title}
      </span>
      <span className="shrink-0 hidden sm:inline text-[10px] text-brand-muted capitalize">
        {item.work_type}
      </span>
      {item.assigned_agent && <AgentBadge agent={item.assigned_agent as AgentName} size="sm" />}
    </button>
  );
}
