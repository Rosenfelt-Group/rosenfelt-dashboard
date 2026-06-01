"use client";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { supabase } from "@/lib/supabase";
import { AgentBadge } from "@/components/AgentBadge";
import { KanbanColumn } from "@/components/work/KanbanColumn";
import { ConfigureColumnsMenu } from "@/components/work/ConfigureColumnsMenu";
import type {
  AgentName,
  TaskPriority,
  WorkItem,
  WorkItemSource,
  WorkItemType,
  WorkStatus,
  WorkType,
} from "@/types";

// ─── Constants ───────────────────────────────────────────────────────────────

const WORK_TYPES: WorkType[] = [
  "infrastructure", "agent", "dashboard", "content",
  "website", "operations", "business", "workflow",
];

const AGENT_FILTER_OPTIONS: (AgentName | "unassigned")[] = [
  "riley", "jordan", "avery", "casey", "brian", "unassigned",
];

const PRIORITIES: TaskPriority[] = ["high", "medium", "low"];

const SOURCES: WorkItemSource[] = [
  "manual", "casey_audit", "sprint_plan", "sprint",
  "agent_suggestion", "backlog_migration", "typeform", "stripe",
];

const ITEM_TYPES: WorkItemType[] = ["internal", "client"];
type ItemTypeFilter = WorkItemType | "all";
const ITEM_TYPE_FILTERS: ItemTypeFilter[] = ["internal", "client", "all"];

const STATUS_PILL: Record<WorkStatus, string> = {
  inbox:        "bg-gray-100 text-gray-700",
  approved:     "bg-blue-100 text-blue-700",
  prompt_ready: "bg-violet-100 text-violet-700",
  in_progress:  "bg-amber-100 text-amber-700",
  open:         "bg-slate-100 text-slate-700",
  on_hold:      "bg-indigo-100 text-indigo-700",
  done:         "bg-green-100 text-green-700",
  deferred:     "bg-yellow-100 text-yellow-800",
  cancelled:    "bg-gray-200 text-gray-600",
  rejected:     "bg-red-100 text-red-700",
};

const STATUS_LABEL: Record<WorkStatus, string> = {
  inbox:        "Inbox",
  approved:     "Approved",
  prompt_ready: "Prompt ready",
  in_progress:  "In progress",
  open:         "Open",
  on_hold:      "On hold",
  done:         "Done",
  deferred:     "Deferred",
  cancelled:    "Cancelled",
  rejected:     "Rejected",
};

const ALL_STATUSES: WorkStatus[] = [
  "inbox", "approved", "prompt_ready", "in_progress",
  "open", "on_hold", "done", "deferred", "cancelled", "rejected",
];

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

const PRIORITY_ORDER: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };

function sortByPriorityThenUpdated(a: WorkItem, b: WorkItem) {
  const pa = PRIORITY_ORDER[a.priority] ?? 1;
  const pb = PRIORITY_ORDER[b.priority] ?? 1;
  if (pa !== pb) return pa - pb;
  return b.updated_at.localeCompare(a.updated_at);
}

// ─── Filter helpers ──────────────────────────────────────────────────────────

type Filters = {
  agents: Set<AgentName | "unassigned">;
  workTypes: Set<WorkType>;
  priorities: Set<TaskPriority>;
  sources: Set<WorkItemSource>;
  sprints: Set<number>;
  // Server-side filter (passed to /api/work?itemType=) — single value, defaults to "internal"
  itemType: ItemTypeFilter;
  // Free-text search (server-side). Empty string = no search active.
  q: string;
  // When true, search spans every status; otherwise terminal statuses are hidden.
  searchAll: boolean;
};

// Terminal statuses hidden from the default search scope. The "all statuses"
// toggle (and the API's searchAll=1) lifts this restriction.
const CLOSED_STATUSES: WorkStatus[] = ["done", "cancelled", "rejected"];

function parseSetParam<T extends string>(
  raw: string | null,
  allowed: readonly T[],
): Set<T> {
  if (!raw) return new Set();
  const valid = new Set(allowed);
  return new Set(
    raw.split(",").map((s) => s.trim()).filter((s): s is T => valid.has(s as T)),
  );
}

function parseSprints(raw: string | null): Set<number> {
  if (!raw) return new Set();
  const out = new Set<number>();
  for (const part of raw.split(",")) {
    const n = parseInt(part.trim(), 10);
    if (Number.isInteger(n) && n >= 0) out.add(n);
  }
  return out;
}

function parseItemType(raw: string | null): ItemTypeFilter {
  if (raw === "client" || raw === "all") return raw;
  return "internal";
}

function buildFilters(sp: URLSearchParams): Filters {
  return {
    agents: parseSetParam<AgentName | "unassigned">(sp.get("agent"), AGENT_FILTER_OPTIONS),
    workTypes: parseSetParam<WorkType>(sp.get("type"), WORK_TYPES),
    priorities: parseSetParam<TaskPriority>(sp.get("priority"), PRIORITIES),
    sources: parseSetParam<WorkItemSource>(sp.get("source"), SOURCES),
    sprints: parseSprints(sp.get("sprint")),
    itemType: parseItemType(sp.get("itemType")),
    q: (sp.get("q") ?? "").trim(),
    searchAll: sp.get("searchAll") === "1",
  };
}

function filtersToQuery(f: Filters): string {
  const sp = new URLSearchParams();
  if (f.agents.size) sp.set("agent", Array.from(f.agents).join(","));
  if (f.workTypes.size) sp.set("type", Array.from(f.workTypes).join(","));
  if (f.priorities.size) sp.set("priority", Array.from(f.priorities).join(","));
  if (f.sources.size) sp.set("source", Array.from(f.sources).join(","));
  if (f.sprints.size) sp.set("sprint", Array.from(f.sprints).sort((a, b) => a - b).join(","));
  // Only persist itemType when it's not the default ("internal")
  if (f.itemType !== "internal") sp.set("itemType", f.itemType);
  if (f.q) sp.set("q", f.q);
  if (f.searchAll) sp.set("searchAll", "1");
  return sp.toString();
}

function matchesFilters(item: WorkItem, f: Filters): boolean {
  if (f.agents.size) {
    const key = item.assigned_agent ?? "unassigned";
    if (!f.agents.has(key as AgentName | "unassigned")) return false;
  }
  if (f.workTypes.size && !f.workTypes.has(item.work_type)) return false;
  if (f.priorities.size && !f.priorities.has(item.priority)) return false;
  if (f.sources.size && !f.sources.has(item.source)) return false;
  if (f.sprints.size) {
    if (item.sprint_number == null || !f.sprints.has(item.sprint_number)) return false;
  }
  // itemType is enforced server-side via /api/work?itemType=, but defensively re-check
  // here so a stale fetch doesn't leak across toggle states.
  if (f.itemType === "internal" && item.work_item_type !== "internal") return false;
  if (f.itemType === "client" && item.work_item_type !== "client") return false;
  return true;
}

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
  const load = useCallback(async (itemType: ItemTypeFilter) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/work?archived=false&itemType=${itemType}`);
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
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

  // Realtime updates on work_items: refetch (cheaper than reconciling).
  // Re-subscribe when itemType changes so the refetch carries the right filter.
  useEffect(() => {
    const channel = supabase
      .channel("work-items-kanban")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "work_items" },
        () => {
          load(filters.itemType);
          // A new item may introduce a previously-unseen sprint number
          reloadSprintOptions();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load, filters.itemType, reloadSprintOptions]);

  const setFilters = useCallback(
    (next: Filters) => {
      const qs = filtersToQuery(next);
      router.replace(qs ? `/work?${qs}` : "/work", { scroll: false });
    },
    [router],
  );

  const move = useCallback(
    async (id: string, next: WorkStatus) => {
      // Optimistic UI; Realtime corrects any drift
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
    for (const list of byStatus.values()) list.sort(sortByPriorityThenUpdated);
    return byStatus;
  }, [items, filters]);

  // Apply the remaining client-side filters (agent/type/priority/source/sprint)
  // to the server search results so search honours the active filter bar too.
  const searchResults = useMemo(
    () => searchItems.filter((i) => matchesFilters(i, filters)).sort(sortByPriorityThenUpdated),
    [searchItems, filters],
  );

  const visibleColumns = columnCfg.order.filter((s) => columnCfg.visible.includes(s));

  // itemType always has a value; only count it as "active" when it differs from the default.
  const activeFilterCount =
    filters.agents.size +
    filters.workTypes.size +
    filters.priorities.size +
    filters.sources.size +
    filters.sprints.size +
    (filters.itemType === "internal" ? 0 : 1);

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-brand-black">Work items</h1>
        <div className="flex items-center gap-2">
          <ConfigureColumnsMenu
            allStatuses={ALL_STATUSES}
            visible={columnCfg.visible}
            order={columnCfg.order}
            statusLabel={(s) => STATUS_LABEL[s]}
            onChange={onColumnConfigChange}
          />
          <button
            onClick={() => setNewItemOpen(true)}
            className="rounded bg-brand-orange text-white text-xs px-3 py-1.5 hover:opacity-90"
          >
            + New work item
          </button>
        </div>
      </div>

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
          {Array.from(filters.sprints)
            .sort((a, b) => a - b)
            .map((n) => (
              <FilterChip
                key={`sp-${n}`}
                label={`Sprint ${n}`}
                onRemove={() => {
                  const next = new Set(filters.sprints);
                  next.delete(n);
                  setFilters({ ...filters, sprints: next });
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
                sprints: new Set(),
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

      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded px-3 py-2">
          {error}
        </div>
      )}

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
        <div className="text-sm text-brand-muted">Loading…</div>
      ) : visibleColumns.length === 0 ? (
        <div className="text-sm text-brand-muted">
          No columns visible. Use ⚙ Columns to show one.
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-3">
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
    </div>
  );
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

function FilterBar({
  filters,
  setFilters,
  availableSprints,
}: {
  filters: Filters;
  setFilters: (next: Filters) => void;
  availableSprints: number[];
}) {
  function toggle<T>(set: Set<T>, value: T): Set<T> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  return (
    <div className="space-y-2">
      {/* Items toggle (Internal / Client / All) — server-side filter */}
      <ItemTypeToggle
        value={filters.itemType}
        onChange={(v) => setFilters({ ...filters, itemType: v })}
      />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        <MultiSelect
          label="Agent"
          options={AGENT_FILTER_OPTIONS}
          selected={filters.agents}
          onToggle={(v) => setFilters({ ...filters, agents: toggle(filters.agents, v) })}
        />
        <MultiSelect
          label="Type"
          options={WORK_TYPES}
          selected={filters.workTypes}
          onToggle={(v) => setFilters({ ...filters, workTypes: toggle(filters.workTypes, v) })}
        />
        <MultiSelect
          label="Priority"
          options={PRIORITIES}
          selected={filters.priorities}
          onToggle={(v) =>
            setFilters({ ...filters, priorities: toggle(filters.priorities, v) })
          }
        />
        <MultiSelect
          label="Source"
          options={SOURCES}
          selected={filters.sources}
          onToggle={(v) => setFilters({ ...filters, sources: toggle(filters.sources, v) })}
        />
        <SprintMultiSelect
          label="Sprint #"
          options={availableSprints}
          selected={filters.sprints}
          onToggle={(v) => setFilters({ ...filters, sprints: toggle(filters.sprints, v) })}
        />
      </div>
    </div>
  );
}

function ItemTypeToggle({
  value,
  onChange,
}: {
  value: ItemTypeFilter;
  onChange: (v: ItemTypeFilter) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded border border-brand-border bg-white p-0.5">
      {ITEM_TYPE_FILTERS.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={clsx(
              "text-xs px-3 py-1 rounded capitalize transition-colors",
              active
                ? "bg-brand-orange text-white"
                : "text-brand-muted hover:bg-brand-cream",
            )}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function SprintMultiSelect({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: number[];
  selected: Set<number>;
  onToggle: (v: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const summary =
    selected.size === 0
      ? "All"
      : selected.size === 1
        ? `Sprint ${Array.from(selected)[0]}`
        : `${selected.size} selected`;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full rounded border border-brand-border bg-white text-xs px-2 py-1 text-left hover:bg-brand-cream flex items-center justify-between"
      >
        <span>
          <span className="text-brand-muted">{label}:</span>{" "}
          <span className="text-brand-black">{summary}</span>
        </span>
        <span className="text-brand-muted">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-full bg-white border border-brand-border rounded shadow-md max-h-60 overflow-y-auto">
            {options.length === 0 ? (
              <div className="px-3 py-1.5 text-xs text-brand-muted">No sprints yet</div>
            ) : (
              options.map((n) => (
                <label
                  key={n}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-brand-offwhite cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(n)}
                    onChange={() => onToggle(n)}
                  />
                  <span className="text-brand-black">Sprint {n}</span>
                </label>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MultiSelect<T extends string>({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: readonly T[];
  selected: Set<T>;
  onToggle: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const summary =
    selected.size === 0
      ? "All"
      : selected.size === 1
        ? Array.from(selected)[0]
        : `${selected.size} selected`;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full rounded border border-brand-border bg-white text-xs px-2 py-1 text-left hover:bg-brand-cream flex items-center justify-between"
      >
        <span>
          <span className="text-brand-muted">{label}:</span>{" "}
          <span className="text-brand-black">{summary}</span>
        </span>
        <span className="text-brand-muted">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-full bg-white border border-brand-border rounded shadow-md max-h-60 overflow-y-auto">
            {options.map((opt) => (
              <label
                key={opt}
                className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-brand-offwhite cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.has(opt)}
                  onChange={() => onToggle(opt)}
                />
                <span className="text-brand-black">{opt}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand-cream text-xs px-2 py-0.5 text-brand-black">
      {label}
      <button
        onClick={onRemove}
        className="text-brand-muted hover:text-red-600"
        aria-label={`Remove ${label}`}
      >
        ×
      </button>
    </span>
  );
}

// ─── Search ───────────────────────────────────────────────────────────────────

function SearchBar({
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

function SearchResults({
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
        <div className="text-sm text-brand-muted border border-dashed border-brand-border rounded p-6 text-center">
          No matching work items.
          {!searchAll && " Try “Include closed & archived”."}
        </div>
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

function SearchResultRow({
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
      onClick={() => router.push(`/work/${item.id}`)}
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
      <span className="flex-1 min-w-0 truncate text-sm text-brand-black">{item.title}</span>
      <span className="shrink-0 hidden sm:inline text-[10px] text-brand-muted capitalize">
        {item.work_type}
      </span>
      {item.assigned_agent && <AgentBadge agent={item.assigned_agent as AgentName} size="sm" />}
    </button>
  );
}

// ─── New item modal ──────────────────────────────────────────────────────────

// Phase 0.7: sources offered for manual creation. System-generated sources
// (backlog_migration / typeform / stripe) are intentionally omitted — they're
// only written by automated paths, never chosen by hand. Both build-plan
// origins collapse to one "From Plan Doc" choice writing source='sprint_plan'.
const CREATE_SOURCE_OPTIONS: { value: WorkItemSource; label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "sprint_plan", label: "From Plan Doc" },
  { value: "agent_suggestion", label: "Suggested" },
  { value: "casey_audit", label: "Audit" },
];

function NewItemModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [workType, setWorkType] = useState<WorkType>("operations");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [source, setSource] = useState<WorkItemSource>("manual");
  // Phase 0.7: phase (sprint_number) is optional on ANY source, decoupled from it.
  const [sprintNumber, setSprintNumber] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!title.trim()) return;
    setErr(null);

    // Phase is optional. If supplied it must be a positive integer.
    let sprintNumberParsed: number | null = null;
    const sprintRaw = sprintNumber.trim();
    if (sprintRaw) {
      const n = parseInt(sprintRaw, 10);
      if (!Number.isInteger(n) || n <= 0) {
        setErr("Phase must be a positive integer (or left blank).");
        return;
      }
      sprintNumberParsed = n;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/work", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          work_type: workType,
          priority,
          status: "inbox",
          source,
          ...(sprintNumberParsed !== null && { sprint_number: sprintNumberParsed }),
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 150)}`);
      }
      onCreated();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Create failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-xl">
        <div className="px-4 py-3 border-b border-brand-border flex items-center justify-between">
          <h3 className="font-semibold text-brand-black text-sm">New work item</h3>
          <button onClick={onClose} className="text-brand-muted hover:text-brand-black text-lg leading-none">×</button>
        </div>
        <div className="p-4 space-y-3">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="w-full rounded border border-brand-border px-2 py-1.5 text-sm"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="Description (optional)"
            className="w-full rounded border border-brand-border px-2 py-1.5 text-xs"
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[10px] uppercase text-brand-muted mb-1">Type</div>
              <select
                value={workType}
                onChange={(e) => setWorkType(e.target.value as WorkType)}
                className="w-full rounded border border-brand-border px-2 py-1 text-xs"
              >
                {WORK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <div className="text-[10px] uppercase text-brand-muted mb-1">Priority</div>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className="w-full rounded border border-brand-border px-2 py-1 text-xs"
              >
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <div className="text-[10px] uppercase text-brand-muted mb-1">Source</div>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as WorkItemSource)}
                className="w-full rounded border border-brand-border px-2 py-1 text-xs"
              >
                {CREATE_SOURCE_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <div className="text-[10px] uppercase text-brand-muted mb-1">
                Phase <span className="text-brand-muted normal-case">(optional)</span>
              </div>
              <input
                type="number"
                min={1}
                step={1}
                value={sprintNumber}
                onChange={(e) => setSprintNumber(e.target.value)}
                placeholder="e.g. 1"
                className="w-full rounded border border-brand-border px-2 py-1 text-xs"
              />
            </div>
          </div>
          {err && <div className="text-xs text-red-700">{err}</div>}
        </div>
        <div className="px-4 py-3 border-t border-brand-border flex justify-end gap-2">
          <button onClick={onClose} className="text-xs px-3 py-1 hover:bg-brand-cream rounded">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!title.trim() || saving}
            className={clsx(
              "rounded bg-brand-orange text-white text-xs px-3 py-1.5",
              saving && "opacity-60",
            )}
          >
            {saving ? "Saving…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
