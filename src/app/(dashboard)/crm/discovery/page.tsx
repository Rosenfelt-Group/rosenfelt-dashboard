"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";
import { CRMNav } from "@/components/CRMNav";
import { NewDiscoveryModal } from "@/components/crm/NewDiscoveryModal";
import { CopyButton } from "@/components/crm/CopyButton";
import { DiscoveryInvite, DiscoveryStatus } from "@/types";
import { PROJECT_TYPES, STATUS_META } from "@/lib/discovery";

type Row = DiscoveryInvite & { link: string };

const FILTERS: { value: DiscoveryStatus | "active" | ""; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "submitted", label: "Submitted" },
  { value: "archived", label: "Archived" },
  { value: "", label: "All" },
];

function briefBadge(row: Row) {
  const live = (row.briefs ?? []).find(b => b.status === "ready" || b.status === "pending")
    ?? [...(row.briefs ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!live) return null;
  const map = { ready: "badge-success", pending: "badge-warning", failed: "badge-error", superseded: "badge-neutral" } as const;
  const label = { ready: "Brief ready", pending: "Brief generating", failed: "Brief failed", superseded: "Brief" } as const;
  return <span className={clsx(map[live.status], "text-xs")}>{label[live.status]}</span>;
}

function DiscoveryList() {
  const params = useSearchParams();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<DiscoveryStatus | "active" | "">("active");
  const [showNew, setShowNew] = useState(params.get("new") === "1");

  const load = useCallback(() => {
    fetch("/api/crm/discovery").then(r => r.json()).then(d => { setRows(Array.isArray(d) ? d : []); setLoading(false); });
  }, []);
  useEffect(load, [load]);

  const visible = rows.filter(r =>
    filter === "" ? true : filter === "active" ? r.status !== "archived" && r.status !== "submitted" : r.status === filter);
  const counts = {
    waiting: rows.filter(r => ["sent", "opened", "in_progress"].includes(r.status)).length,
    submitted: rows.filter(r => r.status === "submitted").length,
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl pb-24 md:pb-8">
      <CRMNav />
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-brand-black">Discovery</h1>
          <p className="text-sm text-brand-muted">Pre-call questionnaires · {counts.waiting} waiting · {counts.submitted} submitted</p>
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary text-sm">+ New discovery</button>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {FILTERS.map(f => (
          <button key={f.label} onClick={() => setFilter(f.value)}
            className={clsx("badge cursor-pointer", filter === f.value ? "bg-brand-black text-white" : "badge-neutral")}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card animate-pulse h-40" />
      ) : visible.length === 0 ? (
        <div className="card text-sm text-brand-muted">
          {rows.length === 0 ? "No discovery questionnaires yet. Create one to send to an organization before your first call." : "Nothing in this view."}
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          {visible.map(r => {
            const st = STATUS_META[r.status];
            const type = PROJECT_TYPES.find(t => t.value === r.project_type)?.label;
            const last = r.submitted_at ?? r.last_saved_at ?? r.opened_at ?? r.sent_at ?? r.created_at;
            return (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3 border-b border-brand-border last:border-b-0 hover:bg-brand-offwhite">
                <Link href={`/crm/discovery/${r.id}`} className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-brand-black truncate">{r.business?.name ?? "—"}</p>
                  <p className="text-xs text-brand-muted truncate">{r.project_title} · {type}</p>
                </Link>
                <div className="hidden md:flex items-center gap-2">
                  <span className={clsx("badge text-xs", st.color)}>{st.label}</span>
                  {briefBadge(r)}
                </div>
                <span className="hidden sm:block text-xs text-brand-muted w-28 text-right">
                  {formatDistanceToNow(new Date(last), { addSuffix: true })}
                </span>
                {r.status !== "submitted" && r.status !== "archived" && <CopyButton text={r.link} label="Copy link" />}
              </div>
            );
          })}
        </div>
      )}

      {showNew && (
        <NewDiscoveryModal
          initialLeadId={params.get("lead_id") ?? undefined}
          onClose={() => setShowNew(false)}
          onCreated={load}
        />
      )}
    </div>
  );
}

export default function DiscoveryPage() {
  return (
    <Suspense fallback={<div className="p-8"><div className="card animate-pulse h-40" /></div>}>
      <DiscoveryList />
    </Suspense>
  );
}
