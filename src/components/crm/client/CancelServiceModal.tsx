"use client";
import { useState } from "react";
import clsx from "clsx";
import { Button, Modal } from "@/components/ui";
import type { ClientService } from "@/types";

/** Rendered only while open: the parent mounts it, so form state resets each time. */
export function CancelServiceModal({
  service,
  onClose,
  onCancelled,
}: {
  service: ClientService;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const [effectiveDate, setEffectiveDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Determine immediate vs scheduled for the warning copy.
  const todayIso = new Date().toISOString().slice(0, 10);
  const immediate = effectiveDate <= todayIso;
  const hasStripeSub = Boolean(service.stripe_subscription_id);

  async function submit() {
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch(`/api/crm/client-services/${service.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ effective_date: effectiveDate }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`);
      onCancelled();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Cancellation failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Cancel service — ${service.service_template?.name ?? ""}`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Back</Button>
          {/* Amber "scheduled" state has no Button variant, so this stays hand-styled. */}
          <button
            onClick={submit}
            disabled={saving}
            className={clsx(
              "text-xs px-3 py-1.5 rounded text-white",
              immediate ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700",
              saving && "opacity-60",
            )}
          >
            {saving ? "Cancelling…" : immediate ? "Cancel now" : "Schedule cancellation"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <div className="text-[10px] uppercase text-brand-muted mb-1">Effective date</div>
          <input
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            className="w-full rounded border border-brand-border px-2 py-1.5 text-sm"
          />
        </div>
        <div className="text-xs text-brand-muted leading-relaxed">
          {immediate ? (
            <>
              <strong className="text-red-700">Immediate cancellation.</strong> Service flips to{" "}
              <code className="text-[11px] bg-brand-cream px-1 rounded">cancelled</code> now
              {hasStripeSub && ", and the Stripe subscription is cancelled immediately (no further charges)"}.
            </>
          ) : (
            <>
              <strong className="text-amber-800">Scheduled cancellation.</strong> Service stays{" "}
              <code className="text-[11px] bg-brand-cream px-1 rounded">active</code> until{" "}
              <strong>{effectiveDate}</strong>
              {hasStripeSub
                ? ", then the Stripe subscription ends and the webhook flips status to cancelled."
                : ". (No Stripe subscription — the row stays active until the date passes, with billing_end_date set.)"}
            </>
          )}
        </div>
        {err && <div className="text-xs text-red-700">{err}</div>}
      </div>
    </Modal>
  );
}
