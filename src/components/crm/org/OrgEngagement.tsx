"use client";
// Engagement tab: pick a deal, then its Discovery → Scope → Room → Delivery stepper with each step's tools.
import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { format } from "date-fns";
import { fetchJson } from "@/lib/fetch-json";
import { STAGES } from "@/lib/crm/stages";
import { JOURNEY_STEPS, dealJourney, type DealSummary, type RoomSummary, type ScopeSummary } from "@/lib/crm/org-engagement";
import type { OrgClient, OrgDetail } from "@/lib/crm/org-detail";
import { NewDiscoveryModal } from "@/components/crm/NewDiscoveryModal";
import { Button, Modal } from "@/components/ui";
import { DiscoveryStep } from "./DiscoveryStep";
import { ScopeStep } from "./ScopeStep";
import { RoomStep } from "./RoomStep";
import { ScopeResearchInputsSlot } from "./slots";

const money = (n: number | null) => (n ? `$${Number(n).toLocaleString()}` : "no value");
export const dealLabel = (d: DealSummary) =>
  `${STAGES.find((s) => s.stage === d.stage)?.label ?? d.stage} · ${money(d.estimated_value)} · opened ${format(new Date(d.created_at), "MMM d, yyyy")}`;

export function OrgEngagement({ detail, dealId, onSelectDeal, onChanged, onOpenTab }: {
  detail: OrgDetail; dealId: string | null; onSelectDeal: (id: string) => void; onChanged: () => void;
  onOpenTab: (tab: "billing" | "time") => void;
}) {
  const deal = detail.deals.find((d) => d.id === dealId) ?? null;
  const journey = deal ? dealJourney(deal) : -1;
  const [step, setStep] = useState<number>(Math.max(0, Math.min(journey, 2)));
  const [showNew, setShowNew] = useState(false);
  // A different deal opens on its own current step.
  useEffect(() => { setStep(Math.max(0, Math.min(deal ? dealJourney(deal) : 0, 2))); }, [deal?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (detail.deals.length === 0) {
    return (
      <div className="space-y-4">
        <div className="card">
          <h2 className="text-sm font-semibold text-brand-black mb-1">No deals yet</h2>
          <p className="text-sm text-brand-muted mb-3">Start with a discovery questionnaire. It opens a deal and a draft from your default template.</p>
          <Button size="sm" onClick={() => setShowNew(true)}>+ Start discovery</Button>
        </div>
        <OtherWork detail={detail} onChanged={onChanged} />
        {showNew && <NewDiscoveryModal onClose={() => setShowNew(false)} />}
      </div>
    );
  }

  const relationship: "prospect" | "client" | "partner" = detail.status === "partner" ? "partner" : detail.status === "client" ? "client" : "prospect";
  return (
    <div className="space-y-4">
      {detail.deals.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <label htmlFor="deal-picker" className="text-xs text-brand-muted">Deal</label>
          <select id="deal-picker" value={deal?.id ?? ""} onChange={(e) => onSelectDeal(e.target.value)}
            className="border border-brand-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-brand-orange">
            {detail.deals.map((d) => <option key={d.id} value={d.id}>{dealLabel(d)}</option>)}
          </select>
        </div>
      )}
      {deal && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="tablist" aria-label="Engagement steps">
            {JOURNEY_STEPS.map((s, i) => (
              <button key={s.id} type="button" role="tab" aria-selected={step === i} onClick={() => setStep(i)}
                className={clsx("text-left rounded-lg border px-3 py-2 transition-colors",
                  step === i ? "border-brand-orange bg-white" : "border-brand-border bg-brand-offwhite hover:bg-white",
                  i < journey && "text-green-700")}>
                <span className="block text-sm font-medium">{i < journey ? "✓ " : i === journey ? "● " : ""}{s.label}</span>
                <span className="block text-xs text-brand-muted">{s.hint}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-brand-muted">
            <Link href={`/crm/leads/${deal.id}`} className="text-brand-orange hover:underline">Deal details →</Link>
            {deal.contact && <> · {deal.contact.first_name}{deal.contact.last_name ? ` ${deal.contact.last_name}` : ""}</>}
          </p>
          {step === 0 && <DiscoveryStep leadId={deal.id} invites={deal.discovery} onChanged={onChanged} />}
          {step === 1 && (
            <ScopeStep scope={deal.scope} hasBrief={deal.discovery.some((i) => i.brief_status === "ready")} onChanged={onChanged}
              researchSlot={(scopeId) => <ScopeResearchInputsSlot businessId={detail.business.id} scopeId={scopeId} />} />
          )}
          {step === 2 && (
            <RoomStep businessId={detail.business.id} leadId={deal.id} clientId={deal.client_id} relationship={relationship}
              rooms={deal.rooms} onChanged={onChanged} />
          )}
          {step === 3 && <DeliveryStep deal={deal} client={detail.clients.find((c) => c.id === deal.client_id) ?? null} onChanged={onChanged} onOpenTab={onOpenTab} />}
        </>
      )}
      <OtherWork detail={detail} onChanged={onChanged} />
    </div>
  );
}

/** Rooms and scopes on the organization that no single deal owns. */
function OtherWork({ detail, onChanged }: { detail: OrgDetail; onChanged: () => void }) {
  const rooms: RoomSummary[] = detail.other_rooms;
  const scopes: ScopeSummary[] = detail.other_scopes;
  if (rooms.length === 0 && scopes.length === 0) {
    if (detail.deals.length > 0) return null;
    return (
      <RoomStep businessId={detail.business.id} leadId={null} clientId={detail.primary_client_id}
        relationship={detail.status === "partner" ? "partner" : detail.status === "client" ? "client" : "prospect"} rooms={[]} onChanged={onChanged} />
    );
  }
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-brand-muted">Not tied to one deal</h3>
      {scopes.map((s) => (
        <div key={s.id} className="card flex items-center justify-between gap-2 text-sm">
          <span>Scope: {s.title}{s.current_version_no ? ` · v${s.current_version_no}` : ""}{s.proposals.length ? ` · ${s.proposals.length} pending` : ""}</span>
          <Link href={`/crm/scope/${s.id}`} className="text-xs text-brand-orange hover:underline">Open →</Link>
        </div>
      ))}
      {rooms.length > 0 && (
        <RoomStep businessId={detail.business.id} leadId={null} clientId={detail.primary_client_id}
          relationship={detail.status === "partner" ? "partner" : detail.status === "client" ? "client" : "prospect"} rooms={rooms} onChanged={onChanged} />
      )}
    </div>
  );
}

function DeliveryStep({ deal, client, onChanged, onOpenTab }: {
  deal: DealSummary; client: OrgClient | null; onChanged: () => void; onOpenTab: (tab: "billing" | "time") => void;
}) {
  const [converting, setConverting] = useState(false);
  const [contractStart, setContractStart] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function convert() {
    setBusy(true); setErr(null);
    const r = await fetchJson(`/api/crm/leads/${deal.id}/convert`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contract_start: contractStart || undefined }),
    });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setConverting(false);
    onChanged();
  }

  if (client) {
    const live = client.services.filter((s) => s.status !== "cancelled");
    return (
      <div className="card space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-semibold text-brand-black">Delivery</h3>
          <span className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => onOpenTab("billing")}>Billing</Button>
            <Button size="sm" variant="secondary" onClick={() => onOpenTab("time")}>Time</Button>
          </span>
        </div>
        <p className="text-sm text-brand-muted">
          Client since {client.contract_start ?? format(new Date(client.created_at), "MMM d, yyyy")} · billing {client.billing_status}
          {" · "}{live.length ? live.map((s) => s.service_template?.name ?? "service").join(", ") : "no services yet"}
        </p>
        <p className="text-xs text-brand-muted">Services, invoices and time are on the Billing and Time tabs.</p>
      </div>
    );
  }
  return (
    <div className="card space-y-2">
      <h3 className="text-sm font-semibold text-brand-black">Delivery</h3>
      {deal.stage === "won" ? (
        <>
          <p className="text-sm text-brand-muted">The deal is won. Converting creates the client record; then add services and billing on the Billing tab.</p>
          <Button size="sm" onClick={() => setConverting(true)}>Convert to client</Button>
        </>
      ) : (
        <p className="text-sm text-brand-muted">
          Once the deal is won, <b>Convert to client</b> creates the client record and the Billing, Time and Work tabs appear.
          Move the deal to Won on the <Link href={`/crm/leads/${deal.id}`} className="text-brand-orange hover:underline">deal page</Link> or the pipeline.
        </p>
      )}
      {err && <p className="text-xs text-red-700">{err}</p>}
      <Modal open={converting} onClose={() => setConverting(false)} title="Convert to client"
        footer={<>
          <Button variant="ghost" className="flex-1" onClick={() => setConverting(false)}>Cancel</Button>
          <Button className="flex-1" onClick={convert} disabled={busy}>{busy ? "Converting…" : "Convert"}</Button>
        </>}>
        <label className="text-xs text-brand-muted mb-1 block" htmlFor="contract-start">Contract start (optional)</label>
        <input id="contract-start" type="date" value={contractStart} onChange={(e) => setContractStart(e.target.value)}
          className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange" />
        {err && <p className="text-xs text-red-700 mt-2">{err}</p>}
      </Modal>
    </div>
  );
}
