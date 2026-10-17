"use client";
import { Dispatch, SetStateAction } from "react";
import { Agent, CRMServiceTier } from "@/types";
import { Button, Modal } from "@/components/ui";

const INPUT = "w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange";

const SERVICE_TIERS: { value: CRMServiceTier; label: string }[] = [
  { value: "newsroom",     label: "Newsroom" },
  { value: "operations",  label: "Operations" },
  { value: "finance_ops", label: "Finance Ops" },
  { value: "growth_stack", label: "Growth Stack" },
  { value: "full_stack",  label: "Full Stack" },
];

export type EmailForm = { subject: string; direction: string; snippet: string };
export type ConvertForm = { service_tier: CRMServiceTier; contract_start: string; monthly_value: string };
export type EditLeadForm = {
  estimated_value: string; close_date: string; lost_reason: string; assigned_agent: Agent | ""; quiz_url: string;
};

type BaseProps = { open: boolean; onClose: () => void; saving: boolean; onSubmit: () => void };

function Footer({ onClose, onSubmit, disabled, label }: {
  onClose: () => void; onSubmit: () => void; disabled: boolean; label: React.ReactNode;
}) {
  return (
    <>
      <Button variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
      <Button className="flex-1" onClick={onSubmit} disabled={disabled}>{label}</Button>
    </>
  );
}

export function LogNoteModal({ open, onClose, saving, onSubmit, noteText, setNoteText }: BaseProps & {
  noteText: string; setNoteText: (v: string) => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log note"
      footer={<Footer onClose={onClose} onSubmit={onSubmit} disabled={saving || !noteText.trim()} label={saving ? "Saving…" : "Save note"} />}
    >
      <textarea
        className={`${INPUT} h-28 resize-none`}
        placeholder="Add a note…"
        value={noteText}
        onChange={e => setNoteText(e.target.value)}
      />
    </Modal>
  );
}

export function LogEmailModal({ open, onClose, saving, onSubmit, form, setForm }: BaseProps & {
  form: EmailForm; setForm: Dispatch<SetStateAction<EmailForm>>;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log email"
      footer={<Footer onClose={onClose} onSubmit={onSubmit} disabled={saving || !form.subject.trim()} label={saving ? "Saving…" : "Log email"} />}
    >
      <div className="space-y-3">
        <div>
          <label className="text-xs text-brand-muted mb-1 block">Subject *</label>
          <input
            className={INPUT}
            value={form.subject}
            onChange={e => setForm(p => ({ ...p, subject: e.target.value }))}
            placeholder="Following up on our call…"
          />
        </div>
        <div>
          <label className="text-xs text-brand-muted mb-1 block">Direction</label>
          <select
            className={INPUT}
            value={form.direction}
            onChange={e => setForm(p => ({ ...p, direction: e.target.value }))}
          >
            <option value="sent">Sent</option>
            <option value="received">Received</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-brand-muted mb-1 block">Snippet (optional)</label>
          <textarea
            className={`${INPUT} h-20 resize-none`}
            value={form.snippet}
            onChange={e => setForm(p => ({ ...p, snippet: e.target.value }))}
            placeholder="Brief summary or key quote…"
          />
        </div>
      </div>
    </Modal>
  );
}

export function ConvertToClientModal({ open, onClose, saving, onSubmit, form, setForm }: BaseProps & {
  form: ConvertForm; setForm: Dispatch<SetStateAction<ConvertForm>>;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Convert to client"
      footer={<Footer onClose={onClose} onSubmit={onSubmit} disabled={saving} label={saving ? "Converting…" : "Convert"} />}
    >
      <div className="space-y-3">
        <div>
          <label className="text-xs text-brand-muted mb-1 block">Service tier</label>
          <select
            className={INPUT}
            value={form.service_tier}
            onChange={e => setForm(p => ({ ...p, service_tier: e.target.value as CRMServiceTier }))}
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
            className={INPUT}
            value={form.contract_start}
            onChange={e => setForm(p => ({ ...p, contract_start: e.target.value }))}
          />
        </div>
        <div>
          <label className="text-xs text-brand-muted mb-1 block">Monthly value ($)</label>
          <input
            type="number"
            className={INPUT}
            value={form.monthly_value}
            onChange={e => setForm(p => ({ ...p, monthly_value: e.target.value }))}
            placeholder="2500"
          />
        </div>
      </div>
    </Modal>
  );
}

export function EditLeadModal({ open, onClose, saving, onSubmit, form, setForm, isLost }: BaseProps & {
  form: EditLeadForm; setForm: Dispatch<SetStateAction<EditLeadForm>>; isLost: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit lead"
      footer={<Footer onClose={onClose} onSubmit={onSubmit} disabled={saving} label={saving ? "Saving…" : "Save"} />}
    >
      <div className="space-y-3">
        <div>
          <label className="text-xs text-brand-muted mb-1 block">Assigned agent</label>
          <select
            className={INPUT}
            value={form.assigned_agent}
            onChange={e => setForm(p => ({ ...p, assigned_agent: e.target.value as Agent | "" }))}
          >
            <option value="">— unassigned —</option>
            {(["jordan", "riley", "avery", "brian"] as Agent[]).map(a => (
              <option key={a} value={a} className="capitalize">{a}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-brand-muted mb-1 block">Quiz result URL</label>
          <input
            type="url"
            className={INPUT}
            value={form.quiz_url}
            onChange={e => setForm(p => ({ ...p, quiz_url: e.target.value }))}
            placeholder="https://rosably.com/ai-readiness-assessment/..."
          />
        </div>
        <div>
          <label className="text-xs text-brand-muted mb-1 block">Est. value ($/mo)</label>
          <input
            type="number"
            className={INPUT}
            value={form.estimated_value}
            onChange={e => setForm(p => ({ ...p, estimated_value: e.target.value }))}
            placeholder="2500"
          />
        </div>
        <div>
          <label className="text-xs text-brand-muted mb-1 block">Target close date</label>
          <input
            type="date"
            className={INPUT}
            value={form.close_date}
            onChange={e => setForm(p => ({ ...p, close_date: e.target.value }))}
          />
        </div>
        {isLost && (
          <div>
            <label className="text-xs text-brand-muted mb-1 block">Lost reason</label>
            <textarea
              className={`${INPUT} h-20 resize-none`}
              value={form.lost_reason}
              onChange={e => setForm(p => ({ ...p, lost_reason: e.target.value }))}
              placeholder="Why was this lead lost?"
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
