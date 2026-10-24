"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";
import { CRMActivity, CRMAssessmentResult, CRMServiceTier, CRMStage } from "@/types";
import { STAGES } from "@/lib/crm/stages";
import { fetchJson } from "@/lib/fetch-json";
import { dueLabel, dueState, daysInStage, localDate, type EngagementProgress, type PipelineLead } from "@/lib/crm/pipeline";
import { Button } from "@/components/ui";
import { ConvertToClientModal, type ConvertForm } from "@/app/(dashboard)/crm/leads/[id]/_components/LeadModals";
import { EngagementBar } from "./EngagementBar";

const INPUT = "w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange";
const ACTIVITY_ICONS: Record<string, string> = {
  note: "📝", email_sent: "📤", email_received: "📥", stage_change: "🔀", assessment: "📊", system: "⚙️", intake: "📥",
};

type Props = {
  lead: PipelineLead;
  progress?: EngagementProgress;
  onClose: () => void;
  onUpdated: (lead: PipelineLead) => void;
  /**
   * Wave 2 slot: the Merge… and Delete… buttons for this deal render here, in the drawer footer.
   * Leave undefined until the merge and delete UI ships.
   */
  mergeDeleteActions?: React.ReactNode;
};

const toForm = (l: PipelineLead) => ({
  value: l.estimated_value?.toString() ?? "",
  next_step: l.next_step ?? "",
  next_step_due: l.next_step_due ?? "",
});

/** Side drawer for one deal on the pipeline: quick edits, progress, snapshot, recent activity and actions. */
export function DealDrawer({ lead, progress, onClose, onUpdated, mergeDeleteActions }: Props) {
  const [form, setForm] = useState(() => toForm(lead));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activities, setActivities] = useState<CRMActivity[] | null>(null);
  const [assessment, setAssessment] = useState<CRMAssessmentResult | null>(null);
  const [losing, setLosing] = useState(false);
  const [lostReason, setLostReason] = useState(lead.lost_reason ?? "");
  const [showConvert, setShowConvert] = useState(false);
  const [convertForm, setConvertForm] = useState<ConvertForm>({ service_tier: "newsroom" as CRMServiceTier, contract_start: "", monthly_value: "" });

  // Reset when another card is opened.
  useEffect(() => {
    setForm(toForm(lead));
    setLosing(false);
    setLostReason(lead.lost_reason ?? "");
    setError(null);
  }, [lead.id]);

  useEffect(() => {
    let live = true;
    setActivities(null);
    setAssessment(null);
    Promise.all([
      fetchJson<CRMActivity[]>(`/api/crm/leads/${lead.id}/activities`),
      fetchJson<CRMAssessmentResult | null>(`/api/crm/assessment/${lead.id}`),
    ]).then(([a, s]) => {
      if (!live) return;
      setActivities(a.ok && Array.isArray(a.data) ? a.data.slice(0, 6) : []);
      setAssessment(s.ok && s.data?.id ? s.data : null);
    });
    return () => { live = false; };
  }, [lead.id, lead.stage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !showConvert) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, showConvert]);

  async function patch(body: Record<string, unknown>): Promise<PipelineLead | null> {
    setSaving(true);
    setError(null);
    const r = await fetchJson<PipelineLead>(`/api/crm/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!r.ok) { setError(r.error); return null; }
    onUpdated(r.data);
    return r.data;
  }

  async function changeStage(stage: CRMStage) {
    if (stage === lead.stage) return;
    if (stage === "lost") { setLosing(true); return; }
    await patch({ stage });
  }

  async function saveDetails() {
    const value = form.value.trim() ? parseFloat(form.value) : null;
    if (value !== null && !Number.isFinite(value)) { setError("Value must be a number"); return; }
    await patch({ estimated_value: value, next_step: form.next_step, next_step_due: form.next_step_due || null });
  }

  async function markWon() {
    if (lead.stage !== "won" && !(await patch({ stage: "won" }))) return;
    setShowConvert(true);
  }

  async function convert() {
    setSaving(true);
    const r = await fetchJson(`/api/crm/leads/${lead.id}/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_tier: convertForm.service_tier,
        contract_start: convertForm.contract_start || undefined,
        monthly_value: convertForm.monthly_value ? parseFloat(convertForm.monthly_value) : undefined,
      }),
    });
    setSaving(false);
    if (!r.ok) { setError(`Convert failed: ${r.error}`); return; }
    setShowConvert(false);
    const fresh = await fetchJson<PipelineLead>(`/api/crm/leads/${lead.id}`);
    if (fresh.ok) onUpdated(fresh.data);
  }

  async function markLost() {
    if (await patch({ stage: "lost", lost_reason: lostReason.trim() || null })) setLosing(false);
  }

  const today = localDate();
  const late = dueState(lead.next_step_due, today) === "late";
  const contactName = lead.contact
    ? `${lead.contact.first_name}${lead.contact.last_name ? " " + lead.contact.last_name : ""}`
    : null;
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(lead));

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-30" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-label={lead.business?.name ?? "Deal"}
        className="fixed inset-y-0 right-0 w-full max-w-md bg-white border-l border-brand-border shadow-xl z-40 flex flex-col"
      >
        <div className="flex items-start justify-between p-5 border-b border-brand-border">
          <div className="min-w-0">
            <p className="text-xs text-brand-muted truncate">{contactName ?? lead.contact?.email ?? "No contact"}</p>
            <h2 className="text-base font-semibold text-brand-black truncate">{lead.business?.name ?? "Deal"}</h2>
            <p className="text-xs text-brand-muted mt-0.5">{daysInStage(lead)}d in stage</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-brand-muted hover:text-brand-black ml-3 text-lg shrink-0">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="deal-stage" className="text-xs text-brand-muted mb-1 block">Stage</label>
              <select
                id="deal-stage"
                className={INPUT}
                value={losing ? "lost" : lead.stage}
                disabled={saving}
                onChange={e => changeStage(e.target.value as CRMStage)}
              >
                {STAGES.map(s => <option key={s.stage} value={s.stage}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="deal-value" className="text-xs text-brand-muted mb-1 block">Value ($)</label>
              <input
                id="deal-value"
                type="number"
                min="0"
                className={INPUT}
                value={form.value}
                onChange={e => setForm(p => ({ ...p, value: e.target.value }))}
                placeholder="Pro bono"
              />
            </div>
          </div>

          {losing && (
            <div className="rounded-lg border border-brand-border p-3 space-y-2">
              <label htmlFor="deal-lost" className="text-xs text-brand-muted block">Why was this deal lost?</label>
              <textarea
                id="deal-lost"
                className={`${INPUT} h-20 resize-none`}
                value={lostReason}
                onChange={e => setLostReason(e.target.value)}
                placeholder="No budget this year, went with another vendor…"
              />
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setLosing(false)}>Cancel</Button>
                <Button variant="danger" size="sm" onClick={markLost} disabled={saving}>Mark lost</Button>
              </div>
            </div>
          )}

          <div className="rounded-lg bg-brand-offwhite p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-brand-muted uppercase tracking-wide">Next step</span>
              {lead.next_step_due && (
                <span className={clsx("text-xs", late ? "text-amber-600 font-medium" : "text-brand-muted")}>
                  {late && "⚠ "}{dueLabel(lead.next_step_due, today)}
                </span>
              )}
            </div>
            <input
              aria-label="Next step"
              className={INPUT}
              value={form.next_step}
              maxLength={500}
              onChange={e => setForm(p => ({ ...p, next_step: e.target.value }))}
              placeholder="Send the intro email"
            />
            <div className="flex gap-2 items-center">
              <input
                aria-label="Next step due date"
                type="date"
                className={INPUT}
                value={form.next_step_due}
                onChange={e => setForm(p => ({ ...p, next_step_due: e.target.value }))}
              />
              {lead.next_step && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={saving}
                  onClick={async () => { if (await patch({ next_step: null, next_step_due: null })) setForm(p => ({ ...p, next_step: "", next_step_due: "" })); }}
                >
                  Done
                </Button>
              )}
            </div>
          </div>

          <div className="flex justify-end">
            <Button size="sm" onClick={saveDetails} disabled={saving || !dirty}>{saving ? "Saving…" : "Save"}</Button>
          </div>

          <div>
            <p className="text-xs font-medium text-brand-muted uppercase tracking-wide mb-2">Engagement</p>
            <EngagementBar progress={progress} labels />
          </div>

          {assessment && (
            <div className="card p-3">
              <p className="text-xs font-medium text-brand-muted uppercase tracking-wide mb-1">Assessment snapshot</p>
              <p className="text-sm text-brand-black">
                <span className="font-semibold">{assessment.score}</span>
                <span className="text-brand-muted"> / 25 · {assessment.tier.replace(/_/g, " ")}</span>
              </p>
              {assessment.section_breakdown && (
                <p className="text-xs text-brand-muted mt-1">
                  {Object.entries(assessment.section_breakdown).map(([k, v]) => `${k} ${v}/5`).join(" · ")}
                </p>
              )}
            </div>
          )}

          <div>
            <p className="text-xs font-medium text-brand-muted uppercase tracking-wide mb-2">Recent activity</p>
            {activities === null ? (
              <p className="text-xs text-brand-muted">Loading…</p>
            ) : activities.length === 0 ? (
              <p className="text-xs text-brand-muted">No activity yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {activities.map(a => (
                  <li key={a.id} className="flex gap-2 text-xs">
                    <span className="shrink-0">{ACTIVITY_ICONS[a.activity_type] ?? "•"}</span>
                    <div className="min-w-0">
                      <p className="text-brand-black break-words line-clamp-2">{a.email_subject ?? a.content ?? a.activity_type.replace(/_/g, " ")}</p>
                      <p className="text-brand-muted">
                        {a.logged_by && <span className="capitalize">{a.logged_by} · </span>}
                        {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="p-4 border-t border-brand-border flex flex-wrap gap-2">
          {lead.business_id && (
            <Link href={`/crm/organizations/${lead.business_id}`} className="inline-flex items-center rounded-lg font-medium px-3 py-1.5 text-xs bg-brand-orange text-white hover:bg-brand-orange-dark">
              Open organization
            </Link>
          )}
          {!lead.converted_at && (
            <Button variant="secondary" size="sm" onClick={markWon} disabled={saving}>
              {lead.stage === "won" ? "Convert to client" : "Mark won & convert"}
            </Button>
          )}
          {lead.converted_at && <span className="badge badge-success text-xs self-center">Converted to client</span>}
          {lead.stage !== "lost" && !lead.converted_at && (
            <Button variant="ghost" size="sm" onClick={() => setLosing(true)} disabled={saving}>Mark lost</Button>
          )}
          <Link href={`/crm/leads/${lead.id}`} className="inline-flex items-center rounded-lg font-medium px-3 py-1.5 text-xs text-brand-muted hover:bg-brand-border">
            Open full lead page
          </Link>
          {/* Wave 2: Merge… and Delete… go here (pass them as mergeDeleteActions). */}
          <div data-slot="deal-drawer-merge-delete" className="contents">{mergeDeleteActions}</div>
        </div>
      </aside>

      <ConvertToClientModal
        open={showConvert}
        onClose={() => setShowConvert(false)}
        saving={saving}
        onSubmit={convert}
        form={convertForm}
        setForm={setConvertForm}
      />
    </>
  );
}
