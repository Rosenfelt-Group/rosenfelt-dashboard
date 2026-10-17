"use client";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import type { EmailProblem } from "@/lib/email/events";
import { StatCard } from "@/components/StatCard";
import { Button, ErrorState, LoadingState, Modal } from "@/components/ui";
import { usePolling } from "@/lib/use-polling";
import { fetchJson } from "@/lib/fetch-json";
import { HEALTH_LEVELS, type EmailHealthResponse } from "@/components/EmailHealthCard";
import { BOUNCE_WARN, MIN_SENDS_FOR_RATES } from "@/lib/email/health";
import { RERUN_FROM_N8N_TAG } from "@/lib/email/resendable";
import { ago, canResend, problemLabel, sourceLabel } from "./helpers";

type Suppression = { email: string; reason: string; origin: string; createdAt: string; canUnblock: boolean };
type MessageSummary = { id: string; to: string; subject: string; tag?: string; status: string; receivedAt: string };
type MessageDetail = MessageSummary & { events: { type: string; at: string; detail?: string }[] };

const SOURCE_NAMES: Record<string, string> = { dashboard: "Dashboard", n8n: "n8n", wordpress: "WordPress" };
const SPAM_TEXT = "Blocked permanently — this person marked us as spam";
const REASONS: Record<string, string> = {
  HardBounce: "Address can't be reached",
  SpamComplaint: "Marked us as spam",
  ManualSuppression: "Blocked by us",
};
const fmtDate = (ts: string) =>
  new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const th = "text-left text-xs font-semibold text-brand-muted uppercase tracking-wide px-4 py-2 whitespace-nowrap";
const td = "px-4 py-2.5 text-sm text-brand-black align-top";
// Actions stay pinned to the right edge while the table scrolls sideways, so admin buttons are never off-screen.
const stickyRight = "sticky right-0 z-10 bg-white shadow-[inset_1px_0_0_#E3D9CB]";

export function EmailTab() {
  const [data, setData] = useState<EmailHealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [blocked, setBlocked] = useState<Suppression[] | null>(null);
  const [blockedError, setBlockedError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [h, s] = await Promise.all([
      fetchJson<EmailHealthResponse>(`/api/email/health${showResolved ? "?includeResolved=1" : ""}`),
      fetchJson<Suppression[]>("/api/email/suppressions"),
    ]);
    if (h.ok) { setData(h.data); setError(null); setCheckedAt(Date.now()); }
    else setError(h.error);
    if (s.ok) { setBlocked(s.data); setBlockedError(null); }
    else setBlockedError(s.error);
  }, [showResolved]);

  useEffect(() => { load(); }, [load]);
  usePolling(load, 60_000);

  // dismiss
  const [busyId, setBusyId] = useState<string | null>(null);
  async function dismiss(id: string) {
    setBusyId(id); setActionError(null);
    const r = await fetchJson(`/api/email/events/${id}/dismiss`, { method: "POST" });
    setBusyId(null);
    if (!r.ok) setActionError(r.error); else { setNotice("Dismissed."); load(); }
  }

  // resend modal
  const [resendFor, setResendFor] = useState<EmailProblem | null>(null);
  const [resendTo, setResendTo] = useState("");
  const [unblockFirst, setUnblockFirst] = useState(false);
  const [offerUnblock, setOfferUnblock] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);

  const suppressionFor = (addr: string) => blocked?.find(b => b.email.toLowerCase() === addr.trim().toLowerCase());
  const canUnblockAddr = (addr: string) => suppressionFor(addr)?.canUnblock === true;

  function openResend(e: EmailProblem) {
    setResendFor(e); setResendTo(e.recipient); setResendError(null);
    setOfferUnblock(false); setUnblockFirst(false);
  }
  async function submitResend() {
    if (!resendFor) return;
    setResendBusy(true); setResendError(null);
    const to = resendTo.trim();
    const unblock = (offerUnblock || canUnblockAddr(to)) && unblockFirst;
    const r = await fetchJson<{ ok: true; contactUpdated?: boolean }>(`/api/email/events/${resendFor.id}/resend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: to !== resendFor.recipient ? to : undefined, unblock: unblock || undefined }),
    });
    setResendBusy(false);
    if (!r.ok) {
      setResendError(r.error);
      if (r.status === 409 && /still blocked/i.test(r.error)) { setOfferUnblock(true); setUnblockFirst(true); }
      return;
    }
    setResendFor(null);
    setNotice(r.data.contactUpdated ? "Resent. The contact's email was updated too." : "Resent.");
    load();
  }
  const showUnblockBox = resendFor !== null && (offerUnblock || canUnblockAddr(resendTo));

  // block / unblock confirm
  const [confirm, setConfirm] = useState<{ kind: "block" | "unblock"; email: string } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [blockInput, setBlockInput] = useState("");
  async function runConfirm() {
    if (!confirm) return;
    setConfirmBusy(true); setConfirmError(null);
    const r = await fetchJson(`/api/email/suppressions`, {
      method: confirm.kind === "block" ? "POST" : "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: confirm.email }),
    });
    setConfirmBusy(false);
    if (!r.ok) { setConfirmError(r.error); return; }
    setNotice(confirm.kind === "block" ? `Blocked ${confirm.email}.` : `Unblocked ${confirm.email}.`);
    if (confirm.kind === "block") setBlockInput("");
    setConfirm(null);
    load();
  }

  // look up
  const [lookupInput, setLookupInput] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [results, setResults] = useState<MessageSummary[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, MessageDetail | string>>({});
  async function search(ev: React.FormEvent) {
    ev.preventDefault();
    setLookupBusy(true); setLookupError(null); setOpenId(null);
    const r = await fetchJson<MessageSummary[]>(`/api/email/messages?recipient=${encodeURIComponent(lookupInput.trim())}`);
    setLookupBusy(false);
    if (!r.ok) { setLookupError(r.error); setResults(null); } else setResults(r.data);
  }
  async function toggleMessage(id: string) {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (details[id] && typeof details[id] !== "string") return;
    const r = await fetchJson<MessageDetail>(`/api/email/messages/${id}`);
    setDetails(d => ({ ...d, [id]: r.ok ? r.data : r.error }));
  }

  if (!data && !error) return <LoadingState />;
  if (!data) return <ErrorState message={error} onRetry={load} />;

  const { health, stats, bySource, problems, canManage, canResend: resendEnabled } = data;
  const lvl = HEALTH_LEVELS[health.level];
  const rate = health.bounceRate;
  const bounceWarn = rate !== null && stats !== null && stats.sent >= MIN_SENDS_FOR_RATES && rate >= BOUNCE_WARN;

  return (
    <div className="space-y-4">
      {error && <ErrorState message={error} onRetry={load} />}
      {notice && (
        <div role="status" className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border border-green-200 bg-green-50 text-sm text-green-800">
          <span>{notice}</span>
          <button type="button" aria-label="Dismiss message" onClick={() => setNotice(null)} className="text-green-700">✕</button>
        </div>
      )}
      {actionError && <ErrorState message={actionError} />}

      {/* Verdict */}
      <div className="card !p-4 flex items-center justify-between gap-3 flex-wrap">
        <p className="flex items-center gap-2 text-sm flex-wrap">
          <span className={clsx("w-2.5 h-2.5 rounded-full shrink-0", lvl.dot)} />
          <span className={clsx("font-medium", lvl.text)}>{lvl.word}</span>
          {health.level !== "green" && health.reasons.map(r => <span key={r} className="text-brand-muted">{r}</span>)}
        </p>
        {checkedAt && <span className="text-xs text-brand-muted">checked {ago(checkedAt)}</span>}
      </div>

      {/* Numbers */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Sent" value={stats ? stats.sent : "—"} sub="last 7 days" />
        <StatCard label="Delivered" value={health.deliveredPct !== null ? `${(health.deliveredPct * 100).toFixed(1)}%` : "—"} sub="last 7 days" />
        <StatCard label="Bounce rate" value={rate !== null ? `${(rate * 100).toFixed(1)}%` : "—"} sub={`warn at ${BOUNCE_WARN * 100}%`} warn={bounceWarn} />
        <StatCard label="Spam complaints" value={stats ? stats.spamComplaints : "—"} alert={(stats?.spamComplaints ?? 0) > 0} sub="last 7 days" />
      </div>

      {/* Needs attention */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-brand-border flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">Needs attention</p>
          <label className="flex items-center gap-1.5 text-xs text-brand-muted cursor-pointer">
            <input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)} />
            Show resolved
          </label>
        </div>
        {canManage && !resendEnabled && problems.some(p => !p.resolved_at && p.record_type !== "SpamComplaint" && canResend(p.tag)) && (
          <p className="px-4 py-2 border-b border-brand-border text-xs text-brand-muted">Resend is off until Postmark is approved.</p>
        )}
        {problems.length === 0 ? (
          <p className="px-4 py-6 text-sm text-brand-muted text-center">
            {showResolved ? "No problems in the last 7 days." : "Nothing needs attention."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead><tr className="border-b border-brand-border">
                <th className={th}>When</th><th className={th}>To</th><th className={th}>Subject</th>
                <th className={th}>Sender</th><th className={th}>Reason</th>
                {canManage && <th className={clsx(th, stickyRight)}>Actions</th>}
              </tr></thead>
              <tbody className="divide-y divide-brand-border">
                {problems.map(p => (
                  <tr key={p.id} className={clsx(p.resolved_at && "opacity-60")}>
                    <td className={clsx(td, "whitespace-nowrap")}>{fmtDate(p.occurred_at)}</td>
                    <td className={clsx(td, "whitespace-nowrap")}>{p.recipient}</td>
                    <td className={td}>{p.subject ?? "—"}</td>
                    <td className={td}>{sourceLabel(p.tag)}</td>
                    <td className={td}>
                      {problemLabel(p)}
                      {p.resolved_at && <span className="badge-neutral ml-2">{p.resolution ?? "resolved"}</span>}
                    </td>
                    {canManage && (
                      <td className={clsx(td, stickyRight, "whitespace-nowrap")}>
                        {!p.resolved_at && (
                          <div className="flex gap-1.5">
                            {resendEnabled && p.record_type !== "SpamComplaint" && canResend(p.tag) && (
                              <Button size="sm" variant="secondary" onClick={() => openResend(p)}>Resend</Button>
                            )}
                            {p.record_type !== "SpamComplaint" && p.tag === RERUN_FROM_N8N_TAG && (
                              <span className="text-xs text-brand-muted self-center max-w-[180px] whitespace-normal">Re-run the delivery from n8n (avery-deliver-audit).</span>
                            )}
                            <Button size="sm" variant="ghost" disabled={busyId === p.id} onClick={() => dismiss(p.id)}>Dismiss</Button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* By sender */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-brand-border">
          <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">By sender · last 7 days</p>
        </div>
        {bySource.length === 0 ? (
          <p className="px-4 py-6 text-sm text-brand-muted text-center">Sender breakdown unavailable.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[360px]">
              <thead><tr className="border-b border-brand-border">
                <th className={th}>Sender</th><th className={th}>Sent</th><th className={th}>Bounced</th><th className={th}>Spam</th>
              </tr></thead>
              <tbody className="divide-y divide-brand-border">
                {bySource.map(s => (
                  <tr key={s.source}>
                    <td className={td}>{SOURCE_NAMES[s.source] ?? "Other"}</td>
                    <td className={td}>{s.sent}</td>
                    <td className={clsx(td, s.bounced > 0 && "text-amber-600")}>{s.bounced}</td>
                    <td className={clsx(td, s.spam > 0 && "text-red-600")}>{s.spam}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Blocked addresses */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-brand-border">
          <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">Blocked addresses</p>
        </div>
        {blockedError ? (
          <p className="px-4 py-4 text-sm text-red-600">{blockedError}</p>
        ) : blocked === null ? (
          <p className="px-4 py-6 text-sm text-brand-muted text-center">Loading…</p>
        ) : blocked.length === 0 ? (
          <p className="px-4 py-6 text-sm text-brand-muted text-center">No blocked addresses.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead><tr className="border-b border-brand-border">
                <th className={th}>Address</th><th className={th}>Reason</th><th className={th}>Since</th>
                {canManage && <th className={th}>Action</th>}
              </tr></thead>
              <tbody className="divide-y divide-brand-border">
                {blocked.map(b => (
                  <tr key={b.email}>
                    <td className={clsx(td, "whitespace-nowrap")}>{b.email}</td>
                    <td className={td}>{REASONS[b.reason] ?? b.reason}</td>
                    <td className={clsx(td, "whitespace-nowrap")}>{fmtDate(b.createdAt)}</td>
                    {canManage && (
                      <td className={td}>
                        {b.canUnblock
                          ? <Button size="sm" variant="secondary" onClick={() => { setConfirmError(null); setConfirm({ kind: "unblock", email: b.email }); }}>Unblock</Button>
                          : <span className="text-xs text-brand-muted">{SPAM_TEXT}</span>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canManage && (
          <form
            className="px-4 py-3 border-t border-brand-border flex gap-2 flex-wrap"
            onSubmit={ev => { ev.preventDefault(); if (blockInput.trim()) { setConfirmError(null); setConfirm({ kind: "block", email: blockInput.trim() }); } }}
          >
            <input
              type="email" value={blockInput} onChange={e => setBlockInput(e.target.value)}
              placeholder="Block an address…" aria-label="Address to block"
              className="flex-1 min-w-[200px] border border-brand-border rounded-lg px-3 py-1.5 text-sm"
            />
            <Button type="submit" size="sm" variant="secondary" disabled={!blockInput.trim()}>Block</Button>
          </form>
        )}
      </div>

      {/* Look up (admin-only: the message routes need manage_email) */}
      {canManage && <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-brand-border">
          <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">Look up a message</p>
        </div>
        <form className="px-4 py-3 flex gap-2 flex-wrap" onSubmit={search}>
          <input
            type="email" value={lookupInput} onChange={e => setLookupInput(e.target.value)}
            placeholder="Recipient email address" aria-label="Recipient to look up" required
            className="flex-1 min-w-[200px] border border-brand-border rounded-lg px-3 py-1.5 text-sm"
          />
          <Button type="submit" size="sm" disabled={lookupBusy || !lookupInput.trim()}>{lookupBusy ? "Searching…" : "Search"}</Button>
        </form>
        {lookupError && <p className="px-4 pb-3 text-sm text-red-600">{lookupError}</p>}
        {results && (results.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-brand-muted">No messages to that address in the last 45 days.</p>
        ) : (
          <div className="divide-y divide-brand-border border-t border-brand-border">
            {results.map(m => {
              const d = details[m.id];
              return (
                <div key={m.id}>
                  <button type="button" onClick={() => toggleMessage(m.id)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-brand-offwhite transition-colors">
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-brand-black truncate">{m.subject}</span>
                      <span className="block text-xs text-brand-muted">{fmtDate(m.receivedAt)} · {sourceLabel(m.tag ?? null)}</span>
                    </span>
                    <span className="badge-neutral shrink-0">{m.status}</span>
                  </button>
                  {openId === m.id && (
                    <div className="bg-brand-offwhite px-6 py-3 text-xs">
                      {d === undefined ? <span className="text-brand-muted">Loading…</span>
                        : typeof d === "string" ? <span className="text-red-600">{d}</span>
                        : d.events.length === 0 ? <span className="text-brand-muted">No events yet.</span>
                        : <ul className="space-y-1">{d.events.map((ev, i) => (
                            <li key={i}><span className="font-medium text-brand-black">{ev.type}</span>{" "}
                              <span className="text-brand-muted">{fmtDate(ev.at)}{ev.detail ? ` · ${ev.detail}` : ""}</span></li>
                          ))}</ul>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>}

      {/* Resend modal */}
      <Modal
        open={resendFor !== null}
        onClose={() => setResendFor(null)}
        preventClose={resendBusy}
        title="Resend this email"
        footer={<>
          <Button variant="ghost" onClick={() => setResendFor(null)} disabled={resendBusy}>Cancel</Button>
          <Button onClick={submitResend} disabled={resendBusy || !resendTo.trim()}>
            {resendBusy ? "Sending…" : showUnblockBox && unblockFirst ? "Unblock and resend" : "Resend"}
          </Button>
        </>}
      >
        {resendFor && (
          <div className="space-y-3">
            <p className="text-sm text-brand-muted">&ldquo;{resendFor.subject ?? "(no subject)"}&rdquo; from {sourceLabel(resendFor.tag)}</p>
            <label className="block text-sm font-medium text-brand-black">
              Send to
              <input type="email" value={resendTo} onChange={e => setResendTo(e.target.value)}
                className="mt-1 w-full border border-brand-border rounded-lg px-3 py-2 text-sm font-normal" />
            </label>
            {showUnblockBox && (
              <label className="flex items-center gap-2 text-sm text-brand-black">
                <input type="checkbox" checked={unblockFirst} onChange={e => setUnblockFirst(e.target.checked)} />
                Unblock first
              </label>
            )}
            {resendError && <p role="alert" className="text-sm text-red-600">{resendError}</p>}
          </div>
        )}
      </Modal>

      {/* Block / unblock confirm */}
      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        preventClose={confirmBusy}
        title={confirm?.kind === "block" ? "Block this address?" : "Unblock this address?"}
        size="sm"
        footer={<>
          <Button variant="ghost" onClick={() => setConfirm(null)} disabled={confirmBusy}>Cancel</Button>
          <Button variant={confirm?.kind === "block" ? "danger" : "primary"} onClick={runConfirm} disabled={confirmBusy}>
            {confirmBusy ? "Working…" : confirm?.kind === "block" ? "Block" : "Unblock"}
          </Button>
        </>}
      >
        {confirm && (
          <div className="space-y-2 text-sm">
            <p className="break-all font-medium text-brand-black">{confirm.email}</p>
            <p className="text-brand-muted">
              {confirm.kind === "block"
                ? "Rosably will stop sending email to this address until it is unblocked."
                : "Rosably will be able to send email to this address again."}
            </p>
            {confirmError && <p role="alert" className="text-red-600">{confirmError}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
