"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ApprovalCard } from "@/components/ApprovalCard";
import { PendingApproval } from "@/types";

export default function FinancePage() {
  const [samApprovals, setSamApprovals] = useState<PendingApproval[]>([]);
  const [usage, setUsage]               = useState<{ totalCost: number; agents: { agent: string; todayCost: number; monthCost: number }[] } | null>(null);
  const [loading, setLoading]           = useState(true);

  const load = useCallback(async () => {
    const [approvals, usageData] = await Promise.all([
      fetch("/api/approvals").then(r => r.json()).catch(() => []),
      fetch("/api/usage?days=30").then(r => r.json()).catch(() => null),
    ]);

    const samOnly = Array.isArray(approvals)
      ? approvals.filter((a: PendingApproval) => a.agent === "sam")
      : [];
    setSamApprovals(samOnly);

    if (usageData?.agents) {
      const agents = usageData.agents as { agent: string; todayCost: number; monthCost: number }[];
      const totalCost = agents.reduce((sum, a) => sum + (a.monthCost ?? 0), 0);
      setUsage({ totalCost, agents });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, [load]);

  async function handleApproval(id: string, status: "approved" | "rejected" | "revision_requested", revisionNotes?: string) {
    await fetch("/api/approvals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, ...(revisionNotes ? { revision_notes: revisionNotes } : {}) }),
    });
    setSamApprovals(prev => prev.filter(a => a.id !== id));
  }

  if (loading) {
    return (
      <div className="p-4 md:p-8 space-y-4">
        {[1,2].map(i => <div key={i} className="card animate-pulse h-32" />)}
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl pb-24 md:pb-8">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <h1 className="text-xl font-semibold text-brand-black">Finance</h1>
        <Link href="/cost" className="text-xs text-brand-orange hover:underline">
          Full AI cost report →
        </Link>
      </div>

      <div className="space-y-4">

        {/* AI cost summary */}
        <div className="card p-4">
          <p className="text-sm font-medium text-brand-black mb-3">AI Cost (30 days)</p>
          {usage ? (
            <>
              <p className="text-2xl font-semibold text-brand-black">${usage.totalCost.toFixed(4)}</p>
              <p className="text-xs text-brand-muted mt-0.5 mb-3">across all agents</p>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {usage.agents.map(a => (
                  <div key={a.agent} className="rounded-lg bg-brand-offwhite px-3 py-2">
                    <p className="text-[10px] text-brand-muted capitalize">{a.agent}</p>
                    <p className="text-sm font-medium text-brand-black">${(a.monthCost ?? 0).toFixed(4)}</p>
                    <p className="text-[10px] text-brand-muted">today ${(a.todayCost ?? 0).toFixed(4)}</p>
                  </div>
                ))}
              </div>
              <Link href="/cost" className="block mt-3 text-xs text-brand-orange hover:underline">
                View detailed cost breakdown by model and agent →
              </Link>
            </>
          ) : (
            <p className="text-sm text-brand-muted">Cost data unavailable (LiteLLM not configured)</p>
          )}
        </div>

        {/* Sam pending approvals */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-brand-black">
              Sam — Pending Actions
              {samApprovals.length > 0 && (
                <span className="ml-2 text-xs text-brand-muted font-normal">
                  {samApprovals.length} waiting
                </span>
              )}
            </h2>
            <Link href="/approvals?agent=sam" className="text-xs text-brand-orange hover:underline">
              All approvals →
            </Link>
          </div>
          {samApprovals.length === 0 ? (
            <div className="card text-center py-6">
              <p className="text-sm text-brand-muted">No pending Sam actions</p>
              <p className="text-xs text-brand-muted mt-1">Sam is running autonomously</p>
            </div>
          ) : (
            <div className="space-y-3">
              {samApprovals.slice(0, 5).map(a => (
                <ApprovalCard key={a.id} approval={a} onAction={handleApproval} isAdmin />
              ))}
              {samApprovals.length > 5 && (
                <Link href="/approvals" className="block text-center text-xs text-brand-orange py-2 hover:underline">
                  +{samApprovals.length - 5} more →
                </Link>
              )}
            </div>
          )}
        </div>

        {/* Finance links */}
        <div className="card p-4">
          <p className="text-sm font-medium text-brand-black mb-3">Finance Links</p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "AI Cost Report",   href: "/cost",    desc: "LiteLLM spend by model" },
              { label: "Billing",          href: "/billing", desc: "Subscription & invoices" },
            ].map(l => (
              <Link key={l.href} href={l.href}
                className="p-3 rounded-lg border border-brand-border hover:border-brand-orange/40 hover:bg-brand-offwhite/50 transition-all">
                <p className="text-sm font-medium text-brand-black">{l.label}</p>
                <p className="text-xs text-brand-muted mt-0.5">{l.desc}</p>
              </Link>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
