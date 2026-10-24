"use client";
import { useState } from "react";
import { Button, Modal } from "@/components/ui";
import type { ClientService } from "@/types";

/** Rendered only while open: the parent mounts it, so form state resets each time. */
export function EditServiceModal({
  service,
  onClose,
  onSaved,
}: {
  service: ClientService;
  onClose: () => void;
  onSaved: () => void;
}) {
  const billingType = service.service_template?.billing_type;
  const initialRate =
    service.monthly_rate ?? service.project_rate ?? service.hourly_rate ?? "";
  const rateLabel =
    billingType === "tm" ? "Hourly rate" : billingType === "one_time" ? "Project price" : "Monthly rate";
  const rateField = (billingType ?? "recurring") === "recurring"
    ? "monthly_rate" : billingType === "tm" ? "hourly_rate" : "project_rate";

  const [rate, setRate] = useState<string>(String(initialRate ?? ""));
  const [billingStartDate, setBillingStartDate] = useState<string>(service.billing_start_date ?? "");
  const [billingEndDate, setBillingEndDate] = useState<string>(service.billing_end_date ?? "");
  const [notes, setNotes] = useState<string>(service.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const rateNum = rate === "" ? null : Number(rate);
      if (rateNum !== null && (!Number.isFinite(rateNum) || rateNum < 0)) {
        throw new Error("Rate must be a non-negative number");
      }
      const body: Record<string, unknown> = {
        [rateField]: rateNum,
        billing_start_date: billingStartDate || null,
        billing_end_date: billingEndDate || null,
        notes: notes.trim() || null,
      };
      const r = await fetch(`/api/crm/client-services/${service.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit service — ${service.service_template?.name ?? ""}`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <div className="text-[10px] uppercase text-brand-muted mb-1">{rateLabel} (USD)</div>
          <input
            type="number"
            min={0}
            step={1}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className="w-full rounded border border-brand-border px-2 py-1.5 text-sm"
          />
          {service.stripe_subscription_id && billingType === "recurring" && (
            <p className="text-[11px] text-amber-700 mt-1">
              Note: changing the rate here does <strong>not</strong> update the Stripe subscription price.
              Cancel and re-activate to change the live subscription rate.
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-[10px] uppercase text-brand-muted mb-1">Billing start</div>
            <input
              type="date"
              value={billingStartDate}
              onChange={(e) => setBillingStartDate(e.target.value)}
              className="w-full rounded border border-brand-border px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <div className="text-[10px] uppercase text-brand-muted mb-1">Billing end</div>
            <input
              type="date"
              value={billingEndDate}
              onChange={(e) => setBillingEndDate(e.target.value)}
              className="w-full rounded border border-brand-border px-2 py-1.5 text-sm"
            />
          </div>
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Notes (optional)"
          className="w-full rounded border border-brand-border px-2 py-1.5 text-xs"
        />
        {err && <div className="text-xs text-red-700">{err}</div>}
      </div>
    </Modal>
  );
}
