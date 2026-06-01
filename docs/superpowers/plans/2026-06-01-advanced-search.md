# Advanced Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a slide-over Advanced Search drawer on `/work` that queries the entire `work_items` table by keyword + agent/type/priority/source/phase/status + a pick-field date range, with paginated results (50 + Load more) that open the existing detail view.

**Architecture:** New `GET /api/work/search` endpoint builds one PostgREST query (multi-value `in`, phase-bucket/agent/keyword `or`, date range on a chosen field, exact count + `range` pagination). Shared filter constants are extracted to `work-constants.ts` so the new drawer reuses them without duplication; the board's interactive `MultiSelect` is left untouched. A self-contained `AdvancedSearchDrawer` component holds local filter state and renders results; a header button on `/work` toggles it.

**Tech Stack:** Next.js 16 App Router route handler + client component, Supabase (`supabaseAdmin` server-side, PostgREST), TypeScript, Tailwind. No test runner — verify via `tsc --noEmit`, `npm run build`, `curl`.

**Spec:** `docs/superpowers/specs/2026-06-01-advanced-search-design.md`

**Commit/push policy:** small local commits per task on `main`; single `git push` gated to the final task after `tsc` + build pass.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/app/api/work/search/route.ts` | Create | The search query builder + pagination |
| `src/components/work/work-constants.ts` | Create | Shared option arrays + status maps + `ItemTypeFilter` |
| `src/app/(dashboard)/work/page.tsx` | Modify (~21-70 + imports + header) | Import shared constants; add Advanced Search button + drawer mount |
| `src/components/work/AdvancedSearchDrawer.tsx` | Create | The drawer: filter form + results + pagination |

---

## Task 1: Search endpoint

**Files:**
- Create: `src/app/api/work/search/route.ts`

- [ ] **Step 1: Write the endpoint**

Create `src/app/api/work/search/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const PAGE_SIZE = 50;
const DATE_FIELDS = new Set(["created_at", "updated_at", "due_date"]);

function csv(v: string | null): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

// GET /api/work/search — full-table work_items search for the Advanced Search
// drawer. All params optional; default scope is "everything except archived".
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const q = (searchParams.get("q") ?? "").trim();
    const agents = csv(searchParams.get("agent"));
    const types = csv(searchParams.get("type"));
    const priorities = csv(searchParams.get("priority"));
    const sources = csv(searchParams.get("source"));
    const statuses = csv(searchParams.get("status"));
    const phases = csv(searchParams.get("phase"));
    const itemType = searchParams.get("itemType");
    const dateFieldRaw = searchParams.get("dateField") ?? "updated_at";
    const dateField = DATE_FIELDS.has(dateFieldRaw) ? dateFieldRaw : "updated_at";
    const from = (searchParams.get("from") ?? "").trim();
    const to = (searchParams.get("to") ?? "").trim();
    const includeArchived = searchParams.get("includeArchived") === "1";
    const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10) || 0);

    let query = supabaseAdmin.from("work_items").select("*", { count: "exact" });

    if (!includeArchived) query = query.eq("archived", false);

    if (itemType === "client") query = query.eq("work_item_type", "client");
    else if (itemType === "internal") query = query.eq("work_item_type", "internal");
    // "all"/absent → no work_item_type filter

    if (types.length) query = query.in("work_type", types);
    if (priorities.length) query = query.in("priority", priorities);
    if (sources.length) query = query.in("source", sources);
    if (statuses.length) query = query.in("status", statuses);

    // agent, honoring the "unassigned" sentinel
    const realAgents = agents.filter((a) => a !== "unassigned");
    const includeUnassigned = agents.includes("unassigned");
    if (realAgents.length && includeUnassigned) {
      query = query.or(`assigned_agent.in.(${realAgents.join(",")}),assigned_agent.is.null`);
    } else if (realAgents.length) {
      query = query.in("assigned_agent", realAgents);
    } else if (includeUnassigned) {
      query = query.is("assigned_agent", null);
    }

    // phase: integer buckets [N, N+1) plus the "none" (null) sentinel
    if (phases.length) {
      const clauses: string[] = [];
      for (const p of phases) {
        if (p === "none") { clauses.push("sprint_number.is.null"); continue; }
        const n = parseInt(p, 10);
        if (Number.isFinite(n)) clauses.push(`and(sprint_number.gte.${n},sprint_number.lt.${n + 1})`);
      }
      if (clauses.length) query = query.or(clauses.join(","));
    }

    // keyword across title/description/summary (sanitized for the or() grammar)
    if (q) {
      const safe = q.replace(/[(),%*]/g, " ").replace(/\s+/g, " ").trim();
      if (safe) {
        const pat = `%${safe}%`;
        query = query.or(`title.ilike.${pat},description.ilike.${pat},summary.ilike.${pat}`);
      }
    }

    // date range on the chosen field; date-only `to` is made inclusive
    if (from) query = query.gte(dateField, from);
    if (to) {
      const toVal = /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999Z` : to;
      query = query.lte(dateField, toVal);
    }

    query = query.order(dateField, { ascending: false }).range(offset, offset + PAGE_SIZE - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    return NextResponse.json({ items: data ?? [], total: count ?? 0, offset, limit: PAGE_SIZE });
  } catch (err) {
    console.error("Work search error:", err);
    return NextResponse.json({ items: [], total: 0, offset: 0, limit: PAGE_SIZE }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /opt/rosenfelt/rosenfelt-dashboard && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/work/search/route.ts && git commit -m "feat(work): add /api/work/search endpoint"
```

---

## Task 2: Extract shared filter constants

**Files:**
- Create: `src/components/work/work-constants.ts`
- Modify: `src/app/(dashboard)/work/page.tsx` (delete local consts ~21-70; add import)

- [ ] **Step 1: Create the constants module**

Create `src/components/work/work-constants.ts` (verbatim move of the data from `page.tsx` lines 21-70, with `export`):

```ts
import type {
  AgentName,
  TaskPriority,
  WorkItemSource,
  WorkItemType,
  WorkStatus,
  WorkType,
} from "@/types";

export const WORK_TYPES: WorkType[] = [
  "infrastructure", "agent", "dashboard", "content",
  "website", "operations", "business", "workflow",
];

export const AGENT_FILTER_OPTIONS: (AgentName | "unassigned")[] = [
  "riley", "jordan", "avery", "casey", "brian", "unassigned",
];

export const PRIORITIES: TaskPriority[] = ["high", "medium", "low"];

export const SOURCES: WorkItemSource[] = [
  "manual", "casey_audit", "sprint_plan", "sprint",
  "agent_suggestion", "backlog_migration", "typeform", "stripe",
];

export const ITEM_TYPES: WorkItemType[] = ["internal", "client"];
export type ItemTypeFilter = WorkItemType | "all";
export const ITEM_TYPE_FILTERS: ItemTypeFilter[] = ["internal", "client", "all"];

export const STATUS_PILL: Record<WorkStatus, string> = {
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

export const STATUS_LABEL: Record<WorkStatus, string> = {
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

export const ALL_STATUSES: WorkStatus[] = [
  "inbox", "approved", "prompt_ready", "in_progress",
  "open", "on_hold", "done", "deferred", "cancelled", "rejected",
];
```

- [ ] **Step 2: Delete the moved consts from page.tsx and import them**

In `src/app/(dashboard)/work/page.tsx`, delete the local declarations of
`WORK_TYPES`, `AGENT_FILTER_OPTIONS`, `PRIORITIES`, `SOURCES`, `ITEM_TYPES`,
`ItemTypeFilter` (type), `ITEM_TYPE_FILTERS`, `STATUS_PILL`, `STATUS_LABEL`,
`ALL_STATUSES` (the block spanning the current lines 21-70). **Keep**
`DEFAULT_VISIBLE`, `TRANSITIONS`, `COLUMNS_STORAGE_KEY`, `FILTERS_SESSION_KEY`,
`PRIORITY_ORDER`, and everything else.

Add an import (after the existing `@/components/work/...` imports near the top):

```ts
import {
  WORK_TYPES,
  AGENT_FILTER_OPTIONS,
  PRIORITIES,
  SOURCES,
  ITEM_TYPE_FILTERS,
  STATUS_PILL,
  STATUS_LABEL,
  ALL_STATUSES,
  type ItemTypeFilter,
} from "@/components/work/work-constants";
```

(`ITEM_TYPES` is unused in page.tsx — do not import it there. `PHASE_NONE` /
`phaseBucket` stay defined in page.tsx, untouched.)

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: exit 0. (If it reports an unused or missing symbol, reconcile the
import list with what page.tsx actually references.)

- [ ] **Step 4: Commit**

```bash
git add src/components/work/work-constants.ts "src/app/(dashboard)/work/page.tsx" \
  && git commit -m "refactor(work): extract shared filter constants"
```

---

## Task 3: AdvancedSearchDrawer component

**Files:**
- Create: `src/components/work/AdvancedSearchDrawer.tsx`

- [ ] **Step 1: Write the drawer**

Create `src/components/work/AdvancedSearchDrawer.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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

  function buildParams(nextOffset: number): string {
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

  async function runSearch(nextOffset: number) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/work/search?${buildParams(nextOffset)}`);
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

  if (!open) return null;

  const canLoadMore = results.length < total;
  const dateValue = (it: WorkItem) => (it[dateField] ?? "").slice(0, 10) || "—";

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-brand-border">
          <h2 className="text-sm font-semibold text-brand-black">Advanced Search</h2>
          <button onClick={onClose} className="text-brand-muted hover:text-brand-black text-lg leading-none">✕</button>
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
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: exit 0. (Note: `it[dateField]` indexes `WorkItem` by a `DateField`
union — all three keys (`created_at`/`updated_at`/`due_date`) exist on
`WorkItem`, so the index is type-safe.)

- [ ] **Step 3: Commit**

```bash
git add src/components/work/AdvancedSearchDrawer.tsx \
  && git commit -m "feat(work): AdvancedSearchDrawer (filters + results + load more)"
```

---

## Task 4: Wire the button into the /work header

**Files:**
- Modify: `src/app/(dashboard)/work/page.tsx` (import drawer; add state + button + mount)

- [ ] **Step 1: Import the drawer**

Add near the other `@/components/work/...` imports:

```ts
import { AdvancedSearchDrawer } from "@/components/work/AdvancedSearchDrawer";
```

- [ ] **Step 2: Add open state**

In `WorkPageInner`, alongside the other `useState` hooks (e.g. near
`const [newItemOpen, setNewItemOpen] = useState(false);`), add:

```ts
  const [advancedOpen, setAdvancedOpen] = useState(false);
```

- [ ] **Step 3: Add the header button**

Find the header action button(s) on the page (the "New item" button near the
top of the returned JSX). Immediately before the "New item" button, add:

```tsx
          <button
            onClick={() => setAdvancedOpen(true)}
            className="rounded border border-brand-border bg-white text-xs px-3 py-1.5 text-brand-black hover:bg-brand-cream"
          >
            ⌕ Advanced Search
          </button>
```

(If the buttons are wrapped in a flex container, place it as the first child so
it sits left of "New item".)

- [ ] **Step 4: Mount the drawer**

Near the bottom of the returned JSX, alongside `{newItemOpen && (<NewItemModal …/>)}`, add:

```tsx
      <AdvancedSearchDrawer open={advancedOpen} onClose={() => setAdvancedOpen(false)} />
```

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/work/page.tsx" \
  && git commit -m "feat(work): add Advanced Search button + drawer mount"
```

---

## Task 5: Build, verify, deploy

**Files:** none (verification + deploy)

- [ ] **Step 1: Production build**

Pull env, build, delete env:
```bash
cd /opt/rosenfelt/rosenfelt-dashboard
vercel env pull .env.local --environment=production --yes >/dev/null 2>&1
npm run build
git checkout -- .gitignore 2>/dev/null; rm -f .env.local
```
Expected: build exit 0.

- [ ] **Step 2: Endpoint smoke test (authenticated session or Vercel preview)**

Representative probes (auth-gated — run against an authenticated dev server or
the deployed preview):
```bash
curl -s "http://localhost:3000/api/work/search?status=done&dateField=updated_at&from=2026-05-01" | python3 -c "import sys,json;d=json.load(sys.stdin);print('total',d['total'],'items',len(d['items']))"
curl -s "http://localhost:3000/api/work/search?phase=1,5&offset=0" | python3 -c "import sys,json;d=json.load(sys.stdin);print('total',d['total'])"
curl -s "http://localhost:3000/api/work/search?includeArchived=1&offset=50" | python3 -c "import sys,json;d=json.load(sys.stdin);print('total',d['total'],'offset',d['offset'])"
```
Expected: each returns a JSON object with `total` ≥ 0 and `items` ≤ 50.

- [ ] **Step 3: Push to deploy**

```bash
git push origin main
```

- [ ] **Step 4: Confirm deploy + UI check**

Poll `vercel inspect dashboard.rosably.com` until the new deploy is `Ready` and
recent. In the browser at `/work`: click "⌕ Advanced Search" → set a couple of
filters → Search → results list with `#ref` rows; click a row → opens
`/work/<ref>`; if >50 matches, "Load more" appends.

---

## Self-Review Notes

- **Spec coverage:** endpoint with all params + defaults (Task 1), shared
  constants (Task 2), drawer with all fields + pagination + result rows linking
  via `ref` (Task 3), header wire-in (Task 4), build/verify/deploy (Task 5).
- **No placeholders:** full code for the endpoint and the drawer.
- **Type consistency:** `DateField` union keys all exist on `WorkItem`;
  `SearchResponse` shape (`items/total/offset/limit`) matches the endpoint's
  `NextResponse.json(...)`; `STATUS_PILL`/`STATUS_LABEL` are `Record<WorkStatus,…>`
  and indexed with `it.status`/`s as WorkStatus`; `item.ref` exists (friendly-IDs
  shipped). The drawer re-declares a local `PHASE_NONE = "none"` matching the
  endpoint's `"none"` sentinel.
- **Isolation:** board's `MultiSelect`/`PhaseMultiSelect` untouched; only pure
  constants moved out of `page.tsx`.
