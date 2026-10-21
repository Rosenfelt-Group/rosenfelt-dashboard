"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import { format, formatDistanceToNow } from "date-fns";
import { CopyButton } from "@/components/crm/CopyButton";
import { inviteEmail } from "@/lib/discovery/invite-email";
import { SamMarkdown } from "@/components/SamMarkdown";
import { DiscoveryInvite, DiscoveryFieldDef } from "@/types";
import { PROJECT_TYPES, STATUS_META, isEmptyAnswer, isFieldVisible } from "@/lib/discovery";
import { estimateMinutes, resolveSnapshot, visibleSections } from "@/lib/discovery/snapshot";
import { DraftEditor } from "@/components/crm/discovery/DraftEditor";
import { DeleteDiscoveryButton } from "@/components/crm/discovery/DeleteDiscoveryButton";
import { QuestionnaireOutline } from "@/components/crm/discovery/QuestionnaireOutline";
import { ResendInviteEmail } from "@/components/crm/discovery/EmailInvite";
import { ScopeLink } from "@/components/crm/scope/ScopeLink";
import { fetchJson } from "@/lib/fetch-json";
import { Button, EmptyState, ErrorState, LoadingState, PageHeader, Tabs } from "@/components/ui";

type Detail = DiscoveryInvite & { link: string };
type Tab = "brief" | "answers" | "questions" | "project";
const TAB_LABEL: Record<Tab, string> = { brief: "Pre-call brief", answers: "Answers", questions: "Questions sent", project: "Project" };
const TABS = (["brief", "answers", "questions", "project"] as Tab[]).map(t => ({ id: t, label: TAB_LABEL[t] }));

function Answer({ field, answers }: { field: DiscoveryFieldDef; answers: Record<string, unknown> }) {
  const v = answers[field.id];
  const other = answers[`${field.id}__other`] as string | undefined;
  if (isEmptyAnswer(v)) return <span className="text-brand-muted">—</span>;

  if (field.type === "yes_no") {
    const detail = answers[`${field.id}__detail`] as string | undefined;
    return (
      <span className="whitespace-pre-wrap">
        {String(v)}
        {detail?.trim() && <span className="block text-brand-muted mt-1">{field.followUpLabel ? `${field.followUpLabel} ` : ""}<span className="text-brand-black">{detail}</span></span>}
      </span>
    );
  }

  if (field.type === "tool_rows" && Array.isArray(v) && field.columns) {
    const rows = (v as Record<string, string>[]).filter(r => !isEmptyAnswer([r]));
    return (
      <div className="overflow-x-auto">
        <table className="text-xs w-full">
          <thead>
            <tr>{field.columns.map(c => <th key={c.id} className="text-left font-medium text-brand-muted pr-3 pb-1">{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-brand-border">
                {field.columns!.map(c => <td key={c.id} className="pr-3 py-1 text-brand-black align-top">{r[c.id] || "—"}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (Array.isArray(v)) {
    return (
      <div className="flex flex-wrap gap-1">
        {(v as string[]).map(x => (
          <span key={x} className="badge badge-neutral text-xs">{x === "Other" && other ? `Other: ${other}` : x}</span>
        ))}
      </div>
    );
  }
  if (field.type === "scale") return <span>{String(v)} / {field.max ?? 5}</span>;
  return (
    <span className="whitespace-pre-wrap">
      {String(v)}{v === "Other" && other ? `: ${other}` : ""}
    </span>
  );
}

export default function DiscoveryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("brief");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    return fetchJson<Detail>(`/api/crm/discovery/${id}`).then(r => {
      if (r.ok) { setD(r.data?.id ? r.data : null); setLoadError(null); }
      else if (r.status === 404) setD(null);
      else setLoadError(r.error);
      setLoading(false);
      return r.ok ? r.data : null;
    });
  }, [id]);

  useEffect(() => {
    load().then(data => { if (data?.status !== "submitted") setTab("answers"); });
  }, [load]);

  const liveBrief = d?.briefs?.find(b => b.status === "ready" || b.status === "pending");
  const lastBrief = liveBrief ?? d?.briefs?.[0];

  // Poll while a brief is generating.
  useEffect(() => {
    if (lastBrief?.status !== "pending") return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [lastBrief?.status, load]);

  async function patch(body: Record<string, unknown>, label: string) {
    setBusy(label); setError("");
    const res = await fetch(`/api/crm/discovery/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    setBusy("");
    if (!res.ok) setError(data.error ?? "Update failed"); else setD(data);
  }

  async function regenerate() {
    setBusy("brief"); setError("");
    // Show the pending state immediately; the request waits for generation to finish.
    const req = fetch(`/api/crm/discovery/${id}/brief`, { method: "POST" });
    setTimeout(load, 1500);
    const res = await req;
    const data = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) setError(data.error ?? "Brief generation failed");
    load();
  }

  if (loading) return <div className="p-8"><LoadingState /></div>;
  if (!d) {
    return (
      <div className="p-8">
        {loadError
          ? <ErrorState message={`Couldn't load this questionnaire: ${loadError}`} onRetry={load} />
          : <p className="text-brand-muted">Not found.</p>}
        <Link href="/crm/discovery" className="text-brand-orange text-sm mt-2 block">← Back to discovery</Link>
      </div>
    );
  }

  if (d.status === "draft") {
    const contact = d.contact ? `${d.contact.first_name}${d.contact.last_name ? " " + d.contact.last_name : ""}` : "—";
    return (
      <div className="p-4 md:p-8 max-w-5xl pb-24 md:pb-8">
        <Link href="/crm/discovery" className="text-xs text-brand-muted hover:text-brand-black">← Discovery</Link>
        <PageHeader
          className="mt-2"
          title={d.business?.name ?? "—"}
          description={
            <span className="flex items-center gap-2 flex-wrap">
              <span className={clsx("badge", STATUS_META.draft.color)}>Draft</span>
              <span className="text-xs">{contact}{d.contact?.email ? ` · ${d.contact.email}` : ""}</span>
            </span>
          }
          actions={
            <>
              {(d.business_id ?? d.business?.id) && (
                <Link href={`/crm/businesses/${d.business_id ?? d.business?.id}`} className="btn-ghost text-xs px-2 py-1">Business</Link>
              )}
              <Link href={`/crm/leads/${d.lead_id}`} className="btn-ghost text-xs px-2 py-1">Open lead</Link>
              <ScopeLink leadId={d.lead_id} />
            </>
          }
        />
        <DraftEditor key={d.id} invite={d} onChanged={next => {
          if (!next) router.push("/crm/discovery");
          else if (next.status === "draft") setD(next);
          else load();
        }} />
      </div>
    );
  }

  const st = STATUS_META[d.status];
  const type = PROJECT_TYPES.find(t => t.value === d.project_type)?.label;
  const answers = (d.response?.answers ?? {}) as Record<string, unknown>;
  // The questions exactly as this prospect was asked them.
  const schema = resolveSnapshot(d);
  const sections = visibleSections(schema, d.project_type);
  const expired = d.status !== "submitted" && new Date(d.expires_at) < new Date();
  const contactName = d.contact ? `${d.contact.first_name}${d.contact.last_name ? " " + d.contact.last_name : ""}` : "—";

  const timeline: [string, string | null | undefined][] = [
    ["Sent", d.sent_at], ["Opened", d.opened_at], ["Last saved", d.last_saved_at], ["Submitted", d.submitted_at],
  ];

  return (
    <div className="p-4 md:p-8 max-w-5xl pb-24 md:pb-8">
      <Link href="/crm/discovery" className="text-xs text-brand-muted hover:text-brand-black">← Discovery</Link>

      <div className="card mt-2 mb-4">
        <PageHeader
          className="!mb-0 flex-wrap"
          title={d.business?.name ?? "—"}
          description={
            <>
              <span className="block text-brand-black">{d.project_title}</span>
              <span className="block text-xs mt-0.5">
                {type} · {d.engagement_type === "pro_bono" ? "Pro bono" : "Paid"} · {contactName}
                {d.contact?.email && <> · <span className="text-brand-orange">{d.contact.email}</span></>}
              </span>
            </>
          }
          actions={
            <>
              <span className={clsx("badge", st.color)}>{st.label}</span>
              {expired && <span className="badge badge-error">Link expired</span>}
              {(d.business_id ?? d.business?.id) && (
                <Link href={`/crm/businesses/${d.business_id ?? d.business?.id}`} className="btn-ghost text-xs px-2 py-1">Business</Link>
              )}
              <Link href={`/crm/leads/${d.lead_id}`} className="btn-ghost text-xs px-2 py-1">Open lead</Link>
              <ScopeLink leadId={d.lead_id} />
            </>
          }
        />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 pt-4 border-t border-brand-border">
          {timeline.map(([label, at]) => (
            <div key={label}>
              <p className="text-xs text-brand-muted">{label}</p>
              <p className="text-sm text-brand-black">{at ? formatDistanceToNow(new Date(at), { addSuffix: true }) : "—"}</p>
            </div>
          ))}
        </div>

        <div className="flex gap-2 flex-wrap mt-4 pt-4 border-t border-brand-border">
          {d.status !== "submitted" && d.status !== "archived" && (
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
              {!expired && ["sent", "opened", "in_progress"].includes(d.status) && (
                <ResendInviteEmail inviteId={d.id} defaultTo={d.contact?.email} defaultFirstName={d.contact?.first_name} />
              )}
            </>
          )}
          {d.status === "submitted" && (
            <Button variant="ghost" size="sm" onClick={() => { if (confirm("Reopen so they can edit and resubmit? Their answers are kept.")) patch({ reopen: true, extend_days: 14 }, "reopen"); }}
              disabled={!!busy}>Reopen for edits</Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => patch({ archived: d.status !== "archived" }, "archive")} disabled={!!busy} className="ml-auto">
            {d.status === "archived" ? "Unarchive" : "Archive"}
          </Button>
          <DeleteDiscoveryButton inviteId={d.id} status={d.status} hasResponse={!!d.response} disabled={!!busy}
            onDeleted={() => router.push("/crm/discovery")} />
        </div>
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      </div>

      <Tabs tabs={TABS} value={tab} onChange={setTab} className="mb-4" />

      {tab === "brief" && (
        <div className="card">
          {d.status !== "submitted" ? (
            <p className="text-sm text-brand-muted">The brief is generated automatically when they submit the questionnaire.</p>
          ) : !lastBrief ? (
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-brand-muted">No brief yet.</p>
              <Button size="sm" onClick={regenerate} disabled={!!busy}>Generate brief</Button>
            </div>
          ) : lastBrief.status === "pending" ? (
            <div className="flex items-center gap-3 text-sm text-brand-muted">
              <span className="inline-block w-4 h-4 border-2 border-brand-border border-t-brand-orange rounded-full animate-spin" />
              Generating the brief — usually under a minute.
            </div>
          ) : lastBrief.status === "failed" ? (
            <div className="space-y-3">
              <p className="text-sm text-red-700">Brief generation failed: {lastBrief.error ?? "unknown error"}</p>
              <Button size="sm" onClick={regenerate} disabled={!!busy}>Try again</Button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-4 mb-3 pb-3 border-b border-brand-border flex-wrap">
                <p className="text-xs text-brand-muted">
                  Generated {lastBrief.completed_at ? formatDistanceToNow(new Date(lastBrief.completed_at), { addSuffix: true }) : ""}
                  {lastBrief.model ? ` · ${lastBrief.model}` : ""}
                </p>
                <div className="flex gap-2">
                  <CopyButton text={lastBrief.content_md ?? ""} label="Copy markdown" />
                  <Button variant="ghost" size="sm" onClick={regenerate} disabled={!!busy}>{busy === "brief" ? "Regenerating…" : "Regenerate"}</Button>
                </div>
              </div>
              <div className="text-sm text-brand-black">
                <SamMarkdown content={lastBrief.content_md ?? ""} />
              </div>
            </>
          )}
        </div>
      )}

      {tab === "answers" && (
        <div className="space-y-4">
          {!d.response ? (
            <EmptyState title={d.opened_at ? "They've opened the questionnaire but haven't saved any answers yet." : "They haven't opened the questionnaire yet."} />
          ) : (
            <>
              {d.status !== "submitted" && (
                <div className="card text-xs text-amber-800 bg-amber-50 border-amber-100">
                  In progress — these are saved answers so far
                  {d.response.current_section ? ` (last on “${sections.find(s => s.id === d.response!.current_section)?.title ?? d.response.current_section}”)` : ""}.
                </div>
              )}
              {sections.map(s => (
                <div key={s.id} className="card">
                  <h2 className="text-sm font-semibold text-brand-black mb-3">{s.title}</h2>
                  <dl className="space-y-3">
                    {s.fields.filter(f => isFieldVisible(f, answers)).map(f => (
                      <div key={f.id} className="grid grid-cols-1 md:grid-cols-5 gap-1 md:gap-4 text-sm">
                        <dt className="md:col-span-2 text-brand-muted text-xs md:text-sm">{f.label}</dt>
                        <dd className="md:col-span-3 text-brand-black"><Answer field={f} answers={answers} /></dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {tab === "questions" && (
        schema ? (
          <div>
            <p className="text-xs text-brand-muted mb-3">
              Frozen when sent{schema.template ? ` · from “${schema.template.name}”` : ""}. Later template or bank edits don&apos;t change it.
            </p>
            {schema.intro && <div className="card mb-4 text-sm text-brand-black whitespace-pre-wrap">{schema.intro}</div>}
            <QuestionnaireOutline def={{ ...schema, sections }} onChange={() => {}} onAddFromBank={() => {}} readOnly />
          </div>
        ) : <EmptyState title="No questionnaire snapshot." />
      )}

      {tab === "project" && (
        <div className="card">
          <p className="text-xs text-brand-muted mb-2">Description shown to the organization at the start of the questionnaire</p>
          <p className="text-sm text-brand-black whitespace-pre-wrap">{d.project_brief || "—"}</p>
        </div>
      )}
    </div>
  );
}
