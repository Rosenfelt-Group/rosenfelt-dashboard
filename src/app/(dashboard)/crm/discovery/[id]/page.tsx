"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import { format, formatDistanceToNow } from "date-fns";
import { CRMNav } from "@/components/CRMNav";
import { CopyButton } from "@/components/crm/CopyButton";
import { inviteEmail } from "@/components/crm/NewDiscoveryModal";
import { SamMarkdown } from "@/components/SamMarkdown";
import { DiscoveryInvite, DiscoveryFieldDef } from "@/types";
import { PROJECT_TYPES, STATUS_META, isEmptyAnswer, isFieldVisible } from "@/lib/discovery";

type Detail = DiscoveryInvite & { link: string };
type Tab = "brief" | "answers" | "project";

function Answer({ field, answers }: { field: DiscoveryFieldDef; answers: Record<string, unknown> }) {
  const v = answers[field.id];
  const other = answers[`${field.id}__other`] as string | undefined;
  if (isEmptyAnswer(v)) return <span className="text-brand-muted">—</span>;

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
  const [d, setD] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("brief");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    return fetch(`/api/crm/discovery/${id}`).then(r => r.json()).then(data => {
      setD(data?.id ? data : null);
      setLoading(false);
      return data as Detail;
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

  if (loading) return <div className="p-8"><div className="card animate-pulse h-64" /></div>;
  if (!d) {
    return (
      <div className="p-8">
        <p className="text-brand-muted">Not found.</p>
        <Link href="/crm/discovery" className="text-brand-orange text-sm mt-2 block">← Back to discovery</Link>
      </div>
    );
  }

  const st = STATUS_META[d.status];
  const type = PROJECT_TYPES.find(t => t.value === d.project_type)?.label;
  const answers = (d.response?.answers ?? {}) as Record<string, unknown>;
  const schema = d.response?.schema_snapshot;
  const sections = schema?.sections.filter(s => !s.modules || s.modules.includes(d.project_type)) ?? [];
  const expired = d.status !== "submitted" && new Date(d.expires_at) < new Date();
  const contactName = d.contact ? `${d.contact.first_name}${d.contact.last_name ? " " + d.contact.last_name : ""}` : "—";

  const timeline: [string, string | undefined][] = [
    ["Sent", d.sent_at], ["Opened", d.opened_at], ["Last saved", d.last_saved_at], ["Submitted", d.submitted_at],
  ];

  return (
    <div className="p-4 md:p-8 max-w-5xl pb-24 md:pb-8">
      <CRMNav />
      <Link href="/crm/discovery" className="text-xs text-brand-muted hover:text-brand-black">← Discovery</Link>

      <div className="card mt-2 mb-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-brand-black">{d.business?.name ?? "—"}</h1>
            <p className="text-sm text-brand-black mt-0.5">{d.project_title}</p>
            <p className="text-xs text-brand-muted mt-0.5">
              {type} · {d.engagement_type === "pro_bono" ? "Pro bono" : "Paid"} · {contactName}
              {d.contact?.email && <> · <span className="text-brand-orange">{d.contact.email}</span></>}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={clsx("badge", st.color)}>{st.label}</span>
            {expired && <span className="badge badge-error">Link expired</span>}
            <Link href={`/crm/leads/${d.lead_id}`} className="btn-ghost text-xs px-2 py-1">Open lead</Link>
          </div>
        </div>

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
              <CopyButton label="Copy invite email" text={inviteEmail({ firstName: d.contact?.first_name, orgName: d.business?.name, projectTitle: d.project_title, link: d.link })} />
              <a href={d.link} target="_blank" rel="noopener noreferrer" className="btn-ghost text-xs px-3 py-1.5">Preview ↗</a>
              <button onClick={() => patch({ extend_days: 30 }, "extend")} disabled={!!busy} className="btn-ghost text-xs px-3 py-1.5">
                {busy === "extend" ? "…" : `Extend 30 days (expires ${format(new Date(d.expires_at), "MMM d")})`}
              </button>
            </>
          )}
          {d.status === "submitted" && (
            <button onClick={() => { if (confirm("Reopen so they can edit and resubmit? Their answers are kept.")) patch({ reopen: true, extend_days: 14 }, "reopen"); }}
              disabled={!!busy} className="btn-ghost text-xs px-3 py-1.5">Reopen for edits</button>
          )}
          <button onClick={() => patch({ archived: d.status !== "archived" }, "archive")} disabled={!!busy} className="btn-ghost text-xs px-3 py-1.5 ml-auto">
            {d.status === "archived" ? "Unarchive" : "Archive"}
          </button>
        </div>
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      </div>

      <div className="flex items-center gap-0 border-b border-brand-border mb-4">
        {(["brief", "answers", "project"] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={clsx("px-4 py-2 text-sm font-medium border-b-2 -mb-px capitalize",
              tab === t ? "border-brand-orange text-brand-orange" : "border-transparent text-brand-muted hover:text-brand-black")}>
            {t === "brief" ? "Pre-call brief" : t}
          </button>
        ))}
      </div>

      {tab === "brief" && (
        <div className="card">
          {d.status !== "submitted" ? (
            <p className="text-sm text-brand-muted">The brief is generated automatically when they submit the questionnaire.</p>
          ) : !lastBrief ? (
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-brand-muted">No brief yet.</p>
              <button onClick={regenerate} disabled={!!busy} className="btn-primary text-xs">Generate brief</button>
            </div>
          ) : lastBrief.status === "pending" ? (
            <div className="flex items-center gap-3 text-sm text-brand-muted">
              <span className="inline-block w-4 h-4 border-2 border-brand-border border-t-brand-orange rounded-full animate-spin" />
              Generating the brief — usually under a minute.
            </div>
          ) : lastBrief.status === "failed" ? (
            <div className="space-y-3">
              <p className="text-sm text-red-700">Brief generation failed: {lastBrief.error ?? "unknown error"}</p>
              <button onClick={regenerate} disabled={!!busy} className="btn-primary text-xs">Try again</button>
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
                  <button onClick={regenerate} disabled={!!busy} className="btn-ghost text-xs px-3 py-1.5">{busy === "brief" ? "Regenerating…" : "Regenerate"}</button>
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
            <div className="card text-sm text-brand-muted">
              {d.opened_at ? "They've opened the questionnaire but haven't saved any answers yet." : "They haven't opened the questionnaire yet."}
            </div>
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

      {tab === "project" && (
        <div className="card">
          <p className="text-xs text-brand-muted mb-2">Description shown to the organization at the start of the questionnaire</p>
          <p className="text-sm text-brand-black whitespace-pre-wrap">{d.project_brief || "—"}</p>
        </div>
      )}
    </div>
  );
}
