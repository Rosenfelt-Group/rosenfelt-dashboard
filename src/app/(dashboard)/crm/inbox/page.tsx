"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { fetchJson } from "@/lib/fetch-json";
import { usePolling } from "@/lib/use-polling";
import { Button, EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/ui";
import type { InboxItem } from "@/lib/crm/inbox";

type Resolve = { contact_id: string };

export default function InboxPage() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<Record<string, string>>({});
  const [picking, setPicking] = useState<string | null>(null);
  const [pickId, setPickId] = useState("");
  const [done, setDone] = useState<Record<string, string>>({}); // unmatched id -> contact id

  const load = useCallback(async (silent = false) => {
    const r = await fetchJson<{ items: InboxItem[] }>("/api/crm/inbox");
    if (!r.ok) { if (!silent) setError(r.error); return; }
    setItems(r.data.items);
    setError(null);
  }, []);
  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);
  usePolling(() => load(true), 20_000, !busy);

  async function resolve(item: InboxItem, body: { contact_id?: string; create?: { email: string; name?: string } }) {
    if (busy) return;
    setBusy(item.id);
    setRowErr((e) => ({ ...e, [item.id]: "" }));
    const r = await fetchJson<Resolve>("/api/crm/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unmatched_id: item.id, ...body }),
    });
    setBusy(null);
    if (!r.ok) return setRowErr((e) => ({ ...e, [item.id]: r.error }));
    setDone((d) => ({ ...d, [item.id]: r.data.contact_id }));
    setPicking(null);
    load(true);
  }

  if (loading) return <div className="p-8"><LoadingState /></div>;
  if (error) return <div className="p-8"><ErrorState message={`Couldn't load the inbox: ${error}`} onRetry={() => load()} /></div>;

  return (
    <div className="p-4 md:p-8 max-w-4xl pb-24 md:pb-8 space-y-4">
      <PageHeader title="Inbox" description="Email forwarded to crm@ from people who are not in the CRM yet." />
      {items.length === 0 && Object.keys(done).length === 0 ? (
        <EmptyState title="Nothing to sort" />
      ) : (
        <div className="space-y-3">
          {items.map((it) => (
            <div key={it.id} className="card space-y-2">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="font-medium text-sm text-brand-black break-words">{it.subject || "(no subject)"}</p>
                  <p className="text-xs text-brand-muted break-words">
                    {it.from_name ? `${it.from_name} ` : ""}&lt;{it.contact_email}&gt; · {it.direction}
                    {it.timestamp ? ` · ${formatDistanceToNow(new Date(it.sent_at ?? it.timestamp), { addSuffix: true })}` : ""}
                  </p>
                </div>
              </div>
              {it.snippet && <p className="text-xs text-brand-muted break-words">{it.snippet}</p>}
              <div className="flex gap-2 flex-wrap items-center">
                {it.suggested_contact && (
                  <Button size="sm" disabled={busy === it.id} onClick={() => resolve(it, { contact_id: it.suggested_contact!.id })}>
                    Link to {it.suggested_contact.name}
                  </Button>
                )}
                <Button size="sm" variant="secondary" disabled={busy === it.id} onClick={() => resolve(it, { create: { email: it.contact_email, name: it.from_name ?? undefined } })}>
                  Create new person
                </Button>
                <Button size="sm" variant="ghost" disabled={busy === it.id} onClick={() => { setPicking(picking === it.id ? null : it.id); setPickId(""); }}>
                  Link to existing…
                </Button>
              </div>
              {picking === it.id && (
                <div className="flex gap-2 items-center">
                  <input
                    className="flex-1 border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                    placeholder="Contact id (from the person page URL)"
                    aria-label="Contact id"
                    value={pickId}
                    onChange={(e) => setPickId(e.target.value.trim())}
                  />
                  <Button size="sm" disabled={!pickId || busy === it.id} onClick={() => resolve(it, { contact_id: pickId })}>Link</Button>
                </div>
              )}
              {rowErr[it.id] && <p role="alert" className="text-xs text-red-700">{rowErr[it.id]}</p>}
            </div>
          ))}
          {Object.entries(done).map(([uid, cid]) => (
            <p key={uid} role="status" className="text-xs text-green-700">Linked. <Link className="underline" href={`/crm/people/${cid}`}>Open person</Link></p>
          ))}
        </div>
      )}
    </div>
  );
}
