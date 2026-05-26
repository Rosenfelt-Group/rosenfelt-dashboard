"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import { CRMNav } from "@/components/CRMNav";
import { ActivationModal } from "@/components/crm/ActivationModal";
import type {
  CRMClient,
  ClientService,
  ServiceTemplate,
  TmBillingEntry,
  WorkItem,
  ClientServiceStatus,
} from "@/types";

type Tab = "services" | "work_items" | "tm";

const STATUS_PILL: Record<ClientServiceStatus, string> = {
  pending_activation: "bg-gray-100 text-gray-600",
  active:             "bg-green-100 text-green-700",
  paused:             "bg-yellow-100 text-yellow-800",
  cancelled:          "bg-red-100 text-red-700",
};

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
      <CRMNav />
      <Link href="/crm/clients" className="text-xs text-brand-muted hover:underline">← Back to clients</Link>

      {loading ? (
        <div className="card animate-pulse h-32 mt-3" />
      ) : !client ? (
        <div className="card text-center py-12 mt-3">
          <p className="text-brand-muted text-sm">Client not found.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mt-3 mb-4 gap-3 flex-wrap">
            <div>
              <h1 className="text-xl font-semibold text-brand-black">{businessName}</h1>
              <p className="text-xs text-brand-muted mt-0.5">
                {client.billing_status}
                {client.contact?.email ? ` · ${client.contact.email}` : ""}
                {!client.stripe_customer_id && " · no Stripe customer yet"}
              </p>
            </div>
            {client.stripe_customer_id && (
              <button onClick={openPortal} className="text-xs px-3 py-1.5 rounded border border-brand-border hover:bg-brand-cream">
                Portal link →
              </button>
            )}
          </div>

          {err && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded px-3 py-2 mb-3">
              {err}
            </div>
          )}

          <div className="flex items-center gap-1 border-b border-brand-border mb-4">
            <TabButton active={tab === "services"} onClick={() => setTab("services")}>
              Services ({services.length})
            </TabButton>
            <TabButton active={tab === "work_items"} onClick={() => setTab("work_items")}>
              Work items ({workItems.length})
            </TabButton>
            {hasTmService && (
              <TabButton active={tab === "tm"} onClick={() => setTab("tm")}>
                T&M log
              </TabButton>
            )}
          </div>

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

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "text-xs px-3 py-2 -mb-px border-b-2 transition-colors",
        active
          ? "border-brand-orange text-brand-black font-medium"
          : "border-transparent text-brand-muted hover:text-brand-black",
      )}
    >
      {children}
    </button>
  );
}

// ─── Services tab ────────────────────────────────────────────────────────────

function ServicesTab({
  services,
  onAdd,
  onActivate,
  onEdit,
  onCancel,
  onInvoice,
}: {
  services: ClientService[];
  onAdd: () => void;
  onActivate: (s: ClientService) => void;
  onEdit: (s: ClientService) => void;
  onCancel: (s: ClientService) => void;
  onInvoice: (s: ClientService) => void;
}) {
  return (
    <>
      <div className="flex justify-between items-center mb-3">
        <div className="text-xs text-brand-muted">
          {services.length === 0 ? "No services yet" : `${services.length} service${services.length === 1 ? "" : "s"}`}
        </div>
        <button onClick={onAdd} className="btn-primary text-xs px-3 py-1.5">+ Add service</button>
      </div>
      {services.length === 0 ? (
        <div className="card text-center py-8">
          <p className="text-brand-muted text-sm">Click "Add service" to attach a service from the catalog.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {services.map((s) => {
            const tmpl = s.service_template;
            const rate = s.monthly_rate ?? s.project_rate ?? s.hourly_rate;
            const rateLabel = s.monthly_rate != null
              ? `$${s.monthly_rate}/mo`
              : s.hourly_rate != null
                ? `$${s.hourly_rate}/hr`
                : s.project_rate != null
                  ? `$${s.project_rate}`
                  : "rate not set";
            return (
              <div key={s.id} className="card">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-sm font-medium text-brand-black">{tmpl?.name ?? "(unknown service)"}</div>
                    <div className="text-xs text-brand-muted mt-0.5 flex flex-wrap items-center gap-2">
                      <span className={clsx("inline-flex rounded-full px-2 py-0.5 text-[11px]", STATUS_PILL[s.status])}>
                        {s.status.replace("_", " ")}
                      </span>
                      <span>{rateLabel}</span>
                      {s.billing_start_date && <span>· starts {s.billing_start_date}</span>}
                      {s.stripe_subscription_status && (
                        <span className="text-[11px]">· stripe: {s.stripe_subscription_status}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {s.status === "pending_activation" && rate != null && (
                      <button onClick={() => onActivate(s)} className="text-xs px-3 py-1.5 rounded bg-brand-orange text-white hover:opacity-90">
                        Activate billing
                      </button>
                    )}
                    {s.status === "active" && tmpl?.billing_type === "tm" && (
                      <button onClick={() => onInvoice(s)} className="text-xs px-3 py-1.5 rounded border border-brand-border hover:bg-brand-cream">
                        Invoice now
                      </button>
                    )}
                    <button
                      onClick={() => onEdit(s)}
                      className="text-xs px-3 py-1.5 rounded border border-brand-border hover:bg-brand-cream"
                    >
                      Edit
                    </button>
                    {s.status !== "cancelled" && (
                      <button
                        onClick={() => onCancel(s)}
                        className="text-xs px-3 py-1.5 rounded border border-brand-border hover:bg-red-50 hover:border-red-200 hover:text-red-700"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ─── Work Items tab ──────────────────────────────────────────────────────────

function WorkItemsTab({
  clientId,
  workItems,
  onReload,
}: {
  clientId: string;
  workItems: WorkItem[];
  onReload: () => void;
}) {
  const [showNew, setShowNew] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "in_progress" | "done">("all");

  const filtered = useMemo(() => {
    if (statusFilter === "all") return workItems;
    if (statusFilter === "open") return workItems.filter((w) => ["inbox", "approved", "open", "prompt_ready"].includes(w.status));
    return workItems.filter((w) => w.status === statusFilter);
  }, [workItems, statusFilter]);

  return (
    <>
      <div className="flex justify-between items-center mb-3 gap-2 flex-wrap">
        <div className="inline-flex items-center gap-1 rounded border border-brand-border bg-white p-0.5">
          {(["all", "open", "in_progress", "done"] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => setStatusFilter(opt)}
              className={clsx(
                "text-xs px-2.5 py-1 rounded capitalize",
                statusFilter === opt ? "bg-brand-orange text-white" : "text-brand-muted hover:bg-brand-cream",
              )}
            >
              {opt.replace("_", " ")}
            </button>
          ))}
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary text-xs px-3 py-1.5">
          + New client work item
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="card text-center py-8">
          <p className="text-brand-muted text-sm">
            {workItems.length === 0 ? "No client work items yet." : `No items in '${statusFilter}'.`}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((w) => (
            <Link key={w.id} href={`/work/${w.id}`} className="block card hover:border-brand-orange/40">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-brand-black">{w.title}</div>
                  <div className="text-[11px] text-brand-muted mt-0.5">
                    {w.work_type} · {w.priority} · {w.status.replace("_", " ")}
                    {w.due_date && ` · due ${w.due_date}`}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {showNew && (
        <NewClientWorkItemModal
          clientId={clientId}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); onReload(); }}
        />
      )}
    </>
  );
}

// ─── T&M tab ─────────────────────────────────────────────────────────────────

function TmTab({
  services,
  entries,
  onLog,
  onGenerateInvoice,
}: {
  services: ClientService[];
  entries: TmBillingEntry[];
  onLog: () => void;
  onGenerateInvoice: (serviceId: string) => void;
}) {
  const unbilled = entries.filter((e) => !e.billed);
  return (
    <>
      <div className="flex justify-between items-center mb-3 gap-2 flex-wrap">
        <div className="text-xs text-brand-muted">
          {entries.length} entr{entries.length === 1 ? "y" : "ies"} · {unbilled.length} unbilled
        </div>
        <div className="flex items-center gap-2">
          {services.map((s) => (
            <button
              key={s.id}
              onClick={() => onGenerateInvoice(s.id)}
              className="text-xs px-3 py-1.5 rounded border border-brand-border hover:bg-brand-cream"
            >
              Generate invoice ({s.service_template?.name})
            </button>
          ))}
          <button onClick={onLog} className="btn-primary text-xs px-3 py-1.5">+ Log hours</button>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="card text-center py-8">
          <p className="text-brand-muted text-sm">No T&M entries yet.</p>
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-xs">
            <thead className="bg-brand-cream/40 text-brand-muted uppercase tracking-wide">
              <tr>
                <th className="text-left py-2 px-3 font-medium">Date</th>
                <th className="text-left py-2 px-3 font-medium">Service</th>
                <th className="text-left py-2 px-3 font-medium">Hours</th>
                <th className="text-left py-2 px-3 font-medium">Description</th>
                <th className="text-left py-2 px-3 font-medium">By</th>
                <th className="text-left py-2 px-3 font-medium">Billed</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const svc = services.find((s) => s.id === e.client_service_id);
                return (
                  <tr key={e.id} className="border-t border-brand-border">
                    <td className="py-2 px-3">{e.entry_date}</td>
                    <td className="py-2 px-3">{svc?.service_template?.name ?? "—"}</td>
                    <td className="py-2 px-3">{e.hours}</td>
                    <td className="py-2 px-3">{e.description}</td>
                    <td className="py-2 px-3">{e.logged_by}</td>
                    <td className="py-2 px-3">
                      {e.billed
                        ? <span className="inline-flex rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[11px]">Billed</span>
                        : <span className="inline-flex rounded-full bg-gray-100 text-gray-600 px-2 py-0.5 text-[11px]">Unbilled</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ─── Modals ──────────────────────────────────────────────────────────────────

function AddServiceModal({
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
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-xl">
        <div className="px-4 py-3 border-b border-brand-border flex items-center justify-between">
          <h3 className="font-semibold text-brand-black text-sm">Add service to client</h3>
          <button onClick={onClose} className="text-brand-muted hover:text-brand-black text-lg leading-none">×</button>
        </div>
        <div className="p-4 space-y-3">
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
            Row will be created with status='pending_activation'. Use "Activate billing" to finish setup.
          </p>
          {err && <div className="text-xs text-red-700">{err}</div>}
        </div>
        <div className="px-4 py-3 border-t border-brand-border flex justify-end gap-2">
          <button onClick={onClose} className="text-xs px-3 py-1 hover:bg-brand-cream rounded">Cancel</button>
          <button
            onClick={save}
            disabled={saving || !templateId}
            className={clsx("btn-primary text-xs px-3 py-1.5", saving && "opacity-60")}
          >
            {saving ? "Saving…" : "Add service"}
          </button>
        </div>
      </div>
    </div>
  );
}

function NewClientWorkItemModal({
  clientId,
  onClose,
  onCreated,
}: {
  clientId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"high" | "medium" | "low">("medium");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch("/api/work", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          work_type: "deliverable",
          priority,
          status: "open",
          work_item_type: "client",
          client_id: clientId,
        }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`);
      }
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-xl">
        <div className="px-4 py-3 border-b border-brand-border flex items-center justify-between">
          <h3 className="font-semibold text-brand-black text-sm">New client work item</h3>
          <button onClick={onClose} className="text-brand-muted hover:text-brand-black text-lg leading-none">×</button>
        </div>
        <div className="p-4 space-y-3">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="w-full rounded border border-brand-border px-2 py-1.5 text-sm"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="Description (optional)"
            className="w-full rounded border border-brand-border px-2 py-1.5 text-xs"
          />
          <div>
            <div className="text-[10px] uppercase text-brand-muted mb-1">Priority</div>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as "high" | "medium" | "low")}
              className="w-full rounded border border-brand-border px-2 py-1 text-xs"
            >
              <option value="high">high</option>
              <option value="medium">medium</option>
              <option value="low">low</option>
            </select>
          </div>
          <p className="text-[11px] text-brand-muted">
            Pre-filled: work_type=deliverable, work_item_type=client, client_id={clientId.slice(0, 8)}…
          </p>
          {err && <div className="text-xs text-red-700">{err}</div>}
        </div>
        <div className="px-4 py-3 border-t border-brand-border flex justify-end gap-2">
          <button onClick={onClose} className="text-xs px-3 py-1 hover:bg-brand-cream rounded">Cancel</button>
          <button
            onClick={save}
            disabled={saving || !title.trim()}
            className={clsx("btn-primary text-xs px-3 py-1.5", saving && "opacity-60")}
          >
            {saving ? "Saving…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function LogHoursModal({
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
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-xl">
        <div className="px-4 py-3 border-b border-brand-border flex items-center justify-between">
          <h3 className="font-semibold text-brand-black text-sm">Log T&M hours</h3>
          <button onClick={onClose} className="text-brand-muted hover:text-brand-black text-lg leading-none">×</button>
        </div>
        <div className="p-4 space-y-3">
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
        <div className="px-4 py-3 border-t border-brand-border flex justify-end gap-2">
          <button onClick={onClose} className="text-xs px-3 py-1 hover:bg-brand-cream rounded">Cancel</button>
          {services.length > 0 && (
            <button
              onClick={save}
              disabled={saving}
              className={clsx("btn-primary text-xs px-3 py-1.5", saving && "opacity-60")}
            >
              {saving ? "Logging…" : "Log hours"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function EditServiceModal({
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
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-xl">
        <div className="px-4 py-3 border-b border-brand-border flex items-center justify-between">
          <h3 className="font-semibold text-brand-black text-sm">
            Edit service — {service.service_template?.name ?? ""}
          </h3>
          <button onClick={onClose} className="text-brand-muted hover:text-brand-black text-lg leading-none">×</button>
        </div>
        <div className="p-4 space-y-3">
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
        <div className="px-4 py-3 border-t border-brand-border flex justify-end gap-2">
          <button onClick={onClose} className="text-xs px-3 py-1 hover:bg-brand-cream rounded">Cancel</button>
          <button
            onClick={save}
            disabled={saving}
            className={clsx("btn-primary text-xs px-3 py-1.5", saving && "opacity-60")}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CancelServiceModal({
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
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-xl">
        <div className="px-4 py-3 border-b border-brand-border flex items-center justify-between">
          <h3 className="font-semibold text-brand-black text-sm">
            Cancel service — {service.service_template?.name ?? ""}
          </h3>
          <button onClick={onClose} className="text-brand-muted hover:text-brand-black text-lg leading-none">×</button>
        </div>
        <div className="p-4 space-y-3">
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
        <div className="px-4 py-3 border-t border-brand-border flex justify-end gap-2">
          <button onClick={onClose} className="text-xs px-3 py-1 hover:bg-brand-cream rounded">Back</button>
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
        </div>
      </div>
    </div>
  );
}
