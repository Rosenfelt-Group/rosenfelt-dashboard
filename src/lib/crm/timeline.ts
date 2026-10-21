// Timeline types and the mapping from crm.contact_timeline rows (docs/migrations/2026-10-22_crm_timeline.sql).
export const TIMELINE_PAGE = 50;
export const PREVIEW_CHARS = 500;

export type ActivityItem = {
  kind: "activity"; id: string; ts: string; activity_type: string; content: string | null; email_direction: string | null;
  email_subject: string | null; logged_by: string | null; lead_id: string | null; metadata: Record<string, unknown> | null;
};
export type EmailItem = {
  kind: "email"; id: string; ts: string; direction: "received" | "sent"; from_email: string | null; from_name: string | null;
  to_emails: string[]; cc_emails: string[]; subject: string | null; snippet: string | null; thread_id: string | null;
  /** First PREVIEW_CHARS of the body. The full body is fetched on demand via include_body. */
  preview: string | null;
  body_truncated: boolean;
  /** The email_* activity row folded into this item, if any; its metadata is carried here. */
  activity_id: string | null; logged_by: string | null; metadata: Record<string, unknown> | null;
};
export type TimelineItem = ActivityItem | EmailItem;
export type TimelineCursor = { before_ts: string; before_id: string };
export type TimelinePage = { items: TimelineItem[]; next_cursor: TimelineCursor | null };

export type TimelineRow = {
  kind: "activity" | "email"; id: string; ts: string; activity_id: string | null; email_message_id: string | null; payload: Record<string, any>;
};

export function rowToItem(r: TimelineRow): TimelineItem {
  const p = r.payload ?? {};
  if (r.kind === "email") {
    return {
      kind: "email", id: r.id, ts: r.ts, direction: p.direction, from_email: p.from_email ?? null, from_name: p.from_name ?? null,
      to_emails: p.to_emails ?? [], cc_emails: p.cc_emails ?? [], subject: p.subject ?? null, snippet: p.snippet ?? null, thread_id: p.thread_id ?? null,
      preview: p.preview ?? null, body_truncated: !!p.body_truncated, activity_id: r.activity_id, logged_by: p.logged_by ?? null, metadata: p.metadata ?? null,
    };
  }
  return {
    kind: "activity", id: r.id, ts: r.ts, activity_type: p.activity_type, content: p.content ?? null, email_direction: p.email_direction ?? null,
    email_subject: p.email_subject ?? null, logged_by: p.logged_by ?? null, lead_id: p.lead_id ?? null, metadata: p.metadata ?? null,
  };
}

export function pageFromRows(rows: TimelineRow[], limit = TIMELINE_PAGE): TimelinePage {
  const last = rows[rows.length - 1];
  return { items: rows.map(rowToItem), next_cursor: rows.length >= limit && last ? { before_ts: last.ts, before_id: last.id } : null };
}
