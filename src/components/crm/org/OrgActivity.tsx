"use client";
// Activity tab: compose (email, note, logged email), upcoming items, then the organization-wide timeline.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { formatDistanceToNow, format } from "date-fns";
import { fetchJson } from "@/lib/fetch-json";
import { usePolling } from "@/lib/use-polling";
import { replyDefaults } from "@/lib/crm/compose";
import type { EmailItem, TimelineCursor } from "@/lib/crm/timeline";
import {
  TIMELINE_FILTERS, filterTimeline, mergeTimeline, type OrgTimelineItem, type OrgTimelinePage, type TimelineFilter, type UpcomingItem, upcomingDate,
} from "@/lib/crm/org-timeline";
import type { DealSummary } from "@/lib/crm/org-engagement";
import type { OrgPerson } from "@/lib/crm/org-detail";
import { STAGES } from "@/lib/crm/stages";
import { ComposeBox, type ComposePrefill } from "@/components/crm/ComposeBox";
import { ActivityRow, EmailCard } from "@/components/crm/Timeline";
import { Button, ErrorState, LoadingState } from "@/components/ui";

const ROOM_EVENT: Record<string, string> = {
  room_opened: "Someone opened the room",
  contact_identified: "A visitor introduced themselves",
  version_viewed: "A visitor viewed a version",
  document_downloaded: "A visitor downloaded a document",
  deliverable_deleted: "A deliverable was deleted",
  link_refreshed: "A room link was refreshed",
};
const SCOPE_STATUS: Record<string, string> = { current: "accepted", proposed: "proposed", rejected: "rejected", superseded: "superseded" };

function OtherItem({ item }: { item: Exclude<OrgTimelineItem, { kind: "email" } | { kind: "activity" }> }) {
  const when = formatDistanceToNow(new Date(item.ts), { addSuffix: true });
  if (item.kind === "room_event") {
    const who = item.contact_name ? `${item.contact_name}: ` : "";
    const title = typeof item.meta?.deliverable_title === "string" ? ` (${item.meta.deliverable_title})` : "";
    return (
      <div className="flex gap-3 text-sm">
        <span className="text-base mt-0.5 shrink-0">🚪</span>
        <div className="flex-1 min-w-0">
          <span className="text-brand-black">{who}{ROOM_EVENT[item.event_type] ?? item.event_type}{title}</span>
          <p className="text-xs text-brand-muted mt-1">
            <Link href={`/engagements/${item.engagement_id}`} className="hover:text-brand-orange hover:underline">{item.room_title ?? "Room"}</Link> · {when}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3 text-sm">
      <span className="text-base mt-0.5 shrink-0">📄</span>
      <div className="flex-1 min-w-0">
        <span className="text-brand-black">
          <Link href={`/crm/scope/${item.scope_document_id}`} className="font-medium hover:text-brand-orange hover:underline">{item.title}</Link>
          {" "}v{item.version_no} {SCOPE_STATUS[item.status] ?? item.status}
        </span>
        {item.change_note && <p className="text-brand-muted text-xs mt-0.5 break-words whitespace-pre-wrap">{item.change_note}</p>}
        <p className="text-xs text-brand-muted mt-1"><span className="capitalize">{item.created_by ?? item.source}</span> · {when}</p>
      </div>
    </div>
  );
}

type Mode = "email" | "note" | "log";

export function OrgActivity({ orgId, people, deals, upcoming, isAdmin, onOpenDeal }: {
  orgId: string; people: OrgPerson[]; deals: DealSummary[]; upcoming: UpcomingItem[]; isAdmin: boolean;
  onOpenDeal: (leadId: string) => void;
}) {
  const [head, setHead] = useState<OrgTimelineItem[]>([]);
  const [older, setOlder] = useState<OrgTimelineItem[]>([]);
  const [cursor, setCursor] = useState<TimelineCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const recipients = useMemo(() => people.filter((p) => p.email).map((p) => ({ name: [p.first_name, p.last_name].filter(Boolean).join(" "), email: p.email! })), [people]);
  const primary = people.find((p) => p.is_primary && p.email) ?? people.find((p) => p.email);
  const [prefill, setPrefill] = useState<ComposePrefill>({ to: primary?.email ? [primary.email] : [], subject: "" });
  const [mode, setMode] = useState<Mode>(isAdmin ? "email" : "note");
  useEffect(() => { if (!isAdmin && mode === "email") setMode("note"); }, [isAdmin, mode]);

  const loadHead = useCallback(async (silent = false) => {
    const r = await fetchJson<OrgTimelinePage>(`/api/crm/organizations/${orgId}/timeline`);
    if (!r.ok) { if (!silent) setError(r.error); setLoading(false); return; }
    setHead(r.data.items);
    if (!silent) setCursor(r.data.next_cursor);
    setError(null);
    setLoading(false);
  }, [orgId]);
  useEffect(() => { loadHead(); }, [loadHead]);
  usePolling(() => loadHead(true), 15_000, !loading && !error);

  async function loadOlder() {
    if (!cursor) return;
    const r = await fetchJson<OrgTimelinePage>(`/api/crm/organizations/${orgId}/timeline?before_ts=${encodeURIComponent(cursor.before_ts)}&before_id=${cursor.before_id}`);
    if (!r.ok) return setError(r.error);
    setOlder((o) => [...o, ...r.data.items]);
    setCursor(r.data.next_cursor);
  }

  const items = useMemo(() => filterTimeline(mergeTimeline(head, older), filter), [head, older, filter]);

  function reply(m: EmailItem) {
    setMode("email");
    setPrefill(replyDefaults(m));
    document.getElementById("compose")?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <div className="space-y-4">
      <div id="compose" className="space-y-2">
        <div className="flex gap-1" role="group" aria-label="Compose mode">
          {([["email", "Email"], ["note", "Note"], ["log", "Log an email"]] as const).filter(([m]) => m !== "email" || isAdmin).map(([m, label]) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
              className={clsx("text-xs px-3 py-1 rounded-full border", mode === m ? "bg-brand-orange text-white border-brand-orange" : "border-brand-border text-brand-muted hover:bg-brand-cream")}>
              {label}
            </button>
          ))}
        </div>
        {mode === "email" && isAdmin && <ComposeBox prefill={prefill} people={recipients} onSent={() => loadHead(true)} />}
        {mode !== "email" && <DealNote mode={mode} deals={deals} people={people} onSaved={() => loadHead(true)} />}
      </div>

      {upcoming.length > 0 && (
        <div className="card border-brand-orange">
          <h2 className="text-sm font-medium text-brand-black mb-2">Upcoming</h2>
          <ul className="space-y-2">
            {upcoming.map((u) => (
              <li key={`${u.kind}:${u.id}`} className="flex items-start gap-3 text-sm">
                <span className="text-xs text-brand-muted w-16 shrink-0 mt-0.5">{format(upcomingDate(u.at), "MMM d")}</span>
                <div className="flex-1 min-w-0">
                  {u.href ? <Link href={u.href} className="text-brand-black hover:text-brand-orange hover:underline">{u.title}</Link> : <span className="text-brand-black">{u.title}</span>}
                  {u.detail && <p className="text-xs text-brand-muted break-words">{u.detail}</p>}
                </div>
                {u.lead_id && (
                  <button type="button" className="text-xs text-brand-orange hover:underline shrink-0" onClick={() => onOpenDeal(u.lead_id!)}>
                    {u.kind === "scope_proposal" ? "Review →" : "Engagement →"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter the timeline">
        {TIMELINE_FILTERS.map((f) => (
          <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}
            className={clsx("text-xs px-3 py-1 rounded-full border", filter === f.id ? "bg-brand-black text-white border-brand-black" : "border-brand-border text-brand-muted hover:bg-brand-cream")}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="card">
        {loading ? <LoadingState rows={3} /> : error ? <ErrorState message={error} onRetry={() => loadHead()} /> : items.length === 0 ? (
          <p className="text-xs text-brand-muted">{filter === "all" ? "No history yet." : "Nothing of this type yet."}</p>
        ) : (
          <div className="space-y-4">
            {items.map((it) =>
              it.kind === "email" ? (
                <EmailCard key={`e-${it.id}`} item={it} onReply={isAdmin ? reply : undefined}
                  bodyUrl={`/api/crm/organizations/${orgId}/timeline?include_body=${it.id}`} />
              ) : it.kind === "activity" ? (
                <ActivityRow key={`a-${it.id}`} item={it} />
              ) : (
                <OtherItem key={`${it.kind}-${it.id}`} item={it} />
              ),
            )}
          </div>
        )}
        {cursor && !error && <div className="mt-4"><Button variant="secondary" size="sm" onClick={loadOlder}>Load older</Button></div>}
        <p className="text-xs text-brand-muted mt-4">Emails with everyone here, deal activity, room events and scope versions.</p>
      </div>
    </div>
  );
}

const INPUT = "w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange";

/** A note or a manually logged email, saved as a lead activity on one of the organization's deals. */
function DealNote({ mode, deals, people, onSaved }: { mode: "note" | "log"; deals: DealSummary[]; people: OrgPerson[]; onSaved: () => void }) {
  const [dealId, setDealId] = useState(deals[0]?.id ?? "");
  const [contactId, setContactId] = useState("");
  const [text, setText] = useState("");
  const [subject, setSubject] = useState("");
  const [direction, setDirection] = useState<"sent" | "received">("sent");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (!deals.some((d) => d.id === dealId)) setDealId(deals[0]?.id ?? ""); }, [deals, dealId]);

  if (deals.length === 0) {
    return <p className="card text-xs text-brand-muted">Notes are kept on a deal. Add a deal to this organization first (right-hand column).</p>;
  }
  async function save() {
    if (mode === "note" ? !text.trim() : !subject.trim()) return;
    setSaving(true); setErr(null);
    const body = mode === "note"
      ? { activity_type: "note", content: text.trim(), logged_by: "brian", contact_id: contactId || undefined }
      : { activity_type: direction === "sent" ? "email_sent" : "email_received", email_subject: subject.trim(), email_direction: direction,
          content: text.trim() || undefined, logged_by: "brian", contact_id: contactId || undefined };
    const r = await fetchJson(`/api/crm/leads/${dealId}/activities`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setSaving(false);
    if (!r.ok) return setErr(r.error);
    setText(""); setSubject("");
    onSaved();
  }
  const dealLabel = (d: DealSummary) => `${STAGES.find((s) => s.stage === d.stage)?.label ?? d.stage} · ${format(new Date(d.created_at), "MMM d, yyyy")}`;
  return (
    <form className="card space-y-2" onSubmit={(e) => { e.preventDefault(); save(); }} aria-label={mode === "note" ? "Add a note" : "Log an email"}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select className={INPUT} aria-label="Deal" value={dealId} onChange={(e) => setDealId(e.target.value)}>
          {deals.map((d) => <option key={d.id} value={d.id}>Deal: {dealLabel(d)}</option>)}
        </select>
        <select className={INPUT} aria-label="Person" value={contactId} onChange={(e) => setContactId(e.target.value)}>
          <option value="">No particular person</option>
          {people.map((p) => <option key={p.id} value={p.id}>{[p.first_name, p.last_name].filter(Boolean).join(" ")}</option>)}
        </select>
      </div>
      {mode === "log" && (
        <div className="flex gap-2">
          <select className={clsx(INPUT, "w-auto")} aria-label="Direction" value={direction} onChange={(e) => setDirection(e.target.value as "sent" | "received")}>
            <option value="sent">Sent</option>
            <option value="received">Received</option>
          </select>
          <input className={INPUT} aria-label="Subject" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
      )}
      <textarea className={clsx(INPUT, "min-h-20")} aria-label={mode === "note" ? "Note" : "Summary"} placeholder={mode === "note" ? "Note" : "Summary (optional)"}
        value={text} onChange={(e) => setText(e.target.value)} />
      {err && <p role="alert" className="text-xs text-red-700">{err}</p>}
      <Button type="submit" size="sm" disabled={saving || (mode === "note" ? !text.trim() : !subject.trim())}>{saving ? "Saving…" : mode === "note" ? "Add note" : "Log email"}</Button>
    </form>
  );
}
