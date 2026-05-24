"use client";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { supabase } from "@/lib/supabase";
import { KanbanColumn } from "@/components/work/KanbanColumn";
import { ConfigureColumnsMenu } from "@/components/work/ConfigureColumnsMenu";
import type {
  AgentName,
  TaskPriority,
  WorkItem,
  WorkItemSource,
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
  "manual", "casey_audit", "sprint_plan", "agent_suggestion", "backlog_migration",
];

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
};

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

function buildFilters(sp: URLSearchParams): Filters {
  return {
    agents: parseSetParam<AgentName | "unassigned">(sp.get("agent"), AGENT_FILTER_OPTIONS),
    workTypes: parseSetParam<WorkType>(sp.get("type"), WORK_TYPES),
    priorities: parseSetParam<TaskPriority>(sp.get("priority"), PRIORITIES),
    sources: parseSetParam<WorkItemSource>(sp.get("source"), SOURCES),
  };
}

function filtersToQuery(f: Filters): string {
  const sp = new URLSearchParams();
  if (f.agents.size) sp.set("agent", Array.from(f.agents).join(","));
  if (f.workTypes.size) sp.set("type", Array.from(f.workTypes).join(","));
  if (f.priorities.size) sp.set("priority", Array.from(f.priorities).join(","));
  if (f.sources.size) sp.set("source", Array.from(f.sources).join(","));
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

  // Persist filter snapshot for back-from-detail navigation.
  useEffect(() => {
    try {
      sessionStorage.setItem(FILTERS_SESSION_KEY, filtersToQuery(filters));
    } catch {
      // sessionStorage may be unavailable
    }
  }, [filters]);

  // Fetch items
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/work?archived=false");
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime updates on work_items: refetch (cheaper than reconciling)
  useEffect(() => {
    const channel = supabase
      .channel("work-items-kanban")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "work_items" },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

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
        load();
      }
    },
    [load],
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

  const visibleColumns = columnCfg.order.filter((s) => columnCfg.visible.includes(s));

  const activeFilterCount =
    filters.agents.size + filters.workTypes.size + filters.priorities.size + filters.sources.size;

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

      {/* Filter bar */}
      <FilterBar filters={filters} setFilters={setFilters} />

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
          <button
            onClick={() =>
              setFilters({
                agents: new Set(),
                workTypes: new Set(),
                priorities: new Set(),
                sources: new Set(),
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

      {/* Board */}
      {loading ? (
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
        <NewItemModal onClose={() => setNewItemOpen(false)} onCreated={load} />
      )}
    </div>
  );
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

function FilterBar({
  filters,
  setFilters,
}: {
  filters: Filters;
  setFilters: (next: Filters) => void;
}) {
  function toggle<T>(set: Set<T>, value: T): Set<T> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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

// ─── New item modal ──────────────────────────────────────────────────────────

function NewItemModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [workType, setWorkType] = useState<WorkType>("operations");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    setErr(null);
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
