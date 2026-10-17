"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ActivationModal } from "@/components/crm/ActivationModal";
import { Button, EmptyState, ErrorState, LoadingState, PageHeader, Tabs, type TabItem } from "@/components/ui";
import type {
  CRMClient,
  ClientService,
  ServiceTemplate,
  TmBillingEntry,
  WorkItem,
} from "@/types";
import { ServicesTab } from "./_components/ServicesTab";
import { WorkItemsTab } from "./_components/WorkItemsTab";
import { TmTab } from "./_components/TmTab";
import { AddServiceModal } from "./_components/AddServiceModal";
import { LogHoursModal } from "./_components/LogHoursModal";
import { EditServiceModal } from "./_components/EditServiceModal";
import { CancelServiceModal } from "./_components/CancelServiceModal";

type Tab = "services" | "work_items" | "tm";

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>();
  const clientId = params?.id ?? "";

  const [client, setClient] = useState<CRMClient | null>(null);
  const [services, setServices] = useState<ClientService[]>([]);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [tmEntries, setTmEntries] = useState<TmBillingEntry[]>([]);
  const [templates, setTemplates] = useState<ServiceTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("services");
  const [err, setErr] = useState<string | null>(null);

  // Modals
  const [showAddService, setShowAddService] = useState(false);
  const [activatingService, setActivatingService] = useState<ClientService | null>(null);
  const [editingService, setEditingService] = useState<ClientService | null>(null);
  const [cancellingService, setCancellingService] = useState<ClientService | null>(null);
  const [showLogHours, setShowLogHours] = useState(false);

  const loadClient = useCallback(async () => {
    const r = await fetch("/api/crm/clients");
    const all: CRMClient[] = await r.json();
    const found = (Array.isArray(all) ? all : []).find((c) => c.id === clientId) ?? null;
    setClient(found);
  }, [clientId]);

  const loadServices = useCallback(async () => {
    const r = await fetch(`/api/crm/clients/${clientId}/services`);
    const d = await r.json();
    setServices(Array.isArray(d) ? d : []);
  }, [clientId]);

  const loadWorkItems = useCallback(async () => {
    const r = await fetch(`/api/crm/clients/${clientId}/work-items`);
    const d = await r.json();
    setWorkItems(Array.isArray(d) ? d : []);
  }, [clientId]);

  const loadTmEntries = useCallback(async () => {
    // Fetch entries via the services list (the dashboard joins client-side
    // because there's no /tm-entries?client_id= route — entries are per-service).
    const r = await fetch(`/api/crm/clients/${clientId}/services`);
    const svcs: ClientService[] = await r.json();
    const tmServiceIds = (Array.isArray(svcs) ? svcs : [])
      .filter((s) => s.service_template?.billing_type === "tm")
      .map((s) => s.id);
    if (tmServiceIds.length === 0) {
      setTmEntries([]);
      return;
    }
    // Query crm.tm_billing_entries directly via PostgREST through a small
    // ad-hoc collection: for now just call the service rows' joins isn't
    // possible from this endpoint shape. We use a thin helper route.
    const out: TmBillingEntry[] = [];
    for (const sid of tmServiceIds) {
      const er = await fetch(`/api/crm/tm-entries?client_service_id=${sid}`);
      if (er.ok) {
        const entries = await er.json();
        if (Array.isArray(entries)) out.push(...entries);
      }
    }
    setTmEntries(out);
  }, [clientId]);

  const loadTemplates = useCallback(async () => {
    const r = await fetch("/api/crm/service-templates");
    const d = await r.json();
    setTemplates(Array.isArray(d) ? d.filter((t: ServiceTemplate) => t.is_active) : []);
  }, []);

  useEffect(() => {
    if (!clientId) return;
    setLoading(true);
    Promise.all([loadClient(), loadServices(), loadWorkItems(), loadTemplates()])
      .finally(() => setLoading(false));
  }, [clientId, loadClient, loadServices, loadWorkItems, loadTemplates]);

  // Refresh T&M when switching to that tab (only if there's at least one tm service)
  const hasTmService = services.some((s) => s.service_template?.billing_type === "tm");
  useEffect(() => {
    if (tab === "tm" && hasTmService) loadTmEntries();
  }, [tab, hasTmService, loadTmEntries]);

  const businessName = client?.business?.name ?? "—";

  const tabItems: TabItem<Tab>[] = [
    { id: "services", label: `Services (${services.length})` },
    { id: "work_items", label: `Work items (${workItems.length})` },
    ...(hasTmService ? [{ id: "tm" as const, label: "T&M log" }] : []),
  ];

  async function openPortal() {
    setErr(null);
    try {
      const r = await fetch(`/api/crm/clients/${clientId}/portal-link`, { method: "POST" });
      const d = await r.json();
      if (!r.ok || !d.portal_url) throw new Error(d?.error ?? `HTTP ${r.status}`);
      window.open(d.portal_url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Portal link failed");
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl pb-24 md:pb-8">
      <Link href="/crm/clients" className="text-xs text-brand-muted hover:underline">← Back to clients</Link>

      {loading ? (
        <LoadingState rows={1} className="mt-3" />
      ) : !client ? (
        <EmptyState title="Client not found." className="mt-3" />
      ) : (
        <>
          <PageHeader
            className="mt-3 mb-4 flex-wrap"
            title={businessName}
            description={
              <>
                {client.business_id && (
                  <>
                    <Link href={`/crm/businesses/${client.business_id}`} className="text-brand-orange hover:underline">
                      Business →
                    </Link>
                    {" · "}
                  </>
                )}
                {client.billing_status}
                {client.contact?.email ? ` · ${client.contact.email}` : ""}
                {!client.stripe_customer_id && " · no Stripe customer yet"}
              </>
            }
            actions={client.stripe_customer_id && (
              <Button variant="secondary" size="sm" onClick={openPortal}>
                Portal link →
              </Button>
            )}
          />

          {err && <ErrorState message={err} className="mb-3" />}

          <Tabs
            className="mb-4"
            value={tab}
            onChange={setTab}
            tabs={tabItems}
          />

          {tab === "services" && (
            <ServicesTab
              services={services}
              onAdd={() => setShowAddService(true)}
              onActivate={(s) => setActivatingService(s)}
              onEdit={(s) => setEditingService(s)}
              onCancel={(s) => setCancellingService(s)}
              onInvoice={async (s) => {
                if (!confirm(`Generate one-time invoice for ${s.service_template?.name}?`)) return;
                const desc = prompt("Invoice description:");
                if (!desc) return;
                const amt = parseFloat(prompt("Amount (USD):") ?? "");
                if (!Number.isFinite(amt) || amt <= 0) { setErr("Invalid amount"); return; }
                const r = await fetch(`/api/crm/client-services/${s.id}/invoice`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ invoice_type: "one_time", description: desc, amount: amt }),
                });
                const d = await r.json();
                if (!r.ok) { setErr(d?.error ?? `HTTP ${r.status}`); return; }
                window.open(d.invoice_url, "_blank", "noopener,noreferrer");
              }}
            />
          )}

          {tab === "work_items" && (
            <WorkItemsTab clientId={clientId} workItems={workItems} onReload={loadWorkItems} />
          )}

          {tab === "tm" && hasTmService && (
            <TmTab
              services={services.filter((s) => s.service_template?.billing_type === "tm" && s.status === "active")}
              entries={tmEntries}
              onLog={() => setShowLogHours(true)}
              onGenerateInvoice={async (svcId) => {
                if (!confirm("Generate a Stripe invoice from all unbilled hours on this service?")) return;
                const r = await fetch(`/api/crm/client-services/${svcId}/invoice`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ invoice_type: "tm_monthly" }),
                });
                const d = await r.json();
                if (!r.ok) { setErr(d?.error ?? `HTTP ${r.status}`); return; }
                await loadTmEntries();
                window.open(d.invoice_url, "_blank", "noopener,noreferrer");
              }}
            />
          )}
        </>
      )}

      {showAddService && client && (
        <AddServiceModal
          clientId={clientId}
          templates={templates}
          onClose={() => setShowAddService(false)}
          onAdded={() => { setShowAddService(false); loadServices(); }}
        />
      )}

      {activatingService && (
        <ActivationModal
          service={activatingService}
          onClose={() => setActivatingService(null)}
          // Refresh the services list but DON'T close the modal — the modal's
          // "done" step shows the success message (and clarifies what didn't
          // happen in test mode). User closes it via the Close button.
          onActivated={() => loadServices()}
        />
      )}

      {showLogHours && (
        <LogHoursModal
          services={services.filter((s) => s.service_template?.billing_type === "tm" && s.status === "active")}
          onClose={() => setShowLogHours(false)}
          onLogged={() => { setShowLogHours(false); loadTmEntries(); }}
        />
      )}

      {editingService && (
        <EditServiceModal
          service={editingService}
          onClose={() => setEditingService(null)}
          onSaved={() => { setEditingService(null); loadServices(); }}
        />
      )}

      {cancellingService && (
        <CancelServiceModal
          service={cancellingService}
          onClose={() => setCancellingService(null)}
          onCancelled={() => { setCancellingService(null); loadServices(); }}
        />
      )}
    </div>
  );
}
