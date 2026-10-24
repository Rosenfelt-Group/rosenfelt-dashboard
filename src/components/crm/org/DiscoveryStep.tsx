"use client";
// Engagement → Discovery: the deal's questionnaires with the tools from /crm/discovery/[id] inline.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { format, formatDistanceToNow } from "date-fns";
import { fetchJson } from "@/lib/fetch-json";
import { STATUS_META } from "@/lib/discovery";
import { estimateMinutes, resolveSnapshot, visibleSections } from "@/lib/discovery/snapshot";
import { inviteEmail } from "@/lib/discovery/invite-email";
import type { DiscoveryInvite } from "@/types";
import type { InviteSummary } from "@/lib/crm/org-engagement";
import { CopyButton } from "@/components/crm/CopyButton";
import { SamMarkdown } from "@/components/SamMarkdown";
import { NewDiscoveryModal } from "@/components/crm/NewDiscoveryModal";
import { DraftEditor } from "@/components/crm/discovery/DraftEditor";
import { DeleteDiscoveryButton } from "@/components/crm/discovery/DeleteDiscoveryButton";
import { QuestionnaireOutline } from "@/components/crm/discovery/QuestionnaireOutline";
import { ResendInviteEmail } from "@/components/crm/discovery/EmailInvite";
import { Button, ErrorState, LoadingState } from "@/components/ui";

type Detail = DiscoveryInvite & { link: string };
type Panel = "none" | "questions" | "brief";

export function DiscoveryStep({ leadId, invites, onChanged }: { leadId: string; invites: InviteSummary[]; onChanged: () => void }) {
  const [activeId, setActiveId] = useState<string | null>(invites[0]?.id ?? null);
  const [showNew, setShowNew] = useState(false);
  useEffect(() => {
    if (!invites.some((i) => i.id === activeId)) setActiveId(invites[0]?.id ?? null);
  }, [invites, activeId]);

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-brand-black">Discovery questionnaire</h3>
        <Button size="sm" variant="secondary" onClick={() => setShowNew(true)}>+ New questionnaire</Button>
      </div>
      {invites.length === 0 ? (
        <p className="text-sm text-brand-muted">No questionnaire for this deal yet. Starting one creates a draft from your default template.</p>
      ) : (
        <>
          {invites.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {invites.map((i) => (
                <button key={i.id} type="button" aria-pressed={i.id === activeId} onClick={() => setActiveId(i.id)}
                  className={clsx("text-xs px-2 py-1 rounded border", i.id === activeId ? "border-brand-orange text-brand-orange" : "border-brand-border text-brand-muted")}>
                  {i.project_title} · {STATUS_META[i.status as keyof typeof STATUS_META]?.label ?? i.status}
                </button>
              ))}
            </div>
          )}
          {activeId && <InviteCard key={activeId} inviteId={activeId} onChanged={onChanged} />}
        </>
      )}
      {showNew && <NewDiscoveryModal initialLeadId={leadId} onClose={() => setShowNew(false)} />}
    </div>
  );
}

function InviteCard({ inviteId, onChanged }: { inviteId: string; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [panel, setPanel] = useState<Panel>("none");
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    const r = await fetchJson<Detail>(`/api/crm/discovery/${inviteId}`);
    if (r.ok) { setD(r.data); setLoadErr(null); } else setLoadErr(r.error);
    return r.ok ? r.data : null;
  }, [inviteId]);
  useEffect(() => { load(); }, [load]);

  const liveBrief = d?.briefs?.find((b) => b.status === "ready" || b.status === "pending");
  const lastBrief = liveBrief ?? d?.briefs?.[0];
  useEffect(() => {
    if (lastBrief?.status !== "pending") return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [lastBrief?.status, load]);

  async function patch(body: Record<string, unknown>, label: string) {
    setBusy(label); setError("");
    const r = await fetchJson<Detail>(`/api/crm/discovery/${inviteId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy("");
    if (!r.ok) setError(r.error); else { await load(); onChanged(); }
  }

  async function generateBrief() {
    setBusy("brief"); setError(""); setPanel("brief");
    // Show the pending state at once; the request waits for generation to finish.
    const req = fetch(`/api/crm/discovery/${inviteId}/brief`, { method: "POST" });
    setTimeout(load, 1500);
    const res = await req;
    const data = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) setError(data.error ?? "Brief generation failed");
    await load();
    onChanged();
  }

  if (loadErr) return <ErrorState message={`Couldn't load the questionnaire: ${loadErr}`} onRetry={load} />;
  if (!d) return <LoadingState rows={2} />;

  const st = STATUS_META[d.status];
  const contact = d.contact ? `${d.contact.first_name}${d.contact.last_name ? " " + d.contact.last_name : ""}` : "—";
  const schema = resolveSnapshot(d);
  const sections = schema ? visibleSections(schema, d.project_type) : [];
  const questionCount = sections.reduce((n, s) => n + s.fields.length, 0);
  const answered = Object.values(d.response?.answers ?? {}).filter((v) => v !== null && v !== "" && !(Array.isArray(v) && v.length === 0)).length;
  const expired = d.status !== "submitted" && new Date(d.expires_at) < new Date();
  const open = d.status !== "submitted" && d.status !== "archived" && d.status !== "draft";

  return (
    <div className="border border-brand-border rounded-lg p-3 space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <p className="text-sm font-medium text-brand-black">{d.project_title}</p>
          <p className="text-xs text-brand-muted">
            {schema?.template?.name ? `${schema.template.name} · ` : ""}{questionCount} question{questionCount === 1 ? "" : "s"} · to {contact}
            {d.contact?.email ? ` (${d.contact.email})` : ""}
          </p>
        </div>
        <span className="flex items-center gap-1.5">
          <span className={clsx("badge text-xs", st.color)}>{st.label}</span>
          {expired && <span className="badge badge-error text-xs">Link expired</span>}
        </span>
      </div>

      {d.status === "draft" ? (
        editing ? (
          <DraftEditor key={d.id} invite={d} onChanged={(next) => {
            if (!next) { onChanged(); return; }
            if (next.status === "draft") setD(next);
            else { setEditing(false); load(); onChanged(); }
          }} />
        ) : (
          <div className="flex flex-wrap gap-2 items-center">
            <p className="text-xs text-brand-muted flex-1 min-w-48">Draft. Nothing reaches the prospect until you send it from the editor.</p>
            <Button size="sm" onClick={() => setEditing(true)}>Edit questions and send</Button>
          </div>
        )
      ) : (
        <>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            {([["Sent", d.sent_at], ["Opened", d.opened_at], ["Last saved", d.last_saved_at], ["Submitted", d.submitted_at]] as const).map(([label, at]) => (
              <div key={label}><dt className="text-brand-muted">{label}</dt><dd className="text-brand-black">{at ? formatDistanceToNow(new Date(at), { addSuffix: true }) : "—"}</dd></div>
            ))}
          </dl>
          <p className="text-xs text-brand-muted">Responses: {answered} of {questionCount}</p>
          <div className="flex flex-wrap gap-2">
            {open && (
              <>
                <CopyButton text={d.link} label="Copy link" />
                <CopyButton label="Copy invite email" text={inviteEmail({
                  firstName: d.contact?.first_name, orgName: d.business?.name, projectTitle: d.project_title, link: d.link,
                  minutes: schema ? schema.estimated_minutes ?? estimateMinutes(schema) : undefined,
                })} />
                {/* preview=1: read-only, and doesn't mark the invite opened */}
                <a href={`${d.link}&preview=1`} target="_blank" rel="noopener noreferrer" className="btn-ghost text-xs px-3 py-1.5">Preview ↗</a>
                <Button variant="ghost" size="sm" onClick={() => patch({ extend_days: 30 }, "extend")} disabled={!!busy}>
                  {busy === "extend" ? "…" : `Extend 30 days (expires ${format(new Date(d.expires_at), "MMM d")})`}
                </Button>
              </>
            )}
            <Button variant="secondary" size="sm" onClick={() => setPanel(panel === "questions" ? "none" : "questions")}>
              {panel === "questions" ? "Hide questions" : "Questions"}
            </Button>
            {d.status === "submitted" && (
              lastBrief?.status === "ready"
                ? <Button size="sm" onClick={() => setPanel(panel === "brief" ? "none" : "brief")}>{panel === "brief" ? "Hide brief" : "Read brief"}</Button>
                : lastBrief?.status === "pending"
                  ? <Button size="sm" disabled>Generating brief…</Button>
                  : <Button size="sm" onClick={generateBrief} disabled={!!busy}>{lastBrief?.status === "failed" ? "Retry brief" : "Generate brief"}</Button>
            )}
          </div>
          {open && !expired && ["sent", "opened", "in_progress"].includes(d.status) && (
            <ResendInviteEmail inviteId={d.id} defaultTo={d.contact?.email} defaultFirstName={d.contact?.first_name} />
          )}
          {panel === "questions" && schema && (
            <div className="max-h-[32rem] overflow-y-auto">
              <QuestionnaireOutline def={{ ...schema, sections }} onChange={() => {}} onAddFromBank={() => {}} readOnly />
            </div>
          )}
          {panel === "brief" && lastBrief && (
            <div className="border-t border-brand-border pt-3">
              {lastBrief.status === "pending" ? (
                <p className="text-sm text-brand-muted">Generating the brief, usually under a minute.</p>
              ) : lastBrief.status === "failed" ? (
                <p className="text-sm text-red-700">Brief generation failed: {lastBrief.error ?? "unknown error"}</p>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                    <p className="text-xs text-brand-muted">
                      Generated {lastBrief.completed_at ? formatDistanceToNow(new Date(lastBrief.completed_at), { addSuffix: true }) : ""}{lastBrief.model ? ` · ${lastBrief.model}` : ""}
                    </p>
                    <span className="flex gap-2">
                      <CopyButton text={lastBrief.content_md ?? ""} label="Copy markdown" />
                      <Button variant="ghost" size="sm" onClick={generateBrief} disabled={!!busy}>{busy === "brief" ? "Regenerating…" : "Regenerate"}</Button>
                    </span>
                  </div>
                  <div className="text-sm text-brand-black max-h-[32rem] overflow-y-auto"><SamMarkdown content={lastBrief.content_md ?? ""} /></div>
                </>
              )}
            </div>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs border-t border-brand-border pt-2">
        <Link href={`/crm/discovery/${d.id}`} className="text-brand-orange hover:underline">Answers and full page →</Link>
        {d.status === "submitted" && (
          <button type="button" className="text-brand-muted hover:text-brand-black" disabled={!!busy}
            onClick={() => { if (confirm("Reopen so they can edit and resubmit? Their answers are kept.")) patch({ reopen: true, extend_days: 14 }, "reopen"); }}>
            Reopen for edits
          </button>
        )}
        {d.status !== "draft" && (
          <button type="button" className="text-brand-muted hover:text-brand-black" disabled={!!busy}
            onClick={() => patch({ archived: d.status !== "archived" }, "archive")}>
            {d.status === "archived" ? "Unarchive" : "Archive"}
          </button>
        )}
        <span className="ml-auto">
          <DeleteDiscoveryButton inviteId={d.id} status={d.status} hasResponse={!!d.response} disabled={!!busy} onDeleted={onChanged} />
        </span>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
