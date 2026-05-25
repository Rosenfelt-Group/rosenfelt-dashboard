"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { supabase } from "@/lib/supabase";
import { AgentBadge } from "@/components/AgentBadge";
import { WorkLogPanel } from "@/components/work/WorkLogPanel";
import { WorkDocsPanel } from "@/components/work/WorkDocsPanel";
import { SourceBadge } from "@/components/work/SourceBadge";
import type {
  AgentName,
  TaskPriority,
  WorkItem,
  WorkStatus,
  WorkType,
} from "@/types";

const STATUS_OPTIONS: WorkStatus[] = [
  "inbox", "approved", "prompt_ready", "in_progress", "open",
  "on_hold", "done", "deferred", "cancelled", "rejected",
];

const STATUS_PILL: Record<WorkStatus, string> = {
  inbox:        "bg-gray-100 text-gray-700",
  approved:     "bg-blue-100 text-blue-700",
  prompt_ready: "bg-violet-100 text-violet-700",
  in_progress:  "bg-amber-100 text-amber-700",
  open:         "bg-slate-100 text-slate-700",
  on_hold:      "bg-indigo-100 text-indigo-700",
  done:         "bg-green-100 text-green-700",
  deferred:     "bg-yellow-100 text-yellow-800",
  cancelled:    "bg-gray-200 text-gray-600",
  rejected:     "bg-red-100 text-red-700",
};

const STATUS_LABEL: Record<WorkStatus, string> = {
  inbox:        "Inbox",
  approved:     "Approved",
  prompt_ready: "Prompt ready",
  in_progress:  "In progress",
  open:         "Open",
  on_hold:      "On hold",
  done:         "Done",
  deferred:     "Deferred",
  cancelled:    "Cancelled",
  rejected:     "Rejected",
};

const PRIORITY_OPTIONS: TaskPriority[] = ["high", "medium", "low"];
const ASSIGN_OPTIONS: (AgentName | "unassigned")[] = [
  "unassigned", "jordan", "riley", "avery", "casey", "brian",
];
const WORK_TYPE_OPTIONS: WorkType[] = [
  "infrastructure", "agent", "dashboard", "content",
  "website", "operations", "business", "workflow",
];

export function WorkItemDetail({ initial }: { initial: WorkItem }) {
  const [item, setItem] = useState<WorkItem>(initial);
  const [tab, setTab] = useState<"log" | "docs">("log");
  const [statusCheckPending, setStatusCheckPending] = useState(false);
  const [statusCheckSince, setStatusCheckSince] = useState<number | null>(null);
  const [writePromptPending, setWritePromptPending] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showArchNotes, setShowArchNotes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendPending, setResendPending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  const isClientDeliverable =
    item.work_type === "deliverable" &&
    (item.source === "typeform" || item.source === "stripe");

  async function resendAudit() {
    if (!confirm("Resend the Stack Audit PDF to the client?")) return;
    setResendPending(true);
    setResendMessage(null);
    try {
      const res = await fetch(`/api/work/${item.id}/resend-audit`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.ok) {
        setResendMessage(`Failed: ${body?.error ?? body?.detail ?? `HTTP ${res.status}`}`);
      } else {
        setResendMessage(body.detail ?? "Audit resent");
      }
    } catch (e) {
      setResendMessage(e instanceof Error ? e.message : "Resend failed");
    } finally {
      setResendPending(false);
    }
  }

  // Realtime: pick up updates to this work item (status flips, prompt writes
  // from Jordan, etc.) without requiring a manual refresh.
  useEffect(() => {
    const channel = supabase
      .channel(`work-item-${item.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "work_items",
          filter: `id=eq.${item.id}`,
        },
        (payload) => {
          setItem((prev) => ({ ...prev, ...(payload.new as Partial<WorkItem>) }));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [item.id]);

  // Re-enable status-check button after 30s OR on any new log entry.
  useEffect(() => {
    if (!statusCheckPending || statusCheckSince == null) return;
    const remaining = 30_000 - (Date.now() - statusCheckSince);
    if (remaining <= 0) {
      setStatusCheckPending(false);
      return;
    }
    const id = setTimeout(() => setStatusCheckPending(false), remaining);
    return () => clearTimeout(id);
  }, [statusCheckPending, statusCheckSince]);

  // Listen for new log entries — re-enables the status button as soon as
  // the agent posts a progress update.
  useEffect(() => {
    if (!statusCheckPending) return;
    const channel = supabase
      .channel(`work-item-status-listen-${item.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "work_item_logs",
          filter: `work_item_id=eq.${item.id}`,
        },
        () => setStatusCheckPending(false),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [statusCheckPending, item.id]);

  const patch = useCallback(
    async (updates: Partial<WorkItem> & { dispatch?: boolean }) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/work/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
        }
        const data = (await res.json()) as WorkItem;
        setItem(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Update failed");
      } finally {
        setBusy(false);
      }
    },
    [item.id],
  );

  const requestStatus = useCallback(async () => {
    if (!item.assigned_agent || item.assigned_agent === "brian") return;
    setError(null);
    try {
      const res = await fetch(`/api/work/${item.id}/status-check`, {
        method: "POST",
      });
      if (!res.ok && res.status !== 202) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      setStatusCheckPending(true);
      setStatusCheckSince(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Status check failed");
    }
  }, [item.id, item.assigned_agent]);

  const requestPrompt = useCallback(async () => {
    setError(null);
    setWritePromptPending(true);
    try {
      const res = await fetch(`/api/work/${item.id}/write-prompt`, {
        method: "POST",
      });
      if (!res.ok && res.status !== 202) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      // Re-enable after 30s as a safety net; Realtime on work_items will
      // also flip the spinner off when Jordan writes the prompt.
      setTimeout(() => setWritePromptPending(false), 30_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Write prompt failed");
      setWritePromptPending(false);
    }
  }, [item.id]);

  // Watch for prompt arrival — when item.prompt becomes non-empty after a
  // pending request, clear the spinner immediately.
  useEffect(() => {
    if (writePromptPending && item.prompt && item.prompt.length > 0) {
      setWritePromptPending(false);
    }
  }, [item.prompt, writePromptPending]);

  const canDispatchToAgent = useMemo(
    () => Boolean(item.assigned_agent) && item.assigned_agent !== "brian",
    [item.assigned_agent],
  );

  const backHref = useMemo(() => {
    if (typeof window === "undefined") return "/work";
    const stored = sessionStorage.getItem("work-kanban-filters");
    return stored ? `/work?${stored}` : "/work";
  }, []);

  return (
    <div className="min-h-screen bg-brand-offwhite">
      {/* Header */}
      <div className="border-b border-brand-border bg-white px-4 sm:px-6 py-3">
        <div className="flex items-center justify-between gap-3">
          <Link
            href={backHref}
            className="text-sm text-brand-orange hover:underline whitespace-nowrap"
          >
            ← Back to board
          </Link>
          <div className="flex items-center gap-2">
            {isClientDeliverable && (
              <button
                onClick={resendAudit}
                disabled={resendPending}
                className="rounded-full px-3 py-1 text-xs font-medium border border-brand-orange text-brand-orange hover:bg-brand-orange hover:text-white transition-colors disabled:opacity-50"
                title="Re-fire delivery to the client's email"
              >
                {resendPending ? "Resending…" : "Resend audit"}
              </button>
            )}
            <span
              className={clsx(
                "rounded-full px-3 py-1 text-xs font-medium",
                STATUS_PILL[item.status],
              )}
            >
              {STATUS_LABEL[item.status]}
            </span>
          </div>
        </div>
        <h1 className="text-xl font-semibold text-brand-black mt-2">
          {item.title}
        </h1>
        <div className="flex items-center gap-2 mt-1 text-xs text-brand-muted">
          <SourceBadge source={item.source} />
          <span className="capitalize">{item.work_type}</span>
          {item.assigned_agent && (
            <>
              <span>·</span>
              <span>Assigned to</span>
              <AgentBadge agent={item.assigned_agent} size="sm" />
            </>
          )}
        </div>
      </div>

      {resendMessage && (
        <div className={clsx(
          "px-4 sm:px-6 py-2 text-xs border-b",
          resendMessage.startsWith("Failed")
            ? "text-red-700 bg-red-50 border-red-100"
            : "text-green-700 bg-green-50 border-green-100",
        )}>
          {resendMessage}
        </div>
      )}

      {error && (
        <div className="px-4 sm:px-6 py-2 text-xs text-red-700 bg-red-50 border-b border-red-100">
          {error}
        </div>
      )}

      {/* Two-column layout */}
      <div className="flex flex-col lg:flex-row">
        {/* Left: 60% */}
        <div className="flex-[3] p-4 sm:p-6 space-y-5 min-w-0">
          {/* Description / Summary */}
          {(item.description || item.summary) && (
            <div className="bg-white rounded border border-brand-border p-4">
              {item.summary && (
                <p className="text-sm text-brand-black font-medium mb-2">
                  {item.summary}
                </p>
              )}
              {item.description && (
                <p className="text-sm text-brand-black whitespace-pre-wrap">
                  {item.description}
                </p>
              )}
            </div>
          )}

          {/* Metadata grid */}
          <div className="bg-white rounded border border-brand-border p-4">
            <div className="text-xs font-semibold text-brand-muted uppercase tracking-wide mb-3">
              Details
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <Field label="Status">
                <select
                  value={item.status}
                  onChange={(e) => patch({ status: e.target.value as WorkStatus })}
                  disabled={busy}
                  className="w-full rounded border border-brand-border px-2 py-1 text-sm bg-white"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                  ))}
                </select>
              </Field>
              <Field label="Priority">
                <select
                  value={item.priority}
                  onChange={(e) => patch({ priority: e.target.value as TaskPriority })}
                  disabled={busy}
                  className="w-full rounded border border-brand-border px-2 py-1 text-sm bg-white"
                >
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </Field>
              <Field label="Assigned to">
                <select
                  value={item.assigned_agent ?? "unassigned"}
                  onChange={(e) => {
                    const v = e.target.value;
                    const next: AgentName | null = v === "unassigned" ? null : (v as AgentName);
                    const isRealAgent = next && next !== "brian";
                    patch({ assigned_agent: next, ...(isRealAgent ? { dispatch: true } : {}) });
                  }}
                  disabled={busy}
                  className="w-full rounded border border-brand-border px-2 py-1 text-sm bg-white"
                >
                  {ASSIGN_OPTIONS.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </Field>
              <Field label="Work type">
                <select
                  value={item.work_type}
                  onChange={(e) => patch({ work_type: e.target.value as WorkType })}
                  disabled={busy}
                  className="w-full rounded border border-brand-border px-2 py-1 text-sm bg-white"
                >
                  {WORK_TYPE_OPTIONS.map((wt) => (
                    <option key={wt} value={wt}>{wt}</option>
                  ))}
                </select>
              </Field>
              <Field label="Source">
                <div className="flex items-center h-7">
                  {item.source === "manual" ? (
                    <span className="text-xs text-brand-muted">Manual</span>
                  ) : (
                    <SourceBadge source={item.source} />
                  )}
                </div>
              </Field>
              <Field label="Due date">
                <input
                  type="date"
                  value={item.due_date ?? ""}
                  onChange={(e) => patch({ due_date: e.target.value || null })}
                  disabled={busy}
                  className="w-full rounded border border-brand-border px-2 py-1 text-sm bg-white"
                />
              </Field>
              <Field label="Suggested by">
                <span className="text-sm text-brand-black">
                  {item.suggested_by ?? "—"}
                </span>
              </Field>
              <Field label="Created">
                <span className="text-xs text-brand-muted">
                  {new Date(item.created_at).toLocaleString()}
                </span>
              </Field>
            </div>
          </div>

          {/* Prompt (collapsible) */}
          <div className="bg-white rounded border border-brand-border">
            <button
              onClick={() => setShowPrompt((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-2 text-xs font-semibold text-brand-muted uppercase tracking-wide"
            >
              <span>
                Prompt {item.prompt ? `(${item.prompt.length} chars)` : "(empty)"}
              </span>
              <span>{showPrompt ? "▾" : "▸"}</span>
            </button>
            {showPrompt && (
              <div className="border-t border-brand-border p-4">
                {item.prompt ? (
                  <pre className="text-xs bg-brand-offwhite p-3 rounded whitespace-pre-wrap font-mono">
                    {item.prompt}
                  </pre>
                ) : (
                  <p className="text-xs text-brand-muted">
                    No prompt written yet. Use &quot;Write Prompt&quot; to ask Jordan to draft one.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Arch notes (collapsible) */}
          <div className="bg-white rounded border border-brand-border">
            <button
              onClick={() => setShowArchNotes((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-2 text-xs font-semibold text-brand-muted uppercase tracking-wide"
            >
              <span>Arch notes {item.arch_notes ? "" : "(empty)"}</span>
              <span>{showArchNotes ? "▾" : "▸"}</span>
            </button>
            {showArchNotes && (
              <div className="border-t border-brand-border p-4">
                <textarea
                  value={item.arch_notes ?? ""}
                  onChange={(e) => setItem({ ...item, arch_notes: e.target.value })}
                  onBlur={() => patch({ arch_notes: item.arch_notes })}
                  rows={6}
                  className="w-full rounded border border-brand-border px-2 py-1 text-xs font-mono"
                  placeholder="Constraints, gotchas, system context for the implementer…"
                />
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={requestPrompt}
              disabled={writePromptPending}
              className="rounded bg-brand-orange text-white text-sm px-3 py-1.5 disabled:opacity-60"
            >
              {writePromptPending ? "Jordan is writing the prompt…" : "Write Prompt"}
            </button>
            <div className="flex flex-col">
              <button
                onClick={requestStatus}
                disabled={!canDispatchToAgent || statusCheckPending}
                title={!canDispatchToAgent ? "Assign an agent first" : undefined}
                className="rounded border border-brand-border bg-white text-sm px-3 py-1.5 hover:bg-brand-cream disabled:opacity-60"
              >
                {statusCheckPending ? "Status requested…" : "Get Status"}
              </button>
              {statusCheckPending && (
                <span className="text-[10px] text-brand-muted mt-0.5">
                  Agent will update the log shortly
                </span>
              )}
            </div>
            {item.status !== "done" && (
              <button
                onClick={() => patch({ status: "done" })}
                disabled={busy}
                className="rounded border border-brand-border bg-white text-sm px-3 py-1.5 hover:bg-brand-cream"
              >
                Mark Done
              </button>
            )}
            {item.status !== "on_hold" && (
              <button
                onClick={() => patch({ status: "on_hold" })}
                disabled={busy}
                className="rounded border border-brand-border bg-white text-sm px-3 py-1.5 hover:bg-brand-cream"
              >
                Put On Hold
              </button>
            )}
          </div>
        </div>

        {/* Right: 40% — tabbed */}
        <div className="flex-[2] lg:border-l border-brand-border bg-white min-h-[60vh] lg:min-h-[calc(100vh-100px)] flex flex-col">
          <div className="flex border-b border-brand-border">
            <TabButton active={tab === "log"} onClick={() => setTab("log")}>
              Log
            </TabButton>
            <TabButton active={tab === "docs"} onClick={() => setTab("docs")}>
              Documents
            </TabButton>
          </div>
          <div className="flex-1 overflow-hidden">
            {tab === "log" ? (
              <WorkLogPanel
                workItemId={item.id}
                currentUser="brian"
                workItemStatus={item.status}
              />
            ) : (
              <div className="p-3 overflow-y-auto h-full">
                <WorkDocsPanel workItemId={item.id} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-brand-muted mb-1">
        {label}
      </div>
      {children}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex-1 px-4 py-2 text-sm font-medium transition",
        active
          ? "text-brand-orange border-b-2 border-brand-orange"
          : "text-brand-muted hover:text-brand-black",
      )}
    >
      {children}
    </button>
  );
}
