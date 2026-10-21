"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchJson } from "@/lib/fetch-json";

/** Shows a "Scope" link when a scope document exists for this lead or client. */
export function ScopeLink({ leadId, clientId, className = "btn-ghost text-xs px-2 py-1" }: { leadId?: string | null; clientId?: string | null; className?: string }) {
  const [docId, setDocId] = useState<string | null>(null);
  useEffect(() => {
    const qs = leadId ? `lead_id=${leadId}` : clientId ? `client_id=${clientId}` : "";
    if (!qs) return;
    let live = true;
    fetchJson<{ document: { id: string } | null }>(`/api/crm/scope?${qs}`).then((r) => {
      if (live && r.ok) setDocId(r.data.document?.id ?? null);
    });
    return () => { live = false; };
  }, [leadId, clientId]);
  if (!docId) return null;
  return <Link href={`/crm/scope/${docId}`} className={className}>Scope</Link>;
}
