"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { fetchJson } from "@/lib/fetch-json";
import { safeHref } from "@/lib/safe-url";
import { ORG_STATUS_META } from "@/lib/crm/org-status";
import { defaultDealId } from "@/lib/crm/org-engagement";
import { parseOrgTab, visibleOrgTabs, type OrgTab } from "@/lib/crm/org-tabs";
import type { OrgBusiness, OrgDetail } from "@/lib/crm/org-detail";
import { Button, ErrorState, LoadingState, Tabs } from "@/components/ui";
import { NewDiscoveryModal } from "@/components/crm/NewDiscoveryModal";
import { ScopeLink } from "@/components/crm/scope/ScopeLink";
import { OrgFormModal } from "@/components/crm/org/OrgFormModal";
import { OrgFacts, OrgPeople } from "@/components/crm/org/OrgPeople";
import { OrgActivity } from "@/components/crm/org/OrgActivity";
import { OrgEngagement } from "@/components/crm/org/OrgEngagement";
import { OrgRightRail } from "@/components/crm/org/OrgRightRail";
import { OrgDuplicateBannerSlot, OrgHeaderActionsSlot, OrgResearchSlot } from "@/components/crm/org/slots";
import { ClientBillingPanel, ClientTimePanel, ClientWorkPanel, openClientPortal, useClientRecord } from "@/components/crm/client/ClientRecord";
import { NewClientModal, useStripePaymentLink } from "@/components/crm/client/NewClientModal";
import type { CRMClient } from "@/types";

type Loaded = OrgDetail | { business: OrgBusiness; deleted: true };

export default function OrganizationPage() {
  return (
    <Suspense fallback={<div className="p-8"><LoadingState /></div>}>
      <OrganizationInner />
    </Suspense>
  );
}

function OrganizationInner() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false); // compose is admin-only; hidden until /api/auth/me says admin
  const [editing, setEditing] = useState(false);
  const [newDiscovery, setNewDiscovery] = useState(false);
  const [newClient, setNewClient] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetchJson<Loaded>(`/api/crm/organizations/${id}`);
    if (r.ok) { setData(r.data); setError(null); }
    else if (r.status === 404) setNotFound(true);
    else setError(r.error);
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetchJson<{ role?: string }>("/api/auth/me").then((me) => setIsAdmin(me.ok && me.data.role === "admin")); }, []);

  const detail = data && !("deleted" in data) ? data : null;
  const hasClient = (detail?.clients.length ?? 0) > 0;
  const tab = parseOrgTab(sp.get("tab"), hasClient);
  const dealId = detail ? (detail.deals.some((d) => d.id === sp.get("deal")) ? sp.get("deal") : defaultDealId(detail.deals)) : null;
  const clientId = detail ? (detail.clients.some((c) => c.id === sp.get("client")) ? sp.get("client") : detail.primary_client_id) : null;
  const record = useClientRecord(hasClient ? clientId : null);
  const payment = useStripePaymentLink();

  const setParams = useCallback((next: Record<string, string | null>) => {
    const p = new URLSearchParams(Array.from(sp.entries()));
    for (const [k, v] of Object.entries(next)) { if (v) p.set(k, v); else p.delete(k); }
    router.replace(`${pathname}?${p}`, { scroll: false });
  }, [router, pathname, sp]);
  const selectTab = (t: OrgTab) => setParams({ tab: t === "activity" ? null : t });
  const openDeal = (leadId: string) => setParams({ tab: "engagement", deal: leadId });

  if (notFound) {
    return (
      <div className="p-8">
        <p className="text-brand-muted">Organization not found.</p>
        <Link href="/crm/organizations" className="text-brand-orange text-sm mt-2 block">← Organizations</Link>
      </div>
    );
  }
  if (error && !data) return <div className="p-8"><ErrorState message={`Couldn't load this organization: ${error}`} onRetry={load} /></div>;
  if (!data) return <div className="p-8"><LoadingState /></div>;

  if (!detail) {
    return (
      <div className="p-4 md:p-8 max-w-3xl">
        <Link href="/crm/organizations" className="text-xs text-brand-muted hover:text-brand-black">← Organizations</Link>
        <div className="card mt-2">
          <h1 className="text-lg font-semibold text-brand-black">{data.business.name}</h1>
          <p className="text-sm text-brand-muted mt-1">This record is in Trash.</p>
          <Link href="/crm/settings?tab=trash" className="text-sm text-brand-orange hover:underline mt-2 inline-block">Restore it from Trash →</Link>
        </div>
      </div>
    );
  }

  const b = detail.business;
  const site = safeHref(b.website);
  const meta = ORG_STATUS_META[detail.status];
  const client = detail.clients.find((c) => c.id === clientId) ?? null;
  const tabs = visibleOrgTabs(hasClient).map((t) => {
    const pending = t.id === "engagement" ? detail.upcoming.filter((u) => u.kind === "scope_proposal").length : 0;
    return { id: t.id, label: pending ? <>{t.label} <span className="ml-1 badge badge-warning text-[10px]">{pending}</span></> : t.label };
  });

  function email() {
    selectTab("activity");
    setTimeout(() => document.getElementById("compose")?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl pb-24 md:pb-8">
      <Link href="/crm/organizations" className="text-xs text-brand-muted hover:text-brand-black">← Organizations</Link>

      <div className="flex items-start justify-between gap-4 flex-wrap mt-2 mb-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-brand-black break-words">{b.name}</h1>
          <p className="text-sm text-brand-muted mt-0.5 flex flex-wrap items-center gap-2">
            <span className={clsx("badge text-xs", meta.badge)} title={b.relationship ? "Set by hand" : "From the client records"}>{meta.label}</span>
            {b.industry && <span>{b.industry}</span>}
            {site && <a href={site} target="_blank" rel="noopener noreferrer" className="text-brand-orange hover:underline">{b.website?.replace(/^https?:\/\//, "")}</a>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && <Button size="sm" onClick={email}>✉ Email</Button>}
          <Button size="sm" variant="secondary" onClick={() => setNewDiscovery(true)}>+ Discovery</Button>
          {client?.stripe_customer_id && (
            <Button size="sm" variant="secondary" onClick={async () => setMsg(await openClientPortal(client.id))}>Portal link →</Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
          <OrgHeaderActionsSlot businessId={b.id} name={b.name} onChanged={load} />
        </div>
      </div>
      <OrgDuplicateBannerSlot businessId={b.id} onChanged={load} />
      {msg && <ErrorState message={msg} className="mb-3" />}
      {error && <ErrorState message={`Couldn't refresh: ${error}`} onRetry={load} className="mb-3" />}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,16rem)] gap-4 items-start">
        <aside className="space-y-4 order-2 lg:order-1">
          <OrgFacts business={b} source={b.source} />
          <OrgPeople businessId={b.id} people={detail.people} onAdded={load} />
        </aside>

        <section className="min-w-0 order-1 lg:order-2">
          <Tabs tabs={tabs} value={tab} onChange={selectTab} className="mb-4" />
          {tab === "activity" && (
            <OrgActivity orgId={b.id} people={detail.people} deals={detail.deals} upcoming={detail.upcoming} isAdmin={isAdmin} onOpenDeal={openDeal} />
          )}
          {tab === "engagement" && (
            <OrgEngagement detail={detail} dealId={dealId} onSelectDeal={(d) => setParams({ deal: d })} onChanged={load} onOpenTab={selectTab} />
          )}
          {(tab === "billing" || tab === "time" || tab === "work") && client && (
            <div className="space-y-3">
              <ClientPicker clients={detail.clients} value={client.id} onChange={(c) => setParams({ client: c })} />
              {tab === "billing" && (
                <>
                  <div className="flex items-center gap-2 flex-wrap text-xs text-brand-muted">
                    <span>Billing {client.billing_status}{client.contact?.email ? ` · ${client.contact.email}` : ""}{!client.stripe_customer_id ? " · no Stripe customer yet" : ""}</span>
                    <span className="ml-auto flex gap-2 flex-wrap">
                      <ScopeLink clientId={client.id} />
                      <Button size="sm" variant="ghost" disabled={payment.generatingFor === client.id}
                        onClick={async () => {
                          const customerId = await payment.generate(client as unknown as CRMClient, b.name);
                          if (customerId) load();
                        }}>
                        {payment.generatingFor === client.id ? "Generating…" : "Send payment link"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setNewClient(true)}>+ Client record</Button>
                    </span>
                  </div>
                  <ClientBillingPanel record={record} onChanged={load} />
                </>
              )}
              {tab === "time" && <ClientTimePanel record={record} />}
              {tab === "work" && <ClientWorkPanel record={record} />}
            </div>
          )}
          {tab === "research" && <OrgResearchSlot businessId={b.id} />}
        </section>

        <aside className="order-3">
          <OrgRightRail detail={detail} dealId={dealId} onOpenDeal={openDeal} onOpenTab={selectTab} onChanged={load} />
        </aside>
      </div>

      {editing && (
        <OrgFormModal business={b} derivedLabel={ORG_STATUS_META[detail.derived_status].label} onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); load(); }} />
      )}
      {newDiscovery && <NewDiscoveryModal initialLeadId={dealId ?? undefined} onClose={() => setNewDiscovery(false)} />}
      {newClient && (
        <NewClientModal businessId={b.id} onClose={() => setNewClient(false)}
          onCreated={(c) => { setNewClient(false); setParams({ tab: "billing", client: c.id }); load(); }} />
      )}
      {payment.modal}
    </div>
  );
}

function ClientPicker({ clients, value, onChange }: { clients: OrgDetail["clients"]; value: string; onChange: (id: string) => void }) {
  if (clients.length < 2) return null;
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="client-picker" className="text-xs text-brand-muted">Client record</label>
      <select id="client-picker" value={value} onChange={(e) => onChange(e.target.value)}
        className="border border-brand-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-brand-orange">
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.contact ? `${c.contact.first_name}${c.contact.last_name ? ` ${c.contact.last_name}` : ""}` : "Client"} · since {c.contract_start ?? c.created_at.slice(0, 10)} · {c.billing_status}
          </option>
        ))}
      </select>
    </div>
  );
}
