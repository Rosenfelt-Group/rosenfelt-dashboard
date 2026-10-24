"use client";
import { useState } from "react";
import { Button, Modal } from "@/components/ui";
import type { ClientService } from "@/types";

/** Rendered only while open: the parent mounts it, so form state resets each time. */
export function LogHoursModal({
  services,
  onClose,
  onLogged,
}: {
  services: ClientService[];
  onClose: () => void;
  onLogged: () => void;
}) {
  const [serviceId, setServiceId] = useState<string>(services[0]?.id ?? "");
  const [entryDate, setEntryDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [hours, setHours] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    const h = Number(hours);
    if (!Number.isFinite(h) || h <= 0) { setErr("Hours must be a positive number"); return; }
    if (!description.trim()) { setErr("Description is required"); return; }
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch("/api/crm/tm-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_service_id: serviceId,
          entry_date: entryDate,
          hours: h,
          description: description.trim(),
          logged_by: "brian",
        }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`);
      }
      onLogged();
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
      title="Log T&M hours"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          {services.length > 0 && (
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? "Logging…" : "Log hours"}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3">
        {services.length === 0 ? (
          <p className="text-xs text-red-700">No active T&M services. Activate a T&M service first.</p>
        ) : (
          <>
            <div>
              <div className="text-[10px] uppercase text-brand-muted mb-1">Service</div>
              <select
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
                className="w-full rounded border border-brand-border px-2 py-1.5 text-sm"
              >
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.service_template?.name} (${s.hourly_rate}/hr)
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[10px] uppercase text-brand-muted mb-1">Date</div>
                <input
                  type="date"
                  value={entryDate}
                  onChange={(e) => setEntryDate(e.target.value)}
                  className="w-full rounded border border-brand-border px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <div className="text-[10px] uppercase text-brand-muted mb-1">Hours</div>
                <input
                  type="number"
                  min={0.25}
                  step={0.25}
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  placeholder="e.g. 2.5"
                  className="w-full rounded border border-brand-border px-2 py-1.5 text-sm"
                />
              </div>
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What was done?"
              className="w-full rounded border border-brand-border px-2 py-1.5 text-xs"
            />
            {err && <div className="text-xs text-red-700">{err}</div>}
          </>
        )}
      </div>
    </Modal>
  );
}
