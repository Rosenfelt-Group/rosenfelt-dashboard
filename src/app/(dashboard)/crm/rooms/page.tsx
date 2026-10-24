"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { fetchJson } from "@/lib/fetch-json";
import { Button, EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/ui";
import { NewRoomForm, RELATIONSHIPS } from "@/components/crm/NewRoomForm";

type Room = {
  id: string;
  title: string;
  relationship: string;
  status: string;
  created_at: string;
  business_id: string;
  business: { id: string; name: string } | null;
};
const relLabel = (v: string) => RELATIONSHIPS.find(r => r.value === v)?.label ?? v;

export default function RoomsPage() {
  const [rows, setRows] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const r = await fetchJson<Room[]>("/api/engagements");
    if (r.ok) setRows(Array.isArray(r.data) ? r.data : []);
    else setError(r.error);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-4 md:p-8 max-w-5xl pb-24 md:pb-8">
      <PageHeader
        title="Rooms"
        description={`Engagement rooms · ${rows.length} total`}
        actions={
          <Button onClick={() => setShowNew(s => !s)}>
            {showNew ? "Close" : "New room"}
          </Button>
        }
      />

      {showNew && <NewRoomForm className="card mb-4 space-y-3" onCancel={() => setShowNew(false)} />}

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={`Couldn't load rooms: ${error}`} onRetry={load} />
      ) : rows.length === 0 ? (
        <EmptyState title="No rooms yet. Create one for an organization to share prototypes and gather feedback." />
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-brand-muted border-b border-brand-border">
                <th className="px-4 py-2 font-medium">Room</th>
                <th className="px-4 py-2 font-medium">Organization</th>
                <th className="px-4 py-2 font-medium">Relationship</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-brand-border last:border-b-0 hover:bg-brand-offwhite">
                  <td className="px-4 py-3">
                    <Link href={`/engagements/${r.id}`} className="font-medium text-brand-black hover:text-brand-orange">{r.title}</Link>
                  </td>
                  <td className="px-4 py-3">
                    {r.business
                      ? <Link href={`/crm/organizations/${r.business_id}?tab=engagement`} className="text-brand-black hover:text-brand-orange">{r.business.name}</Link>
                      : <span className="text-brand-muted">—</span>}
                  </td>
                  <td className="px-4 py-3 text-brand-muted">{relLabel(r.relationship)}</td>
                  <td className="px-4 py-3 text-brand-muted capitalize">{r.status}</td>
                  <td className="px-4 py-3 text-brand-muted whitespace-nowrap">
                    {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
