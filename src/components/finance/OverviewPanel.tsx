"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ApprovalCard } from "@/components/ApprovalCard";
import { PendingApproval } from "@/types";

interface StatCard {
  label: string;
  value: string | null;
  sub: string;
  error: boolean;
  href?: string;
}

function parseKickNet(summary: string | null | undefined): string | null {
  if (!summary) return null;
  const m = summary.match(/net=\$([\d,.-]+)/);
  return m ? `$${m[1]}` : null;
}

export function OverviewPanel() {
  const [stats, setStats] = useState<StatCard[]>([
    { label: "Business Net (MTD)", value: null, sub: "via Kick", error: false },
    { label: "Stripe MRR",         value: null, sub: "live subscriptions", error: false },
    { label: "AI Cost (7d)",       value: null, sub: "across all agents", error: false },
    { label: "Sam Pending",        value: null, sub: "actions awaiting review", error: false },
  ]);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [kickRes, stripeRes, usageRes, approvalsRes] = await Promise.allSettled([
      fetch("/api/kick/status").then(r => r.json()),
      fetch("/api/stripe/dashboard?mode=live", { signal: AbortSignal.timeout(10000) }).then(r => r.json()),
      fetch("/api/usage").then(r => r.json()),
      fetch("/api/approvals").then(r => r.json()),
    ]);

    const kick    = kickRes.status    === "fulfilled" ? kickRes.value    : null;
    const stripe  = stripeRes.status  === "fulfilled" ? stripeRes.value  : null;
    const usage   = usageRes.status   === "fulfilled" ? usageRes.value   : null;
    const allApps = approvalsRes.status === "fulfilled" ? approvalsRes.value : [];

    const samPending: PendingApproval[] = Array.isArray(allApps)
      ? allApps.filter((a: PendingApproval) => a.agent === "sam" && a.status === "pending")
      : [];

    const kickNet = kick?.connected ? parseKickNet(kick.summary) : null;
    const mrr     = stripe?.mrr != null
      ? `$${(stripe.mrr / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`
      : null;
    const aiCost  = usage?.agents
      ? `$${(usage.agents as { weekCost: number }[]).reduce((s, a) => s + (a.weekCost ?? 0), 0).toFixed(4)}`
      : null;

    setStats([
      { label: "Business Net (MTD)", value: kickNet,                    sub: kick?.connected ? "via Kick" : "Kick offline",   error: !kick?.connected,        href: "?tab=bookkeeping"  },
      { label: "Stripe MRR",         value: mrr,                        sub: "live subscriptions",                             error: !stripe || !!stripe.error, href: "?tab=stripe"       },
      { label: "AI Cost (7d)",       value: aiCost,                     sub: "across all agents",                              error: !usage || !!usage.error,   href: "?tab=cost"         },
      { label: "Sam Pending",        value: String(samPending.length),  sub: samPending.length === 1 ? "action awaiting review" : "actions awaiting review", error: false, href: "?tab=sam-actions" },
    ]);
    setApprovals(samPending);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, [load]);

  async function handleApproval(
    id: string,
    status: "approved" | "rejected" | "revision_requested",
    revisionNotes?: string,
    _selectedItems?: string[],
  ) {
    const r = await fetch("/api/approvals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, revision_notes: revisionNotes }),
    });
    if (r.ok) {
      setApprovals(prev => prev.filter(a => a.id !== id));
      setStats(prev => prev.map(s =>
        s.label === "Sam Pending"
          ? { ...s, value: String(Math.max(0, Number(s.value) - 1)) }
          : s
      ));
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl pb-24 md:pb-8">
      {/* Stat row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {stats.map(s => (
          <div key={s.label} className="card">
            <p className="text-xs text-brand-muted mb-1">{s.label}</p>
            {loading ? (
              <div className="h-7 bg-brand-offwhite rounded animate-pulse w-20" />
            ) : (
              <p className={`text-2xl font-semibold ${s.error || s.value === null ? "text-brand-muted" : "text-brand-black"}`}>
                {s.value ?? "—"}
              </p>
            )}
            <p className="text-[10px] text-brand-muted mt-0.5">{s.sub}</p>
            {s.href && !loading && (
              <Link href={s.href} className="text-[10px] text-brand-orange hover:underline mt-1 block">
                View →
              </Link>
            )}
          </div>
        ))}
      </div>

      {/* Sam inbox */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-brand-black">
            Sam — Pending Actions
            {approvals.length > 0 && (
              <span className="ml-2 text-xs text-brand-muted font-normal">{approvals.length} waiting</span>
            )}
          </h2>
          <Link href="?tab=sam-actions" className="text-xs text-brand-orange hover:underline">
            All approvals →
          </Link>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2].map(i => <div key={i} className="card animate-pulse h-28" />)}
          </div>
        ) : approvals.length === 0 ? (
          <div className="card text-center py-6">
            <p className="text-sm text-brand-muted">No pending Sam actions</p>
            <p className="text-xs text-brand-muted mt-1">Sam is running autonomously</p>
          </div>
        ) : (
          <div className="space-y-3">
            {approvals.slice(0, 5).map(a => (
              <ApprovalCard key={a.id} approval={a} onAction={handleApproval} isAdmin />
            ))}
            {approvals.length > 5 && (
              <Link href="?tab=sam-actions" className="block text-center text-xs text-brand-orange py-2 hover:underline">
                +{approvals.length - 5} more →
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
