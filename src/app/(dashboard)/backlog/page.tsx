"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BacklogItem, BacklogStatus, TaskPriority } from "@/types";
import { AgentBadge } from "@/components/AgentBadge";
import { formatDistanceToNow, parseISO } from "date-fns";
import clsx from "clsx";

const AREA_LABELS: Record<BacklogItem["affected_area"], string> = {
  workflow:       "Workflow",
  dashboard:      "Dashboard",
  content:        "Content",
  infrastructure: "Infra",
  agent:          "Agent",
};

const PRIORITY_STYLES: Record<TaskPriority, string> = {
  high:   "bg-red-50 text-red-700",
  medium: "bg-amber-50 text-amber-700",
  low:    "bg-gray-100 text-gray-600",
};

const PRIORITIES: TaskPriority[] = ["high", "medium", "low"];

// ─── Data hook ────────────────────────────────────────────────────────────────

function useBacklog() {
  const [items, setItems] = useState<BacklogItem[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const res = await fetch("/api/backlog");
    const data = await res.json();
    setItems(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
    const t = setInterval(reload, 30_000);
    return () => clearInterval(t);
  }, [reload]);

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      await fetch("/api/backlog", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await reload();
    },
    [reload]
  );

  return { items, loading, reload, patch };
}

// ─── Cards ────────────────────────────────────────────────────────────────────

function AreaBadge({ area }: { area: BacklogItem["affected_area"] }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium
                     bg-brand-offwhite text-brand-muted border border-brand-border">
      {AREA_LABELS[area]}
    </span>
  );
}

function PriorityBadge({ priority }: { priority?: TaskPriority | null }) {
  if (!priority) return null;
  return (
    <span className={clsx(
      "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium capitalize",
      PRIORITY_STYLES[priority]
    )}>
      {priority}
    </span>
  );
}

function CardMeta({ item }: { item: BacklogItem }) {
  return (
    <p className="text-[11px] text-brand-muted mt-1.5 capitalize">
      {item.suggested_by} · {formatDistanceToNow(parseISO(item.created_at), { addSuffix: true })}
    </p>
  );
}

function DocLink({ path }: { path?: string | null }) {
  if (!path) return null;
  return (
    <a
      href={`/documents?path=${encodeURIComponent(path)}`}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 mt-2 text-[11px] font-medium text-brand-orange hover:underline"
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
        <polyline points="13 2 13 9 20 9"/>
      </svg>
      View full spec
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="7 7 17 7 17 17"/><line x1="7" y1="17" x2="17" y2="7"/>
      </svg>
    </a>
  );
}

function InboxCard({
  item,
  selected,
  onToggleSelect,
  onApprove,
  onReject,
  onPriority,
}: {
  item: BacklogItem;
  selected: boolean;
  onToggleSelect: () => void;
  onApprove: () => void;
  onReject: () => void;
  onPriority: (p: TaskPriority) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  async function run(action: "approve" | "reject") {
    setBusy(action);
    try {
      if (action === "approve") await onApprove();
      else await onReject();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={clsx(
      "card p-3 border-l-4",
      selected ? "border-l-brand-orange bg-orange-50/30" : "border-l-transparent"
    )}>
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="mt-1 accent-brand-orange flex-shrink-0"
          aria-label={`Select ${item.title}`}
        />
        <AgentBadge agent={item.suggested_by} size="sm" />
        <div className="flex-1 min-w-0">
          <button
            className="w-full text-left"
            onClick={() => setExpanded(e => !e)}
          >
            <p className="text-sm font-medium text-brand-black leading-snug">{item.title}</p>
            <p className="text-xs text-brand-muted mt-0.5 line-clamp-2">{item.summary}</p>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <AreaBadge area={item.affected_area} />
              <PriorityBadge priority={item.priority} />
            </div>
            <CardMeta item={item} />
          </button>
          <DocLink path={item.doc_path} />
        </div>
      </div>

      {expanded && item.problem_detail && (
        <div className="mt-3 pt-3 border-t border-brand-border">
          <p className="text-[11px] uppercase tracking-wide text-brand-muted mb-1">Problem detail</p>
          <p className="text-xs text-brand-black whitespace-pre-wrap">{item.problem_detail}</p>
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-brand-border flex items-center gap-2 flex-wrap">
        <select
          value={item.priority ?? ""}
          onChange={(e) => {
            const v = e.target.value as TaskPriority | "";
            if (v) onPriority(v);
          }}
          className="text-[11px] px-2 py-1 border border-brand-border rounded-md bg-white
                     text-brand-black focus:outline-none focus:border-brand-orange"
          aria-label="Priority"
        >
          <option value="" disabled>priority…</option>
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <div className="flex-1" />
        <button
          onClick={() => run("approve")}
          disabled={busy !== null}
          className="px-3 py-1 rounded-md text-xs font-medium bg-brand-orange text-white
                     hover:bg-brand-orange-dark transition-colors disabled:opacity-50"
        >
          {busy === "approve" ? "…" : "Approve"}
        </button>
        <button
          onClick={() => run("reject")}
          disabled={busy !== null}
          className="px-3 py-1 rounded-md text-xs font-medium bg-white text-brand-muted
                     border border-brand-border hover:text-red-700 hover:border-red-200
                     transition-colors disabled:opacity-50"
        >
          {busy === "reject" ? "…" : "Reject"}
        </button>
      </div>
    </div>
  );
}

function ApprovedCard({
  item,
  bundleParent,
  onUnbundle,
  onBackToInbox,
  onAskJordan,
}: {
  item: BacklogItem;
  bundleParent?: boolean;
  onUnbundle: () => void;
  onBackToInbox: () => void;
  onAskJordan: () => Promise<string | null>;
}) {
  const [busy, setBusy] = useState<"unbundle" | "inbox" | "jordan" | null>(null);
  const [jordanError, setJordanError] = useState<string | null>(null);
  const [jordanRequestedAt, setJordanRequestedAt] = useState<number | null>(null);

  async function run(action: "unbundle" | "inbox") {
    setBusy(action);
    try {
      if (action === "unbundle") await onUnbundle();
      else await onBackToInbox();
    } finally {
      setBusy(null);
    }
  }

  async function askJordan() {
    setBusy("jordan");
    setJordanError(null);
    try {
      const err = await onAskJordan();
      if (err) {
        setJordanError(err);
      } else {
        setJordanRequestedAt(Date.now());
      }
    } finally {
      setBusy(null);
    }
  }

  // Jordan is fire-and-forget — the API returns in ~200ms, but the actual
  // write lands 30–60s later. Hold the "writing" state persistently until
  // the card moves to the Prompt Ready column (at which point this
  // component unmounts) or is manually dismissed.
  const jordanPending = jordanRequestedAt !== null && !jordanError;

  return (
    <div className={clsx(
      "card p-3",
      bundleParent && "border-brand-orange/40"
    )}>
      <div className="flex items-start gap-2">
        <AgentBadge agent={item.suggested_by} size="sm" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-brand-black leading-snug">{item.title}</p>
          <p className="text-xs text-brand-muted mt-0.5 line-clamp-2">{item.summary}</p>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <AreaBadge area={item.affected_area} />
            <PriorityBadge priority={item.priority} />
            {item.bundle_id && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px]
                               font-medium bg-brand-orange/10 text-brand-orange">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2.5" strokeLinecap="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                </svg>
                bundle #{item.bundle_id}
              </span>
            )}
          </div>
          <CardMeta item={item} />
          <DocLink path={item.doc_path} />
        </div>
      </div>
      <p className="mt-2 text-[11px] text-brand-muted italic">
        {jordanPending || busy === "jordan"
          ? "Jordan is writing the prompt… (this usually takes 30–60 s)"
          : "Waiting for Jordan to write prompt"}
      </p>
      {jordanError && (
        <p className="mt-1 text-[11px] text-red-600">{jordanError}</p>
      )}

      <div className="mt-3 pt-3 border-t border-brand-border flex items-center gap-2 flex-wrap">
        {item.bundle_id && (
          <button
            onClick={() => run("unbundle")}
            disabled={busy !== null}
            title="Remove this item from its bundle"
            className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-white text-brand-muted
                       border border-brand-border hover:text-brand-black
                       transition-colors disabled:opacity-50 inline-flex items-center gap-1"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18.84 12.25l1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M5.17 11.75l-1.72 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
              <line x1="8" y1="2" x2="8" y2="5"/>
              <line x1="2" y1="8" x2="5" y2="8"/>
              <line x1="16" y1="19" x2="16" y2="22"/>
              <line x1="19" y1="16" x2="22" y2="16"/>
            </svg>
            {busy === "unbundle" ? "…" : "Unbundle"}
          </button>
        )}
        <button
          onClick={() => run("inbox")}
          disabled={busy !== null}
          title="Send back to Inbox for re-triage"
          className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-white text-brand-muted
                     border border-brand-border hover:text-brand-black
                     transition-colors disabled:opacity-50 inline-flex items-center gap-1"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          {busy === "inbox" ? "…" : "Inbox"}
        </button>
        <div className="flex-1" />
        <button
          onClick={askJordan}
          disabled={busy !== null || jordanPending}
          title={jordanPending
            ? "Jordan is already writing a prompt for this item"
            : "Ask Jordan to write a Claude Code prompt for this item"}
          className="px-3 py-1 rounded-md text-[11px] font-medium bg-brand-orange text-white
                     hover:bg-brand-orange-dark transition-colors disabled:opacity-50
                     inline-flex items-center gap-1"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          {busy === "jordan" ? "Sending…" : jordanPending ? "Jordan working" : "Ask Jordan"}
        </button>
      </div>
    </div>
  );
}

function PromptReadyCard({
  item,
  onStart,
}: {
  item: BacklogItem;
  onStart: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  async function copy() {
    if (!item.claude_code_prompt) return;
    await navigator.clipboard.writeText(item.claude_code_prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function start() {
    setBusy(true);
    try { await onStart(); } finally { setBusy(false); }
  }

  return (
    <div className="card p-3 border-l-4 border-l-green-500">
      <div className="flex items-start gap-2">
        <AgentBadge agent={item.suggested_by} size="sm" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-brand-black leading-snug">{item.title}</p>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <AreaBadge area={item.affected_area} />
            <PriorityBadge priority={item.priority} />
            {item.bundle_id && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px]
                               font-medium bg-brand-orange/10 text-brand-orange">
                bundle #{item.bundle_id}
              </span>
            )}
          </div>
          {item.prompt_ready_at && (
            <p className="text-[11px] text-brand-muted mt-1.5">
              ready {formatDistanceToNow(parseISO(item.prompt_ready_at), { addSuffix: true })}
            </p>
          )}
          <DocLink path={item.doc_path} />
        </div>
      </div>

      {item.arch_notes && (
        <div className="mt-3">
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-[11px] uppercase tracking-wide text-brand-muted hover:text-brand-black"
          >
            {expanded ? "▾" : "▸"} arch notes
          </button>
          {expanded && (
            <p className="mt-1 text-xs text-brand-black whitespace-pre-wrap">
              {item.arch_notes}
            </p>
          )}
        </div>
      )}

      {expanded && item.claude_code_prompt && (
        <pre className="mt-2 text-[11px] bg-brand-black text-white p-3 rounded-md
                        overflow-x-auto whitespace-pre-wrap max-h-64">
{item.claude_code_prompt}
        </pre>
      )}

      <div className="mt-3 pt-3 border-t border-brand-border flex items-center gap-2">
        <button
          onClick={copy}
          disabled={!item.claude_code_prompt}
          className={clsx(
            "px-3 py-1 rounded-md text-xs font-medium transition-colors disabled:opacity-50",
            copied
              ? "bg-green-600 text-white"
              : "bg-brand-orange text-white hover:bg-brand-orange-dark"
          )}
        >
          {copied ? "✓ Copied" : "Copy Prompt"}
        </button>
        <button
          onClick={start}
          disabled={busy}
          className="px-3 py-1 rounded-md text-xs font-medium bg-white text-brand-muted
                     border border-brand-border hover:text-brand-black
                     transition-colors disabled:opacity-50"
        >
          {busy ? "…" : "Mark In Progress"}
        </button>
      </div>
    </div>
  );
}

function DoneCard({
  item,
  onComplete,
}: {
  item: BacklogItem;
  onComplete?: () => void;
}) {
  const isActive = item.status === "in_progress";
  const [busy, setBusy] = useState(false);

  async function complete() {
    if (!onComplete) return;
    setBusy(true);
    try { await onComplete(); } finally { setBusy(false); }
  }

  const statusStyles: Record<BacklogStatus, string> = {
    done:        "bg-green-50 text-green-700",
    rejected:    "bg-gray-100 text-gray-500",
    in_progress: "bg-amber-50 text-amber-700",
    inbox:       "",
    approved:    "",
    bundled:     "",
    prompt_ready:"",
  };

  return (
    <div className={clsx("card p-3", isActive ? "border-l-4 border-l-amber-500" : "opacity-80")}>
      <div className="flex items-start gap-2">
        <AgentBadge agent={item.suggested_by} size="sm" />
        <div className="flex-1 min-w-0">
          <p className={clsx("text-sm leading-snug", isActive ? "font-medium text-brand-black" : "text-brand-black")}>
            {item.title}
          </p>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span className={clsx(
              "text-[10px] px-2 py-0.5 rounded font-medium capitalize",
              statusStyles[item.status]
            )}>
              {item.status.replace("_", " ")}
            </span>
            <AreaBadge area={item.affected_area} />
          </div>
          <CardMeta item={item} />
          <DocLink path={item.doc_path} />
        </div>
        {isActive && onComplete && (
          <button
            onClick={complete}
            disabled={busy}
            className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-white text-brand-muted
                       border border-brand-border hover:text-green-700 hover:border-green-200
                       transition-colors disabled:opacity-50 flex-shrink-0"
          >
            {busy ? "…" : "Done"}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Column scaffolding ──────────────────────────────────────────────────────

function Column({
  title,
  count,
  children,
  emptyText,
  empty,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  emptyText: string;
  empty: boolean;
}) {
  return (
    <section className="flex flex-col min-w-0">
      <header className="flex items-center justify-between mb-3 px-1">
        <h2 className="text-sm font-semibold text-brand-black">{title}</h2>
        <span className="text-[11px] text-brand-muted">{count}</span>
      </header>
      <div className="space-y-2.5">
        {empty ? (
          <div className="card py-8 text-center">
            <p className="text-xs text-brand-muted">{emptyText}</p>
          </div>
        ) : children}
      </div>
    </section>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function BacklogPage() {
  const { items, loading, patch, reload } = useBacklog();
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const grouped = useMemo(() => {
    const inbox       = items.filter(i => i.status === "inbox");
    const approved    = items.filter(i => i.status === "approved" || i.status === "bundled");
    const promptReady = items.filter(i => i.status === "prompt_ready");
    const done        = items
      .filter(i => ["done", "rejected", "in_progress"].includes(i.status))
      .sort((a, b) => {
        // in_progress always first
        const rank = (s: BacklogStatus) => (s === "in_progress" ? 0 : 1);
        return rank(a.status) - rank(b.status);
      });
    return { inbox, approved, promptReady, done };
  }, [items]);

  // Group approved items by bundle
  const approvedGroups = useMemo(() => {
    const solo: BacklogItem[] = [];
    const bundles: Record<number, BacklogItem[]> = {};
    for (const item of grouped.approved) {
      if (item.bundle_id) {
        bundles[item.bundle_id] ??= [];
        bundles[item.bundle_id].push(item);
      } else {
        solo.push(item);
      }
    }
    return { solo, bundles };
  }, [grouped.approved]);

  function toggleSelect(id: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function approve(id: number) {
    await patch({ id, status: "approved" });
    setSelected(prev => { const next = new Set(prev); next.delete(id); return next; });
  }

  async function reject(id: number) {
    await patch({ id, status: "rejected" });
    setSelected(prev => { const next = new Set(prev); next.delete(id); return next; });
  }

  async function setPriority(id: number, priority: TaskPriority) {
    await patch({ id, priority });
  }

  async function bundleSelected() {
    const ids = Array.from(selected);
    if (ids.length < 2) return;
    const bundleParent = Math.min(...ids);
    await patch({ ids, status: "approved", bundle_id: bundleParent });
    setSelected(new Set());
  }

  async function markInProgress(id: number) {
    await patch({ id, status: "in_progress" });
  }

  async function markDone(id: number) {
    await patch({ id, status: "done" });
  }

  // Unbundle a single item. If only one other item shares the bundle,
  // dissolve it entirely (a bundle of one is nonsensical).
  async function unbundle(id: number) {
    const target = items.find(i => i.id === id);
    const bundleId = target?.bundle_id;
    if (!bundleId) {
      await patch({ id, bundle_id: null });
      return;
    }
    const siblings = items.filter(i => i.bundle_id === bundleId && i.id !== id);
    if (siblings.length === 1) {
      // Auto-dissolve: also unlink the one remaining sibling.
      await patch({ ids: [id, siblings[0].id], bundle_id: null });
    } else {
      await patch({ id, bundle_id: null });
    }
  }

  // Send an approved item back to Inbox for re-triage.
  // Drops the bundle link too — an inbox item shouldn't belong to an
  // approved bundle. Server-side also nulls approved_at.
  async function sendToInbox(id: number) {
    await patch({ id, status: "inbox", bundle_id: null });
  }

  // Fire the dashboard → Jordan /chat bridge. Returns null on success, an
  // error string otherwise. The card shows "Jordan is writing the prompt…"
  // while this is pending; on completion the 30s poll (or the reload below)
  // surfaces the prompt_ready state.
  async function askJordan(id: number): Promise<string | null> {
    try {
      const res = await fetch("/api/backlog/ask-jordan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return data.error || `Jordan request failed (HTTP ${res.status})`;
      }
      await reload();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Network error";
    }
  }

  if (loading) {
    return (
      <div className="p-4 md:p-8 pt-16 md:pt-8">
        <div className="h-8 w-40 bg-brand-border rounded animate-pulse mb-6" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card animate-pulse h-64" />
          ))}
        </div>
      </div>
    );
  }

  const selectedCount = selected.size;

  return (
    <div className="p-4 md:p-8 pt-16 md:pt-8 pb-24 md:pb-8">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-brand-black">Tool Backlog</h1>
          <p className="text-sm text-brand-muted mt-0.5">
            Agent-logged enhancement ideas. Triage inbox → approve → Jordan writes the prompt.
          </p>
        </div>
        {selectedCount >= 2 && (
          <button
            onClick={bundleSelected}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-brand-orange text-white
                       hover:bg-brand-orange-dark transition-colors flex items-center gap-1.5"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.5" strokeLinecap="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
            Bundle {selectedCount} selected
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Column
          title="Inbox"
          count={grouped.inbox.length}
          empty={grouped.inbox.length === 0}
          emptyText="No new ideas — agents are watching."
        >
          {grouped.inbox.map(item => (
            <InboxCard
              key={item.id}
              item={item}
              selected={selected.has(item.id)}
              onToggleSelect={() => toggleSelect(item.id)}
              onApprove={() => approve(item.id)}
              onReject={() => reject(item.id)}
              onPriority={(p) => setPriority(item.id, p)}
            />
          ))}
        </Column>

        <Column
          title="Approved"
          count={grouped.approved.length}
          empty={grouped.approved.length === 0}
          emptyText="Nothing approved yet."
        >
          {/* Bundles first (ordered by lowest bundle id) */}
          {Object.entries(approvedGroups.bundles)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([bid, rows]) => (
              <div key={bid} className="rounded-xl border border-brand-orange/30 bg-brand-orange/5 p-2 space-y-2">
                <p className="text-[11px] uppercase tracking-wide text-brand-orange font-medium px-1">
                  Bundle #{bid} · {rows.length} items
                </p>
                {rows.map((r, i) => (
                  <ApprovedCard
                    key={r.id}
                    item={r}
                    bundleParent={i === 0}
                    onUnbundle={() => unbundle(r.id)}
                    onBackToInbox={() => sendToInbox(r.id)}
                    onAskJordan={() => askJordan(r.id)}
                  />
                ))}
              </div>
            ))}
          {approvedGroups.solo.map(item => (
            <ApprovedCard
              key={item.id}
              item={item}
              onUnbundle={() => unbundle(item.id)}
              onBackToInbox={() => sendToInbox(item.id)}
              onAskJordan={() => askJordan(item.id)}
            />
          ))}
        </Column>

        <Column
          title="Prompt Ready"
          count={grouped.promptReady.length}
          empty={grouped.promptReady.length === 0}
          emptyText="Jordan hasn't written a prompt yet."
        >
          {grouped.promptReady.map(item => (
            <PromptReadyCard
              key={item.id}
              item={item}
              onStart={() => markInProgress(item.id)}
            />
          ))}
        </Column>

        <Column
          title="Done"
          count={grouped.done.length}
          empty={grouped.done.length === 0}
          emptyText="No completed or rejected items."
        >
          {grouped.done.map(item => (
            <DoneCard
              key={item.id}
              item={item}
              onComplete={item.status === "in_progress" ? () => markDone(item.id) : undefined}
            />
          ))}
        </Column>
      </div>
    </div>
  );
}
