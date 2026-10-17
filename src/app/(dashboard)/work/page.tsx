"use client";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePolling } from "@/lib/use-polling";
import { Button, EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/ui";
import { KanbanColumn } from "@/components/work/KanbanColumn";
import { ConfigureColumnsMenu } from "@/components/work/ConfigureColumnsMenu";
import { AdvancedSearchDrawer } from "@/components/work/AdvancedSearchDrawer";
import {
  STATUS_PILL,
  STATUS_LABEL,
  ALL_STATUSES,
  type ItemTypeFilter,
} from "@/components/work/work-constants";
import {
  PHASE_NONE,
  buildFilters,
  comparePhaseValues,
  filtersToQuery,
  matchesFilters,
  sortByPhaseThenPriority,
  type Filters,
} from "@/lib/work-filters";
import type { WorkItem, WorkStatus } from "@/types";
import { FilterBar, FilterChip } from "./_components/filters";
import { SearchBar, SearchResults } from "./_components/search";
import { NewItemModal } from "./_components/NewItemModal";

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_VISIBLE: WorkStatus[] = ["inbox", "in_progress", "open", "on_hold"];

const TRANSITIONS: Record<WorkStatus, WorkStatus[]> = {
  inbox:        ["approved", "deferred", "cancelled"],
  approved:     ["prompt_ready", "inbox", "deferred", "cancelled"],
  prompt_ready: ["in_progress", "approved", "cancelled"],
  in_progress:  ["done", "on_hold", "open", "prompt_ready", "cancelled"],
  open:         ["in_progress", "on_hold", "done", "deferred", "cancelled"],
  on_hold:      ["in_progress", "open", "done", "cancelled"],
  deferred:     ["inbox", "cancelled"],
  done:         ["inbox"],
  cancelled:    ["inbox"],
  rejected:     ["inbox"],
};

const COLUMNS_STORAGE_KEY = "work-kanban-columns";
const FILTERS_SESSION_KEY = "work-kanban-filters";

// ─── Persisted columns config ────────────────────────────────────────────────

type ColumnConfig = { visible: WorkStatus[]; order: WorkStatus[] };

function loadColumnConfig(): ColumnConfig {
  if (typeof window === "undefined") {
    return { visible: DEFAULT_VISIBLE, order: DEFAULT_VISIBLE };
  }
  try {
    const raw = localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (!raw) return { visible: DEFAULT_VISIBLE, order: DEFAULT_VISIBLE };
    const parsed = JSON.parse(raw) as Partial<ColumnConfig>;
    const visible = (parsed.visible ?? DEFAULT_VISIBLE).filter((s): s is WorkStatus =>
      ALL_STATUSES.includes(s),
    );
    const order = (parsed.order ?? DEFAULT_VISIBLE).filter((s): s is WorkStatus =>
      ALL_STATUSES.includes(s),
    );
    return {
      visible: visible.length ? visible : DEFAULT_VISIBLE,
      order: order.length ? order : DEFAULT_VISIBLE,
    };
  } catch {
    return { visible: DEFAULT_VISIBLE, order: DEFAULT_VISIBLE };
  }
}

function saveColumnConfig(cfg: ColumnConfig) {
  try {
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // localStorage may be unavailable; non-critical
  }
}

// ─── Page (suspense wrapper for useSearchParams) ─────────────────────────────

export default function WorkPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-brand-muted">Loading…</div>}>
      <WorkPageInner />
    </Suspense>
  );
}

function WorkPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const filters = useMemo(() => buildFilters(sp), [sp]);

  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [columnCfg, setColumnCfg] = useState<ColumnConfig>(() => loadColumnConfig());
  const [newItemOpen, setNewItemOpen] = useState(false);
  // Auto-open the Advanced Search drawer when arriving on a shared `?as=1` link.
  const [advancedOpen, setAdvancedOpen] = useState(sp.get("as") === "1");
  const [error, setError] = useState<string | null>(null);
  const [availableSprints, setAvailableSprints] = useState<number[]>([]);

  // ─── Search ────────────────────────────────────────────────────────────────
  const searchActive = filters.q.length > 0;
  const [searchItems, setSearchItems] = useState<WorkItem[]>([]);
  const [searching, setSearching] = useState(false);
  // Local mirror of the search box, debounce-committed to the URL `q` param.
  const [searchInput, setSearchInput] = useState(filters.q);

  // Keep the box in sync when `q` changes from outside (e.g. back navigation).
  useEffect(() => {
    setSearchInput(filters.q);
  }, [filters.q]);

  // Debounce-commit the typed value into the URL. Reads from `sp` so all other
  // query params are preserved.
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === (sp.get("q") ?? "")) return;
    const t = setTimeout(() => {
      const next = new URLSearchParams(sp.toString());
      if (trimmed) next.set("q", trimmed);
      else next.delete("q");
      const qs = next.toString();
      router.replace(qs ? `/work?${qs}` : "/work", { scroll: false });
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, sp, router]);

  // Fetch matching items server-side (covers items beyond the kanban's 500-row
  // window, including closed ones when searchAll is on).
  useEffect(() => {
    if (!searchActive) {
      setSearchItems([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const params = new URLSearchParams({
      // The "all statuses" flag also reaches archived history, where ~all closed
      // items live; the default scope stays on active, non-archived items.
      archived: filters.searchAll ? "all" : "false",
      itemType: filters.itemType,
      q: filters.q,
      searchAll: filters.searchAll ? "1" : "0",
    });
    fetch(`/api/work?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setSearchItems(Array.isArray(d) ? d : []);
      })
      .catch(() => {
        if (!cancelled) setSearchItems([]);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [searchActive, filters.q, filters.searchAll, filters.itemType]);

  // Persist filter snapshot for back-from-detail navigation.
  useEffect(() => {
    try {
      sessionStorage.setItem(FILTERS_SESSION_KEY, filtersToQuery(filters));
    } catch {
      // sessionStorage may be unavailable
    }
  }, [filters]);

  // Fetch items — server-filters by itemType so client/internal swap re-queries.
  // `silent` refreshes in place (polling) without the loading state, and keeps
  // the current items if a background refresh fails.
  const load = useCallback(async (itemType: ItemTypeFilter, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/work?archived=false&itemType=${itemType}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
      if (!silent) setError(null);
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(filters.itemType);
  }, [load, filters.itemType]);

  // Fetch sprint number options once on mount; refresh after new items are created.
  const reloadSprintOptions = useCallback(async () => {
    try {
      const res = await fetch("/api/work/sprint-numbers");
      const data = await res.json();
      setAvailableSprints(Array.isArray(data) ? data : []);
    } catch {
      // Non-critical — the Sprint dropdown just shows no options
    }
  }, []);

  useEffect(() => {
    reloadSprintOptions();
  }, [reloadSprintOptions]);

  // Poll for changes made elsewhere (agents, n8n, other tabs).
  usePolling(() => {
    load(filters.itemType, true);
    // A new item may introduce a previously-unseen sprint number
    reloadSprintOptions();
  }, 15_000);

  const setFilters = useCallback(
    (next: Filters) => {
      const qs = filtersToQuery(next);
      router.replace(qs ? `/work?${qs}` : "/work", { scroll: false });
    },
    [router],
  );

  const move = useCallback(
    async (id: string, next: WorkStatus) => {
      // Optimistic UI; polling corrects any drift
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status: next } : i)));
      try {
        const res = await fetch(`/api/work/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: next }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Move failed");
        load(filters.itemType);
      }
    },
    [load, filters.itemType],
  );

  const onColumnConfigChange = useCallback((cfg: ColumnConfig) => {
    setColumnCfg(cfg);
    saveColumnConfig(cfg);
  }, []);

  // Filtered + grouped items per column
  const grouped = useMemo(() => {
    const filtered = items.filter((i) => matchesFilters(i, filters));
    const byStatus = new Map<WorkStatus, WorkItem[]>();
    for (const s of ALL_STATUSES) byStatus.set(s, []);
    for (const item of filtered) {
      const bucket = byStatus.get(item.status);
      if (bucket) bucket.push(item);
    }
    for (const list of byStatus.values()) list.sort(sortByPhaseThenPriority);
    return byStatus;
  }, [items, filters]);

  // Apply the remaining client-side filters (agent/type/priority/source/sprint)
  // to the server search results so search honours the active filter bar too.
  const searchResults = useMemo(
    () => searchItems.filter((i) => matchesFilters(i, filters)).sort(sortByPhaseThenPriority),
    [searchItems, filters],
  );

  const visibleColumns = columnCfg.order.filter((s) => columnCfg.visible.includes(s));

  // itemType always has a value; only count it as "active" when it differs from the default.
  const activeFilterCount =
    filters.agents.size +
    filters.workTypes.size +
    filters.priorities.size +
    filters.sources.size +
    filters.phases.size +
    (filters.itemType === "internal" ? 0 : 1);

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Header */}
      <PageHeader
        title="Work items"
        className="!mb-0"
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setAdvancedOpen(true)}>
              ⌕ Advanced Search
            </Button>
            <ConfigureColumnsMenu
              allStatuses={ALL_STATUSES}
              visible={columnCfg.visible}
              order={columnCfg.order}
              statusLabel={(s) => STATUS_LABEL[s]}
              onChange={onColumnConfigChange}
            />
            <Button size="sm" onClick={() => setNewItemOpen(true)}>
              + New work item
            </Button>
          </>
        }
      />

      {/* Search */}
      <SearchBar
        value={searchInput}
        onChange={setSearchInput}
        searchAll={filters.searchAll}
        onToggleSearchAll={() => setFilters({ ...filters, searchAll: !filters.searchAll })}
      />

      {/* Filter bar */}
      <FilterBar filters={filters} setFilters={setFilters} availableSprints={availableSprints} />

      {/* Active filter chips */}
      {activeFilterCount > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {Array.from(filters.agents).map((a) => (
            <FilterChip
              key={`a-${a}`}
              label={`Agent: ${a}`}
              onRemove={() => {
                const next = new Set(filters.agents);
                next.delete(a);
                setFilters({ ...filters, agents: next });
              }}
            />
          ))}
          {Array.from(filters.workTypes).map((t) => (
            <FilterChip
              key={`t-${t}`}
              label={`Type: ${t}`}
              onRemove={() => {
                const next = new Set(filters.workTypes);
                next.delete(t);
                setFilters({ ...filters, workTypes: next });
              }}
            />
          ))}
          {Array.from(filters.priorities).map((p) => (
            <FilterChip
              key={`p-${p}`}
              label={`Priority: ${p}`}
              onRemove={() => {
                const next = new Set(filters.priorities);
                next.delete(p);
                setFilters({ ...filters, priorities: next });
              }}
            />
          ))}
          {Array.from(filters.sources).map((s) => (
            <FilterChip
              key={`s-${s}`}
              label={`Source: ${s}`}
              onRemove={() => {
                const next = new Set(filters.sources);
                next.delete(s);
                setFilters({ ...filters, sources: next });
              }}
            />
          ))}
          {Array.from(filters.phases)
            .sort(comparePhaseValues)
            .map((v) => (
              <FilterChip
                key={`ph-${v}`}
                label={v === PHASE_NONE ? "Phase: None" : `Phase ${v}`}
                onRemove={() => {
                  const next = new Set(filters.phases);
                  next.delete(v);
                  setFilters({ ...filters, phases: next });
                }}
              />
            ))}
          {filters.itemType !== "internal" && (
            <FilterChip
              label={`Items: ${filters.itemType}`}
              onRemove={() => setFilters({ ...filters, itemType: "internal" })}
            />
          )}
          <button
            onClick={() =>
              setFilters({
                agents: new Set(),
                workTypes: new Set(),
                priorities: new Set(),
                sources: new Set(),
                phases: new Set(),
                itemType: "internal",
                q: filters.q,
                searchAll: filters.searchAll,
              })
            }
            className="text-xs text-brand-orange hover:underline"
          >
            Clear all
          </button>
        </div>
      )}

      {error && <ErrorState message={error} />}

      {/* Search results replace the board while a query is active */}
      {searchActive ? (
        <SearchResults
          results={searchResults}
          searching={searching}
          query={filters.q}
          searchAll={filters.searchAll}
          statusPill={(s) => STATUS_PILL[s]}
          statusLabel={(s) => STATUS_LABEL[s]}
        />
      ) : loading ? (
        <LoadingState />
      ) : visibleColumns.length === 0 ? (
        <EmptyState title="No columns visible. Use ⚙ Columns to show one." />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-3 [-webkit-overflow-scrolling:touch]">
          {visibleColumns.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              label={STATUS_LABEL[status]}
              items={grouped.get(status) ?? []}
              pillClass={STATUS_PILL[status]}
              onMove={move}
              allowedTargets={(current) => TRANSITIONS[current] ?? []}
              statusLabel={(s) => STATUS_LABEL[s]}
            />
          ))}
        </div>
      )}

      {newItemOpen && (
        <NewItemModal
          onClose={() => setNewItemOpen(false)}
          onCreated={() => {
            load(filters.itemType);
            reloadSprintOptions();
          }}
        />
      )}

      <AdvancedSearchDrawer open={advancedOpen} onClose={() => setAdvancedOpen(false)} />
    </div>
  );
}
