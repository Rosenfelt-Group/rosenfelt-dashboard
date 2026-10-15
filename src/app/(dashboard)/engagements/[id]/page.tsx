"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { fetchJson } from "@/lib/rooms/fetch-json";
import { WelcomeEditor } from "./WelcomeEditor";
import { DocumentUpload } from "./DocumentUpload";
import { canPreviewDoc } from "@/lib/rooms/doc-limits";
import { formatVersionDate, formatRelativeTitle } from "@/lib/rooms/format";

type Version = { id: string; version_no: number; status: string; change_summary: string | null; built_by_agent: string | null; created_at: string; source: string; manifest: { filename?: string; size?: number; ext?: string } | null };
type Deliverable = { id: string; title: string; kind: string; welcome_message: string | null; versions: Version[] };
type Access = { id: string; label: string | null; expires_at: string; revoked_at: string | null; last_used_at: string | null };
type ActivityEvent = { id: number; type: string; created_at: string; contact: { name: string; email: string } | null; version: { deliverable_title: string; version_no: number } | null; deliverable_title: string | null };
type ActivityContact = { id: string; name: string; email: string; first_seen_at: string };
type Activity = { events: ActivityEvent[]; contacts: ActivityContact[] };
type Detail = { engagement: { id: string; title: string; relationship: string; status: string }; business: { name: string } | null; deliverables: Deliverable[] };

export default function EngagementPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<"deliverables" | "access" | "activity">("deliverables");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [access, setAccess] = useState<Access[]>([]);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [activityErr, setActivityErr] = useState<string | null>(null);
  const [newLink, setNewLink] = useState<string | null>(null);
  const [confirmShare, setConfirmShare] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmRefresh, setConfirmRefresh] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [docPreview, setDocPreview] = useState<{ versionId: string; url: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [brief, setBrief] = useState("");
  const [delivTitle, setDelivTitle] = useState("");
  const [delivId, setDelivId] = useState("");
  const [label, setLabel] = useState("");

  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    const [d, a] = await Promise.all([
      fetchJson<Detail>(`/api/engagements/${id}`),
      fetchJson<Access[]>(`/api/engagements/${id}/access`),
    ]);
    if (!d.ok) { setLoadErr(d.error); return; }
    if (!d.data.engagement) { setLoadErr("Engagement not found"); return; }
    setLoadErr(null);
    setDetail(d.data);
    if (a.ok) setAccess(Array.isArray(a.data) ? a.data : []);
    else setMsg(`Couldn't load access links: ${a.error}`);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const loadActivity = useCallback(async () => {
    setActivityErr(null);
    const r = await fetchJson<Activity>(`/api/engagements/${id}/activity`);
    if (!r.ok) { setActivityErr(r.error); return; }
    setActivity({
      events: Array.isArray(r.data?.events) ? r.data.events : [],
      contacts: Array.isArray(r.data?.contacts) ? r.data.contacts : [],
    });
  }, [id]);
  useEffect(() => {
    if (tab === "activity" && !activity && !activityErr) loadActivity();
  }, [tab, activity, activityErr, loadActivity]);

  const describeEvent = (e: ActivityEvent): string => {
    if (e.type === "room_opened") return "Someone opened the room";
    if (e.type === "contact_identified") return `${e.contact?.name ?? "A visitor"} introduced themselves`;
    if (e.type === "version_viewed") {
      return `${e.contact?.name ?? "A visitor"} viewed ${e.version ? `${e.version.deliverable_title} v${e.version.version_no}` : "a version"}`;
    }
    if (e.type === "document_downloaded") {
      return `${e.contact?.name ?? "A visitor"} downloaded ${e.version ? `${e.version.deliverable_title} v${e.version.version_no}` : "a document"}`;
    }
    if (e.type === "deliverable_deleted") return `Deleted \u201c${e.deliverable_title ?? "a deliverable"}\u201d`;
    if (e.type === "link_refreshed") return "A room link was refreshed (the old link stopped working)";
    return e.type;
  };

  async function guarded(key: string, fn: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(key); setMsg(null);
    try { await fn(); } finally { inFlight.current = false; setPending(null); }
  }

  const requestPrototype = () => guarded("proto", async () => {
    const r = await fetchJson<{ work_item_id: string; dispatched: boolean; dispatch_error?: string }>(`/api/engagements/${id}/prototype-request`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent: "casey", brief,
        ...(delivId ? { deliverable_id: delivId } : { deliverable_title: delivTitle }),
      }),
    });
    if (!r.ok) { setMsg(r.error); return; }
    setMsg(
      r.data.dispatched
        ? `Casey was started on work item ${r.data.work_item_id}. The draft appears under this deliverable when she publishes.`
        : `Work item ${r.data.work_item_id} was created, but starting Casey failed (${r.data.dispatch_error ?? "unknown error"}). Dispatch it from the Work page.`,
    );
    setBrief(""); setDelivTitle(""); setDelivId(""); await load();
  });

  const preview = (versionId: string) => guarded("preview", async () => {
    const r = await fetchJson<{ url: string }>(`/api/versions/${versionId}/preview`);
    if (r.ok) { setDocPreview(null); setPreviewUrl(r.data.url); }
    else { setPreviewUrl(null); setMsg(r.error); }
  });

  const docPreviewOpen = (versionId: string) => guarded("docpreview", async () => {
    const r = await fetchJson<{ url: string }>(`/api/versions/${versionId}/doc-preview`);
    if (r.ok) { setPreviewUrl(null); setDocPreview({ versionId, url: r.data.url }); }
    else setMsg(r.error);
  });

  const download = (versionId: string) => guarded("download", async () => {
    const r = await fetchJson<{ url: string }>(`/api/versions/${versionId}/download`);
    if (r.ok) window.location.assign(r.data.url);
    else setMsg(r.error);
  });

  const deleteDeliverable = (deliverableId: string, title: string) => guarded("delete", async () => {
    const r = await fetchJson<{ deleted: boolean; files_removed: number; files_left: number }>(`/api/deliverables/${deliverableId}`, { method: "DELETE" });
    setConfirmDelete(null);
    if (!r.ok) { setMsg(r.error); return; }
    setPreviewUrl(null);
    setDocPreview(null);
    setMsg(r.data.files_left > 0
      ? `Deleted “${title}”. ${r.data.files_left} file(s) could not be removed from storage; they are no longer reachable from any room.`
      : `Deleted “${title}”.`);
    await load();
  });

  const share = (versionId: string, versionNo: number) => guarded("share", async () => {
    const r = await fetchJson(`/api/versions/${versionId}/share`, { method: "POST" });
    setConfirmShare(null);
    if (!r.ok) { setMsg(r.error); return; }
    setMsg(`v${versionNo} is now visible in the room.`);
    await load();
  });

  const issue = () => guarded("issue", async () => {
    const r = await fetchJson<{ link: string }>(`/api/engagements/${id}/access`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: label || undefined }),
    });
    if (!r.ok) { setMsg(r.error); return; }
    setNewLink(r.data.link); setLabel(""); await load();
  });

  const revoke = (accessId: string) => guarded("revoke", async () => {
    const r = await fetchJson(`/api/engagements/${id}/access?access_id=${accessId}`, { method: "DELETE" });
    if (!r.ok) { setMsg(`Revoke failed: ${r.error}`); return; }
    await load();
  });

  const refreshLink = (accessId: string) => guarded("refresh", async () => {
    const r = await fetchJson<{ link: string }>(`/api/engagements/${id}/access/${accessId}/refresh`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    setConfirmRefresh(null);
    if (!r.ok) { setMsg(`Refresh failed: ${r.error}`); return; }
    setNewLink(r.data.link);
    setMsg("The old link no longer works. Send the new link below.");
    await load();
  });

  if (loadErr && !detail) {
    return (
      <div className="p-6 text-sm">
        <p className="text-red-600 mb-2">Couldn&apos;t load engagement: {loadErr}</p>
        <button onClick={load} className="px-3 py-1.5 rounded border border-brand-border">Retry</button>
      </div>
    );
  }
  if (!detail) return <p className="p-6 text-sm text-brand-muted">Loading…</p>;
  const { engagement, business, deliverables } = detail;

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-lg font-semibold text-brand-black">{engagement.title}</h1>
      <p className="text-sm text-brand-muted mb-4">{business?.name} · {engagement.relationship} · {engagement.status}</p>

      <div className="flex gap-4 border-b border-brand-border mb-4">
        {(["deliverables", "access", "activity"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`pb-2 text-sm capitalize ${tab === t ? "border-b-2 border-brand-orange text-brand-orange" : "text-brand-muted"}`}>
            {t}
          </button>
        ))}
      </div>

      {msg && <p className="text-sm mb-3">{msg}</p>}

      {tab === "deliverables" && (
        <div className="space-y-6">
          <div className="border border-brand-border rounded p-3 space-y-2">
            <h2 className="text-sm font-semibold">Request prototype</h2>
            <select value={delivId} onChange={e => setDelivId(e.target.value)} className="border border-brand-border rounded px-2 py-1.5 text-sm">
              <option value="">New deliverable…</option>
              {deliverables.filter(d => d.kind === "prototype").map(d => <option key={d.id} value={d.id}>New version of: {d.title}</option>)}
            </select>
            {!delivId && (
              <input value={delivTitle} onChange={e => setDelivTitle(e.target.value)} placeholder="Deliverable title"
                className="w-full border border-brand-border rounded px-2 py-1.5 text-sm" />
            )}
            <textarea value={brief} onChange={e => setBrief(e.target.value)} rows={5} placeholder="What should the prototype show?"
              className="w-full border border-brand-border rounded px-2 py-1.5 text-sm" />
            <button disabled={!!pending || !brief.trim() || (!delivId && !delivTitle.trim())} onClick={requestPrototype}
              className="px-3 py-1.5 text-sm rounded bg-brand-orange text-white disabled:opacity-50">
              Send to Casey
            </button>
          </div>

          <DocumentUpload engagementId={id} documents={deliverables.filter(d => d.kind === "document").map(d => ({ id: d.id, title: d.title }))}
            onDone={(m) => { setMsg(m); void load(); }} />

          {deliverables.map(d => (
            <div key={d.id}>
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold">{d.title}</h3>
                <button disabled={!!pending} onClick={() => setConfirmDelete(d.id)} className="text-xs text-red-600 disabled:opacity-50">Delete</button>
              </div>
              {confirmDelete === d.id && (
                <div className="mb-2 border border-red-300 bg-red-50 rounded p-2 text-sm flex flex-wrap items-center gap-2">
                  <span>
                    Permanently delete “{d.title}” with its {d.versions.length} version(s), all comments and all files?
                    Visitors lose access immediately. This cannot be undone. Casey&apos;s work items are kept.
                  </span>
                  <button disabled={!!pending} onClick={() => deleteDeliverable(d.id, d.title)} className="px-2 py-1 rounded bg-red-600 text-white disabled:opacity-50">Delete permanently</button>
                  <button disabled={!!pending} onClick={() => setConfirmDelete(null)} className="px-2 py-1 rounded border border-brand-border disabled:opacity-50">Cancel</button>
                </div>
              )}
              <WelcomeEditor key={`${d.id}:${d.welcome_message ?? ""}`} deliverableId={d.id} initial={d.welcome_message}
                onSaved={(m) => { setMsg(m); void load(); }} />
              {d.versions.length === 0 ? <p className="text-sm text-brand-muted">No versions yet.</p> : (
                <ul className="divide-y divide-brand-border border border-brand-border rounded">
                  {d.versions.map(v => (
                    <li key={v.id} className="px-3 py-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span>v{v.version_no} · {v.status === "shared" ? <strong>Shared</strong> : v.status}{v.source === "upload" && v.manifest?.filename ? ` · ${v.manifest.filename}` : ""}{v.change_summary ? ` · ${v.change_summary}` : ""}
                          <span className="text-brand-muted" title={formatRelativeTitle(v.created_at)}> · {formatVersionDate(v.created_at)}</span>
                        </span>
                        <span className="flex gap-3">
                          {v.status === "draft" && (
                            <button disabled={!!pending} onClick={() => setConfirmShare(v.id)} className="text-brand-orange disabled:opacity-50">Share with room</button>
                          )}
                          {v.source === "upload" ? (
                            <>
                              {canPreviewDoc(v.manifest?.ext) && (
                                <button disabled={!!pending} onClick={() => docPreviewOpen(v.id)} className="text-brand-orange disabled:opacity-50">Preview</button>
                              )}
                              <button disabled={!!pending} onClick={() => download(v.id)} className="text-brand-orange disabled:opacity-50">Download</button>
                            </>
                          ) : <button disabled={!!pending} onClick={() => preview(v.id)} className="text-brand-orange disabled:opacity-50">Preview</button>}
                        </span>
                      </div>
                      {confirmShare === v.id && (
                        <div className="mt-2 border border-amber-300 bg-amber-50 rounded p-2 flex flex-wrap items-center gap-2">
                          <span>Share v{v.version_no} with everyone who has a link to this room? The previous shared version will be marked as older.</span>
                          <button disabled={!!pending} onClick={() => share(v.id, v.version_no)} className="px-2 py-1 rounded bg-brand-orange text-white disabled:opacity-50">Share</button>
                          <button disabled={!!pending} onClick={() => setConfirmShare(null)} className="px-2 py-1 rounded border border-brand-border disabled:opacity-50">Cancel</button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          {previewUrl && (
            <>
              <p className="text-xs text-brand-muted mb-1">
                Prototype preview — untrusted content. Do not enter real passwords or personal data.
              </p>
              <iframe src={previewUrl} sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer" title="Prototype preview"
                className="w-full h-[calc(100dvh-8rem)] min-h-[480px] border border-brand-border rounded" />
            </>
          )}

          {docPreview && (
            <>
              <div className="flex flex-wrap items-center gap-3 mb-1">
                <p className="text-xs text-brand-muted">Document preview. The link lasts about two minutes; use Reload if it stops loading.</p>
                <button disabled={!!pending} onClick={() => docPreviewOpen(docPreview.versionId)} className="text-xs text-brand-orange disabled:opacity-50">Reload preview</button>
                <button onClick={() => setDocPreview(null)} className="text-xs text-brand-muted">Close</button>
              </div>
              {/* No sandbox attribute: it would disable the browser's PDF viewer. The frame is a separate,
                  cookie-less origin that only this site may embed. */}
              <iframe src={docPreview.url} referrerPolicy="no-referrer" title="Document preview"
                className="w-full h-[calc(100dvh-8rem)] min-h-[480px] border border-brand-border rounded" />
            </>
          )}
        </div>
      )}

      {tab === "access" && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Label (e.g. ED + board chair)"
              className="border border-brand-border rounded px-2 py-1.5 text-sm flex-1" />
            <button disabled={!!pending} onClick={issue} className="px-3 py-1.5 text-sm rounded bg-brand-orange text-white disabled:opacity-50">Create link</button>
          </div>
          {newLink && (
            <div className="border border-amber-300 bg-amber-50 rounded p-3 text-sm break-all">
              <p className="font-medium mb-1">Copy this link now — it will not be shown again.</p>
              <code>{newLink}</code>
            </div>
          )}
          <ul className="divide-y divide-brand-border border border-brand-border rounded">
            {access.map(a => (
              <li key={a.id} className="px-3 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span>{a.label ?? "Unlabelled"} · expires {new Date(a.expires_at).toLocaleDateString()}
                    {a.revoked_at ? " · revoked" : ""}{a.last_used_at ? ` · last used ${formatDistanceToNow(new Date(a.last_used_at), { addSuffix: true })}` : ""}
                  </span>
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
                    <button disabled={!!pending} onClick={() => refreshLink(a.id)} className="px-2 py-1 rounded bg-brand-orange text-white disabled:opacity-50">Refresh link</button>
                    <button disabled={!!pending} onClick={() => setConfirmRefresh(null)} className="px-2 py-1 rounded border border-brand-border disabled:opacity-50">Cancel</button>
                  </div>
                )}
              </li>
            ))}
            {access.length === 0 && <li className="px-3 py-2 text-sm text-brand-muted">No links yet.</li>}
          </ul>
        </div>
      )}

      {tab === "activity" && (
        <div className="space-y-4">
          {activityErr && (
            <div className="text-sm">
              <p className="text-red-600 mb-2">Couldn&apos;t load activity: {activityErr}</p>
              <button onClick={loadActivity} className="px-3 py-1.5 rounded border border-brand-border">Retry</button>
            </div>
          )}
          {!activityErr && !activity && <p className="text-sm text-brand-muted">Loading…</p>}
          {activity && (
            <>
              {activity.contacts.length > 0 && (
                <div>
                  <h2 className="text-sm font-medium mb-1">People who opened this room</h2>
                  <p className="text-xs text-brand-muted mb-2">Names and emails are provided by the visitor, not verified.</p>
                  <ul className="divide-y divide-brand-border border border-brand-border rounded">
                    {activity.contacts.map(c => (
                      <li key={c.id} className="px-3 py-2 text-sm">{c.name} · {c.email}
                        <span className="text-brand-muted"> · first seen {formatDistanceToNow(new Date(c.first_seen_at), { addSuffix: true })}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <ul className="divide-y divide-brand-border border border-brand-border rounded">
                {activity.events.map(e => (
                  <li key={e.id} className="px-3 py-2 text-sm">{describeEvent(e)}
                    <span className="text-brand-muted"> · {formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}</span>
                  </li>
                ))}
                {activity.events.length === 0 && (
                  <li className="px-3 py-2 text-sm text-brand-muted">No activity yet. Share a version and send the room link.</li>
                )}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
