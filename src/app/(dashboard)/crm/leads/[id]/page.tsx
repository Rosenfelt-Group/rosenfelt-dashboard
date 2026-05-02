"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CRMLead, CRMActivity, CRMAssessmentResult, CRMStage, CRMServiceTier } from "@/types";
import { formatDistanceToNow, format } from "date-fns";
import clsx from "clsx";
import Link from "next/link";
import { AgentBadge } from "@/components/AgentBadge";

const STAGES: { stage: CRMStage; label: string; color: string }[] = [
  { stage: "new",           label: "New",           color: "bg-blue-50 text-blue-700" },
  { stage: "qualification", label: "Qualification",  color: "bg-amber-50 text-amber-700" },
  { stage: "engaged",       label: "Engaged",        color: "bg-purple-50 text-purple-700" },
  { stage: "proposal",      label: "Proposal",       color: "bg-orange-50 text-brand-orange" },
  { stage: "won",           label: "Won",            color: "bg-green-50 text-green-700" },
  { stage: "lost",          label: "Lost",           color: "bg-gray-100 text-gray-500" },
];

const ACTIVITY_ICONS: Record<string, string> = {
  note: "📝",
  email_sent: "📤",
  email_received: "📥",
  stage_change: "🔀",
  assessment: "📊",
  system: "⚙️",
};

const SERVICE_TIERS: { value: CRMServiceTier; label: string }[] = [
  { value: "newsroom",     label: "Newsroom" },
  { value: "operations",  label: "Operations" },
  { value: "finance_ops", label: "Finance Ops" },
  { value: "growth_stack", label: "Growth Stack" },
  { value: "full_stack",  label: "Full Stack" },
];

const TIER_LABELS: Record<string, string> = {
  foundation_first: "Foundation First",
  getting_there: "Getting There",
  ready_light_prep: "Ready with Light Prep",
  ready_to_move: "Ready to Move",
};

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [lead, setLead] = useState<CRMLead | null>(null);
  const [activities, setActivities] = useState<CRMActivity[]>([]);
  const [assessment, setAssessment] = useState<CRMAssessmentResult | null>(null);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [showNote, setShowNote] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [showEmail, setShowEmail] = useState(false);
  const [emailForm, setEmailForm] = useState({ subject: "", direction: "sent", snippet: "" });
  const [showConvert, setShowConvert] = useState(false);
  const [convertForm, setConvertForm] = useState({ service_tier: "newsroom" as CRMServiceTier, contract_start: "", monthly_value: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/crm/leads/${id}`).then(r => r.json()),
      fetch(`/api/crm/leads/${id}/activities`).then(r => r.json()),
      fetch(`/api/crm/assessment/${id}`).then(r => r.json()),
    ]).then(([l, a, s]) => {
      setLead(l?.id ? l : null);
      setActivities(Array.isArray(a) ? a : []);
      setAssessment(s?.id ? s : null);
      setLoading(false);
    });
  }, [id]);

  async function updateStage(stage: CRMStage) {
    const res = await fetch(`/api/crm/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage }),
    });
    const updated = await res.json();
    setLead(updated);
    const newActs = await fetch(`/api/crm/leads/${id}/activities`).then(r => r.json());
    setActivities(Array.isArray(newActs) ? newActs : []);
  }

  async function logNote() {
    if (!noteText.trim()) return;
    setSaving(true);
    const res = await fetch(`/api/crm/leads/${id}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activity_type: "note", content: noteText.trim(), logged_by: "brian" }),
    });
    const act = await res.json();
    setActivities(prev => [act, ...prev]);
    setNoteText("");
    setShowNote(false);
    setSaving(false);
  }

  async function logEmail() {
    if (!emailForm.subject.trim()) return;
    setSaving(true);
    const type = emailForm.direction === "sent" ? "email_sent" : "email_received";
    const res = await fetch(`/api/crm/leads/${id}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        activity_type: type,
        email_subject: emailForm.subject.trim(),
        email_direction: emailForm.direction,
        content: emailForm.snippet.trim() || undefined,
        logged_by: "brian",
      }),
    });
    const act = await res.json();
    setActivities(prev => [act, ...prev]);
    setEmailForm({ subject: "", direction: "sent", snippet: "" });
    setShowEmail(false);
    setSaving(false);
  }

  async function convertToClient() {
    setSaving(true);
    await fetch(`/api/crm/leads/${id}/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_tier: convertForm.service_tier,
        contract_start: convertForm.contract_start || undefined,
        monthly_value: convertForm.monthly_value ? parseFloat(convertForm.monthly_value) : undefined,
      }),
    });
    setShowConvert(false);
    setSaving(false);
    router.push("/crm/clients");
  }

  if (loading) {
    return <div className="p-8"><div className="card animate-pulse h-64" /></div>;
  }
  if (!lead) {
    return (
      <div className="p-8">
        <p className="text-brand-muted">Lead not found.</p>
        <Link href="/crm" className="text-brand-orange text-sm mt-2 block">← Back to pipeline</Link>
      </div>
    );
  }

  const stageMeta = STAGES.find(s => s.stage === lead.stage);
  const contactName = lead.contact
    ? `${lead.contact.first_name}${lead.contact.last_name ? " " + lead.contact.last_name : ""}`
    : "—";

  return (
    <div className="p-4 md:p-8 max-w-4xl pb-24 md:pb-8">
      {/* Back */}
      <Link href="/crm" className="text-xs text-brand-muted hover:text-brand-black mb-4 block">
        ← Pipeline
      </Link>

      {/* Header */}
      <div className="card mb-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold text-brand-black">{lead.business?.name ?? "—"}</h1>
            <p className="text-sm text-brand-muted mt-0.5">{contactName}</p>
            {lead.contact?.email && (
              <p className="text-sm text-brand-orange mt-0.5">{lead.contact.email}</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {stageMeta && (
              <span className={clsx("badge", stageMeta.color)}>{stageMeta.label}</span>
            )}
            {lead.source && (
              <span className="badge badge-neutral capitalize">{lead.source.replace("_", " ")}</span>
            )}
            {lead.assigned_agent && (
              <AgentBadge agent={lead.assigned_agent} size="sm" />
            )}
          </div>
        </div>
        {(lead.estimated_value || lead.close_date) && (
          <div className="flex gap-4 mt-3 pt-3 border-t border-brand-border text-sm text-brand-muted">
            {lead.estimated_value && (
              <span>Est. value: <span className="text-brand-black font-medium">${lead.estimated_value.toLocaleString()}/mo</span></span>
            )}
            {lead.close_date && (
              <span>Target close: <span className="text-brand-black font-medium">{lead.close_date}</span></span>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: activity feed */}
        <div className="lg:col-span-2 space-y-4">
          {/* Actions */}
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setShowNote(true)} className="btn-ghost text-xs px-3 py-1.5">
              📝 Log note
            </button>
            <button onClick={() => setShowEmail(true)} className="btn-ghost text-xs px-3 py-1.5">
              📧 Log email
            </button>
            {lead.stage === "won" && !lead.converted_at && (
              <button onClick={() => setShowConvert(true)} className="btn-primary text-xs px-3 py-1.5">
                🎉 Convert to client
              </button>
            )}
            {lead.converted_at && (
              <span className="badge badge-success text-xs">Converted {format(new Date(lead.converted_at), "MMM d, yyyy")}</span>
            )}
          </div>

          {/* Stage mover */}
          <div className="card">
            <p className="text-xs text-brand-muted mb-2">Move to stage</p>
            <div className="flex flex-wrap gap-2">
              {STAGES.filter(s => s.stage !== lead.stage).map(s => (
                <button
                  key={s.stage}
                  onClick={() => updateStage(s.stage)}
                  className={clsx("badge cursor-pointer hover:opacity-75", s.color)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Activity feed */}
          <div className="card">
            <h2 className="text-sm font-medium text-brand-black mb-4">Activity</h2>
            {activities.length === 0 ? (
              <p className="text-xs text-brand-muted">No activity yet.</p>
            ) : (
              <div className="space-y-3">
                {activities.map(act => (
                  <div key={act.id} className="flex gap-3 text-sm">
                    <span className="text-base mt-0.5 shrink-0">{ACTIVITY_ICONS[act.activity_type] ?? "•"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {act.email_subject && (
                          <span className="font-medium text-brand-black truncate">{act.email_subject}</span>
                        )}
                        {act.email_direction && (
                          <span className={clsx("badge text-xs", act.email_direction === "sent" ? "badge-neutral" : "badge-warning")}>
                            {act.email_direction}
                          </span>
                        )}
                      </div>
                      {act.content && (
                        <p className="text-brand-muted text-xs mt-0.5 break-words">{act.content}</p>
                      )}
                      <p className="text-xs text-brand-muted mt-1">
                        {act.logged_by && <span className="capitalize">{act.logged_by} · </span>}
                        {formatDistanceToNow(new Date(act.created_at), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: sidebar */}
        <div className="space-y-4">
          {/* Business info */}
          {lead.business && (
            <div className="card">
              <h3 className="text-xs font-medium text-brand-muted uppercase tracking-wide mb-3">Business</h3>
              <Link href={`/crm/businesses`} className="text-sm font-medium text-brand-orange hover:underline">
                {lead.business.name}
              </Link>
              {lead.business.industry && (
                <p className="text-xs text-brand-muted mt-1">{lead.business.industry}</p>
              )}
              {lead.business.size && (
                <p className="text-xs text-brand-muted">{lead.business.size} employees</p>
              )}
              {lead.business.website && (
                <a href={lead.business.website} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-brand-orange hover:underline block mt-1">
                  {lead.business.website}
                </a>
              )}
            </div>
          )}

          {/* Contact info */}
          {lead.contact && (
            <div className="card">
              <h3 className="text-xs font-medium text-brand-muted uppercase tracking-wide mb-3">Contact</h3>
              <p className="text-sm font-medium text-brand-black">{contactName}</p>
              {lead.contact.title && <p className="text-xs text-brand-muted">{lead.contact.title}</p>}
              {lead.contact.email && (
                <p className="text-xs text-brand-orange mt-1">{lead.contact.email}</p>
              )}
              {lead.contact.phone && (
                <p className="text-xs text-brand-muted">{lead.contact.phone}</p>
              )}
            </div>
          )}

          {/* Assessment results */}
          {assessment && (
            <div className="card">
              <h3 className="text-xs font-medium text-brand-muted uppercase tracking-wide mb-3">Assessment</h3>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl font-bold text-brand-black">{assessment.score}</span>
                <span className="text-xs text-brand-muted">/ 25</span>
              </div>
              <span className="badge badge-orange text-xs">{TIER_LABELS[assessment.tier] ?? assessment.tier}</span>
              {assessment.section_breakdown && (
                <div className="mt-3 space-y-1">
                  {Object.entries(assessment.section_breakdown).map(([section, score]) => (
                    <div key={section} className="flex justify-between text-xs text-brand-muted">
                      <span className="capitalize">{section}</span>
                      <span className="font-medium text-brand-black">{score}/5</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Lead metadata */}
          <div className="card">
            <h3 className="text-xs font-medium text-brand-muted uppercase tracking-wide mb-3">Details</h3>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-brand-muted">Created</span>
                <span className="text-brand-black">{format(new Date(lead.created_at), "MMM d, yyyy")}</span>
              </div>
              {lead.lost_reason && (
                <div>
                  <span className="text-brand-muted block">Lost reason</span>
                  <span className="text-brand-black">{lead.lost_reason}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Log note modal */}
      {showNote && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-end md:items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-brand-black">Log note</h2>
              <button onClick={() => setShowNote(false)} className="text-brand-muted hover:text-brand-black text-lg">✕</button>
            </div>
            <textarea
              className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange h-28 resize-none"
              placeholder="Add a note…"
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
            />
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowNote(false)} className="btn-ghost flex-1">Cancel</button>
              <button onClick={logNote} disabled={saving || !noteText.trim()} className="btn-primary flex-1 disabled:opacity-50">
                {saving ? "Saving…" : "Save note"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Log email modal */}
      {showEmail && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-end md:items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-brand-black">Log email</h2>
              <button onClick={() => setShowEmail(false)} className="text-brand-muted hover:text-brand-black text-lg">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-brand-muted mb-1 block">Subject *</label>
                <input
                  className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                  value={emailForm.subject}
                  onChange={e => setEmailForm(p => ({ ...p, subject: e.target.value }))}
                  placeholder="Following up on our call…"
                />
              </div>
              <div>
                <label className="text-xs text-brand-muted mb-1 block">Direction</label>
                <select
                  className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                  value={emailForm.direction}
                  onChange={e => setEmailForm(p => ({ ...p, direction: e.target.value }))}
                >
                  <option value="sent">Sent</option>
                  <option value="received">Received</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-brand-muted mb-1 block">Snippet (optional)</label>
                <textarea
                  className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange h-20 resize-none"
                  value={emailForm.snippet}
                  onChange={e => setEmailForm(p => ({ ...p, snippet: e.target.value }))}
                  placeholder="Brief summary or key quote…"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowEmail(false)} className="btn-ghost flex-1">Cancel</button>
              <button onClick={logEmail} disabled={saving || !emailForm.subject.trim()} className="btn-primary flex-1 disabled:opacity-50">
                {saving ? "Saving…" : "Log email"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Convert to client modal */}
      {showConvert && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-end md:items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-brand-black">Convert to client</h2>
              <button onClick={() => setShowConvert(false)} className="text-brand-muted hover:text-brand-black text-lg">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-brand-muted mb-1 block">Service tier</label>
                <select
                  className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                  value={convertForm.service_tier}
                  onChange={e => setConvertForm(p => ({ ...p, service_tier: e.target.value as CRMServiceTier }))}
                >
                  {SERVICE_TIERS.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-brand-muted mb-1 block">Contract start</label>
                <input
                  type="date"
                  className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                  value={convertForm.contract_start}
                  onChange={e => setConvertForm(p => ({ ...p, contract_start: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-brand-muted mb-1 block">Monthly value ($)</label>
                <input
                  type="number"
                  className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                  value={convertForm.monthly_value}
                  onChange={e => setConvertForm(p => ({ ...p, monthly_value: e.target.value }))}
                  placeholder="2500"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowConvert(false)} className="btn-ghost flex-1">Cancel</button>
              <button onClick={convertToClient} disabled={saving} className="btn-primary flex-1 disabled:opacity-50">
                {saving ? "Converting…" : "Convert"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
