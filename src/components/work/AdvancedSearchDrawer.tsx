"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { AgentBadge } from "@/components/AgentBadge";
import type { AgentName, WorkItem, WorkStatus } from "@/types";
import {
  WORK_TYPES,
  AGENT_FILTER_OPTIONS,
  PRIORITIES,
  SOURCES,
  ALL_STATUSES,
  STATUS_PILL,
  STATUS_LABEL,
} from "@/components/work/work-constants";

const PHASE_NONE = "none";
type DateField = "created_at" | "updated_at" | "due_date";
const DATE_FIELD_LABEL: Record<DateField, string> = {
  created_at: "Created",
  updated_at: "Updated",
  due_date: "Due",
};

// All drawer-owned URL keys. `as=1` is the open/auto-run flag; the rest carry
// state. Namespaced so they never collide with the board filter bar's params.
const AS_KEYS = [
  "as", "as_q", "as_agent", "as_type", "as_priority", "as_source",
  "as_status", "as_phase", "as_itemType", "as_dateField", "as_from", "as_to", "as_archived",
] as const;

// Self-contained checkbox dropdown (kept separate from the board's MultiSelect).
function DrawerMultiSelect({
  label,
  options,
  selected,
  onToggle,
  renderOption,
}: {
  label: string;
  options: readonly string[];
  selected: Set<string>;
  onToggle: (v: string) => void;
  renderOption?: (v: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const summary =
    selected.size === 0 ? "Any" : selected.size === 1 ? Array.from(selected)[0] : `${selected.size} selected`;
  return (
    <div className="relative">
      <div className="text-[11px] text-brand-muted mb-1">{label}</div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full rounded border border-brand-border bg-white text-xs px-2 py-1.5 text-left hover:bg-brand-cream flex items-center justify-between"
      >
        <span className="truncate text-brand-black">{summary}</span>
        <span className="text-brand-muted ml-1">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div className="absolute z-[61] mt-1 w-full bg-white border border-brand-border rounded shadow-md max-h-56 overflow-y-auto">
            {options.map((opt) => (
              <label
                key={opt}
                className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-brand-offwhite cursor-pointer"
              >
                <input type="checkbox" checked={selected.has(opt)} onChange={() => onToggle(opt)} />
                <span className="text-brand-black">{renderOption ? renderOption(opt) : opt}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

type SearchResponse = { items: WorkItem[]; total: number; offset: number; limit: number };

export function AdvancedSearchDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const sp = useSearchParams();

  const [q, setQ] = useState("");
  const [agents, setAgents] = useState<Set<string>>(new Set());
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [priorities, setPriorities] = useState<Set<string>>(new Set());
  const [sources, setSources] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Set<string>>(new Set());
  const [phases, setPhases] = useState<Set<string>>(new Set());
  const [itemType, setItemType] = useState<"internal" | "client" | "all">("all");
  const [dateField, setDateField] = useState<DateField>("updated_at");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);

  const [phaseOptions, setPhaseOptions] = useState<number[]>([]);
  const [results, setResults] = useState<WorkItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Ensures the URL→state hydration + auto-run happens once per open, not on
  // every render (syncUrl mutates sp, which would otherwise re-trigger it).
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    fetch("/api/work/sprint-numbers")
      .then((r) => r.json())
      .then((d) => setPhaseOptions(Array.isArray(d) ? d : []))
      .catch(() => setPhaseOptions([]));
  }, [open]);

  function toggle(setter: React.Dispatch<React.SetStateAction<Set<string>>>, v: string) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  }

  // ── Search params from current state (for the /api/work/search call) ────────
  function apiParamsFromState(nextOffset: number): string {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (agents.size) p.set("agent", Array.from(agents).join(","));
    if (types.size) p.set("type", Array.from(types).join(","));
    if (priorities.size) p.set("priority", Array.from(priorities).join(","));
    if (sources.size) p.set("source", Array.from(sources).join(","));
    if (statuses.size) p.set("status", Array.from(statuses).join(","));
    if (phases.size) p.set("phase", Array.from(phases).join(","));
    if (itemType !== "all") p.set("itemType", itemType);
    p.set("dateField", dateField);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (includeArchived) p.set("includeArchived", "1");
    p.set("offset", String(nextOffset));
    return p.toString();
  }

  // ── Search params derived from the as_* URL values (for auto-run on load) ───
  function apiParamsFromUrl(nextOffset: number): string {
    const p = new URLSearchParams();
    const pairs: [string, string][] = [
      ["as_q", "q"], ["as_agent", "agent"], ["as_type", "type"],
      ["as_priority", "priority"], ["as_source", "source"],
      ["as_status", "status"], ["as_phase", "phase"],
    ];
    for (const [u, a] of pairs) {
      const v = sp.get(u);
      if (v) p.set(a, v);
    }
    const it = sp.get("as_itemType");
    if (it && it !== "all") p.set("itemType", it);
    p.set("dateField", sp.get("as_dateField") || "updated_at");
    const f = sp.get("as_from");
    if (f) p.set("from", f);
    const t = sp.get("as_to");
    if (t) p.set("to", t);
    if (sp.get("as_archived") === "1") p.set("includeArchived", "1");
    p.set("offset", String(nextOffset));
    return p.toString();
  }

  // ── Shareable URL (board params preserved, as_* refreshed from state) ───────
  function shareParams(): URLSearchParams {
    const next = new URLSearchParams(sp.toString());
    AS_KEYS.forEach((k) => next.delete(k));
    next.set("as", "1");
    if (q.trim()) next.set("as_q", q.trim());
    if (agents.size) next.set("as_agent", Array.from(agents).join(","));
    if (types.size) next.set("as_type", Array.from(types).join(","));
    if (priorities.size) next.set("as_priority", Array.from(priorities).join(","));
    if (sources.size) next.set("as_source", Array.from(sources).join(","));
    if (statuses.size) next.set("as_status", Array.from(statuses).join(","));
    if (phases.size) next.set("as_phase", Array.from(phases).join(","));
    if (itemType !== "all") next.set("as_itemType", itemType);
    if (dateField !== "updated_at") next.set("as_dateField", dateField);
    if (from) next.set("as_from", from);
    if (to) next.set("as_to", to);
    if (includeArchived) next.set("as_archived", "1");
    return next;
  }

  function syncUrl() {
    router.replace(`/work?${shareParams().toString()}`, { scroll: false });
  }

  function clearUrl() {
    const next = new URLSearchParams(sp.toString());
    AS_KEYS.forEach((k) => next.delete(k));
    const qs = next.toString();
    router.replace(qs ? `/work?${qs}` : "/work", { scroll: false });
  }

  async function fetchPage(apiQs: string, nextOffset: number) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/work/search?${apiQs}`);
      const data = (await res.json()) as SearchResponse;
      if (!res.ok) throw new Error("Search failed");
      setTotal(data.total);
      setOffset(nextOffset);
      setResults((prev) => (nextOffset === 0 ? data.items : [...prev, ...data.items]));
      setSearched(true);
    } catch {
      setError("Search failed. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function runSearch(nextOffset: number) {
    fetchPage(apiParamsFromState(nextOffset), nextOffset);
    if (nextOffset === 0) syncUrl();
  }

  async function copyLink() {
    const params = shareParams();
    router.replace(`/work?${params.toString()}`, { scroll: false });
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/work?${params.toString()}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable (insecure context) — the URL bar still reflects state
    }
  }

  function handleClose() {
    clearUrl();
    onClose();
  }

  function reset() {
    setQ("");
    setAgents(new Set());
    setTypes(new Set());
    setPriorities(new Set());
    setSources(new Set());
    setStatuses(new Set());
    setPhases(new Set());
    setItemType("all");
    setDateField("updated_at");
    setFrom("");
    setTo("");
    setIncludeArchived(false);
    setResults([]);
    setTotal(0);
    setOffset(0);
    setSearched(false);
    setError(null);
  }

  // Hydrate state + auto-run when opened from a shared `?as=1` link. Guarded so
  // it fires once per open (syncUrl mutates `sp` but must not re-trigger this).
  useEffect(() => {
    if (!open) {
      hydratedRef.current = false;
      return;
    }
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    if (sp.get("as") !== "1") return; // opened manually — start blank

    const setCsv = (key: string, setter: React.Dispatch<React.SetStateAction<Set<string>>>) => {
      const v = sp.get(key);
      setter(new Set(v ? v.split(",").filter(Boolean) : []));
    };
    setQ(sp.get("as_q") ?? "");
    setCsv("as_agent", setAgents);
    setCsv("as_type", setTypes);
    setCsv("as_priority", setPriorities);
    setCsv("as_source", setSources);
    setCsv("as_status", setStatuses);
    setCsv("as_phase", setPhases);
    const it = sp.get("as_itemType");
    setItemType(it === "internal" || it === "client" ? it : "all");
    const df = sp.get("as_dateField");
    setDateField(df === "created_at" || df === "due_date" ? df : "updated_at");
    setFrom(sp.get("as_from") ?? "");
    setTo(sp.get("as_to") ?? "");
    setIncludeArchived(sp.get("as_archived") === "1");

    fetchPage(apiParamsFromUrl(0), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sp]);

  if (!open) return null;

  const canLoadMore = results.length < total;
  const dateValue = (it: WorkItem) => (it[dateField] ?? "").slice(0, 10) || "—";

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={handleClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-brand-border">
          <h2 className="text-sm font-semibold text-brand-black">Advanced Search</h2>
          <button onClick={handleClose} className="text-brand-muted hover:text-brand-black text-lg leading-none">✕</button>
        </div>

        {/* Form */}
        <div className="px-4 py-3 space-y-3 overflow-y-auto border-b border-brand-border">
          <div>
            <div className="text-[11px] text-brand-muted mb-1">Keyword</div>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runSearch(0); }}
              placeholder="title / description / summary"
              className="w-full rounded border border-brand-border text-xs px-2 py-1.5 focus:outline-none focus:border-brand-orange"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <DrawerMultiSelect label="Agent" options={AGENT_FILTER_OPTIONS as readonly string[]} selected={agents} onToggle={(v) => toggle(setAgents, v)} />
            <DrawerMultiSelect label="Type" options={WORK_TYPES as readonly string[]} selected={types} onToggle={(v) => toggle(setTypes, v)} />
            <DrawerMultiSelect label="Priority" options={PRIORITIES as readonly string[]} selected={priorities} onToggle={(v) => toggle(setPriorities, v)} />
            <DrawerMultiSelect label="Source" options={SOURCES as readonly string[]} selected={sources} onToggle={(v) => toggle(setSources, v)} />
            <DrawerMultiSelect label="Status" options={ALL_STATUSES as readonly string[]} selected={statuses} onToggle={(v) => toggle(setStatuses, v)} renderOption={(s) => STATUS_LABEL[s as WorkStatus]} />
            <DrawerMultiSelect
              label="Phase"
              options={[PHASE_NONE, ...phaseOptions.map(String)]}
              selected={phases}
              onToggle={(v) => toggle(setPhases, v)}
              renderOption={(v) => (v === PHASE_NONE ? "None" : `Phase ${v}`)}
            />
          </div>

          <div>
            <div className="text-[11px] text-brand-muted mb-1">Item type</div>
            <div className="inline-flex items-center gap-1 rounded border border-brand-border bg-white p-0.5">
              {(["all", "internal", "client"] as const).map((opt) => (
                <button
                  key={opt}
                  onClick={() => setItemType(opt)}
                  className={clsx(
                    "text-xs px-3 py-1 rounded capitalize transition-colors",
                    itemType === opt ? "bg-brand-orange text-white" : "text-brand-muted hover:bg-brand-cream",
                  )}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[11px] text-brand-muted mb-1">Date</div>
            <div className="flex items-center gap-2">
              <select
                value={dateField}
                onChange={(e) => setDateField(e.target.value as DateField)}
                className="rounded border border-brand-border text-xs px-2 py-1.5 bg-white"
              >
                {(Object.keys(DATE_FIELD_LABEL) as DateField[]).map((f) => (
                  <option key={f} value={f}>{DATE_FIELD_LABEL[f]}</option>
                ))}
              </select>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border border-brand-border text-xs px-2 py-1.5" />
              <span className="text-brand-muted text-xs">–</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded border border-brand-border text-xs px-2 py-1.5" />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-brand-black cursor-pointer">
            <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
            Include archived
          </label>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => runSearch(0)}
              disabled={loading}
              className="rounded bg-brand-orange text-white text-xs px-4 py-1.5 hover:opacity-90 disabled:opacity-50"
            >
              {loading && offset === 0 ? "Searching…" : "Search"}
            </button>
            <button
              onClick={copyLink}
              disabled={!searched}
              title={searched ? "Copy a shareable link to this search" : "Run a search first"}
              className="rounded border border-brand-border text-xs px-3 py-1.5 text-brand-black hover:bg-brand-cream disabled:opacity-50"
            >
              {copied ? "Copied!" : "Copy link"}
            </button>
            <button onClick={reset} className="text-xs text-brand-muted hover:text-brand-black">Reset</button>
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {error && <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded px-3 py-2 mb-2">{error}</div>}
          {searched && (
            <div className="text-[11px] text-brand-muted mb-2">{total} result{total === 1 ? "" : "s"}</div>
          )}
          {searched && results.length === 0 && !loading && (
            <div className="text-xs text-brand-muted">No items match.</div>
          )}
          <div className="space-y-1.5">
            {results.map((it) => (
              <Link
                key={it.id}
                href={`/work/${it.ref}`}
                className="block rounded border border-brand-border px-3 py-2 hover:border-brand-orange/40 hover:shadow-sm transition"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-brand-muted shrink-0">#{it.ref}</span>
                  <span className="flex-1 min-w-0 truncate text-sm text-brand-black">{it.title}</span>
                  <span className={clsx("shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium", STATUS_PILL[it.status])}>
                    {STATUS_LABEL[it.status]}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1 text-[10px] text-brand-muted">
                  {it.assigned_agent && <AgentBadge agent={it.assigned_agent as AgentName} size="sm" />}
                  <span className="capitalize">{it.priority}</span>
                  <span>·</span>
                  <span>{it.sprint_number == null ? "no phase" : `Phase ${Math.floor(it.sprint_number)}`}</span>
                  <span>·</span>
                  <span>{dateValue(it)}</span>
                </div>
              </Link>
            ))}
          </div>
          {searched && canLoadMore && (
            <button
              onClick={() => runSearch(offset + 50)}
              disabled={loading}
              className="mt-3 w-full rounded border border-brand-border text-xs py-2 text-brand-black hover:bg-brand-cream disabled:opacity-50"
            >
              {loading ? "Loading…" : `Load more (${results.length} of ${total})`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
