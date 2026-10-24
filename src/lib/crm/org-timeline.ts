// Organization timeline: rows from crm.org_timeline (docs/migrations/2026-10-25_e_organizations.sql) and the
// client-side helpers that merge pages, filter by category and pin upcoming items.
import { rowToItem, type TimelineCursor, type TimelineItem, type TimelineRow } from "./timeline";

export type RoomEventItem = {
  kind: "room_event"; id: string; ts: string; event_type: string; engagement_id: string; room_title: string | null;
  contact_name: string | null; meta: Record<string, unknown> | null;
};
export type ScopeItem = {
  kind: "scope"; id: string; ts: string; scope_document_id: string; title: string; version_no: number;
  status: "current" | "proposed" | "rejected" | "superseded"; source: string; created_by: string | null;
  change_note: string | null; decided_at: string | null;
};
export type OrgTimelineItem = (TimelineItem & { contact_id?: string | null }) | RoomEventItem | ScopeItem;
export type OrgTimelinePage = { items: OrgTimelineItem[]; next_cursor: TimelineCursor | null };
export type OrgTimelineRow = Omit<TimelineRow, "kind"> & { kind: OrgTimelineItem["kind"] };

export function orgRowToItem(r: OrgTimelineRow): OrgTimelineItem {
  const p = r.payload ?? {};
  if (r.kind === "room_event") {
    return {
      kind: "room_event", id: r.id, ts: r.ts, event_type: p.event_type, engagement_id: p.engagement_id,
      room_title: p.room_title ?? null, contact_name: p.contact_name ?? null, meta: p.meta ?? null,
    };
  }
  if (r.kind === "scope") {
    return {
      kind: "scope", id: r.id, ts: r.ts, scope_document_id: p.scope_document_id, title: p.title ?? "Scope",
      version_no: Number(p.version_no), status: p.status, source: p.source, created_by: p.created_by ?? null,
      change_note: p.change_note ?? null, decided_at: p.decided_at ?? null,
    };
  }
  return { ...rowToItem(r as TimelineRow), contact_id: p.contact_id ?? null };
}

export function orgPageFromRows(rows: OrgTimelineRow[], limit: number): OrgTimelinePage {
  const last = rows[rows.length - 1];
  return { items: rows.map(orgRowToItem), next_cursor: rows.length >= limit && last ? { before_ts: last.ts, before_id: last.id } : null };
}

const key = (i: { kind: string; id: string }) => `${i.kind}:${i.id}`;

/** Newest first; ties broken by id descending, the same order as the SQL keyset. */
export function compareTimeline(a: { ts: string; id: string }, b: { ts: string; id: string }): number {
  const t = Date.parse(b.ts) - Date.parse(a.ts);
  if (t !== 0) return t;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * The polled first page plus any older pages loaded with "Load older". The head wins on duplicates
 * (it is the freshest copy), and the result is in timeline order.
 */
export function mergeTimeline<T extends { kind: string; id: string; ts: string }>(head: T[], older: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const i of [...head, ...older]) {
    const k = key(i);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(i);
  }
  return out.sort(compareTimeline);
}

export const TIMELINE_FILTERS = [
  { id: "all", label: "All" },
  { id: "email", label: "Email" },
  { id: "discovery", label: "Discovery" },
  { id: "scope", label: "Scope" },
  { id: "room", label: "Room" },
  { id: "notes", label: "Notes" },
  { id: "system", label: "Stages & system" },
] as const;
export type TimelineFilter = (typeof TIMELINE_FILTERS)[number]["id"];
export type TimelineCategory = Exclude<TimelineFilter, "all">;

export function parseTimelineFilter(raw: string | null | undefined): TimelineFilter {
  return TIMELINE_FILTERS.some((f) => f.id === raw) ? (raw as TimelineFilter) : "all";
}

/** Discovery events are logged as lead activities whose text starts "Discovery questionnaire …". */
const DISCOVERY = /discovery (questionnaire|brief)/i;

export function timelineCategory(i: OrgTimelineItem): TimelineCategory {
  if (i.kind === "email") return "email";
  if (i.kind === "room_event") return "room";
  if (i.kind === "scope") return "scope";
  const text = `${i.email_subject ?? ""} ${i.content ?? ""}`;
  if (DISCOVERY.test(text) || i.metadata?.discovery_invite_id) return "discovery";
  if (i.activity_type === "email_sent" || i.activity_type === "email_received") return "email";
  if (i.activity_type === "note") return "notes";
  return "system";
}

export function filterTimeline<T extends OrgTimelineItem>(items: T[], filter: TimelineFilter): T[] {
  return filter === "all" ? items : items.filter((i) => timelineCategory(i) === filter);
}

// ─── Upcoming (pinned above the timeline) ───────────────────────────────────

export type UpcomingKind = "next_step" | "scope_proposal" | "discovery_waiting" | "brief_ready" | "close_date";
export type UpcomingItem = {
  kind: UpcomingKind; id: string; title: string; detail: string | null;
  /** When it is due or happened; drives the order. ISO date or timestamp. */
  at: string;
  href: string | null;
  /** Opens the Engagement tab on this deal instead of navigating away. */
  lead_id: string | null;
};

const UPCOMING_RANK: Record<UpcomingKind, number> = { next_step: 0, scope_proposal: 1, brief_ready: 2, discovery_waiting: 3, close_date: 4 };

/** Deal next steps first, then items that need a decision or a read, then waiting items and close dates; soonest first within each. */
export function sortUpcoming(items: UpcomingItem[]): UpcomingItem[] {
  return [...items].sort((a, b) => UPCOMING_RANK[a.kind] - UPCOMING_RANK[b.kind] || Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
}

/** A Date for an ISO timestamp or a plain YYYY-MM-DD (read as midday local, so it never shifts a day). */
export function upcomingDate(at: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(at) ? new Date(`${at}T12:00:00`) : new Date(at);
}
