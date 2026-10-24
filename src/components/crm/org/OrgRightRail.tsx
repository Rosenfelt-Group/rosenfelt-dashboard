"use client";
// Right column: the next step, deals with value and stage, active services and engagement progress.
import { useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { addDays, format } from "date-fns";
import { fetchJson } from "@/lib/fetch-json";
import { Button } from "@/components/ui";
import { STAGES } from "@/lib/crm/stages";
import { JOURNEY_STEPS, dealJourney, isOpenDeal } from "@/lib/crm/org-engagement";
import type { OrgDetail } from "@/lib/crm/org-detail";
import { upcomingDate } from "@/lib/crm/org-timeline";
import { CreateLeadModal } from "@/components/crm/CreateLeadModal";

const money = (n: number | null | undefined) => (n ? `$${Number(n).toLocaleString()}` : "—");

export function JourneyBar({ journey }: { journey: number }) {
  return (
    <div className="flex gap-1" aria-label={journey < 0 ? "Not started" : `At ${JOURNEY_STEPS[journey]?.label}`}>
      {JOURNEY_STEPS.map((s, i) => (
        <span key={s.id} title={s.label} className={clsx("h-1.5 flex-1 rounded-full", i < journey ? "bg-green-500" : i === journey ? "bg-brand-orange" : "bg-brand-border")} />
      ))}
    </div>
  );
}

export function OrgRightRail({ detail, dealId, onOpenDeal, onOpenTab, onChanged }: {
  detail: OrgDetail; dealId: string | null; onOpenDeal: (leadId: string) => void;
  onOpenTab: (tab: "billing") => void; onChanged: () => void;
}) {
  const [newDeal, setNewDeal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const deal = detail.deals.find((d) => d.id === dealId) ?? null;
  const journey = deal ? dealJourney(deal) : -1;
  const services = detail.clients.flatMap((c) => c.services.filter((s) => s.status !== "cancelled"));
  // The selected deal's next step, else the first upcoming item for the organization.
  const stepDeal = deal && isOpenDeal(deal) && deal.next_step ? deal : null;
  const next = stepDeal ? null : detail.upcoming[0];
  const today = new Date().toISOString().slice(0, 10);

  async function patchDeal(body: Record<string, unknown>) {
    if (!stepDeal) return;
    setBusy(true); setErr(null);
    const r = await fetchJson(`/api/crm/leads/${stepDeal.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    onChanged();
  }
  const snooze = () => {
    const base = stepDeal?.next_step_due && stepDeal.next_step_due > today ? stepDeal.next_step_due : today;
    patchDeal({ next_step_due: addDays(new Date(`${base}T12:00:00`), 2).toISOString().slice(0, 10) });
  };

  return (
    <div className="space-y-4">
      {stepDeal && (
        <div className="card border-brand-orange">
          <p className="text-xs uppercase tracking-wide text-brand-muted mb-1">Next step</p>
          <p className="text-sm font-medium text-brand-black break-words">{stepDeal.next_step}</p>
          <p className={clsx("text-xs", stepDeal.next_step_due && stepDeal.next_step_due < today ? "text-amber-700" : "text-brand-muted")}>
            {stepDeal.next_step_due ? `Due ${format(new Date(`${stepDeal.next_step_due}T12:00:00`), "MMM d")}` : "No due date"}
          </p>
          <div className="flex gap-2 mt-2">
            <Button size="sm" disabled={busy} onClick={() => patchDeal({ next_step: null, next_step_due: null })}>Done</Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={snooze}>Snooze 2 days</Button>
          </div>
          <p className="text-xs text-brand-muted mt-2">Set the next one on the <Link href={`/crm/leads/${stepDeal.id}`} className="text-brand-orange hover:underline">deal</Link>.</p>
          {err && <p className="text-xs text-red-700 mt-1">{err}</p>}
        </div>
      )}
      {next && (
        <div className="card border-brand-orange">
          <p className="text-xs uppercase tracking-wide text-brand-muted mb-1">Next step</p>
          <p className="text-sm font-medium text-brand-black">{next.title}</p>
          <p className="text-xs text-brand-muted">{next.kind === "close_date" || next.kind === "next_step" ? "Due" : "Since"} {format(upcomingDate(next.at), "MMM d")}{next.detail ? ` · ${next.detail}` : ""}</p>
          {next.lead_id && (
            <button type="button" className="text-xs text-brand-orange hover:underline mt-1" onClick={() => onOpenDeal(next.lead_id!)}>Open in Engagement →</button>
          )}
        </div>
      )}

      <div className="card">
        <h2 className="text-sm font-medium text-brand-black mb-2">Deals <span className="text-brand-muted font-normal">{detail.deals.length}</span></h2>
        {detail.deals.length === 0 ? <p className="text-xs text-brand-muted">No deals.</p> : (
          <ul className="space-y-2">
            {detail.deals.map((d) => {
              const stage = STAGES.find((s) => s.stage === d.stage);
              return (
                <li key={d.id} className={clsx("rounded border px-2 py-1.5", d.id === dealId ? "border-brand-orange" : "border-brand-border")}>
                  <button type="button" className="w-full text-left" onClick={() => onOpenDeal(d.id)}>
                    <span className="flex items-center justify-between gap-2">
                      {stage && <span className={clsx("badge text-xs", stage.color)}>{stage.label}</span>}
                      <span className="text-sm tabular-nums">{money(d.estimated_value)}</span>
                    </span>
                    <span className="block text-xs text-brand-muted mt-0.5">
                      {d.contact ? `${d.contact.first_name}${d.contact.last_name ? ` ${d.contact.last_name}` : ""} · ` : ""}opened {format(new Date(d.created_at), "MMM d, yyyy")}
                    </span>
                  </button>
                  <Link href={`/crm/leads/${d.id}`} className="text-xs text-brand-orange hover:underline">Deal page →</Link>
                </li>
              );
            })}
          </ul>
        )}
        <button type="button" className="text-xs text-brand-orange hover:underline mt-2" onClick={() => setNewDeal(true)}>+ New deal</button>
      </div>

      {services.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-medium text-brand-black mb-2">Services</h2>
          <ul className="space-y-1">
            {services.map((s) => (
              <li key={s.id}>
                <button type="button" className="w-full text-left text-sm flex justify-between gap-2 hover:text-brand-orange" onClick={() => onOpenTab("billing")}>
                  <span>{s.service_template?.name ?? "Service"}</span>
                  <span className="text-xs text-brand-muted whitespace-nowrap">
                    {s.monthly_rate != null ? `$${s.monthly_rate}/mo` : s.hourly_rate != null ? `$${s.hourly_rate}/hr` : s.project_rate != null ? `$${s.project_rate}` : ""} · {s.status.replace("_", " ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {deal && (
        <div className="card">
          <h2 className="text-sm font-medium text-brand-black mb-2">Engagement</h2>
          <JourneyBar journey={journey} />
          <p className="text-xs text-brand-muted mt-2">
            {journey < 0 ? "Not started." : <>Now at <b className="text-brand-black">{JOURNEY_STEPS[journey as 0 | 1 | 2 | 3].label}</b>.</>}
          </p>
          <button type="button" className="text-xs text-brand-orange hover:underline" onClick={() => onOpenDeal(deal.id)}>Open →</button>
        </div>
      )}

      {newDeal && (
        <CreateLeadModal initialBusiness={{ id: detail.business.id, name: detail.business.name }} onClose={() => setNewDeal(false)}
          onCreate={() => { setNewDeal(false); onChanged(); }} />
      )}
    </div>
  );
}
