"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { fetchJson } from "@/lib/fetch-json";
import { usePolling } from "@/lib/use-polling";
import { Button, ErrorState, LoadingState } from "@/components/ui";
import { Timeline } from "@/components/crm/Timeline";
import { ComposeBox, type ComposePrefill } from "@/components/crm/ComposeBox";
import { replyDefaults } from "@/lib/crm/compose";
import type { EmailItem, TimelineCursor, TimelineItem, TimelinePage } from "@/lib/crm/timeline";

type Contact = { id: string; first_name: string; last_name: string | null; email: string | null; business?: { id: string; name: string } | null };

export default function PersonPage() {
  const { contactId } = useParams<{ contactId: string }>();
  const [contact, setContact] = useState<Contact | null>(null);
  const [head, setHead] = useState<TimelineItem[]>([]);
  const [older, setOlder] = useState<TimelineItem[]>([]);
  const [cursor, setCursor] = useState<TimelineCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false); // compose is admin-only; hidden until /api/auth/me says admin
  const [prefill, setPrefill] = useState<ComposePrefill>({ to: [], subject: "" });

  const loadHead = useCallback(async (silent = false) => {
    const r = await fetchJson<TimelinePage>(`/api/crm/contacts/${contactId}/timeline`);
    if (!r.ok) { if (!silent) setError(r.error); return; }
    setHead(r.data.items);
    if (!silent) setCursor(r.data.next_cursor);
  }, [contactId]);

  useEffect(() => {
    let live = true;
    Promise.all([
      fetchJson<Contact>(`/api/crm/contacts/${contactId}`),
      fetchJson<TimelinePage>(`/api/crm/contacts/${contactId}/timeline`),
      fetchJson<{ role?: string }>("/api/auth/me"),
    ]).then(([c, t, me]) => {
      if (!live) return;
      if (!c.ok) setError(c.status === 404 ? "Person not found" : c.error);
      else if (!t.ok) setError(t.error);
      else {
        setContact(c.data);
        setHead(t.data.items);
        setCursor(t.data.next_cursor);
        if (c.data.email) setPrefill({ to: [c.data.email], subject: "" });
      }
      setIsAdmin(me.ok && me.data.role === "admin");
      setLoading(false);
    });
    return () => { live = false; };
  }, [contactId]);

  usePolling(() => loadHead(true), 15_000, !loading && !error);

  const items = useMemo(() => {
    const seen = new Set(head.map((i) => `${i.kind}:${i.id}`));
    return [...head, ...older.filter((i) => !seen.has(`${i.kind}:${i.id}`))];
  }, [head, older]);

  async function loadOlder() {
    if (!cursor) return;
    const r = await fetchJson<TimelinePage>(`/api/crm/contacts/${contactId}/timeline?before_ts=${encodeURIComponent(cursor.before_ts)}&before_id=${cursor.before_id}`);
    if (!r.ok) return setError(r.error);
    setOlder((o) => [...o, ...r.data.items]);
    setCursor(r.data.next_cursor);
  }

  function reply(m: EmailItem) {
    setPrefill(replyDefaults(m));
    document.getElementById("compose")?.scrollIntoView({ behavior: "smooth" });
  }

  if (loading) return <div className="p-8"><LoadingState /></div>;
  if (error || !contact) return <div className="p-8"><ErrorState message={error ?? "Person not found"} /><Link href="/crm/contacts" className="text-brand-orange text-sm mt-2 block">← Back to contacts</Link></div>;

  const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ");
  return (
    <div className="p-4 md:p-8 max-w-4xl pb-24 md:pb-8 space-y-4">
      <div className="card">
        <h1 className="text-lg font-semibold text-brand-black">{name}</h1>
        {contact.business && <p className="text-sm text-brand-muted"><Link href={`/crm/organizations/${contact.business.id}`} className="hover:text-brand-orange hover:underline">{contact.business.name}</Link></p>}
        {contact.email && <p className="text-sm text-brand-orange">{contact.email}</p>}
      </div>
      {isAdmin && (
        <div id="compose">
          <ComposeBox prefill={prefill} onSent={() => loadHead(true)} />
        </div>
      )}
      <div className="card">
        <h2 className="text-sm font-medium text-brand-black mb-4">History</h2>
        <Timeline contactId={contactId} items={items} onReply={isAdmin ? reply : undefined} />
        {cursor && <div className="mt-4"><Button variant="secondary" size="sm" onClick={loadOlder}>Load older</Button></div>}
      </div>
    </div>
  );
}
