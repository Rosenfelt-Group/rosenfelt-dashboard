"use client";
// Engagement → Room: the deal's engagement rooms with the everyday tools from /engagements/[id] inline
// (preview, access links and invite email, deliverables with sharing and welcome text, asking Casey for a
// prototype). Document uploads, version previews and room activity stay on the full room manager.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";
import { fetchJson } from "@/lib/fetch-json";
import { formatVersionDate } from "@/lib/rooms/format";
import { minutesSince, type Build } from "@/lib/rooms/builds";
import { roomInviteEmail } from "@/lib/rooms/invite-email";
import type { RoomSummary } from "@/lib/crm/org-engagement";
import { CopyButton } from "@/components/crm/CopyButton";
import { WelcomeEditor } from "@/app/(dashboard)/engagements/[id]/WelcomeEditor";
import { SendInviteEmail } from "@/app/(dashboard)/engagements/[id]/SendInviteEmail";
import { Button, ErrorState, LoadingState } from "@/components/ui";

type Version = { id: string; version_no: number; status: string; change_summary: string | null; created_at: string; source: string; manifest: { filename?: string } | null };
type Deliverable = { id: string; title: string; kind: string; welcome_message: string | null; versions: Version[] };
type Access = { id: string; label: string | null; expires_at: string; revoked_at: string | null; last_used_at: string | null };
type Detail = { engagement: { id: string; title: string; relationship: string; status: string }; business: { id: string; name: string } | null; deliverables: Deliverable[] };

export function RoomStep({ businessId, leadId, clientId, relationship, rooms, onChanged }: {
  businessId: string; leadId: string | null; clientId: string | null; relationship: "prospect" | "client" | "partner";
  rooms: RoomSummary[]; onChanged: () => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(rooms[0]?.id ?? null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [rel, setRel] = useState(relationship);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (!rooms.some((r) => r.id === activeId)) setActiveId(rooms[0]?.id ?? null); }, [rooms, activeId]);

  async function create() {
    if (busy || !title.trim()) return;
    setBusy(true); setErr(null);
    const r = await fetchJson<{ id: string }>("/api/engagements", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_id: businessId, relationship: rel, title: title.trim(), ...(leadId ? { lead_id: leadId } : {}), ...(clientId ? { client_id: clientId } : {}) }),
    });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setCreating(false); setTitle(""); setActiveId(r.data.id);
    onChanged();
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-brand-black">Engagement room</h3>
        <Button size="sm" variant="secondary" onClick={() => setCreating((c) => !c)}>{creating ? "Cancel" : "+ New room"}</Button>
      </div>
      {creating && (
        <div className="border border-brand-border rounded p-3 space-y-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Room title (e.g. Volunteer intake)" aria-label="Room title"
            className="w-full border border-brand-border rounded px-2 py-1.5 text-sm" />
          <select value={rel} onChange={(e) => setRel(e.target.value as typeof rel)} aria-label="Relationship" className="border border-brand-border rounded px-2 py-1.5 text-sm">
            <option value="prospect">Prospect</option>
            <option value="client">Client</option>
            <option value="partner">Partner</option>
          </select>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <Button size="sm" disabled={busy || !title.trim()} onClick={create}>Create room</Button>
        </div>
      )}
      {rooms.length === 0 ? (
        !creating && <p className="text-sm text-brand-muted">No room yet. A room is where the client sees prototypes and documents.</p>
      ) : (
        <>
          {rooms.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {rooms.map((r) => (
                <button key={r.id} type="button" aria-pressed={r.id === activeId} onClick={() => setActiveId(r.id)}
                  className={clsx("text-xs px-2 py-1 rounded border", r.id === activeId ? "border-brand-orange text-brand-orange" : "border-brand-border text-brand-muted")}>
                  {r.title}
                </button>
              ))}
            </div>
          )}
          {activeId && <RoomPanel key={activeId} roomId={activeId} onChanged={onChanged} />}
        </>
      )}
    </div>
  );
}

function RoomPanel({ roomId, onChanged }: { roomId: string; onChanged: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [access, setAccess] = useState<Access[]>([]);
  const [builds, setBuilds] = useState<Build[]>([]);
  const [contacts, setContacts] = useState<string[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const inFlight = useRef(false);
  const [label, setLabel] = useState("");
  const [newLink, setNewLink] = useState<{ accessId: string; link: string; expiresAt: string | null; refreshed: boolean } | null>(null);
  const [confirmRefresh, setConfirmRefresh] = useState<string | null>(null);
  const [confirmShare, setConfirmShare] = useState<string | null>(null);
  const [showProto, setShowProto] = useState(false);
  const [brief, setBrief] = useState("");
  const [delivTitle, setDelivTitle] = useState("");
  const [delivId, setDelivId] = useState("");

  const load = useCallback(async () => {
    const [d, a, b] = await Promise.all([
      fetchJson<Detail>(`/api/engagements/${roomId}`),
      fetchJson<Access[]>(`/api/engagements/${roomId}/access`),
      fetchJson<{ builds: Build[] }>(`/api/engagements/${roomId}/builds`),
    ]);
    if (!d.ok) { setLoadErr(d.error); return; }
    setLoadErr(null);
    setDetail(d.data);
    if (a.ok) setAccess(Array.isArray(a.data) ? a.data : []);
    if (b.ok) setBuilds(Array.isArray(b.data.builds) ? b.data.builds : []);
  }, [roomId]);
  useEffect(() => { load(); }, [load]);
  // Emails of people who opened the room, offered as invite recipients.
  useEffect(() => {
    fetchJson<{ contacts: { email: string }[] }>(`/api/engagements/${roomId}/activity`).then((r) => {
      if (r.ok && Array.isArray(r.data?.contacts)) setContacts(r.data.contacts.map((c) => c.email));
    });
  }, [roomId]);
  // While a build is open, poll so a returned version shows up.
  useEffect(() => {
    if (builds.length === 0) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 15_000);
    return () => clearInterval(t);
  }, [builds.length, load]);

  async function guarded(key: string, fn: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(key); setMsg(null);
    try { await fn(); } finally { inFlight.current = false; setPending(null); }
  }

  // window.open must run synchronously inside the click, or the browser blocks it as a pop-up.
  const openRoomPreview = () => {
    if (inFlight.current) return;
    const w = window.open("", "_blank");
    if (!w) { setMsg("Your browser blocked the new tab. Allow pop-ups for this site and try again."); return; }
    w.opener = null;
    void guarded("room-preview", async () => {
      const r = await fetchJson<{ url: string }>(`/api/engagements/${roomId}/room-preview`, { method: "POST" });
      if (!r.ok) { w.close(); setMsg(r.error); return; }
      w.location.href = r.data.url;
    });
  };

  const issue = () => guarded("issue", async () => {
    const r = await fetchJson<{ id: string; link: string; expires_at?: string }>(`/api/engagements/${roomId}/access`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: label || undefined }),
    });
    if (!r.ok) { setMsg(r.error); return; }
    setNewLink({ accessId: r.data.id, link: r.data.link, expiresAt: r.data.expires_at ?? null, refreshed: false });
    setLabel(""); await load(); onChanged();
  });
  const revoke = (accessId: string) => guarded("revoke", async () => {
    const r = await fetchJson(`/api/engagements/${roomId}/access?access_id=${accessId}`, { method: "DELETE" });
    if (!r.ok) { setMsg(`Revoke failed: ${r.error}`); return; }
    await load(); onChanged();
  });
  const refreshLink = (accessId: string) => guarded("refresh", async () => {
    const r = await fetchJson<{ id: string; link: string; expires_at?: string }>(`/api/engagements/${roomId}/access/${accessId}/refresh`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    setConfirmRefresh(null);
    if (!r.ok) { setMsg(`Refresh failed: ${r.error}`); return; }
    setNewLink({ accessId: r.data.id, link: r.data.link, expiresAt: r.data.expires_at ?? null, refreshed: true });
    setMsg("The old link no longer works. Send the new link below.");
    await load();
  });
  const share = (versionId: string, versionNo: number) => guarded("share", async () => {
    const r = await fetchJson(`/api/versions/${versionId}/share`, { method: "POST" });
    setConfirmShare(null);
    if (!r.ok) { setMsg(r.error); return; }
    setMsg(`v${versionNo} is now visible in the room.`);
    await load(); onChanged();
  });
  const download = (versionId: string) => guarded("download", async () => {
    const r = await fetchJson<{ url: string }>(`/api/versions/${versionId}/download`);
    if (r.ok) window.location.assign(r.data.url); else setMsg(r.error);
  });
  const requestPrototype = () => guarded("proto", async () => {
    const r = await fetchJson<{ work_item_id: string; dispatched: boolean; dispatch_error?: string }>(`/api/engagements/${roomId}/prototype-request`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: "casey", brief, ...(delivId ? { deliverable_id: delivId } : { deliverable_title: delivTitle }) }),
    });
    if (!r.ok) { setMsg(r.error); return; }
    setMsg(r.data.dispatched
      ? `Casey was started on work item ${r.data.work_item_id}. The draft appears under this deliverable when she publishes.`
      : `Work item ${r.data.work_item_id} was created, but starting Casey failed (${r.data.dispatch_error ?? "unknown error"}). Dispatch it from the Work page.`);
    setBrief(""); setDelivTitle(""); setDelivId(""); setShowProto(false); await load();
  });

  if (loadErr && !detail) return <ErrorState message={`Couldn't load the room: ${loadErr}`} onRetry={load} />;
  if (!detail) return <LoadingState rows={2} />;
  const { engagement, business, deliverables } = detail;
  const live = access.filter((a) => !a.revoked_at && new Date(a.expires_at) > new Date());
  const invite = newLink && roomInviteEmail({ orgName: business?.name, roomTitle: engagement.title, link: newLink.link, expiresAt: newLink.expiresAt, refreshed: newLink.refreshed });

  return (
    <div className="border border-brand-border rounded-lg p-3 space-y-4">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <p className="text-sm font-medium text-brand-black">{engagement.title}</p>
          <p className="text-xs text-brand-muted">{engagement.relationship} · {engagement.status} · {live.length} active link{live.length === 1 ? "" : "s"}</p>
        </div>
        <span className="flex gap-2 flex-wrap">
          <Button size="sm" variant="secondary" disabled={!!pending} onClick={openRoomPreview}>Preview room</Button>
          <Button size="sm" disabled={!!pending} onClick={() => setShowProto((s) => !s)}>{showProto ? "Cancel" : "Ask Casey for a prototype"}</Button>
        </span>
      </div>
      {msg && <p className="text-sm" role="status">{msg}</p>}

      {showProto && (
        <div className="border border-brand-border rounded p-3 space-y-2">
          <select value={delivId} onChange={(e) => setDelivId(e.target.value)} aria-label="Deliverable" className="border border-brand-border rounded px-2 py-1.5 text-sm">
            <option value="">New deliverable…</option>
            {deliverables.filter((d) => d.kind === "prototype").map((d) => <option key={d.id} value={d.id}>New version of: {d.title}</option>)}
          </select>
          {!delivId && (
            <input value={delivTitle} onChange={(e) => setDelivTitle(e.target.value)} placeholder="Deliverable title" aria-label="Deliverable title"
              className="w-full border border-brand-border rounded px-2 py-1.5 text-sm" />
          )}
          <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={4} placeholder="What should the prototype show?" aria-label="Prototype brief"
            className="w-full border border-brand-border rounded px-2 py-1.5 text-sm" />
          <Button size="sm" disabled={!!pending || !brief.trim() || (!delivId && !delivTitle.trim())} onClick={requestPrototype}>Send to Casey</Button>
        </div>
      )}

      <div>
        <h4 className="text-xs font-semibold text-brand-black mb-1">Deliverables</h4>
        {deliverables.length === 0 ? <p className="text-xs text-brand-muted">Nothing in the room yet.</p> : (
          <ul className="space-y-3">
            {deliverables.map((d) => {
              const latest = d.versions[0];
              const shared = d.versions.find((v) => v.status === "shared");
              const draft = d.versions.find((v) => v.status === "draft");
              return (
                <li key={d.id} className="text-sm">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <span>
                      <span className="font-medium">{d.title}</span>
                      <span className="text-xs text-brand-muted"> · {d.kind} · {d.versions.length} version{d.versions.length === 1 ? "" : "s"}
                        {shared ? ` · v${shared.version_no} shared` : " · not shared"}{latest ? ` · latest ${formatVersionDate(latest.created_at)}` : ""}</span>
                    </span>
                    <span className="flex gap-3 text-xs">
                      {draft && <button disabled={!!pending} onClick={() => setConfirmShare(draft.id)} className="text-brand-orange disabled:opacity-50">Share v{draft.version_no}</button>}
                      {latest?.source === "upload" && <button disabled={!!pending} onClick={() => download(latest.id)} className="text-brand-orange disabled:opacity-50">Download</button>}
                    </span>
                  </div>
                  {draft && confirmShare === draft.id && (
                    <div className="mt-1 border border-amber-300 bg-amber-50 rounded p-2 flex flex-wrap items-center gap-2 text-xs">
                      <span>Share v{draft.version_no} with everyone who has a link to this room? The previous shared version will be marked as older.</span>
                      <Button size="sm" disabled={!!pending} onClick={() => share(draft.id, draft.version_no)}>Share</Button>
                      <Button variant="secondary" size="sm" disabled={!!pending} onClick={() => setConfirmShare(null)}>Cancel</Button>
                    </div>
                  )}
                  {d.kind === "prototype" && builds.filter((b) => b.deliverable_id === d.id).map((b) => (
                    <p key={b.work_item_id} role="status" className="mt-1 text-xs border border-blue-200 bg-blue-50 rounded px-2 py-1">
                      {b.agent ? b.agent.charAt(0).toUpperCase() + b.agent.slice(1) : "The agent"} is working on a new version · {b.status.replace(/_/g, " ")}
                      {b.ref !== null && <> · <a href={`/work/${b.ref}`} className="underline">work item #{b.ref}</a></>}
                      {b.stalled && <span className="text-amber-700"> · no update for {minutesSince(b.last_activity_at, Date.now())} minutes</span>}
                    </p>
                  ))}
                  <div className="mt-1">
                    <WelcomeEditor key={`${d.id}:${d.welcome_message ?? ""}`} deliverableId={d.id} initial={d.welcome_message}
                      onSaved={(m) => { setMsg(m); void load(); }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div>
        <h4 className="text-xs font-semibold text-brand-black mb-1">Access links</h4>
        <div className="flex gap-2 mb-2">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. ED + board chair)" aria-label="Link label"
            className="border border-brand-border rounded px-2 py-1.5 text-sm flex-1" />
          <Button size="sm" disabled={!!pending} onClick={issue}>Create link</Button>
        </div>
        {newLink && (
          <div className="border border-amber-300 bg-amber-50 rounded p-3 text-sm break-all mb-2">
            <p className="font-medium mb-1">Copy this link now. It will not be shown again.</p>
            <code>{newLink.link}</code>
            {invite && (
              <div className="mt-2 flex flex-wrap gap-2">
                <CopyButton text={newLink.link} label="Copy link" />
                <CopyButton text={invite.body} label="Copy invite email" />
                <CopyButton text={invite.subject} label="Copy subject" />
              </div>
            )}
            <SendInviteEmail key={newLink.accessId} engagementId={roomId} accessId={newLink.accessId} link={newLink.link}
              refreshed={newLink.refreshed} suggestions={contacts} />
          </div>
        )}
        <ul className="divide-y divide-brand-border border border-brand-border rounded">
          {access.map((a) => (
            <li key={a.id} className="px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span>{a.label ?? "Unlabelled"} · expires {new Date(a.expires_at).toLocaleDateString()}
                  {a.revoked_at ? " · revoked" : ""}{a.last_used_at ? ` · last used ${formatDistanceToNow(new Date(a.last_used_at), { addSuffix: true })}` : ""}</span>
                {!a.revoked_at && (
                  <span className="flex gap-3">
                    <button disabled={!!pending} onClick={() => setConfirmRefresh(a.id)} className="text-brand-orange disabled:opacity-50">Refresh</button>
                    <button disabled={!!pending} onClick={() => revoke(a.id)} className="text-red-600 disabled:opacity-50">Revoke</button>
                  </span>
                )}
              </div>
              {confirmRefresh === a.id && (
                <div className="mt-2 border border-amber-300 bg-amber-50 rounded p-2 flex flex-wrap items-center gap-2">
                  <span>Replace this link? The current link stops working immediately and a new one (60 days) is shown once.</span>
                  <Button size="sm" disabled={!!pending} onClick={() => refreshLink(a.id)}>Refresh link</Button>
                  <Button variant="secondary" size="sm" disabled={!!pending} onClick={() => setConfirmRefresh(null)}>Cancel</Button>
                </div>
              )}
            </li>
          ))}
          {access.length === 0 && <li className="px-3 py-2 text-xs text-brand-muted">No links yet.</li>}
        </ul>
      </div>

      <Link href={`/engagements/${roomId}`} className="text-xs text-brand-orange hover:underline inline-block">
        Open the room manager (documents, previews, activity) →
      </Link>
    </div>
  );
}
