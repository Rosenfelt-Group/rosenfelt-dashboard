"use client";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { supabase } from "@/lib/supabase";
import { AgentBadge } from "@/components/AgentBadge";
import { WorkItem, WorkStatus, WorkType, AgentName, TaskPriority, Agent } from "@/types";

// ─── Constants ───────────────────────────────────────────────────────────────

const WORK_TYPES: WorkType[] = [
  "infrastructure", "agent", "dashboard", "content",
  "website", "operations", "business", "workflow",
];

const AGENTS: AgentName[] = ["riley", "jordan", "avery", "casey", "brian"];

const PRIORITIES: TaskPriority[] = ["high", "medium", "low"];

const WORK_TYPE_STYLES: Record<WorkType, string> = {
  infrastructure: "bg-gray-100 text-gray-700",
  agent:          "bg-amber-100 text-amber-700",
  dashboard:      "bg-blue-100 text-blue-700",
  content:        "bg-teal-100 text-teal-700",
  website:        "bg-purple-100 text-purple-700",
  operations:     "bg-slate-100 text-slate-700",
  business:       "bg-orange-100 text-orange-700",
  workflow:       "bg-indigo-100 text-indigo-700",
};

const PRIORITY_DOT: Record<TaskPriority, string> = {
  high:   "bg-red-500",
  medium: "bg-amber-400",
  low:    "bg-gray-300",
};

const STATUS_PILL: Record<WorkStatus, string> = {
  inbox:        "bg-gray-100 text-gray-700",
  approved:     "bg-blue-100 text-blue-700",
  prompt_ready: "bg-violet-100 text-violet-700",
  in_progress:  "bg-amber-100 text-amber-700",
  open:         "bg-slate-100 text-slate-700",
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
  done:         "Done",
  deferred:     "Deferred",
  cancelled:    "Cancelled",
  rejected:     "Rejected",
};

const ALL_STATUSES: WorkStatus[] = [
  "inbox", "approved", "prompt_ready", "in_progress",
  "open", "done", "deferred", "cancelled", "rejected",
];

const TRANSITIONS: Record<WorkStatus, WorkStatus[]> = {
  inbox:        ["approved", "deferred", "cancelled"],
  approved:     ["prompt_ready", "inbox", "deferred", "cancelled"],
  prompt_ready: ["in_progress", "approved", "cancelled"],
  in_progress:  ["done", "open", "prompt_ready", "cancelled"],
  open:         ["in_progress", "done", "deferred", "cancelled"],
  deferred:     ["inbox", "cancelled"],
  done:         ["inbox"],
  cancelled:    ["inbox"],
  rejected:     ["inbox"],
};

// ─── Panel classification ────────────────────────────────────────────────────

type Panel = "pipeline" | "active" | "needs_brian";

function classify(item: WorkItem): Panel | null {
  if (item.archived) return null;
  if (item.assigned_agent === "brian" || item.status === "deferred") return "needs_brian";
  if (item.status === "in_progress" || item.status === "open") return "active";
  if (["inbox", "approved", "prompt_ready"].includes(item.status)) return "pipeline";
  return null;
}

function sortByPriorityThenUpdated(a: WorkItem, b: WorkItem) {
  const order: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };
  const pa = order[a.priority] ?? 1;
  const pb = order[b.priority] ?? 1;
  if (pa !== pb) return pa - pb;
  return b.updated_at.localeCompare(a.updated_at);
}

// ─── Filter helpers ──────────────────────────────────────────────────────────

type Filters = {
  work_type: WorkType | "";
  assigned_agent: AgentName | "";
  priority: TaskPriority | "";
  search: string;
  showArchived: boolean;
};

function buildFilters(sp: URLSearchParams): Filters {
  return {
    work_type:      (sp.get("type") as WorkType) || "",
    assigned_agent: (sp.get("agent") as AgentName) || "",
    priority:       (sp.get("priority") as TaskPriority) || "",
    search:         sp.get("q") || "",
    showArchived:   sp.get("archived") === "1",
  };
}

function matchesFilters(item: WorkItem, f: Filters): boolean {
  if (f.work_type && item.work_type !== f.work_type) return false;
  if (f.assigned_agent && item.assigned_agent !== f.assigned_agent) return false;
  if (f.priority && item.priority !== f.priority) return false;
  if (f.search.trim()) {
    const q = f.search.trim().toLowerCase();
    if (!item.title.toLowerCase().includes(q)) return false;
  }
  return true;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function WorkPage() {
  return (
    <Suspense fallback={<div className="p-4 md:p-6" />}>
      <WorkPageInner />
    </Suspense>
  );
}

function WorkPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filters = useMemo(() => buildFilters(new URLSearchParams(searchParams.toString())), [searchParams]);

  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  // Initial fetch
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/work?archived=false");
        const data = await res.json();
        if (!cancelled) setItems(data);
      } catch (err) {
        console.error("Failed to load work items", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // If user toggles "show archived", refetch including archived
  useEffect(() => {
    if (!filters.showArchived) return;
    (async () => {
      try {
        const res = await fetch("/api/work");
        const data = await res.json();
        setItems(data);
      } catch (err) {
        console.error("Failed to refetch with archived", err);
      }
    })();
  }, [filters.showArchived]);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel("work-items-changes")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "work_items" }, (payload) => {
        const newItem = payload.new as WorkItem;
        setItems(prev => {
          if (prev.some(i => i.id === newItem.id)) return prev;
          return [newItem, ...prev];
        });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "work_items" }, (payload) => {
        const updated = payload.new as WorkItem;
        setItems(prev => prev.map(i => i.id === updated.id ? { ...i, ...updated } : i));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "work_items" }, (payload) => {
        const deleted = payload.old as { id: string };
        setItems(prev => prev.filter(i => i.id !== deleted.id));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // URL update helper
  const updateFilter = useCallback((key: string, value: string) => {
    const sp = new URLSearchParams(searchParams.toString());
    if (value) sp.set(key, value);
    else sp.delete(key);
    router.replace(`/work?${sp.toString()}`, { scroll: false });
  }, [router, searchParams]);

  const toggleArchived = useCallback(() => {
    const sp = new URLSearchParams(searchParams.toString());
    if (filters.showArchived) sp.delete("archived");
    else sp.set("archived", "1");
    router.replace(`/work?${sp.toString()}`, { scroll: false });
  }, [filters.showArchived, router, searchParams]);

  // Optimistic update for any field change
  const patchItem = useCallback(async (id: string, updates: Partial<WorkItem>) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...updates } as WorkItem : i));
    try {
      const res = await fetch(`/api/work/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setItems(prev => prev.map(i => i.id === id ? data : i));
    } catch (err) {
      console.error("Failed to patch work item", err);
      // Realtime will eventually correct the optimistic update
    }
  }, []);

  const visible = useMemo(
    () => items.filter(i => matchesFilters(i, filters)),
    [items, filters],
  );

  const pipeline = visible.filter(i => classify(i) === "pipeline").sort(sortByPriorityThenUpdated);
  const active = visible.filter(i => classify(i) === "active").sort(sortByPriorityThenUpdated);
  const needsBrian = visible.filter(i => classify(i) === "needs_brian").sort(sortByPriorityThenUpdated);
  const archived = visible.filter(i => i.archived)
    .sort((a, b) => (b.archived_at ?? "").localeCompare(a.archived_at ?? ""));

  const selected = items.find(i => i.id === selectedId) ?? null;

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto">
      <header className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold text-brand-black">Work</h1>
          <p className="text-xs text-brand-muted mt-0.5">
            {visible.filter(i => !i.archived).length} active · {archived.length} archived
          </p>
        </div>
      </header>

      {/* Filter bar */}
      <div className="sticky top-0 z-10 bg-brand-offwhite/80 backdrop-blur py-2 mb-4 flex flex-wrap items-center gap-2 border-b border-brand-border">
        <FilterSelect
          value={filters.work_type}
          options={WORK_TYPES}
          onChange={v => updateFilter("type", v)}
          placeholder="All types"
        />
        <FilterSelect
          value={filters.assigned_agent}
          options={AGENTS}
          onChange={v => updateFilter("agent", v)}
          placeholder="All agents"
        />
        <FilterSelect
          value={filters.priority}
          options={PRIORITIES}
          onChange={v => updateFilter("priority", v)}
          placeholder="All priorities"
        />
        <input
          type="search"
          value={filters.search}
          onChange={e => updateFilter("q", e.target.value)}
          placeholder="Search title…"
          className="text-xs border border-brand-border rounded-md px-2 py-1.5 focus:outline-none focus:border-brand-orange bg-white w-44"
        />
        <button
          onClick={() => setShowNewForm(v => !v)}
          className="text-xs font-medium bg-brand-orange text-white rounded-md px-3 py-1.5 hover:bg-brand-orange-dark transition-colors"
        >
          + New item
        </button>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-brand-muted">
          <input
            type="checkbox"
            checked={filters.showArchived}
            onChange={toggleArchived}
            className="rounded border-brand-border"
          />
          Show archived
        </label>
      </div>

      {showNewForm && (
        <NewItemForm
          onClose={() => setShowNewForm(false)}
          onCreated={(item) => {
            setItems(prev => prev.some(i => i.id === item.id) ? prev : [item, ...prev]);
            setShowNewForm(false);
            setSelectedId(item.id);
          }}
        />
      )}

      {loading ? (
        <div className="text-sm text-brand-muted py-12 text-center">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Panel
            title="Pipeline"
            subtitle="Inbox · Approved · Prompt-ready"
            items={pipeline}
            onSelect={setSelectedId}
          />
          <Panel
            title="Active"
            subtitle="Agents are working these"
            items={active}
            onSelect={setSelectedId}
          />
          <Panel
            title="Needs Brian"
            subtitle="Assigned to you or deferred"
            items={needsBrian}
            onSelect={setSelectedId}
          />
        </div>
      )}

      {filters.showArchived && (
        <ArchivedSection items={archived} onSelect={setSelectedId} />
      )}

      {selected && (
        <DetailSlideOver
          item={selected}
          onClose={() => setSelectedId(null)}
          onPatch={patchItem}
          onDelete={async (id) => {
            const res = await fetch(`/api/work/${id}`, { method: "DELETE" });
            if (res.ok) {
              setItems(prev => prev.filter(i => i.id !== id));
              setSelectedId(null);
            }
          }}
        />
      )}
    </div>
  );
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

function FilterSelect<T extends string>({ value, options, onChange, placeholder }: {
  value: T | "";
  options: T[];
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-xs border border-brand-border rounded-md px-2 py-1.5 bg-white focus:outline-none focus:border-brand-orange"
    >
      <option value="">{placeholder}</option>
      {options.map(o => (
        <option key={o} value={o}>{o.replace(/_/g, " ")}</option>
      ))}
    </select>
  );
}

function Panel({ title, subtitle, items, onSelect }: {
  title: string;
  subtitle: string;
  items: WorkItem[];
  onSelect: (id: string) => void;
}) {
  return (
    <section className="bg-white border border-brand-border rounded-lg overflow-hidden flex flex-col">
      <header className="px-4 py-3 border-b border-brand-border">
        <h2 className="text-sm font-semibold text-brand-black">{title}</h2>
        <p className="text-[11px] text-brand-muted">{subtitle} · {items.length}</p>
      </header>
      <div className="flex-1 p-2 space-y-2 min-h-[200px]">
        {items.length === 0 ? (
          <p className="text-xs text-brand-muted text-center py-8">Nothing here</p>
        ) : (
          items.map(i => <Card key={i.id} item={i} onClick={() => onSelect(i.id)} />)
        )}
      </div>
    </section>
  );
}

function Card({ item, onClick }: { item: WorkItem; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-brand-offwhite border border-brand-border rounded-md p-3 hover:border-brand-orange transition-colors"
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className={clsx("text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide font-medium", WORK_TYPE_STYLES[item.work_type])}>
          {item.work_type}
        </span>
        <span className={clsx("w-2 h-2 rounded-full", PRIORITY_DOT[item.priority])} title={item.priority} />
        {item.assigned_agent && <AgentBadge agent={item.assigned_agent as Agent} size="sm" />}
      </div>
      <div className="text-sm font-medium text-brand-black leading-snug line-clamp-2">
        {item.title}
      </div>
      {(item.description || item.summary) && (
        <div className="text-xs text-brand-muted mt-1 line-clamp-1">
          {item.description || item.summary}
        </div>
      )}
      <div className="flex items-center gap-2 mt-2">
        <span className={clsx("text-[10px] px-1.5 py-0.5 rounded font-medium", STATUS_PILL[item.status])}>
          {STATUS_LABEL[item.status]}
        </span>
        {item.due_date && (
          <span className="text-[10px] text-brand-muted">due {item.due_date}</span>
        )}
      </div>
    </button>
  );
}

function ArchivedSection({ items, onSelect }: {
  items: WorkItem[];
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="mt-6 bg-white border border-brand-border rounded-lg">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-brand-offwhite/50 transition-colors"
      >
        <span className="text-sm font-semibold text-brand-black">
          {open ? "▼" : "▶"} Archived ({items.length})
        </span>
        <span className="text-xs text-brand-muted">done · cancelled · rejected</span>
      </button>
      {open && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 p-3 border-t border-brand-border">
          {items.map(i => <Card key={i.id} item={i} onClick={() => onSelect(i.id)} />)}
        </div>
      )}
    </section>
  );
}

function NewItemForm({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (item: WorkItem) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [workType, setWorkType] = useState<WorkType>("operations");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [agent, setAgent] = useState<AgentName | "">("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!title.trim()) return;
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
          assigned_agent: agent || null,
          status: "inbox",
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data: WorkItem = await res.json();
      onCreated(data);
    } catch (err) {
      console.error("Failed to create work item", err);
      setSaving(false);
    }
  }

  return (
    <div className="bg-white border border-brand-orange rounded-lg p-4 mb-4 space-y-3">
      <input
        autoFocus
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Title*"
        className="w-full text-sm border border-brand-border rounded-md px-3 py-2 focus:outline-none focus:border-brand-orange"
      />
      <div className="flex flex-wrap gap-2">
        <select
          value={workType}
          onChange={e => setWorkType(e.target.value as WorkType)}
          className="text-xs border border-brand-border rounded-md px-2 py-1.5 bg-white"
        >
          {WORK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={priority}
          onChange={e => setPriority(e.target.value as TaskPriority)}
          className="text-xs border border-brand-border rounded-md px-2 py-1.5 bg-white"
        >
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select
          value={agent}
          onChange={e => setAgent(e.target.value as AgentName | "")}
          className="text-xs border border-brand-border rounded-md px-2 py-1.5 bg-white"
        >
          <option value="">Unassigned</option>
          {AGENTS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
      <textarea
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Description (optional)"
        rows={2}
        className="w-full text-sm border border-brand-border rounded-md px-3 py-2 focus:outline-none focus:border-brand-orange"
      />
      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          className="text-xs px-3 py-1.5 text-brand-muted hover:text-brand-black"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={saving || !title.trim()}
          className="text-xs font-medium bg-brand-orange text-white rounded-md px-3 py-1.5 hover:bg-brand-orange-dark transition-colors disabled:opacity-50"
        >
          {saving ? "Creating…" : "Create item"}
        </button>
      </div>
    </div>
  );
}

function DetailSlideOver({ item, onClose, onPatch, onDelete }: {
  item: WorkItem;
  onClose: () => void;
  onPatch: (id: string, updates: Partial<WorkItem>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description ?? "");
  const [prompt, setPrompt] = useState(item.prompt ?? "");
  const [archNotes, setArchNotes] = useState(item.arch_notes ?? "");
  const [showLegacy, setShowLegacy] = useState(false);

  useEffect(() => {
    setTitle(item.title);
    setDescription(item.description ?? "");
    setPrompt(item.prompt ?? "");
    setArchNotes(item.arch_notes ?? "");
  }, [item.id, item.title, item.description, item.prompt, item.arch_notes]);

  const allowedTransitions = TRANSITIONS[item.status] ?? [];
  const statusOptions = Array.from(new Set([item.status, ...allowedTransitions, ...ALL_STATUSES]));

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="bg-white w-full md:w-[480px] h-full overflow-y-auto shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <header className="sticky top-0 bg-white border-b border-brand-border px-5 py-3 flex items-center justify-between z-10">
          <h2 className="text-sm font-semibold text-brand-black">Work item</h2>
          <button onClick={onClose} className="text-brand-muted hover:text-brand-black text-xl leading-none">×</button>
        </header>

        <div className="p-5 space-y-4">
          {/* Title */}
          <Field label="Title">
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={() => { if (title.trim() && title !== item.title) onPatch(item.id, { title: title.trim() }); }}
              className="w-full text-sm font-medium border border-brand-border rounded-md px-3 py-2 focus:outline-none focus:border-brand-orange"
            />
          </Field>

          {/* Status + meta selectors */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <select
                value={item.status}
                onChange={e => onPatch(item.id, { status: e.target.value as WorkStatus })}
                className="w-full text-xs border border-brand-border rounded-md px-2 py-1.5 bg-white"
              >
                {statusOptions.map(s => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
            </Field>
            <Field label="Priority">
              <select
                value={item.priority}
                onChange={e => onPatch(item.id, { priority: e.target.value as TaskPriority })}
                className="w-full text-xs border border-brand-border rounded-md px-2 py-1.5 bg-white"
              >
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Type">
              <select
                value={item.work_type}
                onChange={e => onPatch(item.id, { work_type: e.target.value as WorkType })}
                className="w-full text-xs border border-brand-border rounded-md px-2 py-1.5 bg-white"
              >
                {WORK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Assigned agent">
              <select
                value={item.assigned_agent ?? ""}
                onChange={e => onPatch(item.id, { assigned_agent: (e.target.value || null) as AgentName | null })}
                className="w-full text-xs border border-brand-border rounded-md px-2 py-1.5 bg-white"
              >
                <option value="">Unassigned</option>
                {AGENTS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </Field>
          </div>

          {/* Description */}
          <Field label="Description">
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              onBlur={() => { if (description !== (item.description ?? "")) onPatch(item.id, { description: description || null }); }}
              rows={4}
              className="w-full text-sm border border-brand-border rounded-md px-3 py-2 focus:outline-none focus:border-brand-orange"
              placeholder="What's this about?"
            />
          </Field>

          {/* Prompt */}
          <Collapsible label="Prompt" hasContent={!!item.prompt}>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onBlur={() => { if (prompt !== (item.prompt ?? "")) onPatch(item.id, { prompt: prompt || null }); }}
              rows={8}
              className="w-full text-xs font-mono border border-brand-border rounded-md px-3 py-2 focus:outline-none focus:border-brand-orange"
              placeholder="Claude Code / agent prompt…"
            />
          </Collapsible>

          {/* Arch notes */}
          <Collapsible label="Arch notes" hasContent={!!item.arch_notes}>
            <textarea
              value={archNotes}
              onChange={e => setArchNotes(e.target.value)}
              onBlur={() => { if (archNotes !== (item.arch_notes ?? "")) onPatch(item.id, { arch_notes: archNotes || null }); }}
              rows={4}
              className="w-full text-xs border border-brand-border rounded-md px-3 py-2 focus:outline-none focus:border-brand-orange"
              placeholder="Architecture / design notes"
            />
          </Collapsible>

          {/* Due date — Documents UI is mounted by Task 7.5 (WorkDocsPanel) */}
          <Field label="Due date">
            <input
              type="date"
              value={item.due_date ?? ""}
              onChange={e => onPatch(item.id, { due_date: e.target.value || null })}
              className="w-full text-xs border border-brand-border rounded-md px-2 py-1.5"
            />
          </Field>

          {/* Timestamps */}
          <div className="text-[11px] text-brand-muted space-y-0.5 border-t border-brand-border pt-3">
            <div>Created {fmt(item.created_at)}</div>
            <div>Updated {fmt(item.updated_at)}</div>
            {item.approved_at && <div>Approved {fmt(item.approved_at)}</div>}
            {item.prompt_ready_at && <div>Prompt-ready {fmt(item.prompt_ready_at)}</div>}
            {item.completed_at && <div>Completed {fmt(item.completed_at)}</div>}
            {item.archived_at && <div>Archived {fmt(item.archived_at)}</div>}
          </div>

          {/* Legacy linkage */}
          {(item.legacy_task_id || item.legacy_backlog_id) && (
            <div>
              <button
                onClick={() => setShowLegacy(s => !s)}
                className="text-[11px] text-brand-muted hover:text-brand-black"
              >
                {showLegacy ? "▼" : "▶"} Legacy IDs
              </button>
              {showLegacy && (
                <div className="text-[11px] text-brand-muted mt-1 space-y-0.5">
                  {item.legacy_task_id && <div>task: {item.legacy_task_id}</div>}
                  {item.legacy_backlog_id != null && <div>backlog: {item.legacy_backlog_id}</div>}
                </div>
              )}
            </div>
          )}

          {/* Danger zone */}
          <div className="border-t border-brand-border pt-4 flex justify-between items-center">
            <button
              onClick={() => onPatch(item.id, { archived: !item.archived })}
              className="text-xs text-brand-muted hover:text-brand-black"
            >
              {item.archived ? "Unarchive" : "Archive"}
            </button>
            <button
              onClick={() => {
                if (confirm("Permanently delete this work item?")) onDelete(item.id);
              }}
              className="text-xs text-red-600 hover:text-red-800"
            >
              Delete forever
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-brand-muted mb-1 uppercase tracking-wide">{label}</span>
      {children}
    </label>
  );
}

function Collapsible({ label, hasContent, children }: {
  label: string;
  hasContent: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(hasContent);
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="text-[11px] font-medium text-brand-muted mb-1 uppercase tracking-wide hover:text-brand-black"
      >
        {open ? "▼" : "▶"} {label}{hasContent && !open && " ●"}
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  );
}

function fmt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}
