// Filter, URL and sort helpers for the /work kanban board. Pure functions (no
// React) so they can be unit-tested in a node environment.
import {
  WORK_TYPES,
  AGENT_FILTER_OPTIONS,
  PRIORITIES,
  SOURCES,
  type ItemTypeFilter,
} from "@/components/work/work-constants";
import type {
  AgentName,
  TaskPriority,
  WorkItem,
  WorkItemSource,
  WorkStatus,
  WorkType,
} from "@/types";

// ─── Sorting ─────────────────────────────────────────────────────────────────

const PRIORITY_ORDER: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };

export function sortByPriorityThenUpdated(a: WorkItem, b: WorkItem) {
  const pa = PRIORITY_ORDER[a.priority] ?? 1;
  const pb = PRIORITY_ORDER[b.priority] ?? 1;
  if (pa !== pb) return pa - pb;
  return b.updated_at.localeCompare(a.updated_at);
}

// Natural compare for phase_step text ("1.6" < "1.10" < "2.0"). Splits on "."
// and compares each segment numerically so 1.10 sorts after 1.9 (a plain string
// or numeric compare would get this wrong). Nulls sort last.
export function comparePhaseStep(a: string | null | undefined, b: string | null | undefined): number {
  const sa = typeof a === "string" && a.trim() ? a.trim() : null;
  const sb = typeof b === "string" && b.trim() ? b.trim() : null;
  if (sa === null && sb === null) return 0;
  if (sa === null) return 1;
  if (sb === null) return -1;
  const pa = sa.split(".");
  const pb = sb.split(".");
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = parseInt(pa[i] ?? "0", 10);
    const nb = parseInt(pb[i] ?? "0", 10);
    if (Number.isNaN(na) || Number.isNaN(nb)) return sa.localeCompare(sb);
    if (na !== nb) return na - nb;
  }
  return 0;
}

// Board sort: roll items up by integer phase (sprint_number floor) ascending —
// phased items group together and come before un-phased ones — then by phase_step
// ascending within a phase, then fall back to the priority/recency ordering.
export function sortByPhaseThenPriority(a: WorkItem, b: WorkItem) {
  const ba = a.sprint_number == null ? null : phaseBucket(a.sprint_number);
  const bb = b.sprint_number == null ? null : phaseBucket(b.sprint_number);
  if (ba !== bb) {
    if (ba === null) return 1; // un-phased sorts after phased
    if (bb === null) return -1;
    return ba - bb;
  }
  const stepCmp = comparePhaseStep(a.phase_step, b.phase_step);
  if (stepCmp !== 0) return stepCmp;
  return sortByPriorityThenUpdated(a, b);
}

// ─── Filters ─────────────────────────────────────────────────────────────────

export type Filters = {
  agents: Set<AgentName | "unassigned">;
  workTypes: Set<WorkType>;
  priorities: Set<TaskPriority>;
  sources: Set<WorkItemSource>;
  // Phase 0.7 cleanup: phase membership filter. Holds phase numbers and/or the
  // "none" sentinel (items with no phase). Empty set = show all phases.
  phases: Set<number | "none">;
  // Server-side filter (passed to /api/work?itemType=) — single value, defaults to "internal"
  itemType: ItemTypeFilter;
  // Free-text search (server-side). Empty string = no search active.
  q: string;
  // When true, search spans every status; otherwise terminal statuses are hidden.
  searchAll: boolean;
};

// Terminal statuses hidden from the default search scope. The "all statuses"
// toggle (and the API's searchAll=1) lifts this restriction.
export const CLOSED_STATUSES: WorkStatus[] = ["done", "cancelled", "rejected"];

export function parseSetParam<T extends string>(
  raw: string | null,
  allowed: readonly T[],
): Set<T> {
  if (!raw) return new Set();
  const valid = new Set(allowed);
  return new Set(
    raw.split(",").map((s) => s.trim()).filter((s): s is T => valid.has(s as T)),
  );
}

// Sentinel for "no phase assigned" in the phase filter. PHASE_NONE matches
// items where sprint_number IS NULL.
export const PHASE_NONE = "none" as const;

// Phases are grouped by the INTEGER FLOOR of sprint_number: "Phase 1" covers
// every item with sprint_number in [1, 2) — 1.0, 1.2, 1.6, etc. So the filter
// always works in whole-number phase buckets (0, 1, 2, …).
export function phaseBucket(sprintNumber: number): number {
  return Math.floor(sprintNumber);
}

/** Sort comparator for phase filter values: the "none" sentinel first, then ascending. */
export function comparePhaseValues(a: number | "none", b: number | "none"): number {
  if (a === PHASE_NONE) return -1;
  if (b === PHASE_NONE) return 1;
  return (a as number) - (b as number);
}

// Phase filter parsing. An absent param (or "all") means no restriction —
// a fresh /work load shows every item. Otherwise each token is floored to its
// integer phase bucket; PHASE_NONE keeps un-phased items.
export function parsePhases(raw: string | null): Set<number | "none"> {
  if (raw === null || raw === "all") return new Set();
  const out = new Set<number | "none">();
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (t === PHASE_NONE) out.add(PHASE_NONE);
    else {
      const n = parseFloat(t);
      if (Number.isFinite(n) && n >= 0) out.add(phaseBucket(n));
    }
  }
  return out;
}

export function parseItemType(raw: string | null): ItemTypeFilter {
  if (raw === "client" || raw === "all") return raw;
  return "internal";
}

export function buildFilters(sp: URLSearchParams): Filters {
  return {
    agents: parseSetParam<AgentName | "unassigned">(sp.get("agent"), AGENT_FILTER_OPTIONS),
    workTypes: parseSetParam<WorkType>(sp.get("type"), WORK_TYPES),
    priorities: parseSetParam<TaskPriority>(sp.get("priority"), PRIORITIES),
    sources: parseSetParam<WorkItemSource>(sp.get("source"), SOURCES),
    phases: parsePhases(sp.get("phase")),
    itemType: parseItemType(sp.get("itemType")),
    q: (sp.get("q") ?? "").trim(),
    searchAll: sp.get("searchAll") === "1",
  };
}

export function filtersToQuery(f: Filters): string {
  const sp = new URLSearchParams();
  if (f.agents.size) sp.set("agent", Array.from(f.agents).join(","));
  if (f.workTypes.size) sp.set("type", Array.from(f.workTypes).join(","));
  if (f.priorities.size) sp.set("priority", Array.from(f.priorities).join(","));
  if (f.sources.size) sp.set("source", Array.from(f.sources).join(","));
  // Phase is always serialized so the URL round-trips: empty = "all", otherwise
  // the selected phases (the "none" sentinel sorted first).
  if (f.phases.size === 0) {
    sp.set("phase", "all");
  } else {
    const vals = Array.from(f.phases).sort(comparePhaseValues);
    sp.set("phase", vals.join(","));
  }
  // Only persist itemType when it's not the default ("internal")
  if (f.itemType !== "internal") sp.set("itemType", f.itemType);
  if (f.q) sp.set("q", f.q);
  if (f.searchAll) sp.set("searchAll", "1");
  return sp.toString();
}

export function matchesFilters(item: WorkItem, f: Filters): boolean {
  if (f.agents.size) {
    const key = item.assigned_agent ?? "unassigned";
    if (!f.agents.has(key as AgentName | "unassigned")) return false;
  }
  if (f.workTypes.size && !f.workTypes.has(item.work_type)) return false;
  if (f.priorities.size && !f.priorities.has(item.priority)) return false;
  if (f.sources.size && !f.sources.has(item.source)) return false;
  if (f.phases.size) {
    const key: number | "none" =
      item.sprint_number == null ? PHASE_NONE : phaseBucket(item.sprint_number);
    if (!f.phases.has(key)) return false;
  }
  // itemType is enforced server-side via /api/work?itemType=, but defensively re-check
  // here so a stale fetch doesn't leak across toggle states.
  if (f.itemType === "internal" && item.work_item_type !== "internal") return false;
  if (f.itemType === "client" && item.work_item_type !== "client") return false;
  return true;
}
