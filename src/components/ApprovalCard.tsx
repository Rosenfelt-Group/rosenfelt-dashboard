"use client";
import { useState } from "react";
import { PendingApproval } from "@/types";
import { AgentBadge } from "./AgentBadge";
import { formatDistanceToNow } from "date-fns";

interface ApprovalCardProps {
  approval: PendingApproval;
  onAction: (id: string, status: "approved" | "rejected" | "revision_requested", revisionNotes?: string, selectedItems?: string[]) => Promise<void>;
  isAdmin?: boolean;
}

interface RemItem { item: string; current?: string; available?: string; severity?: string; source?: string }

function PatchRemediationDetail({ payload, selected, onToggle }: {
  payload?: Record<string, unknown>;
  selected: Set<string>;
  onToggle: (item: string) => void;
}) {
  const host = (payload?.host as string) ?? "";
  const category = (payload?.category as string) ?? "";
  const safe = (payload?.safe_items as RemItem[]) ?? [];
  const deferred = (payload?.deferred_items as RemItem[]) ?? [];
  const plan = (payload?.plan as string[]) ?? [];
  const snapshot = Boolean(payload?.snapshot_required);
  const hostLabel = host === "ovh" ? "OVH" : host === "hostinger" ? "Hostinger" : host === "wordpress" ? "WordPress" : host;
  const kind = category === "wp_plugins" ? "plugin" : "OS package";

  return (
    <div className="border-t border-brand-border pt-3 space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-brand-muted">
        <span>Host: <span className="text-brand-black">{hostLabel}</span></span>
        <span><span className="text-brand-black">{selected.size}</span> of {safe.length} {kind}(s) selected</span>
        {deferred.length > 0 && <span><span className="text-brand-black">{deferred.length}</span> deferred</span>}
        {snapshot && <span className="badge bg-blue-50 text-blue-700 px-1.5 py-0.5">version-pin rollback recorded</span>}
      </div>

      {safe.length > 0 && (
        <div className="rounded-lg border border-brand-border overflow-hidden">
          <div className="px-3 py-1.5 bg-brand-offwhite text-[11px] font-semibold text-brand-muted uppercase tracking-wide">
            Select {kind}s to apply ({selected.size}/{safe.length})
          </div>
          <div className="divide-y divide-brand-border">
            {safe.map((it, i) => (
              <label key={i} className="px-3 py-1.5 flex items-center gap-2 flex-wrap text-xs cursor-pointer hover:bg-brand-offwhite">
                <input
                  type="checkbox"
                  checked={selected.has(it.item)}
                  onChange={() => onToggle(it.item)}
                  className="accent-brand-orange flex-shrink-0"
                />
                <span className="font-mono text-brand-black">{it.item}</span>
                {(it.current || it.available) && (
                  <span className="text-brand-muted font-mono">{it.current || "—"} → <span className="text-brand-black">{it.available || "—"}</span></span>
                )}
                {it.severity === "major" && <span className="badge bg-red-50 text-red-700 text-[9px] px-1 py-0">major</span>}
              </label>
            ))}
          </div>
        </div>
      )}

      {deferred.length > 0 && (
        <div className="rounded-lg border border-brand-border overflow-hidden">
          <div className="px-3 py-1.5 bg-brand-offwhite text-[11px] font-semibold text-brand-muted uppercase tracking-wide flex items-center gap-2 flex-wrap">
            Deferred — manual maintenance window ({deferred.length})
            <span className="badge bg-gray-100 text-gray-500 text-[9px] px-1 py-0">restart/reboot risk</span>
          </div>
          <div className="divide-y divide-brand-border">
            {deferred.map((it, i) => (
              <div key={i} className="px-3 py-1.5 flex items-center gap-2 flex-wrap text-xs">
                <span className="font-mono text-brand-muted">{it.item}</span>
                {(it.current || it.available) && (
                  <span className="text-brand-muted font-mono">{it.current || "—"} → {it.available || "—"}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {plan.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-brand-muted select-none">Planned command{plan.length > 1 ? "s" : ""}</summary>
          <pre className="mt-1 p-2 bg-brand-offwhite rounded text-[11px] text-brand-black overflow-x-auto whitespace-pre-wrap">{plan.join("\n")}</pre>
        </details>
      )}
    </div>
  );
}

function LinkedInCarouselDetail({ payload }: { payload?: Record<string, unknown> }) {
  const slides      = (payload?.carousel_slides as string[]) ?? [];
  const caption     = (payload?.caption as string) ?? "";
  const commentText = (payload?.comment_text as string) ?? "";
  const rawPostUrl  = (payload?.post_url as string) ?? "";
  const postUrl     = /^https?:\/\//i.test(rawPostUrl) ? rawPostUrl : "";
  const day         = (payload?.suggested_post_day as string) ?? "";
  const [copied, setCopied] = useState<"caption" | "comment" | null>(null);

  function copy(text: string, key: "caption" | "comment") {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="border-t border-brand-border pt-3 space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-brand-muted">
        {day && (
          <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-medium">Post {day}</span>
        )}
        <span>{slides.length} slides</span>
        {postUrl && (
          <a href={postUrl} target="_blank" rel="noopener noreferrer"
             className="text-brand-orange hover:underline flex items-center gap-1">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            Source post
          </a>
        )}
      </div>

      {slides.length > 0 && (
        <div className="rounded-lg border border-brand-border overflow-hidden">
          <div className="px-3 py-1.5 bg-brand-offwhite text-[11px] font-semibold text-brand-muted uppercase tracking-wide">
            Carousel Slides ({slides.length})
          </div>
          <div className="divide-y divide-brand-border">
            {slides.map((slide, i) => (
              <div key={i} className="px-3 py-2 flex gap-2.5 text-xs">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-brand-offwhite border border-brand-border text-brand-muted flex items-center justify-center text-[10px] font-bold">
                  {i + 1}
                </span>
                <span className="text-brand-black leading-relaxed">{slide}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {caption && (
        <div className="rounded-lg border border-brand-border overflow-hidden">
          <div className="px-3 py-1.5 bg-brand-offwhite flex items-center justify-between">
            <span className="text-[11px] font-semibold text-brand-muted uppercase tracking-wide">Caption</span>
            <button onClick={() => copy(caption, "caption")}
                    className="text-[11px] text-brand-orange hover:underline">
              {copied === "caption" ? "Copied!" : "Copy"}
            </button>
          </div>
          <pre className="px-3 py-2 text-xs text-brand-black whitespace-pre-wrap leading-relaxed font-sans">{caption}</pre>
        </div>
      )}

      {commentText && (
        <div className="rounded-lg border border-brand-border overflow-hidden">
          <div className="px-3 py-1.5 bg-brand-offwhite flex items-center justify-between">
            <span className="text-[11px] font-semibold text-brand-muted uppercase tracking-wide">First Comment</span>
            <button onClick={() => copy(commentText, "comment")}
                    className="text-[11px] text-brand-orange hover:underline">
              {copied === "comment" ? "Copied!" : "Copy"}
            </button>
          </div>
          <p className="px-3 py-2 text-xs text-brand-black font-mono">{commentText}</p>
        </div>
      )}
    </div>
  );
}

export function ApprovalCard({ approval, onAction, isAdmin = false }: ApprovalCardProps) {
  const [loading,       setLoading]       = useState<"approved" | "rejected" | "revision_requested" | "send_audit" | null>(null);
  const [showRevise,    setShowRevise]    = useState(false);
  const [revisionNotes, setRevisionNotes] = useState("");
  const [sendError,     setSendError]     = useState<string | null>(null);

  const safeItems = (approval.payload?.safe_items as RemItem[]) ?? [];
  const [selected, setSelected] = useState<Set<string>>(() => new Set(safeItems.map((i) => i.item)));
  const [dryLoading, setDryLoading] = useState(false);
  const [dryResult, setDryResult] = useState<string | null>(null);
  const toggleItem = (name: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(name)) n.delete(name); else n.add(name);
      return n;
    });

  async function handle(status: "approved" | "rejected" | "revision_requested", notes?: string, items?: string[]) {
    setLoading(status);
    await onAction(approval.id, status, notes, items);
    setLoading(null);
    setShowRevise(false);
    setRevisionNotes("");
  }

  async function handleDryRun() {
    setDryLoading(true);
    setDryResult(null);
    try {
      const res = await fetch("/api/patch/dry-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approval_id: approval.id, selected_items: Array.from(selected) }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setDryResult(`✓ Dry-run OK — would apply ${data.items} item(s):\n${data.preview ?? ""}`);
      } else {
        setDryResult(`Dry-run failed: ${data.detail ?? data.error ?? `HTTP ${res.status}`}`);
      }
    } catch (e) {
      setDryResult(`Dry-run failed: ${e instanceof Error ? e.message : "error"}`);
    } finally {
      setDryLoading(false);
    }
  }

  async function handleSendAudit() {
    setLoading("send_audit");
    setSendError(null);
    try {
      const res = await fetch("/api/audit/deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approval_id: approval.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.ok) {
        setSendError(body?.error ?? body?.detail ?? `HTTP ${res.status}`);
      }
      // On success Realtime will move the row to history via the UPDATE handler.
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "send failed");
    } finally {
      setLoading(null);
    }
  }

  const isStackAudit       = approval.action_type === "stack_audit_report";
  const isPatchRemediation = approval.action_type === "patch_remediation";
  const isLinkedInCarousel = approval.action_type === "linkedin_carousel";
  const editUrl = approval.payload?.edit_url as string | undefined;
  const auditClient = approval.payload?.company_name as string | undefined;
  const auditEmail = approval.payload?.contact_email as string | undefined;
  const auditWords = approval.payload?.word_count as number | undefined;
  const auditWorkItemId = approval.payload?.work_item_id as string | undefined;
  // Prefer the canonical work-item deliverable URL; fall back to the
  // legacy approval-based proxy if the approval somehow isn't linked.
  const previewHref = auditWorkItemId
    ? `/api/work/${auditWorkItemId}/deliverable.pdf`
    : `/api/audit/pdf?approval_id=${approval.id}`;

  return (
    <div className="card border-l-4 border-l-brand-orange space-y-3">
      {/* Header row */}
      <div className="flex items-start gap-3">
        <AgentBadge agent={approval.agent} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-brand-black">{approval.title}</p>
          {approval.description && !isPatchRemediation && (
            <p className="text-xs text-brand-muted mt-0.5 line-clamp-2">{approval.description}</p>
          )}
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-xs text-brand-muted">
              {approval.agent} · {formatDistanceToNow(new Date(approval.created_at), { addSuffix: true })}
            </span>
            {editUrl && (
              <a
                href={editUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-brand-orange hover:underline flex items-center gap-1"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
                View draft in WordPress
              </a>
            )}
          </div>
        </div>

        {/* Action buttons — hidden when revise form is open */}
        {isAdmin && !showRevise && (
          <div className="flex gap-1.5 flex-shrink-0">
            {isStackAudit ? (
              <>
                <button
                  onClick={handleSendAudit}
                  disabled={loading !== null}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-orange text-white hover:bg-brand-orange/90 transition-colors disabled:opacity-50"
                >
                  {loading === "send_audit" ? "Sending…" : "Send Audit to Client"}
                </button>
                <button
                  onClick={() => handle("rejected")}
                  disabled={loading !== null}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50"
                >
                  {loading === "rejected" ? "…" : "Reject"}
                </button>
              </>
            ) : isLinkedInCarousel ? (
              <>
                <button
                  onClick={() => handle("approved")}
                  disabled={loading !== null}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50"
                >
                  {loading === "approved" ? "…" : "Mark ready"}
                </button>
                <button
                  onClick={() => setShowRevise(true)}
                  disabled={loading !== null}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-50"
                >
                  Revise
                </button>
                <button
                  onClick={() => handle("rejected")}
                  disabled={loading !== null}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50"
                >
                  {loading === "rejected" ? "…" : "Reject"}
                </button>
              </>
            ) : isPatchRemediation ? (
              <>
                <button
                  onClick={handleDryRun}
                  disabled={loading !== null || dryLoading || selected.size === 0}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-50"
                >
                  {dryLoading ? "…" : `Dry-run (${selected.size})`}
                </button>
                <button
                  onClick={() => handle("approved", undefined, Array.from(selected))}
                  disabled={loading !== null || dryLoading || selected.size === 0}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  {loading === "approved" ? "…" : `Apply live (${selected.size})`}
                </button>
                <button
                  onClick={() => handle("rejected")}
                  disabled={loading !== null || dryLoading}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50"
                >
                  {loading === "rejected" ? "…" : "Reject"}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => handle("approved")}
                  disabled={loading !== null}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-green-50 text-green-700 hover:bg-green-100 transition-colors disabled:opacity-50"
                >
                  {loading === "approved" ? "…" : "Approve"}
                </button>
                <button
                  onClick={() => setShowRevise(true)}
                  disabled={loading !== null}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-50"
                >
                  Revise
                </button>
                <button
                  onClick={() => handle("rejected")}
                  disabled={loading !== null}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50"
                >
                  {loading === "rejected" ? "…" : "Reject"}
                </button>
              </>
            )}
          </div>
        )}
        {!isAdmin && (
          <span className="text-xs text-brand-muted flex-shrink-0 px-2 py-1 bg-brand-offwhite rounded-lg">
            Pending review
          </span>
        )}
      </div>

      {/* LinkedIn carousel detail — slides, caption, first comment */}
      {isLinkedInCarousel && (
        <LinkedInCarouselDetail payload={approval.payload} />
      )}

      {/* Patch remediation detail — selectable item table, deferred set, planned command */}
      {isPatchRemediation && (
        <PatchRemediationDetail payload={approval.payload} selected={selected} onToggle={toggleItem} />
      )}
      {isPatchRemediation && dryResult && (
        <pre className="text-[11px] text-brand-black bg-brand-offwhite border border-brand-border rounded-lg p-2 overflow-x-auto whitespace-pre-wrap">{dryResult}</pre>
      )}

      {/* Stack Audit recipient summary — surfaces who the PDF will go to */}
      {isStackAudit && (auditClient || auditEmail) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-brand-muted border-t border-brand-border pt-2">
          {auditClient && (
            <span>Client: <span className="text-brand-black">{auditClient}</span></span>
          )}
          {auditEmail && (
            <span>To: <span className="text-brand-black font-mono">{auditEmail}</span></span>
          )}
          {typeof auditWords === "number" && (
            <span>{auditWords} words</span>
          )}
          <a
            href={previewHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-orange hover:underline flex items-center gap-1"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            Preview PDF
          </a>
        </div>
      )}
      {sendError && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          Send failed: {sendError}
        </div>
      )}

      {/* Inline revision form */}
      {showRevise && isAdmin && (
        <div className="border-t border-brand-border pt-3 space-y-2">
          <p className="text-xs font-medium text-brand-black">What needs to change?</p>
          <textarea
            value={revisionNotes}
            onChange={e => setRevisionNotes(e.target.value)}
            placeholder="e.g. Add more concrete examples in section 2, shorten the intro"
            rows={3}
            autoFocus
            className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm text-brand-black placeholder:text-brand-muted focus:outline-none focus:ring-2 focus:ring-brand-orange/30 resize-none"
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setShowRevise(false); setRevisionNotes(""); }}
              className="px-3 py-1.5 text-xs rounded-lg text-brand-muted hover:bg-brand-offwhite transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => handle("revision_requested", revisionNotes)}
              disabled={loading !== null || !revisionNotes.trim()}
              className="px-3 py-1.5 text-xs rounded-lg font-medium bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-50"
            >
              {loading === "revision_requested" ? "Sending…" : "Send for revision"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
