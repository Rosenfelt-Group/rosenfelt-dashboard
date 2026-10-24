"use client";
// Billing, Time and Work items for one client record (crm.clients), formerly the tabs of /crm/clients/[id].
// The organization page shows these once the organization has a client record.
import { useCallback, useEffect, useState } from "react";
import { ActivationModal } from "@/components/crm/ActivationModal";
import { ErrorState, LoadingState } from "@/components/ui";
import type { ClientService, ServiceTemplate, TmBillingEntry, WorkItem } from "@/types";
import { ServicesTab } from "./ServicesTab";
import { WorkItemsTab } from "./WorkItemsTab";
import { TmTab } from "./TmTab";
import { AddServiceModal } from "./AddServiceModal";
import { LogHoursModal } from "./LogHoursModal";
import { EditServiceModal } from "./EditServiceModal";
import { CancelServiceModal } from "./CancelServiceModal";

export type ClientRecord = ReturnType<typeof useClientRecord>;

const isTm = (s: ClientService) => s.service_template?.billing_type === "tm";

export function useClientRecord(clientId: string | null) {
  const [services, setServices] = useState<ClientService[]>([]);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [tmEntries, setTmEntries] = useState<TmBillingEntry[]>([]);
  const [templates, setTemplates] = useState<ServiceTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadServices = useCallback(async () => {
    if (!clientId) return [] as ClientService[];
    const r = await fetch(`/api/crm/clients/${clientId}/services`);
    const d = await r.json().catch(() => null);
    const list: ClientService[] = Array.isArray(d) ? d : [];
    if (!r.ok) setError(d?.error ?? `Couldn't load services (HTTP ${r.status})`);
    setServices(list);
    return list;
  }, [clientId]);

  const loadWorkItems = useCallback(async () => {
    if (!clientId) return;
    const r = await fetch(`/api/crm/clients/${clientId}/work-items`);
    const d = await r.json().catch(() => null);
    setWorkItems(Array.isArray(d) ? d : []);
  }, [clientId]);

  // Entries are per service (there is no /tm-entries?client_id= route), so fetch each T&M service's entries.
  const loadTmEntries = useCallback(async () => {
    const svcs = await loadServices();
    const out: TmBillingEntry[] = [];
    for (const s of svcs.filter(isTm)) {
      const er = await fetch(`/api/crm/tm-entries?client_service_id=${s.id}`);
      if (er.ok) {
        const entries = await er.json();
        if (Array.isArray(entries)) out.push(...entries);
      }
    }
    setTmEntries(out);
  }, [loadServices]);

  const loadTemplates = useCallback(async () => {
    const r = await fetch("/api/crm/service-templates");
    const d = await r.json().catch(() => null);
    setTemplates(Array.isArray(d) ? d.filter((t: ServiceTemplate) => t.is_active) : []);
  }, []);

  useEffect(() => {
    if (!clientId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    Promise.all([loadServices(), loadWorkItems(), loadTemplates()]).finally(() => setLoading(false));
  }, [clientId, loadServices, loadWorkItems, loadTemplates]);

  return { clientId, services, workItems, tmEntries, templates, loading, error, setError, loadServices, loadWorkItems, loadTmEntries };
}

export function ClientBillingPanel({ record, onChanged }: { record: ClientRecord; onChanged?: () => void }) {
  const { clientId, services, templates, loading, error, setError, loadServices } = record;
  const [showAdd, setShowAdd] = useState(false);
  const [activating, setActivating] = useState<ClientService | null>(null);
  const [editing, setEditing] = useState<ClientService | null>(null);
  const [cancelling, setCancelling] = useState<ClientService | null>(null);
  const reload = () => { loadServices(); onChanged?.(); };

  if (!clientId) return null;
  if (loading) return <LoadingState rows={2} />;
  return (
    <>
      {error && <ErrorState message={error} className="mb-3" />}
      <ServicesTab
        services={services}
        onAdd={() => setShowAdd(true)}
        onActivate={setActivating}
        onEdit={setEditing}
        onCancel={setCancelling}
        onInvoice={async (s) => {
          if (!confirm(`Generate one-time invoice for ${s.service_template?.name}?`)) return;
          const desc = prompt("Invoice description:");
          if (!desc) return;
          const amt = parseFloat(prompt("Amount (USD):") ?? "");
          if (!Number.isFinite(amt) || amt <= 0) { setError("Invalid amount"); return; }
          const r = await fetch(`/api/crm/client-services/${s.id}/invoice`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ invoice_type: "one_time", description: desc, amount: amt }),
          });
          const d = await r.json();
          if (!r.ok) { setError(d?.error ?? `HTTP ${r.status}`); return; }
          window.open(d.invoice_url, "_blank", "noopener,noreferrer");
        }}
      />
      {showAdd && (
        <AddServiceModal clientId={clientId} templates={templates} onClose={() => setShowAdd(false)}
          onAdded={() => { setShowAdd(false); reload(); }} />
      )}
      {activating && (
        // Refresh the list but keep the modal open: its "done" step explains what happened (and what
        // didn't, in test mode). The user closes it.
        <ActivationModal service={activating} onClose={() => setActivating(null)} onActivated={reload} />
      )}
      {editing && (
        <EditServiceModal service={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      )}
      {cancelling && (
        <CancelServiceModal service={cancelling} onClose={() => setCancelling(null)} onCancelled={() => { setCancelling(null); reload(); }} />
      )}
    </>
  );
}

export function ClientTimePanel({ record }: { record: ClientRecord }) {
  const { clientId, services, tmEntries, loading, error, setError, loadTmEntries } = record;
  const [showLog, setShowLog] = useState(false);
  const hasTm = services.some(isTm);
  useEffect(() => { if (clientId && hasTm) loadTmEntries(); }, [clientId, hasTm, loadTmEntries]);

  if (!clientId) return null;
  if (loading) return <LoadingState rows={2} />;
  const activeTm = services.filter((s) => isTm(s) && s.status === "active");
  return (
    <>
      {error && <ErrorState message={error} className="mb-3" />}
      {!hasTm ? (
        <p className="card text-sm text-brand-muted">
          Hours are logged against a time-and-materials service. Add one on the Billing tab to start logging time.
        </p>
      ) : (
        <TmTab
          services={activeTm}
          entries={tmEntries}
          onLog={() => setShowLog(true)}
          onGenerateInvoice={async (svcId) => {
            if (!confirm("Generate a Stripe invoice from all unbilled hours on this service?")) return;
            const r = await fetch(`/api/crm/client-services/${svcId}/invoice`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ invoice_type: "tm_monthly" }),
            });
            const d = await r.json();
            if (!r.ok) { setError(d?.error ?? `HTTP ${r.status}`); return; }
            await loadTmEntries();
            window.open(d.invoice_url, "_blank", "noopener,noreferrer");
          }}
        />
      )}
      {showLog && (
        <LogHoursModal services={activeTm} onClose={() => setShowLog(false)}
          onLogged={() => { setShowLog(false); loadTmEntries(); }} />
      )}
    </>
  );
}

export function ClientWorkPanel({ record }: { record: ClientRecord }) {
  const { clientId, workItems, loading, loadWorkItems } = record;
  if (!clientId) return null;
  if (loading) return <LoadingState rows={2} />;
  return <WorkItemsTab clientId={clientId} workItems={workItems} onReload={loadWorkItems} />;
}

/** Opens the Stripe customer portal for a client (needs a Stripe customer). */
export async function openClientPortal(clientId: string): Promise<string | null> {
  try {
    const r = await fetch(`/api/crm/clients/${clientId}/portal-link`, { method: "POST" });
    const d = await r.json();
    if (!r.ok || !d.portal_url) throw new Error(d?.error ?? `HTTP ${r.status}`);
    window.open(d.portal_url, "_blank", "noopener,noreferrer");
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Portal link failed";
  }
}
