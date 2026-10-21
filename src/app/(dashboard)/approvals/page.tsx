"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PendingApproval } from "@/types";
import { can } from "@/lib/permissions";
import { ApprovalCard, LinkedInCarouselDetail } from "@/components/ApprovalCard";
import { AgentBadge } from "@/components/AgentBadge";
import { formatDistanceToNow, parseISO } from "date-fns";
import clsx from "clsx";
import { usePolling } from "@/lib/use-polling";
import { EmptyState, ErrorState, LoadingState, PageHeader, Tabs } from "@/components/ui";

const STATUS_STYLES = {
  approved:            "bg-green-50 text-green-700",
  rejected:            "bg-red-50 text-red-700",
  revision_requested:  "bg-amber-50 text-amber-700",
  expired:             "bg-gray-100 text-gray-500",
  pending:             "bg-amber-50 text-amber-700",
  executing:           "bg-blue-50 text-blue-700",
  done:                "bg-green-50 text-green-700",
  failed:              "bg-red-50 text-red-700",
};

const STATUS_LABELS: Record<string, string> = {
  approved:           "Approved",
  rejected:           "Rejected",
  revision_requested: "Revision",
  expired:            "Expired",
  pending:            "Pending",
  executing:          "Executing",
  done:               "Done",
  failed:             "Failed",
};

function HistoryRow({ item }: { item: PendingApproval }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border-b border-brand-border last:border-0">
      <button
        className="w-full text-left px-4 py-3 hover:bg-brand-offwhite transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-3">
          <AgentBadge agent={item.agent} size="sm" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-brand-black truncate">{item.title}</p>
            {item.description && !expanded && (
              <p className="text-xs text-brand-muted truncate">{item.description}</p>
            )}
          </div>
          <span className={clsx(
            "text-xs px-2 py-0.5 rounded font-medium flex-shrink-0",
            STATUS_STYLES[item.status] ?? "bg-gray-100 text-gray-500"
          )}>
            {STATUS_LABELS[item.status] ?? item.status}
          </span>
          <span className="text-xs text-brand-muted flex-shrink-0">
            {formatDistanceToNow(parseISO(item.created_at), { addSuffix: true })}
          </span>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-3 bg-brand-offwhite space-y-2">
          {item.description && <p className="text-xs text-brand-black">{item.description}</p>}
          <div className="flex gap-4 text-xs text-brand-muted">
            <span>Type: <span className="text-brand-black">{item.action_type}</span></span>
            <span>Agent: <span className="text-brand-black capitalize">{item.agent}</span></span>
          </div>
          {item.action_type === "linkedin_carousel" && (
            <LinkedInCarouselDetail payload={item.payload} />
          )}
        </div>
      )}
    </div>
  );
}

export default function ApprovalsPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<div className="p-4 md:p-8"><LoadingState /></div>}>
      <ApprovalsContent />
    </Suspense>
  );
}

function ApprovalsContent() {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();
  const [pending,      setPending]      = useState<PendingApproval[]>([]);
  const [history,      setHistory]      = useState<PendingApproval[]>([]);
  const [tab,          setTab]          = useState<"pending" | "history">("pending");
  const [loading,      setLoading]      = useState(true);
  // The agent filter lives in the URL (?agent=sam, e.g. linked from Finance)
  // and applies to both tabs.
  const agentFilter = searchParams.get("agent") || "all";
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [permissions, setPermissions] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.permissions) setPermissions(data.permissions); })
      .catch(() => {});
  }, []);

  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(async (silent = false) => {
    try {
      const [pr, hr] = await Promise.all([fetch("/api/approvals"), fetch("/api/approvals?history=true")]);
      if (!pr.ok || !hr.ok) throw new Error(`HTTP ${pr.ok ? hr.status : pr.status}`);
      const [p, h] = await Promise.all([pr.json(), hr.json()]);
      setPending(Array.isArray(p) ? p : []);
      setHistory(Array.isArray(h) ? h.filter((x: PendingApproval) => x.status !== "pending") : []);
      setLoadError(null);
    } catch (e) {
      if (!silent) setLoadError(e instanceof Error ? e.message : "Failed to load approvals");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  // Pick up approvals created by agents or resolved elsewhere (another tab, Telegram).
  usePolling(() => load(true), 10_000);

  async function handleApproval(
    id: string,
    status: "approved" | "rejected" | "revision_requested",
    revisionNotes?: string,
    selectedItems?: string[],
  ) {
    const res = await fetch("/api/approvals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, revision_notes: revisionNotes, selected_items: selectedItems }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(`Failed: ${body?.error ?? `HTTP ${res.status}`}`);
      return;
    }
    // Remove from pending immediately; Realtime UPDATE will add it to history
    const approved = pending.find(a => a.id === id);
    setPending(prev => prev.filter(a => a.id !== id));

    // An approved email_send is sent by the executor, not by the PATCH above.
    if (status === "approved" && approved?.action_type === "email_send") {
      try {
        const er = await fetch(`/api/approvals/${id}/execute`, { method: "POST" });
        const eb = await er.json().catch(() => ({}));
        if (er.ok && eb?.status === "done") alert("Email sent.");
        else alert(`Email NOT sent: ${eb?.error ?? eb?.status ?? `HTTP ${er.status}`}`);
      } catch (e) {
        alert(`Email NOT sent: ${e instanceof Error ? e.message : "request failed"}`);
      }
      load(true);
    }
  }

  function setAgentFilter(agent: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (agent === "all") params.delete("agent"); else params.set("agent", agent);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const agents = Array.from(new Set<string>([
    ...pending.map(p => p.agent),
    ...history.map(h => h.agent),
    ...(agentFilter !== "all" ? [agentFilter] : []),
  ])).sort();

  const filteredPending = pending.filter(p => agentFilter === "all" || p.agent === agentFilter);

  const filteredHistory = history
    .filter(h => agentFilter  === "all" || h.agent  === agentFilter)
    .filter(h => statusFilter === "all" || h.status === statusFilter);

  if (loading) {
    return (
      <div className="p-4 md:p-8">
        <LoadingState />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-4 md:p-8">
        <ErrorState message={`Couldn't load approvals: ${loadError}`} onRetry={() => load()} />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 pb-24 md:pb-8 max-w-4xl space-y-5">
      <PageHeader title="Approvals" description={`${pending.length} pending · ${history.length} in history`} />

      {/* Tab switcher */}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "pending", label: `Pending (${filteredPending.length})` },
          { id: "history", label: `History (${history.length})` },
        ]}
      />

      {/* Agent filter — shared by both tabs */}
      {agents.length > 0 && (
        <div className="flex gap-1 flex-wrap" role="group" aria-label="Filter by agent">
          {(["all", ...agents] as string[]).map(a => (
            <button key={a} onClick={() => setAgentFilter(a)}
              aria-pressed={agentFilter === a}
              className={clsx(
                "px-2.5 py-1 rounded-full text-xs capitalize transition-colors",
                agentFilter === a ? "bg-brand-orange text-white" : "bg-brand-offwhite text-brand-muted hover:bg-brand-border"
              )}>
              {a}
            </button>
          ))}
        </div>
      )}

      {/* ── PENDING ── */}
      {tab === "pending" && (
        <>
          {filteredPending.length === 0 ? (
            <div className="card flex flex-col items-center justify-center py-16 text-center">
              <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center mb-4">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/>
                </svg>
              </div>
              <p className="text-sm font-medium text-brand-black mb-1">All caught up</p>
              <p className="text-xs text-brand-muted">
                {agentFilter === "all" ? "No approvals waiting" : `No approvals waiting from ${agentFilter}`}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredPending.map(a => (
                <ApprovalCard key={a.id} approval={a} onAction={handleApproval} isAdmin={can(permissions, "manage_approvals")} />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── HISTORY ── */}
      {tab === "history" && (
        <div className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            <div className="flex gap-1 flex-wrap">
              {(["all", "approved", "revision_requested", "rejected", "expired", "done", "failed"] as const).map(s => (
                <button key={s} onClick={() => setStatusFilter(s)}
                  className={clsx(
                    "px-2.5 py-1 rounded-full text-xs capitalize transition-colors",
                    statusFilter === s ? "bg-brand-orange text-white" : "bg-brand-offwhite text-brand-muted hover:bg-brand-border"
                  )}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {filteredHistory.length === 0 ? (
            <EmptyState title="No history yet" />
          ) : (
            <div className="card p-0 overflow-hidden">
              {filteredHistory.map(item => <HistoryRow key={item.id} item={item} />)}
            </div>
          )}
          <p className="text-xs text-brand-muted text-right">
            Showing {filteredHistory.length} of {history.length}
          </p>
        </div>
      )}
    </div>
  );
}
