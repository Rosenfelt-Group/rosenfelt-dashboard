"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { usePolling } from "@/lib/use-polling";
import { AgentBadge } from "@/components/AgentBadge";
import { WorkLogPanel } from "@/components/work/WorkLogPanel";
import { WorkDocsPanel } from "@/components/work/WorkDocsPanel";
import { SourceBadge } from "@/components/work/SourceBadge";
import { ALL_STATUSES, STATUS_LABEL, STATUS_PILL } from "@/components/work/work-constants";
import { Button, PageHeader, Tabs } from "@/components/ui";
import type {
  AgentName,
  TaskPriority,
  WorkItem,
  WorkItemLog,
  WorkItemSource,
  WorkStatus,
  WorkType,
} from "@/types";

const STATUS_OPTIONS: WorkStatus[] = ALL_STATUSES;

const PRIORITY_OPTIONS: TaskPriority[] = ["high", "medium", "low"];
const ASSIGN_OPTIONS: (AgentName | "unassigned")[] = [
  "unassigned", "jordan", "riley", "avery", "casey", "sam", "brian", "pickle",
];
const WORK_TYPE_OPTIONS: WorkType[] = [
  "infrastructure", "agent", "dashboard", "content",
  "website", "operations", "business", "workflow",
];

// Phase 0.7: source is editable. Friendly labels match SourceBadge; both
// build-plan origins read "From Plan Doc". System-only origins (migrated/
// typeform/stripe) aren't offered for manual selection but are shown if the
// item already carries one.
const SOURCE_LABELS: Record<WorkItemSource, string> = {
  manual: "Manual",
  sprint_plan: "From Plan Doc",
  sprint: "From Plan Doc",
  agent_suggestion: "Suggested",
  casey_audit: "Audit",
  backlog_migration: "Migrated",
  typeform: "Typeform",
  stripe: "Stripe",
};
const EDITABLE_SOURCE_OPTIONS: WorkItemSource[] = [
  "manual", "sprint_plan", "agent_suggestion", "casey_audit",
];

export function WorkItemDetail({ initial }: { initial: WorkItem }) {
  const [item, setItem] = useState<WorkItem>(initial);
  const [tab, setTab] = useState<"log" | "docs">("log");
  const [statusCheckPending, setStatusCheckPending] = useState(false);
  const [statusCheckSince, setStatusCheckSince] = useState<number | null>(null);
  // Ref holds the safety-net timeout handle so it can be cancelled when
  // Realtime delivers the prompt (prevents a stale timeout from clearing a
  // subsequent in-flight request after Jordan finishes early).
  const writePromptTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [writePromptPending, setWritePromptPending] = useState(false);
  // Snapshot of item.prompt at the moment Write Prompt was clicked — so we
  // clear the spinner only when a genuinely new prompt lands, not when we
  // detect the pre-existing one that was already there before the click.
  const [promptAtRequest, setPromptAtRequest] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showArchNotes, setShowArchNotes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendPending, setResendPending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  // Inline edit of the work item's core text (title / summary / description).
  const [editingDetails, setEditingDetails] = useState(false);
  const [draftTitle, setDraftTitle] = useState(initial.title);
  const [draftSummary, setDraftSummary] = useState(initial.summary ?? "");
  const [draftDescription, setDraftDescription] = useState(initial.description ?? "");
  // Phase 0.7: phase (sprint_number) is a quick set/clear, committed on blur —
  // independent of source and of the title/summary/description edit bundle.
  const [phase, setPhase] = useState(initial.sprint_number?.toString() ?? "");
  // Phase sub-step (text, e.g. "1.6") — committed on blur, independent of phase.
  const [phaseStep, setPhaseStep] = useState(initial.phase_step ?? "");

  const isClientDeliverable =
    item.work_type === "deliverable" &&
    (item.source === "typeform" || item.source === "stripe");

  // Source select options: the human-pickable set, plus the item's current
  // value if it's a system-only origin (so the select never misrepresents it).
  const currentSource = (item.source ?? "manual") as WorkItemSource;
  const sourceOptions = EDITABLE_SOURCE_OPTIONS.includes(currentSource)
    ? EDITABLE_SOURCE_OPTIONS
    : [...EDITABLE_SOURCE_OPTIONS, currentSource];

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

  // Poll for updates to this work item (status flips, prompt writes from
  // Jordan, etc.). Only fields that changed on the server since the last poll
  // are applied, so unsaved edits in the form are not overwritten.
  const serverItemRef = useRef<WorkItem>(initial);
  usePolling(async () => {
    try {
      const res = await fetch(`/api/work/${item.id}`);
      if (!res.ok) return;
      const next = (await res.json()) as WorkItem;
      const prevServer = serverItemRef.current as unknown as Record<string, unknown>;
      serverItemRef.current = next;
      const changed: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(next)) {
        if (JSON.stringify(value) !== JSON.stringify(prevServer[key])) changed[key] = value;
      }
      if (Object.keys(changed).length === 0) return;
      setItem((prev) => ({ ...prev, ...(changed as Partial<WorkItem>) }));
      // Keep the Phase input in sync when the value changes elsewhere.
      if ("sprint_number" in changed) setPhase(next.sprint_number?.toString() ?? "");
      if ("phase_step" in changed) setPhaseStep(next.phase_step ?? "");
    } catch {
      // Background refresh; the next poll retries.
    }
  }, 10_000);

  const fetchLogs = useCallback(async (): Promise<WorkItemLog[] | null> => {
    try {
      const res = await fetch(`/api/work/${item.id}/logs`);
      if (!res.ok) return null;
      const data = await res.json();
      return Array.isArray(data.logs) ? data.logs : null;
    } catch {
      return null;
    }
  }, [item.id]);

  // Log counts when each pending state started; entries past these are new.
  const statusLogBaseline = useRef<number | null>(null);
  const promptLogBaseline = useRef<number | null>(null);

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

  // Record the log count when a status check starts, so the poll below can
  // re-enable the button as soon as the agent posts a progress update.
  useEffect(() => {
    if (!statusCheckPending) {
      statusLogBaseline.current = null;
      return;
    }
    fetchLogs().then((logs) => {
      if (logs && statusLogBaseline.current === null) statusLogBaseline.current = logs.length;
    });
  }, [statusCheckPending, fetchLogs]);

  // On mount: restore the write-prompt spinner if Jordan is mid-run. We detect
  // this by checking whether the newest log entry is the "✍️ Writing" start-log
  // Jordan writes before the LLM fires, and it's less than 10 minutes old.
  // This makes the button appear "in progress" even after a page refresh.
  useEffect(() => {
    if (initial.status !== "approved") return;
    const TEN_MIN = 10 * 60 * 1000;
    fetchLogs().then((logs) => {
      if (!logs?.length) return;
      const latest = logs[logs.length - 1];
      const isWritingEntry =
        latest.entry_type === "progress" &&
        (latest.message as string | null)?.startsWith("✍️");
      const elapsed = Date.now() - new Date(latest.created_at).getTime();
      if (!isWritingEntry || elapsed >= TEN_MIN) return;
      promptLogBaseline.current = logs.length;
      setPromptAtRequest(initial.prompt ?? "");
      setWritePromptPending(true);
      if (writePromptTimeoutRef.current) clearTimeout(writePromptTimeoutRef.current);
      writePromptTimeoutRef.current = setTimeout(() => {
        writePromptTimeoutRef.current = null;
        setWritePromptPending(false);
      }, TEN_MIN - elapsed);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- mount only, initial is stable

  // While write-prompt is pending, watch for Jordan's terminal log entries
  // (error / question / completion) to clear the spinner rather than waiting
  // for the safety-net timeout.
  useEffect(() => {
    if (!writePromptPending) {
      promptLogBaseline.current = null;
      return;
    }
    if (promptLogBaseline.current !== null) return;
    fetchLogs().then((logs) => {
      if (logs && promptLogBaseline.current === null) promptLogBaseline.current = logs.length;
    });
  }, [writePromptPending, fetchLogs]);

  usePolling(async () => {
    const logs = await fetchLogs();
    if (!logs) return;
    if (statusCheckPending && statusLogBaseline.current !== null && logs.length > statusLogBaseline.current) {
      setStatusCheckPending(false);
    }
    if (writePromptPending && promptLogBaseline.current !== null) {
      const finished = logs
        .slice(promptLogBaseline.current)
        .some((l) => l.entry_type === "error" || l.entry_type === "question" || l.entry_type === "completion");
      if (finished) {
        if (writePromptTimeoutRef.current) {
          clearTimeout(writePromptTimeoutRef.current);
          writePromptTimeoutRef.current = null;
        }
        setWritePromptPending(false);
      }
    }
  }, 5_000, statusCheckPending || writePromptPending);

  const patch = useCallback(
    async (updates: Partial<WorkItem> & { dispatch?: boolean }): Promise<boolean> => {
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
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Update failed");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [item.id],
  );

  function startEditDetails() {
    setDraftTitle(item.title);
    setDraftSummary(item.summary ?? "");
    setDraftDescription(item.description ?? "");
    setError(null);
    setEditingDetails(true);
  }

  async function saveDetails() {
    if (!draftTitle.trim()) {
      setError("Title cannot be empty");
      return;
    }
    const ok = await patch({
      title: draftTitle.trim(),
      summary: draftSummary.trim() || null,
      description: draftDescription.trim() || null,
    });
    if (ok) setEditingDetails(false);
  }

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
    // Capture the current prompt BEFORE marking pending so the cleanup effect
    // knows what value was already there and waits for a genuinely new write.
    setPromptAtRequest(item.prompt ?? "");
    setWritePromptPending(true);
    try {
      const res = await fetch(`/api/work/${item.id}/write-prompt`, {
        method: "POST",
      });
      if (!res.ok && res.status !== 202) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      // Safety-net: Jordan can take several minutes (15+ tool calls). Realtime
      // on work_items clears the spinner the moment a new prompt lands; this is
      // the fallback if that event never arrives.
      if (writePromptTimeoutRef.current) clearTimeout(writePromptTimeoutRef.current);
      writePromptTimeoutRef.current = setTimeout(() => {
        writePromptTimeoutRef.current = null;
        setWritePromptPending(false);
      }, 300_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Write prompt failed");
      setWritePromptPending(false);
    }
  }, [item.id, item.prompt]);

  // Watch for prompt arrival via Realtime. Clear the spinner only when
  // item.prompt actually changes from what was there when the button was
  // clicked — so a pre-existing prompt doesn't immediately reset the state.
  // Also cancel the safety-net timeout so it can't fire against a later request.
  useEffect(() => {
    if (writePromptPending && promptAtRequest !== null) {
      if ((item.prompt ?? "") !== promptAtRequest) {
        if (writePromptTimeoutRef.current) {
          clearTimeout(writePromptTimeoutRef.current);
          writePromptTimeoutRef.current = null;
        }
        setWritePromptPending(false);
      }
    }
  }, [item.prompt, writePromptPending, promptAtRequest]);

  // Cancel any outstanding safety-net timeout on unmount.
  useEffect(() => {
    return () => {
      if (writePromptTimeoutRef.current) clearTimeout(writePromptTimeoutRef.current);
    };
  }, []);

  // Phase 0.7: commit the phase. Blank/0/negative clears it (removes from
  // phase); a positive integer sets it. No-op when unchanged so blur doesn't
  // fire a redundant PATCH.
  const commitPhase = useCallback(() => {
    const raw = phase.trim();
    const parsed = raw ? parseFloat(raw) : null;
    const normalized =
      parsed !== null && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    if (normalized === (item.sprint_number ?? null)) return;
    patch({ sprint_number: normalized });
  }, [phase, item.sprint_number, patch]);

  // Commit the phase sub-step (free text). Blank clears it. No-op when unchanged.
  const commitPhaseStep = useCallback(() => {
    const normalized = phaseStep.trim() || null;
    if (normalized === (item.phase_step ?? null)) return;
    patch({ phase_step: normalized });
  }, [phaseStep, item.phase_step, patch]);

  const canDispatchToAgent = useMemo(
    () => Boolean(item.assigned_agent) && item.assigned_agent !== "brian" && item.assigned_agent !== "pickle",
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
            {editingDetails ? (
              <>
                <button
                  onClick={saveDetails}
                  disabled={busy || !draftTitle.trim()}
                  className="rounded-full px-3 py-1 text-xs font-medium bg-brand-orange text-white hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() => setEditingDetails(false)}
                  disabled={busy}
                  className="rounded-full px-3 py-1 text-xs font-medium border border-brand-border text-brand-muted hover:bg-brand-cream disabled:opacity-50"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={startEditDetails}
                title="Edit title, summary & description"
                className="rounded-full px-3 py-1 text-xs font-medium border border-brand-border text-brand-muted hover:bg-brand-cream"
              >
                ✎ Edit
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
        {editingDetails ? (
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            placeholder="Title"
            autoFocus
            className="w-full text-xl font-semibold text-brand-black mt-2 rounded border border-brand-border px-2 py-1 focus:outline-none focus:border-brand-orange"
          />
        ) : (
          <PageHeader
            className="mt-2 !mb-0"
            title={
              <>
                <span className="text-brand-muted font-normal mr-2">#{item.ref}</span>
                {item.title}
              </>
            }
          />
        )}
        <div className="flex items-center gap-2 mt-1 text-xs text-brand-muted">
          <SourceBadge
            source={item.source}
            sprintNumber={item.sprint_number}
            phaseStep={item.phase_step}
          />
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
          {editingDetails ? (
            <div className="bg-white rounded border border-brand-border p-4 space-y-3">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-brand-muted mb-1">
                  Summary
                </div>
                <textarea
                  value={draftSummary}
                  onChange={(e) => setDraftSummary(e.target.value)}
                  rows={2}
                  placeholder="One-line summary…"
                  className="w-full rounded border border-brand-border px-2 py-1 text-sm resize-y focus:outline-none focus:border-brand-orange"
                />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-brand-muted mb-1">
                  Description
                </div>
                <textarea
                  value={draftDescription}
                  onChange={(e) => setDraftDescription(e.target.value)}
                  rows={6}
                  placeholder="Full description…"
                  className="w-full rounded border border-brand-border px-2 py-1 text-sm resize-y focus:outline-none focus:border-brand-orange"
                />
              </div>
            </div>
          ) : (
            (item.description || item.summary) && (
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
            )
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
                    const isRealAgent = next && next !== "brian" && next !== "pickle";
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
                <select
                  value={currentSource}
                  onChange={(e) => patch({ source: e.target.value as WorkItemSource })}
                  disabled={busy}
                  className="w-full rounded border border-brand-border px-2 py-1 text-sm bg-white"
                >
                  {sourceOptions.map((s) => (
                    <option key={s} value={s}>{SOURCE_LABELS[s] ?? s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Phase">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    value={phase}
                    onChange={(e) => setPhase(e.target.value)}
                    onBlur={commitPhase}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    disabled={busy}
                    placeholder="—"
                    className="w-full rounded border border-brand-border px-2 py-1 text-sm bg-white"
                  />
                  {item.sprint_number != null && (
                    <button
                      onClick={() => {
                        setPhase("");
                        patch({ sprint_number: null });
                      }}
                      disabled={busy}
                      className="shrink-0 text-[11px] text-brand-muted hover:text-red-600"
                      title="Remove from phase"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </Field>
              <Field label="Step">
                <input
                  type="text"
                  value={phaseStep}
                  onChange={(e) => setPhaseStep(e.target.value)}
                  onBlur={commitPhaseStep}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  disabled={busy}
                  placeholder="e.g. 1.6"
                  className="w-full rounded border border-brand-border px-2 py-1 text-sm bg-white"
                />
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
            <Button onClick={requestPrompt} disabled={writePromptPending}>
              {writePromptPending ? "Jordan is writing the prompt…" : "Write Prompt"}
            </Button>
            <div className="flex flex-col">
              <Button
                variant="secondary"
                onClick={requestStatus}
                disabled={!canDispatchToAgent || statusCheckPending}
                title={!canDispatchToAgent ? "Assign an agent first" : undefined}
              >
                {statusCheckPending ? "Status requested…" : "Get Status"}
              </Button>
              {statusCheckPending && (
                <span className="text-[10px] text-brand-muted mt-0.5">
                  Agent will update the log shortly
                </span>
              )}
            </div>
            {item.status !== "done" && (
              <Button variant="secondary" onClick={() => patch({ status: "done" })} disabled={busy}>
                Mark Done
              </Button>
            )}
            {item.status !== "on_hold" && (
              <Button variant="secondary" onClick={() => patch({ status: "on_hold" })} disabled={busy}>
                Put On Hold
              </Button>
            )}
          </div>
        </div>

        {/* Right: 40% — tabbed */}
        <div className="flex-[2] lg:border-l border-brand-border bg-white min-h-[60vh] lg:min-h-[calc(100vh-100px)] flex flex-col">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "log", label: "Log" },
              { id: "docs", label: "Documents" },
            ]}
          />
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
