"use client";
import { useState } from "react";
import { Button, Modal } from "@/components/ui";
import type { ServiceTemplate } from "@/types";

/** Rendered only while open: the parent mounts it, so form state resets each time. */
export function AddServiceModal({
  clientId,
  templates,
  onClose,
  onAdded,
}: {
  clientId: string;
  templates: ServiceTemplate[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [templateId, setTemplateId] = useState<string>(templates[0]?.id ?? "");
  const [rate, setRate] = useState<string>("");
  const [billingStartDate, setBillingStartDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const template = templates.find((t) => t.id === templateId);
  const rateLabel = template?.billing_type === "tm"
    ? "Hourly rate (USD)"
    : template?.billing_type === "one_time"
      ? "Project price (USD)"
      : "Monthly rate (USD)";

  async function save() {
    if (!template) { setErr("Pick a service"); return; }
    const rateNum = Number(rate);
    if (!Number.isFinite(rateNum) || rateNum < 0) { setErr("Rate must be ≥ 0"); return; }
    setSaving(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {
        client_id: clientId,
        service_template_id: template.id,
        billing_start_date: billingStartDate || null,
        notes: notes.trim() || null,
      };
      if (template.billing_type === "recurring") body.monthly_rate = rateNum;
      else if (template.billing_type === "one_time") body.project_rate = rateNum;
      else if (template.billing_type === "tm") body.hourly_rate = rateNum;

      const r = await fetch("/api/crm/client-services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`);
      }
      onAdded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add service to client"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={saving || !templateId}>
            {saving ? "Saving…" : "Add service"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <div className="text-[10px] uppercase text-brand-muted mb-1">Service</div>
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="w-full rounded border border-brand-border px-2 py-1.5 text-sm"
          >
            {templates.length === 0 && <option value="">No active templates</option>}
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.billing_type}{t.billing_interval ? `/${t.billing_interval}` : ""})
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="text-[10px] uppercase text-brand-muted mb-1">{rateLabel}</div>
          <input
            type="number"
            min={0}
            step={1}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder="e.g. 1500"
            className="w-full rounded border border-brand-border px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <div className="text-[10px] uppercase text-brand-muted mb-1">Billing start date</div>
          <input
            type="date"
            value={billingStartDate}
            onChange={(e) => setBillingStartDate(e.target.value)}
            className="w-full rounded border border-brand-border px-2 py-1.5 text-sm"
          />
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Notes (optional)"
          className="w-full rounded border border-brand-border px-2 py-1.5 text-xs"
        />
        <p className="text-[11px] text-brand-muted">
          Row will be created with status=&apos;pending_activation&apos;. Use &quot;Activate billing&quot; to finish setup.
        </p>
        {err && <div className="text-xs text-red-700">{err}</div>}
      </div>
    </Modal>
  );
}
