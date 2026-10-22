"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { fetchJson } from "@/lib/fetch-json";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/ui";

type Doc = { id: string; title: string; engagement_type: string | null; delivery_model: string | null; created_at: string };

export default function ScopeListPage() {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<{ documents: Doc[] }>("/api/crm/scope?list=1").then(r => {
      if (r.ok) setDocs(r.data.documents); else setError(r.error);
    });
  }, []);

  return (
    <div className="p-4 md:p-8 pb-24 md:pb-8">
      <PageHeader title="Scope" description="Scope documents for leads and clients" />
      {error ? <ErrorState message={error} /> : !docs ? <LoadingState /> : docs.length === 0 ? (
        <EmptyState title="No scope documents yet." />
      ) : (
        <ul className="divide-y divide-brand-border bg-white border border-brand-border rounded-lg">
          {docs.map(d => (
            <li key={d.id}>
              <Link href={`/crm/scope/${d.id}`} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-brand-cream">
                <span className="font-medium text-brand-black truncate">{d.title}</span>
                <span className="text-xs text-brand-muted">{[d.engagement_type, d.delivery_model].filter(Boolean).join(" · ")}</span>
                <span className="ml-auto text-xs text-brand-muted shrink-0">{formatDistanceToNow(new Date(d.created_at), { addSuffix: true })}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
