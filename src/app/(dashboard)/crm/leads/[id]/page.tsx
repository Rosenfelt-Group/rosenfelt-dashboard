"use client";
import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import { useParams, useRouter } from "next/navigation";
import { CRMLead, CRMActivity, CRMAssessmentResult, CRMStage, CRMServiceTier } from "@/types";
import { formatDistanceToNow, format } from "date-fns";
import clsx from "clsx";
import Link from "next/link";
import { AgentBadge } from "@/components/AgentBadge";
import { STAGES } from "@/lib/crm/stages";
import { Agent } from "@/types";
import { safeHref } from "@/lib/safe-url";
import { DiscoveryInvite } from "@/types";
import { Button, ErrorState, LoadingState } from "@/components/ui";
import { AssessmentCard, BusinessCard, ContactCard, DetailsCard, DiscoveryCard } from "./_components/SidebarCards";
import {
  ConvertToClientModal,
  EditLeadModal,
  LogEmailModal,
  LogNoteModal,
  type ConvertForm,
  type EditLeadForm,
  type EmailForm,
} from "./_components/LeadModals";

const ACTIVITY_ICONS: Record<string, string> = {
  note: "📝",
  email_sent: "📤",
  email_received: "📥",
  stage_change: "🔀",
  assessment: "📊",
  system: "⚙️",
};

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [lead, setLead] = useState<CRMLead | null>(null);
  const [activities, setActivities] = useState<CRMActivity[]>([]);
  const [assessment, setAssessment] = useState<CRMAssessmentResult | null>(null);
  const [discovery, setDiscovery] = useState<DiscoveryInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Edit form state
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState<EditLeadForm>({
    estimated_value: "", close_date: "", lost_reason: "", assigned_agent: "" as Agent | "", quiz_url: "",
  });

  function openEditForm(l: CRMLead) {
    setEditForm({
      estimated_value: l.estimated_value?.toString() ?? "",
      close_date: l.close_date ?? "",
      lost_reason: l.lost_reason ?? "",
      assigned_agent: (l.assigned_agent ?? "") as Agent | "",
      quiz_url: l.quiz_url ?? "",
    });
    setShowEdit(true);
  }

  async function saveEditForm() {
    if (!lead) return;
    setSaving(true);
    const res = await fetch(`/api/crm/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        estimated_value: editForm.estimated_value ? parseFloat(editForm.estimated_value) : null,
        close_date: editForm.close_date || null,
        lost_reason: editForm.lost_reason || null,
        assigned_agent: editForm.assigned_agent || null,
        quiz_url: editForm.quiz_url.trim() || null,
      }),
    });
    const updated = await res.json();
    setLead(updated);
    setShowEdit(false);
    setSaving(false);
  }

  // Modal state
  const [showNote, setShowNote] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [showEmail, setShowEmail] = useState(false);
  const [emailForm, setEmailForm] = useState<EmailForm>({ subject: "", direction: "sent", snippet: "" });
  const [showConvert, setShowConvert] = useState(false);
  const [convertForm, setConvertForm] = useState<ConvertForm>({ service_tier: "newsroom" as CRMServiceTier, contract_start: "", monthly_value: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetchJson<CRMLead>(`/api/crm/leads/${id}`),
      fetchJson<unknown>(`/api/crm/leads/${id}/activities`),
      fetchJson<CRMAssessmentResult>(`/api/crm/assessment/${id}`),
      fetchJson<unknown>(`/api/crm/discovery?lead_id=${id}`),
    ]).then(([l, a, s, disc]) => {
      // A missing lead is a 404 ("Lead not found" below); anything else is a load error.
      if (!l.ok && l.status !== 404) setLoadError(l.error);
      setLead(l.ok && l.data?.id ? l.data : null);
      setActivities(a.ok && Array.isArray(a.data) ? a.data : []);
      setAssessment(s.ok && s.data?.id ? s.data : null);
      setDiscovery(disc.ok && Array.isArray(disc.data) ? disc.data : []);
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
    return <div className="p-8"><LoadingState /></div>;
  }
  if (loadError) {
    return (
      <div className="p-8">
        <ErrorState message={`Couldn't load this lead: ${loadError}`} />
        <Link href="/crm" className="text-brand-orange text-sm mt-2 block">← Back to pipeline</Link>
      </div>
    );
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
  const quizUrl = safeHref(lead.quiz_url);
  const contactLinkedinUrl = safeHref(lead.contact?.linkedin_url);

  return (
    <div className="p-4 md:p-8 max-w-4xl pb-24 md:pb-8">

      {/* Header */}
      <div className="card mb-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold text-brand-black">
              {lead.business_id && lead.business ? (
                <Link href={`/crm/businesses/${lead.business_id}`} className="hover:text-brand-orange hover:underline">
                  {lead.business.name}
                </Link>
              ) : (lead.business?.name ?? "—")}
            </h1>
            <p className="text-sm text-brand-muted mt-0.5">{contactName}</p>
            {lead.contact?.email && (
              <p className="text-sm text-brand-orange mt-0.5">{lead.contact.email}</p>
            )}
            {lead.contact_id && (
              <Link href={`/crm/people/${lead.contact_id}`} className="text-sm text-brand-orange hover:underline mt-0.5 block">
                Full history with this person →
              </Link>
            )}
            {quizUrl && (
              <a href={quizUrl} target="_blank" rel="noopener noreferrer"
                className="text-sm text-brand-orange hover:underline mt-0.5 block">
                View quiz result ↗
              </a>
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
            <Button variant="ghost" size="sm" onClick={() => openEditForm(lead)}>
              Edit
            </Button>
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
            <Button variant="ghost" size="sm" onClick={() => setShowNote(true)}>
              📝 Log note
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowEmail(true)}>
              📧 Log email
            </Button>
            {lead.stage === "won" && !lead.converted_at && (
              <Button size="sm" onClick={() => setShowConvert(true)}>
                🎉 Convert to client
              </Button>
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
          {lead.business && <BusinessCard business={lead.business} />}
          {lead.contact && (
            <ContactCard contact={lead.contact} contactName={contactName} linkedinUrl={contactLinkedinUrl} />
          )}
          <DiscoveryCard leadId={id} discovery={discovery} />
          {assessment && <AssessmentCard assessment={assessment} />}
          <DetailsCard lead={lead} />
        </div>
      </div>

      <LogNoteModal
        open={showNote}
        onClose={() => setShowNote(false)}
        saving={saving}
        onSubmit={logNote}
        noteText={noteText}
        setNoteText={setNoteText}
      />
      <LogEmailModal
        open={showEmail}
        onClose={() => setShowEmail(false)}
        saving={saving}
        onSubmit={logEmail}
        form={emailForm}
        setForm={setEmailForm}
      />
      <ConvertToClientModal
        open={showConvert}
        onClose={() => setShowConvert(false)}
        saving={saving}
        onSubmit={convertToClient}
        form={convertForm}
        setForm={setConvertForm}
      />
      <EditLeadModal
        open={showEdit}
        onClose={() => setShowEdit(false)}
        saving={saving}
        onSubmit={saveEditForm}
        form={editForm}
        setForm={setEditForm}
        isLost={lead.stage === "lost"}
      />
    </div>
  );
}
