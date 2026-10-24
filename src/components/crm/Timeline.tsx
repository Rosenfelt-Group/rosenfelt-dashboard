"use client";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { fetchJson } from "@/lib/fetch-json";
import { Button } from "@/components/ui";
import type { ActivityItem, EmailItem, TimelineItem } from "@/lib/crm/timeline";

const ICONS: Record<string, string> = { note: "📝", email_sent: "📤", email_received: "📥", stage_change: "🔀", assessment: "📊", system: "⚙️" };

/**
 * Email content is untrusted. Everything here is rendered as React text (escaped); never as HTML.
 */
export function EmailCard({ contactId, item, onReply, bodyUrl }: {
  contactId?: string; item: EmailItem; onReply?: (m: EmailItem) => void;
  /** Where the full body comes from; defaults to the contact timeline's include_body. */
  bodyUrl?: string;
}) {
  const [full, setFull] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadFull() {
    setLoading(true);
    setErr(null);
    // The timeline pages carry previews only; the full body is looked up by message id.
    const r = await fetchJson<{ body: { body_text: string } }>(bodyUrl ?? `/api/crm/contacts/${contactId}/timeline?include_body=${item.id}`);
    setLoading(false);
    if (!r.ok) return setErr(r.error);
    setFull(r.data.body.body_text);
  }

  const sent = item.direction === "sent";
  const who = sent ? `To ${item.to_emails.join(", ")}` : `From ${item.from_name ? `${item.from_name} <${item.from_email}>` : item.from_email ?? "unknown"}`;
  const body = full ?? item.preview ?? item.snippet ?? "";
  return (
    <div className="flex gap-3 text-sm">
      <span className="text-base mt-0.5 shrink-0">{sent ? "📤" : "📥"}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-brand-black break-words">{item.subject || "(no subject)"}</span>
          <span className={`badge text-xs ${sent ? "badge-neutral" : "badge-warning"}`}>{sent ? "sent" : "received"}</span>
        </div>
        <p className="text-xs text-brand-muted break-words">{who}</p>
        {open ? (
          <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-xs text-brand-black bg-brand-offwhite rounded p-2">{body}</pre>
        ) : (
          item.snippet && <p className="text-brand-muted text-xs mt-0.5 break-words">{item.snippet}</p>
        )}
        {err && <p role="alert" className="text-xs text-red-700 mt-1">{err}</p>}
        <div className="flex gap-2 items-center mt-1">
          <button className="text-xs text-brand-orange hover:underline" onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "Show message"}</button>
          {open && item.body_truncated && full === null && (
            <Button size="sm" variant="ghost" onClick={loadFull} disabled={loading}>{loading ? "Loading…" : "Show full message"}</Button>
          )}
          {onReply && <Button size="sm" variant="ghost" onClick={() => onReply(item)}>Reply</Button>}
          <span className="text-xs text-brand-muted ml-auto">{formatDistanceToNow(new Date(item.ts), { addSuffix: true })}</span>
        </div>
      </div>
    </div>
  );
}

export function ActivityRow({ item: it }: { item: ActivityItem }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="text-base mt-0.5 shrink-0">{ICONS[it.activity_type] ?? "•"}</span>
      <div className="flex-1 min-w-0">
        {it.email_subject && <span className="font-medium text-brand-black break-words">{it.email_subject}</span>}
        {it.content && <p className="text-brand-muted text-xs mt-0.5 break-words whitespace-pre-wrap">{it.content}</p>}
        <p className="text-xs text-brand-muted mt-1">
          {it.logged_by && <span className="capitalize">{it.logged_by} · </span>}
          {formatDistanceToNow(new Date(it.ts), { addSuffix: true })}
        </p>
      </div>
    </div>
  );
}

export function Timeline({ contactId, items, onReply }: { contactId: string; items: TimelineItem[]; onReply?: (m: EmailItem) => void }) {
  if (items.length === 0) return <p className="text-xs text-brand-muted">No history yet.</p>;
  return (
    <div className="space-y-4">
      {items.map((it) =>
        it.kind === "email" ? (
          <EmailCard key={`e-${it.id}`} contactId={contactId} item={it} onReply={onReply} />
        ) : (
          <ActivityRow key={`a-${it.id}`} item={it} />
        ),
      )}
    </div>
  );
}
