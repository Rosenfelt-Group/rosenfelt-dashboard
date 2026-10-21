// Pure merge of a contact's lead_activities and linked email_messages into one newest-first page.
export const TIMELINE_PAGE = 50;
export const PREVIEW_CHARS = 500;

export type ActivityRow = {
  id: string; created_at: string; activity_type: string; content: string | null;
  email_direction: string | null; email_subject: string | null; logged_by: string | null;
  lead_id: string | null; contact_id: string | null; metadata: Record<string, unknown> | null;
};
export type EmailRow = {
  id: string; gmail_message_id: string; thread_id: string | null; direction: "received" | "sent";
  from_email: string | null; from_name: string | null; to_emails: string[]; cc_emails: string[];
  subject: string | null; snippet: string | null; body_text: string | null; sent_at: string | null; created_at: string;
};

export type ActivityItem = {
  kind: "activity"; id: string; ts: string; activity_type: string; content: string | null; email_direction: string | null;
  email_subject: string | null; logged_by: string | null; lead_id: string | null; metadata: Record<string, unknown> | null;
};
export type EmailItem = {
  kind: "email"; id: string; ts: string; direction: "received" | "sent"; from_email: string | null; from_name: string | null;
  to_emails: string[]; cc_emails: string[]; subject: string | null; snippet: string | null; thread_id: string | null;
  /** First PREVIEW_CHARS of body_text. Always present when there is a body. */
  preview: string | null;
  /** Full body, only for the id passed as include_body. */
  body_text?: string | null;
  /** True when body_text is longer than the preview and was not included. */
  body_truncated: boolean;
  /** The email_* activity row for this message, if any; its metadata is carried here. */
  activity_id: string | null; logged_by: string | null; metadata: Record<string, unknown> | null;
};
export type TimelineItem = ActivityItem | EmailItem;

const isEmailActivity = (a: ActivityRow) => a.activity_type === "email_received" || a.activity_type === "email_sent";
const msgIdOf = (a: ActivityRow) => (typeof a.metadata?.email_message_id === "string" ? (a.metadata.email_message_id as string) : null);

export function buildTimeline(activities: ActivityRow[], emails: EmailRow[], includeBodyFor: string | undefined): TimelineItem[] {
  const byMsg = new Map<string, ActivityRow>();
  for (const a of activities) {
    const id = msgIdOf(a);
    if (id && isEmailActivity(a) && !byMsg.has(id)) byMsg.set(id, a);
  }
  const known = new Set(emails.map((e) => e.id));

  const items: TimelineItem[] = [];
  for (const a of activities) {
    const id = msgIdOf(a);
    if (id && isEmailActivity(a) && known.has(id)) continue; // shown as the email item instead
    items.push({
      kind: "activity", id: a.id, ts: a.created_at, activity_type: a.activity_type, content: a.content,
      email_direction: a.email_direction, email_subject: a.email_subject, logged_by: a.logged_by, lead_id: a.lead_id, metadata: a.metadata,
    });
  }
  for (const e of emails) {
    const a = byMsg.get(e.id);
    const body = e.body_text;
    const full = includeBodyFor === e.id;
    items.push({
      kind: "email", id: e.id, ts: e.sent_at ?? e.created_at, direction: e.direction, from_email: e.from_email, from_name: e.from_name,
      to_emails: e.to_emails, cc_emails: e.cc_emails, subject: e.subject, snippet: e.snippet, thread_id: e.thread_id,
      preview: body ? body.slice(0, PREVIEW_CHARS) : null,
      ...(full ? { body_text: body } : {}),
      body_truncated: !full && !!body && body.length > PREVIEW_CHARS,
      activity_id: a?.id ?? null, logged_by: a?.logged_by ?? null,
      metadata: a?.metadata ?? { email_message_id: e.id, gmail_message_id: e.gmail_message_id },
    });
  }
  return items.sort((x, y) => (x.ts < y.ts ? 1 : x.ts > y.ts ? -1 : 0)).slice(0, TIMELINE_PAGE);
}
